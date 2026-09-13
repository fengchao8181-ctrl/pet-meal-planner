// 内存仓储：开发/演示用，进程重启即清空
import { Repository } from './repository.js';

export class MockRepository extends Repository {
  constructor() {
    super();
    this.profiles = new Map();
    this.plans = new Map();
    this.orders = new Map();
    this.checkins = new Map(); // key: `${petKey}|${date}`
    this.reports = new Map();  // key: `${petKey}|${weekStart}`
    this.owners = new Map();   // petKey -> openid（首个绑定者锁定，后续写入校验归属）
  }

  // 身份归属（R4）：
  //  - attachOwner：首次为 petKey 写入所有者；已存在则返回既有所有者（不回写）
  //  - isOwner：ownerOpenid 已锁定时校验是否归属；未设定则放行（匿名/本地）
  async attachOwner(petKey, ownerOpenid) {
    if (!this.owners.has(petKey)) this.owners.set(petKey, ownerOpenid);
    return this.owners.get(petKey);
  }

  async isOwner(petKey, openid) {
    const o = this.owners.get(petKey);
    if (!o) return true;      // 未绑定 → 放行（首次写入者将成为 owner）
    return o === openid;      // 已绑定 → 校验归属
  }

  async saveCheckin(record) {
    this.checkins.set(`${record.petKey}|${record.date}`, record);
    return record.id;
  }

  async getCheckin(petKey, date) {
    return this.checkins.get(`${petKey}|${date}`) || null;
  }

  async listCheckins(petKey, from, to) {
    const out = [];
    for (const rec of this.checkins.values()) {
      if (rec.petKey !== petKey) continue;
      if (from && rec.date < from) continue;
      if (to && rec.date > to) continue;
      out.push(rec);
    }
    return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  async saveReport(report) {
    this.reports.set(`${report.petKey}|${report.weekStart}`, report);
    return report.id;
  }

  async listReports(petKey) {
    const out = [...this.reports.values()].filter((r) => r.petKey === petKey);
    return out.sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1)); // 最新在前
  }

  async saveProfile(profile) {
    const id = profile.id || crypto.randomUUID();
    this.profiles.set(id, { ...profile, id });
    return id;
  }

  async getProfile(id) {
    return this.profiles.get(id) || null;
  }

  async savePlan(plan) {
    this.plans.set(plan.planId, plan);
    return plan.planId;
  }

  async getPlan(id) {
    return this.plans.get(id) || null;
  }

  async saveOrder(order) {
    this.orders.set(order.id, order);
    return order.id;
  }

  async getOrder(id) {
    return this.orders.get(id) || null;
  }
}
