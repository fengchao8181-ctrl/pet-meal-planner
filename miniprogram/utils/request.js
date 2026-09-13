// 小程序端：wx.request 的 Promise 封装，统一处理后端信封 {ok, data|error}
var config = require('./config.js');

function request(path, options) {
  options = options || {};
  return new Promise(function (resolve, reject) {
    wx.request({
      url: config.BASE_URL + path,
      method: options.method || 'GET',
      data: options.data,
      header: { 'content-type': 'application/json' },
      success: function (res) {
        var body = res.data;
        if (body && body.ok === true) {
          resolve(body);
        } else {
          var err = new Error((body && body.error) || '请求失败');
          err.code = body && body.code;
          err.status = res.statusCode;
          reject(err);
        }
      },
      fail: function (err) {
        var e = new Error(err.errMsg || '网络错误');
        e.code = 'NETWORK';
        reject(e);
      }
    });
  });
}

module.exports = {
  get: function (path) { return request(path, { method: 'GET' }); },
  post: function (path, data) { return request(path, { method: 'POST', data: data }); }
};