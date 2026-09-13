// 微信身份打通：code → openid/unionid（小程序 wx.login）
//  - 真实：WX_APPID/WX_APP_SECRET 就绪 → 调 code2session
//  - 兜底：凭证缺失 → 按客户端持久化 deviceId 生成本地稳定 openid，保证链路可跑（真实上线后自动切换）
export class MockWechatAuth {
  constructor() { this.name = 'mock'; }

  // deviceId 为小程序本地持久化的匿名标识，跨会话稳定 → 本地 openid 稳定
  async code2session({ code, deviceId }) {
    return { openid: 'dev_' + (String(deviceId || code || 'anon')), unionid: null, sessionKey: null, provider: 'mock' };
  }
}

export class WechatAuth {
  constructor({ appid, appSecret }) {
    this.name = 'wechat';
    this.appid = appid;
    this.appSecret = appSecret;
  }

  async code2session({ code }) {
    if (!code) throw new Error('微信登录缺少 code');
    const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(this.appid)}&secret=${encodeURIComponent(this.appSecret)}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.openid) throw new Error('code2session 失败: ' + (data.errcode + ' ' + (data.errmsg || '')));
    return { openid: data.openid, unionid: data.unionid || null, sessionKey: data.session_key || null, provider: 'wechat' };
  }
}

export function createAuthFromEnv(env) {
  if (env.WX_APPID && env.WX_APP_SECRET) return new WechatAuth({ appid: env.WX_APPID, appSecret: env.WX_APP_SECRET });
  return new MockWechatAuth();
}