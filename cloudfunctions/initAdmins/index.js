// 云函数：initAdmins
// 用途：一次性初始化 administrators 集合，录入管理员工号
// 使用方法：在微信开发者工具右键上传并部署，然后在云函数面板手动触发一次即可

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// ============================================================
// ✏️  在下方 ADMINS 数组里填入你的管理员名单
// 字段说明：
//   staffId  - 8位工号（必填，唯一）
//   name     - 姓名（推荐填写，登录后顶部展示）
//   dept     - 部门（可选）
//   role     - 角色：admin（超级管理员）/ operator（操作员）
// ============================================================
const ADMINS = [
  { staffId: '43334382', name: '管理员',   dept: '行政部', role: 'admin' },
  // 在下方继续添加，例如：
  // { staffId: '12345678', name: '张伟',   dept: '技术部', role: 'operator' },
  // { staffId: '87654321', name: '李娜',   dept: '行政部', role: 'operator' },
];

exports.main = async (event, context) => {
  const col = db.collection('administrators');
  const results = { added: [], skipped: [], errors: [] };

  for (const admin of ADMINS) {
    try {
      // 检查工号是否已存在，避免重复插入
      const { total } = await col.where({ staffId: admin.staffId }).count();

      if (total > 0) {
        results.skipped.push(admin.staffId);
        continue;
      }

      await col.add({
        data: {
          ...admin,
          createdAt: db.serverDate(),
        },
      });
      results.added.push(admin.staffId);
    } catch (err) {
      results.errors.push({ staffId: admin.staffId, error: err.message });
    }
  }

  console.log('初始化完成：', results);
  return {
    success: true,
    message: `新增 ${results.added.length} 条，跳过 ${results.skipped.length} 条，失败 ${results.errors.length} 条`,
    details: results,
  };
};
