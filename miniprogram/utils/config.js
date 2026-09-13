// 小程序端：全局配置
// 后端为 EdgeOne 云函数（导出 handler 的 HTTPS 域名）。上线前替换 BASE_URL 为已配置合法域名的云函数地址。
// 本地联调：
//   1) 先运行 `npm run dev` 启动本地后端（见 README）；
//   2) 微信开发者工具「详情-本地设置」勾选「不校验合法域名」；
//   3) 模拟器（PC 上运行）：用 http://127.0.0.1:3000 即可；
//   4) 真机调试（手机）：必须用电脑局域网 IP http://192.168.3.8:3000（手机与电脑同一 Wi-Fi），
//     否则 127.0.0.1 会指向手机自己导致 ERR_CONNECTION_REFUSED。
var BASE_URL = 'http://192.168.3.8:3000';

// 「有爱」订阅消息模板 ID（一次性订阅）。上线申请到正式模板后填入即可启用打卡页「每日提醒」。
// 若留空，打卡页提醒按钮会提示「即将上线」，不发起授权。
var REMIND_TEMPLATE_ID = '';

module.exports = { BASE_URL: BASE_URL, REMIND_TEMPLATE_ID: REMIND_TEMPLATE_ID };