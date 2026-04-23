// 云函数：createActivity
// 用途：在小程序端创建活动 + 批量写入参与者子集合
// 小程序端不支持 doc().collection()，必须通过云函数操作子集合

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { action, activityId, participants, staffId, name, dept } = event;

  if (action === 'createParticipants') {
    // 批量创建参与者
    const results = { added: 0, errors: [] };
    const pCol = db.collection('activities').doc(activityId).collection('participants');

    for (const p of participants) {
      try {
        await pCol.add({
          data: {
            staffId: p.staffId,
            name: p.name || p.staffId,
            dept: p.dept || '',
            checked: false,
            checkedAt: '',
          },
        });
        results.added++;
      } catch (err) {
        results.errors.push({ staffId: p.staffId, error: err.message });
      }
    }

    return { success: true, ...results };
  }

  if (action === 'deleteParticipants') {
    // 删除活动的所有参与者（删除活动前调用）
    try {
      const pCol = db.collection('activities').doc(activityId).collection('participants');
      const { data } = await pCol.limit(100).get();
      const batchSize = data.length;

      for (const doc of data) {
        await pCol.doc(doc._id).remove();
      }

      return { success: true, deleted: batchSize };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  return { success: false, error: 'Unknown action' };
};
