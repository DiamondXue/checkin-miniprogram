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

    try {
      const actRes = await db.collection('activities').doc(this.activityId).get();
      const activity = actRes.data;

      wx.setNavigationBarTitle({ title: activity.name });

      // 计算活动状态
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

      // 加载参与者
      let allParticipants = [];
      try {
        const pRes = await db.collection('activities')
          .doc(this.activityId)
          .collection('participants')
          .orderBy('checked', 'asc')
          .get();
        allParticipants = pRes.data;
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
        loading: false,
      });

      this.applyFilter();

      // 进行中的活动自动检测位置
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

  // 管理员签到（含位置验证）
  async doCheckin(e) {
    const id = e.currentTarget.dataset.id;
    const db = wx.cloud.database();
    const { activity } = this.data;

    if (!activity || activity.status === 'ended') return;

    // 位置验证
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
              if (res.confirm) this._performCheckin(id, true);
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

    this._performCheckin(id, false);
  },

  async _performCheckin(participantId, isForced) {
    const db = wx.cloud.database();
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');

    try {
      await db.collection('activities')
        .doc(this.activityId)
        .collection('participants')
        .doc(participantId)
        .update({
          data: {
            checked: true,
            checkedAt: `${hh}:${mm}${isForced ? '(强制)' : ''}`,
          },
        });

      wx.showToast({ title: '签到成功', icon: 'success' });
      this.loadActivity();
    } catch (err) {
      console.error('签到失败', err);
      wx.showToast({ title: '签到失败，请重试', icon: 'none' });
    }
  },

  undoCheckin(e) {
    const id = e.currentTarget.dataset.id;
    const db = wx.cloud.database();
    const { activity } = this.data;

    if (!activity || activity.status === 'ended') return;

    wx.showModal({
      title: '撤销签到',
      content: '确认撤销该签到记录？',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await db.collection('activities')
            .doc(this.activityId)
            .collection('participants')
            .doc(id)
            .update({
              data: { checked: false, checkedAt: '' },
            });
          wx.showToast({ title: '已撤销', icon: 'none' });
          this.loadActivity();
        } catch (err) {
          console.error('撤销失败', err);
          wx.showToast({ title: '操作失败', icon: 'none' });
        }
      }
    });
  },
});
