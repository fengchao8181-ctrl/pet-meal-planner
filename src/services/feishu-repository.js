// 飞书多维表格仓储实现：基于官方 bitable v1 OpenAPI，配置化接入
// 每张表用「ID 字段」精确过滤定位记录，用「JSON 字段」承载完整领域对象（不丢字段），
// 同时把关键字段展开到表格便于人工可读。运行时必须配置飞书应用凭证与各表 ID；
// fetchImpl 与 getToken 可注入，便于单元测试与后续替换鉴权方式（用户/租户 token）。
import { Repository } from './repository.js';
import { LIFE_STAGES } from '../domain/constants.js';

const OPENAPI = 'https://open.feishu.cn';
const STAGE_LABEL = { puppy: '幼犬', adult: '成犬', senior: '老年犬' };
const ACTIVITY_LABEL = { low: '低', mid: '中', high: '高' };
const MODE_LABEL = { A: 'A 纯鲜食', B: 'B 狗粮+辅食', C: 'C 混合' };

function ms(iso) {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? t : null;
}

// bitable 文本/富文本单元格读回值形如 [{ text, type }]，归一为普通字符串
function textOf(v) {
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === 'object' && 'text' in x ? x.text : x)).join('');
  return v == null ? '' : String(v);
}

export class FeishuRepository extends Repository {
  // config: { appId, appSecret, baseToken, tables: { profile, plan, order } }
  //   tables[].tableId 各表 ID；idField/jsonField 默认取领域惯用名
  // deps: { fetchImpl, getToken }
  constructor(config = {}, deps = {}) {
    super();
    this.config = config;
    this.fetchImpl = deps.fetchImpl || ((url, init) => fetch(url, init));
    this._token = null;
    this._tokenExpire = 0;
    this.getToken = deps.getToken || (() => this._fetchTenantToken());

    const t = config.tables || {};
    this.entries = {
      profile: {
        tableId: t.profile?.tableId,
        idField: t.profile?.idField || '档案ID',
        jsonField: t.profile?.jsonField || '档案JSON',
        toFields: (p) => ({
          [this.entries.profile.idField]: p.id,
          [this.entries.profile.jsonField]: JSON.stringify(p),
          宠物昵称: p.petName || '',
          品种: p.breed || '',
          体重kg: Number(p.weightKg),
          月龄: Number(p.ageMonths),
          生命阶段: STAGE_LABEL[p.lifeStage] || p.lifeStage,
          活动量: ACTIVITY_LABEL[p.activity] || p.activity,
          已绝育: Boolean(p.neutered),
          喂养模式: MODE_LABEL[p.feedingMode] || p.feedingMode,
          过敏史: Array.isArray(p.allergies) ? p.allergies.join('、') : '',
          主粮标签: p.kibbleLabel ? JSON.stringify(p.kibbleLabel) : '',
          创建时间: ms(p.createdAt)
        })
      },
      plan: {
        tableId: t.plan?.tableId,
        idField: t.plan?.idField || '餐单ID',
        jsonField: t.plan?.jsonField || '餐单JSON',
        toFields: (plan) => ({
          [this.entries.plan.idField]: plan.planId,
          [this.entries.plan.jsonField]: JSON.stringify(plan),
          宠物昵称: plan.pet?.name || '',
          DER热量: Number(plan.derKcal),
          喂养模式: MODE_LABEL[plan.mode] || plan.mode,
          创建时间: Date.now()
        })
      },
      order: {
        tableId: t.order?.tableId,
        idField: t.order?.idField || '订单ID',
        jsonField: t.order?.jsonField || '订单JSON',
        toFields: (o) => ({
          [this.entries.order.idField]: o.id,
          [this.entries.order.jsonField]: JSON.stringify(o),
          会员: o.memberName || '',
          '金额(分)': Number(o.priceFen),
          支付单号: o.paymentId || '',
          SKU: o.skuId || '',
          SKU名称: o.skuName || '',
          状态: o.status,
          创建时间: ms(o.createdAt)
        })
      }
    };
  }

  // ---- token ----
  async _fetchTenantToken() {
    const res = await this.fetchImpl(`${OPENAPI}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app_id: this.config.appId, app_secret: this.config.appSecret })
    });
    const data = await res.json();
    if (!data || data.code !== 0) {
      const e = new Error(`飞书鉴权失败: ${data?.msg || 'unknown'}`);
      e.code = 'FEISHU_AUTH';
      throw e;
    }
    this._token = data.tenant_access_token;
    this._tokenExpire = Date.now() + (data.expire - 60) * 1000;
    return this._token;
  }

  async _authorizedToken() {
    if (this._token && Date.now() < this._tokenExpire) return this._token;
    return this.getToken();
  }

  async _request(path, init = {}) {
    const token = await this._authorizedToken();
    const res = await this.fetchImpl(`${OPENAPI}${path}`, {
      ...init,
      headers: {
        'authorization': `Bearer ${token}`,
        'content-type': 'application/json',
        ...(init.headers || {})
      },
      body: init.body ? JSON.stringify(init.body) : undefined
    });
    const data = await res.json();
    if (!data || data.code !== 0) {
      const e = new Error(`飞书 API ${data?.code}: ${data?.msg}`);
      e.code = 'FEISHU_API';
      e.raw = data;
      throw e;
    }
    return data.data;
  }

  // ---- 通用读写 ----
  async _create(entry, fields) {
    const data = await this._request(
      `/open-apis/bitable/v1/apps/${this.config.baseToken}/tables/${entry.tableId}/records`,
      { method: 'POST', body: { fields } }
    );
    return data.record?.record_id || null;
  }

  async _findByField(entry, id) {
    // GET 列表的 filter 查询参数在 bitable v1 上不受支持（恒报 1254018），
    // 官方字段过滤用 POST /records/search，filter 走 JSON body。
    const data = await this._request(
      `/open-apis/bitable/v1/apps/${this.config.baseToken}/tables/${entry.tableId}/records/search`,
      {
        method: 'POST',
        body: {
          filter: {
            conjunction: 'and',
            conditions: [{ field_name: entry.idField, operator: 'is', value: [String(id)] }]
          },
          page_size: 1
        }
      }
    );
    return data.items && data.items.length > 0 ? data.items[0] : null;
  }

  async _get(entry, id) {
    const rec = await this._findByField(entry, id);
    if (!rec) return null;
    const raw = textOf(rec.fields?.[entry.jsonField]);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async _save(entry, obj, id) {
    const item = { ...obj, id };
    const fields = entry.toFields(item);
    // 过滤空值，避免填充多余空字段
    const clean = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined || v === null || v === '') continue;
      clean[k] = v;
    }
    await this._create(entry, clean);
    return id;
  }

  // ---- 档案 ----
  async saveProfile(profile) {
    const id = profile.id || crypto.randomUUID();
    return this._save(this.entries.profile, profile, id);
  }
  async getProfile(id) {
    return this._get(this.entries.profile, id);
  }

  // ---- 餐单 ----
  async savePlan(plan) {
    return this._save(this.entries.plan, plan, plan.planId);
  }
  async getPlan(id) {
    return this._get(this.entries.plan, id);
  }

  // ---- 订单 ----
  async saveOrder(order) {
    return this._save(this.entries.order, order, order.id);
  }
  async getOrder(id) {
    return this._get(this.entries.order, id);
  }
}

// 从环境变量装配（EdgeOne cloud function env / process.env）
export function createFeishuRepositoryFromEnv(env = {}) {
  return new FeishuRepository({
    appId: env.FEISHU_APP_ID,
    appSecret: env.FEISHU_APP_SECRET,
    baseToken: env.FEISHU_BASE_TOKEN,
    tables: {
      profile: { tableId: env.FEISHU_TABLE_PROFILE },
      plan: { tableId: env.FEISHU_TABLE_PLAN },
      order: { tableId: env.FEISHU_TABLE_ORDER }
    }
  });
}