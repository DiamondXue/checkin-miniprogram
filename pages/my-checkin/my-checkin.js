const app = getApp();
const { verifyCheckinLocation, formatDistance } = require('../../utils/location');

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
    this.loadActivity();
  },

  onShow() {
    if (this.activityId) this.loadActivity();
  },

  async loadActivity() {
    const db = wx.cloud.database();
    const user = app.globalData.currentUser;

    try {
      // 加载活动信息
      const actRes = await db.collection('activities').doc(this.activityId).get();
      const activity = actRes.data;

      wx.setNavigationBarTitle({ title: activity.name });

      // 加载当前用户的签到记录
      const pRes = await db.collection('activities')
        .doc(this.activityId)
        .collection('participants')
        .where({ staffId: user.staffId })
        .limit(1)
        .get();

      const myRecord = pRes.data[0] || null;
      const myChecked = !!myRecord && !!myRecord.checked;

      this.setData({
        activity,
        myRecord,
        myChecked,
        myCheckedAt: myRecord ? (myRecord.checkedAt || '') : '',
        loading: false,
      });

      // 未签到且活动未结束则检测位置
      if (!myChecked && activity.status !== 'ended' && activity.latitude) {
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
      const db = wx.cloud.database();
      const user = app.globalData.currentUser;
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');

      if (this.data.myRecord) {
        // 更新已有记录
        await db.collection('activities')
          .doc(this.activityId)
          .collection('participants')
          .doc(this.data.myRecord._id)
          .update({
            data: {
              checked: true,
              checkedAt: `${hh}:${mm}`,
            },
          });
      } else {
        // 新增签到记录
        await db.collection('activities')
          .doc(this.activityId)
          .collection('participants')
          .add({
            data: {
              staffId: user.staffId,
              name: user.name || user.staffId,
              dept: user.dept || '',
              checked: true,
              checkedAt: `${hh}:${mm}`,
            },
          });
      }

      wx.showToast({ title: '签到成功 ✓', icon: 'success' });
      this.setData({ checkinLoading: false });
      this.loadActivity();
    } catch (err) {
      console.error('签到失败', err);
      this.setData({ checkinLoading: false });
      wx.showToast({ title: '签到失败，请重试', icon: 'none' });
    }
  },
});
