const app = getApp();
const { verifyCheckinLocation, formatDistance } = require('../../utils/location');
const { cstDateStr, cstTotalMinutes, cstTimeStr } = require('../../utils/china-time');

Page({
  data: {
    activity: null,
    participants: [],
    keyword: '',
    activeFilter: 'all',
    activeConfirmFilter: 'all',   // 'all' | '{key}_confirmed' | '{key}_unconfirmed'
    filteredList: [],
    uncheckedCount: 0,
    checkedCount: 0,
    totalCount: 0,
    progressPct: 0,
    confirmStats: [],              // [{ key, label, confirmed, total, unconfirmed }]
    confirmItems: [],              // 活动定义的领取项目
    loading: true,
    statusTagClass: '',
    statusText: '',
    canEdit: false,
    canDelete: false,
    showStaffPanel: false,
    newStaffInput: '',
    addingStaff: false,
    participants: [],
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

      const canEdit = app.canManageActivity(activity);
      const canDelete = app.canDeleteActivity();

      const todayStr = cstDateStr();
      const currentMinutes = cstTotalMinutes();
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

      // 云函数已按 staffId 去重，前端再保底一次 + 显式布尔化 checked
      const byStaffId = {};
      allParticipants.forEach(p => {
        const prev = byStaffId[p.staffId];
        if (!prev) { byStaffId[p.staffId] = p; return; }
        if (!!p.checked && !prev.checked) byStaffId[p.staffId] = p;
      });
      const uniqueParticipants = Object.values(byStaffId);

      const checkedCount = uniqueParticipants.filter(p => !!p.checked).length;
      const totalCount = uniqueParticipants.length;
      const progressPct = totalCount > 0 ? Math.round(checkedCount / totalCount * 100) : 0;

      // 计算确认领取统计：仅在开启扫码确认时计算
      let confirmItems = [];
      let confirmStats = [];
      if (activity.enableScanConfirm !== false) {
        confirmItems = (activity.confirmItems && activity.confirmItems.length > 0)
          ? activity.confirmItems
          : [{ key: 'tea', label: '茶点' }, { key: 'gift', label: '礼品' }];
        confirmStats = confirmItems.map(ci => {
          const confirmed = uniqueParticipants.filter(p => this._getConfirmation(p, ci.key).confirmed).length;
          return {
            key: ci.key,
            label: ci.label,
            confirmed,
            total: totalCount,
            unconfirmed: totalCount - confirmed,
          };
        });
      }

      this.setData({
        activity,
        participants: uniqueParticipants,
        totalCount,
        checkedCount,
        uncheckedCount: totalCount - checkedCount,
        progressPct,
        confirmItems,
        confirmStats,
        activeConfirmFilter: 'all',
        statusTagClass: statusInfo.class,
        statusText: statusInfo.text,
        canEdit,
        canDelete,
        showStaffPanel: false,
        newStaffInput: '',
        addingStaff: false,
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
    const { participants, keyword, activeFilter, activeConfirmFilter, confirmItems } = this.data;

    let list = participants;
    if (activeFilter === 'checked') list = list.filter(p => !!p.checked);
    else if (activeFilter === 'unchecked') list = list.filter(p => !p.checked);

    // 确认筛选：activeConfirmFilter 格式为 'key_confirmed' 或 'key_unconfirmed'
    if (activeConfirmFilter !== 'all') {
      const parts = activeConfirmFilter.split('_');
      const key = parts.slice(0, -1).join('_');
      const status = parts[parts.length - 1];
      list = list.filter(p => {
        const c = this._getConfirmation(p, key);
        return status === 'confirmed' ? c.confirmed : !c.confirmed;
      });
    }

    if (keyword.trim()) {
      const kw = keyword.trim().toLowerCase();
      list = list.filter(p =>
        (p.name || '').toLowerCase().includes(kw) ||
        (p.dept || '').toLowerCase().includes(kw) ||
        (p.staffId || '').includes(kw)
      );
    }

    // 为每个人预计算确认展示数据（仅在活动开启扫码确认且有项目时生成）
    if (confirmItems && confirmItems.length > 0) {
      list = list.map(p => {
        p._confirmDisplay = confirmItems.map(ci => ({
          key: ci.key,
          label: ci.label,
          confirmed: this._getConfirmation(p, ci.key).confirmed,
        }));
        return p;
      });
    }

    this.setData({ filteredList: list });
  },

  /** 从参与者记录中读取确认状态，兼容新旧格式 */
  _getConfirmation(p, key) {
    if (p.confirmations && p.confirmations[key]) {
      return p.confirmations[key];
    }
    // 向后兼容旧扁平字段
    return {
      confirmed: !!(p[key + 'Confirmed']),
      at: p[key + 'ConfirmedAt'] || '',
      by: p[key + 'ConfirmedBy'] || '',
    };
  },

  /** 设置确认筛选 */
  setConfirmFilter(e) {
    const filter = e.currentTarget.dataset.filter;
    this.setData({ activeConfirmFilter: filter });
    this.applyFilter();
  },

  toggleStaffPanel() {
    const show = !this.data.showStaffPanel;
    this.setData({ showStaffPanel: show });
    if (show) this.loadParticipants();
  },

  async loadParticipants() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'createActivity',
        data: { action: 'getParticipants', activityId: this.activityId },
      });
      if (res.result.success) {
        this.setData({ participants: res.result.participants });
      }
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  onNewStaffInput(e) {
    this.setData({ newStaffInput: e.detail.value });
  },

  async doAddParticipants() {
    const input = this.data.newStaffInput.trim();
    if (!input) return;
    const staffIds = input.split(/[,，\s\n]+/).map(s => s.trim()).filter(s => s.length > 0);
    if (staffIds.length === 0) return;

    this.setData({ addingStaff: true });
    const BATCH = 20;
    try {
      for (let i = 0; i < staffIds.length; i += BATCH) {
        const batch = staffIds.slice(i, i + BATCH);
        await wx.cloud.callFunction({
          name: 'createActivity',
          data: { action: 'addParticipants', activityId: this.activityId, staffIds: batch },
        });
      }
      wx.showToast({ title: '添加成功', icon: 'success' });
      this.setData({ newStaffInput: '' });
      this.loadParticipants();
      this.loadActivity();
    } catch (err) {
      wx.showToast({ title: '添加失败', icon: 'none' });
    }
    this.setData({ addingStaff: false });
  },

  doRemoveParticipant(e) {
    const { id, name } = e.currentTarget.dataset;
    wx.showModal({
      title: '删除参与人',
      content: `确认删除「${name || '未命名'}」？`,
      confirmColor: '#EF4444',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await wx.cloud.callFunction({
            name: 'createActivity',
            data: { action: 'removeParticipant', activityId: this.activityId, participantId: id },
          });
          wx.showToast({ title: '已删除', icon: 'none' });
          this.loadParticipants();
          this.loadActivity();
        } catch (err) {
          wx.showToast({ title: '删除失败', icon: 'none' });
        }
      },
    });
  },

  goToEdit() {
    wx.navigateTo({ url: `/pages/create-activity/create-activity?id=${this.activityId}` });
  },

  goToScanConfirm() {
    wx.navigateTo({ url: `/pages/scan-confirm/scan-confirm?activityId=${this.activityId}` });
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
    // 显式使用 UTC+8（中国标准时间），避免微信环境本地时区不准确
    const checkedAt = `${cstTimeStr()}${isForced ? '(强制)' : ''}`;

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
});
