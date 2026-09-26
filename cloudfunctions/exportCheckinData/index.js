// 云函数：exportCheckinData
// 用途：导出活动签到数据为 Excel（含签名图片嵌入）
// 参数：activityId
// 返回：{ success, fileID }

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const ExcelJS = require('exceljs');

exports.main = async (event) => {
  const { activityId } = event;
  if (!activityId) {
    return { success: false, error: '缺少 activityId' };
  }

  try {
    // 1. 获取活动信息
    const actRes = await db.collection('activities').doc(activityId).get();
    const activity = actRes.data;
    const confirmItems = activity.confirmItems || [];
    const requireSignature = !!activity.requireSignature;
    // 信息安全模式：姓名/部门不导出，工号仅保留后6位
    const secureMode = !!activity.secureMode;

    // 2. 分页获取所有参与者记录
    const MAX = 100;
    let allRecords = [];
    let skip = 0;
    while (true) {
      const { data } = await db.collection('participants')
        .where({ activityId })
        .skip(skip)
        .limit(MAX)
        .get();
      allRecords = allRecords.concat(data);
      if (data.length < MAX) break;
      skip += MAX;
    }

    // 3. 按 staffId 去重，已签到的优先
    const byStaffId = {};
    allRecords.forEach(p => {
      const prev = byStaffId[p.staffId];
      if (!prev) { byStaffId[p.staffId] = p; return; }
      if (!!p.checked && !prev.checked) byStaffId[p.staffId] = p;
    });
    const records = Object.values(byStaffId);

    // 4. 并行下载签名图片（串行下载多个图片会超时）
    const signatureBuffers = {}; // { fileID: Buffer }
    const sigFileIds = records.filter(r => r.signatureFileId).map(r => r.signatureFileId);
    if (sigFileIds.length > 0) {
      const results = await Promise.all(sigFileIds.map(async (fileID) => {
        try {
          const dlRes = await cloud.downloadFile({ fileID });
          return { fileID, buffer: dlRes.fileContent };
        } catch (e) {
          console.error('下载签名失败', fileID, e.message);
          return { fileID, buffer: null };
        }
      }));
      results.forEach(({ fileID, buffer }) => {
        if (buffer) signatureBuffers[fileID] = buffer;
      });
    }

    // 5. 创建 Excel
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('签到数据', {
      properties: { defaultRowHeight: 20 },
    });

    // 构建表头（新增人员类型列，区分员工工号与入场券号）
    const headers = ['姓名', '工号/入场券号', '部门', '签到状态', '签到时间', '人员类型'];
    if (requireSignature) headers.push('签名');
    confirmItems.forEach(item => {
      headers.push(`${item.label}-状态`);
      headers.push(`${item.label}-时间`);
    });

    ws.columns = headers.map((h, i) => {
      let width = 14;
      if (i === 0) width = 16;
      if (i === 1) width = 18;
      if (i === 2) width = 22;
      if (i === 4) width = 12;
      if (requireSignature && i === 6) width = 30;
      return { header: h, key: `col${i}`, width };
    });

    // 表头样式
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } };

    // 6. 填充数据行
    for (let rowIdx = 0; rowIdx < records.length; rowIdx++) {
      const r = records[rowIdx];
      const excelRow = rowIdx + 2; // Excel 行号（1-based，表头占第1行）

      // 区分员工 / 入场券
      const isTicket = !!r.isTicket || /^[A-Z]\d{7}$/.test(r.staffId || '');

      // 姓名：入场券无姓名（记录里的 name 就是券号，留空避免与号码列重复）
      ws.getCell(`A${excelRow}`).value = isTicket ? '' : (secureMode ? '保密' : (r.name || ''));
      // 号码：安全模式下员工工号仅后6位，入场券号保持完整
      ws.getCell(`B${excelRow}`).value = (!isTicket && secureMode)
        ? String(r.staffId || '').slice(-6)
        : (r.staffId || '');
      // 部门：入场券无部门
      ws.getCell(`C${excelRow}`).value = isTicket ? '' : (secureMode ? '' : (r.dept || ''));
      ws.getCell(`D${excelRow}`).value = r.checked ? '已签到' : '未签到';
      ws.getCell(`E${excelRow}`).value = r.checkedAt || '';
      // 人员类型
      ws.getCell(`F${excelRow}`).value = isTicket ? '入场券' : '员工';

      let currentCol = 7; // G 列开始（F 列已用于人员类型）

      // 签名列：嵌入图片
      if (requireSignature) {
        const sigCol = String.fromCharCode(64 + currentCol); // G
        if (r.signatureFileId && signatureBuffers[r.signatureFileId]) {
          const imgId = wb.addImage({
            buffer: signatureBuffers[r.signatureFileId],
            extension: 'png',
          });
          ws.addImage(imgId, {
            tl: { col: currentCol - 1, row: excelRow - 1 },
            ext: { width: 200, height: 80 },
          });
          ws.getRow(excelRow).height = 65; // 加高行高容纳图片
        } else {
          ws.getCell(`${sigCol}${excelRow}`).value = '无';
        }
        currentCol++;
      }

      // 各领取项目
      confirmItems.forEach(item => {
        const conf = (r.confirmations && r.confirmations[item.key]) || {};
        const statusCol = String.fromCharCode(64 + currentCol);
        const timeCol = String.fromCharCode(64 + currentCol + 1);
        ws.getCell(`${statusCol}${excelRow}`).value = conf.confirmed ? '已领取' : '未领取';
        ws.getCell(`${timeCol}${excelRow}`).value = conf.at || '';
        currentCol += 2;
      });
    }

    // 7. 生成 Buffer 并上传
    const buffer = await wb.xlsx.writeBuffer();
    const fileName = `签到数据_${activity.name || activityId}_${Date.now()}.xlsx`;
    const cloudPath = `exports/${activityId}/${fileName}`;
    const uploadRes = await cloud.uploadFile({
      cloudPath,
      fileContent: Buffer.from(buffer),
    });

    return {
      success: true,
      fileID: uploadRes.fileID,
      fileName,
      total: records.length,
      checkedCount: records.filter(r => r.checked).length,
    };
  } catch (err) {
    console.error('导出失败', err);
    return { success: false, error: err.message };
  }
};
