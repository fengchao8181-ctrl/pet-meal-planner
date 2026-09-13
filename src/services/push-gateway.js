// 推送网关：向微信下发触达
//  - MockPushGateway：本地/无凭证时的降级兜底（record 下发、返回成功回执），保证链路可跑
//  - WechatH5PushGateway：真实公众号服务号「模板消息」H5 下发（需要 appid/appSecret/H5_TEMPLATE_ID）
// 对外统一接口：sendH5({ petKey, openid, content }) / sendSubscribe({ openid, templateId, data, page })
// 凭证缺失自动降级到 Mock（用户偏好：接口失败不阻塞进程，降级本地规则保链路）。
// 并发安全：_accessToken 带 in-flight 锁 + 失败指数退避，避免 EdgeOne 多实例/高并发首请求「刷新风暴」

// ---- Mock：本地/演示/凭证缺失兜底 ----
export class MockPushGateway {
  constructor() {
    this.name = 'mock';
    this.sent = []; // 下发记录（测试/联调可断言）
  }
  async sendH5({ petKey, openid, content }) {
    const rec = { id: crypto.randomUUID(), channel: 'h5', petKey, openid: openid || null, scene: content.scene, title: content.title, body: content.body, at: new Date().toISOString() };
    this.sent.push(rec);
    return { ok: true, errcode: 0, errmsg: 'ok', logId: rec.id, gateway: 'mock' };
  }
  async sendSubscribe({ openid, templateId, data, page }) {
    const rec = { id: crypto.randomUUID(), channel: 'subscribe', openid, templateId, page: page || null, data, at: new Date().toISOString() };
    this.sent.push(rec);
    return { ok: true, errcode: 0, errmsg: 'ok', logId: rec.id, gateway: 'mock' };
  }
}

// ---- 真实：公众号模板消息 H5 下发（访问令牌集中管理 + 缓存到过期前 5 分钟刷新）----
// 并发安全：in-flight Promise 共享 + 失败指数退避，防止高并发/多实例首请求时的刷新风暴
export class WechatH5PushGateway {
  constructor({ appid, appSecret, h5TemplateId, nowFn }) {
    this.name = 'wechat';
    this.appid = appid;
    this.appSecret = appSecret;
    this.h5TemplateId = h5TemplateId;
    this._token = null;
    this._tokenExp = 0;
    this._refreshPromise = null;   // in-flight 刷新 Promise，并发调用共享
    this._failCount = 0;          // 连续失败次数，用于退避
    this._retryAfter = 0;         // 最早可下次刷新的时间戳（ms）
    this._now = nowFn || (() => Date.now());
  }

  async _accessToken() {
    const nowMs = this._now();
    // 缓存仍有效（过期前 5 分钟内也刷新，留缓冲）
    if (this._token && nowMs < this._tokenExp - 5 * 60 * 1000) return this._token;

    // 退避窗口内：强制返回旧 token（若还有）或抛错，避免打爆微信接口
    if (this._failCount > 0 && nowMs < this._retryAfter) {
      if (this._token) return this._token; // 还能用旧的就凑合用
      throw new Error('微信 access_token 连续失败，退避中（' + Math.ceil((this._retryAfter - nowMs) / 1000) + 's 后重试）');
    }

    // in-flight 去重：已有刷新在飞，直接等它
    if (this._refreshPromise) return this._refreshPromise;

    // 发起一次刷新
    this._refreshPromise = this._doRefresh().finally(() => {
      this._refreshPromise = null;
    });
    return this._refreshPromise;
  }

  async _doRefresh() {
    const nowMs = this._now();
    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(this.appid)}&secret=${encodeURIComponent(this.appSecret)}`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (!data.access_token) {
        throw new Error('微信 access_token 获取失败: ' + (data.errcode + ' ' + (data.errmsg || '')));
      }
      this._token = data.access_token;
      this._tokenExp = nowMs + (data.expires_in || 7200) * 1000;
      this._failCount = 0;   // 成功清零
      this._retryAfter = 0;
      return this._token;
    } catch (err) {
      this._failCount = Math.min(this._failCount + 1, 6); // 上限 6 次（~2min）
      const backoff = Math.pow(2, this._failCount) * 1000; // 2s / 4s / 8s / 16s / 32s / 64s
      this._retryAfter = this._now() + backoff;
      throw err;
    }
  }

  async _post(pathname, payload) {
    const token = await this._accessToken();
    const res = await fetch(`https://api.weixin.qq.com/cgi-bin/${pathname}?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return res.json();
  }

  // H5：服务号模板消息。模板字段名需与在公众平台申请模板时的字段 key 一致（此处默认 thing1/thing2）
  async sendH5({ petKey, openid, content }) {
    if (!openid) throw new Error('H5 下发缺少公众号 openid');
    const res = await this._post('message/template/send', {
      touser: openid,
      template_id: this.h5TemplateId,
      page: 'pages/index/index',
      data: {
        thing1: { value: content.title.slice(0, 20) },
        thing2: { value: content.body.slice(0, 30) }
      }
    });
    return { ok: res.errcode === 0, errcode: res.errcode, errmsg: res.errmsg || 'ok', gateway: 'wechat' };
  }

  // 订阅消息（一次性）：重点触发（喂食提醒/周报/里程碑）
  async sendSubscribe({ openid, templateId, data, page }) {
    if (!openid) throw new Error('订阅消息下发缺少 openid');
    const res = await this._post('message/subscribe/send', {
      touser: openid,
      template_id: templateId,
      page: page || 'pages/checkin/checkin',
      data
    });
    return { ok: res.errcode === 0, errcode: res.errcode, errmsg: res.errmsg || 'ok', gateway: 'wechat' };
  }
}

// 按环境选择网关：凭证齐备用真实，否则 Mock 兜底
export function createPushGatewayFromEnv(env) {
  if (env.WX_APPID && env.WX_APP_SECRET && env.H5_TEMPLATE_ID) {
    return new WechatH5PushGateway({ appid: env.WX_APPID, appSecret: env.WX_APP_SECRET, h5TemplateId: env.H5_TEMPLATE_ID });
  }
  return new MockPushGateway();
}