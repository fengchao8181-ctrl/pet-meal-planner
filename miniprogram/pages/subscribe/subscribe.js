// 订阅下单页：SKU 列表 → 创建订单(pending) → 模拟支付回调(paid)
// 对接 GET /api/skus、POST /api/orders、POST /api/orders/:id/pay-callback
var api = require('../../utils/request.js');
var orderUtil = require('../../utils/order.js');

// 从 SKU 中找长周期且带折扣锚点的那一档（季卡），生成顶部优惠 banner；无则返回空，隐藏 banner
function firstLongPlan(skus) {
  for (var i = 0; i < skus.length; i++) {
    if (skus[i].periodDays > 30 && skus[i].discountText) return skus[i];
  }
  return null;
}
function buildBannerTitle(skus) {
  var s = firstLongPlan(skus);
  return s ? '🎉 ' + s.name + ' · ' + s.discountText : '';
}
function buildBannerSub(skus) {
  var s = firstLongPlan(skus);
  return s ? '原价 ' + s.origText + '，现 ' + s.priceText + ' · ' + s.perPriceText + ' · 不满意随时退订' : '';
}

Page({
  data: {
    skus: [],
    selectedId: '',
    selected: null,
    memberName: '宠物家长',
    order: null,
    status: null,
    payment: null,
    bannerTitle: '',
    bannerSub: '',
    error: '',
    loading: false,
    paying: false
  },

  onLoad: function () {
    var that = this;
    api.get('/api/skus').then(function (res) {
      var skus = (res.skus || []).map(orderUtil.decorateSku);
      var sel = skus.length > 0 ? skus[0] : null;
      that.setData({ skus: skus, selectedId: sel ? sel.id : '', selected: sel,
        bannerTitle: buildBannerTitle(skus),
        bannerSub: buildBannerSub(skus) });
    }).catch(function (e) { that.setData({ error: e.message || '加载订阅规格失败' }); });
  },

  onNameInput: function (e) { this.setData({ memberName: e.detail.value }); },

  onSelect: function (e) {
    var id = e.currentTarget.dataset.id;
    var sel = null;
    for (var i = 0; i < this.data.skus.length; i++) {
      if (this.data.skus[i].id === id) { sel = this.data.skus[i]; break; }
    }
    this.setData({ selectedId: id, selected: sel });
  },

  onCreateOrder: function () {
    var that = this;
    var sel = this.data.selected;
    if (!sel) return;
    this.setData({ loading: true, error: '' });
    api.post('/api/orders', { skuId: sel.id, memberName: this.data.memberName }).then(function (res) {
      var order = res.order;
      order.displayId = order.id.slice(0, 8);
      order.priceYuanText = (order.priceFen / 100).toFixed(2);
      if (order.periodDays == null) order.periodDays = sel.periodDays;
      var payDisabled = order.status !== 'pending' || !res.payment;
      that.setData({
        order: order,
        status: orderUtil.statusLabel(order.status),
        payment: res.payment,
        payDisabled: payDisabled,
        loading: false
      });
    }).catch(function (e) {
      that.setData({ loading: false, error: e.message || '下单失败' });
    });
  },

  // 模拟「用户完成支付」→ 触发支付回调（生产由微信支付回调触发）
  onPay: function () {
    var that = this;
    var order = this.data.order;
    if (!order || !this.data.payment) return;
    this.setData({ paying: true, error: '' });
    api.post('/api/orders/' + order.id + '/pay-callback', {
      orderId: order.id,
      paymentId: this.data.payment.paymentId
    }).then(function (res) {
      that.setData({ order: res.order, status: orderUtil.statusLabel(res.order.status), paying: false, payDisabled: true });
      wx.showToast({ title: '已支付成功', icon: 'success' });
    }).catch(function (e) {
      that.setData({ paying: false, error: e.message || '支付确认失败' });
    });
  },

  goBack: function () { wx.navigateBack(); }
});