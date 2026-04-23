// 云函数：initUsers
// 用途：初始化 users 集合，录入所有用户（管理员 + 活动创建人 + 普通用户）
// 使用方法：编辑下方 USERS 数组，右键上传部署，手动触发一次

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// ============================================================
// ✏️ 在下方 USERS 数组里填入用户信息
// 字段说明：
//   staffId  - 8位工号（必填，唯一）
//   name     - 姓名（必填）
//   dept     - 部门（可选）
//   roles    - 角色数组（默认 ['user']），可叠加多个角色：
//              admin（管理员）/ organizer（活动创建人）/ user（普通成员）
//              例：roles: ['admin', 'organizer'] 表示同时是管理员和活动创建人
// ============================================================
const USERS = [
  { staffId: '43334382', name: 'Diamond', dept: 'IWPB', roles: ['admin', 'organizer'] },
  { staffId: '43430068', name: 'Yuriko', dept: 'AMH' },                         // 默认 ['user']
  { staffId: '43334337', name: 'Res',     dept: 'IWPB' },                       // 默认 ['user']
];

exports.main = async (event, context) => {
  const col = db.collection('users');
  const results = { added: [], skipped: [], errors: [] };

  for (const user of USERS) {
    try {
      const { total } = await col.where({ staffId: user.staffId }).count();
      if (total > 0) {
        results.skipped.push(user.staffId);
        continue;
      }
      await col.add({
        data: {
          staffId: user.staffId,
          name: user.name,
          dept: user.dept || '',
          roles: Array.isArray(user.roles) ? user.roles : (user.role ? [user.role] : ['user']),
          createdAt: db.serverDate(),
        },
      });
      results.added.push(user.staffId);
    } catch (err) {
      results.errors.push({ staffId: user.staffId, error: err.message });
    }
  }

  console.log('初始化完成：', results);
  return {
    success: true,
    message: `新增 ${results.added.length} 条，跳过 ${results.skipped.length} 条，失败 ${results.errors.length} 条`,
    details: results,
  };
};
