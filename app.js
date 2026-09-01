const api = require('./utils/api');
const appConfig = require('./config');

App({
  onLaunch() {
    console.info('航迹协作已启动');
    this.setupUpdateManager();
    this.loginPromise = new Promise((resolve) => {
      if (typeof dd === 'undefined' || !dd.getAuthCode) {
        this.globalData.loginError = '请在钉钉客户端或开发者工具中运行';
        resolve(null);
        return;
      }
      const configuredCorpId = String(appConfig.corpId || '').trim();
      const runtimeCorpId = typeof dd.corpId === 'string' ? dd.corpId.trim() : '';
      const effectiveCorpId = runtimeCorpId || configuredCorpId;
      if (!effectiveCorpId) {
        this.globalData.loginError = '请先在 config.js 配置企业 CorpId';
        this.globalData.authStage = 'failed';
        console.error('缺少 dd.getAuthCode 所需的 corpId');
        resolve(null);
        return;
      }
      let callbackHandled = false;
      const handleAuthSuccess = (res) => {
        if (callbackHandled) return;
        callbackHandled = true;
        const authCode = res && (res.authCode || res.code);
        if (!authCode) {
          this.globalData.loginError = '钉钉未返回免登授权码';
          this.globalData.authStage = 'failed';
          console.error('免登响应中缺少 authCode/code', res);
          resolve(null);
          return;
        }
        this.globalData.authCode = authCode;
        this.globalData.authStage = 'exchanging_code';
        api.loginWithDingTalk(authCode)
            .then((result) => {
              this.globalData.sessionToken = result.token;
              this.globalData.currentUser = result.user;
              this.globalData.loginError = '';
              this.globalData.authStage = 'authenticated';
              if (dd.setStorageSync) {
                try {
                  dd.setStorageSync({ key: 'hangji_session', data: result.token });
                } catch (error) {
                  console.warn('会话本地缓存失败', error);
                }
              }
              console.info('钉钉免登完成');
              resolve(result);
            })
            .catch((error) => {
              this.globalData.loginError = error.message;
              console.error('服务端免登失败', error);
              this.globalData.authStage = 'failed';
              resolve(null);
            });
      };
      const handleAuthFail = (error) => {
        if (callbackHandled) return;
        callbackHandled = true;
        this.globalData.loginError = '获取钉钉授权码失败';
        this.globalData.authStage = 'failed';
        console.error('获取免登授权码失败', error);
        resolve(null);
      };
      this.globalData.authStage = 'requesting_code';
      console.info('getAuthCode corpId 检查', {
        source: runtimeCorpId ? 'dd.corpId' : 'config.js',
        type: typeof effectiveCorpId,
        length: effectiveCorpId.length,
        prefix: effectiveCorpId.slice(0, 8)
      });
      // 保持与钉钉官方小程序示例完全一致的参数结构。
      const authOptions = {
        corpId: effectiveCorpId,
        success: handleAuthSuccess,
        fail: handleAuthFail,
        complete: () => {}
      };
      dd.getAuthCode(authOptions);
    });
  },

  setupUpdateManager() {
    if (typeof dd === 'undefined' || !dd.getUpdateManager) return;
    try {
      const updateManager = dd.getUpdateManager();
      updateManager.onCheckForUpdate((result) => {
        console.info('小程序版本检查完成', result && result.hasUpdate ? '发现新版本' : '当前已是最新版本');
      });
      updateManager.onUpdateReady(() => {
        console.info('新版本已下载，正在自动重启应用');
        updateManager.applyUpdate();
      });
      updateManager.onUpdateFailed(() => {
        console.warn('新版本下载失败，将在下次进入时重试');
      });
      this.updateManager = updateManager;
    } catch (error) {
      console.warn('当前钉钉客户端无法启用小程序更新管理', error);
    }
  },

  globalData: {
    authCode: '',
    sessionToken: '',
    currentUser: null,
    loginError: '',
    authStage: 'idle'
  }
});
