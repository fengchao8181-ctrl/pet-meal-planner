// 仓储接口：语义对齐飞书多维表格（档案表/餐单表），当前由 Mock 实现
// 接入飞书时实现 FeishuRepository 并替换 DI，业务层不感知存储细节

export class Repository {
  async saveProfile(profile) { throw new Error('not implemented'); }
  async getProfile(id) { throw new Error('not implemented'); }
  async savePlan(plan) { throw new Error('not implemented'); }
  async getPlan(id) { throw new Error('not implemented'); }
  async saveOrder(order) { throw new Error('not implemented'); }
  async getOrder(id) { throw new Error('not implemented'); }
}
