// 双通道身份打通骨架单测（小程序/公众号 openid 映射 + unionid 归并）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IdentityService } from '../src/services/identity.js';

test('D2 linkChannels：登记小程序+公众号 openid，返回配对与 unionid', async () => {
  const s = new IdentityService();
  const rec = await s.linkChannels({ miniOpenid: 'mini_a', mpOpenid: 'mp_a', unionid: 'u1' });
  assert.equal(rec.miniOpenids[0], 'mini_a');
  assert.equal(rec.mpOpenids[0], 'mp_a');
  assert.equal(rec.unionid, 'u1');
});

test('D2 resolve：凭小程序 openid 可反查公众号 openid（跨通道定位同一客户）', async () => {
  const s = new IdentityService();
  await s.linkChannels({ miniOpenid: 'mini_a', mpOpenid: 'mp_a', unionid: 'u1' });
  const viaMini = await s.resolve('mini_a');
  assert.equal(viaMini.mpOpenid, 'mp_a');
  const viaMp = await s.resolve('mp_a');
  assert.equal(viaMp.miniOpenid, 'mini_a');
});

test('D2 resolveByUnionid：凭 unionid 反查（开放平台绑定后自动打通）', async () => {
  const s = new IdentityService();
  await s.linkChannels({ miniOpenid: 'mini_a', mpOpenid: 'mp_a', unionid: 'u1' });
  const rec = await s.resolveByUnionid('u1');
  assert.equal(rec.miniOpenid, 'mini_a');
  assert.equal(rec.mpOpenid, 'mp_a');
});

test('D2 并号：已有小程序身份，公众号 openid 后续绑定进同一记录', async () => {
  const s = new IdentityService();
  // 先只有小程序侧（模拟小程序先登录）
  await s.linkChannels({ miniOpenid: 'mini_a' });
  assert.deepEqual(await s.resolve('mini_a').then((r) => r.mpOpenid), null);
  // 公众号侧后来传入自己的 openid + 同 unionid → 并号
  const merged = await s.linkChannels({ miniOpenid: 'mini_a', mpOpenid: 'mp_a', unionid: 'u1' });
  assert.equal(merged.miniOpenids.includes('mini_a'), true);
  assert.equal(merged.mpOpenids.includes('mp_a'), true);
  assert.equal(merged.unionid, 'u1');
});

test('D2 回退：未登记的 openid 反查为 null', async () => {
  const s = new IdentityService();
  assert.equal(await s.resolve('unknown'), null);
});