// 平台支撑层单测：埋点分析 + 微信身份打通（openid/unionid）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Analytics, createAnalytics } from '../src/services/analytics.js';
import { MockWechatAuth, WechatAuth, createAuthFromEnv } from '../src/services/auth-provider.js';

test('Analytics：持久化事件日志，重启后 load 恢复计数与明细', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'analytics-'));
  const file = join(dir, 'events.jsonl');
  try {
    const a = new Analytics({ file });
    a.track('profile_created', { id: 'p1' });
    a.track('plan_generated', { planId: 'x' });
    a.track('plan_generated', { planId: 'y' }); // 两次生成
    // 等落盘异步完成
    await new Promise((r) => setTimeout(r, 50));

    // 模拟「重启」：新实例从同一文件恢复
    const b = new Analytics({ file });
    await b.load();
    assert.equal(b.counters.profile_created, 1);
    assert.equal(b.counters.plan_generated, 2);
    assert.equal(b.stats().recent.length, 3);
    assert.equal(b.stats().recent[0].name, 'plan_generated'); // 新→旧
    assert.ok(b.stats().recent[0].at);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('createAnalytics：无日志文件时干净启动（ENOENT 静默）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'analytics-'));
  try {
    const a = await createAnalytics({ file: join(dir, 'nope.jsonl') });
    assert.deepEqual(a.stats().counters, {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Analytics：白名单事件计数 + 明细快照', () => {
  const a = new Analytics();
  a.track('profile_created');
  a.track('profile_created');
  a.track('plan_generated', { planId: 'p1' });
  assert.equal(a.counters.profile_created, 2);
  assert.equal(a.counters.plan_generated, 1);
  const s = a.stats();
  assert.equal(s.counters.profile_created, 2);
  assert.ok(s.recent[0].at);
  assert.equal(s.recent[0].name, 'plan_generated'); // 最新在前
});

test('Analytics：未知事件不计数（防脏数据）', () => {
  const a = new Analytics();
  a.track('not_a_whitelisted_event');
  assert.deepEqual(a.stats().counters, {});
});

test('createAuthFromEnv：无凭证 → Mock；凭证齐备 → 真实', () => {
  assert.ok(createAuthFromEnv({}) instanceof MockWechatAuth);
  assert.ok(createAuthFromEnv({ WX_APPID: 'a', WX_APP_SECRET: 'b' }) instanceof WechatAuth);
});

test('MockWechatAuth：按 deviceId 生成稳定 openid（跨会话一致）', async () => {
  const a = new MockWechatAuth();
  const i1 = await a.code2session({ deviceId: 'dev_abc' });
  const i2 = await a.code2session({ deviceId: 'dev_abc' });
  assert.equal(i1.openid, 'dev_dev_abc');
  assert.equal(i1.openid, i2.openid);
  assert.equal(i1.provider, 'mock');
});

test('WechatAuth：缺 code 抛错', async () => {
  const a = new WechatAuth({ appid: 'a', appSecret: 'b' });
  await assert.rejects(() => a.code2session({}), /缺少 code/);
});