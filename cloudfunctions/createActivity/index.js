// 云函数：createActivity
// 用途：管理参与者的所有操作（读取、写入、签到、撤销）
// 注意：不使用子集合，所有参与者数据存在独立的 participants 顶层集合中
//       通过 activityId 字段关联活动

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { action, activityId, participants, staffIds, staffId, name, dept, participantId, checked, checkedAt } = event;

  if (action === 'createParticipants') {
    // 支持两种模式：
    //   1. 传 staffIds（工号数组）→ 云端自动查 users 获取姓名部门（推荐，支持大量用户）
    //   2. 传 participants（{staffId,name,dept} 数组）→ 直接写入（兼容旧调用）
    const results = { added: 0, errors: [] };

    let participantList = [];

    if (staffIds && staffIds.length > 0) {
      // 模式1：批量查询 users，每次最多查100条（微信云数据库单次上限）
      const QUERY_BATCH = 100;
      const userMap = {};
      for (let i = 0; i < staffIds.length; i += QUERY_BATCH) {
        const batch = staffIds.slice(i, i + QUERY_BATCH);
        try {
          const { data } = await db.collection('users')
            .where({ staffId: _.in(batch) })
            .limit(QUERY_BATCH)
            .get();
          data.forEach(u => { userMap[u.staffId] = u; });
        } catch (e) {
          // 查询失败时忽略，后续用工号代替姓名
        }
      }
      participantList = staffIds.map(sId => ({
        staffId: sId,
        name: userMap[sId] ? (userMap[sId].name || sId) : sId,
        dept: userMap[sId] ? (userMap[sId].dept || '') : '',
      }));
    } else if (participants && participants.length > 0) {
      // 模式2：兼容旧格式
      participantList = participants;
    }

    // 全部并发写入（前端已按20条分批，云函数直接一次性并发全部写入）
    const WRITE_BATCH = 20;
    for (let i = 0; i < participantList.length; i += WRITE_BATCH) {
      const batch = participantList.slice(i, i + WRITE_BATCH);
      const writes = batch.map(p =>
        db.collection('participants').add({
          data: {
            activityId,
            staffId: p.staffId,
            name: p.name || p.staffId,
            dept: p.dept || '',
            checked: false,
            checkedAt: '',
            createdAt: db.serverDate(),
          },
        }).then(() => {
          results.added++;
        }).catch(err => {
          results.errors.push({ staffId: p.staffId, error: err.message });
        })
      );
      await Promise.all(writes);
    }

    return { success: true, ...results };
  }

  if (action === 'addParticipants') {
    // 向已有活动批量新增参与者（staffIds 为工号数组）
    // 同步更新 activities 表的 participantStaffIds 字段
    const results = { added: 0, skipped: 0, errors: [] };
    let participantList = [];

    if (staffIds && staffIds.length > 0) {
      const QUERY_BATCH = 100;
      const userMap = {};
      for (let i = 0; i < staffIds.length; i += QUERY_BATCH) {
        const batch = staffIds.slice(i, i + QUERY_BATCH);
        try {
          const { data } = await db.collection('users')
            .where({ staffId: _.in(batch) })
            .limit(QUERY_BATCH)
            .get();
          data.forEach(u => { userMap[u.staffId] = u; });
        } catch (e) {}
      }
      participantList = staffIds.map(sId => ({
        staffId: sId,
        name: userMap[sId] ? (userMap[sId].name || sId) : sId,
        dept: userMap[sId] ? (userMap[sId].dept || '') : '',
      }));
    }

    // 去重：跳过已有的参与者，同时收集需要追加的工号
    let newStaffIds = [];
    if (participantList.length > 0) {
      const existing = await db.collection('participants')
        .where({ activityId })
        .get();
      const existingIds = new Set(existing.data.map(p => p.staffId));

      newStaffIds = participantList
        .filter(p => !existingIds.has(p.staffId))
        .map(p => p.staffId);

      const WRITE_BATCH = 20;
      for (let i = 0; i < participantList.length; i += WRITE_BATCH) {
        const batch = participantList.slice(i, i + WRITE_BATCH).filter(p => !existingIds.has(p.staffId));
        if (batch.length === 0) continue;
        const writes = batch.map(p =>
          db.collection('participants').add({
            data: {
              activityId,
              staffId: p.staffId,
              name: p.name || p.staffId,
              dept: p.dept || '',
              checked: false,
              checkedAt: '',
              createdAt: db.serverDate(),
            },
          }).then(() => { results.added++; }).catch(err => {
            results.errors.push({ staffId: p.staffId, error: err.message });
          })
        );
        await Promise.all(writes);
      }
    }

    // 同步更新 activities 表的 participantStaffIds
    if (newStaffIds.length > 0) {
      try {
        const actDoc = await db.collection('activities').doc(activityId).get();
        const oldIds = actDoc.data.participantStaffIds || [];
        const merged = Array.from(new Set([...oldIds, ...newStaffIds]));
        await db.collection('activities').doc(activityId).update({
          data: { participantStaffIds: merged },
        });
      } catch (e) {
        results.errors.push({ error: '同步participantStaffIds失败: ' + e.message });
      }
    }

    return { success: true, ...results };
  }

  if (action === 'removeParticipant') {
    // 删除单个参与者，同步更新 activities 表的 participantStaffIds
    try {
      // 先查该参与者的 staffId
      const partDoc = await db.collection('participants').doc(participantId).get();
      const removedStaffId = partDoc.data.staffId;

      // 删除参与者记录
      await db.collection('participants').doc(participantId).remove();

      // 同步更新 activities 表的 participantStaffIds
      if (removedStaffId) {
        try {
          const actDoc = await db.collection('activities').doc(activityId).get();
          const oldIds = actDoc.data.participantStaffIds || [];
          const updatedIds = oldIds.filter(id => id !== removedStaffId);
          await db.collection('activities').doc(activityId).update({
            data: { participantStaffIds: updatedIds },
          });
        } catch (e) {
          // 更新 participantStaffIds 失败不影响主流程
        }
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  if (action === 'deleteParticipants') {
    // 删除活动的所有参与者（循环删除，直到全部清空）
    try {
      let totalDeleted = 0;
      while (true) {
        const { data } = await db.collection('participants')
          .where({ activityId })
          .limit(100)
          .get();
        if (data.length === 0) break;
        await Promise.all(data.map(doc => db.collection('participants').doc(doc._id).remove()));
        totalDeleted += data.length;
      }
      return { success: true, deleted: totalDeleted };
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
    // 查询活动所有参与者（分页取全量，突破单次100条限制）
    try {
      let allData = [];
      let skip = 0;
      const LIMIT = 100;
      while (true) {
        const { data } = await db.collection('participants')
          .where({ activityId })
          .orderBy('checked', 'asc')
          .skip(skip)
          .limit(LIMIT)
          .get();
        allData = allData.concat(data);
        if (data.length < LIMIT) break;
        skip += LIMIT;
      }
      return { success: true, participants: allData };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  if (action === 'checkin') {
    // 签到或撤销签到
    try {
      // 自动生成时间（如果签到，云端记录时间，显式使用 UTC+8 中国标准时间）
      let finalCheckedAt = checkedAt || '';
      if (checked === true && !checkedAt) {
        const now = new Date();
        const chinaHours = (now.getUTCHours() + 8) % 24;
        const chinaMinutes = now.getUTCMinutes();
        const hh = String(chinaHours).padStart(2, '0');
        const mm = String(chinaMinutes).padStart(2, '0');
        finalCheckedAt = `${hh}:${mm}`;
      }

      if (participantId) {
        // 更新已有记录
        await db.collection('participants').doc(participantId).update({
          data: { checked, checkedAt: finalCheckedAt },
        });
      } else {
        // 新增签到记录
        await db.collection('participants').add({
          data: {
            activityId,
            staffId,
            name: name || staffId,
            dept: dept || '',
            checked: true,
            checkedAt: finalCheckedAt,
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
