// 云函数：exportCheckinData
// 用途：导出活动签到数据为 Excel
// 参数：activityId
// 返回：{ success, fileID } fileID 为云存储文件 ID

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const XLSX = require('xlsx');

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

    // 4. 如果有签名图片，批量获取临时链接
    const signatureFileIds = records
      .filter(r => r.signatureFileId)
      .map(r => r.signatureFileId);
    let fileUrlMap = {};
    if (signatureFileIds.length > 0) {
      const urlResults = await cloud.getTempFileURL({ fileList: signatureFileIds });
      urlResults.fileList.forEach(f => {
        if (f.tempFileURL) fileUrlMap[f.fileID] = f.tempFileURL;
      });
    }

    // 5. 构建 Excel 数据
    // 基础列：姓名、工号、部门、签到状态、签到时间
    const headers = ['姓名', '工号', '部门', '签到状态', '签到时间'];
    // 签名列
    if (requireSignature) headers.push('签名');
    // 各领取项目列（每个项目两列：是否领取、领取时间）
    confirmItems.forEach(item => {
      headers.push(`${item.label}-状态`);
      headers.push(`${item.label}-时间`);
    });

    const rows = records.map(r => {
      const row = [
        r.name || '',
        r.staffId || '',
        r.dept || '',
        r.checked ? '已签到' : '未签到',
        r.checkedAt || '',
      ];
      if (requireSignature) {
        const sigUrl = r.signatureFileId ? (fileUrlMap[r.signatureFileId] || r.signatureFileId) : '';
        row.push(sigUrl ? '有' : '无');
      }
      confirmItems.forEach(item => {
        const conf = (r.confirmations && r.confirmations[item.key]) || {};
        row.push(conf.confirmed ? '已领取' : '未领取');
        row.push(conf.at || '');
      });
      return row;
    });

    // 6. 生成 Excel
    const wsData = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // 设置列宽
    ws['!cols'] = headers.map((h, i) => {
      let width = 12;
      if (i === 0) width = 16; // 姓名
      if (i === 1) width = 14; // 工号
      if (i === 2) width = 20; // 部门
      if (i === 4) width = 12; // 签到时间
      return { wch: width };
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '签到数据');

    // 7. 生成 Buffer 并上传到云存储
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const fileName = `签到数据_${activity.name || activityId}_${Date.now()}.xlsx`;
    const cloudPath = `exports/${activityId}/${fileName}`;
    const uploadRes = await cloud.uploadFile({
      cloudPath,
      fileContent: buffer,
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
