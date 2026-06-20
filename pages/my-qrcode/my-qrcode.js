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
    qrcodeImagePath: '',
    myConfirmList: [],
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
      let activity = null;

      if (this.activityId) {
        const actRes = await db.collection('activities').doc(this.activityId).get();
        activity = actRes.data;
        this.setData({ activity });
      }

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

        // 仅在活动开启扫码确认时组装"我的领取情况"
        let myConfirmList = [];
        if (activity && activity.enableScanConfirm !== false) {
          const confirmItems = (pResult.result && pResult.result.confirmItems && pResult.result.confirmItems.length > 0)
            ? pResult.result.confirmItems
            : ((activity && activity.confirmItems && activity.confirmItems.length > 0)
              ? activity.confirmItems
              : [{ key: 'tea', label: '茶点' }, { key: 'gift', label: '礼品' }]);

          const remainingCounts = (activity && activity.remainingCounts) || {};
          myConfirmList = confirmItems.map(ci => {
            const c = this._getConfirmation(myRecord, ci.key);
            const unlimited = (ci.total === undefined || ci.total === null);
            return {
              key: ci.key,
              label: ci.label,
              confirmed: c.confirmed,
              at: c.at,
              by: c.by,
              total: ci.total,
              remaining: unlimited ? null : (remainingCounts[ci.key] !== undefined ? remainingCounts[ci.key] : null),
              unlimited,
            };
          });
        }

        this.setData({
          myChecked,
          myCheckedAt: myRecord ? (myRecord.checkedAt || '') : '',
          myConfirmList,
        });
      }

      this.setData({ loading: false }, () => {
        if (this.data.myChecked) {
          // 等待下一帧确保 canvas 节点完成布局后再绘制
          setTimeout(() => this.generateQRCode(user), 80);
        }
      });
    } catch (err) {
      console.error('加载失败', err);
      this.setData({ loading: false });
    }
  },

  /** 从参与者记录中读取确认状态，兼容新旧格式 */
  _getConfirmation(p, key) {
    if (!p) return { confirmed: false, at: '', by: '' };
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

  generateQRCode(user) {
    const qrText = JSON.stringify({
      staffId: user.staffId,
      name: user.name || ''
    });
    console.log('[QR] 开始生成, qrText:', qrText);

    const size = 200; // 与 WXSS 中的尺寸一致（逻辑像素）

    // 1) 通过 SelectorQuery 获取 Canvas 节点（type="2d"）
    const query = wx.createSelectorQuery().in(this);
    query.select('#qrcode-canvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) {
          console.error('[QR] 获取 Canvas 节点失败', res);
          return;
        }
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');

        // 2) 根据 dpr 设置画布尺寸（保证在高清屏上也清晰）
        const dpr = wx.getWindowInfo && wx.getWindowInfo().pixelRatio ||
                     (wx.getSystemInfoSync().pixelRatio) || 2;
        const physicalSize = size * dpr;
        canvas.width = physicalSize;
        canvas.height = physicalSize;
        ctx.scale(dpr, dpr);

        // 3) 生成 QR 码矩阵
        let qr;
        try {
          qr = QRCode.create(qrText, { errorCorrectionLevel: 'M' });
        } catch (e) {
          console.error('[QR] 生成矩阵失败:', e);
          return;
        }
        const n = qr.modules.size;
        console.log('[QR] 矩阵大小:', n);

        // 4) 白底
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, size, size);

        // 5) 绘制 QR 模块
        const padding = Math.floor(size * 0.04); // 8px 留白
        const cellSize = (size - padding * 2) / n;
        ctx.fillStyle = '#000000';

        // 优化：逐行构造 Path2D（如不支持，改为 fillRect）
        try {
          const path = canvas.createPath();
          for (let r = 0; r < n; r++) {
            for (let c = 0; c < n; c++) {
              if (qr.modules.get(r, c)) {
                const x = padding + c * cellSize;
                const y = padding + r * cellSize;
                path.rect(x, y, cellSize, cellSize);
              }
            }
          }
          ctx.fill(path);
        } catch (_e) {
          // 某些基础库版本不支持 Path2D 时的回退方案
          for (let r = 0; r < n; r++) {
            for (let c = 0; c < n; c++) {
              if (qr.modules.get(r, c)) {
                const x = padding + c * cellSize;
                const y = padding + r * cellSize;
                ctx.fillRect(x, y, cellSize, cellSize);
              }
            }
          }
        }
        console.log('[QR] canvas 绘制完成');

        // 6) 导出 PNG 临时文件（注意：type="2d" 的 canvasToTempFilePath 使用 canvas 而非 canvasId）
        setTimeout(() => {
          wx.canvasToTempFilePath({
            canvas: canvas,
            x: 0,
            y: 0,
            width: physicalSize,
            height: physicalSize,
            destWidth: size * 2,
            destHeight: size * 2,
            fileType: 'png',
            success: (r) => {
              console.log('[QR] 导出图片成功:', r.tempFilePath);
              this.setData({ qrcodeImagePath: r.tempFilePath });
            },
            fail: (err) => {
              console.error('[QR] 导出图片失败:', err);
              // 退而求其次：Canvas 本身已绘制在页面上，用户仍然可以看到二维码
            }
          }, this);
        }, 100);
      });
  },

  onShareAppMessage() {
    return {
      title: '团建签到 - 我的签到码',
      path: `/pages/my-qrcode/my-qrcode?id=${this.activityId}`
    };
  }
});
