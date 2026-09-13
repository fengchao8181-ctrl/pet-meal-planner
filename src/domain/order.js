// 订阅订单：5 态状态机（pending / paid / active / cancelled / expired）＋ 支付回调幂等
// 每次状态变更写入 transitions 审计日志（事件/前置/目标/时间戳/元信息），可回溯
// 规格对齐落地计划 M2.01「订阅 SKU + 5 态订单状态机」、M2.02「回调幂等」、M2.05「退订/续费/到期提醒」

import { getSku } from './subscription.js';

export const ORDER_STATUS = [
  'pending',   // 待支付（已下单，未收到款）
  'paid',      // 已支付（支付回调已确认，待生效）
  'active',    // 生效中（订阅期内）
  'cancelled', // 已终止（退订/取消，终态）
  'expired'    // 已到期（未续费，可用 renew 续期）
];

// 允许的迁移表：<事件> -> { from: 允许的前置状态, to: 目标状态 }
const TRANSITIONS = {
  pay:      { from: ['pending'],          to: 'paid' },      // 支付成功回调（待支付 → 已支付）
  activate: { from: ['paid'],             to: 'active' },    // 订阅周期开始（已支付 → 生效中）
  expire:   { from: ['paid', 'active'],   to: 'expired' },   // 到期未续费
  renew:    { from: ['expired'],          to: 'active' },    // 到期后续费（支付成功直接续期生效）
  cancel:   { from: ['pending', 'paid', 'active'], to: 'cancelled' } // 下单后悔/退订
};

export class OrderDomainError extends Error {
  constructor(message, code, details) {
    super(message);
    this.code = code || 'ORDER_ERROR';
    this.details = details;
  }
}

function assertStatus(s) {
  if (!ORDER_STATUS.includes(s)) {
    throw new OrderDomainError(`非法订单状态: ${s}`, 'ORDER_BAD_STATUS');
  }
  return s;
}

export function createOrder({ skuId, userId = null, memberName = null }) {
  const sku = getSku(skuId);
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    skuId: sku.id,
    skuName: sku.name,
    priceFen: sku.priceFen,
    periodDays: sku.periodDays,
    userId,
    memberName,
    status: 'pending',
    paymentId: null,      // 幂等用：记录已确认的支付单号，重复回调据此去重
    createdAt: now.toISOString(),
    paidAt: null,
    activatedAt: null,
    expiresAt: null,
    cancelledAt: null,
    transitions: [{
      event: 'create', from: null, to: 'pending',
      at: now.toISOString(), meta: { skuId: sku.id, priceFen: sku.priceFen }
    }]
  };
}

function log(order, event, to, meta = {}) {
  order.transitions.push({ event, from: order.status, to, at: new Date().toISOString(), meta });
  order.status = to;
  return order;
}

function addDays(d, days) {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + days);
  return nd;
}

// 应用订单事件；非法迁移抛 OrderDomainError；幂等：已处于目标状态时重复投递视为成功、不再迁移
export function applyOrderEvent(order, event, meta = {}) {
  assertStatus(order.status);
  const rule = TRANSITIONS[event];
  if (!rule) throw new OrderDomainError(`未知订单事件: ${event}`, 'ORDER_BAD_EVENT');

  // 支付回调安全：若已确认过另一个支付单号，属于并发/异常回调，先拦截（即使已处于 paid 也要抛）
  if (event === 'pay' && order.paymentId && meta.paymentId && order.paymentId !== meta.paymentId) {
    throw new OrderDomainError('支付回调支付单号不一致，疑似并发重复回调', 'ORDER_PAYMENT_MISMATCH', {
      expected: order.paymentId, got: meta.paymentId
    });
  }

  // 幂等命中：重复回调/事件，当前已在该事件的目标状态 → 直接返回，不二次迁移、不重复入账
  if (order.status === rule.to) return order;

  if (!rule.from.includes(order.status)) {
    throw new OrderDomainError(
      `订单状态 ${order.status} 不允许执行 ${event}`,
      'ORDER_TRANSITION_FORBIDDEN',
      { event, from: order.status, to: rule.to }
    );
  }

  if (event === 'pay') {
    if (meta.paymentId) order.paymentId = meta.paymentId;
    order.paidAt = order.paidAt || new Date().toISOString();
  }

  if (event === 'activate' || event === 'renew') {
    order.activatedAt = order.activatedAt || new Date().toISOString();
    if (!order.expiresAt || event === 'renew') {
      // 首次生效或续费：从当前时刻重新起算有效期
      order.expiresAt = addDays(new Date(), order.periodDays).toISOString();
    }
  }

  if (event === 'cancel') order.cancelledAt = new Date().toISOString();

  return log(order, event, rule.to, meta);
}