// 小程序端入口：共享数据（最近生成的餐单、档案 ID、openid）供各页面读取
// onLaunch 走微信登录 → 后端 /api/auth/login 换得稳定 openid（真机/生产为真实 openid，无凭证时本地降级）
var api = require('./utils/request.js');

function deviceId() {
  var d = wx.getStorageSync('deviceId');
  if (!d) {
    d = 'dev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    wx.setStorageSync('deviceId', d);
  }
  return d;
}

App({
  globalData: {
    plan: null,
    profileId: null,
    latestOrder: null,
    openid: wx.getStorageSync('openid') || ''
  },
  onLaunch: function () {
    var self = this;
    var did = deviceId();
    var fallback = function () { self.globalData.openid = did; wx.setStorageSync('openid', did); };
    wx.login({
      success: function (res) {
        if (!res.code) { fallback(); return; }
        api.post('/api/auth/login', { code: res.code, deviceId: did })
          .then(function (body) {
            var openid = body.openid || did;
            self.globalData.openid = openid;
            wx.setStorageSync('openid', openid);
          })
          .catch(fallback);
      },
      fail: fallback
    });
  }
});