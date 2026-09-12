const app = getApp();
const { cstTimeStr } = require('../../utils/china-time');

Page({
  data: {
    activityId: '',
    confirmItems: [],       // 活动的确认项目列表 [{ key, label, total }]
    remainingCounts: {},    // 各项目剩余数量 { tea: 45, gift: 28 }
    enableScanConfirm: false, // 活动是否开启了扫码确认
    scanned: false,
    scannedUser: null,      // 仅用于展示：{ name, dept, avatar, staffIdDisplay }，安全模式下无 name/dept
    scannedParticipant: null, // 该用户在 participants 表中的记录
    confirmations: {},      // { itemKey: { confirmed, at, by } }
    secureMode: false,      // 活动是否开启信息安全模式
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
    // 从活动详情页名单直接跳转：安全模式下前端只有参与者记录 _id
    if (options.participantId) {
      this.loadByParticipantId(options.participantId);
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
      let payload = null;

      // 尝试解析 JSON（我们生成的格式）
      try {
        payload = JSON.parse(result);
      } catch (e) {
        // 如果不是 JSON，假设是纯 staffId
        payload = { staffId: result };
      }

      // 安全活动的签到码只含参与者记录ID，直接按记录加载（全程不接触 name/dept/完整工号）
      if (payload.participantId) {
        this.setData({ loading: false });
        return this.loadByParticipantId(payload.participantId);
      }

      if (!payload.staffId) {
        wx.showToast({ title: '无法识别二维码', icon: 'none' });
        this.setData({ loading: false });
        return;
      }

      // 完整工号仅保留在内存中用于查询，不放入 setData 展示
      this.fullStaffId = payload.staffId;

      // 查询参与者记录（签到状态 + 领取状态 + 活动安全标记）
      let participant = { checked: false };
      let confirmations = {};
      let confirmItems = [];
      let remainingCounts = {};
      let enableScanConfirm = false;
      let secureMode = false;
      if (this.activityId) {
        try {
          const pRes = await wx.cloud.callFunction({
            name: 'createActivity',
            data: {
              action: 'getParticipant',
              activityId: this.activityId,
              staffId: payload.staffId,
            },
          });
          if (pRes.result.success && pRes.result.record) {
            participant = pRes.result.record;
            confirmations = pRes.result.record.confirmations || {};
          }
          enableScanConfirm = pRes.result.enableScanConfirm !== false;
          confirmItems = enableScanConfirm ? (pRes.result.confirmItems || []) : [];
          remainingCounts = pRes.result.remainingCounts || {};
          secureMode = !!pRes.result.secureMode;
        } catch (e) {
          // 忽略
        }
      }

      // 仅非安全模式才查询用户姓名/部门；安全模式下拉取也只会得到脱敏白名单
      let userInfo = { staffId: payload.staffId, name: payload.name || '', dept: '' };
      if (!secureMode) {
        try {
          const userRes = await wx.cloud.callFunction({
            name: 'createActivity',
            data: {
              action: 'getUserInfo',
              staffId: payload.staffId,
              activityId: this.activityId,
            },
          });
          if (userRes.result.success && userRes.result.user) {
            userInfo = userRes.result.user;
          }
        } catch (e) {
          // 查不到就用扫码解析的信息
        }
      }

      const displayUser = secureMode
        ? { name: '', dept: '', avatar: '?', staffIdDisplay: String(payload.staffId || '').slice(-6) }
        : {
            name: userInfo.name || '',
            dept: userInfo.dept || '',
            avatar: (userInfo.name || '?')[0] || '?',
            staffIdDisplay: userInfo.staffId || payload.staffId || '',
          };

      this.setData({
        scanned: true,
        scannedUser: displayUser,
        scannedParticipant: participant,
        confirmations,
        confirmItems,
        remainingCounts,
        enableScanConfirm,
        secureMode,
        loading: false,
      });
    } catch (err) {
      console.error('处理扫码结果失败', err);
      this.setData({ loading: false });
      wx.showToast({ title: '处理失败', icon: 'none' });
    }
  },

  // 凭参与者记录 _id 直接加载（名单页“核销”入口/安全活动签到码）
  async loadByParticipantId(participantId) {
    this.setData({ loading: true, scanned: false });
    try {
      const pRes = await wx.cloud.callFunction({
        name: 'createActivity',
        data: {
          action: 'getParticipant',
          activityId: this.activityId,
          participantId,
        },
      });
      if (!pRes.result.success || !pRes.result.record) {
        wx.showToast({ title: '未找到该参与者', icon: 'none' });
        this.setData({ loading: false });
        return;
      }
      const { record, confirmItems = [], remainingCounts = {}, enableScanConfirm = true, secureMode = false } = pRes.result;
      this.fullStaffId = secureMode ? '' : (record.staffId || '');

      const displayUser = secureMode
        ? { name: '', dept: '', avatar: '?', staffIdDisplay: record.staffId || '' }
        : {
            name: record.name || '',
            dept: record.dept || '',
            avatar: (record.name || '?')[0] || '?',
            staffIdDisplay: record.staffId || '',
          };

      this.setData({
        scanned: true,
        scannedUser: displayUser,
        scannedParticipant: record,
        confirmations: record.confirmations || {},
        confirmItems: enableScanConfirm !== false ? confirmItems : [],
        remainingCounts,
        enableScanConfirm: enableScanConfirm !== false,
        secureMode: !!secureMode,
        loading: false,
      });
    } catch (err) {
      console.error('加载参与者失败', err);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  // 确认领取（动态 itemKey）
  async confirmPickup(e) {
    const itemKey = e.currentTarget.dataset.key;
    const { scannedParticipant } = this.data;
    if (!scannedParticipant || !scannedParticipant._id || !itemKey) return;

    const currentUser = app.globalData.currentUser;

    this.setData({ loading: true });

    try {
      const result = await wx.cloud.callFunction({
        name: 'createActivity',
        data: {
          action: 'confirmPickup',
          activityId: this.activityId,
          staffId: this.fullStaffId || '',
          participantId: scannedParticipant._id,
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

      await this._refreshAfterPickup(scannedParticipant._id);
    } catch (err) {
      console.error('确认失败', err);
      this.setData({ loading: false });
      wx.showToast({ title: '确认失败', icon: 'none' });
    }
  },

  // 取消领取
  async cancelPickup(e) {
    const itemKey = e.currentTarget.dataset.key;
    const { scannedParticipant } = this.data;
    if (!scannedParticipant || !scannedParticipant._id || !itemKey) return;

    const currentUser = app.globalData.currentUser;

    this.setData({ loading: true });

    try {
      const result = await wx.cloud.callFunction({
        name: 'createActivity',
        data: {
          action: 'cancelPickup',
          activityId: this.activityId,
          staffId: this.fullStaffId || '',
          participantId: scannedParticipant._id,
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

      await this._refreshAfterPickup(scannedParticipant._id);
    } catch (err) {
      console.error('取消失败', err);
      this.setData({ loading: false });
      wx.showToast({ title: '取消失败', icon: 'none' });
    }
  },

  // 领取/取消后凭参与者记录 _id 重新查询最新状态
  async _refreshAfterPickup(participantId) {
    if (!this.activityId || !participantId) return;
    try {
      const pRes = await wx.cloud.callFunction({
        name: 'createActivity',
        data: {
          action: 'getParticipant',
          activityId: this.activityId,
          participantId,
        },
      });
      if (pRes.result.success && pRes.result.record) {
        this.setData({
          scannedParticipant: pRes.result.record,
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
