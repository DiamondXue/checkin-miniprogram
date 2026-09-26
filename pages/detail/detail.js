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
    exportLoading: false,
    participants: [],
    locationInfo: '',
    locationValid: null,
    checkingLocation: false,
    // 信息安全模式（服务端返回的数据本身已脱敏）
    secureMode: false,
    // 入场券管理
    showTicketPanel: false,
    ticketCount: '10',
    ticketList: [],
    ticketGenerating: false,
    // 批量删除
    ticketBatchMode: false,
    selectedTickets: {},   // { ticketId: ticketNo }
    selectedTicketsCount: 0,
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
      const canDelete = app.canDeleteActivity(activity);

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

      // 信息安全模式下，云函数已剥离 name/dept 并将 staffId 截断为后6位，前端直接使用
      const secureMode = !!activity.secureMode;

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
        const remainingCounts = activity.remainingCounts || {};
        confirmStats = confirmItems.map(ci => {
          const confirmed = uniqueParticipants.filter(p => this._getConfirmation(p, ci.key).confirmed).length;
          const total = ci.total;
          const unlimited = (total === undefined || total === null);
          const remaining = remainingCounts[ci.key];
          return {
            key: ci.key,
            label: ci.label,
            confirmed,
            total: unlimited ? null : total,
            remaining: (remaining !== undefined) ? remaining : null,
            unlimited,
          };
        });
      }

      this.setData({
        activity,
        participants: uniqueParticipants,
        secureMode,
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
        // 管理参与人面板仅管理员工工号，入场券参与人由「入场券」面板管理
        const isTicket = (p) => !!p.isTicket || /^[A-Z]\d{7}$/.test(p.staffId || '');
        this.setData({ participants: (res.result.participants || []).filter(p => !isTicket(p)) });
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

  goToCopy() {
    wx.navigateTo({ url: `/pages/create-activity/create-activity?copyFrom=${this.activityId}` });
  },

  goToScanConfirm() {
    wx.navigateTo({ url: `/pages/scan-confirm/scan-confirm?activityId=${this.activityId}` });
  },

  // ===== 入场券管理 =====
  toggleTicketPanel() {
    const show = !this.data.showTicketPanel;
    this.setData({ showTicketPanel: show });
    if (show) this.loadTickets();
  },

  async loadTickets() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'createActivity',
        data: { action: 'getTickets', activityId: this.activityId },
      });
      if (res.result.success) {
        this.setData({ ticketList: res.result.tickets || [] });
      }
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  onTicketCountInput(e) {
    this.setData({ ticketCount: e.detail.value.replace(/\D/g, '') });
  },

  async doGenerateTickets() {
    if (this.data.ticketGenerating) return;
    let count = parseInt(this.data.ticketCount) || 0;
    if (count <= 0) {
      wx.showToast({ title: '请输入生成数量', icon: 'none' });
      return;
    }
    if (count > 200) count = 200;

    this.setData({ ticketGenerating: true });
    wx.showLoading({ title: `生成 ${count} 张券…`, mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'createActivity',
        data: { action: 'generateTickets', activityId: this.activityId, count },
      });
      wx.hideLoading();
      if (!res.result.success) throw new Error(res.result.error);

      wx.showToast({ title: `已生成 ${res.result.total} 张`, icon: 'success' });
      await this.loadTickets();
      this.loadActivity();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '生成失败', icon: 'none' });
    }
    this.setData({ ticketGenerating: false });
  },

  // 复制单张券号
  copyTicket(e) {
    const no = e.currentTarget.dataset.no;
    wx.setClipboardData({ data: no });
  },

  // 切换批量删除模式
  toggleTicketBatchMode() {
    const on = !this.data.ticketBatchMode;
    this.setData({ ticketBatchMode: on, selectedTickets: {}, selectedTicketsCount: 0 });
  },

  // 勾选/取消勾选一张券
  toggleTicketSelect(e) {
    if (!this.data.ticketBatchMode) return;
    const { id, no } = e.currentTarget.dataset;
    const selected = { ...this.data.selectedTickets };
    if (selected[id]) delete selected[id];
    else selected[id] = no;
    this.setData({ selectedTickets: selected, selectedTicketsCount: Object.keys(selected).length });
  },

  // 全选/取消全选
  toggleSelectAllTickets() {
    const selected = { ...this.data.selectedTickets };
    const allSelected = this.data.ticketList.length > 0 && this.data.ticketList.every(t => selected[t._id]);
    if (allSelected) {
      this.setData({ selectedTickets: {}, selectedTicketsCount: 0 });
    } else {
      const next = {};
      this.data.ticketList.forEach(t => { next[t._id] = t.ticketNo; });
      this.setData({ selectedTickets: next, selectedTicketsCount: Object.keys(next).length });
    }
  },

  // 批量删除所选券
  doBatchDeleteTickets() {
    const selected = this.data.selectedTickets;
    const ids = Object.keys(selected);
    if (ids.length === 0) {
      wx.showToast({ title: '请先选择要删除的券', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '批量删除入场券',
      content: `确认删除选中的 ${ids.length} 张入场券？对应的签到记录将一并删除。`,
      confirmText: '删除',
      confirmColor: '#EF4444',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '批量删除中…', mask: true });
        try {
          const items = ids.map(id => ({ ticketId: id, ticketNo: selected[id] }));
          const result = await wx.cloud.callFunction({
            name: 'createActivity',
            data: { action: 'batchDeleteTickets', activityId: this.activityId, items },
          });
          wx.hideLoading();
          if (!result.result.success) throw new Error(result.result.error);
          wx.showToast({ title: `已删除 ${result.result.ticketDeleted} 张`, icon: 'success' });
          this.setData({ selectedTickets: {}, selectedTicketsCount: 0 });
          await this.loadTickets();
          this.loadActivity();
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: err.message || '删除失败', icon: 'none' });
        }
      },
    });
  },

  // 删除单张入场券
  doDeleteTicket(e) {
    const { id, no, checked } = e.currentTarget.dataset;
    if (!id || !no) return;
    wx.showModal({
      title: '删除入场券',
      content: checked
        ? `券 ${no} 已签到，删除后该签到记录将一并删除，确认删除？`
        : `确认删除入场券 ${no}？删除后该券将无法用于登录。`,
      confirmText: '删除',
      confirmColor: '#EF4444',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '删除中…', mask: true });
        try {
          const result = await wx.cloud.callFunction({
            name: 'createActivity',
            data: {
              action: 'deleteTicket',
              activityId: this.activityId,
              ticketId: id,
              ticketNo: no,
            },
          });
          wx.hideLoading();
          if (!result.result.success) throw new Error(result.result.error);
          wx.showToast({ title: '已删除', icon: 'success' });
          await this.loadTickets();
          this.loadActivity();
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: err.message || '删除失败', icon: 'none' });
        }
      },
    });
  },

  // 复制全部券号（换行分隔，便于打印/批量发放）
  copyAllTickets() {
    if (this.data.ticketList.length === 0) return;
    const text = this.data.ticketList.map(t => t.ticketNo).join('\n');
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: `已复制 ${this.data.ticketList.length} 个券号`, icon: 'none' }),
    });
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

  // 跳转到该参与者的领取项目核销页（安全模式下只有参与者记录 _id，凭此直达）
  gotoConfirm(e) {
    const { id } = e.currentTarget.dataset;
    if (!id) return;
    wx.navigateTo({
      url: `/pages/scan-confirm/scan-confirm?activityId=${this.activityId}&participantId=${id}`,
    });
  },

  // 预览签名图片（云文件ID需先转临时链接）
  async previewSignature(e) {
    const { fileId } = e.currentTarget.dataset;
    console.log('[签名预览] fileId =', fileId);
    if (!fileId) return;
    wx.showLoading({ title: '加载中…', mask: true });
    try {
      const res = await wx.cloud.getTempFileURL({ fileList: [fileId] });
      const item = res.fileList && res.fileList[0];
      console.log('[签名预览] getTempFileURL 返回 =', JSON.stringify(item));
      const tempUrl = item && item.tempFileURL;
      if (!tempUrl) {
        throw new Error(item ? `status:${item.status} ${item.errMsg || ''}` : '无返回');
      }
      wx.previewImage({
        urls: [tempUrl],
        current: tempUrl,
      });
    } catch (err) {
      console.error('预览签名失败', err);
      wx.showToast({ title: '查看签名失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  // 导出签到数据 Excel
  async exportCheckinData() {
    if (this.data.exportLoading) return;
    this.setData({ exportLoading: true });
    wx.showLoading({ title: '导出中…', mask: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'exportCheckinData',
        data: { activityId: this.activityId },
      });

      wx.hideLoading();

      if (!res.result.success) {
        throw new Error(res.result.error);
      }

      // 下载并打开 Excel
      const { fileID } = res.result;
      wx.showLoading({ title: '下载文件中…', mask: true });
      const dlRes = await wx.cloud.downloadFile({ fileID });
      wx.hideLoading();

      wx.openDocument({
        filePath: dlRes.tempFilePath,
        fileType: 'xlsx',
        showMenu: true,
        success: () => {
          wx.showToast({ title: '已打开，可分享/保存', icon: 'none' });
        },
        fail: () => {
          wx.showToast({ title: '文件已下载到临时路径', icon: 'none' });
        },
      });
    } catch (err) {
      console.error('导出失败', err);
      wx.hideLoading();
      wx.showToast({ title: '导出失败，请重试', icon: 'none' });
    } finally {
      this.setData({ exportLoading: false });
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
});
