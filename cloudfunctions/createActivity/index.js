// 云函数：createActivity
// 用途：管理参与者的所有操作（读取、写入、签到、撤销）
// 注意：不使用子集合，所有参与者数据存在独立的 participants 顶层集合中
//       通过 activityId 字段关联活动

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { action, activityId, participants, staffId, name, dept, participantId, checked, checkedAt } = event;

  if (action === 'createParticipants') {
    // 批量创建参与者
    const results = { added: 0, errors: [] };

    for (const p of participants) {
      try {
        await db.collection('participants').add({
          data: {
            activityId,
            staffId: p.staffId,
            name: p.name || p.staffId,
            dept: p.dept || '',
            checked: false,
            checkedAt: '',
            createdAt: db.serverDate(),
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
    // 删除活动的所有参与者
    try {
      const { data } = await db.collection('participants')
        .where({ activityId })
        .limit(100)
        .get();

      for (const doc of data) {
        await db.collection('participants').doc(doc._id).remove();
      }

      return { success: true, deleted: data.length };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  if (action === 'getParticipant') {
    // 查询某个参与者的签到记录
    try {
      const { data } = await db.collection('participants')
        .where({ activityId, staffId })
        .limit(1)
        .get();
      return { success: true, record: data[0] || null };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  if (action === 'getParticipants') {
    // 查询活动所有参与者
    try {
      const { data } = await db.collection('participants')
        .where({ activityId })
        .orderBy('checked', 'asc')
        .get();
      return { success: true, participants: data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  if (action === 'checkin') {
    // 签到或撤销签到
    try {
      if (participantId) {
        // 更新已有记录
        await db.collection('participants').doc(participantId).update({
          data: { checked, checkedAt: checkedAt || '' },
        });
      } else {
        // 新增签到记录
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');

        await db.collection('participants').add({
          data: {
            activityId,
            staffId,
            name: name || staffId,
            dept: dept || '',
            checked: true,
            checkedAt: `${hh}:${mm}`,
            createdAt: db.serverDate(),
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
      const { total } = await db.collection('participants')
        .where({ activityId })
        .count();
      const { total: checkedTotal } = await db.collection('participants')
        .where({ activityId, checked: true })
        .count();
      return { success: true, totalCount: total, checkedCount: checkedTotal };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  if (action === 'getMyCheckin') {
    // 普通用户获取自己的签到状态
    try {
      const { data } = await db.collection('participants')
        .where({ activityId, staffId })
        .limit(1)
        .get();
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
