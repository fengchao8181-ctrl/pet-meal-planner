// 仓储接口：语义对齐飞书多维表格（档案表/餐单表），当前由 Mock 实现
// 接入飞书时实现 FeishuRepository 并替换 DI，业务层不感知存储细节

export class Repository {
  async saveProfile(profile) { throw new Error('not implemented'); }
  async getProfile(id) { throw new Error('not implemented'); }
  async savePlan(plan) { throw new Error('not implemented'); }
  async getPlan(id) { throw new Error('not implemented'); }
  async saveOrder(order) { throw new Error('not implemented'); }
  async getOrder(id) { throw new Error('not implemented'); }

  // 「有爱」留存：每日打卡 + 健康周报（checkin key 为 petKey+date）
  async saveCheckin(record) { throw new Error('not implemented'); }
  async getCheckin(petKey, date) { throw new Error('not implemented'); }
  async listCheckins(petKey, from, to) { throw new Error('not implemented'); }
  async saveReport(report) { throw new Error('not implemented'); }
  async listReports(petKey) { throw new Error('not implemented'); }

  // 身份归属（R4）：为 petKey 绑定 openid 所有者；缺省实现无副作用（不阻断匿名/本地模式）
  async attachOwner(petKey, ownerOpenid) { return true; }
  async isOwner(petKey, openid) { return true; }
}
