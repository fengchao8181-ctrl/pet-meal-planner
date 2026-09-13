import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDailyKcal, inferBodyType, getRuleInfo } from '../src/domain/rules-engine.js';
import { buildProfile, kibbleTypeAdvice, kibbleGramsPerDay } from '../src/domain/profile.js';
import { generateMealPlan } from '../src/domain/meal-plan.js';
import { allocateKcal } from '../src/domain/feeding-mode.js';

const baseProfile = {
  petName: '豆豆', breed: '金毛', weightKg: 8.5, ageMonths: 24,
  lifeStage: 'adult', activity: 'mid', neutered: true,
  feedingMode: 'B',
  kibbleLabel: { proteinPct: 30, fatPct: 16, fiberPct: 4, kcalPer100g: 380, grainFree: true, avoidSources: [] }
};

test('规则引擎：RER/DER 计算与决策链', () => {
  const decisions = [];
  const r = computeDailyKcal(baseProfile, decisions);
  const rer = 70 * Math.pow(8.5, 0.75);
  assert.ok(Math.abs(r.rerKcal - rer) < 0.5, 'RER 应等于 70×W^0.75');
  assert.ok(r.derKcal > r.rerKcal, 'DER 应大于 RER');
  assert.equal(decisions.length, 2);
  assert.equal(decisions[0].ruleId, 'R001');
  assert.ok(decisions.every((d) => d.version && d.output), '每条决策应含版本与输出');
});

test('规则引擎：体型推断', () => {
  assert.equal(inferBodyType(4).key, 'mini');
  assert.equal(inferBodyType(8.5).key, 'small');
  assert.equal(inferBodyType(20).key, 'medium');
  assert.equal(inferBodyType(40).key, 'large');
  assert.equal(inferBodyType(60).key, 'giant');
});

test('规则引擎：版本信息可审计', () => {
  const info = getRuleInfo();
  assert.ok(info.engineVersion === '1.0.0');
  assert.equal(info.rules.length, 6);
  assert.ok(info.rules.every((r) => r.id && r.version && r.name));
});

test('档案：合法档案可构建', () => {
  const p = buildProfile(baseProfile);
  assert.equal(p.weightKg, 8.5);
  assert.equal(p.feedingMode, 'B');
  assert.ok(p.createdAt);
});

test('档案：非法输入抛 PROFILE_INVALID', () => {
  assert.throws(() => buildProfile({ ...baseProfile, weightKg: 200 }), (e) => e.code === 'PROFILE_INVALID');
  assert.throws(() => buildProfile({ ...baseProfile, feedingMode: 'X' }), (e) => e.code === 'PROFILE_INVALID');
  assert.throws(() => buildProfile({ ...baseProfile, kibbleLabel: null }), (e) => e.code === 'PROFILE_INVALID');
});

test('档案：类型建议不出现品牌名', () => {
  const advice = kibbleTypeAdvice(baseProfile.kibbleLabel, 'adult');
  assert.ok(advice.summary.includes('全价标准'));
  assert.ok(advice.tips.some((t) => t.includes('高蛋白')));
  assert.ok(advice.tips.some((t) => t.includes('无谷')));
});

test('档案：主粮克数换算', () => {
  const grams = kibbleGramsPerDay(300, { kcalPer100g: 380 });
  assert.equal(grams, Math.round((300 / 380) * 100));
  assert.equal(kibbleGramsPerDay(300, null), null);
});

test('喂养模式：热量分配比例', () => {
  const b = allocateKcal('B', 500);
  assert.equal(b.kibbleKcal, 450);
  assert.equal(b.supplementKcal, 50);
  const a = allocateKcal('A', 500);
  assert.equal(a.kibbleKcal, 0);
  assert.throws(() => allocateKcal('X', 500));
});

test('餐单：模式B 输出主粮建议 + 辅食，辅食热量占比≈10%', () => {
  const plan = generateMealPlan(buildProfile(baseProfile));
  assert.equal(plan.mode, 'B');
  assert.ok(plan.kibble.typeAdvice);
  assert.ok(plan.kibble.gramsPerDay > 0);
  assert.ok(plan.supplement.length >= 2 && plan.supplement.length <= 3);
  const suppKcal = plan.supplement.reduce((s, x) => s + x.kcal, 0);
  assert.ok(Math.abs(suppKcal - plan.derKcal * 0.1) < 1, '辅食热量应约为 DER 的 10%');
  assert.ok(plan.decisions.some((d) => d.ruleId === 'R005'), '应含安全校验决策');
  assert.ok(plan.decisions.some((d) => d.ruleId === 'R004'), '应含主粮类型建议决策');
});

test('餐单：模式A 无主粮、输出每日鲜食', () => {
  const plan = generateMealPlan(buildProfile({ ...baseProfile, feedingMode: 'A', kibbleLabel: null }));
  assert.equal(plan.kibble, null);
  assert.equal(plan.freshMeals.length, 3);
  assert.equal(plan.supplement.length, 0);
});

test('餐单：过敏史过滤食材', () => {
  const plan = generateMealPlan(buildProfile({ ...baseProfile, allergies: ['鸡肉'] }));
  assert.ok(!plan.supplement.some((s) => s.name === '鸡胸肉'), '过敏鸡肉时不得出现鸡胸肉');
  assert.ok(plan.decisions.some((d) => d.ruleId === 'R006'), '应含过敏过滤决策');
});

test('餐单：输出食材不命中黑名单', () => {
  const plan = generateMealPlan(buildProfile(baseProfile));
  const names = [...plan.supplement, ...(plan.freshMeals || [])].map((i) => i.name);
  assert.ok(names.every((n) => !['洋葱', '葡萄', '巧克力'].includes(n)));
});
