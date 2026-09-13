// 小程序端：餐单 → 页面渲染模型的纯逻辑（无 wx 依赖，可单元测试）
// 输入为 POST /api/plans/generate 返回的 plan；输出适配 WXML 渲染

var PURPOSE_LABEL = {
  joint: '关节', skin: '皮肤毛发', gut: '肠胃', none: '常规'
};

function buildPlanModel(plan) {
  if (!plan) return null;
  var freshMeals = plan.freshMeals || [];
  var model = {
    title: (plan.pet && plan.pet.name) + ' 的' + (plan.modeLabel || '') + '餐单',
    subtitle: sub(plan),
    derKcal: plan.derKcal,
    mode: plan.mode,
    kibble: plan.kibble
      ? {
        gramsPerDay: plan.kibble.gramsPerDay,
        summary: plan.kibble.typeAdvice ? plan.kibble.typeAdvice.summary : '',
        tips: plan.kibble.typeAdvice ? plan.kibble.typeAdvice.tips : [],
        gramsNote: plan.mode === 'B' ? '约占总热量 90%' : '约占总热量 70%'
      }
      : null,
    supplement: (plan.supplement || []).map(function (s) {
      return { name: s.name, grams: s.grams, purpose: PURPOSE_LABEL[s.purpose] || s.purpose };
    }),
    freshMeals: freshMeals.length
      ? freshMeals.map(function (m) { return { name: m.name, grams: m.grams, kcal: m.kcal }; })
      : null,
    freshTitle: plan.mode === 'A' ? '每日鲜食配方' : '鲜食顿次配方（每周 ' + freshMeals.length + ' 种搭配）',
    warnings: plan.warnings || [],
    decisionsCount: plan.decisions ? plan.decisions.length : 0,
    decisionsJson: plan.decisions ? JSON.stringify(plan.decisions, null, 2) : ''
  };
  return model;
}

function sub(plan) {
  var parts = [plan.pet.breed, plan.pet.weightKg + 'kg', plan.pet.bodyType + '体型', plan.pet.stage];
  if (plan.ruleVersion) parts.push('规则引擎 v' + plan.ruleVersion);
  return parts.join(' · ');
}

module.exports = { buildPlanModel: buildPlanModel };