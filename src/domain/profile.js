// 宠物档案：问诊数据结构、校验、主粮标签解析与类型建议（R004，不推荐任何品牌）
import { LIFE_STAGES, ALLERGEN_SOURCES } from './constants.js';
import { FEEDING_MODES } from './feeding-mode.js';

export function buildProfile(raw) {
  const err = validate(raw);
  if (err.length > 0) {
    const e = new Error('档案校验失败: ' + err.join('；'));
    e.code = 'PROFILE_INVALID';
    e.details = err;
    throw e;
  }
  return {
    petName: String(raw.petName || '').trim() || '毛孩子',
    species: 'dog',
    breed: String(raw.breed || '未知品种').trim(),
    weightKg: Number(raw.weightKg),
    ageMonths: Number(raw.ageMonths),
    lifeStage: raw.lifeStage,
    neutered: Boolean(raw.neutered),
    activity: raw.activity,
    feedingMode: raw.feedingMode,
    allergies: Array.isArray(raw.allergies) ? raw.allergies.filter((a) => ALLERGEN_SOURCES.includes(a)) : [],
    kibbleLabel: raw.kibbleLabel ? normalizeLabel(raw.kibbleLabel) : null,
    createdAt: new Date().toISOString()
  };
}

function validate(raw) {
  const errs = [];
  if (!raw) return ['缺少档案数据'];
  const w = Number(raw.weightKg);
  if (!(w > 0.5 && w <= 80)) errs.push('体重需在 0.5-80kg 之间');
  const a = Number(raw.ageMonths);
  if (!(a > 0 && a <= 240)) errs.push('年龄需在 1-240 个月之间');
  if (!LIFE_STAGES[raw.lifeStage]) errs.push('生命阶段无效');
  if (!['low', 'mid', 'high'].includes(raw.activity)) errs.push('活动量无效');
  if (!FEEDING_MODES[raw.feedingMode]) errs.push('喂养模式无效');
  if (raw.feedingMode !== 'A' && !raw.kibbleLabel) errs.push('模式B/C 需提供主粮标签信息');
  return errs;
}

function normalizeLabel(label) {
  return {
    proteinPct: num(label.proteinPct),
    fatPct: num(label.fatPct),
    fiberPct: num(label.fiberPct),
    kcalPer100g: num(label.kcalPer100g),
    grainFree: Boolean(label.grainFree),
    avoidSources: Array.isArray(label.avoidSources) ? label.avoidSources : []
  };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// 主粮类型建议：只给类型参数，不出现品牌名
export function kibbleTypeAdvice(label, lifeStage) {
  if (!label) return null;
  const tips = [];
  if (label.proteinPct !== null) {
    if (label.proteinPct >= 30) tips.push('粗蛋白 ≥30% 的高蛋白型');
    else if (label.proteinPct >= 18) tips.push('粗蛋白 18-30% 的标准型');
    else tips.push('粗蛋白 <18%，低于全价成犬粮参考下限，建议升级蛋白质含量');
  }
  if (label.fatPct !== null) {
    if (label.fatPct > 20) tips.push('粗脂肪 >20%，偏高（有肥胖倾向需留意）');
    else if (label.fatPct >= 10) tips.push('粗脂肪 10-20% 的标准区间');
    else tips.push('粗脂肪 <10%，低脂型（适合减重期）');
  }
  if (label.grainFree) tips.push('无谷型');
  if (label.avoidSources.length > 0) tips.push(`避开${label.avoidSources.join('/')}蛋白源`);
  const stageLabel = LIFE_STAGES[lifeStage] ? LIFE_STAGES[lifeStage].label : '成犬';
  return {
    stageLabel,
    tips,
    summary: `建议选择符合全价标准的${stageLabel}粮：` + (tips.join('；') || '按包装保证值对照全价声明')
  };
}

export function kibbleGramsPerDay(kibbleKcal, label) {
  if (!label || !label.kcalPer100g) return null;
  return Math.round((kibbleKcal / label.kcalPer100g) * 100);
}
