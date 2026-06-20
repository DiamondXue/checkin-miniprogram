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

  // 获取活动的 confirmItems 配置，用于初始化 confirmations
  async function getActivityConfirmItems() {
    try {
      const act = await db.collection('activities').doc(activityId).get();
      if (act.data && act.data.confirmItems && act.data.confirmItems.length > 0) {
        return act.data.confirmItems;
      }
    } catch (e) {}
    return [];
  }

  // 生成确认字段（兼容新旧格式）
  function buildConfirmFields(confirmItems) {
    const fields = {};
    if (confirmItems && confirmItems.length > 0) {
      const confirmations = {};
      confirmItems.forEach(item => {
        confirmations[item.key] = { confirmed: false, at: '', by: '' };
      });
      fields.confirmations = confirmations;
      // 向后兼容：如果有 tea/gift 标准 key，同时设置旧字段
      if (confirmations.tea) {
        fields.teaConfirmed = false;
        fields.teaConfirmedAt = '';
        fields.teaConfirmedBy = '';
      }
      if (confirmations.gift) {
        fields.giftConfirmed = false;
        fields.giftConfirmedAt = '';
        fields.giftConfirmedBy = '';
      }
    } else {
      // 默认：没有自定义项目，仅向后兼容
      fields.teaConfirmed = false;
      fields.teaConfirmedAt = '';
      fields.teaConfirmedBy = '';
      fields.giftConfirmed = false;
      fields.giftConfirmedAt = '';
      fields.giftConfirmedBy = '';
    }
    return fields;
  }

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

    // 获取活动的确认项目配置
    const confirmItems = await getActivityConfirmItems();
    const confirmFields = buildConfirmFields(confirmItems);

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
            ...confirmFields,
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
    const confirmItems = await getActivityConfirmItems();
    const confirmFields = buildConfirmFields(confirmItems);

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
      // 分页读取已有参与者，避免 .get() 默认 100 条限制导致重复添加
      const existingIds = new Set();
      const MAX_PER_PAGE = 100;
      let hasMore = true;
      let pageSkip = 0;
      while (hasMore) {
        try {
          const page = await db.collection('participants')
            .where({ activityId })
            .limit(MAX_PER_PAGE)
            .skip(pageSkip)
            .get();
          page.data.forEach(p => existingIds.add(p.staffId));
          if (page.data.length < MAX_PER_PAGE) hasMore = false;
          else pageSkip += MAX_PER_PAGE;
        } catch (e) {
          hasMore = false;
        }
      }

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
              ...confirmFields,
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

  // 获取活动全部参与者并按 staffId 去重（同一工号已签到优先）
  async function fetchUniqueParticipants(actId) {
    const MAX = 100;
    let all = [];
    let skip = 0;
    while (true) {
      const { data } = await db.collection('participants')
        .where({ activityId: actId })
        .skip(skip)
        .limit(MAX)
        .get();
      all = all.concat(data);
      if (data.length < MAX) break;
      skip += MAX;
    }
    const byStaffId = {};
    all.forEach(p => {
      const prev = byStaffId[p.staffId];
      if (!prev) { byStaffId[p.staffId] = p; return; }
      // 已签到的记录永远优先；其他情况保留第一条
      if (!!p.checked && !prev.checked) byStaffId[p.staffId] = p;
    });
    return Object.values(byStaffId);
  }

  if (action === 'getParticipants') {
    try {
      const list = await fetchUniqueParticipants(activityId);
      return { success: true, participants: list };
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

      // 优先用 participantId；若无则按 activityId + staffId 查找已有记录
      if (participantId) {
        await db.collection('participants').doc(participantId).update({
          data: { checked, checkedAt: finalCheckedAt },
        });
      } else if (staffId) {
        const existing = await db.collection('participants')
          .where({ activityId, staffId })
          .limit(1)
          .get();
        if (existing.data.length > 0) {
          // 更新已有记录（杜绝重复创建）
          await db.collection('participants').doc(existing.data[0]._id).update({
            data: { checked, checkedAt: finalCheckedAt },
          });
        } else {
          // 确实没有记录，才新建
          const confirmItems = await getActivityConfirmItems();
          const confirmFields = buildConfirmFields(confirmItems);
          await db.collection('participants').add({
            data: {
              activityId,
              staffId,
              name: name || staffId,
              dept: dept || '',
              checked: !!checked,
              checkedAt: finalCheckedAt,
              ...confirmFields,
              createdAt: db.serverDate(),
            },
          });
        }
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  if (action === 'getParticipantStats') {
    // 获取活动的参与者统计（总数 + 已签到数，按 staffId 去重）
    try {
      const list = await fetchUniqueParticipants(activityId);
      const totalCount = list.length;
      const checkedCount = list.filter(p => !!p.checked).length;
      return { success: true, totalCount, checkedCount };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  if (action === 'getMyCheckin') {
    // 普通用户获取自己的签到状态
    try {
      // 查所有该工号的记录并选已签到的那条（避免重复记录导致取到旧记录）
      const { data } = await db.collection('participants')
        .where({ activityId, staffId })
        .limit(20)
        .get();
      const checkedRecord = data.find(p => !!p.checked);
      const record = checkedRecord || data[0] || {};
      return {
        success: true,
        myChecked: !!record.checked,
        myCheckedAt: record.checkedAt || '',
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  if (action === 'getParticipant') {
    // 管理员扫码后查询参与者的签到状态和领取状态
    // 参数：activityId, staffId
    try {
      // 查多条后选已签到的那条（避免重复记录时取到未签到的旧记录）
      const { data } = await db.collection('participants')
        .where({ activityId, staffId })
        .limit(20)
        .get();
      let record = data.find(p => !!p.checked);
      if (!record) record = data[0] || null;
      if (!record) {
        return { success: true, record: null, confirmItems: [], enableScanConfirm: false };
      }
      // 同时获取活动的配置（用于前端动态渲染确认按钮）
      let confirmItems = [];
      let enableScanConfirm = false;
      let remainingCounts = {};
      try {
        const act = await db.collection('activities').doc(activityId).get();
        if (act.data) {
          confirmItems = act.data.confirmItems || [];
          enableScanConfirm = act.data.enableScanConfirm !== false;
          remainingCounts = act.data.remainingCounts || {};
        }
      } catch (e) {}

      // 兼容新旧数据格式
      const confirmations = record.confirmations || {};
      if (!record.confirmations) {
        // 旧格式 → 转换为新格式
        if (record.teaConfirmed !== undefined) {
          confirmations.tea = { confirmed: !!record.teaConfirmed, at: record.teaConfirmedAt || '', by: record.teaConfirmedBy || '' };
        }
        if (record.giftConfirmed !== undefined) {
          confirmations.gift = { confirmed: !!record.giftConfirmed, at: record.giftConfirmedAt || '', by: record.giftConfirmedBy || '' };
        }
      }

      return {
        success: true,
        record: {
          _id: record._id,
          staffId: record.staffId,
          name: record.name || '',
          dept: record.dept || '',
          checked: !!record.checked,
          checkedAt: record.checkedAt || '',
          confirmations,
        },
        confirmItems,
        remainingCounts,
        enableScanConfirm,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  if (action === 'confirmPickup') {
    // 管理员确认领取（茶点/礼品等自定义项目）
    // 使用事务保证参与者记录更新和余量更新的原子性，避免并发问题
    try {
      const { itemKey, confirmedBy, confirmedAt } = event;

      let updateData = {};

      if (itemKey) {
        const mapKey = `confirmations.${itemKey}`;
        updateData[`${mapKey}.confirmed`] = true;
        updateData[`${mapKey}.at`] = confirmedAt || '';
        updateData[`${mapKey}.by`] = confirmedBy || '';
        if (itemKey === 'tea') {
          updateData.teaConfirmed = true;
          updateData.teaConfirmedAt = confirmedAt || '';
          updateData.teaConfirmedBy = confirmedBy || '';
        } else if (itemKey === 'gift') {
          updateData.giftConfirmed = true;
          updateData.giftConfirmedAt = confirmedAt || '';
          updateData.giftConfirmedBy = confirmedBy || '';
        }
      } else {
        const { field, timeField, confirmedByField } = event;
        updateData[field] = true;
        updateData[timeField] = confirmedAt || '';
        updateData[confirmedByField] = confirmedBy || '';
      }

      let participantRecordId = null;
      if (participantId) {
        participantRecordId = participantId;
      } else if (activityId && staffId) {
        const { data } = await db.collection('participants')
          .where({ activityId, staffId })
          .limit(1)
          .get();
        if (data.length > 0) {
          participantRecordId = data[0]._id;
        } else {
          return { success: false, error: '未找到该参与者的签到记录' };
        }
      } else {
        return { success: false, error: '缺少 participantId 或 activityId+staffId' };
      }

      // 更新参与者记录
      await db.collection('participants').doc(participantRecordId).update({
        data: updateData,
      });

      // 使用事务更新活动余量（确保读取和写入的原子性，避免并发问题）
      if (itemKey && activityId) {
        const transaction = db.startTransaction();
        try {
          const actDoc = await transaction.collection('activities').doc(activityId).get();
          const currentRemaining = (actDoc.data.remainingCounts || {})[itemKey];
          if (currentRemaining !== undefined && currentRemaining !== null) {
            if (currentRemaining <= 0) {
              await transaction.rollback();
              return { success: false, error: '该项目余量已不足' };
            }
            const newRemaining = Math.max(0, currentRemaining - 1);
            await transaction.collection('activities').doc(activityId).update({
              data: { [`remainingCounts.${itemKey}`]: newRemaining },
            });
          }
          await transaction.commit();
        } catch (e) {
          await transaction.rollback();
          return { success: false, error: '更新余量失败，请重试' };
        }
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  if (action === 'cancelPickup') {
    // 取消领取：更新 participants 记录（置 confirmed=false）+ 原子递增 activities.remainingCounts
    try {
      const { itemKey, confirmedBy } = event;

      let updateData = {};
      if (itemKey) {
        const mapKey = `confirmations.${itemKey}`;
        updateData[`${mapKey}.confirmed`] = false;
        updateData[`${mapKey}.at`] = '';
        updateData[`${mapKey}.by`] = confirmedBy || '';
        if (itemKey === 'tea') {
          updateData.teaConfirmed = false;
          updateData.teaConfirmedAt = '';
          updateData.teaConfirmedBy = confirmedBy || '';
        } else if (itemKey === 'gift') {
          updateData.giftConfirmed = false;
          updateData.giftConfirmedAt = '';
          updateData.giftConfirmedBy = confirmedBy || '';
        }
      }

      let participantRecordId = null;
      if (participantId) {
        participantRecordId = participantId;
      } else if (activityId && staffId) {
        const { data } = await db.collection('participants')
          .where({ activityId, staffId })
          .limit(1)
          .get();
        if (data.length > 0) {
          participantRecordId = data[0]._id;
        }
      }

      if (participantRecordId) {
        await db.collection('participants').doc(participantRecordId).update({
          data: updateData,
        });
      }

      // 使用事务递增活动余量（确保读取和写入的原子性，避免并发问题）
      if (itemKey && activityId) {
        const transaction = db.startTransaction();
        try {
          const actDoc = await transaction.collection('activities').doc(activityId).get();
          const currentRemaining = (actDoc.data.remainingCounts || {})[itemKey];
          if (currentRemaining !== undefined && currentRemaining !== null) {
            const total = (actDoc.data.confirmItems || []).find(c => c.key === itemKey)?.total;
            const newRemaining = Math.min(total !== undefined ? total : currentRemaining + 1, currentRemaining + 1);
            await transaction.collection('activities').doc(activityId).update({
              data: { [`remainingCounts.${itemKey}`]: newRemaining },
            });
          }
          await transaction.commit();
        } catch (e) {
          await transaction.rollback();
          return { success: false, error: '更新余量失败，请重试' };
        }
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  if (action === 'getUserInfo') {
    // 根据 staffId 查询用户详细信息
    try {
      const { staffId } = event;
      if (!staffId) return { success: false, error: '缺少 staffId' };

      const { data } = await db.collection('users')
        .where({ staffId })
        .limit(1)
        .get();

      return {
        success: true,
        user: data.length > 0 ? data[0] : null,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  return { success: false, error: 'Unknown action' };
};
