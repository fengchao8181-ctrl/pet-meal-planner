// 微信支付 Provider 纯逻辑单测：用运行期生成的临时 RSA/AES 密钥离线验证
// 签名字符串格式、签名/验签、prepay 参数、AES-256-GCM 资源解密、回调归一化、未配置兜底
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  buildSignContent,
  signString,
  verifyString,
  buildAuthHeader,
  buildPrepayBody,
  verifyNotifySignature,
  decryptNotifyResource,
  parseNotifyResource,
  buildJsapiPayParams,
  WechatPayProvider
} from '../src/services/wechat-pay-provider.js';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const apiV3Key = '01234567890123456789012345678901'; // 32 字节

test('sdk：签名字符串五段式（METHOD\\n路径\\nTS\\nnonce\\nbody\\n）', () => {
  const s = buildSignContent('POST', '/v3/pay/transactions/jsapi', 1600000000, 'abc', '{}');
  assert.equal(s, 'POST\n/v3/pay/transactions/jsapi\n1600000000\nabc\n{}\n');
});

test('sdk：签名→验签往返（商户私钥签，公钥验）', () => {
  const content = buildSignContent('GET', '/v3/certificates', 1600000000, 'nonce1', '');
  const sig = signString(content, privateKey);
  assert.ok(Buffer.from(sig, 'base64').length > 0);
  assert.equal(verifyString(content, sig, publicKey), true);
  assert.equal(verifyString(content + 'tampered', sig, publicKey), false);
});

test('sdk：Authorization 头格式与微信 APIv3 规范一致', () => {
  const h = buildAuthHeader({
    mchid: '1900000109', serialNo: 'cert1',
    privateKeyPem: privateKey, method: 'POST', pathname: '/v3/pay/transactions/jsapi',
    timestamp: '1600000000', nonce: 'n1', body: '{}'
  });
  assert.ok(h.startsWith('WECHATPAY2-SHA256-RSA2048 '));
  assert.match(h, /mchid="1900000109"/);
  assert.match(h, /serial_no="cert1"/);
  assert.match(h, /timestamp="1600000000"/);
  assert.match(h, /nonce_str="n1"/);
});

test('sdk：buildPrepayBody 金额取分、字段齐全；缺 openid 抛错', () => {
  const body = buildPrepayBody({
    mchid: 'm1', appid: 'wxapp', description: '宠物餐单订阅 标准月订阅',
    outTradeNo: 'o1', notifyUrl: 'https://x/notify', amountFen: 3000, openid: 'u1'
  });
  assert.equal(body.amount.total, 3000);
  assert.equal(body.amount.currency, 'CNY');
  assert.equal(body.payer.openid, 'u1');
  assert.equal(body.out_trade_no, 'o1');
  assert.throws(() => buildPrepayBody({ openid: null }), /openid/);
});

test('sdk：回调验签（模拟微信用平台公钥签 ts+nonce+body）', () => {
  const ts = '1600000001', nonce = 'nnn', body = '{"event_type":"TRANSACTION.SUCCESS"}';
  const content = `${ts}\n${nonce}\n${body}\n`;
  const sig = crypto.createSign('RSA-SHA256').update(content, 'utf8').sign(privateKey, 'base64');
  assert.equal(verifyNotifySignature({ timestamp: ts, nonce, body, signature: sig }, publicKey), true);
  // 篡改 body → 验签失败
  const badSig = crypto.createSign('RSA-SHA256').update(`${ts}\n${nonce}\n${body}tampered\n`, 'utf8').sign(privateKey, 'base64');
  assert.equal(verifyNotifySignature({ timestamp: ts, nonce, body, signature: badSig }, publicKey), false);
});

function encryptResource(payload, assoc) {
  const iv = crypto.randomBytes(12).toString('utf8');
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(apiV3Key, 'utf8'), Buffer.from(iv, 'utf8'));
  cipher.setAAD(Buffer.from(assoc || '', 'utf8'));
  const enc = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([enc, tag]).toString('base64'),
    nonce: iv,
    associated_data: assoc || ''
  };
}

test('sdk：AES-256-GCM resource 解密还原明文', () => {
  const plain = { out_trade_no: 'o1', transaction_id: 'tx1', trade_state: 'SUCCESS', amount: { payer_total: 3000 } };
  const res = encryptResource(plain, 'sub_0001');
  const out = decryptNotifyResource(res, apiV3Key);
  assert.equal(JSON.parse(out).transaction_id, 'tx1');
});

test('sdk：parseNotifyResource 归一化回调 + 非 SUCCESS 拒绝', () => {
  const res = encryptResource({ out_trade_no: 'o1', transaction_id: 'tx1', trade_state: 'SUCCESS', amount: { payer_total: 3000 } }, '');
  const got = parseNotifyResource(res, apiV3Key);
  assert.deepEqual(got, { orderId: 'o1', paymentId: 'tx1', amountFen: 3000, status: 'success' });

  const failRes = encryptResource({ out_trade_no: 'o2', trade_state: 'NOTPAY' }, '');
  assert.throws(() => parseNotifyResource(failRes, apiV3Key), /未支付成功/);
});

test('sdk：buildJsapiPayParams paySign 原文为 appid\\nts\\nnonce\\npackage', () => {
  const p = buildJsapiPayParams({ appid: 'wxapp', prepayId: 'px1', timestamp: '1600000002', nonceStr: 'nstr', privateKeyPem: privateKey });
  assert.equal(p.package, 'prepay_id=px1');
  assert.equal(p.signType, 'RSA');
  assert.equal(p.timeStamp, '1600000002');
  // paySign 可复算
  const expect = crypto.createSign('RSA-SHA256').update('wxapp\n1600000002\nnstr\nprepay_id=px1\n', 'utf8').sign(privateKey, 'base64');
  assert.equal(p.paySign, expect);
});

test('provider：未配置凭证时 createPayment/verifyCallback 抛 PAY_NOT_CONFIGURED', async () => {
  const p = new WechatPayProvider({});
  assert.equal(p.ready, false);
  await assert.rejects(() => p.createPayment({}), (e) => e.code === 'PAY_NOT_CONFIGURED');
  await assert.rejects(() => p.verifyCallback({}), (e) => e.code === 'PAY_NOT_CONFIGURED');
});

test('provider：缺少 openid 发起下单时抛 PAY_OPENID_MISSING', async () => {
  const p = new WechatPayProvider({ WXPAY_MCHID: 'm1', WXPAY_APPID: 'wx', WXPAY_SERIAL_NO: 's', WXPAY_PRIVATE_KEY: privateKey, WXPAY_API_V3_KEY: apiV3Key, WXPAY_NOTIFY_URL: 'https://x/n' });
  assert.equal(p.ready, true);
  await assert.rejects(() => p.createPayment({ priceFen: 3000, skuName: 'x' }), (e) => e.code === 'PAY_OPENID_MISSING');
});