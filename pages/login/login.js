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
    // 已登录则直接跳过登录页
    if (app.globalData.currentUser) {
      wx.reLaunch({ url: '/pages/index/index' });
    }
  },

  onInput(e) {
    const val = e.detail.value.replace(/\D/g, ''); // 只保留数字
    const canLogin = val.length === 8;
    this.setData({
      staffId: val,
      canLogin,
      inputError: false,
      errorMsg: '',
    });
  },

  onFocus() {
    this.setData({ inputFocus: true });
  },

  onBlur() {
    this.setData({ inputFocus: false });
  },

  clearInput() {
    this.setData({ staffId: '', canLogin: false, errorMsg: '', inputError: false });
  },

  async doLogin() {
    const { staffId, canLogin, loading } = this.data;
    if (!canLogin || loading) return;

    // 基础格式校验
    if (!/^\d{8}$/.test(staffId)) {
      this.setData({ inputError: true, errorMsg: '工号必须是 8 位数字' });
      return;
    }

    this.setData({ loading: true, errorMsg: '' });

    try {
      // 查询云数据库 administrators 集合
      const db = wx.cloud.database();
      const res = await db.collection('administrators')
        .where({ staffId })
        .limit(1)
        .get();

      if (res.data && res.data.length > 0) {
        const user = res.data[0];
        const userInfo = {
          staffId: user.staffId,
          name: user.name || '',
          dept: user.dept || '',
        };

        // 保存登录态
        app.globalData.currentUser = userInfo;
        wx.setStorageSync('currentUser', userInfo);

        wx.showToast({ title: `欢迎，${userInfo.name || staffId}`, icon: 'success' });

        setTimeout(() => {
          wx.reLaunch({ url: '/pages/index/index' });
        }, 800);
      } else {
        this.setData({
          inputError: true,
          errorMsg: '工号不存在或无管理员权限，请联系活动负责人',
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
