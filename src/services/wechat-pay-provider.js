// M2.02 微信支付（V3 / JSAPI）接入：零第三方依赖，仅用 node:crypto 实现 APIv3 签名与回调加解密
// 对外只暴露 WechatPayProvider（与 StubPaymentProvider 同实现 PaymentProvider 抽象），并暴露纯函数便于离线单测
//
// 何时启用：配置了 WXPAY_MCHID 等 env 时由 src/server/app.js 选中；否则仍用 Stub 兜底
// 需要的商户配置（微信公众号/小程序支付，需商户号）：
//   WXPAY_MCHID           商户号                    WXPAY_APPID      小程序 AppID
//   WXPAY_SERIAL_NO       商户 API 证书序列号        WXPAY_PRIVATE_KEY 商户私钥 PEM
//   WXPAY_API_V3_KEY      商户 APIv3 密钥（32 字节） WXPAY_NOTIFY_URL  支付回调 HTTPS 地址
//   WXPAY_PLATFORM_PUBLIC_KEY 微信支付平台公钥 PEM（验签用）

import crypto from 'node:crypto';
import { PaymentProvider } from './payment-provider.js';

// 构造 APIv3 请求签名字符串：<METHOD>\n<路径>\n<ts>\n<nonce>\n<body>\n
export function buildSignContent(method, pathname, timestamp, nonce, body = '') {
  return [method, pathname, String(timestamp), nonce, body, ''].join('\n');
}

// RSA-SHA256 签名（PKCS#1 v1.5），返回 base64；与微信 APIv3 的 JDK-style 签名一致
export function signString(content, privateKeyPem, hash = 'RSA-SHA256') {
  return crypto.createSign(hash).update(content, 'utf8').sign(privateKeyPem, 'base64');
}

// 验签（微信平台公钥）
export function verifyString(content, signatureBase64, platformPublicKeyPem, hash = 'RSA-SHA256') {
  const v = crypto.createVerify(hash).update(content, 'utf8');
  return v.verify({ key: platformPublicKeyPem, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(signatureBase64, 'base64'));
}

// 组装 Authorization 请求头（APIv3 商户侧）
export function buildAuthHeader({ mchid, serialNo, privateKeyPem, method, pathname, timestamp, nonce, body }) {
  const content = buildSignContent(method, pathname, timestamp, nonce, body);
  const signature = signString(content, privateKeyPem);
  return 'WECHATPAY2-SHA256-RSA2048 ' +
    `mchid="${mchid}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${serialNo}",signature="${signature}"`;
}

// JSAPI 下单请求体（金额单位：分）
export function buildPrepayBody({ mchid, appid, description, outTradeNo, notifyUrl, amountFen, openid }) {
  if (!openid) throw new Error('openid 缺失：JSAPI 支付需要用户在小程序内通过 wx.login / code2Session 换取 openid');
  return {
    appid,
    mchid,
    description,
    out_trade_no: outTradeNo,
    notify_url: notifyUrl,
    amount: { total: amountFen, currency: 'CNY' },
    payer: { openid }
  };
}

// 微信支付回调验签：原文为 <timestamp>\\n<nonce>\\n<body>\\n（仅三段，无 method/path），用平台公钥验签
export function verifyNotifySignature({ timestamp, nonce, body, signature }, platformPublicKeyPem) {
  const content = `${timestamp}\n${nonce}\n${body}\n`;
  return verifyString(content, signature, platformPublicKeyPem);
}

// AES-256-GCM 解密「resource」字段：ciphertext 末 16 字节为认证标签；key=APIv3密钥, iv=nonce
export function decryptNotifyResource({ ciphertext, nonce, associated_data }, apiV3Key) {
  const ct = Buffer.from(ciphertext, 'base64');
  if (ct.length < 16) throw new Error('ciphertext 过短，无法解密');
  const tag = ct.subarray(ct.length - 16);
  const data = ct.subarray(0, ct.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(apiV3Key, 'utf8'), Buffer.from(nonce, 'utf8'));
  decipher.setAuthTag(tag);
  if (associated_data) decipher.setAAD(Buffer.from(associated_data, 'utf8'));
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

// 解码支付通知的加密正文 → 归一化回调填充（用于 applyOrderEvent(order,'pay')）
export function parseNotifyResource(resource, apiV3Key) {
  const plain = JSON.parse(decryptNotifyResource(resource, apiV3Key));
  if (plain.trade_state !== 'SUCCESS') throw new Error(`交易未支付成功: ${plain.trade_state}`);
  return {
    orderId: plain.out_trade_no,          // = 订单 id
    paymentId: plain.transaction_id,      // 微信支付单号，幂等去重用
    amountFen: plain.amount && plain.amount.payer_total,
    status: 'success'
  };
}

export function buildJsapiPayParams({ appid, prepayId, timestamp, nonceStr, privateKeyPem }) {
  const pkg = `prepay_id=${prepayId}`;
  const message = `${appid}\n${timestamp}\n${nonceStr}\n${pkg}\n`; // 小程序端 wx.requestPayment 的 paySign 原文
  return {
    timeStamp: timestamp,
    nonceStr,
    package: pkg,
    signType: 'RSA',
    paySign: signString(message, privateKeyPem)
  };
}

// 与 StubPaymentProvider 同接口的微信支付实现：createPayment + verifyCallback
export class WechatPayProvider extends PaymentProvider {
  constructor(env = process.env) {
    super();
    this.cfg = {
      mchid: env.WXPAY_MCHID,
      appid: env.WXPAY_APPID,
      serialNo: env.WXPAY_SERIAL_NO,
      privateKeyPem: env.WXPAY_PRIVATE_KEY,
      apiV3Key: env.WXPAY_API_V3_KEY,
      notifyUrl: env.WXPAY_NOTIFY_URL,
      platformPublicKeyPem: env.WXPAY_PLATFORM_PUBLIC_KEY,
      defaultOpenid: env.WXPAY_DEFAULT_OPENID || null
    };
    this.ready = Boolean(this.cfg.mchid && this.cfg.appid && this.cfg.serialNo && this.cfg.privateKeyPem && this.cfg.apiV3Key);
  }

  // 发起 JSAPI 下单：POST /v3/pay/transactions/jsapi → 返回 prepay 参数（端上 wx.requestPayment 用）
  async createPayment(order, { openid } = {}) {
    if (!this.ready) {
      const e = new Error('微信支付未配置：请设置 WXPAY_MCHID/APPID/SERIAL_NO/PRIVATE_KEY/API_V3_KEY');
      e.code = 'PAY_NOT_CONFIGURED';
      throw e;
    }
    const oid = openid || order.openid || this.cfg.defaultOpenid;
    if (!oid) {
      const e = new Error('缺少 openid，无法发起 JSAPI 支付（需先 wx.login 换取用户 openid）');
      e.code = 'PAY_OPENID_MISSING';
      throw e;
    }
    const pathname = '/v3/pay/transactions/jsapi';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = crypto.randomBytes(16).toString('hex');
    const body = JSON.stringify(buildPrepayBody({
      mchid: this.cfg.mchid, appid: this.cfg.appid,
      description: `宠物餐单订阅 ${order.skuName}`,
      outTradeNo: order.id, notifyUrl: this.cfg.notifyUrl,
      amountFen: order.priceFen, openid: oid
    }));
    const auth = buildAuthHeader({
      mchid: this.cfg.mchid, serialNo: this.cfg.serialNo, privateKeyPem: this.cfg.privateKeyPem,
      method: 'POST', pathname, timestamp, nonce, body
    });
    const resp = await fetch(`https://api.mch.weixin.qq.com${pathname}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: auth },
      body
    });
    const text = await resp.text();
    if (!resp.ok) {
      const e = new Error(`微信下单失败(${resp.status}): ${text.slice(0, 300)}`);
      e.code = 'WECHAT_PREPAY_FAILED';
      throw e;
    }
    const json = JSON.parse(text);
    return {
      paymentId: json.prepay_id,
      payParams: buildJsapiPayParams({
        appid: this.cfg.appid, prepayId: json.prepay_id,
        timestamp, nonceStr: nonce, privateKeyPem: this.cfg.privateKeyPem
      })
    };
  }

  // 校验并归一化微信支付回调负载 → { orderId, paymentId, status }；验签/解密失败抛错
  async verifyCallback(payload) {
    if (!this.ready) {
      const e = new Error('微信支付未配置');
      e.code = 'PAY_NOT_CONFIGURED';
      throw e;
    }
    const { headers = {}, body = '', parsed = {} } = payload || {};
    // 真实微信通知从 headers 取 Wechatpay-* 验签；resource 在 parsed 里
    const valid = verifyNotifySignature(
      {
        timestamp: headers['wechatpay-timestamp'] || headers['Wechatpay-Timestamp'],
        nonce: headers['wechatpay-nonce'] || headers['Wechatpay-Nonce'],
        body,
        signature: headers['wechatpay-signature'] || headers['Wechatpay-Signature']
      },
      this.cfg.platformPublicKeyPem
    );
    if (!valid) {
      const e = new Error('微信支付回调验签失败');
      e.code = 'CALLBACK_INVALID';
      throw e;
    }
    return parseNotifyResource(parsed.resource, this.cfg.apiV3Key);
  }
}