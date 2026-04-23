// 云函数：initActivities
// 用途：初始化 activities 集合及子集合 participants
// 使用方法：编辑下方 ACTIVITIES 数组，右键上传部署，手动触发一次

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// ============================================================
// ✏️ 在下方 ACTIVITIES 数组里填入活动信息
// participantStaffIds: 参与者的工号列表，用于普通用户查询
// participants: 参与者详情，会写入 activities/{_id}/participants 子集合
// ============================================================
const ACTIVITIES = [
  {
    name: '2026 Q2 团建 · 户外拓展',
    location: '广州市从化区流溪河国家森林公园',
    latitude: 23.7486,
    longitude: 113.5833,
    checkinRadius: 500,
    date: '2026-04-25',
    startTime: '09:00',
    endTime: '18:00',
    organizer: '行政部',
    creatorStaffId: '43334382',   // 创建人工号（手动指定或由小程序自动填入）
    creatorName: '管理员',         // 创建人姓名
    participantStaffIds: ['43334382', '10000001', '10000002', '10000003', '10000004', '10000005'],
    participants: [
      { staffId: '43334382', name: '管理员', dept: '行政部' },
      { staffId: '10000001', name: '张伟',   dept: '研发部' },
      { staffId: '10000002', name: '李娜',   dept: '产品部' },
      { staffId: '10000003', name: '王芳',   dept: '设计部' },
      { staffId: '10000004', name: '刘洋',   dept: '研发部' },
      { staffId: '10000005', name: '陈静',   dept: '运营部' },
    ],
  },
  // 继续添加活动，例如：
  // {
  //   name: '新员工欢迎晚宴',
  //   location: '广州市天河区粤菜私房餐厅',
  //   latitude: 23.1327,
  //   longitude: 113.3276,
  //   checkinRadius: 300,
  //   date: '2026-04-30',
  //   startTime: '18:30',
  //   endTime: '21:00',
  //   organizer: 'HR 部门',
  //   creatorStaffId: '43334382',
  //   creatorName: '管理员',
  //   participantStaffIds: ['10000001', '10000002', '10000003'],
  //   participants: [
  //     { staffId: '10000001', name: '张伟', dept: '研发部' },
  //     { staffId: '10000002', name: '李娜', dept: '产品部' },
  //     { staffId: '10000003', name: '王芳', dept: '设计部' },
  //   ],
  // },
];

exports.main = async (event, context) => {
  const col = db.collection('activities');
  const results = { added: [], skipped: [], errors: [] };

  for (const act of ACTIVITIES) {
    try {
      // 检查是否已存在同名同日期活动
      const { total } = await col.where({
        name: act.name,
        date: act.date,
      }).count();

      if (total > 0) {
        results.skipped.push(act.name);
        continue;
      }

      // 创建活动
      const { _id } = await col.add({
        data: {
          name: act.name,
          location: act.location,
          latitude: act.latitude || null,
          longitude: act.longitude || null,
          checkinRadius: act.checkinRadius || 0,
          date: act.date,
          startTime: act.startTime,
          endTime: act.endTime,
          organizer: act.organizer,
          creatorStaffId: act.creatorStaffId || '',
          creatorName: act.creatorName || '',
          participantStaffIds: act.participantStaffIds || [],
          createdAt: db.serverDate(),
        },
      });

      // 写入参与者子集合
      const pCol = db.collection('activities').doc(_id).collection('participants');
      for (const p of (act.participants || [])) {
        await pCol.add({
          data: {
            staffId: p.staffId,
            name: p.name,
            dept: p.dept || '',
            checked: false,
            checkedAt: '',
          },
        });
      }

      results.added.push(`${act.name} (${act.participants ? act.participants.length : 0}人)`);
    } catch (err) {
      results.errors.push({ name: act.name, error: err.message });
    }
  }

  console.log('活动初始化完成：', results);
  return {
    success: true,
    message: `新增 ${results.added.length} 个活动，跳过 ${results.skipped.length} 个，失败 ${results.errors.length} 个`,
    details: results,
  };
};
