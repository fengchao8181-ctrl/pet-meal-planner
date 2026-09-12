// 订阅 SKU 与定价：数字订阅 20–40 元/月（对标市场鲜食订阅的心理价位）
// 金额一律以「分」为单位（微信支付用分结算），避免浮点误差
// 规格对齐落地计划 M2.01「订阅 SKU + 5 态订单状态机」

export const SUBSCRIPTION_SKUS = {
  sub_monthly_basic: {
    id: 'sub_monthly_basic',
    name: '标准月订阅',
    priceFen: 3000,
    periodDays: 30,
    desc: '月餐单 + 周辅食配方 + 日提醒',
    perks: ['daily_reminder', 'meal_plan']
  },
  sub_monthly_pro: {
    id: 'sub_monthly_pro',
    name: '进阶月订阅',
    priceFen: 4000,
    periodDays: 30,
    desc: '标准月订阅 + 体重打卡 + 周报',
    perks: ['daily_reminder', 'meal_plan', 'weight_track', 'weekly_report']
  },
  sub_quarterly: {
    id: 'sub_quarterly',
    name: '季订阅（约 8 折）',
    priceFen: 8400,
    periodDays: 90,
    desc: '三个月套餐，平均 28 元/月',
    perks: ['daily_reminder', 'meal_plan', 'weight_track', 'weekly_report']
  }
};

export function getSku(skuId) {
  const sku = SUBSCRIPTION_SKUS[skuId];
  if (!sku) {
    const e = new Error(`未知订阅规格: ${skuId}`);
    e.code = 'SKU_NOT_FOUND';
    throw e;
  }
  return sku;
}

export function listSkus() {
  return Object.values(SUBSCRIPTION_SKUS).map((s) => ({
    id: s.id,
    name: s.name,
    priceYuan: s.priceFen / 100,
    priceFen: s.priceFen,
    periodDays: s.periodDays,
    desc: s.desc,
    perks: s.perks
  }));
}
