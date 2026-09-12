import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../src/server/app.js';

const BASE = 'http://127.0.0.1';
function post(path, body) {
  return handler(new Request(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  }));
}
function get(path) {
  return handler(new Request(BASE + path, { method: 'GET' }));
}
async function j(resp) {
  return { status: resp.status, body: await resp.json() };
}

const profileB = {
  petName: '豆豆', breed: '金毛', weightKg: 8.5, ageMonths: 24,
  lifeStage: 'adult', activity: 'mid', neutered: true, feedingMode: 'B',
  kibbleLabel: { proteinPct: 30, fatPct: 16, kcalPer100g: 380, grainFree: true, avoidSources: [] }
};

test('API：SKU 列表', async () => {
  const { status, body } = await j(await get('/api/skus'));
  assert.equal(status, 200);
  assert.ok(body.ok && body.skus.length >= 3);
});

test('API：生成餐单 → 三端共享读取同 ID 同数据（M1.02）', async () => {
  const gen = await j(await post('/api/plans/generate', profileB));
  assert.equal(gen.status, 200);
  const planId = gen.body.plan.planId;
  const read = await j(await get(`/api/plans/${planId}`));
  assert.equal(read.status, 200);
  assert.equal(read.body.plan.planId, planId);
  assert.equal(read.body.plan.pet.name, '豆豆');
  const miss = await j(await get('/api/plans/does-not-exist'));
  assert.equal(miss.status, 404);
});

test('API：创建订阅订单 → 状态机走通 + 回调幂等（端到端）', async () => {
  const created = await j(await post('/api/orders', { skuId: 'sub_monthly_basic', memberName: '豆豆' }));
  assert.equal(created.status, 201);
  assert.equal(created.body.order.status, 'pending');
  const orderId = created.body.order.id;
  const paymentId = created.body.payment.paymentId;

  // 第一次回调 → paid
  const cb1 = await j(await post(`/api/orders/${orderId}/pay-callback`, { orderId, paymentId, status: 'success' }));
  assert.equal(cb1.status, 200);
  assert.equal(cb1.body.order.status, 'paid');

  // 重复回调（幂等）→ 仍 paid，审计迁移条数不变
  const cb2 = await j(await post(`/api/orders/${orderId}/pay-callback`, { orderId, paymentId, status: 'success' }));
  assert.equal(cb2.body.order.status, 'paid');
  assert.equal(cb2.body.order.transitions.length, cb1.body.order.transitions.length);

  // 查询订单，字段一致
  const read = await j(await get(`/api/orders/${orderId}`));
  assert.equal(read.body.order.status, 'paid');
  assert.equal(read.body.order.paymentId, paymentId);
});

test('API：非法 SKU → 400 SKU_NOT_FOUND', async () => {
  const r = await j(await post('/api/orders', { skuId: 'nope' }));
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'SKU_NOT_FOUND');
});

test('API：回调缺事件号 → 400 CALLBACK_INVALID', async () => {
  const created = await j(await post('/api/orders', { skuId: 'sub_monthly_basic' }));
  const orderId = created.body.order.id;
  const r = await j(await post(`/api/orders/${orderId}/pay-callback`, {}));
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'CALLBACK_INVALID');
});
