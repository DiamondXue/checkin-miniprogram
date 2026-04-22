// 云函数：initUsers
// 用途：初始化 users 集合，录入所有用户（管理员 + 普通用户）
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
//   role     - 角色：admin（管理员）/ user（普通用户，默认）
// ============================================================
const USERS = [
  { staffId: '43334382', name: '管理员',   dept: '行政部', role: 'admin' },
  // 在下方继续添加普通用户，例如：
  // { staffId: '10000001', name: '张伟', dept: '研发部', role: 'user' },
  // { staffId: '10000002', name: '李娜', dept: '产品部', role: 'user' },
  // { staffId: '10000003', name: '王芳', dept: '设计部', role: 'user' },
  // { staffId: '10000004', name: '刘洋', dept: '研发部', role: 'user' },
  // { staffId: '10000005', name: '陈静', dept: '运营部', role: 'user' },
  // { staffId: '10000006', name: '赵磊', dept: '销售部', role: 'user' },
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
          ...user,
          role: user.role || 'user',
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
