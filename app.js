App({
  globalData: {
    activities: [],
    currentUser: null,  // { staffId, name, dept }
    cloudEnvId: 'your-env-id', // 替换为你的云开发环境 ID
  },

  onLaunch() {
    // 初始化云开发
    if (wx.cloud) {
      wx.cloud.init({
        env: this.globalData.cloudEnvId,
        traceUser: true,
      });
    } else {
      console.error('请使用 2.2.3 以上的基础库版本');
    }

    // 初始化活动数据（后续可改为云数据库读取）
    this.globalData.activities = require('./utils/mockData').activities;

    // 恢复登录态
    const userInfo = wx.getStorageSync('currentUser');
    if (userInfo) {
      this.globalData.currentUser = userInfo;
    }
  },

  // 退出登录
  logout() {
    this.globalData.currentUser = null;
    wx.removeStorageSync('currentUser');
    wx.reLaunch({ url: '/pages/login/login' });
  }
});
