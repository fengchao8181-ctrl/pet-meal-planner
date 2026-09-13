// 推送服务：订阅者管理 + 每日 H5 触达任务 + 迷你订阅消息触发
// 依赖注入 gateway 与 checkinStore，业务层不感知具体存储；凭证缺失时网关自动降级 Mock。
import {
  pickDailyContent, dailyKey, todayIso, addDaysIso, weekdayIdx, PushDomainError
} from '../domain/push.js';
import { calcStreak } from '../domain/checkin.js';

const MOOD_LABELS = { happy: '开心', sleepy: '犯困', proud: '傲娇', calm: '安静', naughty: '闹腾' };
const MAX_LOGS = 200;

export class PushService {
  constructor({ gateway, checkinStore, now = null }) {
    this.gateway = gateway;
    this.checkinStore = checkinStore; // 需实现 listCheckins(petKey, from, to)
    this.now = now;                   // 可注入固定时间以便测试
    this.subscribers = new Map();     // petKey -> Subscriber
    this.logs = [];                   // 最新在前
  }

  todayStr() {
    return todayIso(this.now);
  }

  // ---- 订阅者管理 ----
  subscribe({ petKey, petName, breed, miniOpenid, pref }) {
    if (!petKey || !String(petKey).trim()) throw new PushDomainError('缺少宠物键', 'PUSH_BAD_KEY');
    const cur = this.subscribers.get(petKey) || {};
    const sub = {
      petKey: String(petKey).trim(),
      petName: petName || cur.petName || '小可爱',
      breed: breed != null ? breed : (cur.breed || null),
      miniOpenid: miniOpenid != null ? miniOpenid : (cur.miniOpenid || null),
      pref: { dailyH5: true, feedRemind: true, report: true, milestone: true, ...(cur.pref || {}), ...(pref || {}) },
      createdAt: cur.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.subscribers.set(sub.petKey, sub);
    return sub;
  }

  getSubscriber(petKey) { return this.subscribers.get(petKey) || null; }
  listSubscribers() { return [...this.subscribers.values()]; }

  updatePref(petKey, patch) {
    const s = this.getSubscriber(petKey);
    if (!s) throw new PushDomainError('该宠物尚未订阅推送', 'PUSH_NOT_SUBSCRIBED');
    s.pref = { ...s.pref, ...(patch || {}) };
    s.updatedAt = new Date().toISOString();
    return s;
  }

  unsubscribe(petKey) { return this.subscribers.delete(petKey); }

  // ---- 今日上下文快照（从打卡记录计算，喂给纯内容挑选函数）----
  async snapshotFor(petKey) {
    const sub = this.getSubscriber(petKey);
    if (!sub) return null;
    const today = this.todayStr();
    const from = addDaysIso(today, -29);
    const records = await this.checkinStore.listCheckins(petKey, from, today) || [];
    const fedToday = records.some((r) => r.date === today);
    const dates = [...new Set(records.map((r) => r.date))];
    const streak = calcStreak(dates, today);
    const last = records[records.length - 1] || null; // asc 排序取最近
    const lastExecPct = last && last.execPct != null ? last.execPct : null;

    // 本周（周一~今天）用于周报场景判断与心情
    const monday = addDaysIso(today, -weekdayIdx(today));
    const weekRecords = records.filter((r) => r.date >= monday && r.date <= today);
    const moodCount = {};
    weekRecords.forEach((r) => { if (r.mood) moodCount[r.mood] = (moodCount[r.mood] || 0) + 1; });
    let moodTop = null;
    for (const m in moodCount) { if (!moodTop || moodCount[m] > moodCount[moodTop]) moodTop = m; }

    return {
      sub, today, fedToday, streak, lastExecPct,
      moodTop: moodTop ? MOOD_LABELS[moodTop] : null,
      hasWeekReport: weekRecords.length > 0,
      isReportDay: weekdayIdx(today) === 6
    };
  }

  // 预览某宠物今日内容（不产生下发，供开发/UI 查看）
  async previewFor(petKey) {
    const snap = await this.snapshotFor(petKey);
    if (!snap) return null;
    return {
      petKey, today: snap.today, channel: 'h5',
      ...pickDailyContent(snap)
    };
  }

  // ---- 每日 H5 任务：遍历订阅者逐一挑选下发，幂等（同日已发/退订/偏好关闭则跳过）----
  async sendDaily() {
    const today = this.todayStr();
    const sent = [], skipped = [], errors = [];
    const sentKeys = new Set(this.logs.filter((l) => l.event === 'sent').map((l) => l.key));

    for (const sub of this.listSubscribers()) {
      const key = dailyKey(sub.petKey, today);
      if (sub.pref.dailyH5 === false) { skipped.push({ petKey: sub.petKey, reason: 'opt_out' }); continue; }
      if (sentKeys.has(key)) { skipped.push({ petKey: sub.petKey, reason: 'already_sent' }); continue; }
      try {
        const snap = await this.snapshotFor(sub.petKey);
        const content = pickDailyContent(snap);
        const res = await this.gateway.sendH5({ petKey: sub.petKey, openid: sub.miniOpenid, content });
        this._log({ event: 'sent', key, petKey: sub.petKey, scene: content.scene, channel: 'h5', at: new Date().toISOString(), wxErrCode: res && res.errcode });
        sentKeys.add(key);
        sent.push({ petKey: sub.petKey, scene: content.scene, title: content.title, errcode: res && res.errcode });
      } catch (err) {
        this._log({ event: 'error', key, petKey: sub.petKey, message: err.message, at: new Date().toISOString() });
        errors.push({ petKey: sub.petKey, message: err.message });
      }
    }
    return { today, total: this.listSubscribers().length, sent, skipped, errors };
  }

  // ---- 小程序订阅消息触发（一次性，关键时机用足名额）----
  async sendTrigger({ petKey, scene, templateId, page, data }) {
    const sub = this.getSubscriber(petKey);
    if (!sub) { throw new PushDomainError('该宠物尚未订阅', 'PUSH_NOT_SUBSCRIBED'); }
    if (sub.pref[scene] === false) { throw new PushDomainError('该场景已关闭', 'PUSH_PREF_OFF'); }
    const snap = await this.snapshotFor(petKey);
    const content = pickDailyContent(snap);
    const res = await this.gateway.sendSubscribe({
      openid: sub.miniOpenid,
      templateId: templateId,
      page: page || 'pages/checkin/checkin',
      data: data || { thing1: { value: content.title.slice(0, 20) }, thing2: { value: content.body.slice(0, 30) } }
    });
    this._log({ event: 'sent', key: `${sub.petKey}@${this.todayStr()}:${scene}`, petKey: sub.petKey, scene, channel: 'subscribe', at: new Date().toISOString(), wxErrCode: res && res.errcode });
    return res;
  }

  _log(entry) {
    this.logs.unshift(entry);
    if (this.logs.length > MAX_LOGS) this.logs.length = MAX_LOGS;
  }

  recentLogs(n = 20) { return this.logs.slice(0, n); }
}