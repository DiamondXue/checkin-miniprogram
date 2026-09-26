const app = getApp();

Page({
  data: {
    // 登录方式：ticket 入场券 / staff 员工工号
    loginMode: 'ticket',
    staffId: '',
    ticketNo: '',
    inputFocus: false,
    inputError: false,
    errorMsg: '',
    loading: false,
    canLogin: false,
  },

  onLoad() {
    const user = app.globalData.currentUser;
    if (user) {
      // 入场券用户直达其绑定活动，避免落到首页
      const roles = Array.isArray(user.roles) ? user.roles : [];
      if (roles.includes('ticket') && user.activityId) {
        wx.reLaunch({ url: `/pages/my-checkin/my-checkin?id=${user.activityId}` });
      } else {
        wx.reLaunch({ url: '/pages/index/index' });
      }
    }
  },

  // 切换登录方式
  switchMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (mode === this.data.loginMode || this.data.loading) return;
    this.setData({
      loginMode: mode,
      staffId: '',
      ticketNo: '',
      canLogin: false,
      inputError: false,
      errorMsg: '',
    });
  },

  // 员工工号输入：仅数字，8 位
  onStaffInput(e) {
    const val = e.detail.value.replace(/\D/g, '');
    this.setData({
      staffId: val,
      canLogin: val.length === 8,
      inputError: false,
      errorMsg: '',
    });
  },

  // 入场券输入：首位大写字母 + 7 位数字
  onTicketInput(e) {
    let val = (e.detail.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (val.length > 8) val = val.slice(0, 8);
    // 第1位必须是字母，后续必须是数字
    if (val.length >= 1 && !/^[A-Z]$/.test(val[0])) val = val.slice(1);
    if (val.length > 1) val = val[0] + val.slice(1).replace(/\D/g, '');
    this.setData({
      ticketNo: val,
      canLogin: /^[A-Z]\d{7}$/.test(val),
      inputError: false,
      errorMsg: '',
    });
  },

  onFocus() { this.setData({ inputFocus: true }); },
  onBlur() { this.setData({ inputFocus: false }); },

  clearInput() {
    if (this.data.loginMode === 'staff') {
      this.setData({ staffId: '', canLogin: false, errorMsg: '', inputError: false });
    } else {
      this.setData({ ticketNo: '', canLogin: false, errorMsg: '', inputError: false });
    }
  },

  async doLogin() {
    const { loginMode, canLogin, loading } = this.data;
    if (!canLogin || loading) return;
    if (loginMode === 'staff') this.doStaffLogin();
    else this.doTicketLogin();
  },

  // 员工工号登录
  async doStaffLogin() {
    const { staffId } = this.data;

    if (!/^\d{8}$/.test(staffId)) {
      this.setData({ inputError: true, errorMsg: '工号必须是 8 位数字' });
      return;
    }

    this.setData({ loading: true, errorMsg: '' });

    try {
      const db = wx.cloud.database();
      const res = await db.collection('users')
        .where({ staffId })
        .limit(1)
        .get();

      if (res.data && res.data.length > 0) {
        const user = res.data[0];
        const userInfo = {
          _id: user._id,
          staffId: user.staffId,
          name: user.name || '',
          dept: user.dept || '',
          roles: Array.isArray(user.roles) ? user.roles : (user.role ? [user.role] : ['user']),
        };

        app.globalData.currentUser = userInfo;
        wx.setStorageSync('currentUser', userInfo);

        // 角色提示
        const roleLabels = { admin: '管理员', organizer: '活动创建人', user: '成员' };
        const roleText = userInfo.roles.map(r => roleLabels[r] || r).join(' / ');
        console.log(`用户角色：${roleText}`);
        // 不显示登录者姓名，仅用工号欢迎
        wx.showToast({ title: `欢迎，${userInfo.staffId}`, icon: 'success' });

        setTimeout(() => {
          // 检是否有待跳转的签到活动
          const pendingId = app.globalData.pendingActivityId;
          if (pendingId) {
            delete app.globalData.pendingActivityId;
            wx.reLaunch({ url: `/pages/my-checkin/my-checkin?id=${pendingId}` });
          } else {
            wx.reLaunch({ url: '/pages/index/index' });
          }
        }, 800);
      } else {
        this.setData({
          inputError: true,
          errorMsg: '工号未注册，请联系活动负责人添加',
          loading: false,
        });
      }
    } catch (err) {
      console.error('登录失败', err);
      this.setData({
        inputError: true,
        errorMsg: '网络异常，请稍后重试',
        loading: false,
      });
    }
  },

  // 入场券登录
  async doTicketLogin() {
    const ticketNo = this.data.ticketNo;
    if (!/^[A-Z]\d{7}$/.test(ticketNo)) {
      this.setData({ inputError: true, errorMsg: '入场券为 1 位大写字母 + 7 位数字' });
      return;
    }

    this.setData({ loading: true, errorMsg: '' });

    try {
      // 券校验统一走云函数（管理员身份查询，不受集合权限规则影响）
      const res = await wx.cloud.callFunction({
        name: 'createActivity',
        data: { action: 'loginByTicket', ticketNo },
      });
      const result = res.result || {};
      if (!result.success) {
        this.setData({ inputError: true, errorMsg: result.error || '入场券无效', loading: false });
        return;
      }

      // 以券号作为身份标识（与8位数字工号天然不冲突）
      const userInfo = {
        _id: result.ticketId,
        staffId: ticketNo,
        name: ticketNo,
        dept: '',
        roles: ['ticket'],
        isTicket: true,
        activityId: result.activityId,
      };
      app.globalData.currentUser = userInfo;
      wx.setStorageSync('currentUser', userInfo);

      wx.showToast({ title: `欢迎，${ticketNo}`, icon: 'success' });

      // 券号绑定指定活动，登录后直达该活动签到页
      setTimeout(() => {
        wx.reLaunch({ url: `/pages/my-checkin/my-checkin?id=${result.activityId}` });
      }, 800);
    } catch (err) {
      console.error('入场券登录失败', err);
      this.setData({
        inputError: true,
        errorMsg: '网络异常，请稍后重试',
        loading: false,
      });
    }
  },

  onShareAppMessage() {
    return {
      title: '团建签到',
      path: '/pages/index/index',
    };
  },

  onShareTimeline() {
    return {
      title: '团建签到',
    };
  },
});
