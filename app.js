App({
  globalData: {
    currentUser: null,  // { _id, staffId, name, dept, role }
    cloudEnvId: 'cloud1-d9gq1b47d1a6184ac',
  },

  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({
        env: this.globalData.cloudEnvId,
        traceUser: true,
      });
    } else {
      console.error('请使用 2.2.3 以上的基础库版本');
    }

    // 恢复登录态
    const userInfo = wx.getStorageSync('currentUser');
    if (userInfo) {
      this.globalData.currentUser = userInfo;
    }
  },

  // 判断当前用户是否是管理员
  isAdmin() {
    const user = this.globalData.currentUser;
    return user && user.role === 'admin';
  },

  // 退出登录
  logout() {
    this.globalData.currentUser = null;
    wx.removeStorageSync('currentUser');
    wx.reLaunch({ url: '/pages/login/login' });
  }
});
