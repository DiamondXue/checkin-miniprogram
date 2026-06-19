const app = getApp();
const QRCode = require('../../utils/qrcode-mp');

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
        if (!res[0] || !res[0].node) {
          // canvas 还没渲染，延迟重试
          setTimeout(() => this.generateQRCode(user), 300);
          return;
        }
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const size = res[0].width || 200;

        // 生成 QR 码矩阵（经过验证的算法）
        const qr = QRCode.create(qrText, { errorCorrectionLevel: 'M' });
        const n = qr.modules.size;

        // 高清适配
        const dpr = wx.getSystemInfoSync().pixelRatio || 2;
        canvas.width = size * dpr;
        canvas.height = size * dpr;
        ctx.scale(dpr, dpr);

        // 背景
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, size, size);

        // 绘制模块
        const padding = size * 0.04; // 4% 边距
        const cellSize = (size - padding * 2) / n;
        ctx.fillStyle = '#000000';
        for (let r = 0; r < n; r++) {
          for (let c = 0; c < n; c++) {
            if (qr.modules.get(r, c)) {
              ctx.fillRect(
                padding + c * cellSize,
                padding + r * cellSize,
                Math.ceil(cellSize),
                Math.ceil(cellSize)
              );
            }
          }
        }
      });
  },

  onShareAppMessage() {
    return {
      title: '团建签到 - 我的签到码',
      path: `/pages/my-qrcode/my-qrcode?id=${this.activityId}`,
    };
  },
});
