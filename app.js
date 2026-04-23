App({
  globalData: {
    currentUser: null,  // { _id, staffId, name, dept, roles }
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
    return user && Array.isArray(user.roles) && user.roles.includes('admin');
  },

  // 判断当前用户是否是活动创建人（organizer）
  isOrganizer() {
    const user = this.globalData.currentUser;
    return user && Array.isArray(user.roles) && user.roles.includes('organizer');
  },

  // 判断当前用户是否可以管理某个活动
  // admin 可以管理所有活动，organizer 只能管理自己创建的
  canManageActivity(activity) {
    if (this.isAdmin()) return true;
    if (this.isOrganizer() && activity && activity.creatorStaffId === this.globalData.currentUser.staffId) {
      return true;
    }
    return false;
  },

  // 退出登录
  logout() {
    this.globalData.currentUser = null;
    wx.removeStorageSync('currentUser');
    wx.reLaunch({ url: '/pages/login/login' });
  }
});
