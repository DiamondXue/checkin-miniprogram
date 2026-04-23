// 云函数：initActivities
// 用途：初始化 activities 集合 + participants 顶层集合
// 注意：participants 是独立顶层集合（非子集合），通过 activityId 关联
// 使用方法：编辑下方 ACTIVITIES 数组，右键上传部署，手动触发一次

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// ============================================================
// ✏️ 在下方 ACTIVITIES 数组里填入活动信息
// participantStaffIds: 参与者的工号列表，用于普通用户查询活动
// participants: 参与者详情，写入 participants 顶层集合
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
    creatorStaffId: '43334382',
    creatorName: 'Diamond',
    participantStaffIds: ['43334382', '43430068', '43334337'],
    participants: [
      { staffId: '43334382', name: 'Diamond', dept: 'IWPB' },
      { staffId: '43430068', name: 'Yuriko', dept: 'AMH' },
      { staffId: '43334337', name: 'Res',     dept: 'IWPB' },
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
  //   creatorName: 'Diamond',
  //   participantStaffIds: ['43334382', '43430068'],
  //   participants: [
  //     { staffId: '43334382', name: 'Diamond', dept: 'IWPB' },
  //     { staffId: '43430068', name: 'Yuriko', dept: 'AMH' },
  //   ],
  // },
];

exports.main = async (event, context) => {
  const actCol = db.collection('activities');
  const results = { added: [], skipped: [], errors: [] };

  for (const act of ACTIVITIES) {
    try {
      // 检查是否已存在同名同日期活动
      const { total } = await actCol.where({
        name: act.name,
        date: act.date,
      }).count();

      if (total > 0) {
        results.skipped.push(act.name);
        continue;
      }

      // 创建活动
      const { _id } = await actCol.add({
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

      // 写入 participants 顶层集合
      for (const p of (act.participants || [])) {
        await db.collection('participants').add({
          data: {
            activityId: _id,
            staffId: p.staffId,
            name: p.name,
            dept: p.dept || '',
            checked: false,
            checkedAt: '',
            createdAt: db.serverDate(),
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
