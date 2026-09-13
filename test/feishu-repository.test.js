import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FeishuRepository, createFeishuRepositoryFromEnv } from '../src/services/feishu-repository.js';
import { buildProfile } from '../src/domain/profile.js';
import { generateMealPlan } from '../src/domain/meal-plan.js';
import { createOrder } from '../src/domain/order.js';

// 内存版飞书：按 URL 分流 token/写/读，记录 requests 供断言
function makeFakeEnv() {
  const store = {};
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    requests.push({ method: init.method || 'GET', path: u.pathname, search: u.search, body: init.body, headers: init.headers });
    if (u.pathname.endsWith('/tenant_access_token/internal')) {
      return Response.json({ code: 0, msg: 'ok', tenant_access_token: 'tok_1', expire: 7200 });
    }
    const search = u.pathname.match(/tables\/([^/]+)\/records\/search$/);
    const m = u.pathname.match(/tables\/([^/]+)\/records\/?$/);
    const table = search ? search[1] : (m && m[1]);
    if (init.method === 'POST' && search) {
      const body = JSON.parse(init.body);
      const cond = body.filter && body.filter.conditions[0];
      const rows = store[table] || [];
      const items = rows
        .filter((r) => cond && r.fields[cond.field_name] === cond.value[0])
        .map((r) => ({ record_id: r.record_id, fields: r.fields }));
      return Response.json({ code: 0, msg: 'ok', data: { items, has_more: false } });
    }
    if (init.method === 'POST' && m) {
      const fields = JSON.parse(init.body).fields;
      store[table] = store[table] || [];
      store[table].push({ record_id: 'rec_' + store[table].length, fields });
      return Response.json({ code: 0, msg: 'ok', data: { record: { record_id: 'rec_' + (store[table].length - 1) } } });
    }
    if (init.method === 'GET' || init.method === undefined) {
      const rows = store[table] || [];
      const items = rows.map((r) => ({ record_id: r.record_id, fields: r.fields }));
      return Response.json({ code: 0, msg: 'ok', data: { items, has_more: false } });
    }
    return Response.json({ code: 0, msg: 'ok', data: { items: [] } });
  };
  return { store, requests, fetchImpl, url: (req) => req.path + req.search };
}

function setup(tables) {
  const env = makeFakeEnv();
  const repo = new FeishuRepository(
    { appId: 'cli_x', appSecret: 's', baseToken: 'basetkn', tables },
    { fetchImpl: env.fetchImpl }
  );
  return { repo, ...env };
}

const TABLES = {
  profile: { tableId: 'tbl_profile' },
  plan: { tableId: 'tbl_plan' },
  order: { tableId: 'tbl_order' }
};

test('FeishuRepository：saveProfile 展开关键字段并写入档案JSON', async () => {
  const { repo, requests, url } = setup(TABLES);
  const profile = buildProfile({
    petName: '豆豆', breed: '柯基', weightKg: 4, ageMonths: 8,
    lifeStage: 'puppy', activity: 'high', neutered: false,
    feedingMode: 'B', allergies: ['鸡肉'],
    kibbleLabel: { proteinPct: 24, kcalPer100g: 360 }
  });
  const id = await repo.saveProfile(profile);
  assert.ok(id);

  const write = requests.find((r) => r.method === 'POST' && r.path.includes('/tables/'));
  assert.equal(url(write), '/open-apis/bitable/v1/apps/basetkn/tables/tbl_profile/records');
  const fields = JSON.parse(write.body).fields;
  assert.equal(fields['档案ID'], id);
  assert.equal(fields['宠物昵称'], '豆豆');
  assert.equal(fields['生命阶段'], '幼犬');
  assert.equal(fields['活动量'], '高');
  assert.equal(fields['喂养模式'], 'B 狗粮+辅食');
  assert.equal(fields['过敏史'], '鸡肉');
  const parsed = JSON.parse(fields['档案JSON']);
  assert.equal(parsed.id, id);
  assert.equal(parsed.petName, '豆豆');
});

test('FeishuRepository：save 后按 ID filter 回读完整对象', async () => {
  const { repo } = setup(TABLES);
  const profile = buildProfile({ petName: '豆豆', weightKg: 4, ageMonths: 8, lifeStage: 'puppy', activity: 'high', feedingMode: 'A', neutered: true });
  const id = await repo.saveProfile(profile);
  const back = await repo.getProfile(id);
  assert.ok(back);
  assert.equal(back.id, id);
  assert.equal(back.petName, '豆豆');
  assert.equal(back.neutered, true);
});

test('FeishuRepository：读取时兼容富文本包装的 JSON 字段', async () => {
  const { repo, store } = setup(TABLES);
  const obj = { id: 'rt-1', petName: 'AA', priceFen: 100 };
  store[TABLES.profile.tableId] = [{ record_id: 'rec_rt', fields: { 档案ID: 'rt-1', 档案JSON: [{ text: JSON.stringify(obj), type: 'text' }] } }];
  const back = await repo.getProfile('rt-1');
  assert.ok(back);
  assert.equal(back.petName, 'AA');
});

test('FeishuRepository：find 未命中返回 null', async () => {
  const { repo, requests, url } = setup(TABLES);
  const back = await repo.getProfile('no-such-id');
  assert.equal(back, null);
  const read = requests.find((r) => r.path.includes('/records/search') && r.method === 'POST');
  assert.ok(read);
  const body = JSON.parse(read.body);
  assert.equal(body.filter.conditions[0].field_name, '档案ID');
  assert.equal(body.filter.conditions[0].operator, 'is');
  assert.deepEqual(body.filter.conditions[0].value, ['no-such-id']);
});

test('FeishuRepository：token 只获取一次并带 Bearer 复用', async () => {
  const { repo, requests } = setup(TABLES);
  const profile = buildProfile({ petName: 'A', weightKg: 5, ageMonths: 12, lifeStage: 'adult', activity: 'low', feedingMode: 'B', kibbleLabel: { proteinPct: 20, kcalPer100g: 340 } });
  const id = await repo.saveProfile(profile);
  await repo.getProfile(id);
  const auths = requests.filter((r) => r.path.endsWith('/tenant_access_token/internal'));
  assert.equal(auths.length, 1, 'token 应缓存只请求一次');
  const found = await repo._authorizedToken();
  assert.equal(found, 'tok_1');
  const call = requests.find((r) => r.path.includes('/tables/tbl_profile/records') && r.method === 'POST');
  assert.match(String(call.headers.authorization), /^Bearer tok_1$/);
  assert.ok(call.headers['content-type']);
});

test('FeishuRepository：savePlan / getPlan 往返', async () => {
  const { repo } = setup(TABLES);
  const profile = buildProfile({ petName: 'Lucky', weightKg: 6, ageMonths: 24, lifeStage: 'adult', activity: 'mid', feedingMode: 'B', kibbleLabel: { proteinPct: 20, kcalPer100g: 340 } });
  const plan = generateMealPlan(profile);
  const pid = await repo.savePlan(plan);
  assert.equal(pid, plan.planId);
  const back = await repo.getPlan(plan.planId);
  assert.equal(back.planId, plan.planId);
  assert.equal(back.derKcal, plan.derKcal);
});

test('FeishuRepository：saveOrder / getOrder 往返，状态映射到订单JSON', async () => {
  const { repo } = setup(TABLES);
  const order = createOrder({ skuId: 'sub_monthly_basic', memberName: '豆豆' });
  const oid = await repo.saveOrder(order);
  assert.equal(oid, order.id);
  const back = await repo.getOrder(order.id);
  assert.equal(back.id, order.id);
  assert.equal(back.status, order.status);
  assert.equal(back.skuId, 'sub_monthly_basic');
});

test('createFeishuRepositoryFromEnv：从环境变量装配配置', () => {
  const repo = createFeishuRepositoryFromEnv({
    FEISHU_APP_ID: 'cli_app', FEISHU_APP_SECRET: 'secret',
    FEISHU_BASE_TOKEN: 'basetkn2',
    FEISHU_TABLE_PROFILE: 'tbl_p', FEISHU_TABLE_PLAN: 'tbl_pl', FEISHU_TABLE_ORDER: 'tbl_o'
  });
  assert.ok(repo instanceof FeishuRepository);
  assert.equal(repo.config.baseToken, 'basetkn2');
  assert.equal(repo.entries.profile.tableId, 'tbl_p');
  assert.equal(repo.entries.plan.tableId, 'tbl_pl');
  assert.equal(repo.entries.order.tableId, 'tbl_o');
});