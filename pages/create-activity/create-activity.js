const app = getApp();

Page({
  data: {
    isEdit: false,
    activityId: '',
    // 表单字段
    name: '',
    location: '',
    date: '',
    startTime: '09:00',
    endTime: '18:00',
    organizer: '',
    checkinRadius: 500,
    // 位置
    latitude: null,
    longitude: null,
    locationAddress: '',
    // 参与者
    participantInput: '',
    // 加载
    saving: false,
    loading: true,
  },

  onLoad(options) {
    if (options.id) {
      // 编辑模式
      this.setData({ isEdit: true, activityId: options.id });
      this.loadActivity(options.id);
    } else {
      this.setData({ loading: false });
      // 默认主办方为当前用户名
      const user = app.globalData.currentUser;
      if (user) {
        this.setData({ organizer: user.name || user.dept || '' });
      }
    }
  },

  async loadActivity(id) {
    try {
      const db = wx.cloud.database();
      const res = await db.collection('activities').doc(id).get();
      const act = res.data;
      this.setData({
        name: act.name || '',
        location: act.location || '',
        date: act.date || '',
        startTime: act.startTime || '09:00',
        endTime: act.endTime || '18:00',
        organizer: act.organizer || '',
        checkinRadius: act.checkinRadius || 500,
        latitude: act.latitude || null,
        longitude: act.longitude || null,
        locationAddress: act.latitude ? '已设置' : '',
        participantInput: (act.participantStaffIds || []).join(', '),
        loading: false,
      });
      wx.setNavigationBarTitle({ title: '编辑活动' });
    } catch (err) {
      console.error('加载活动失败', err);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [field]: e.detail.value });
  },

  onDateChange(e) {
    this.setData({ date: e.detail.value });
  },

  onStartTimeChange(e) {
    this.setData({ startTime: e.detail.value });
  },

  onEndTimeChange(e) {
    this.setData({ endTime: e.detail.value });
  },

  onRadiusInput(e) {
    this.setData({ checkinRadius: parseInt(e.detail.value) || 0 });
  },

  // 选择位置
  chooseLocation() {
    wx.chooseLocation({
      success: (res) => {
        this.setData({
          latitude: res.latitude,
          longitude: res.longitude,
          location: res.name || res.address || '',
          locationAddress: res.address || res.name || '',
        });
      },
      fail: (err) => {
        if (err.errMsg.indexOf('auth deny') !== -1 || err.errMsg.indexOf('authorize') !== -1) {
          wx.showModal({
            title: '位置权限',
            content: '需要授权位置信息才能选择地点，请在设置中开启',
            confirmText: '去设置',
            success: (modalRes) => {
              if (modalRes.confirm) {
                wx.openSetting();
              }
            }
          });
        }
      }
    });
  },

  // 清除位置
  clearLocation() {
    this.setData({ latitude: null, longitude: null, locationAddress: '' });
  },

  async doSave() {
    const { name, location, date, startTime, endTime, organizer, checkinRadius, saving, isEdit } = this.data;

    if (saving) return;

    // 表单验证
    if (!name.trim()) {
      wx.showToast({ title: '请输入活动名称', icon: 'none' });
      return;
    }
    if (!location.trim()) {
      wx.showToast({ title: '请输入活动地点', icon: 'none' });
      return;
    }
    if (!date) {
      wx.showToast({ title: '请选择活动日期', icon: 'none' });
      return;
    }
    if (!startTime || !endTime) {
      wx.showToast({ title: '请设置时间', icon: 'none' });
      return;
    }
    if (!organizer.trim()) {
      wx.showToast({ title: '请输入主办方', icon: 'none' });
      return;
    }

    // 解析参与者工号
    const participantInput = this.data.participantInput.trim();
    const participantStaffIds = participantInput
      ? participantInput.split(/[,，\s\n]+/).map(s => s.trim()).filter(s => s.length > 0)
      : [];

    if (participantStaffIds.length === 0) {
      wx.showModal({
        title: '无参与者',
        content: '未添加任何参与者工号，确认创建？',
        success: (res) => { if (res.confirm) this._save(participantStaffIds); }
      });
      return;
    }

    this._save(participantStaffIds);
  },

  async _save(participantStaffIds) {
    this.setData({ saving: true });

    const user = app.globalData.currentUser;
    const db = wx.cloud.database();
    const { isEdit, activityId, name, location, date, startTime, endTime, organizer, checkinRadius, latitude, longitude } = this.data;

    try {
      if (isEdit) {
        // 编辑模式：更新活动
        const updateData = {
          name: name.trim(),
          location: location.trim(),
          date,
          startTime,
          endTime,
          organizer: organizer.trim(),
          checkinRadius: parseInt(checkinRadius) || 0,
          latitude: latitude || null,
          longitude: longitude || null,
        };
        await db.collection('activities').doc(activityId).update({ data: updateData });
        wx.showToast({ title: '保存成功', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 800);
      } else {
        // 创建模式
        const res = await db.collection('activities').add({
          data: {
            name: name.trim(),
            location: location.trim(),
            date,
            startTime,
            endTime,
            organizer: organizer.trim(),
            checkinRadius: parseInt(checkinRadius) || 0,
            latitude: latitude || null,
            longitude: longitude || null,
            creatorStaffId: user.staffId,
            creatorName: user.name || user.staffId,
            participantStaffIds: participantStaffIds,
            createdAt: db.serverDate(),
          },
        });

        // 创建参与者子集合
        const actId = res._id;
        const pCol = db.collection('activities').doc(actId).collection('participants');

        // 查找参与者信息
        for (const staffId of participantStaffIds) {
          try {
            const uRes = await db.collection('users').where({ staffId }).limit(1).get();
            const u = uRes.data[0];
            await pCol.add({
              data: {
                staffId,
                name: u ? u.name : staffId,
                dept: u ? (u.dept || '') : '',
                checked: false,
                checkedAt: '',
              },
            });
          } catch (e) {
            // 用户不存在也写入
            await pCol.add({
              data: { staffId, name: staffId, dept: '', checked: false, checkedAt: '' },
            });
          }
        }

        wx.showToast({ title: '创建成功', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 800);
      }
    } catch (err) {
      console.error('保存失败', err);
      this.setData({ saving: false });
      wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    }
  },

  // 删除活动（编辑模式）
  doDelete() {
    wx.showModal({
      title: '删除活动',
      content: '确认删除此活动？此操作不可恢复。',
      confirmColor: '#EF4444',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          const db = wx.cloud.database();
          const { activityId } = this.data;

          // 删除参与者子集合
          // 云端只能通过云函数删除子集合，小程序端只能删主文档
          await db.collection('activities').doc(activityId).remove();

          wx.showToast({ title: '已删除', icon: 'success' });
          setTimeout(() => wx.navigateBack(), 800);
        } catch (err) {
          console.error('删除失败', err);
          wx.showToast({ title: '删除失败', icon: 'none' });
        }
      }
    });
  },
});
