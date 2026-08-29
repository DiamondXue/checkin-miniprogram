Component({
  properties: {},
  data: {
    canvasWidth: 0,
    canvasHeight: 0,
    hasStrokes: false,
  },
  lifetimes: {
    attached() {
      this._initCanvas();
    },
  },
  methods: {
    _initCanvas() {
      const query = this.createSelectorQuery();
      query.select('#signatureCanvas').fields({ node: true, size: true }).exec((res) => {
        if (!res[0]) return;
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const dpr = wx.getWindowInfo().pixelRatio || 2;

        const width = res[0].width;
        const height = res[0].height;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        // 白色背景
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);

        // 签名线条样式
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#111827';

        this._canvas = canvas;
        this._ctx = ctx;
        this._width = width;
        this._height = height;
        this._lastPoint = null;

        this.setData({ canvasWidth: width, canvasHeight: height });
      });
    },

    // 触摸开始
    onTouchStart(e) {
      const touch = e.touches[0];
      this._lastPoint = { x: touch.x, y: touch.y };
      this._ctx.beginPath();
      this._ctx.moveTo(touch.x, touch.y);
      this.setData({ hasStrokes: true });
    },

    // 触摸移动
    onTouchMove(e) {
      if (!this._lastPoint) return;
      const touch = e.touches[0];
      this._ctx.lineTo(touch.x, touch.y);
      this._ctx.stroke();
      this._ctx.beginPath();
      this._ctx.moveTo(touch.x, touch.y);
      this._lastPoint = { x: touch.x, y: touch.y };
    },

    // 触摸结束
    onTouchEnd() {
      this._lastPoint = null;
    },

    // 清空画布
    clear() {
      if (!this._ctx) return;
      this._ctx.fillStyle = '#FFFFFF';
      this._ctx.fillRect(0, 0, this._width, this._height);
      this._ctx.beginPath();
      this.setData({ hasStrokes: false });
    },

    // 导出临时图片路径，返回 Promise
    exportImage() {
      return new Promise((resolve, reject) => {
        if (!this._canvas) {
          reject(new Error('画布未初始化'));
          return;
        }
        if (!this.data.hasStrokes) {
          reject(new Error('请先签名'));
          return;
        }
        wx.canvasToTempFilePath({
          canvas: this._canvas,
          fileType: 'png',
          quality: 1,
          success: (res) => resolve(res.tempFilePath),
          fail: (err) => reject(err),
        });
      });
    },
  },
});
