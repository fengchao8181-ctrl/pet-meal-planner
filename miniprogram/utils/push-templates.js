// 「有爱」推送内容库（4 类模板，纯逻辑、无 wx 依赖，可单测）
// 策略见设计文档 §8：一次性订阅稀缺 → 只推最高价值的关键触发；宠物第一人称 + 个性化称呼贴近客户
// 填入正式模板 ID 与接真实下发后即可直接启用；本文件只在 UI 显示用例时渲染文案

// 每类模板：key / label / trigger(触发时机) / build(params) -> {title, body}
function buildFeedRemind(p) {
  return { title: (p.petName || '小可爱') + '在等你开饭啦 🐾', body: '今天也记得按时喂它，它一定很开心。' };
}
function buildReportReady(p) {
  return { title: (p.petName || '小可爱') + '的本周报告出炉了 💗', body: '看看这周你一起坚持了多少天，解锁用心值。' };
}
function buildMilestone(p) {
  return { title: '太棒了，连续 ' + (p.streak || 0) + ' 天 🎉', body: '你是' + (p.petName || '小可爱') + '最认真的家人，继续保持。' };
}
function buildDailyCare(p) {
  return { title: '今日份爱意 💗', body: (p.petName || '小可爱') + '最需要规律：早起喂、多陪伴、及时给水。' };
}

var TEMPLATES = [
  { key: 'feeding_remind', label: '喂食提醒', trigger: '用户自设喂食时段', build: buildFeedRemind },
  { key: 'report_ready', label: '周报通知', trigger: '每周周报生成时', build: buildReportReady },
  { key: 'milestone', label: '里程碑庆祝', trigger: '连续打卡 7/30 天', build: buildMilestone },
  { key: 'daily_care', label: '暖心关怀', trigger: '每日柔性触达（公众号 H5 场景）', build: buildDailyCare }
];

var MAP = {};
TEMPLATES.forEach(function (t) { MAP[t.key] = t; });

// 解析某类模板；未知 key 返回 null
function resolve(key, vars) {
  var t = MAP[key];
  if (!t) return null;
  return t.build(vars || {});
}

// 供 UI/运营查看所有可选模板（含触发时机说明）
function list() {
  return TEMPLATES.map(function (t) {
    return { key: t.key, label: t.label, trigger: t.trigger };
  });
}

module.exports = { TEMPLATES: TEMPLATES, resolve: resolve, list: list };