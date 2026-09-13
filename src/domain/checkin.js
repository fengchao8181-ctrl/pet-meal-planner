// 每日喂食打卡 + 健康周报领域逻辑（纯函数、无 I/O，可单测）
// 「有爱」主题：底层健康数据客观可信（完成率/执行度/体重），情绪层（用心值/小结）尽情暖心
// 周界定：周一为一周起点

export const MOODS = ['happy', 'sleepy', 'proud', 'calm', 'naughty'];
export const MOOD_LABELS = {
  happy: '开心', sleepy: '犯困', proud: '傲娇', calm: '安静', naughty: '闹腾'
};

export const ALL_DAYS = 7;

function fmt(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parse(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// 归一化布尔/数字：避免 0 或无效值被误伤
function num(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

export class CheckinDomainError extends Error {
  constructor(message, code, details) {
    super(message);
    this.code = code || 'CHECKIN_INVALID';
    this.details = details;
  }
}

// 校验并归一化一条打卡记录（幂等等价键：petKey + date）
export function buildCheckin({ petKey, date = null, mood = null, execPct = null, weightKg = null }) {
  if (!petKey || !String(petKey).trim()) throw new CheckinDomainError('缺少打卡主体', 'CHECKIN_BAD_KEY');
  const d = date ? String(date) : fmt(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new CheckinDomainError('打卡日期格式非法', 'CHECKIN_BAD_DATE', { date: d });

  const rec = {
    id: crypto.randomUUID(),
    petKey: String(petKey).trim(),
    date: d,
    fedAt: new Date().toISOString(),
    mood: null,
    execPct: null,
    weightKg: null,
    createdAt: new Date().toISOString()
  };

  if (mood != null && String(mood).trim() !== '') {
    const m = String(mood).trim();
    if (!MOODS.includes(m)) throw new CheckinDomainError('未知心情', 'CHECKIN_BAD_MOOD', { mood: m });
    rec.mood = m;
  }
  const e = num(execPct);
  if (e !== null) {
    if (e < 0 || e > 100) throw new CheckinDomainError('喂食执行度需在 0-100', 'CHECKIN_BAD_EXEC', { execPct: e });
    rec.execPct = Math.round(e);
  }
  const w = num(weightKg);
  if (w !== null) {
    if (!(w > 0 && w < 200)) throw new CheckinDomainError('体重数值非法', 'CHECKIN_BAD_WEIGHT', { weightKg: w });
    rec.weightKg = w;
  }
  return rec;
}

// 指定日（或缺省今天）所在周的 [周一, 周日]
export function weekRange(refDate = null) {
  const d = refDate ? parse(refDate) : new Date();
  const dow = (d.getDay() + 6) % 7; // 周一=0 → 周日=6
  const start = new Date(d);
  start.setDate(d.getDate() - dow);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start: fmt(start), end: fmt(end) };
}

// 连续打卡天数：向上追溯到最近的连续日期，截至 today（若 today 未打卡则不把今天计入，退到昨天）
export function calcStreak(dateSet, today = null) {
  let cursor = parse(today || fmt(new Date()));
  const set = new Set(dateSet);
  if (!set.has(fmt(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  let n = 0;
  while (set.has(fmt(cursor))) {
    n += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return n;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function daysBetween(start, end) {
  return Math.round((parse(end) - parse(start)) / 86400000) + 1;
}

// 生成健康周报；records 应为 [weekStart, weekEnd] 区间内该 petKey 的打卡记录
// today 用于连续天数以"当日"为基准（周六生成周报时不过度追算未来）
export function computeWeeklyReport({ petKey, records = [], weekStart, weekEnd, petName = null, today = null }) {
  const days = daysBetween(weekStart, weekEnd);
  const checkDays = new Set(records.map((r) => r.date)).size;
  const checkRate = Math.round((checkDays / days) * 100);
  const streakToday = today || fmt(new Date());

  const sortAsc = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const dates = [...new Set(records.map((r) => r.date))].sort(sortAsc);
  // streak 基准取「今天」与「周末」中较早者，避免未来日期过度追算
  const refDate = parse(streakToday) > parse(weekEnd) ? weekEnd : streakToday;
  const streakDays = calcStreak(dates, refDate);

  const execs = records.filter((r) => r.execPct != null).map((r) => r.execPct);
  const avgExec = execs.length ? Math.round(execs.reduce((a, b) => a + b, 0) / execs.length) : null;

  const weightPoints = records
    .filter((r) => r.weightKg != null)
    .map((r) => ({ date: r.date, weightKg: r.weightKg }))
    .sort((a, b) => sortAsc(a.date, b.date));

  const moodCount = {};
  records.forEach((r) => { if (r.mood) moodCount[r.mood] = (moodCount[r.mood] || 0) + 1; });
  let moodTop = null;
  let maxC = 0;
  for (const m in moodCount) {
    if (moodCount[m] > maxC) { maxC = moodCount[m]; moodTop = m; }
  }

  // 用心值（情绪层）：连续占比 40 + 执行度 40 + 体重记录 20，可展开看口径
  const loveScore = clamp(Math.round(
    (streakDays / ALL_DAYS) * 40 +
    (avgExec != null ? avgExec * 0.4 : 0) +
    (weightPoints.length / ALL_DAYS) * 20
  ), 0, 100);

  const summary = buildSummary({ petName, checkDays, days, avgExec, weightPoints, moodTop, streakDays });
  const tips = buildTips({ avgExec });

  return {
    id: crypto.randomUUID(),
    petKey,
    weekStart,
    weekEnd,
    checkRate,
    streakDays,
    avgExec,
    weightPoints,
    moodTop,
    loveScore,
    summary,
    tips,
    createdAt: new Date().toISOString()
  };
}

// 用心值口径文案（供 UI「可展开看口径」使用）
export function loveScoreBreakdown({ checkDays, avgExec, weightCount }) {
  return `本周打卡 ${checkDays}/7 天 · 平均执行 ${avgExec == null ? '—' : avgExec + '%'} · 记录 ${weightCount || 0} 次体重`;
}

function numFmt(n) {
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : n;
}

function buildSummary({ petName, checkDays, days, avgExec, weightPoints, moodTop, streakDays }) {
  const name = petName || '小可爱';
  const rate = Math.round((checkDays / days) * 100);
  let verb; // 完成率叙事句
  if (rate >= 71) verb = '喂养很规律，状态稳定，继续保持这份认真';
  else if (rate >= 43) verb = '偶尔有间隙，试着固定到同一个钟点，会更好';
  else verb = '先从每天打卡这个小目标开始，别给自己压力';
  const parts = [`你和${name}已经一起坚持了 ${streakDays} 天，这周${verb}。`];
  if (moodTop) parts.push(`它本周最常「${MOOD_LABELS[moodTop]}」，你可以多留意一下它的小情绪。`);
  if (weightPoints.length >= 2) {
    const first = weightPoints[0].weightKg;
    const last = weightPoints[weightPoints.length - 1].weightKg;
    const delta = numFmt(last - first);
    if (delta !== 0) parts.push(`体重从 ${first} kg 到 ${last} kg，${delta > 0 ? '增加了' : '轻了'} ${Math.abs(delta)} kg。`);
    else parts.push(`体重稳定在 ${last} kg，很健康。`);
  } else if (weightPoints.length === 1) {
    parts.push(`这周称了一次，${weightPoints[0].weightKg} kg。`);
  }
  if (avgExec != null && avgExec < 85) {
    parts.push('执行度略低于建议，可以按配比循序渐进，别一次减太多。');
  }
  return parts.join('');
}

function buildTips({ avgExec }) {
  const tips = ['固定喂食时段，和它一起养成规律的生活', '每周至少称一次体重，观察变化趋势'];
  if (avgExec != null && avgExec < 85) {
    tips.push('当前餐量达成率偏低，建议先按每日热量等比微调，稳步过渡');
  }
  return tips;
}