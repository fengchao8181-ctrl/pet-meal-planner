// 小程序端纯逻辑单元测试（CJS，require miniprogram/utils 的可测模块）
const test = require('node:test');
const assert = require('node:assert/strict');

const profileUtil = require('../miniprogram/utils/profile.js');
const planUtil = require('../miniprogram/utils/plan.js');
const orderUtil = require('../miniprogram/utils/order.js');
const checkinUtil = require('../miniprogram/utils/checkin.js');

test('小程序 profile：合法档案无校验错误', () => {
  const errs = profileUtil.validateProfile({
    petName: '豆豆', breed: '柯基', weightKg: 8, ageMonths: 24, lifeStage: 'adult',
    activity: 'mid', neutered: true, feedingMode: 'B',
    kibbleLabel: { proteinPct: 24, kcalPer100g: 360 }
  });
  assert.deepEqual(errs, []);
});

test('小程序 profile：体重/月龄越界报错', () => {
  const errs = profileUtil.validateProfile({
    weightKg: 200, ageMonths: 0, lifeStage: 'adult', activity: 'mid', feedingMode: 'A'
  });
  assert.ok(errs.some((e) => e.includes('体重')));
  assert.ok(errs.some((e) => e.includes('年龄')));
});

test('小程序 profile：模式 B 缺主粮标签报错', () => {
  const errs = profileUtil.validateProfile({
    weightKg: 5, ageMonths: 12, lifeStage: 'adult', activity: 'low', feedingMode: 'B', kibbleLabel: null
  });
  assert.ok(errs.some((e) => e.includes('主粮标签') || e.includes('模式 B/C')));
});

test('小程序 checkin：今日打卡状态与最近 7 天网格', () => {
  const records = [
    { date: '2026-09-07', mood: 'happy' },
    { date: '2026-09-09', mood: 'sleepy' }
  ];
  assert.equal(checkinUtil.isCheckedToday(records, '2026-09-13'), false);
  assert.equal(checkinUtil.isCheckedToday([{ date: '2026-09-13' }], '2026-09-13'), true);

  const grid = checkinUtil.buildCheckinGrid(records, 7, '2026-09-14');
  assert.equal(grid.length, 7);
  const last = grid[grid.length - 1];
  assert.equal(last.isToday, true);
  assert.equal(grid.length, 7);
  // 09-13 所在格未打卡
  assert.ok(grid.find((g) => g.date === '2026-09-13').checked === false);
  // lastNDays 首日为今天-6
  assert.equal(grid[0].date, '2026-09-08');
});

test('小程序 checkin：里程碑与情绪反馈', () => {
  assert.equal(checkinUtil.milestoneHit(7), true);
  assert.equal(checkinUtil.milestoneHit(30), true);
  assert.equal(checkinUtil.milestoneHit(9), false);
  const f = checkinUtil.afterCheckinFeedback(7, null);
  assert.match(f, /连续一周/);
  const f2 = checkinUtil.afterCheckinFeedback(3, 'sleepy');
  assert.match(f2, /犯困/);
});

test('小程序 checkin：本地连续天数', () => {
  const recs = [{ date: '2026-09-11' }, { date: '2026-09-12' }];
  assert.equal(checkinUtil.computeStreakLocal(recs, '2026-09-13'), 2); // 昨天存活
  assert.equal(checkinUtil.computeStreakLocal(recs, '2026-09-12'), 2); // 今天已计
  assert.equal(checkinUtil.computeStreakLocal([], '2026-09-13'), 0);
});

test('小程序 checkin：周报模型适配（用心值口径可选）', () => {
  const m = checkinUtil.buildReportModel(
    { weekStart: '2026-09-07', weekEnd: '2026-09-13', checkRate: 71, streakDays: 5, avgExec: 90, loveScore: 82, moodTop: 'happy' },
    '本周打卡 5/7 天'
  );
  assert.equal(m.checkRate, 71);
  assert.equal(m.loveScore, 82);
  assert.equal(m.moodLabel, '开心');
  assert.match(m.breakdown, /5\/7/);
  assert.equal(checkinUtil.buildReportModel(null), null);
});

test('小程序 profile：buildPayload 归一化（A 不带主粮，B 带且清空非数字）', () => {
  const pA = profileUtil.buildPayload({ petName: '豆豆', weightKg: 5, ageMonths: 12, lifeStage: 'adult', activity: 'high', feedingMode: 'A', allergies: ['鸡肉'] });
  assert.equal(pA.kibbleLabel, undefined);
  assert.deepEqual(pA.allergies, ['鸡肉']);

  const pB = profileUtil.buildPayload({ petName: '', weightKg: '6', ageMonths: '14', lifeStage: 'puppy', activity: 'low', feedingMode: 'B', kibbleLabel: { proteinPct: '', kcalPer100g: '340', fatPct: 'x', grainFree: true, avoidSources: ['牛肉'] } });
  assert.equal(pB.petName, '毛孩子');           // 空昵称兜底
  assert.equal(pB.weightKg, 6);
  assert.equal(pB.kibbleLabel.proteinPct, null); // 空值 → null
  assert.equal(pB.kibbleLabel.kcalPer100g, 340);
  assert.equal(pB.kibbleLabel.fatPct, null);      // 非数字 → null
  assert.equal(pB.kibbleLabel.grainFree, true);
  assert.deepEqual(pB.kibbleLabel.avoidSources, ['牛肉']);
});

test('小程序 plan：模式 A 渲染模型（纯鲜食，无主粮）', () => {
  const m = planUtil.buildPlanModel({ planId: 'p1', mode: 'A', modeLabel: '纯鲜食', derKcal: 500, pet: { name: '豆豆', breed: '柯基', weightKg: 8, bodyType: '小型', stage: '成犬' }, ruleVersion: '1.0.0', kibble: null, supplement: [], freshMeals: [{ name: '鸡胸肉', grams: 120, kcal: 300 }], warnings: [], decisions: [] });
  assert.equal(m.kibble, null);
  assert.equal(m.freshMeals.length, 1);
  assert.equal(m.freshTitle, '每日鲜食配方');
  assert.match(m.title, /豆豆 的纯鲜食餐单/);
  assert.ok(m.subtitle.includes('8kg'));
});

test('小程序 plan：模式 B 渲染模型（主粮建议 + 辅食 purpose 映射）', () => {
  const m = planUtil.buildPlanModel({ planId: 'p2', mode: 'B', modeLabel: '狗粮+辅食', derKcal: 600, pet: { name: 'Lucky', breed: '金毛', weightKg: 20, bodyType: '中型', stage: '成犬' }, kibble: { gramsPerDay: 180, typeAdvice: { summary: '建议标准型', tips: ['粗蛋白 18-30%'] } }, supplement: [{ name: '南瓜', grams: 40, purpose: 'gut' }, { name: '三文鱼', grams: 30, purpose: 'joint' }], warnings: ['提示'], decisions: [{ ruleId: 'R001' }] });
  assert.equal(m.kibble.gramsPerDay, 180);
  assert.equal(m.kibble.gramsNote, '约占总热量 90%');
  assert.equal(m.supplement[0].purpose, '肠胃');
  assert.equal(m.supplement[1].purpose, '关节');
  assert.equal(m.decisionsCount, 1);
  assert.equal(m.warnings[0], '提示');
});

test('小程序 plan：空 plan 返回 null', () => {
  assert.equal(planUtil.buildPlanModel(null), null);
});

test('小程序 order：decorateSku 价格与权益文案', () => {
  const sku = orderUtil.decorateSku({ id: 'sub_monthly_basic', name: '标准月订阅', desc: '月餐单', priceFen: 3000, periodDays: 30, perks: ['daily_reminder', 'meal_plan'] });
  assert.equal(sku.priceText, '¥30');
  assert.ok(sku.perPriceText.includes('30'));
  assert.deepEqual(sku.perks, ['日提醒', '月餐单']);
});

test('小程序 order：季订阅均价文案', () => {
  const sku = orderUtil.decorateSku({ id: 'sub_quarterly', name: '季订阅', priceFen: 8400, periodDays: 90 });
  assert.equal(sku.priceText, '¥84');
});

test('小程序 order：statusLabel 状态映射', () => {
  assert.equal(orderUtil.statusLabel('pending').label, '待支付');
  assert.equal(orderUtil.statusLabel('paid').label, '已支付');
  assert.equal(orderUtil.statusLabel('active').label, '生效中');
  assert.equal(orderUtil.statusLabel('cancelled').label, '已终止');
  assert.equal(orderUtil.statusLabel('expired').label, '已到期');
  assert.equal(orderUtil.statusLabel('weird').label, 'weird');
});