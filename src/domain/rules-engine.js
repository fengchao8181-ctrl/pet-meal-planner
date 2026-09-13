// 规则引擎：将营养标准写成可执行、带版本号、可追溯的规则
// 每次求值返回 decisions[]（规则 id/版本/依据/结果），构成可审计决策链
import { RULE_VERSION, LIFE_STAGES, BODY_TYPES, ACTIVITY_LEVELS, NEUTER_FACTORS } from './constants.js';

const RULES = [
  { id: 'R001', version: '1.0.0', name: '静息能量 RER 计算', desc: 'RER = 70 × 体重kg^0.75（NRC 通用公式）' },
  { id: 'R002', version: '1.0.0', name: '每日能量 DER 校正', desc: 'DER = RER × 生命阶段 × 体型 × 活动量 × 绝育系数' },
  { id: 'R003', version: '1.0.0', name: '喂养模式热量分配', desc: '模式A 主粮0%；模式B 主粮≥80%热量、辅食≤10%（可放宽至20%）；模式C 主粮60-80% + 每周2-4顿鲜食' },
  { id: 'R004', version: '1.0.0', name: '主粮类型建议', desc: '按标签参数给类型建议，不推荐任何品牌' },
  { id: 'R005', version: '1.0.0', name: '食材安全校验', desc: '黑名单食材一律不得进入餐单/辅食' },
  { id: 'R006', version: '1.0.0', name: '过敏源过滤', desc: '问诊过敏史匹配的食材/蛋白源从输出中剔除' }
];

export function getRuleInfo() {
  return { engineVersion: RULE_VERSION, rules: RULES.map((r) => ({ ...r })) };
}

function record(decisions, rule, input, output) {
  decisions.push({ ruleId: rule.id, version: rule.version, name: rule.name, input, output });
}

export function inferBodyType(weightKg) {
  for (const key of Object.keys(BODY_TYPES)) {
    if (weightKg <= BODY_TYPES[key].weightMax) return BODY_TYPES[key];
  }
  return BODY_TYPES.GIANT;
}

export function computeDailyKcal(profile, decisions = []) {
  const rer = 70 * Math.pow(profile.weightKg, 0.75);
  record(decisions, RULES[0], { weightKg: profile.weightKg }, { rerKcal: round1(rer) });

  const stage = LIFE_STAGES[profile.lifeStage];
  const body = inferBodyType(profile.weightKg);
  const act = ACTIVITY_LEVELS[profile.activity];
  const neuter = NEUTER_FACTORS[profile.neutered ? 'YES' : 'NO'];
  const der = rer * stage.factor * body.factor * act.factor * neuter;
  record(decisions, RULES[1], { stage: stage.label, body: body.label, activity: act.label, neutered: profile.neutered }, { derKcal: round1(der) });

  return { rerKcal: round1(rer), derKcal: round1(der), stage, body, act, neuter };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
