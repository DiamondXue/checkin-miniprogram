const app = getApp();

Page({
  data: {
    ongoingList: [],
    upcomingList: [],
    endedList: [],
    ongoingCount: 0,
    upcomingCount: 0,
    totalActivities: 0,
    currentUser: null,
  },

  onShow() {
    // 未登录跳转到登录页
    if (!app.globalData.currentUser) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    this.setData({ currentUser: app.globalData.currentUser });
    // 每次显示页面时刷新数据（签到后返回列表需要更新进度）
    this.loadActivities();
  },

  // 退出登录
  doLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确认退出当前账号？',
      success: (res) => {
        if (res.confirm) app.logout();
      }
    });
  },

  loadActivities() {
    const activities = app.globalData.activities || [];
    const ongoing = activities.filter(a => a.status === 'ongoing');
    const upcoming = activities.filter(a => a.status === 'upcoming');
    const ended = activities.filter(a => a.status === 'ended');

    this.setData({
      ongoingList: ongoing,
      upcomingList: upcoming,
      endedList: ended,
      ongoingCount: ongoing.length,
      upcomingCount: upcoming.length,
      totalActivities: activities.length,
    });
  },

  goToDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/detail/detail?id=${id}`
    });
  }
});
