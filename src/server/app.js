// EdgeOne 云函数兼容入口：export async function handler(request, env)
// 本地开发：node src/server/app.js 直接启动（用原生 http 包装同一 handler）
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createServer } from 'node:http';
import { buildProfile } from '../domain/profile.js';
import { generateMealPlan } from '../domain/meal-plan.js';
import { getRuleInfo } from '../domain/rules-engine.js';
import { createOrder, applyOrderEvent } from '../domain/order.js';
import { listSkus } from '../domain/subscription.js';
import { buildCheckin, computeWeeklyReport, weekRange } from '../domain/checkin.js';
import { MockRepository } from '../services/mock-repository.js';
import { createFeishuRepositoryFromEnv } from '../services/feishu-repository.js';
import { StubPaymentProvider } from '../services/payment-provider.js';
import { WechatPayProvider } from '../services/wechat-pay-provider.js';
import { createPushGatewayFromEnv } from '../services/push-gateway.js';
import { PushService } from '../services/push-service.js';
import { createAnalytics } from '../services/analytics.js';
import { createAuthFromEnv } from '../services/auth-provider.js';

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
// 数据仓储：配置了飞书多维表格环境则用 FeishuRepository 持久化，否则退回内存 Mock（本地/演示）
const repo = process.env.FEISHU_BASE_TOKEN
  ? createFeishuRepositoryFromEnv(process.env)
  : new MockRepository();
// 支付提供方：配置了微信支付商户凭证则用 WechatPayProvider（M2.02），否则退回 Stub（本地联调/0 代码兜底）
// 注意：生产严禁走 Stub。若必须在受限环境用 Stub，请配置 CALLBACK_SECRET 并让回调携带 X-Callback-Secret（防空转标记支付成功）。
const payment = process.env.WXPAY_MCHID
  ? new WechatPayProvider(process.env)
  : new StubPaymentProvider({ secret: process.env.CALLBACK_SECRET || null });
// 「有爱」留存（打卡/周报）：阶段一独立内存 store 跑通链路（设计§6：飞书表本阶段不建，不阻塞 MVP）
const checkinStore = new MockRepository();
// 「有爱」推送：网关凭证齐备用真实公众号 H5 下发，否则 Mock 兜底；订阅者/日志内存跑通链路
const pushGateway = createPushGatewayFromEnv(process.env);
const pushService = new PushService({ gateway: pushGateway, checkinStore });
// 埋点分析（事件日志落盘持久化：dev 重启不丢计数，长期漏斗可回溯；可 LLM/运营读 stats 验证优化）
const analytics = await createAnalytics({ file: process.env.ANALYTICS_FILE || join(WEB_DIR, '../data/analytics-events.jsonl') });
// 微信身份打通：配置 WX_APPID/WX_APP_SECRET 走官方 code2session(wechat)，否则降级生成本地稳定 openid(mock)
const authProvider = createAuthFromEnv(process.env);
// 内部管理接口鉴权（/api/stats、/api/push/daily、/api/push/logs、/api/push/trigger 等）：
// 生产建议配置 INTERNAL_KEY；未配置时这些接口裸奔（仅本地/Mock 用途，上线务必配置）。
const INTERNAL_KEY = process.env.INTERNAL_KEY || null;
function requireInternal(request) {
  if (!INTERNAL_KEY) return true; // 未配置 key：本地/演示放行（上线必配）
  const h = request.headers;
  const got = (h && h.get ? h.get('x-admin-key') : (h['x-admin-key'] || h['X-Admin-Key'])) || '';
  return got === INTERNAL_KEY;
}

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

async function serveStatic(pathname) {
  const name = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  // 防目录穿越：拒绝 .. / 反斜杠 / 二次绝对路径；再经 resolveWebFile 兜底边界校验
  if (name.includes('..') || name.includes('\\') || name.startsWith('//') || name.startsWith('/')) {
    return new Response('Not Found', { status: 404 });
  }
  const file = resolveWebFile(name);
  if (!file) return new Response('Not Found', { status: 404 });
  const ext = name.slice(name.lastIndexOf('.'));
  return new Response(await readFile(file), { headers: { 'content-type': STATIC_TYPES[ext] || 'application/octet-stream' } });
}

// 在 WEB_DIR 内安全解析相对路径（越界返回 null）
function resolveWebFile(name) {
  const file = join(WEB_DIR, name);
  const root = join(WEB_DIR);
  if (file !== root && !file.startsWith(root + '\\') && !file.startsWith(root + '/')) return null;
  return file;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

export async function handler(request) {
  const url = new URL(request.url);
  const { pathname } = url;

  try {
    if (request.method === 'GET' && (pathname === '/' || pathname === '/dashboard' || pathname.endsWith('.css') || pathname.endsWith('.js') || pathname.endsWith('.svg') || pathname.endsWith('.png'))) {
      if (pathname === '/dashboard') return await serveStatic('/dashboard.html');
      return await serveStatic(pathname);
    }

    if (request.method === 'GET' && pathname === '/api/health') {
      return json({ ok: true, service: 'pet-meal-planner', ...getRuleInfo() });
    }

    if (request.method === 'POST' && pathname === '/api/profiles') {
      const raw = await request.json();
      const profile = buildProfile(raw);
      const id = await repo.saveProfile(profile);
      analytics.track('profile_created', { id });
      return json({ ok: true, id, profile }, 201);
    }

    if (request.method === 'POST' && pathname === '/api/plans/generate') {
      const body = await request.json();
      const profile = body.profileId ? await repo.getProfile(body.profileId) : buildProfile(body.profile || body);
      if (!profile) return json({ ok: false, error: '档案不存在' }, 404);
      const plan = generateMealPlan(profile);
      await repo.savePlan(plan);
      analytics.track('plan_generated', { planId: plan.planId });
      return json({ ok: true, plan });
    }

    // M1.02 三端共享读取：同一餐单同一 ID 同数据（GET /api/plans/:id）
    if (request.method === 'GET' && pathname.startsWith('/api/plans/')) {
      const id = decodeURIComponent(pathname.split('/')[3]);
      const plan = await repo.getPlan(id);
      if (!plan) return json({ ok: false, error: '餐单不存在' }, 404);
      return json({ ok: true, plan });
    }

    // 订阅 SKU 列表
    if (request.method === 'GET' && pathname === '/api/skus') {
      return json({ ok: true, skus: listSkus() });
    }

    // M2.01 创建订阅订单（5 态状态机起点：pending）
    if (request.method === 'POST' && pathname === '/api/orders') {
      const body = await request.json();
      const order = createOrder(body);
      const pay = await payment.createPayment(order);
      await repo.saveOrder(order);
      analytics.track('order_created', { orderId: order.id });
      return json({ ok: true, order, payment: pay }, 201);
    }

    // M2.02 支付回调（幂等：重复回调不重复迁移/入账；兼容 Stub 联调与真实微信通知）
    if (request.method === 'POST' && pathname.startsWith('/api/orders/') && pathname.endsWith('/pay-callback')) {
      const id = decodeURIComponent(pathname.split('/')[3]);
      const order = await repo.getOrder(id);
      if (!order) return json({ ok: false, error: '订单不存在' }, 404);
      const rawBody = await request.text();
      const parsed = rawBody ? JSON.parse(rawBody) : {};
      const headers = {};
      if (request.headers && typeof request.headers.forEach === 'function') request.headers.forEach((v, k) => { headers[k] = v; });
      const cb = await payment.verifyCallback({ headers, body: rawBody, parsed });
      if (cb.status === 'success' && cb.paymentId) {
        applyOrderEvent(order, 'pay', { paymentId: cb.paymentId });
        await repo.saveOrder(order);
        analytics.track('order_paid', { orderId: order.id });
      }
      return json({ ok: true, order });
    }

    if (request.method === 'GET' && pathname.startsWith('/api/orders/')) {
      const id = decodeURIComponent(pathname.split('/')[3]);
      const order = await repo.getOrder(id);
      if (!order) return json({ ok: false, error: '订单不存在' }, 404);
      return json({ ok: true, order });
    }

    // 「有爱」留存：每日喂食打卡（petKey+date 幂等：重复提交仅更新可选字段）
    if (request.method === 'POST' && pathname === '/api/checkins') {
      const body = await request.json();
      const { petKey, date, ownerOpenid } = body;
      // 身份归属（R4）：带 openid 写入时先校验/锁定所有者；已锁定且归属不符 → 403 拒绝
      if (ownerOpenid) {
        if (!(await checkinStore.isOwner(petKey, ownerOpenid))) {
          return json({ ok: false, error: '该档案归属其他用户', code: 'OWNER_MISMATCH' }, 403);
        }
        await checkinStore.attachOwner(petKey, ownerOpenid);
      }
      const existing = date
        ? await checkinStore.getCheckin(petKey, date)
        : null; // 无 date 交由 buildCheckin 落到今天
      const recDate = date || (existing && existing.date);
      const record = buildCheckin({
        petKey,
        date: recDate,
        mood: body.mood !== undefined ? body.mood : (existing ? existing.mood : null),
        execPct: body.execPct !== undefined ? body.execPct : (existing ? existing.execPct : null),
        weightKg: body.weightKg !== undefined ? body.weightKg : (existing ? existing.weightKg : null)
      });
      // 幂等：同日已存在则保留原 id/fedAt，只更新本次提交的可选字段
      if (existing && existing.petKey === petKey && record.date === existing.date) {
        record.id = existing.id;
        record.fedAt = existing.fedAt;
      }
      await checkinStore.saveCheckin(record);
      analytics.track('checkin_created', { petKey: record.petKey, updated: Boolean(existing) });
      return json({ ok: true, record, updated: Boolean(existing) }, 201);
    }

    // 打卡查询（区间）
    if (request.method === 'GET' && pathname === '/api/checkins') {
      const petKey = url.searchParams.get('petKey');
      const from = url.searchParams.get('from') || undefined;
      const to = url.searchParams.get('to') || undefined;
      if (!petKey) return json({ ok: false, error: '缺少 petKey' }, 400);
      const records = await checkinStore.listCheckins(petKey, from, to);
      return json({ ok: true, records });
    }

    // 健康周报：按周生成并缓存。缺省本周；无则根据打卡记录计算
    if (request.method === 'GET' && pathname === '/api/reports/week') {
      const petKey = url.searchParams.get('petKey');
      const petName = url.searchParams.get('petName');
      const ref = url.searchParams.get('date') || undefined;
      if (!petKey) return json({ ok: false, error: '缺少 petKey' }, 400);
      const { start, end } = weekRange(ref);
      const records = await checkinStore.listCheckins(petKey, start, end);
      const report = computeWeeklyReport({ petKey, records, weekStart: start, weekEnd: end, petName, today: ref || undefined });
      await checkinStore.saveReport(report);
      return json({ ok: true, report });
    }

    // 历史周报列表（最新在前）
    if (request.method === 'GET' && pathname === '/api/reports') {
      const petKey = url.searchParams.get('petKey');
      if (!petKey) return json({ ok: false, error: '缺少 petKey' }, 400);
      const reports = await checkinStore.listReports(petKey);
      return json({ ok: true, reports });
    }

    // 「有爱」推送：注册订阅（客户开启每日推送）。idempotent：同 petKey 重复订阅为更新
    if (request.method === 'POST' && pathname === '/api/push/subscribe') {
      const body = await request.json();
      // R4 归属校验：订阅携带 openid 时须与文档所有者一致（防向他人 openid 订阅/骚扰）。
      // 防竞争写法：先看当前归属；不归属 → 尝试锁定；锁回他人则 403。
      if (body.miniOpenid) {
        if (!(await checkinStore.isOwner(body.petKey, body.miniOpenid))) {
          const locked = await checkinStore.attachOwner(body.petKey, body.miniOpenid);
          if (locked !== body.miniOpenid) return json({ ok: false, error: '该档案归属其他用户', code: 'OWNER_MISMATCH' }, 403);
        }
      }
      const subscriber = pushService.subscribe(body);
      analytics.track('push_subscribe', { petKey: subscriber.petKey });
      return json({ ok: true, subscriber, gateway: pushGateway.name }, 201);
    }

    // 预览某宠物今日推送内容（不实际下发，供开发/联调查看内容挑选）
    if (request.method === 'GET' && pathname === '/api/push/preview') {
      const petKey = url.searchParams.get('petKey');
      if (!petKey) return json({ ok: false, error: '缺少 petKey' }, 400);
      const preview = await pushService.previewFor(petKey);
      if (!preview) return json({ ok: false, error: '该宠物尚未订阅推送' }, 404);
      return json({ ok: true, preview, gateway: pushGateway.name });
    }

    // 手动触发一次每日 H5 任务（无独立 cron 时也可被计划任务定时调用）
    if (request.method === 'POST' && pathname === '/api/push/daily') {
      if (!requireInternal(request)) return json({ ok: false, error: 'unauthorized' }, 401);
      const result = await pushService.sendDaily();
      result.sent.forEach((s) => analytics.track('push_daily_sent', { petKey: s.petKey, scene: s.scene }));
      result.errors.forEach((e) => analytics.track('push_daily_error', { petKey: e.petKey, message: e.message }));
      return json({ ok: true, ...result, gateway: pushGateway.name });
    }

    // 微信登录（code → openid/unionid）；凭证缺失时按 deviceId 生成本地稳定 openid（保链路国产可跑）
    if (request.method === 'POST' && pathname === '/api/auth/login') {
      const body = await request.json();
      const identity = await authProvider.code2session({ code: body.code, deviceId: body.deviceId });
      return json({ ok: true, auth: authProvider.name, ...identity });
    }

    // 小程序订阅消息触发（一次性，关键时机）：{petKey, scene, templateId?, page?}
    if (request.method === 'POST' && pathname === '/api/push/trigger') {
      if (!requireInternal(request)) return json({ ok: false, error: 'unauthorized' }, 401);
      const body = await request.json();
      const res = await pushService.sendTrigger(body);
      return json({ ok: true, result: res });
    }

    // 退订 / 偏好
    if (request.method === 'POST' && pathname === '/api/push/unsubscribe') {
      const { petKey } = await request.json();
      if (!petKey) return json({ ok: false, error: '缺少 petKey' }, 400);
      return json({ ok: true, removed: pushService.unsubscribe(petKey) });
    }
    if (request.method === 'POST' && pathname === '/api/push/pref') {
      const { petKey, pref } = await request.json();
      try {
        const sub = pushService.updatePref(petKey, pref);
        return json({ ok: true, subscriber: sub });
      } catch (err) {
        return json({ ok: false, error: err.message }, 404);
      }
    }

    // 推送日志（最近 N 条，debug）
    if (request.method === 'GET' && pathname === '/api/push/logs') {
      if (!requireInternal(request)) return json({ ok: false, error: 'unauthorized' }, 401);
      const n = Number(url.searchParams.get('n') || 20);
      return json({ ok: true, logs: pushService.recentLogs(n), gateway: pushGateway.name });
    }

    // 埋点上报（前端可主动上报扩展事件）
    if (request.method === 'POST' && pathname === '/api/events') {
      const body = await request.json();
      analytics.track(body.name, body.meta || {});
      return json({ ok: true });
    }
    // 北极星指标快照（埋点统计）
    if (request.method === 'GET' && pathname === '/api/stats') {
      if (!requireInternal(request)) return json({ ok: false, error: 'unauthorized' }, 401);
      return json({ ok: true, ...analytics.stats(), pushLogs: pushService.recentLogs(10) });
    }

    return json({ ok: false, error: 'not found' }, 404);
  } catch (err) {
    const code = err.code || 'INTERNAL';
    const status = code === 'PROFILE_INVALID' || code === 'SKU_NOT_FOUND' || code === 'CALLBACK_INVALID' || String(code).startsWith('CHECKIN_BAD') ? 400 : 500;
    // R7：仅对「客户端输入错误」回传具体 message；内部错误口径统一，避免向外部泄露实现细节与堆栈
    const msg = status === 400 ? String(err.message) : '服务器内部错误';
    return json({ ok: false, error: msg, code: err.code || 'INTERNAL' }, status);
  }
}

// 本地启动：仅在直接执行本文件时生效（EdgeOne 部署只导出 handler）
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  const port = Number(process.env.PORT || 3000);
  createServer((req, res) => {
    const { headers, method } = req;
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      const request = new Request(`http://localhost:${port}${req.url}`, { method, headers, body: body || undefined });
      const resp = await handler(request);
      res.writeHead(resp.status, Object.fromEntries(resp.headers));
      res.end(await resp.text());
    });
  }).listen(port, () => console.log(`pet-meal-planner dev server: http://127.0.0.1:${port}`));
}

// 供 dev 调度器 / 部署侧定时绑定复用同一服务实例（EdgeOne 仅消费默认导出 handler）
export { pushService, analytics, authProvider };
