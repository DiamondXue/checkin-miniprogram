App({
  globalData: {
    currentUser: null,  // { _id, staffId, name, dept, roles }
    pendingActivityId: null,  // 登录后待跳转的活动ID
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

    // 强制更新检查
    if (wx.canIUse('getUpdateManager')) {
      const updateManager = wx.getUpdateManager();
      updateManager.onCheckForUpdate((res) => {
        if (res.hasUpdate) {
          console.log('发现新版本');
        }
      });
      updateManager.onUpdateReady(() => {
        wx.showModal({
          title: '版本更新',
          content: '新版本已就绪，点击确定重启应用',
          showCancel: false,
          success: () => {
            updateManager.applyUpdate();
          },
        });
      });
      updateManager.onUpdateFailed(() => {
        console.warn('新版本下载失败');
      });
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

  // 判断当前用户是否是活动操作员（operator）
  // operator 可以查看和管理所有活动的参与者，可以编辑活动，但不能删除
  isOperator() {
    const user = this.globalData.currentUser;
    return user && Array.isArray(user.roles) && user.roles.includes('operator');
  },

  // 判断当前用户是否可以管理某个活动
  // admin      → 管理所有活动（含删除）
  // operator   → 管理所有活动（不含删除）
  // organizer   → 仅管理自己创建的活动
  canManageActivity(activity) {
    if (this.isAdmin() || this.isOperator()) return true;
    if (this.isOrganizer() && activity && activity.creatorStaffId === this.globalData.currentUser.staffId) {
      return true;
    }
    return false;
  },

  // 判断当前用户是否可以删除活动（仅 admin）
  canDeleteActivity() {
    return this.isAdmin();
  },

  // 退出登录
  logout() {
    this.globalData.currentUser = null;
    this.globalData.pendingActivityId = null;
    wx.removeStorageSync('currentUser');
    wx.reLaunch({ url: '/pages/login/login' });
  }
});
