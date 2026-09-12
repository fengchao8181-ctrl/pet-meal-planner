// 内存仓储：开发/演示用，进程重启即清空
import { Repository } from './repository.js';

export class MockRepository extends Repository {
  constructor() {
    super();
    this.profiles = new Map();
    this.plans = new Map();
    this.orders = new Map();
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
