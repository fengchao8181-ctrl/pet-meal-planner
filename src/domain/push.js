// 推送领域：每日推送内容挑选 + 个人化文案（纯函数、无 I/O，可单测）
// 「有爱」主题：H5 公众号每日柔性触达，内容围绕"客户自己的宠物"具体状态展开
// 分工见设计 §8.2：H5 管「每天在」（本文件 每日场景），小程序订阅消息管「关键时到」

export class PushDomainError extends Error {
  constructor(message, code, details) {
    super(message);
    this.code = code || 'PUSH_INVALID';
    this.details = details;
  }
}

// 周一=0 … 周日=6（与 checkin.weekRange 同一口径）
export function weekdayIdx(dateStr) {
  return (new Date(dateStr + 'T12:00:00').getDay() + 6) % 7;
}

// 另起一天的 ISO 日期
export function addDaysIso(dateStr, delta) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + delta);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// 当前自然日（可按 today 注入以便测试）
export function todayIso(now = null) {
  const d = now ? new Date(now) : new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// 幂等/去重键：同一 petKey 同一自然日只发一条 H5
export function dailyKey(petKey, date) {
  return `${petKey}@${date}`;
}

// 挑选今日对某宠物客户最合适的 H5 每日推送内容（优先级：周报 > 里程碑 > 喂食提醒 > 暖心关怀）
// img（context）需由服务层从打卡记录计算后注入，避免本函数感知 I/O。
export function pickDailyContent({ petName, fedToday, streak, lastExecPct, moodTop, hasWeekReport, isReportDay }) {
  const name = petName || '小可爱';

  // 1) 周日且本周有打卡 → 周报出炉（每日触达里最高价值，先推它）
  if (isReportDay && hasWeekReport) {
    return {
      scene: 'report_ready', emoji: '💗',
      title: `${name}的本周报告出炉了`,
      body: `这周你为它坚持了 ${Math.max(streak || 0, 0)} 天连续打卡，一起来看本周用心值涨了多少。`,
      data: { streak: streak || 0 }
    };
  }

  // 2) 今天已喂且命中里程碑（连续 7/30）→ 庆祝
  if (fedToday && (streak === 7 || streak === 30)) {
    return {
      scene: 'milestone', emoji: '🎉',
      title: `连续 ${streak} 天，太厉害了`,
      body: `你是${name}最认真的家人，这份每日的坚持它都记得。送你一朵小红花。`,
      data: { streak }
    };
  }

  // 3) 今天还没喂 → 喂食提醒（正向、不指责）
  if (!fedToday) {
    return {
      scene: 'feeding_remind', emoji: '🐾',
      title: `${name}在等你开饭啦`,
      body: `今天还没为它打卡喂食，记得给${name}一碗刚好的正餐，它会很开心。`,
      data: { fedToday: false }
    };
  }

  // 4) 兜底：暖心关怀（已喂过，带今天的真实细节，像家人记得它）
  let tip;
  if (lastExecPct != null && lastExecPct < 85) tip = `今天它吃掉了 ${lastExecPct}%，可以先按配比循序渐进，别一次减太多。`;
  else if (lastExecPct != null) tip = `今天它吃掉了 ${lastExecPct}%，状态很棒，保持这份规律就好。`;
  else if (moodTop) tip = `它最近常「${moodTop}」，多留意它的小情绪，陪伴是最好的喂食。`;
  else tip = '每天固定钟点喂它，是它最安心的生活节律。';

  return {
    scene: 'daily_care', emoji: '💗',
    title: '今日份爱意',
    body: `${name}今天已经吃过啦，${tip}`,
    data: { streak: streak || 0 }
  };
}