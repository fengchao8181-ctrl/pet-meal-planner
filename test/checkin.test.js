// 「有爱」留存阶段一：打卡 + 健康周报领域逻辑单测（纯函数，无 I/O）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCheckin, weekRange, calcStreak, computeWeeklyReport, loveScoreBreakdown,
  MOODS, CheckinDomainError
} from '../src/domain/checkin.js';

test('weekRange：周一起点、周日结束', () => {
  // 2026-09-09 是周三，所在周应为 09-07(周一) ~ 09-13(周日)
  const { start, end } = weekRange('2026-09-09');
  assert.equal(start, '2026-09-07');
  assert.equal(end, '2026-09-13');
  // 周一当天即起点
  assert.deepEqual(weekRange('2026-09-07'), { start: '2026-09-07', end: '2026-09-13' });
});

test('buildCheckin：校验默认值、心情白名单、执行度与体重边界', () => {
  const r = buildCheckin({ petKey: '豆豆', mood: 'happy', execPct: 85, weightKg: 8.5, date: '2026-09-09' });
  assert.equal(r.date, '2026-09-09');
  assert.equal(r.mood, 'happy');
  assert.equal(r.execPct, 85);
  assert.equal(r.weightKg, 8.5);
  assert.ok(r.id && r.createdAt);

  // 全空合法（最简打卡）
  const r2 = buildCheckin({ petKey: '豆豆' });
  assert.equal(r2.mood, null);
  assert.equal(r2.execPct, null);

  // 非法心情
  assert.throws(() => buildCheckin({ petKey: 'x', mood: 'angry' }), CheckinDomainError);
  // 越界执行度
  assert.throws(() => buildCheckin({ petKey: 'x', execPct: 101 }), CheckinDomainError);
  // 非法体重
  assert.throws(() => buildCheckin({ petKey: 'x', weightKg: -2 }), CheckinDomainError);
  // 缺主体
  assert.throws(() => buildCheckin({}), CheckinDomainError);
});

test('MOODS 导出与标签一致', () => {
  assert.deepEqual(MOODS, ['happy', 'sleepy', 'proud', 'calm', 'naughty']);
});

test('calcStreak：连续天数按最近连续日计算', () => {
  const dates = ['2026-09-11', '2026-09-12', '2026-09-13', '2026-09-15'];
  // 若 today=2026-09-15 已打卡 → 连续到 09-13 断，故 streak=1
  assert.equal(calcStreak(dates, '2026-09-15'), 1);
  // 若 today=2026-09-12（已打卡）→ 11,12 连续 = 2
  assert.equal(calcStreak(dates, '2026-09-12'), 2);
  // 今天未打卡（13 未在集合而 13 是 today）→ 退到昨天 12 → 11,12 =2
  assert.equal(calcStreak(['2026-09-11', '2026-09-12'], '2026-09-13'), 2);
  // 空集
  assert.equal(calcStreak([], '2026-09-15'), 0);
});

test('computeWeeklyReport：完成率/执行度/体重趋势/心情/用心值/小结', () => {
  const week = { weekStart: '2026-09-07', weekEnd: '2026-09-13' };
  const recs = [
    bind({ date: '2026-09-07', mood: 'happy', execPct: 100, weightKg: 9.0 }),
    bind({ date: '2026-09-08', mood: 'happy', execPct: 80 }),
    bind({ date: '2026-09-09', mood: 'sleepy', execPct: 90, weightKg: 8.8 }),
    bind({ date: '2026-09-10', mood: 'happy' }),
    bind({ date: '2026-09-11', mood: 'happy' }),
    bind({ date: '2026-09-12', mood: 'happy' }) // 昨天打卡 → streak 存活至 10-12
  ];
  const report = computeWeeklyReport({ petKey: 'dou', records: recs, ...week, petName: '豆豆', today: '2026-09-13' });
  assert.equal(report.checkRate, Math.round(6 / 7 * 100)); // 86
  assert.equal(report.streakDays, 6); // 07-12 连续 6 天
  assert.equal(report.avgExec, 90); // (100+80+90)/3
  assert.equal(report.weightPoints.length, 2);
  assert.equal(report.moodTop, 'happy'); // happy×3
  assert.ok(report.loveScore > 0 && report.loveScore <= 100);
  assert.match(report.summary, /豆豆/);
  assert.ok(report.tips.length >= 2);
  // 连续+进阶重打卡不会重复计天数（records 去重）
  const dup = computeWeeklyReport({ petKey: 'dou', records: [...recs, recs[0]], ...week, petName: '豆豆', today: '2026-09-13' });
  assert.equal(dup.checkRate, report.checkRate);
});

test('lovescoreBreakdown 口径文本', () => {
  const t = loveScoreBreakdown({ checkDays: 5, avgExec: 90, weightCount: 2 });
  assert.match(t, /5\/7 天/);
  assert.match(t, /90%/);
  assert.match(t, /2 次体重/);
});

function bind(p) {
  return { id: 'x', petKey: 'dou', fedAt: '2026-09-01T00:00:00Z', ...p, createdAt: '2026-09-01T00:00:00Z' };
}