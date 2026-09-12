// 餐单生成器：基于宠物档案与规则引擎，输出三层喂养模式的餐单
// 输出含完整 decisions 决策链（ruleId/version），可审计可回溯
import { FORBIDDEN_FOODS, SUPPLEMENT_FOODS } from './constants.js';
import { computeDailyKcal, inferBodyType } from './rules-engine.js';
import { allocateKcal, FEEDING_MODES } from './feeding-mode.js';
import { kibbleTypeAdvice, kibbleGramsPerDay } from './profile.js';

const ALLERGY_MAP = {
  '鸡胸肉': '鸡肉', '三文鱼': '鱼肉', '熟鸡蛋': '鸡蛋', '无糖酸奶': '乳制品'
};

export function generateMealPlan(profile) {
  const decisions = [];
  const { derKcal, rerKcal, stage, body } = computeDailyKcal(profile, decisions);
  const alloc = allocateKcal(profile.feedingMode, derKcal);
  decisions.push({
    ruleId: 'R003', version: '1.0.0', name: '喂养模式热量分配',
    input: { mode: profile.feedingMode },
    output: alloc
  });

  const plan = {
    planId: crypto.randomUUID(),
    mode: profile.feedingMode,
    modeLabel: FEEDING_MODES[profile.feedingMode].label,
    ruleVersion: decisions[0].version,
    pet: { name: profile.petName, breed: profile.breed, weightKg: profile.weightKg, bodyType: body.label, stage: stage.label },
    derKcal, rerKcal,
    kibble: null, supplement: [], freshMeals: null,
    warnings: [],
    decisions
  };

  if (profile.feedingMode === 'A') {
    plan.freshMeals = buildFreshMeal(alloc.derKcal, profile, decisions);
  } else {
    const advice = kibbleTypeAdvice(profile.kibbleLabel, profile.lifeStage);
    const grams = kibbleGramsPerDay(alloc.kibbleKcal, profile.kibbleLabel);
    plan.kibble = { gramsPerDay: grams, typeAdvice: advice };
    if (advice) {
      decisions.push({ ruleId: 'R004', version: '1.0.0', name: '主粮类型建议', input: { label: profile.kibbleLabel }, output: advice });
    }
    if (grams === null) plan.warnings.push('主粮标签缺少热量值，无法换算每日克数，请按包装建议量喂食');
    if (advice && advice.tips.some((t) => t.includes('<18%') || t.includes('偏高'))) {
      plan.warnings.push('当前主粮蛋白/脂肪参数偏离参考区间，建议按类型建议更换');
    }
    if (profile.feedingMode === 'B') {
      plan.supplement = buildSupplement(alloc.supplementKcal, profile, decisions);
    } else {
      plan.freshMeals = buildFreshMeal(alloc.supplementKcal, profile, decisions);
    }
  }

  assertFoodSafety(plan);
  return plan;
}

function buildSupplement(supplementKcal, profile, decisions) {
  const picks = pickFoods(profile, decisions);
  const totalKcal = picks.reduce((s, f) => s + f.kcalPer100g, 0);
  return picks.map((f) => {
    const grams = round1((supplementKcal * (f.kcalPer100g / totalKcal) / f.kcalPer100g) * 100);
    return { name: f.name, grams, kcal: round1(supplementKcal * (f.kcalPer100g / totalKcal)), purpose: f.purpose };
  });
}

function buildFreshMeal(kcalTarget, profile, decisions) {
  const picks = pickFoods(profile, decisions);
  const protein = picks.filter((f) => f.protein >= 10);
  const veg = picks.filter((f) => f.protein < 10 && f.kcalPer100g < 100);
  const fruit = picks.filter((f) => f.protein < 10 && f.kcalPer100g >= 100);

  const main = protein[0] || picks[0];
  const side = veg[0] || picks[1];
  const fruitPick = fruit[0] || side;

  const weights = [
    { food: main, ratio: 0.6 },
    { food: side, ratio: 0.3 },
    { food: fruitPick, ratio: 0.1 }
  ];
  return weights.map(({ food, ratio }) => ({
    name: food.name,
    grams: round1((kcalTarget * ratio / food.kcalPer100g) * 100),
    kcal: round1(kcalTarget * ratio),
    purpose: food.purpose
  }));
}

// 按过敏史与功能方向选 2-3 种辅食食材
function pickFoods(profile, decisions) {
  const allergySources = new Set(profile.allergies);
  const pool = Object.values(SUPPLEMENT_FOODS).filter((f) => {
    const src = ALLERGY_MAP[f.name];
    return src ? !allergySources.has(src) : true;
  });
  if (pool.length === 0) throw new Error('过敏史覆盖全部可用食材，需人工配餐');

  const preference = profile.allergies.includes('谷物') || profile.allergies.includes('乳制品') ? 'gut' : 'skin';
  const preferred = pool.filter((f) => f.purpose === preference);
  const others = pool.filter((f) => f.purpose !== preference);
  const picks = (preferred.length >= 2 ? preferred : preferred.concat(others)).slice(0, 3);

  decisions.push({
    ruleId: 'R006', version: '1.0.0', name: '过敏源过滤',
    input: { allergies: profile.allergies },
    output: { picked: picks.map((p) => p.name), excluded: Object.values(SUPPLEMENT_FOODS).filter((f) => !picks.includes(f)).map((f) => f.name) }
  });
  return picks;
}

// 黑名单校验（R005）：任何输出食材不得命中禁食清单
function assertFoodSafety(plan) {
  const items = [
    ...(plan.supplement || []),
    ...(plan.freshMeals || [])
  ].map((i) => i.name);
  const hit = items.find((name) => FORBIDDEN_FOODS.includes(name));
  if (hit) throw new Error(`食材安全校验失败，命中黑名单: ${hit}`);
  if (items.length > 0) {
    plan.decisions.push({
      ruleId: 'R005', version: '1.0.0', name: '食材安全校验',
      input: { foods: items }, output: { safe: true }
    });
  }
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
