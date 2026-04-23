const app = getApp();
const { verifyCheckinLocation, formatDistance } = require('../../utils/location');

Page({
  data: {
    activity: null,
    participants: [],
    keyword: '',
    activeFilter: 'all',
    filteredList: [],
    uncheckedCount: 0,
    checkedCount: 0,
    totalCount: 0,
    progressPct: 0,
    loading: true,
    statusTagClass: '',
    statusText: '',
    canManage: false,
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
    this.setData({ loading: true });
    const db = wx.cloud.database();
    const user = app.globalData.currentUser;

    try {
      const actRes = await db.collection('activities').doc(this.activityId).get();
      const activity = actRes.data;

      wx.setNavigationBarTitle({ title: activity.name });

      const canManage = app.canManageActivity(activity);

      const now = new Date();
      const todayStr = this._formatDate(now);
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const status = this._getActivityStatus(activity, todayStr, currentMinutes);
      activity.status = status;

      const statusMap = {
        ongoing: { class: 'tag-ongoing', text: '进行中' },
        upcoming: { class: 'tag-upcoming', text: '即将开始' },
        ended: { class: 'tag-ended', text: '已结束' },
      };
      const statusInfo = statusMap[status] || statusMap.ended;

      // 通过云函数加载参与者
      let allParticipants = [];
      try {
        const pResult = await wx.cloud.callFunction({
          name: 'createActivity',
          data: { action: 'getParticipants', activityId: this.activityId },
        });
        if (pResult.result.success) {
          allParticipants = pResult.result.participants;
        }
      } catch (e) {
        console.warn('加载参与者失败', e);
      }

      const checkedCount = allParticipants.filter(p => p.checked).length;
      const totalCount = allParticipants.length;
      const pct = totalCount > 0 ? Math.round(checkedCount / totalCount * 100) : 0;

      this.setData({
        activity,
        participants: allParticipants,
        totalCount,
        checkedCount,
        uncheckedCount: totalCount - checkedCount,
        progressPct: pct,
        statusTagClass: statusInfo.class,
        statusText: statusInfo.text,
        canManage,
        loading: false,
      });

      this.applyFilter();

      if (status !== 'ended' && activity.latitude) {
        this.refreshLocation();
      }
    } catch (err) {
      console.error('加载失败', err);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
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

  _formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
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

  onSearch(e) {
    this.setData({ keyword: e.detail.value });
    this.applyFilter();
  },

  clearSearch() {
    this.setData({ keyword: '' });
    this.applyFilter();
  },

  setFilter(e) {
    this.setData({ activeFilter: e.currentTarget.dataset.filter });
    this.applyFilter();
  },

  applyFilter() {
    const { participants, keyword, activeFilter } = this.data;
    let list = participants;
    if (activeFilter === 'checked') list = list.filter(p => p.checked);
    else if (activeFilter === 'unchecked') list = list.filter(p => !p.checked);

    if (keyword.trim()) {
      const kw = keyword.trim().toLowerCase();
      list = list.filter(p =>
        (p.name || '').toLowerCase().includes(kw) ||
        (p.dept || '').toLowerCase().includes(kw) ||
        (p.staffId || '').includes(kw)
      );
    }

    this.setData({ filteredList: list });
  },

  goToEdit() {
    wx.navigateTo({ url: `/pages/create-activity/create-activity?id=${this.activityId}` });
  },

  doDelete() {
    wx.showModal({
      title: '删除活动',
      content: '确认删除此活动？此操作不可恢复。',
      confirmColor: '#EF4444',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          const db = wx.cloud.database();

          await wx.cloud.callFunction({
            name: 'createActivity',
            data: { action: 'deleteParticipants', activityId: this.activityId },
          });

          await db.collection('activities').doc(this.activityId).remove();

          wx.showToast({ title: '已删除', icon: 'success' });
          setTimeout(() => wx.navigateBack(), 800);
        } catch (err) {
          console.error('删除失败', err);
          wx.showToast({ title: '删除失败', icon: 'none' });
        }
      }
    });
  },

  async doCheckin(e) {
    const participantId = e.currentTarget.dataset.id;
    const { activity } = this.data;

    if (!activity || activity.status === 'ended') return;

    if (activity.latitude && activity.checkinRadius > 0) {
      wx.showLoading({ title: '定位验证中…' });
      const result = await verifyCheckinLocation(activity);
      wx.hideLoading();

      if (!result.valid) {
        if (result.distance === -1) {
          wx.showModal({
            title: '位置获取失败',
            content: '无法获取您的位置，是否强制签到（仅限管理员操作）？',
            confirmText: '强制签到',
            cancelText: '取消',
            success: (res) => {
              if (res.confirm) this._performCheckin(participantId, true);
            }
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

    this._performCheckin(participantId, false);
  },

  async _performCheckin(participantId, isForced) {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const checkedAt = `${hh}:${mm}${isForced ? '(强制)' : ''}`;

    try {
      const result = await wx.cloud.callFunction({
        name: 'createActivity',
        data: {
          action: 'checkin',
          activityId: this.activityId,
          participantId,
          checked: true,
          checkedAt,
        },
      });

      if (result.result.success) {
        wx.showToast({ title: '签到成功', icon: 'success' });
        this.loadActivity();
      } else {
        throw new Error(result.result.error);
      }
    } catch (err) {
      console.error('签到失败', err);
      wx.showToast({ title: '签到失败，请重试', icon: 'none' });
    }
  },

  undoCheckin(e) {
    const participantId = e.currentTarget.dataset.id;
    const { activity } = this.data;

    if (!activity || activity.status === 'ended') return;

    wx.showModal({
      title: '撤销签到',
      content: '确认撤销该签到记录？',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          const result = await wx.cloud.callFunction({
            name: 'createActivity',
            data: {
              action: 'checkin',
              activityId: this.activityId,
              participantId,
              checked: false,
              checkedAt: '',
            },
          });

          if (result.result.success) {
            wx.showToast({ title: '已撤销', icon: 'none' });
            this.loadActivity();
          } else {
            throw new Error(result.result.error);
          }
        } catch (err) {
          console.error('撤销失败', err);
          wx.showToast({ title: '操作失败', icon: 'none' });
        }
      }
    });
  },
});
