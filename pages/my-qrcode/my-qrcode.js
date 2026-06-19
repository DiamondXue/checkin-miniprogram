const app = getApp();
const { drawQR } = require('../../utils/qrcode');

Page({
  data: {
    activityId: '',
    activity: null,
    userInfo: null,
    myChecked: false,
    myCheckedAt: '',
    loading: true,
  },

  onLoad(options) {
    this.activityId = options.id || '';
    this.loadData();
  },

  async loadData() {
    const user = app.globalData.currentUser;
    if (!user || !user.staffId) {
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }

    this.setData({ userInfo: user, loading: true });

    try {
      const db = wx.cloud.database();

      // 加载活动信息
      if (this.activityId) {
        const actRes = await db.collection('activities').doc(this.activityId).get();
        this.setData({ activity: actRes.data });
      }

      // 加载签到记录
      if (this.activityId) {
        const pResult = await wx.cloud.callFunction({
          name: 'createActivity',
          data: {
            action: 'getParticipant',
            activityId: this.activityId,
            staffId: user.staffId,
          },
        });
        const myRecord = pResult.result.success ? pResult.result.record : null;
        const myChecked = !!myRecord && !!myRecord.checked;
        this.setData({
          myChecked,
          myCheckedAt: myRecord ? (myRecord.checkedAt || '') : '',
        });
      }

      this.setData({ loading: false });

      // 已签到则生成 QR 码
      if (this.data.myChecked) {
        this.generateQRCode(user);
      }
    } catch (err) {
      console.error('加载失败', err);
      this.setData({ loading: false });
    }
  },

  generateQRCode(user) {
    // QR 码内容：包含 staffId 和 name，方便管理员识别
    const qrText = JSON.stringify({
      staffId: user.staffId,
      name: user.name || '',
    });

    const query = wx.createSelectorQuery();
    query.select('#qrcode-canvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res[0]) {
          // canvas 还没渲染，延迟重试
          setTimeout(() => this.generateQRCode(user), 300);
          return;
        }
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        drawQR(canvas, ctx, { text: qrText, size: 200 });
      });
  },

  onShareAppMessage() {
    return {
      title: '团建签到 - 我的签到码',
      path: `/pages/my-qrcode/my-qrcode?id=${this.activityId}`,
    };
  },
});
