// 小程序端：订阅 SKU / 订单状态展示映射的纯逻辑（无 wx 依赖，可单元测试）
// SKU 来自 GET /api/skus（字段：id,name,priceYuan,priceFen,periodDays,desc,perks）

var PERKS_LABEL = {
  daily_reminder: '日提醒', meal_plan: '月餐单', weight_track: '体重打卡', weekly_report: '周报'
};

var STATUS_LABEL = {
  pending: { label: '待支付', color: '#D61F69' },
  paid: { label: '已支付', color: '#B8860B' },
  active: { label: '生效中', color: '#1E8449' },
  cancelled: { label: '已终止', color: '#8A8A8A' },
  expired: { label: '已到期', color: '#8A8A8A' }
};

// 长周期(季卡等)的划线原价锚点：对标单月订阅价（进阶月订阅 40 元，权益全含），用于呈现折扣
var PRO_MONTHLY_YUAN = 40;

// 装饰 SKU：价格文案 + 权益文案 + 折扣锚点（仅长周期 SKU 展示划线原价 / 折扣徽标）
function decorateSku(sku) {
  var priceYuan = sku.priceFen / 100;
  var perks = (sku.perks || []).map(function (p) { return PERKS_LABEL[p] || p; });
  var discount = {};
  if (sku.periodDays > 30) {
    var months = Math.round(sku.periodDays / 30);
    var orig = PRO_MONTHLY_YUAN * months;
    if (orig > priceYuan) {
      var rate = Math.round((priceYuan / orig) * 10) / 10;
      discount.origText = '¥' + orig;
      discount.savedYuan = Math.round((orig - priceYuan) * 100) / 100;
      discount.discountText = '约 ' + rate + ' 折 · 立省 ¥' + discount.savedYuan;
    }
  }
  return {
    id: sku.id,
    name: sku.name,
    desc: sku.desc,
    periodDays: sku.periodDays,
    priceFen: sku.priceFen,
    priceYuan: priceYuan,
    priceText: '¥' + priceYuan,
    perPriceText: priceTextPerMonth(sku),
    origText: discount.origText || '',
    savedYuan: discount.savedYuan || 0,
    discountText: discount.discountText || '',
    perks: perks,
    perksText: perks.join(' · ')
  };
}

function priceTextPerMonth(sku) {
  var per = (sku.priceFen / 100) / (sku.periodDays / 30);
  var n = Math.round(per * 100) / 100;
  return '约 ¥' + n + '/月';
}

function statusLabel(status) {
  var s = STATUS_LABEL[status];
  return s ? s : { label: status, color: '#8A8A8A' };
}

module.exports = { decorateSku: decorateSku, statusLabel: statusLabel, PERKS_LABEL: PERKS_LABEL, STATUS_LABEL: STATUS_LABEL };