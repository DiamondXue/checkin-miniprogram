const SESSION_KEY = 'session';
const LEGACY_USER_KEY = 'currentUser';

App({
  globalData: {
    currentUser: null,  // { staffId, name, dept, roles, isTicket, activityId }，仅由服务端校验后写入
    session: null,      // 本地只保存身份标识 { staffId, activityId }，不含 roles/name/dept
    sessionPromise: null,
    pendingActivityId: null,  // 登录后待跳转的活动ID
    cloudEnvId: 'cloud1-d9gq1b47d1a6184ac',
  },

  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({
        env: this.globalData.cloudEnvId,
        traceUser: true,
      });
    } else {
      console.error('请使用 2.2.3 以上的基础库版本');
    }

    // 强制更新检查
    if (wx.canIUse('getUpdateManager')) {
      const updateManager = wx.getUpdateManager();
      updateManager.onCheckForUpdate((res) => {
        if (res.hasUpdate) {
          console.log('发现新版本');
        }
      });
      updateManager.onUpdateReady(() => {
        wx.showModal({
          title: '版本更新',
          content: '新版本已就绪，点击确定重启应用',
          showCancel: false,
          success: () => {
            updateManager.applyUpdate();
          },
        });
      });
      updateManager.onUpdateFailed(() => {
        console.warn('新版本下载失败');
      });
    }

    // 恢复登录态：本地只信身份标识，权限与资料以服务端校验结果为准
    this.restoreSession();
  },

  // 读取本地身份标识并发起服务端校验（不直接用缓存放行）
  restoreSession() {
    let session = wx.getStorageSync(SESSION_KEY);

    // 旧版本缓存里带有 roles/name/dept，属于可伪造字段：迁移时只取身份标识
    if (!session) {
      const legacy = wx.getStorageSync(LEGACY_USER_KEY);
      if (legacy && legacy.staffId) {
        session = {
          staffId: legacy.staffId,
          activityId: legacy.activityId || '',
        };
      }
    }
    // 旧缓存一律删除，避免被继续读取
    wx.removeStorageSync(LEGACY_USER_KEY);

    if (!session || !session.staffId) return;

    this.globalData.session = session;
    this.globalData.sessionPromise = this._verifySession(session.staffId);
  },

  // 向服务端确认工号 / 入场券仍然有效，并取回可信的 roles
  async _verifySession(staffId) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'auth',
        data: { action: 'verifySession', staffId },
      });
      const result = (res && res.result) || {};

      if (!result.success || !result.user) {
        // 工号已被删除 / 入场券已作废：清除本地登录态
        this.clearSession();
        return null;
      }

      return this.applyUser(result.user);
    } catch (err) {
      // 网络异常等临时失败：保留身份标识，但不写入 currentUser，也不放行任何权限
      console.error('登录态校验失败', err);
      this.globalData.sessionPromise = null;
      return null;
    }
  },

  // 写入服务端返回的可信用户信息；本地只持久化身份标识
  applyUser(user) {
    const roles = Array.isArray(user.roles) && user.roles.length ? user.roles : ['user'];
    const safeUser = {
      staffId: user.staffId,
      name: user.name || '',
      dept: user.dept || '',
      roles,
      isTicket: !!user.isTicket,
      activityId: user.activityId || '',
    };

    this.globalData.currentUser = safeUser;
    this.globalData.session = {
      staffId: safeUser.staffId,
      activityId: safeUser.activityId,
    };
    this.globalData.sessionPromise = Promise.resolve(safeUser);
    wx.setStorageSync(SESSION_KEY, this.globalData.session);

    return safeUser;
  },

  // 主动向服务端校验某个工号 / 券号（入场券登录后调用）
  verifySession(staffId) {
    return this._verifySession(staffId);
  },

  // 页面使用：确保当前会话已通过服务端校验
  ensureSession() {
    if (this.globalData.currentUser) return Promise.resolve(this.globalData.currentUser);
    if (this.globalData.sessionPromise) return this.globalData.sessionPromise;
    if (this.globalData.session && this.globalData.session.staffId) {
      this.globalData.sessionPromise = this._verifySession(this.globalData.session.staffId);
      return this.globalData.sessionPromise;
    }
    return Promise.resolve(null);
  },

  // 清除本地登录态（身份标识 + 内存用户）
  clearSession() {
    this.globalData.currentUser = null;
    this.globalData.session = null;
    this.globalData.sessionPromise = null;
    wx.removeStorageSync(SESSION_KEY);
    wx.removeStorageSync(LEGACY_USER_KEY);
  },

  // 判断当前用户是否是管理员
  isAdmin() {
    const user = this.globalData.currentUser;
    return user && Array.isArray(user.roles) && user.roles.includes('admin');
  },

  // 判断当前用户是否是活动创建人（organizer）
  isOrganizer() {
    const user = this.globalData.currentUser;
    return user && Array.isArray(user.roles) && user.roles.includes('organizer');
  },

  // 判断当前用户是否是活动操作员（operator）
  // operator 可以查看和管理所有活动的参与者，可以编辑活动，但不能删除
  isOperator() {
    const user = this.globalData.currentUser;
    return user && Array.isArray(user.roles) && user.roles.includes('operator');
  },

  // 判断当前用户是否可以管理某个活动
  // admin      → 管理所有活动
  // operator   → 管理所有活动（仅扫码确认/参与人，不可编辑/导出/删除）
  // organizer   → 仅管理自己创建的活动
  canManageActivity(activity) {
    if (this.isAdmin() || this.isOperator()) return true;
    if (this.isOrganizer() && activity && activity.creatorStaffId === this.globalData.currentUser.staffId) {
      return true;
    }
    return false;
  },

  // 判断当前用户是否可以编辑/导出/删除活动及名单内签到核销
  // admin      → 所有活动
  // organizer  → 仅自己创建的活动
  // operator   → 不可
  canDeleteActivity(activity) {
    if (this.isAdmin()) return true;
    if (this.isOrganizer() && activity && activity.creatorStaffId === this.globalData.currentUser.staffId) {
      return true;
    }
    return false;
  },

  // 退出登录
  logout() {
    this.clearSession();
    this.globalData.pendingActivityId = null;
    wx.reLaunch({ url: '/pages/login/login' });
  }
});
