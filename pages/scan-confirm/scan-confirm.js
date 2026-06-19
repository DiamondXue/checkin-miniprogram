const app = getApp();
const { cstTimeStr } = require('../../utils/china-time');

Page({
  data: {
    activityId: '',
    scanned: false,
    scannedUser: null,      // 扫码解析出的用户信息 { staffId, name }
    scannedParticipant: null, // 该用户在 participants 表中的记录
    loading: false,
  },

  onLoad(options) {
    this.activityId = options.activityId || '';
    // 检查权限
    const user = app.globalData.currentUser;
    if (!user || !user.staffId) {
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }
    // 非管理员只能看到自己的码（已在 my-qrcode 页面），这里不限制，由活动权限控制
  },

  // 扫码
  doScan() {
    wx.scanCode({
      onlyFromCamera: false,
      success: (res) => {
        this.handleScanResult(res.result);
      },
      fail: (err) => {
        if (err.errMsg && err.errMsg.indexOf('cancel') === -1) {
          wx.showToast({ title: '扫码失败', icon: 'none' });
        }
      },
    });
  },

  // 处理扫码结果
  async handleScanResult(result) {
    this.setData({ loading: true, scanned: false });

    try {
      let scannedUser = null;

      // 尝试解析 JSON（我们生成的格式）
      try {
        scannedUser = JSON.parse(result);
      } catch (e) {
        // 如果不是 JSON，假设是纯 staffId
        scannedUser = { staffId: result, name: '' };
      }

      if (!scannedUser.staffId) {
        wx.showToast({ title: '无法识别二维码', icon: 'none' });
        this.setData({ loading: false });
        return;
      }

      // 查询用户详细信息（从 users 表）
      let userInfo = scannedUser;
      try {
        const userRes = await wx.cloud.callFunction({
          name: 'createActivity',
          data: {
            action: 'getUserInfo',
            staffId: scannedUser.staffId,
          },
        });
        if (userRes.result.success && userRes.result.user) {
          userInfo = userRes.result.user;
        }
      } catch (e) {
        // 查不到就用扫码解析的信息
      }

      // 查询参与者记录（签到状态 + 领取状态）
      let participant = { checked: false, teaConfirmed: false, giftConfirmed: false };
      if (this.activityId) {
        try {
          const pRes = await wx.cloud.callFunction({
            name: 'createActivity',
            data: {
              action: 'getParticipant',
              activityId: this.activityId,
              staffId: scannedUser.staffId,
            },
          });
          if (pRes.result.success && pRes.result.record) {
            participant = pRes.result.record;
          }
        } catch (e) {
          // 忽略
        }
      }

      this.setData({
        scanned: true,
        scannedUser: userInfo,
        scannedParticipant: participant,
        loading: false,
      });
    } catch (err) {
      console.error('处理扫码结果失败', err);
      this.setData({ loading: false });
      wx.showToast({ title: '处理失败', icon: 'none' });
    }
  },

  // 确认领取
  async confirmPickup(e) {
    const type = e.currentTarget.dataset.type; // 'tea' or 'gift'
    const { scannedUser, scannedParticipant } = this.data;
    if (!scannedUser || !scannedUser.staffId) return;

    const updateField = type === 'tea' ? 'teaConfirmed' : 'giftConfirmed';
    const timeField = type === 'tea' ? 'teaConfirmedAt' : 'giftConfirmedAt';
    const confirmedByField = type === 'tea' ? 'teaConfirmedBy' : 'giftConfirmedBy';

    const currentUser = app.globalData.currentUser;

    this.setData({ loading: true });

    try {
      await wx.cloud.callFunction({
        name: 'createActivity',
        data: {
          action: 'confirmPickup',
          activityId: this.activityId,
          staffId: scannedUser.staffId,
          participantId: scannedParticipant._id || '',
          field: updateField,
          timeField,
          confirmedByField,
          confirmedBy: currentUser ? currentUser.staffId : '',
          confirmedAt: cstTimeStr(),
        },
      });

      wx.showToast({ title: '确认成功', icon: 'success' });

      // 刷新数据
      this.setData({
        [`scannedParticipant.${updateField}`]: true,
        [`scannedParticipant.${timeField}`]: cstTimeStr(),
        loading: false,
      });
    } catch (err) {
      console.error('确认失败', err);
      this.setData({ loading: false });
      wx.showToast({ title: '确认失败', icon: 'none' });
    }
  },
});
