// 身份打通骨架：小程序 openid ↔ 公众号 openid（同一客户双通道识别）
// 微信规则：同一开放平台主体下同一用户 unionid 唯一。真实打通需在开放平台同时绑定小程序+公众号 → 拿到 unionid。
// 本服务职责：
//  - linkChannels：显式登记「小程序 openid + 公众号 openid（+可选 unionid）属于同一客户」，并自动合并旧身份
//  - resolve：凭任一 openid 反查整条身份记录（拿到配对通道 openid/unionid）→ 双通道推送定位同一客户
// 数据默认内存（MVP）；生产可换持久化 store（接口：get/set/findByAny/findByUnionid/nextId/findAll）。
export class IdentityService {
  constructor({ store = null } = {}) {
    this.store = store || new InMemoryIdentityStore();
  }

  // 显式登记双通道（允许只给一侧，后续补另一侧 + 同 unionid 自动并号）。返回合并后的身份。
  async linkChannels({ miniOpenid, mpOpenid, unionid } = {}) {
    const entries = [];
    if (miniOpenid) entries.push({ v: String(miniOpenid), role: 'mini' });
    if (mpOpenid) entries.push({ v: String(mpOpenid), role: 'mp' });
    if (!entries.length) throw new Error('缺少 openid');

    // 收集与任一条目已关联的既有身份
    const merged = [];
    for (const e of entries) {
      const rec = await this.store.findByAny(e.v);
      if (rec && !merged.some((r) => r.id === rec.id)) merged.push(rec);
    }
    let identityId = merged[0] ? merged[0].id : await this.store.nextId();
    let unionidVal = unionid || null;
    const mini = new Set();
    const mp = new Set();
    for (const rec of merged) {
      (rec.miniOpenids || []).forEach((o) => mini.add(o));
      (rec.mpOpenids || []).forEach((o) => mp.add(o));
      if (rec.unionid) unionidVal = rec.unionid;
    }
    for (const e of entries) (e.role === 'mp' ? mp : mini).add(e.v);
    if (unionid) unionidVal = unionid;

    const identity = {
      id: identityId,
      miniOpenids: [...mini],
      mpOpenids: [...mp],
      unionid: unionidVal,
      updatedAt: new Date().toISOString(),
      createdAt: merged[0]?.createdAt || new Date().toISOString()
    };
    await this.store.set(identity);
    return identity;
  }

  // 凭任一 openid 反查身份（含配对通道 openid 与 unionid）；未登记返回 null
  async resolve(openid) {
    if (!openid) return null;
    const rec = await this.store.findByAny(openid);
    return rec ? this._shape(rec) : null;
  }

  // 凭 unionid 反查（开放平台绑定后，小程序与公众号用户由此归并）
  async resolveByUnionid(unionid) {
    if (!unionid) return null;
    const rec = await this.store.findByUnionid(unionid);
    return rec ? this._shape(rec) : null;
  }

  // 对外统一外形（只暴露对象，不暴露内部 Mutability）
  _shape(rec) {
    return {
      id: rec.id,
      miniOpenid: (rec.miniOpenids || [])[0] || null,
      mpOpenid: (rec.mpOpenids || [])[0] || null,
      miniOpenids: (rec.miniOpenids || []).slice(),
      mpOpenids: (rec.mpOpenids || []).slice(),
      unionid: rec.unionid || null,
      updatedAt: rec.updatedAt
    };
  }

  stats() {
    return { total: this.store.findAll().length, pairs: this.store.findAll().filter((r) => (r.miniOpenids || []).length && (r.mpOpenids || []).length).length };
  }
}

class InMemoryIdentityStore {
  constructor() {
    this._seq = 0;
    this.records = [];
  }

  findAll() { return this.records; }
  nextId() { return 'ide_' + (++this._seq); }

  async get(id) { return this.records.find((r) => r.id === id) || null; }

  async set(rec) {
    const i = this.records.findIndex((r) => r.id === rec.id);
    if (i >= 0) this.records[i] = rec; else this.records.push(rec);
    return rec;
  }

  async findByAny(openid) {
    return this.records.find((r) =>
      (r.miniOpenids || []).includes(openid) ||
      (r.mpOpenids || []).includes(openid) ||
      r.unionid === openid
    ) || null;
  }

  async findByUnionid(unionid) {
    return this.records.find((r) => r.unionid === unionid) || null;
  }
}