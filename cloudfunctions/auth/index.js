// 云函数：auth
// 用途：登录链路的服务端校验，作为用户身份与角色的唯一可信来源
// action：
//   loginByStaff  { staffId }  工号登录，校验 users 集合
//   verifySession { staffId }  冷启动恢复登录态，校验工号 / 入场券是否仍然有效
// 返回：{ success, user } 或 { success: false, code, error }
// user 仅包含白名单字段：staffId / name / dept / roles / isTicket / activityId

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const STAFF_RE = /^\d{8}$/;
const TICKET_RE = /^[A-Z]\d{7}$/;

// 兼容历史数据：roles 数组 / 单值 role 字段
function normalizeRoles(doc) {
  const list = Array.isArray(doc.roles) ? doc.roles : (doc.role ? [doc.role] : ['user']);
  const roles = [];
  list.forEach((r) => {
    if (r && roles.indexOf(r) === -1) roles.push(r);
  });
  return roles;
}

// 按工号查询用户
// 历史数据可能存在同一 staffId 的重复记录：姓名/部门取 _id === staffId 的那条，
// roles 合并去重，避免重复记录导致管理员角色丢失
async function findStaff(staffId) {
  const { data } = await db.collection('users').where({ staffId }).limit(20).get();
  if (!data || data.length === 0) return null;

  const primary = data.find((u) => u._id === staffId) || data[0];
  const roles = [];
  data.forEach((u) => {
    normalizeRoles(u).forEach((r) => {
      if (roles.indexOf(r) === -1) roles.push(r);
    });
  });

  return {
    staffId,
    name: primary.name || '',
    dept: primary.dept || '',
    roles: roles.length ? roles : ['user'],
    isTicket: false,
    activityId: '',
  };
}

// 校验入场券：未作废、已绑定且活动仍存在
async function findTicket(ticketNo) {
  const { data } = await db.collection('tickets').where({ ticketNo }).limit(1).get();
  const ticket = data && data[0];
  if (!ticket) return null;
  if (ticket.revoked) return null;
  if (!ticket.activityId) return null;

  try {
    await db.collection('activities').doc(ticket.activityId).get();
  } catch (e) {
    return null;
  }

  return {
    staffId: ticketNo,
    name: ticketNo,
    dept: '',
    roles: ['ticket'],
    isTicket: true,
    activityId: ticket.activityId,
  };
}

async function resolveUser(staffId) {
  // 入场券与工号格式天然不冲突，身份类型由服务端按格式判定，不信任客户端传值
  if (TICKET_RE.test(staffId)) return findTicket(staffId);
  if (STAFF_RE.test(staffId)) return findStaff(staffId);
  return null;
}

exports.main = async (event = {}) => {
  const action = event.action;
  const staffId = String(event.staffId || '').trim().toUpperCase();

  if (action !== 'loginByStaff' && action !== 'verifySession') {
    return { success: false, code: 'UNKNOWN_ACTION', error: '未知操作' };
  }

  try {
    // 工号登录只接受 8 位数字工号
    if (action === 'loginByStaff' && !STAFF_RE.test(staffId)) {
      return { success: false, code: 'INVALID_FORMAT', error: '工号必须是 8 位数字' };
    }

    const user = await resolveUser(staffId);

    if (!user) {
      if (TICKET_RE.test(staffId)) {
        return { success: false, code: 'INVALID_TICKET', error: '入场券无效，请核对后重试' };
      }
      if (!STAFF_RE.test(staffId)) {
        return { success: false, code: 'INVALID_FORMAT', error: '工号必须是 8 位数字' };
      }
      return { success: false, code: 'NOT_FOUND', error: '工号未注册，请联系活动负责人添加' };
    }

    return { success: true, user };
  } catch (err) {
    console.error('auth 失败', action, staffId, err);
    return { success: false, code: 'SERVER_ERROR', error: '服务异常，请稍后重试' };
  }
};
