App({
  globalData: {
    activities: []
  },
  onLaunch() {
    // 初始化全局活动数据（实际项目可替换为 API 请求）
    this.globalData.activities = require('./utils/mockData').activities;
  }
});
