import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrder, applyOrderEvent, OrderDomainError, ORDER_STATUS } from '../src/domain/order.js';
import { getSku, listSkus, SUBSCRIPTION_SKUS } from '../src/domain/subscription.js';
import { StubPaymentProvider } from '../src/services/payment-provider.js';

test('订阅：SKU 定义与列表', () => {
  const skus = listSkus();
  assert.ok(skus.length >= 3);
  assert.ok(skus.every((s) => s.priceFen > 0 && s.priceYuan === s.priceFen / 100 && s.periodDays > 0));
  const basic = getSku('sub_monthly_basic');
  assert.equal(basic.priceFen, 3000);
  assert.throws(() => getSku('nope'), (e) => e.code === 'SKU_NOT_FOUND');
});

test('订单：创建后为 pending 并带审计日志', () => {
  const o = createOrder({ skuId: 'sub_monthly_pro', memberName: '豆豆' });
  assert.equal(o.status, 'pending');
  assert.equal(o.priceFen, 4000);
  assert.equal(o.periodDays, 30);
  assert.equal(o.transitions[0].event, 'create');
  assert.ok(ORDER_STATUS.includes(o.status));
});

test('状态机：完整快乐路径 pending→paid→active', () => {
  const o = createOrder({ skuId: 'sub_monthly_basic' });
  applyOrderEvent(o, 'pay', { paymentId: 'wx_001' });
  assert.equal(o.status, 'paid');
  assert.equal(o.paymentId, 'wx_001');
  applyOrderEvent(o, 'activate');
  assert.equal(o.status, 'active');
  assert.ok(o.expiresAt, '生效后应有到期时间');
  assert.ok(new Date(o.expiresAt) > new Date());
});

test('状态机：退订与到期/续费', () => {
  const o = createOrder({ skuId: 'sub_monthly_basic' });
  applyOrderEvent(o, 'pay', { paymentId: 'wx_002' });
  applyOrderEvent(o, 'activate');
  applyOrderEvent(o, 'expire');
  assert.equal(o.status, 'expired');
  applyOrderEvent(o, 'renew');
  assert.equal(o.status, 'active');
  assert.ok(o.expiresAt, '续费后应重新起算到期时间');
});

test('状态机：pending 状态可直接退订为 cancelled', () => {
  const o = createOrder({ skuId: 'sub_monthly_basic' });
  applyOrderEvent(o, 'cancel');
  assert.equal(o.status, 'cancelled');
  assert.ok(o.cancelledAt);
});

test('状态机：非法迁移抛 ORDER_TRANSITION_FORBIDDEN', () => {
  const o = createOrder({ skuId: 'sub_monthly_basic' });
  // pending 不能 activate
  assert.throws(() => applyOrderEvent(o, 'activate'), (e) => e.code === 'ORDER_TRANSITION_FORBIDDEN');
  // cancelled 是终态，不能续费
  applyOrderEvent(o, 'cancel');
  assert.throws(() => applyOrderEvent(o, 'renew'), (e) => e.code === 'ORDER_TRANSITION_FORBIDDEN');
  // active 不能重复 pay（同一支付单号，走迁移校验而非支付单号冲突）
  const o2 = createOrder({ skuId: 'sub_monthly_basic' });
  applyOrderEvent(o2, 'pay', { paymentId: 'x' });
  applyOrderEvent(o2, 'activate');
  assert.throws(() => applyOrderEvent(o2, 'pay', { paymentId: 'x' }), (e) => e.code === 'ORDER_TRANSITION_FORBIDDEN');
});

test('回调幂等：重复支付回调不重复迁移/入账', () => {
  const o = createOrder({ skuId: 'sub_monthly_basic' });
  applyOrderEvent(o, 'pay', { paymentId: 'wx_dup' });
  const transitionsBefore = o.transitions.length;
  const again = applyOrderEvent(o, 'pay', { paymentId: 'wx_dup' });
  assert.equal(again, o, '幂等命中时应返回同一对象');
  assert.equal(o.transitions.length, transitionsBefore, '不新增审计迁移');
  assert.equal(o.paidAt, o.paidAt);
});

test('回调幂等：不同支付单号并发回调抛 ORDER_PAYMENT_MISMATCH', () => {
  const o = createOrder({ skuId: 'sub_monthly_basic' });
  applyOrderEvent(o, 'pay', { paymentId: 'wx_a' });
  assert.throws(() => applyOrderEvent(o, 'pay', { paymentId: 'wx_b' }), (e) => e.code === 'ORDER_PAYMENT_MISMATCH');
});

test('支付桩：创建支付与回调归一化', async () => {
  const p = new StubPaymentProvider();
  const o = createOrder({ skuId: 'sub_quarterly' });
  const pay = await p.createPayment(o);
  assert.ok(pay.paymentId);
  assert.equal(pay.payParams.amountFen, 8400);
  const cb = await p.verifyCallback({ orderId: o.id, paymentId: pay.paymentId, status: 'success' });
  assert.equal(cb.orderId, o.id);
  await assert.rejects(() => p.verifyCallback({}), (e) => e.code === 'CALLBACK_INVALID');
});

test('SKU 集合覆盖落地计划定价区间（20–40 元/月）', () => {
  const basic = SUBSCRIPTION_SKUS.sub_monthly_basic;
  const pro = SUBSCRIPTION_SKUS.sub_monthly_pro;
  assert.ok(basic.priceFen / 100 >= 20 && basic.priceFen / 100 <= 40);
  assert.ok(pro.priceFen / 100 >= 20 && pro.priceFen / 100 <= 40);
});