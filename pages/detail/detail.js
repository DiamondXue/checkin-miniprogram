const app = getApp();
const { verifyCheckinLocation, formatDistance } = require('../../utils/location');

Page({
  data: {
    activity: null,
    keyword: '',
    activeFilter: 'all',
    filteredList: [],
    uncheckedCount: 0,
    progressPct: 0,
    statusTagClass: '',
    statusText: '',
    // 位置相关
    locationInfo: '',       // 当前与活动地点的距离文案
    locationValid: null,    // null=未检测, true=在范围内, false=超出范围
    checkingLocation: false,// 正在定位中
  },

  onLoad(options) {
    this.activityId = options.id;
    this.loadActivity();
  },

  onShow() {
    if (this.activityId) this.loadActivity();
  },

  loadActivity() {
    const activities = app.globalData.activities || [];
    const activity = activities.find(a => a.id === this.activityId);
    if (!activity) {
      wx.showToast({ title: '活动不存在', icon: 'error' });
      return;
    }

    const statusMap = {
      ongoing: { class: 'tag-ongoing', text: '进行中' },
      upcoming: { class: 'tag-upcoming', text: '即将开始' },
      ended: { class: 'tag-ended', text: '已结束' },
    };

    const statusInfo = statusMap[activity.status] || statusMap.ended;
    const unchecked = activity.participants.filter(p => !p.checked).length;
    const pct = activity.totalCount > 0
      ? Math.round(activity.checkedCount / activity.totalCount * 100)
      : 0;

    wx.setNavigationBarTitle({ title: activity.name });

    this.setData({
      activity,
      uncheckedCount: unchecked,
      progressPct: pct,
      statusTagClass: statusInfo.class,
      statusText: statusInfo.text,
    });

    this.applyFilter();

    // 进行中 / 即将开始的活动自动检测位置
    if (activity.status !== 'ended' && activity.latitude) {
      this.refreshLocation();
    }
  },

  // 刷新位置检测
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

    this.setData({
      locationValid: result.valid,
      locationInfo,
      checkingLocation: false,
    });
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
    const { activity, keyword, activeFilter } = this.data;
    if (!activity) return;

    let list = activity.participants;
    if (activeFilter === 'checked') list = list.filter(p => p.checked);
    else if (activeFilter === 'unchecked') list = list.filter(p => !p.checked);

    if (keyword.trim()) {
      const kw = keyword.trim().toLowerCase();
      list = list.filter(p =>
        p.name.toLowerCase().includes(kw) ||
        p.dept.toLowerCase().includes(kw)
      );
    }

    this.setData({ filteredList: list });
  },

  // 签到（含位置验证）
  async doCheckin(e) {
    const id = e.currentTarget.dataset.id;
    const activities = app.globalData.activities;
    const act = activities.find(a => a.id === this.activityId);
    if (!act) return;

    const p = act.participants.find(p => p.id === id);
    if (!p || p.checked) return;

    // 如果活动配置了位置验证
    if (act.latitude && act.checkinRadius > 0) {
      wx.showLoading({ title: '定位验证中…' });
      const result = await verifyCheckinLocation(act);
      wx.hideLoading();

      if (!result.valid) {
        // 位置获取失败，给管理员一个强制签到选项
        if (result.distance === -1) {
          wx.showModal({
            title: '位置获取失败',
            content: '无法获取您的位置，是否强制签到（仅限管理员操作）？',
            confirmText: '强制签到',
            cancelText: '取消',
            success: (res) => {
              if (res.confirm) this._performCheckin(act, p, true);
            }
          });
        } else {
          wx.showModal({
            title: '超出签到范围',
            content: result.message,
            showCancel: false,
            confirmText: '我知道了'
          });
        }
        return;
      }
    }

    this._performCheckin(act, p, false);
  },

  // 执行签到写入
  _performCheckin(act, p, isForced) {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    p.checked = true;
    p.checkedAt = `${hh}:${mm}${isForced ? '(强制)' : ''}`;
    act.checkedCount += 1;

    wx.showToast({ title: `${p.name} 签到成功`, icon: 'success' });
    this.loadActivity();
  },

  undoCheckin(e) {
    const id = e.currentTarget.dataset.id;
    const activities = app.globalData.activities;
    const act = activities.find(a => a.id === this.activityId);
    if (!act) return;

    const p = act.participants.find(p => p.id === id);
    if (!p || !p.checked) return;

    wx.showModal({
      title: '撤销签到',
      content: `确认撤销 ${p.name} 的签到记录？`,
      success: (res) => {
        if (res.confirm) {
          p.checked = false;
          p.checkedAt = '';
          act.checkedCount -= 1;
          wx.showToast({ title: '已撤销', icon: 'none' });
          this.loadActivity();
        }
      }
    });
  }
});
