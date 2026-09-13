// 清理飞书三表中历史 e2e 遗留的 E2E / 自检 测试记录，保持表干净
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FeishuRepository } from '../src/services/feishu-repository.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const OPENAPI = 'https://open.feishu.cn';
const repo = new FeishuRepository({
  appId: env.FEISHU_APP_ID, appSecret: env.FEISHU_APP_SECRET, baseToken: env.FEISHU_BASE_TOKEN,
  tables: {
    profile: { tableId: env.FEISHU_TABLE_PROFILE },
    plan: { tableId: env.FEISHU_TABLE_PLAN },
    order: { tableId: env.FEISHU_TABLE_ORDER }
  }
});
const bearer = await repo._authorizedToken();
const H = { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' };
const b = env.FEISHU_BASE_TOKEN;

const targets = [
  ['档案表', env.FEISHU_TABLE_PROFILE, '档案ID', /E2E|diag|smoke|Diag|DIAG/],
  ['餐单表', env.FEISHU_TABLE_PLAN, '餐单ID', /E2E|diag|smoke|Diag|DIAG/],
  ['订单表', env.FEISHU_TABLE_ORDER, '订单ID', /E2E|diag|smoke|Diag|DIAG/]
];
for (const [name, tbl, idField, rx] of targets) {
  const rst = await (await fetch(`${OPENAPI}/open-apis/bitable/v1/apps/${b}/tables/${tbl}/records?page_size=200`, { headers: H })).json();
  const dirty = (rst.data?.items || []).filter((r) => rx.test(r.fields[idField] || ''));
  for (const r of dirty) {
    const d = await (await fetch(`${OPENAPI}/open-apis/bitable/v1/apps/${b}/tables/${tbl}/records/${r.record_id}`, { method: 'DELETE', headers: H })).json();
    if (d.code !== 0) console.log(`清理失败 ${name} ${r.fields[idField]}: ${d.msg}`);
  }
  console.log(`${name}: 清理 ${dirty.length} 条`);
}