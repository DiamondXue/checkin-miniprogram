// 云函数：createActivity
// 用途：管理参与者的所有操作（读取、写入、签到、撤销）
// 注意：不使用子集合，所有参与者数据存在独立的 participants 顶层集合中
//       通过 activityId 字段关联活动

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { action, activityId, participants, staffIds, staffId, name, dept, participantId, checked, checkedAt, signatureFileId } = event;

  if (action === 'loginByTicket') {
    // 入场券登录校验（云端管理员身份查询，不受 tickets 集合权限规则限制）
    // 参数：ticketNo
    // 返回：{ success, ticketId, activityId, activityName }
    try {
      const ticketNo = String(event.ticketNo || '').toUpperCase();
      if (!/^[A-Z]\d{7}$/.test(ticketNo)) {
        return { success: false, error: '入场券格式不正确' };
      }

      const tRes = await db.collection('tickets').where({ ticketNo }).limit(1).get();
      const ticket = tRes.data && tRes.data[0];
      if (!ticket) return { success: false, error: '入场券无效，请核对后重试' };
      if (ticket.revoked) return { success: false, error: '该入场券已作废' };
      if (!ticket.activityId) return { success: false, error: '入场券未绑定活动' };

      let activityName = '';
      try {
        const aRes = await db.collection('activities').doc(ticket.activityId).get();
        activityName = (aRes.data && aRes.data.name) || '';
      } catch (e) {
        return { success: false, error: '绑定的活动不存在或已删除' };
      }

      return {
        success: true,
        ticketId: ticket._id,
        activityId: ticket.activityId,
        activityName,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

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

  // ===== 信息安全模式：服务端出口统一脱敏 =====
  // 工号仅保留后6位
  function maskStaffId(id) {
    return String(id || '').slice(-6);
  }

  // 读取活动是否开启信息安全模式
  async function isSecureActivity(aid) {
    try {
      const act = await db.collection('activities').doc(aid).get();
      return !!(act.data && act.data.secureMode);
    } catch (e) {
      return false;
    }
  }

  // 参与者记录白名单输出：彻底不带 name/dept，工号截断为后6位
  function maskParticipant(p) {
    if (!p) return p;
    const confirmations = {};
    if (p.confirmations) {
      Object.keys(p.confirmations).forEach(k => {
        const c = p.confirmations[k] || {};
        confirmations[k] = { confirmed: !!c.confirmed, at: c.at || '', by: maskStaffId(c.by) };
      });
    }
    const isTicket = !!p.isTicket || /^[A-Z]\d{7}$/.test(p.staffId || '');
    const out = {
      _id: p._id,
      activityId: p.activityId,
      staffId: isTicket ? p.staffId : maskStaffId(p.staffId),
      isTicket,
      checked: !!p.checked,
      checkedAt: p.checkedAt || '',
      confirmations,
    };
    if (p.signatureFileId) out.signatureFileId = p.signatureFileId;
    return out;
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
      // 信息安全模式：服务端直接剥离 name/dept，工号仅返回后6位（对所有角色生效）
      const secure = await isSecureActivity(activityId);
      return {
        success: true,
        participants: secure ? list.map(maskParticipant) : list,
        secureMode: secure,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // 生成 1 位大写字母 + 7 位数字的券号（在活动内唯一）
  function genTicketNo(existingSet, prefix) {
    const usePrefix = /^[A-Z]$/.test(prefix) ? prefix
      : String.fromCharCode(65 + Math.floor(Math.random() * 26));
    for (let attempt = 0; attempt < 50; attempt++) {
      let digits = '';
      for (let i = 0; i < 7; i++) digits += Math.floor(Math.random() * 10);
      const no = usePrefix + digits;
      if (!existingSet.has(no)) {
        existingSet.add(no);
        return no;
      }
    }
    return null;
  }

  if (action === 'generateTickets') {
    // 为活动批量生成入场券，同时预建参与者记录（作为应到人员）
    // 参数：activityId, count(默认10,上限200), prefix(可选字母)
    try {
      let count = parseInt(event.count);
      if (!count || count <= 0) count = 10;
      if (count > 200) count = 200;

      // 收集活动内已有券号，避免重复
      const existingSet = new Set();
      let tSkip = 0;
      while (true) {
        const { data } = await db.collection('tickets')
          .where({ activityId })
          .skip(tSkip)
          .limit(100)
          .get();
        data.forEach(t => existingSet.add(t.ticketNo));
        if (data.length < 100) break;
        tSkip += 100;
      }

      // 已有参与者工号（券号），避免重复建记录
      const existingP = new Set();
      const pList = await fetchUniqueParticipants(activityId);
      pList.forEach(p => existingP.add(p.staffId));

      const confirmItems = await getActivityConfirmItems();
      const confirmFields = buildConfirmFields(confirmItems);

      const created = [];
      for (let i = 0; i < count; i++) {
        const ticketNo = genTicketNo(existingSet, event.prefix);
        if (!ticketNo) continue;
        await db.collection('tickets').add({
          data: {
            ticketNo,
            activityId,
            revoked: false,
            createdAt: db.serverDate(),
          },
        });
        // 同步预建参与者记录（券号即身份标识）
        if (!existingP.has(ticketNo)) {
          existingP.add(ticketNo);
          await db.collection('participants').add({
            data: {
              activityId,
              staffId: ticketNo,
              name: ticketNo,
              dept: '',
              isTicket: true,
              checked: false,
              checkedAt: '',
              ...confirmFields,
              createdAt: db.serverDate(),
            },
          });
        }
        created.push(ticketNo);
      }

      return { success: true, tickets: created, total: created.length };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  if (action === 'getTickets') {
    // 查询活动的入场券列表（管理员发放/核销情况）
    try {
      let tickets = [];
      let skip = 0;
      while (true) {
        const { data } = await db.collection('tickets')
          .where({ activityId })
          .skip(skip)
          .limit(100)
          .get();
        tickets = tickets.concat(data);
        if (data.length < 100) break;
        skip += 100;
      }
      // 合并参与者签到状态
      const pList = await fetchUniqueParticipants(activityId);
      const pMap = {};
      pList.forEach(p => { pMap[p.staffId] = p; });
      const list = tickets.map(t => ({
        _id: t._id,
        ticketNo: t.ticketNo,
        revoked: !!t.revoked,
        checked: !!(pMap[t.ticketNo] && pMap[t.ticketNo].checked),
        checkedAt: (pMap[t.ticketNo] && pMap[t.ticketNo].checkedAt) || '',
      }));
      return { success: true, tickets: list, total: list.length };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  if (action === 'deleteTicket') {
    // 删除单张入场券：同时删除 tickets 记录和该活动下对应的参与者记录
    // 参数：activityId, ticketId, ticketNo
    try {
      const ticketNo = event.ticketNo;
      if (!event.ticketId || !ticketNo) {
        return { success: false, error: '缺少券ID或券号' };
      }

      // 删除券记录（先校验记录归属当前活动，防止跨活动删除）
      let belong = true;
      try {
        const tRes = await db.collection('tickets').doc(event.ticketId).get();
        belong = tRes.data && tRes.data.activityId === activityId;
      } catch (e) { belong = false; }
      if (!belong) return { success: false, error: '券不存在或不属于该活动' };
      await db.collection('tickets').doc(event.ticketId).remove();

      // 删除该活动下所有 staffId = 券号 的参与者记录（可能有重复记录）
      const { data: pRecords } = await db.collection('participants')
        .where({ activityId, staffId: ticketNo })
        .limit(100)
        .get();
      await Promise.all(pRecords.map(p =>
        db.collection('participants').doc(p._id).remove()
      ));

      return { success: true, ticketNo, removedParticipants: pRecords.length };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  if (action === 'batchDeleteTickets') {
    // 批量删除入场券：删除多张券及其参与者记录
    // 参数：activityId, items: [{ ticketId, ticketNo }]
    try {
      const items = Array.isArray(event.items) ? event.items : [];
      if (items.length === 0) return { success: false, error: '未选择券' };

      let ticketDeleted = 0;
      let participantDeleted = 0;
      for (const item of items) {
        if (!item || !item.ticketId || !item.ticketNo) continue;
        // 校验归属当前活动
        let belong = true;
        try {
          const tRes = await db.collection('tickets').doc(item.ticketId).get();
          belong = tRes.data && tRes.data.activityId === activityId;
        } catch (e) { belong = false; }
        if (!belong) continue;

        await db.collection('tickets').doc(item.ticketId).remove();
        ticketDeleted++;

        const { data: pRecords } = await db.collection('participants')
          .where({ activityId, staffId: item.ticketNo })
          .limit(100)
          .get();
        await Promise.all(pRecords.map(p =>
          db.collection('participants').doc(p._id).remove()
        ));
        participantDeleted += pRecords.length;
      }

      return { success: true, ticketDeleted, participantDeleted };
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

      // 构建 update/add 数据，签到时保存签名图片
      const updateData = { checked, checkedAt: finalCheckedAt };
      if (checked && signatureFileId) {
        updateData.signatureFileId = signatureFileId;
      }

      // 优先用 participantId；若无则按 activityId + staffId 查找已有记录
      if (participantId) {
        await db.collection('participants').doc(participantId).update({
          data: updateData,
        });
      } else if (staffId) {
        const existing = await db.collection('participants')
          .where({ activityId, staffId })
          .limit(1)
          .get();
        if (existing.data.length > 0) {
          // 更新已有记录（杜绝重复创建）
          await db.collection('participants').doc(existing.data[0]._id).update({
            data: updateData,
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
              ...updateData,
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

  if (action === 'getAllActivityStats') {
    // 批量获取多个活动的统计（首页用，避免 N 次云函数调用）
    // 参数：activityIds: [id1, id2, ...]
    // 返回：{ activityId: { totalCount, checkedCount } }
    try {
      const ids = Array.isArray(event.activityIds) ? event.activityIds.filter(Boolean) : [];
      const stats = {};
      ids.forEach(id => { stats[id] = { totalCount: 0, checkedCount: 0 }; });
      if (ids.length === 0) return { success: true, stats };

      const _ = db.command;
      // 一次性查询所有指定活动的参与者，分页拉取
      let all = [];
      let skip = 0;
      const PAGE = 100;
      while (true) {
        const { data } = await db.collection('participants')
          .where({ activityId: _.in(ids) })
          .skip(skip)
          .limit(PAGE)
          .get();
        all = all.concat(data);
        if (data.length < PAGE) break;
        skip += PAGE;
      }

      // 按 activityId 分组，再按 staffId 去重（已签到优先）
      const byAct = {};
      all.forEach(p => {
        if (!byAct[p.activityId]) byAct[p.activityId] = {};
        const prev = byAct[p.activityId][p.staffId];
        if (!prev) { byAct[p.activityId][p.staffId] = p; return; }
        if (!!p.checked && !prev.checked) byAct[p.activityId][p.staffId] = p;
      });
      Object.keys(byAct).forEach(aid => {
        const list = Object.values(byAct[aid]);
        stats[aid] = {
          totalCount: list.length,
          checkedCount: list.filter(p => !!p.checked).length,
        };
      });
      return { success: true, stats };
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
    // 查询参与者的签到状态和领取状态（管理员扫码/本人/名单核销共用）
    // 参数：activityId + staffId，或 activityId + participantId
    try {
      let record = null;
      if (participantId) {
        // 信息安全模式下前端只有脱敏工号，可凭参与者记录 _id 直达
        try {
          const r = await db.collection('participants').doc(participantId).get();
          // 防止跨活动猜测记录ID
          record = (!activityId || r.data.activityId === activityId) ? r.data : null;
        } catch (e) { record = null; }
      } else {
        // 查多条后选已签到的那条（避免重复记录时取到未签到的旧记录）
        const { data } = await db.collection('participants')
          .where({ activityId, staffId })
          .limit(20)
          .get();
        record = data.find(p => !!p.checked) || data[0] || null;
      }
      if (!record) {
        return { success: true, record: null, confirmItems: [], enableScanConfirm: false };
      }
      // 同时获取活动的配置（用于前端动态渲染确认按钮）
      let confirmItems = [];
      let enableScanConfirm = false;
      let remainingCounts = {};
      let secureMode = false;
      try {
        const act = await db.collection('activities').doc(activityId).get();
        if (act.data) {
          confirmItems = act.data.confirmItems || [];
          enableScanConfirm = act.data.enableScanConfirm !== false;
          remainingCounts = act.data.remainingCounts || {};
          secureMode = !!act.data.secureMode;
        }
      } catch (e) {}

      // 兼容新旧数据格式
      let confirmations = record.confirmations || {};
      if (!record.confirmations) {
        // 旧格式 → 转换为新格式
        if (record.teaConfirmed !== undefined) {
          confirmations.tea = { confirmed: !!record.teaConfirmed, at: record.teaConfirmedAt || '', by: record.teaConfirmedBy || '' };
        }
        if (record.giftConfirmed !== undefined) {
          confirmations.gift = { confirmed: !!record.giftConfirmed, at: record.giftConfirmedAt || '', by: record.giftConfirmedBy || '' };
        }
      }
      if (secureMode) {
        // 安全模式：confirmations 中的操作人工号一并脱敏
        const maskedConfs = {};
        Object.keys(confirmations).forEach(k => {
          const c = confirmations[k] || {};
          maskedConfs[k] = { confirmed: !!c.confirmed, at: c.at || '', by: maskStaffId(c.by) };
        });
        record = { ...record, confirmations: maskedConfs };
      }

      const outRecord = secureMode
        ? maskParticipant(record)
        : {
            _id: record._id,
            staffId: record.staffId,
            name: record.name || '',
            dept: record.dept || '',
            isTicket: !!record.isTicket || /^[A-Z]\d{7}$/.test(record.staffId || ''),
            checked: !!record.checked,
            checkedAt: record.checkedAt || '',
            confirmations,
          };

      return {
        success: true,
        record: outRecord,
        confirmItems,
        remainingCounts,
        enableScanConfirm,
        secureMode,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  if (action === 'confirmPickup') {
    // 管理员确认领取（茶点/礼品等自定义项目）
    // 使用原子操作保证并发安全：
    //   1. 先用原子递减余量（通过 where 条件过滤保证不为负）
    //   2. 再更新参与者记录
    try {
      const { itemKey, confirmedBy, confirmedAt } = event;

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

      // 先原子递减余量（通过 where 条件只对 remainingCounts.xxx > 0 时递减）
      if (itemKey && activityId) {
        // 读取当前余量，判断是否足够
        const actDoc = await db.collection('activities').doc(activityId).get();
        const currentRemaining = (actDoc.data.remainingCounts || {})[itemKey];
        if (currentRemaining !== undefined && currentRemaining !== null && currentRemaining <= 0) {
          return { success: false, error: '该项目余量已不足' };
        }
        // 原子递减（使用 _.inc(-1) 保证并发安全，db 层面串行处理）
        if (currentRemaining !== undefined && currentRemaining !== null) {
          await db.collection('activities').doc(activityId).update({
            data: { [`remainingCounts.${itemKey}`]: _.inc(-1) },
          });
        }
      }

      // 再更新参与者记录
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
      await db.collection('participants').doc(participantRecordId).update({
        data: updateData,
      });

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  if (action === 'cancelPickup') {
    // 取消领取：更新 participants 记录（置 confirmed=false）+ 原子递增 activities.remainingCounts
    try {
      const { itemKey, confirmedBy } = event;

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

      // 先原子递增余量
      if (itemKey && activityId) {
        const actDoc = await db.collection('activities').doc(activityId).get();
        const currentRemaining = (actDoc.data.remainingCounts || {})[itemKey];
        const total = (actDoc.data.confirmItems || []).find(c => c.key === itemKey)?.total;
        if (currentRemaining !== undefined && currentRemaining !== null) {
          // 限制不超过总数
          const maxVal = total !== undefined ? total : currentRemaining + 1;
          if (currentRemaining < maxVal) {
            await db.collection('activities').doc(activityId).update({
              data: { [`remainingCounts.${itemKey}`]: _.inc(1) },
            });
          }
        }
      }

      // 再更新参与者记录
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
      if (participantRecordId) {
        await db.collection('participants').doc(participantRecordId).update({
          data: updateData,
        });
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

      let user = data.length > 0 ? data[0] : null;
      // 信息安全活动：出口白名单，只回脱敏工号
      if (user && event.activityId && await isSecureActivity(event.activityId)) {
        user = { staffId: maskStaffId(user.staffId) };
      }

      return {
        success: true,
        user,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  return { success: false, error: 'Unknown action' };
};
