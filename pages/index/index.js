const app = getApp();
const { cstDateStr, cstTotalMinutes } = require('../../utils/china-time');

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
    isOperator: false,
    isOrganizer: false,
    canCreate: false,
    loading: true,
  },

  onShow() {
    if (!app.globalData.currentUser) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    const user = app.globalData.currentUser;
    const roles = Array.isArray(user.roles) ? user.roles : (user.role ? [user.role] : ['user']);
    // 入场券用户只能进入其绑定活动
    if (roles.includes('ticket')) {
      if (user.activityId) {
        wx.reLaunch({ url: `/pages/my-checkin/my-checkin?id=${user.activityId}` });
      } else {
        app.logout();
      }
      return;
    }
    const isAdmin = roles.includes('admin');
    const isOperator = roles.includes('operator');
    const isOrganizer = roles.includes('organizer');
    const canCreate = isAdmin || isOrganizer;

    this.setData({
      currentUser: user,
      isAdmin,
      isOperator,
      isOrganizer,
      canCreate,
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

    // 提前计算当前中国标准时间，用于状态判断与过滤
    const todayStr = cstDateStr();
    const currentMinutes = cstTotalMinutes();

    try {
      if (this.data.isAdmin || this.data.isOperator) {
        // 管理员/操作员：加载所有活动
        const res = await db.collection('activities').orderBy('date', 'desc').get();
        activities = res.data;

        // 一次性批量获取所有活动的统计（替代 N 次独立云函数调用）
        await this._fillStatsBatch(activities);
      } else if (this.data.isOrganizer) {
        // 活动创建人：加载自己创建的活动
        const res = await db.collection('activities')
          .where({ creatorStaffId: user.staffId })
          .orderBy('date', 'desc')
          .get();
        activities = res.data;

        await this._fillStatsBatch(activities);
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

        // 普通用户不显示已结束的活动（过滤后再查询签到状态，避免无谓的云函数调用）
        activities = activities.filter(act => this._getActivityStatus(act, todayStr, currentMinutes) !== 'ended');

        const activityStats = await Promise.all(
          activities.map(async (act) => {
            try {
              const checkinResult = await wx.cloud.callFunction({
                name: 'createActivity',
                data: { action: 'getMyCheckin', activityId: act._id, staffId: user.staffId },
              });
              if (checkinResult.result.success) {
                return {
                  ...act,
                  myChecked: checkinResult.result.myChecked,
                  myCheckedAt: checkinResult.result.myCheckedAt,
                };
              }
              return { ...act, myChecked: false, myCheckedAt: '' };
            } catch (e) {
              return { ...act, myChecked: false, myCheckedAt: '' };
            }
          })
        );
        activities = activityStats;
      }

      // 先渲染活动列表骨架（统计数字暂为 0），让用户立刻看到列表
      const ongoing = [];
      const upcoming = [];
      const ended = [];

      activities.forEach(act => {
        act.totalCount = act.totalCount || 0;
        act.checkedCount = act.checkedCount || 0;
        const status = this._getActivityStatus(act, todayStr, currentMinutes);
        act.status = status;
        act.canManage = this.data.isAdmin || this.data.isOperator || (this.data.isOrganizer && act.creatorStaffId === user.staffId);
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

      // 异步批量回填统计数字（只有管理员/操作员/创建人才有统计需求）
      if ((this.data.isAdmin || this.data.isOperator || this.data.isOrganizer) && activities.length > 0) {
        this._fillStatsBatch(activities);
      }
    } catch (err) {
      console.error('加载活动失败', err);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败，请重试', icon: 'none' });
    }
  },

  // 批量获取活动统计并回填到列表（一次云函数调用替代 N 次）
  async _fillStatsBatch(activities) {
    if (!activities || activities.length === 0) return;
    const ids = activities.map(a => a._id);
    try {
      const res = await wx.cloud.callFunction({
        name: 'createActivity',
        data: { action: 'getAllActivityStats', activityIds: ids },
      });
      if (res.result && res.result.success && res.result.stats) {
        const stats = res.result.stats;
        activities.forEach(a => {
          const s = stats[a._id];
          if (s) {
            a.totalCount = s.totalCount;
            a.checkedCount = s.checkedCount;
          }
        });
        // 按当前三个分区列表重新 setData，触发统计数字刷新
        const refresh = (list) => list.map(item => {
          const s = stats[item._id];
          return s ? { ...item, totalCount: s.totalCount, checkedCount: s.checkedCount } : item;
        });
        this.setData({
          ongoingList: refresh(this.data.ongoingList),
          upcomingList: refresh(this.data.upcomingList),
          endedList: refresh(this.data.endedList),
        });
      }
    } catch (e) {
      console.error('批量统计失败', e);
    }
  },

  _getActivityStatus(act, todayStr, currentMinutes) {
    if (!act.date) return 'upcoming';
    const actDate = act.date.replace(/-/g, '');

    if (actDate < todayStr) return 'ended';
    if (actDate > todayStr) return 'upcoming';

    const [startH, startM] = (act.startTime || '00:00').split(':').map(Number);
    const [endH, endM] = (act.endTime || '23:59').split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (currentMinutes < startMinutes) return 'upcoming';
    if (currentMinutes > endMinutes) return 'ended';
    return 'ongoing';
  },

  goToDetail(e) {
    const user = app.globalData.currentUser;
    if (!user || !user.staffId) {
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }
    const id = e.currentTarget.dataset.id;
    const item = e.currentTarget.dataset.item;
    if (item && item.canManage) {
      wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
    } else {
      wx.navigateTo({ url: `/pages/my-checkin/my-checkin?id=${id}` });
    }
  },

  goToCreate() {
    wx.navigateTo({ url: '/pages/create-activity/create-activity' });
  },

  onPullDownRefresh() {
    this.loadActivities().then(() => {
      wx.stopPullDownRefresh();
    });
  },

  onShareAppMessage() {
    return {
      title: '团建签到',
      path: '/pages/index/index',
    };
  },

  onShareTimeline() {
    return {
      title: '团建签到',
    };
  },
});
