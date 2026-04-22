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
    isAdmin: false,
    loading: true,
  },

  onShow() {
    if (!app.globalData.currentUser) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    const user = app.globalData.currentUser;
    this.setData({
      currentUser: user,
      isAdmin: user.role === 'admin',
    });
    this.loadActivities();
  },

  doLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确认退出当前账号？',
      success: (res) => {
        if (res.confirm) app.logout();
      }
    });
  },

  async loadActivities() {
    this.setData({ loading: true });
    const db = wx.cloud.database();
    const user = app.globalData.currentUser;
    let activities = [];

    try {
      if (this.data.isAdmin) {
        // 管理员：加载所有活动
        const res = await db.collection('activities').orderBy('date', 'desc').get();
        activities = res.data;

        // 补充每个活动的签到统计
        const activityStats = await Promise.all(
          activities.map(async (act) => {
            try {
              // 签到子集合只能通过云函数查询（小程序端限制），先用 count 统计
              const _ = db.command;
              const pRes = await db.collection('activities')
                .doc(act._id)
                .collection('participants')
                .count();
              const cRes = await db.collection('activities')
                .doc(act._id)
                .collection('participants')
                .where({ checked: true })
                .count();
              return { ...act, totalCount: pRes.total, checkedCount: cRes.total };
            } catch (e) {
              return { ...act, totalCount: 0, checkedCount: 0 };
            }
          })
        );
        activities = activityStats;
      } else {
        // 普通用户：只加载自己参与的活动
        const _ = db.command;
        const res = await db.collection('activities')
          .where({
            participantStaffIds: user.staffId
          })
          .orderBy('date', 'desc')
          .get();
        activities = res.data;

        // 补充签到状态
        const activityStats = await Promise.all(
          activities.map(async (act) => {
            try {
              const _ = db.command;
              const pRes = await db.collection('activities')
                .doc(act._id)
                .collection('participants')
                .where({ staffId: user.staffId })
                .limit(1)
                .get();
              const myRecord = pRes.data[0] || {};
              return {
                ...act,
                myChecked: !!myRecord.checked,
                myCheckedAt: myRecord.checkedAt || '',
              };
            } catch (e) {
              return { ...act, myChecked: false, myCheckedAt: '' };
            }
          })
        );
        activities = activityStats;
      }

      // 计算状态分区
      const now = new Date();
      const todayStr = this._formatDate(now);
      const currentMinutes = now.getHours() * 60 + now.getMinutes();

      const ongoing = [];
      const upcoming = [];
      const ended = [];

      activities.forEach(act => {
        const status = this._getActivityStatus(act, todayStr, currentMinutes);
        act.status = status;
        if (status === 'ongoing') ongoing.push(act);
        else if (status === 'upcoming') upcoming.push(act);
        else ended.push(act);
      });

      this.setData({
        ongoingList: ongoing,
        upcomingList: upcoming,
        endedList: ended,
        ongoingCount: ongoing.length,
        upcomingCount: upcoming.length,
        totalActivities: activities.length,
        loading: false,
      });
    } catch (err) {
      console.error('加载活动失败', err);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败，请重试', icon: 'none' });
    }
  },

  // 计算活动状态
  _getActivityStatus(act, todayStr, currentMinutes) {
    if (!act.date) return 'upcoming';
    const actDate = act.date.replace(/-/g, '');

    if (actDate < todayStr) return 'ended';
    if (actDate > todayStr) return 'upcoming';

    // 当天：根据时间判断
    const [startH, startM] = (act.startTime || '00:00').split(':').map(Number);
    const [endH, endM] = (act.endTime || '23:59').split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (currentMinutes < startMinutes) return 'upcoming';
    if (currentMinutes > endMinutes) return 'ended';
    return 'ongoing';
  },

  _formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  },

  goToDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (this.data.isAdmin) {
      wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
    } else {
      wx.navigateTo({ url: `/pages/my-checkin/my-checkin?id=${id}` });
    }
  },

  onPullDownRefresh() {
    this.loadActivities().then(() => {
      wx.stopPullDownRefresh();
    });
  }
});
