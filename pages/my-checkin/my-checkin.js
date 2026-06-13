const app = getApp();
const { verifyCheckinLocation, formatDistance } = require('../../utils/location');
const { cstDateStr, cstTotalMinutes, cstTimeStr } = require('../../utils/china-time');

Page({
  data: {
    activity: null,
    myRecord: null,        // 当前用户的签到记录
    myChecked: false,
    myCheckedAt: '',
    loading: true,
    checkinLoading: false,
    // 位置相关
    locationInfo: '',
    locationValid: null,
    checkingLocation: false,
  },

  onLoad(options) {
    this.activityId = options.id;
    // 保存 activityId 到全局，登录后可用于跳转回来
    if (options.id) {
      app.globalData.pendingActivityId = options.id;
    }
    this.loadActivity();
  },

  onShow() {
    // 每次显示时检查：如果 globalData 里有 pendingActivityId 说明刚登录完，清掉并 reload
    if (app.globalData.pendingActivityId) {
      this.activityId = app.globalData.pendingActivityId;
      delete app.globalData.pendingActivityId;
    }
    if (this.activityId) this.loadActivity();
  },

  // 登录检查：未登录则跳转登录页
  _checkLogin() {
    const user = app.globalData.currentUser;
    if (!user || !user.staffId) {
      wx.redirectTo({ url: '/pages/login/login' });
      return false;
    }
    return true;
  },

  async loadActivity() {
    if (!this._checkLogin()) return;
    const db = wx.cloud.database();
    const user = app.globalData.currentUser;

    try {
      // 加载活动信息
      const actRes = await db.collection('activities').doc(this.activityId).get();
      const activity = actRes.data;

      // 计算活动状态（使用中国标准时间）
      const todayStr = cstDateStr();
      const currentMinutes = cstTotalMinutes();
      activity.status = this._getActivityStatus(activity, todayStr, currentMinutes);

      wx.setNavigationBarTitle({ title: activity.name });

      // 通过云函数加载当前用户的签到记录
      const pResult = await wx.cloud.callFunction({
        name: 'createActivity',
        data: { action: 'getParticipant', activityId: this.activityId, staffId: user.staffId },
      });
      const myRecord = pResult.result.success ? pResult.result.record : null;
      const myChecked = !!myRecord && !!myRecord.checked;

      // 格式化签到时间，如果没有则显示当前时间（兜底，使用中国标准时间）
      let myCheckedAt = myRecord ? (myRecord.checkedAt || '') : '';
      if (myChecked && !myCheckedAt) {
        myCheckedAt = cstTimeStr();
      }

      this.setData({
        activity,
        myRecord,
        myChecked,
        myCheckedAt,
        currentUser: user,
        loading: false,
      });

      // 未签到且活动未结束则检测位置
      if (!myChecked && activity.latitude) {
        this.refreshLocation();
      }
    } catch (err) {
      console.error('加载失败', err);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  async refreshLocation() {
    const { activity } = this.data;
    if (!activity || !activity.latitude) return;

    this.setData({ checkingLocation: true, locationInfo: '定位中…' });
    const result = await verifyCheckinLocation(activity);

    let locationInfo = '';
    if (result.distance === -1) {
      locationInfo = '📍 位置获取失败，请检查权限';
    } else if (result.distance === 0) {
      locationInfo = '📍 无位置限制';
    } else {
      const icon = result.valid ? '✅' : '⚠️';
      locationInfo = `${icon} 距活动地点 ${formatDistance(result.distance)}（范围 ${formatDistance(activity.checkinRadius)}）`;
    }

    this.setData({ locationValid: result.valid, locationInfo, checkingLocation: false });
  },

  // 普通用户签到
  async doCheckin() {
    const { myChecked, activity, checkinLoading } = this.data;
    if (myChecked || checkinLoading) return;

    // 活动未开始/已结束不允许签到
    if (activity.status === 'upcoming') {
      wx.showToast({ title: '活动尚未开始', icon: 'none' });
      return;
    }
    if (activity.status === 'ended') {
      wx.showToast({ title: '活动已结束', icon: 'none' });
      return;
    }

    // 位置验证
    if (activity.latitude && activity.checkinRadius > 0) {
      wx.showLoading({ title: '定位验证中…' });
      const result = await verifyCheckinLocation(activity);
      wx.hideLoading();

      if (!result.valid) {
        if (result.distance === -1) {
          wx.showModal({
            title: '位置获取失败',
            content: '无法获取您的位置，签到需要位置权限，请在设置中开启',
            showCancel: false,
            confirmText: '我知道了',
          });
        } else {
          wx.showModal({
            title: '超出签到范围',
            content: result.message,
            showCancel: false,
            confirmText: '我知道了',
          });
        }
        return;
      }
    }

    this.setData({ checkinLoading: true });

    try {
      const user = app.globalData.currentUser;
      const { myRecord } = this.data;

      // 通过云函数签到
      const checkinResult = await wx.cloud.callFunction({
        name: 'createActivity',
        data: {
          action: 'checkin',
          activityId: this.activityId,
          participantId: myRecord ? myRecord._id : '',
          staffId: user.staffId,
          name: user.name || user.staffId,
          dept: user.dept || '',
          checked: true,
        },
      });

      if (checkinResult.result.success) {
        wx.showToast({ title: '签到成功 ✓', icon: 'success' });
      } else {
        throw new Error(checkinResult.result.error);
      }

      this.setData({ checkinLoading: false });
      this.loadActivity();
    } catch (err) {
      console.error('签到失败', err);
      this.setData({ checkinLoading: false });
      wx.showToast({ title: '签到失败，请重试', icon: 'none' });
    }
  },

  onShareAppMessage() {
    const { activity } = this.data;
    return {
      title: activity ? `${activity.name} - 签到` : '团建签到',
      path: `/pages/my-checkin/my-checkin?id=${this.activityId}`,
    };
  },

  onShareTimeline() {
    const { activity } = this.data;
    return {
      title: activity ? `${activity.name} - 签到` : '团建签到',
      query: `id=${this.activityId}`,
    };
  },

  _getActivityStatus(act, todayStr, currentMinutes) {
    if (!act.date) return 'upcoming';
    const actDate = act.date.replace(/-/g, '');
    if (actDate < todayStr) return 'ended';
    if (actDate > todayStr) return 'upcoming';
    const [startH, startM] = (act.startTime || '00:00').split(':').map(Number);
    const [endH, endM] = (act.endTime || '23:59').split(':').map(Number);
    if (currentMinutes < startH * 60 + startM) return 'upcoming';
    if (currentMinutes > endH * 60 + endM) return 'ended';
    return 'ongoing';
  },
});
