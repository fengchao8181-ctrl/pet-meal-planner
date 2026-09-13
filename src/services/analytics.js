// 埋点统计（零第三方依赖）：记录关键事件计数 + 最近明细，供北极星指标与运营查看
// 支持可选持久化：track 追加写 JSONL 事件日志文件，启动时可从文件恢复——
// 避免 dev/server 重启后计数清零，保证「上线后用真实数据验证」的长期漏斗不被内存态中断。
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const EVENT_WHITELIST = [
  'profile_created',      // 建档完成
  'plan_generated',       // 生成餐单
  'order_created',        // 发起订阅订单
  'order_paid',           // 支付成功
  'checkin_created',      // 每日打卡
  'push_subscribe',       // 开启每日推送订阅
  'push_daily_sent',      // 每日推送下发成功
  'push_daily_error'      // 每日推送下发失败
];

export class Analytics {
  // opts:{ file(事件日志路径，不传则纯内存), writerFile(覆盖测试用的写路径) }
  constructor(opts = {}) {
    this.counters = {};   // name -> count
    this.events = [];     // 最近明细（新→旧）
    this.file = opts.file || null;
    this._write = opts.writerFile || null;
    this._logErrors = opts.logErrors !== false;
  }

  // 从已有事件日志恢复计数与明细（幂等可重复调用）
  async load() {
    if (!this.file) return this;
    try {
      const raw = await readFile(this.file, 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      for (const line of lines) {
        let e = null;
        try { e = JSON.parse(line); } catch (_) { continue; }
        if (!e || !e.name) continue;
        this.counters[e.name] = (this.counters[e.name] || 0) + 1;
        this.events.push(e);
      }
      // 明细保持 新→旧
      this.events.sort((a, b) => new Date(b.at) - new Date(a.at));
      if (this.events.length > 500) this.events.length = 500;
    } catch (err) {
      if (this._logErrors && err.code !== 'ENOENT') {
        console.warn('[analytics] 恢复事件日志失败:', err.message);
      }
    }
    return this;
  }

  // 记录一个事件；白名单外的事件仅在开发日志可见，不计数（防脏数据）
  track(name, meta = {}) {
    if (!EVENT_WHITELIST.includes(name)) {
      console.warn('[analytics] 忽略未知事件:', name);
      return;
    }
    this.counters[name] = (this.counters[name] || 0) + 1;
    const ev = { name, meta, at: new Date().toISOString() };
    this.events.unshift(ev);
    if (this.events.length > 500) this.events.length = 500;
    this._persist(ev).catch(() => {}); // 落盘失败不阻断主流程
    return this.counters[name];
  }

  async _persist(ev) {
    if (!this.file) return;
    const target = this._write || this.file;
    await mkdir(dirname(target), { recursive: true }); // file 为裸名时 dirname -> '.'
    await appendFile(target, JSON.stringify(ev) + '\n', 'utf8');
  }

  // 冻结快照（供 /api/stats 返回）
  stats() {
    return { counters: { ...this.counters }, recent: this.events.slice(0, 30) };
  }
}

// 便捷：构造并 load 一个持久化实例（供 app 启动时使用）。
export async function createAnalytics(opts = {}) {
  const a = new Analytics(opts);
  await a.load();
  return a;
}