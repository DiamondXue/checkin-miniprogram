const app = getApp();
const { cstTimeStr } = require('../../utils/china-time');

Page({
  data: {
    activityId: '',
    confirmItems: [],       // 活动的确认项目列表 [{ key, label, total }]
    remainingCounts: {},    // 各项目剩余数量 { tea: 45, gift: 28 }
    enableScanConfirm: false, // 活动是否开启了扫码确认
    scanned: false,
    scannedUser: null,      // 扫码解析出的用户信息 { staffId, name }
    scannedParticipant: null, // 该用户在 participants 表中的记录
    confirmations: {},      // { itemKey: { confirmed, at, by } }
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
    // 支持从活动详情页直接跳转并加载指定参与者
    if (options.staffId) {
      const userPayload = JSON.stringify({
        staffId: options.staffId,
        name: decodeURIComponent(options.name || ''),
      });
      this.handleScanResult(userPayload);
    }
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
      let participant = { checked: false };
      let confirmations = {};
      let confirmItems = [];
      let remainingCounts = {};
      let enableScanConfirm = false;
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
            confirmations = pRes.result.record.confirmations || {};
          }
          enableScanConfirm = pRes.result.enableScanConfirm !== false;
          confirmItems = enableScanConfirm ? (pRes.result.confirmItems || []) : [];
          remainingCounts = pRes.result.remainingCounts || {};
        } catch (e) {
          // 忽略
        }
      }

      this.setData({
        scanned: true,
        scannedUser: userInfo,
        scannedParticipant: participant,
        confirmations,
        confirmItems,
        remainingCounts,
        enableScanConfirm,
        loading: false,
      });
    } catch (err) {
      console.error('处理扫码结果失败', err);
      this.setData({ loading: false });
      wx.showToast({ title: '处理失败', icon: 'none' });
    }
  },

  // 确认领取（动态 itemKey）
  async confirmPickup(e) {
    const itemKey = e.currentTarget.dataset.key;
    const { scannedUser, scannedParticipant } = this.data;
    if (!scannedUser || !scannedUser.staffId || !itemKey) return;

    const currentUser = app.globalData.currentUser;

    this.setData({ loading: true });

    try {
      const result = await wx.cloud.callFunction({
        name: 'createActivity',
        data: {
          action: 'confirmPickup',
          activityId: this.activityId,
          staffId: scannedUser.staffId,
          participantId: scannedParticipant._id || '',
          itemKey,
          confirmedBy: currentUser ? currentUser.staffId : '',
          confirmedAt: cstTimeStr(),
        },
      });

      if (!result.result.success) {
        wx.showToast({ title: result.result.error || '确认失败', icon: 'none' });
        this.setData({ loading: false });
        return;
      }

      wx.showToast({ title: '确认成功', icon: 'success' });

      await this._refreshAfterPickup(scannedUser.staffId);
    } catch (err) {
      console.error('确认失败', err);
      this.setData({ loading: false });
      wx.showToast({ title: '确认失败', icon: 'none' });
    }
  },

  // 取消领取
  async cancelPickup(e) {
    const itemKey = e.currentTarget.dataset.key;
    const { scannedUser, scannedParticipant } = this.data;
    if (!scannedUser || !scannedUser.staffId || !itemKey) return;

    const currentUser = app.globalData.currentUser;

    this.setData({ loading: true });

    try {
      const result = await wx.cloud.callFunction({
        name: 'createActivity',
        data: {
          action: 'cancelPickup',
          activityId: this.activityId,
          staffId: scannedUser.staffId,
          participantId: scannedParticipant._id || '',
          itemKey,
          confirmedBy: currentUser ? currentUser.staffId : '',
        },
      });

      if (!result.result.success) {
        wx.showToast({ title: result.result.error || '取消失败', icon: 'none' });
        this.setData({ loading: false });
        return;
      }

      wx.showToast({ title: '已取消', icon: 'success' });

      await this._refreshAfterPickup(scannedUser.staffId);
    } catch (err) {
      console.error('取消失败', err);
      this.setData({ loading: false });
      wx.showToast({ title: '取消失败', icon: 'none' });
    }
  },

  // 领取/取消后重新查询数据库获取最新余量
  async _refreshAfterPickup(staffId) {
    if (!this.activityId || !staffId) return;
    try {
      const pRes = await wx.cloud.callFunction({
        name: 'createActivity',
        data: {
          action: 'getParticipant',
          activityId: this.activityId,
          staffId: staffId,
        },
      });
      if (pRes.result.success && pRes.result.record) {
        this.setData({
          confirmations: pRes.result.record.confirmations || {},
          remainingCounts: pRes.result.remainingCounts || {},
          loading: false,
        });
      } else {
        this.setData({ loading: false });
      }
    } catch (e) {
      console.error('刷新数据失败', e);
      this.setData({ loading: false });
    }
  },

  // 获取 item 确认状态
  getItemStatus(key) {
    const conf = (this.data.confirmations || {})[key];
    return conf || { confirmed: false, at: '', by: '' };
  },
});
