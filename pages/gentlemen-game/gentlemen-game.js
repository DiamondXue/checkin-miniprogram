const app = getApp();

const GAME_SECONDS = 10;
// 主阈值：命中 8 件（80 分）；保底：命中 5 件，避免现场卡人
const PASS_SCORE = 80;
const PASS_HITS = 5;
const GIFT_EMOJIS = ['👔', '🎁', '☕', '⌚', '🍷', '💼', '👞', '🎩', '💐', '🧴'];
// 炸弹为干扰项：红色光圈 + 💣，与金色光圈礼物明显区分
const BOMB_EMOJI = '💣';
const BOMB_RATIO = 0.18;
const BOMB_PENALTY = 20;

Page({
  data: {
    ready: false,
    initError: false,
    timeLeft: GAME_SECONDS,
    progress: 100,
    score: 0,
    hits: 0,
    elapsedUsed: 0,
    finished: false,
    passed: false,
    urgent: false,
  },

  onLoad(options) {
    this.activityId = (options && options.activityId) || '';
    this._running = false;
    this._paused = false;
    this._finished = false;
    this._items = [];
    this._particles = [];
    this._floaters = [];
    this._score = 0;
    this._hits = 0;
    this._elapsed = 0;
    this._spawnTimer = 0;
    this._lastTs = 0;
    this._lastSecond = GAME_SECONDS;
    this._hudAcc = 0;
    this._rafId = null;
    this._autoBackTimer = null;
  },

  onReady() {
    this._initCanvas();
  },

  onShow() {
    // 从后台切回时继续游戏，计时不丢
    if (this._running && this._paused) this._resume();
  },

  onHide() {
    this._pause();
  },

  onUnload() {
    this._pause();
    if (this._autoBackTimer) {
      clearTimeout(this._autoBackTimer);
      this._autoBackTimer = null;
    }
  },

  // ---------- 初始化 ----------
  _initCanvas() {
    const query = wx.createSelectorQuery().in(this);
    query.select('#gameCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        const info = res && res[0];
        if (!info || !info.node || !info.width || !info.height) {
          this.setData({ initError: true, ready: false });
          return;
        }

        const canvas = info.node;
        const dpr = (wx.getWindowInfo && wx.getWindowInfo().pixelRatio)
          || (wx.getSystemInfoSync().pixelRatio)
          || 2;

        canvas.width = info.width * dpr;
        canvas.height = info.height * dpr;

        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        this._canvas = canvas;
        this._ctx = ctx;
        this._cw = info.width;
        this._ch = info.height;

        this.setData({ initError: false });

        if (!this._startedOnce) {
          this._startedOnce = true;
          this._startGame();
        }
      });
  },

  retryInit() {
    this.setData({ initError: false });
    this._initCanvas();
  },

  // ---------- 游戏生命周期 ----------
  _startGame() {
    if (!this._canvas) return;

    this._running = true;
    this._paused = false;
    this._finished = false;
    this._elapsed = 0;
    this._score = 0;
    this._hits = 0;
    this._items = [];
    this._particles = [];
    this._floaters = [];
    this._spawnTimer = 0.12;
    this._spawnCount = 0;
    this._lastTs = 0;
    this._lastSecond = GAME_SECONDS;
    this._hudAcc = 0;

    this.setData({
      ready: true,
      timeLeft: GAME_SECONDS,
      progress: 100,
      score: 0,
      hits: 0,
      elapsedUsed: 0,
      finished: false,
      passed: false,
      urgent: false,
    });

    this._loop();
  },

  restartGame() {
    if (this._autoBackTimer) {
      clearTimeout(this._autoBackTimer);
      this._autoBackTimer = null;
    }
    this._startGame();
  },

  _loop() {
    if (!this._canvas || !this._running) return;

    this._rafId = this._canvas.requestAnimationFrame((ts) => {
      this._rafId = null;
      if (!this._running || this._paused) return;

      // dt 上限 50ms，避免切后台回来后一次跳太多
      const dt = this._lastTs
        ? Math.min(Math.max((ts - this._lastTs) / 1000, 0), 0.05)
        : 0;
      this._lastTs = ts;

      this._update(dt);
      this._draw();

      if (this._running && !this._paused) this._loop();
    });
  },

  _pause() {
    if (!this._running) return;
    this._paused = true;
    if (this._rafId && this._canvas && this._canvas.cancelAnimationFrame) {
      this._canvas.cancelAnimationFrame(this._rafId);
    }
    this._rafId = null;
    this._lastTs = 0;
  },

  _resume() {
    if (!this._running || !this._paused) return;
    this._paused = false;
    this._lastTs = 0;
    this._loop();
  },

  // ---------- 帧更新 ----------
  _update(dt) {
    this._elapsed += dt;

    // 生成掉落物：10 秒内持续有目标，节奏更密
    this._spawnTimer -= dt;
    if (this._spawnTimer <= 0) {
      if (this._items.length < 14) this._spawnItem();
      this._spawnTimer = 0.16 + Math.random() * 0.12;
    }

    // 掉落物下落
    for (let i = this._items.length - 1; i >= 0; i--) {
      const it = this._items[i];
      it.y += it.vy * dt;
      it.phase += it.wobbleSpeed * dt;
      it.x = it.baseX + Math.sin(it.phase) * it.wobble;

      if (it.y > this._ch + it.r + 24) this._items.splice(i, 1);
    }

    // 命中粒子
    for (let i = this._particles.length - 1; i >= 0; i--) {
      const p = this._particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this._particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 120 * dt;
    }

    // 飘分
    for (let i = this._floaters.length - 1; i >= 0; i--) {
      const f = this._floaters[i];
      f.life -= dt;
      if (f.life <= 0) {
        this._floaters.splice(i, 1);
        continue;
      }
      f.y -= 50 * dt;
    }

    const remaining = Math.max(0, GAME_SECONDS - this._elapsed);
    const sec = Math.ceil(remaining);

    // 进度条每 0.2 秒刷新一次，10 秒倒计时更跟手；秒数变化时才更新数字
    this._hudAcc = (this._hudAcc || 0) + dt;
    if (this._hudAcc >= 0.2) {
      this._hudAcc = 0;
      const patch = {
        progress: Math.round((remaining / GAME_SECONDS) * 100),
        urgent: remaining <= 3,
      };
      if (sec !== this._lastSecond) {
        this._lastSecond = sec;
        patch.timeLeft = sec;
      }
      this.setData(patch);
    }

    if (remaining <= 0) this._finish();
  },

  _spawnItem() {
    const r = 22 + Math.random() * 8;
    const margin = r + 10;
    const w = this._cw || 320;
    const baseX = margin + Math.random() * Math.max(1, w - margin * 2);
    const speedUp = Math.min(this._elapsed * 8, 90);

    this._spawnCount = (this._spawnCount || 0) + 1;
    // 前 2 个必为礼物（开场不至于全屏炸弹），同屏炸弹不超过 3 个
    let isBomb = false;
    if (this._spawnCount > 2 && Math.random() < BOMB_RATIO) {
      const bombCount = this._items.filter((it) => it.type === 'bomb').length;
      isBomb = bombCount < 3;
    }

    this._items.push({
      type: isBomb ? 'bomb' : 'gift',
      emoji: isBomb ? BOMB_EMOJI : GIFT_EMOJIS[Math.floor(Math.random() * GIFT_EMOJIS.length)],
      baseX,
      x: baseX,
      y: -r - 20,
      r,
      vy: 200 + Math.random() * 110 + speedUp,
      phase: Math.random() * Math.PI * 2,
      wobble: 3 + Math.random() * 6,
      wobbleSpeed: 1.2 + Math.random() * 1.2,
    });
  },

  // ---------- 绘制 ----------
  _draw() {
    const ctx = this._ctx;
    if (!ctx) return;

    ctx.clearRect(0, 0, this._cw, this._ch);

    // 掉落物：礼物金色光圈，炸弹红色光圈，视觉上明确区分
    for (let i = 0; i < this._items.length; i++) {
      const it = this._items[i];
      const isBomb = it.type === 'bomb';

      ctx.beginPath();
      ctx.arc(it.x, it.y, it.r + 4, 0, Math.PI * 2);
      ctx.strokeStyle = isBomb ? 'rgba(248, 113, 113, 0.9)' : 'rgba(251, 191, 36, 0.55)';
      ctx.lineWidth = isBomb ? 3 : 2;
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${Math.round(it.r * 1.9)}px sans-serif`;
      ctx.fillText(it.emoji, it.x, it.y);
    }

    // 粒子
    for (let i = 0; i < this._particles.length; i++) {
      const p = this._particles[i];
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // 飘分
    for (let i = 0; i < this._floaters.length; i++) {
      const f = this._floaters[i];
      ctx.globalAlpha = Math.max(0, f.life / f.maxLife);
      ctx.fillStyle = f.color || '#FBBF24';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText(f.text, f.x, f.y);
      ctx.globalAlpha = 1;
    }
  },

  // ---------- 点击 ----------
  onTouchStart(e) {
    if (!this._running || this._paused || this._finished) return;

    const touch = e.touches && e.touches[0];
    if (!touch) return;
    const x = touch.x;
    const y = touch.y;

    for (let i = this._items.length - 1; i >= 0; i--) {
      const it = this._items[i];
      const dx = x - it.x;
      const dy = y - it.y;
      // 判定半径收紧到视觉半径 +2px，基本要点在 emoji 本体上
      if (dx * dx + dy * dy <= (it.r + 2) * (it.r + 2)) {
        this._items.splice(i, 1);
        this._onHit(it, x, y);
        return;
      }
    }

    // 点空不倒扣，只给一个淡出的水波纹反馈
    this._particles.push({
      x, y,
      vx: 0, vy: 0,
      size: 26,
      life: 0.35,
      maxLife: 0.35,
      color: 'rgba(255,255,255,0.35)',
    });
  },

  _onHit(item, x, y) {
    // 炸弹：扣分但不计命中；分数下限为 0
    if (item.type === 'bomb') {
      this._score = Math.max(0, this._score - BOMB_PENALTY);

      for (let i = 0; i < 8; i++) {
        const angle = (Math.PI * 2 * i) / 8 + Math.random() * 0.3;
        const speed = 40 + Math.random() * 50;
        this._particles.push({
          x: item.x,
          y: item.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 2.5 + Math.random() * 2,
          life: 0.45,
          maxLife: 0.45,
          color: '#F87171',
        });
      }

      this._floaters.push({
        x,
        y: y - item.r,
        text: `-${BOMB_PENALTY}`,
        color: '#F87171',
        life: 0.8,
        maxLife: 0.8,
      });

      this.setData({ score: this._score });

      if (wx.vibrateShort) {
        wx.vibrateShort({ type: 'medium', fail: () => {} });
      }
      return;
    }

    this._score += 10;
    this._hits += 1;

    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 * i) / 8 + Math.random() * 0.3;
      const speed = 40 + Math.random() * 50;
      this._particles.push({
        x: item.x,
        y: item.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 2.5 + Math.random() * 2,
        life: 0.45,
        maxLife: 0.45,
        color: i % 2 ? '#FBBF24' : '#FFF7D6',
      });
    }

    this._floaters.push({
      x,
      y: y - item.r,
      text: '+10',
      life: 0.7,
      maxLife: 0.7,
    });

    this.setData({ score: this._score, hits: this._hits });

    if (wx.vibrateShort) {
      wx.vibrateShort({ type: 'light', fail: () => {} });
    }
  },

  // ---------- 结算 ----------
  _finish() {
    if (!this._running) return;

    this._running = false;
    this._finished = true;

    if (this._rafId && this._canvas && this._canvas.cancelAnimationFrame) {
      this._canvas.cancelAnimationFrame(this._rafId);
    }
    this._rafId = null;
    this._lastTs = 0;

    const passed = this._score >= PASS_SCORE || this._hits >= PASS_HITS;

    this.setData({
      finished: true,
      passed,
      timeLeft: 0,
      progress: 0,
      score: this._score,
      hits: this._hits,
      elapsedUsed: Math.min(GAME_SECONDS, Math.round(this._elapsed)),
      urgent: false,
    });

    if (passed) {
      this._markPassed();
      this._autoBackTimer = setTimeout(() => {
        this._autoBackTimer = null;
        this._back();
      }, 1400);
    }
  },

  // 通关标记写入 globalData：同一次登录会话内不再拦截
  _markPassed() {
    const user = app.globalData.currentUser;
    app.globalData.gentlemenGamePassed = {
      staffId: (user && user.staffId) || '',
      activityId: this.activityId || '',
      passedAt: Date.now(),
    };
    // 通知 my-checkin 自动继续签到
    app.globalData.gentlemenGameResume = true;
  },

  onGiveUp() {
    this._back();
  },

  _back() {
    if (this._autoBackTimer) {
      clearTimeout(this._autoBackTimer);
      this._autoBackTimer = null;
    }

    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 });
    } else {
      const url = this.activityId
        ? `/pages/my-checkin/my-checkin?id=${this.activityId}`
        : '/pages/my-checkin/my-checkin';
      wx.reLaunch({ url });
    }
  },

  onShareAppMessage() {
    return {
      title: '男士节签到挑战',
      path: this.activityId
        ? `/pages/gentlemen-game/gentlemen-game?activityId=${this.activityId}`
        : '/pages/index/index',
    };
  },
});
