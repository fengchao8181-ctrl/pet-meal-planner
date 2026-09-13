// 推送领域 + PushService 单测（纯函数 / Mock 网关，无真实微信依赖）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickDailyContent, weekdayIdx, dailyKey, addDaysIso, todayIso, PushDomainError
} from '../src/domain/push.js';
import { PushService } from '../src/services/push-service.js';
import { MockPushGateway, WechatH5PushGateway, createPushGatewayFromEnv } from '../src/services/push-gateway.js';

// ---------- 领域：内容挑选 ----------
test('pickDailyContent：周报日优先（周日 + 本周有打卡）', () => {
  const c = pickDailyContent({ petName: '麦麦', fedToday: true, streak: 3, isReportDay: true, hasWeekReport: true });
  assert.equal(c.scene, 'report_ready');
  assert.ok(c.title.includes('麦麦'));
});

test('pickDailyContent：里程碑（今天已喂且连续 7 天）', () => {
  const c = pickDailyContent({ petName: '豆豆', fedToday: true, streak: 7, isReportDay: false });
  assert.equal(c.scene, 'milestone');
  assert.ok(c.title.includes('7'));
});

test('pickDailyContent：今天未喂 → 喂食提醒', () => {
  const c = pickDailyContent({ petName: '汤圆', fedToday: false, streak: 0 });
  assert.equal(c.scene, 'feeding_remind');
  assert.ok(c.body.includes('汤圆'));
});

test('pickDailyContent：已喂兜底暖心关怀，带入执行度细节', () => {
  const good = pickDailyContent({ petName: '麦麦', fedToday: true, streak: 2, lastExecPct: 90 });
  assert.equal(good.scene, 'daily_care');
  assert.ok(good.body.includes('90%'));
  const low = pickDailyContent({ petName: '麦麦', fedToday: true, streak: 2, lastExecPct: 50 });
  assert.ok(low.body.includes('50%'));
});

test('weekdayIdx / dailyKey / addDaysIso / todayIso', () => {
  assert.equal(weekdayIdx('2026-09-07'), 0); // 周一
  assert.equal(weekdayIdx('2026-09-13'), 6); // 周日
  assert.equal(dailyKey('麦麦|柯基', '2026-09-08'), '麦麦|柯基@2026-09-08');
  assert.equal(addDaysIso('2026-09-08', -1), '2026-09-07');
  assert.equal(todayIso(new Date('2026-09-08T09:00:00')), '2026-09-08');
});

// ---------- 网关选择 ----------
test('createPushGatewayFromEnv：无凭证 → Mock 兜底；凭证齐备 → 真实网关', () => {
  assert.ok(createPushGatewayFromEnv({}) instanceof MockPushGateway);
  assert.ok(createPushGatewayFromEnv({ WX_APPID: 'a', WX_APP_SECRET: 'b', H5_TEMPLATE_ID: 't' }) instanceof WechatH5PushGateway);
});

// ---------- 服务：订阅、预览、每日任务、幂等、退订 ----------
function makeService(seedRecords = [], now = '2026-09-08T08:00:00') {
  const checkinStore = {
    async listCheckins(petKey, from, to) {
      return seedRecords
        .filter((r) => r.petKey === petKey && (!from || r.date >= from) && (!to || r.date <= to))
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    }
  };
  const gateway = new MockPushGateway();
  const service = new PushService({ gateway, checkinStore, now: new Date(now) });
  return { service, gateway };
}

test('subscribe：幂等（重复订阅为更新，不重复记档）', () => {
  const { service } = makeService();
  const a = service.subscribe({ petKey: '麦麦|柯基', petName: '麦麦' });
  const b = service.subscribe({ petKey: '麦麦|柯基', petName: '麦麦' });
  assert.equal(a.createdAt, b.createdAt);
  assert.equal(service.listSubscribers().length, 1);
});

test('previewFor：今日内容按宠物当前状态挑选', async () => {
  const { service } = makeService([{ petKey: '豆豆|边牧', date: '2026-09-07' }], '2026-09-08T08:00:00');
  service.subscribe({ petKey: '豆豆|边牧', petName: '豆豆' });
  const p = await service.previewFor('豆豆|边牧');
  assert.ok(p);
  assert.equal(p.channel, 'h5');
  assert.equal(p.scene, 'feeding_remind'); // 09-08 未喂
});

test('sendDaily：逐人下发 + 同日幂等跳过 + 退订跳过', async () => {
  const { service, gateway } = makeService([], '2026-09-08T08:00:00');
  service.subscribe({ petKey: '麦麦|柯基', petName: '麦麦', miniOpenid: 'o1' });
  service.subscribe({ petKey: '豆豆|边牧', petName: '豆豆', miniOpenid: 'o2' });

  const first = await service.sendDaily();
  assert.equal(first.sent.length, 2);
  assert.equal(gateway.sent.length, 2);

  // 同日再跑 → 全部幂等跳过
  const second = await service.sendDaily();
  assert.equal(second.sent.length, 0);
  assert.equal(second.skipped.length, 2);
  assert.ok(second.skipped.every((s) => s.reason === 'already_sent'));

  // 关闭某客户 dailyH5 → 该客户 opt_out
  service.updatePref('麦麦|柯基', { dailyH5: false });
  const { service: fresh, gateway: g2 } = makeService([], '2026-09-08T08:00:00');
  fresh.subscribe({ petKey: '麦麦|柯基', petName: '麦麦' });
  fresh.updatePref('麦麦|柯基', { dailyH5: false });
  const r = await fresh.sendDaily();
  assert.equal(r.skipped[0].reason, 'opt_out');
  assert.equal(g2.sent.length, 0);
});

test('sendDaily：签到记录参与个人化（已喂 → 暖心关怀）', async () => {
  const { service } = makeService(
    [{ petKey: '麦麦|柯基', date: '2026-09-08', execPct: 88 }],
    '2026-09-08T08:00:00'
  );
  service.subscribe({ petKey: '麦麦|柯基', petName: '麦麦' });
  const r = await service.sendDaily();
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0].scene, 'daily_care');
});

test('unsubscribe：移除后不再进入每日任务', async () => {
  const { service } = makeService([], '2026-09-08T08:00:00');
  service.subscribe({ petKey: '麦麦|柯基', petName: '麦麦' });
  assert.ok(service.unsubscribe('麦麦|柯基'));
  const r = await service.sendDaily();
  assert.equal(r.total, 0);
  assert.equal(r.sent.length, 0);
});

test('缺 petKey 订阅抛 PushDomainError', () => {
  const { service } = makeService();
  assert.throws(() => service.subscribe({}), PushDomainError);
});

// ---------- WechatH5PushGateway：access_token 并发刷新 + 失败退避 ----------
test('WechatH5PushGateway：并发刷新 in-flight 去重（只调一次微信接口）', async () => {
  const g = new WechatH5PushGateway({ appid: 'a', appSecret: 's', h5TemplateId: 't' });
  let callCount = 0;
  g._doRefresh = async function () {
    callCount++;
    await new Promise((r) => setTimeout(r, 30));
    this._token = 'tk_abc';
    this._tokenExp = this._now() + 7200 * 1000;
    this._failCount = 0;
    this._retryAfter = 0;
    return this._token;
  };
  const results = await Promise.all([
    g._accessToken(),
    g._accessToken(),
    g._accessToken(),
    g._accessToken()
  ]);
  assert.equal(callCount, 1, '并发 4 次调用应只刷新 1 次');
  assert.ok(results.every((t) => t === 'tk_abc'), '所有调用返回同一 token');
});

test('WechatH5PushGateway：失败后指数退避（连续失败 2 次 → 4s 窗口）', async () => {
  let now = 1000000;
  const g = new WechatH5PushGateway({ appid: 'a', appSecret: 's', h5TemplateId: 't', nowFn: () => now });
  let fetchCalls = 0;
  // mock 全局 fetch，走真实 _doRefresh 代码路径（验证类内的 catch/退避逻辑）
  const origFetch = globalThis.fetch;
  globalThis.fetch = async function (url) {
    fetchCalls++;
    return { json: async () => ({ errcode: 40001, errmsg: 'invalid credential' }) };
  };
  try {
    // 第 1 次失败 → 退避 2s
    await assert.rejects(() => g._accessToken(), /access_token 获取失败/);
    assert.equal(fetchCalls, 1, '应实际调用 1 次微信接口');
    assert.equal(g._failCount, 1);
    assert.equal(g._retryAfter - now, 2000, '首次失败后退避 2s');

    // 退避窗口内无旧 token → 抛退避错误，不再刷
    await assert.rejects(() => g._accessToken(), /退避中/);
    assert.equal(fetchCalls, 1, '退避窗口内不应再次调用微信接口');

    // 时间推过退避窗口 → 允许第 2 次失败，退避变 4s
    now = g._retryAfter + 1;
    await assert.rejects(() => g._accessToken(), /access_token 获取失败/);
    assert.equal(fetchCalls, 2);
    assert.equal(g._failCount, 2);
    assert.equal(g._retryAfter - now, 4000, '第 2 次失败后退避 4s');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('WechatH5PushGateway：刷新成功后退避清零 + 缓存命中 + 过期前提前刷新', async () => {
  let now = 1000000;
  const g = new WechatH5PushGateway({ appid: 'a', appSecret: 's', h5TemplateId: 't', nowFn: () => now });
  let refreshCalls = 0;
  g._doRefresh = async function () {
    refreshCalls++;
    this._token = 'tk_' + refreshCalls;
    this._tokenExp = this._now() + 7200 * 1000;
    this._failCount = 0;
    this._retryAfter = 0;
    return this._token;
  };

  const t1 = await g._accessToken();
  assert.equal(refreshCalls, 1);
  assert.equal(t1, 'tk_1');

  // 1 小时后 → 缓存命中，不刷新
  now += 3600 * 1000;
  const t2 = await g._accessToken();
  assert.equal(refreshCalls, 1, '缓存有效时不应刷新');
  assert.equal(t2, 'tk_1');

  // 距过期只剩 3 分钟（< 5 分钟缓冲）→ 提前刷新
  now += (7200 - 3 * 60) * 1000 - 3600 * 1000;
  const t3 = await g._accessToken();
  assert.equal(refreshCalls, 2, '距过期 < 5min 应提前刷新');
  assert.equal(t3, 'tk_2');
});

test('WechatH5PushGateway：退避中若有旧 token 则续命返回，不抛错', async () => {
  let now = 1000000;
  const g = new WechatH5PushGateway({ appid: 'a', appSecret: 's', h5TemplateId: 't', nowFn: () => now });
  // 先有一个即将过期的旧 token
  g._token = 'old_token';
  g._tokenExp = now + 4 * 60 * 1000; // 还剩 4 分钟（< 5 分钟缓冲，需要刷新）
  g._failCount = 1;
  g._retryAfter = now + 2000; // 退避 2s

  const t = await g._accessToken();
  assert.equal(t, 'old_token', '退避中且有旧 token 时应续命返回，不抛错');
});

// ---------- D1：一次性订阅授权配额追踪（用一次扣一次，不足抛 quota 用尽）----------
test('D1 authorize：未订阅抛错；accept 一次 +1，二次 +1 累加', () => {
  const { service } = makeService();
  assert.throws(() => service.authorize({ petKey: '麦麦|柯基' }), PushDomainError);

  service.subscribe({ petKey: '麦麦|柯基', petName: '麦麦' });
  const s1 = service.authorize({ petKey: '麦麦|柯基', count: 1 });
  assert.equal(s1.quota, 1);
  const s2 = service.authorize({ petKey: '麦麦|柯基', count: 2 });
  assert.equal(s2.quota, 3);
});

test('D1 sendTrigger：用一次扣一次，名额归零后再触发抛 PUSH_QUOTA_EXHAUSTED', async () => {
  const { service } = makeService([{ petKey: '豆豆|边牧', date: '2026-09-08' }], '2026-09-08T09:00:00');
  service.subscribe({ petKey: '豆豆|边牧', petName: '豆豆', miniOpenid: 'o1' });
  service.authorize({ petKey: '豆豆|边牧', count: 1 });

  await service.sendTrigger({ petKey: '豆豆|边牧', scene: 'feeding_remind' });
  const afterOne = service.getSubscriber('豆豆|边牧');
  assert.equal(afterOne.quota, 0, '触发一次后名额减为 0');
  assert.equal(afterOne.quotaUsed, 1);

  await assert.rejects(
    () => service.sendTrigger({ petKey: '豆豆|边牧', scene: 'feeding_remind' }),
    (e) => e instanceof PushDomainError && e.code === 'PUSH_QUOTA_EXHAUSTED'
  );
});