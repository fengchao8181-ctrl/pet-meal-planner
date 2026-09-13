import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StubPaymentProvider } from '../src/services/payment-provider.js';
import { MockRepository } from '../src/services/mock-repository.js';
import { handler } from '../src/server/app.js';

const BASE = 'http://127.0.0.1';
function req(method, path, { body, headers = {} } = {}) {
  return handler(new Request(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined
  }));
}
async function j(resp) { return { status: resp.status, body: await resp.json() }; }

// ---- R2：支付回调密钥护栏 ----
test('R2-Stub：配置 secret 后，缺密钥回调被拒（CALLBACK_AUTH_FAILED）', async () => {
  const p = new StubPaymentProvider({ secret: 's3cret' });
  await assert.rejects(
    () => p.verifyCallback({ headers: {}, parsed: { orderId: 'o1', paymentId: 'p1' } }),
    (e) => e.code === 'CALLBACK_AUTH_FAILED'
  );
  // 带对密钥 → 通过
  const ok = await p.verifyCallback({ headers: { 'x-callback-secret': 's3cret' }, parsed: { orderId: 'o1', paymentId: 'p1' } });
  assert.equal(ok.orderId, 'o1');
});

test('R2-Stub：未配置 secret（本地缺省）不阻断回调（向后兼容）', async () => {
  const p = new StubPaymentProvider();
  const cb = await p.verifyCallback({ parsed: { orderId: 'o1', paymentId: 'p1' } });
  assert.equal(cb.orderId, 'o1');
});

// ---- R4：打卡身份归属（openid 锁定 + 越权拒绝）----
test('R4-checkin：owner 锁定后，他人 openid 写入被拒；owner 可写', async () => {
  const key = 'sec-own-1';
  // owner A 首次写入锁定
  const first = await j(await req('POST', '/api/checkins', { body: { petKey: key, date: '2026-09-13', mood: 'happy', ownerOpenid: 'A' } }));
  assert.equal(first.status, 201);
  // owner A 同日更新正常
  const again = await j(await req('POST', '/api/checkins', { body: { petKey: key, date: '2026-09-13', ownerOpenid: 'A' } }));
  assert.equal(again.status, 201);
  // 他人 B 写入被拒
  const intruder = await j(await req('POST', '/api/checkins', { body: { petKey: key, date: '2026-09-13', ownerOpenid: 'B' } }));
  assert.equal(intruder.status, 403);
  assert.equal(intruder.body.code, 'OWNER_MISMATCH');
});

// ---- R4：推送订阅归属 ----
test('R4-subscribe：openid 与 owner 不一致订阅被拒', async () => {
  const key = 'sec-sub-1';
  await j(await req('POST', '/api/checkins', { body: { petKey: key, date: '2026-09-13', mood: 'happy', ownerOpenid: 'A' } }));
  const forbid = await j(await req('POST', '/api/push/subscribe', { body: { petKey: key, miniOpenid: 'B' } }));
  assert.equal(forbid.status, 403);
  const allow = await j(await req('POST', '/api/push/subscribe', { body: { petKey: key, miniOpenid: 'A' } }));
  assert.equal(allow.status, 201);
});

// ---- R7：内部错误不泄露实现细节（仅 400 客户端错误回传具体 message）----
test('R7：内部错误回传通用文案，不暴露 stack/message', async () => {
  // body 为非对象（null）→ 解构抛 TypeError → INTERNAL 走 500 通用文案
  const resp = await handler(new Request(BASE + '/api/checkins', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: 'null'
  }));
  const data = await resp.json();
  assert.equal(resp.status, 500);
  assert.equal(data.error, '服务器内部错误');
  assert.ok(!JSON.stringify(data).includes('TypeError')); // 不泄露内部实现
});

// ---- R6：静态文件目录穿越防护 ----
test('R6：目录穿越路径被拒（404）', async () => {
  const resp = await handler(new Request(BASE + '/..%2f..%2fpackage.json', { method: 'GET' }));
  const r2 = await handler(new Request(BASE + '/..\\..\\package.json', { method: 'GET' }));
  assert.equal(resp.status, 404);
  assert.equal(r2.status, 404);
});