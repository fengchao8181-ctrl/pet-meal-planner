// 飞书运行时接入的真实端到端验证：读取根目录 .env，用成熟 app_id/secret 走应用身份
// 向三张真实多维表格做 写入→读回 往返，并清理测试记录。成功打印 PASS，失败打印 FAIL + 原因。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FeishuRepository } from '../src/services/feishu-repository.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = parseDot(join(ROOT, '.env'));
const OPENAPI = 'https://open.feishu.cn';

function parseDot(file) {
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const repo = new FeishuRepository({
  appId: env.FEISHU_APP_ID,
  appSecret: env.FEISHU_APP_SECRET,
  baseToken: env.FEISHU_BASE_TOKEN,
  tables: {
    profile: { tableId: env.FEISHU_TABLE_PROFILE },
    plan: { tableId: env.FEISHU_TABLE_PLAN },
    order: { tableId: env.FEISHU_TABLE_ORDER }
  }
});

const ts = Date.now();
const marker = `E2E${ts}`;
const results = [];

async function recordId(entry, id) {
  const rec = await repo._findByField(entry, id);
  return rec?.record_id || null;
}

async function del(entry, id) {
  const rid = await recordId(entry, id);
  if (!rid) return;
  const res = await fetch(
    `${OPENAPI}/open-apis/bitable/v1/apps/${repo.config.baseToken}/tables/${entry.tableId}/records/${rid}`,
    { method: 'DELETE', headers: { authorization: `Bearer ${await repo._authorizedToken()}` } }
  );
  if (!res.ok) throw new Error(`清理失败 ${rid}: ${await res.text()}`);
}

const profile = {
  id: `${marker}-p`, petName: marker, breed: '柯基', weightKg: 8, ageMonths: 24,
  lifeStage: 'adult', activity: 'mid', neutered: false, feedingMode: 'B',
  allergies: [], kibbleLabel: { proteinPct: 24, kcalPer100g: 360 }, createdAt: new Date().toISOString()
};
const plan = {
  planId: `${marker}-plan`, mode: 'B', modeLabel: '狗粮+辅食', derKcal: 606,
  pet: { name: marker, breed: '柯基', weightKg: 8, bodyType: '小型', stage: '成犬' }
};
const order = {
  id: `${marker}-o`, memberName: marker, priceFen: 3000,
  skuId: 'sub_monthly_basic', skuName: '标准月订阅', status: 'pending', createdAt: new Date().toISOString()
};

async function run() {
  // bitable 写入为最终一致：刚写入的记录搜索可能短暂查不到，轮询读回
  async function readBack(readFn, maxWaitMs = 6000) {
    const deadline = Date.now() + maxWaitMs;
    let last = null;
    while (Date.now() < deadline) {
      last = await readFn();
      if (last) return last;
      await new Promise((r) => setTimeout(r, 400));
    }
    return last;
  }

  const pid = await repo.saveProfile(profile);
  const gotP = await readBack(() => repo.getProfile(pid));
  results.push(['档案表', pid, gotP?.petName === marker]);
  if (gotP?.petName !== marker) results.push(['档案表读回内容', JSON.stringify(gotP), false]);

  const plid = await repo.savePlan(plan);
  const gotPl = await readBack(() => repo.getPlan(plid));
  results.push(['餐单表', plid, gotPl?.mode === 'B']);

  const oid = await repo.saveOrder(order);
  const gotO = await readBack(() => repo.getOrder(oid));
  results.push(['订阅订单表', oid, gotO?.status === 'pending' && gotO?.priceFen === 3000]);

  // 清理
  await del(repo.entries.profile, pid);
  await del(repo.entries.plan, plid);
  await del(repo.entries.order, oid);
  console.log('清理完成（测试记录已删除）');

  console.log('==== 飞书真实写入·读回 结果 ====');
  let allOk = true;
  for (const [name, id, ok] of results) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  id=${id}`);
    if (!ok) allOk = false;
  }
  console.log(allOk ? 'ALL PASS —— 飞书运行时接入成功' : 'HAS FAIL —— 请检查上方 FAIL 项');
  process.exit(allOk ? 0 : 1);
}

run().catch((e) => {
  console.log('==== 运行出错 ====');
  console.log(e.stack || e);
  process.exit(1);
});