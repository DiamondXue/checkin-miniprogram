const app = getApp();

Page({
  data: {
    activityId: '',
    loading: true,
    loadError: '',
    // 收集配置（来自云函数 getVoteData）
    vote: null,            // { title, type, options, minChoices, maxChoices, status, startedAt, endedAt }
    votedCount: 0,
    results: [],           // [{ key, label, count, pct }]
    myBallot: null,        // { choices: [] }
    // 收集表单状态
    selected: {},          // { optionKey: true }
    selectedCount: 0,
    submitting: false,
    // 本人已选（WXML 不支持函数调用，预计算）
    myChoiceMap: {},
    myChoiceText: '',
  },

  onLoad(options) {
    this.activityId = options.id || '';
    if (!this._checkLogin()) return;
    this.loadData();
  },

  onShow() {
    // 登录后返回：globalData 中保存了待进入的活动
    if (!this.activityId && app.globalData.pendingActivityId) {
      this.activityId = app.globalData.pendingActivityId;
      delete app.globalData.pendingActivityId;
      if (this._checkLogin()) this.loadData();
    }
  },

  // 登录检查：未登录则记录目标活动并跳转登录页
  _checkLogin() {
    const user = app.globalData.currentUser;
    if (!user || !user.staffId) {
      if (this.activityId) {
        app.globalData.pendingActivityId = this.activityId;
      }
      wx.redirectTo({ url: '/pages/login/login' });
      return false;
    }
    return true;
  },

  async loadData() {
    if (!this.activityId) return;
    this.setData({ loading: true, loadError: '' });
    const user = app.globalData.currentUser;
    try {
      const res = await wx.cloud.callFunction({
        name: 'createActivity',
        data: {
          action: 'getVoteData',
          activityId: this.activityId,
          voterId: user.staffId,
        },
      });
      if (!res.result.success) {
        this.setData({ loading: false, loadError: res.result.error || '加载失败' });
        return;
      }
      const r = res.result;
      // WXML 不支持函数调用，预计算本人已选选项映射与文案
      const myChoiceMap = {};
      let myChoiceText = '';
      if (r.myBallot && Array.isArray(r.myBallot.choices)) {
        r.myBallot.choices.forEach(k => { myChoiceMap[k] = true; });
        const opts = (r.vote && r.vote.options) || [];
        myChoiceText = opts
          .filter(o => myChoiceMap[o.key])
          .map(o => o.label)
          .join('、');
      }
      this.setData({
        loading: false,
        vote: r.vote,
        votedCount: r.votedCount,
        results: r.results || [],
        myBallot: r.myBallot,
        myChoiceMap,
        myChoiceText,
      });
      wx.setNavigationBarTitle({ title: r.vote.title || '意向收集' });
    } catch (err) {
      console.error('加载意向收集失败', err);
      this.setData({ loading: false, loadError: '加载失败，请重试' });
    }
  },

  // 选择/取消选项
  onToggleOption(e) {
    const key = e.currentTarget.dataset.key;
    const { vote, selected, myBallot } = this.data;
    if (!vote || vote.status !== 'open' || myBallot) return;

    if (vote.type === 'single') {
      this.setData({ selected: { [key]: true }, selectedCount: 1 });
      return;
    }

    const next = { ...selected };
    if (next[key]) {
      delete next[key];
    } else {
      const max = vote.maxChoices !== undefined ? vote.maxChoices : (vote.options || []).length;
      if (this.data.selectedCount >= max) {
        wx.showToast({ title: `最多可选 ${max} 项`, icon: 'none' });
        return;
      }
      next[key] = true;
    }
    this.setData({ selected: next, selectedCount: Object.keys(next).length });
  },

  // 提交意向
  async doSubmit() {
    const { vote, selected, submitting, myBallot } = this.data;
    if (submitting || myBallot) return;
    if (vote.status !== 'open') {
      wx.showToast({ title: vote.status === 'pending' ? '收集尚未开始' : '收集已结束', icon: 'none' });
      return;
    }

    const choices = Object.keys(selected);
    if (vote.type === 'single') {
      if (choices.length !== 1) {
        wx.showToast({ title: '请选择一个选项', icon: 'none' });
        return;
      }
    } else {
      const min = vote.minChoices !== undefined ? vote.minChoices : 1;
      const max = vote.maxChoices !== undefined ? vote.maxChoices : (vote.options || []).length;
      if (choices.length < min || choices.length > max) {
        wx.showToast({ title: `请选择 ${min} ~ ${max} 个选项`, icon: 'none' });
        return;
      }
    }

    this.setData({ submitting: true });
    try {
      const user = app.globalData.currentUser;
      const res = await wx.cloud.callFunction({
        name: 'createActivity',
        data: {
          action: 'submitVote',
          activityId: this.activityId,
          voterId: user.staffId,
          choices,
        },
      });
      if (!res.result.success) {
        throw new Error(res.result.error);
      }
      wx.showToast({ title: '提交成功', icon: 'success' });
      this.loadData();
    } catch (err) {
      console.error('提交失败', err);
      wx.showToast({ title: err.message || '提交失败，请重试', icon: 'none' });
    }
    this.setData({ submitting: false });
  },

  onRetry() {
    this.loadData();
  },
});
