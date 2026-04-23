const app = getApp();

Page({
  data: {
    staffId: '',
    inputFocus: false,
    inputError: false,
    errorMsg: '',
    loading: false,
    canLogin: false,
  },

  onLoad() {
    if (app.globalData.currentUser) {
      wx.reLaunch({ url: '/pages/index/index' });
    }
  },

  onInput(e) {
    const val = e.detail.value.replace(/\D/g, '');
    const canLogin = val.length === 8;
    this.setData({
      staffId: val,
      canLogin,
      inputError: false,
      errorMsg: '',
    });
  },

  onFocus() { this.setData({ inputFocus: true }); },
  onBlur() { this.setData({ inputFocus: false }); },

  clearInput() {
    this.setData({ staffId: '', canLogin: false, errorMsg: '', inputError: false });
  },

  async doLogin() {
    const { staffId, canLogin, loading } = this.data;
    if (!canLogin || loading) return;

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
        wx.showToast({ title: `欢迎，${userInfo.name || staffId}`, icon: 'success' });

        setTimeout(() => {
          wx.reLaunch({ url: '/pages/index/index' });
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
});
