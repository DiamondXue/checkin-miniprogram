/**
 * Mock 数据 - 实际项目中替换为 API 请求
 * 数据结构说明：
 * - activities: 活动列表
 * - participants: 每个活动的参与者名单
 */

const activities = [
  {
    id: 'act001',
    name: '2026 Q2 团建 · 户外拓展',
    location: '广州市从化区流溪河国家森林公园',
    latitude: 23.7486,   // 活动地点纬度
    longitude: 113.5833, // 活动地点经度
    checkinRadius: 500,  // 签到有效半径（米），0 表示不限制
    date: '2026-04-19',
    startTime: '09:00',
    endTime: '18:00',
    status: 'ongoing', // ongoing | upcoming | ended
    organizer: '行政部',
    totalCount: 6,
    checkedCount: 0,
    participants: [
      { id: 'p001', name: '张伟', dept: '研发部', phone: '138****0001', checked: false },
      { id: 'p002', name: '李娜', dept: '产品部', phone: '138****0002', checked: false },
      { id: 'p003', name: '王芳', dept: '设计部', phone: '138****0003', checked: false },
      { id: 'p004', name: '刘洋', dept: '研发部', phone: '138****0004', checked: false },
      { id: 'p005', name: '陈静', dept: '运营部', phone: '138****0005', checked: false },
      { id: 'p006', name: '赵磊', dept: '销售部', phone: '138****0006', checked: false },
    ]
  },
  {
    id: 'act002',
    name: '新员工欢迎晚宴',
    location: '广州市天河区粤菜私房餐厅·星汇云锦店',
    latitude: 23.1327,
    longitude: 113.3276,
    checkinRadius: 300,
    date: '2026-04-19',
    startTime: '18:30',
    endTime: '21:00',
    status: 'upcoming',
    organizer: 'HR 部门',
    totalCount: 4,
    checkedCount: 0,
    participants: [
      { id: 'p007', name: '孙悦', dept: '研发部', phone: '139****0007', checked: false },
      { id: 'p008', name: '周晨', dept: '产品部', phone: '139****0008', checked: false },
      { id: 'p009', name: '吴昊', dept: '市场部', phone: '139****0009', checked: false },
      { id: 'p010', name: '郑敏', dept: '财务部', phone: '139****0010', checked: false },
    ]
  },
  {
    id: 'act003',
    name: '季度总结分享会',
    location: '公司 3 楼多功能厅',
    latitude: 23.1291,
    longitude: 113.2644,
    checkinRadius: 200,
    date: '2026-04-18',
    startTime: '14:00',
    endTime: '17:00',
    status: 'ended',
    organizer: '总裁办',
    totalCount: 3,
    checkedCount: 3,
    participants: [
      { id: 'p011', name: '黄晓', dept: '全体', phone: '137****0011', checked: true, checkedAt: '14:02' },
      { id: 'p012', name: '林峰', dept: '全体', phone: '137****0012', checked: true, checkedAt: '14:05' },
      { id: 'p013', name: '徐丽', dept: '全体', phone: '137****0013', checked: true, checkedAt: '14:08' },
    ]
  }
];

module.exports = { activities };
