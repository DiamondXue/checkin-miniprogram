// 云函数：createActivity
// 用途：小程序端不支持 doc().collection()，所有子集合操作都通过此云函数
// actions:
//   createParticipants - 批量创建参与者
//   deleteParticipants - 删除活动所有参与者
//   getParticipant     - 查询某个参与者的签到记录
//   getParticipants    - 查询活动所有参与者
//   checkin            - 签到 / 撤销签到

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { action, activityId, participants, staffId, name, dept, participantId, checked, checkedAt } = event;

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

      for (const doc of data) {
        await pCol.doc(doc._id).remove();
      }

      return { success: true, deleted: data.length };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  if (action === 'getParticipant') {
    // 查询某个参与者的签到记录
    try {
      const pCol = db.collection('activities').doc(activityId).collection('participants');
      const { data } = await pCol.where({ staffId }).limit(1).get();
      return { success: true, record: data[0] || null };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  if (action === 'getParticipants') {
    // 查询活动所有参与者
    try {
      const pCol = db.collection('activities').doc(activityId).collection('participants');
      const { data } = await pCol.orderBy('checked', 'asc').get();
      return { success: true, participants: data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  if (action === 'checkin') {
    // 签到或撤销签到
    try {
      const pCol = db.collection('activities').doc(activityId).collection('participants');

      if (participantId) {
        // 更新已有记录
        await pCol.doc(participantId).update({
          data: { checked, checkedAt: checkedAt || '' },
        });
      } else {
        // 新增签到记录
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');

        await pCol.add({
          data: {
            staffId,
            name: name || staffId,
            dept: dept || '',
            checked: true,
            checkedAt: `${hh}:${mm}`,
          },
        });
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  if (action === 'getParticipantStats') {
    // 获取活动的参与者统计（总数 + 已签到数）
    try {
      const pCol = db.collection('activities').doc(activityId).collection('participants');
      const { total } = await pCol.count();
      const { total: checkedTotal } = await pCol.where({ checked: true }).count();
      return { success: true, totalCount: total, checkedCount: checkedTotal };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  if (action === 'getMyCheckin') {
    // 普通用户获取自己的签到状态
    try {
      const pCol = db.collection('activities').doc(activityId).collection('participants');
      const { data } = await pCol.where({ staffId }).limit(1).get();
      const myRecord = data[0] || {};
      return {
        success: true,
        myChecked: !!myRecord.checked,
        myCheckedAt: myRecord.checkedAt || '',
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  return { success: false, error: 'Unknown action' };
};
