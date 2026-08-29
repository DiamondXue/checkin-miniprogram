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

    // 4. 下载签名图片
    const signatureBuffers = {}; // { fileID: Buffer }
    const sigFileIds = records.filter(r => r.signatureFileId).map(r => r.signatureFileId);
    if (sigFileIds.length > 0) {
      for (const fileID of sigFileIds) {
        try {
          const dlRes = await cloud.downloadFile({ fileID });
          signatureBuffers[fileID] = dlRes.fileContent;
        } catch (e) {
          console.error('下载签名失败', fileID, e.message);
        }
      }
    }

    // 5. 创建 Excel
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('签到数据', {
      properties: { defaultRowHeight: 20 },
    });

    // 构建表头
    const headers = ['姓名', '工号', '部门', '签到状态', '签到时间'];
    if (requireSignature) headers.push('签名');
    confirmItems.forEach(item => {
      headers.push(`${item.label}-状态`);
      headers.push(`${item.label}-时间`);
    });

    ws.columns = headers.map((h, i) => {
      let width = 14;
      if (i === 0) width = 16;
      if (i === 2) width = 22;
      if (i === 4) width = 12;
      if (requireSignature && i === 5) width = 30;
      return { header: h, key: `col${i}`, width };
    });

    // 表头样式
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } };

    // 6. 填充数据行
    for (let rowIdx = 0; rowIdx < records.length; rowIdx++) {
      const r = records[rowIdx];
      const excelRow = rowIdx + 2; // Excel 行号（1-based，表头占第1行）
      const colIdx = 0;

      ws.getCell(`A${excelRow}`).value = r.name || '';
      ws.getCell(`B${excelRow}`).value = r.staffId || '';
      ws.getCell(`C${excelRow}`).value = r.dept || '';
      ws.getCell(`D${excelRow}`).value = r.checked ? '已签到' : '未签到';
      ws.getCell(`E${excelRow}`).value = r.checkedAt || '';

      let currentCol = 6; // F 列开始

      // 签名列：嵌入图片
      if (requireSignature) {
        const sigCol = String.fromCharCode(64 + currentCol); // F
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
