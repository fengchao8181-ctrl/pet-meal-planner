// 小程序端：每日喂食打卡 + 健康周报 → 页面渲染模型的纯逻辑（无 wx 依赖，可单元测试）
// 「有爱」主题：情绪层（心情/用心值/暖心寄语）与客观数据（打卡/体重）分层表达

var MOOD_OPTIONS = [
  { key: 'happy', label: '开心', emoji: '😄' },
  { key: 'sleepy', label: '犯困', emoji: '😴' },
  { key: 'proud', label: '傲娇', emoji: '😼' },
  { key: 'calm', label: '安静', emoji: '😌' },
  { key: 'naughty', label: '闹腾', emoji: '🙈' }
];

var MOOD_MAP = {};
MOOD_OPTIONS.forEach(function (m) { MOOD_MAP[m.key] = m; });

// 连续打卡里程碑节点
var MILESTONES = [7, 30];

function pad(n) { return n < 10 ? '0' + n : '' + n; }

function fmtDate(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function parseDate(s) {
  var p = s.split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}

function todayStr() { return fmtDate(new Date()); }

// 最近 N 天的日期数组（含今天），按时间升序
function lastNDays(n, ref) {
  var base = ((ref && parseDate(ref)) || new Date());
  var out = [];
  var d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  for (var i = n - 1; i >= 0; i--) {
    var cur = new Date(d.getFullYear(), d.getMonth(), d.getDate() - i);
    out.push(fmtDate(cur));
  }
  return out;
}

// 打卡状态盒：最近 N 天，每格 {date, checked, mood, isToday}
function buildCheckinGrid(records, n, ref) {
  var map = {};
  (records || []).forEach(function (r) { map[r.date] = r; });
  var days = lastNDays(n || 7, ref);
  var today = ref || todayStr();
  return days.map(function (date) {
    var hit = map[date];
    return {
      date: date,
      isToday: date === today,
      checked: Boolean(hit),
      mood: hit ? hit.mood : null,
      moodEmoji: hit && hit.mood && MOOD_MAP[hit.mood] ? MOOD_MAP[hit.mood].emoji : null
    };
  });
}

// 今天是否已打卡
function isCheckedToday(records, ref) {
  var today = ref || todayStr();
  var hit = false;
  (records || []).forEach(function (r) { if (r.date === today) hit = true; });
  return hit;
}

// 本周报告：由后端 report 适配为渲染模型（含可用心值口径、可展开）
function buildReportModel(report, breakdown) {
  if (!report) return null;
  return {
    weekStart: report.weekStart,
    weekEnd: report.weekEnd,
    checkRate: report.checkRate,
    streakDays: report.streakDays,
    avgExec: report.avgExec,
    weightPoints: report.weightPoints || [],
    moodKey: report.moodTop,
    moodLabel: report.moodTop && MOOD_MAP[report.moodTop] ? MOOD_MAP[report.moodTop].label : null,
    moodEmoji: report.moodTop && MOOD_MAP[report.moodTop] ? MOOD_MAP[report.moodTop].emoji : null,
    loveScore: report.loveScore,
    breakdown: breakdown || '',
    summary: report.summary,
    tips: report.tips || []
  };
}

// 打卡后即时情绪反馈（按是否新里程碑选择语气）
function afterCheckinFeedback(streak, moodKey) {
  if (streak === 7) return '连续一周陪你吃饭，豆豆一定很安心 🥰';
  if (streak === 30) return '整整 30 天，你是它最认真的家人，太棒了 🎉';
  if (moodKey && MOOD_MAP[moodKey]) return '你记得它今天「' + MOOD_MAP[moodKey].label + '」的样子，真好 🐾';
  return '你记得喂它了，它一定很开心 🐾';
}

// 里程碑是否触达（用于弹庆祝）
function milestoneHit(streak) {
  return MILESTONES.indexOf(streak) !== -1;
}

// 连续打卡天数（客户端算，依赖最近 N 天记录已按 date 键去重）
function computeStreakLocal(records, ref) {
  var set = {};
  (records || []).forEach(function (r) { set[r.date] = 1; });
  var base = (ref && parseDate(ref)) || new Date();
  var cursor = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  if (!set[fmtDate(cursor)]) {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1);
  }
  var n = 0;
  while (set[fmtDate(cursor)]) {
    n += 1;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1);
  }
  return n;
}

module.exports = {
  MOOD_OPTIONS: MOOD_OPTIONS,
  MILESTONE_NODES: MILESTONES,
  todayStr: todayStr,
  lastNDays: lastNDays,
  buildCheckinGrid: buildCheckinGrid,
  isCheckedToday: isCheckedToday,
  buildReportModel: buildReportModel,
  afterCheckinFeedback: afterCheckinFeedback,
  milestoneHit: milestoneHit,
  computeStreakLocal: computeStreakLocal
};