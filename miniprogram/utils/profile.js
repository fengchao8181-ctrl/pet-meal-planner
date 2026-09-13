// 小程序端：档案表单 → 后端 profile payload 的纯逻辑（无 wx 依赖，可单元测试）
// 字段与 EdgeOne 后端 src/domain/profile.js 的 buildProfile 严格对齐

var LIFE_STAGES = ['puppy', 'adult', 'senior'];
var ACTIVITIES = ['low', 'mid', 'high'];
var FEEDING_MODES = ['A', 'B', 'C'];

// 校验表单原始值，返回错误数组（空数组=通过）；校验逻辑与后端一致
function validateProfile(raw) {
  var errs = [];
  if (!raw) return ['缺少档案数据'];
  var w = Number(raw.weightKg);
  if (!(w > 0.5 && w <= 80)) errs.push('体重需在 0.5-80kg 之间');
  var a = Number(raw.ageMonths);
  if (!(a > 0 && a <= 240)) errs.push('年龄需在 1-240 个月之间');
  if (LIFE_STAGES.indexOf(raw.lifeStage) < 0) errs.push('生命阶段无效');
  if (ACTIVITIES.indexOf(raw.activity) < 0) errs.push('活动量无效');
  if (FEEDING_MODES.indexOf(raw.feedingMode) < 0) errs.push('喂养模式无效');
  if (raw.feedingMode !== 'A' && !raw.kibbleLabel) errs.push('模式 B/C 需提供主粮标签（粗蛋白或热量至少一项）');
  else if (raw.feedingMode !== 'A' && raw.kibbleLabel) {
    if (Number(raw.kibbleLabel.proteinPct) == null && Number(raw.kibbleLabel.kcalPer100g) == null) {
      errs.push('模式 B/C 需至少填写「粗蛋白」或「热量」一项');
    }
  }
  return errs;
}

// 表单原始值 → 后端 profile payload（清理空字段、归一化类型）
function buildPayload(raw) {
  var label = {};
  if (raw.kibbleLabel) {
    label = {
      proteinPct: num(raw.kibbleLabel.proteinPct),
      fatPct: num(raw.kibbleLabel.fatPct),
      fiberPct: num(raw.kibbleLabel.fiberPct),
      kcalPer100g: num(raw.kibbleLabel.kcalPer100g),
      grainFree: !!raw.kibbleLabel.grainFree,
      avoidSources: Array.isArray(raw.kibbleLabel.avoidSources) ? raw.kibbleLabel.avoidSources : []
    };
  }
  var payload = {
    petName: String(raw.petName || '').trim() || '毛孩子',
    breed: String(raw.breed || '').trim() || '未知品种',
    weightKg: Number(raw.weightKg),
    ageMonths: Number(raw.ageMonths),
    lifeStage: raw.lifeStage,
    activity: raw.activity,
    neutered: !!raw.neutered,
    allergies: Array.isArray(raw.allergies) ? raw.allergies : [],
    feedingMode: raw.feedingMode
  };
  if (raw.feedingMode !== 'A') payload.kibbleLabel = label;
  return payload;
}

function num(v) {
  var n = Number(v);
  return v === '' || v == null || !isFinite(n) ? null : n;
}

module.exports = { validateProfile: validateProfile, buildPayload: buildPayload };