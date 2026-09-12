// 支付提供方抽象：界面固定，接入真实微信支付时实现 WeChatPaymentProvider（M2.02，依赖商户号）
// 当前提供 StubPaymentProvider：本地联调 / 0 代码收款兜底路径（人工收款码 + 手动确认回调）用

export class PaymentProvider {
  // 发起支付：返回 { paymentId, payParams }；payParams 为端上拉起支付所需参数
  async createPayment(order) { throw new Error('not implemented'); }

  // 校验并归一化支付回调负载：返回 { orderId, paymentId, status }；验签失败抛错
  async verifyCallback(payload) { throw new Error('not implemented'); }
}

// 本地/演示用桩：模拟支付成功，用于联调、测试与 0 代码兜底
export class StubPaymentProvider extends PaymentProvider {
  async createPayment(order) {
    return {
      paymentId: crypto.randomUUID(),
      payParams: { stub: true, orderId: order.id, amountFen: order.priceFen }
    };
  }

  async verifyCallback(payload) {
    const { orderId, paymentId, status } = payload || {};
    if (!orderId || !paymentId) {
      const e = new Error('回调负载缺少 orderId/paymentId');
      e.code = 'CALLBACK_INVALID';
      throw e;
    }
    return { orderId, paymentId, status: status || 'success' };
  }
}
