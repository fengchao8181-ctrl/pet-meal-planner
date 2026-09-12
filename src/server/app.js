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
import { MockRepository } from '../services/mock-repository.js';
import { StubPaymentProvider } from '../services/payment-provider.js';

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const repo = new MockRepository();
// 支付提供方：联调/0 代码兜底用 StubPaymentProvider；接入微信支付时替换为 WeChatPaymentProvider（M2.02，需商户号）
const payment = new StubPaymentProvider();

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

async function serveStatic(pathname) {
  const name = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  const file = join(WEB_DIR, name);
  const ext = name.slice(name.lastIndexOf('.'));
  return new Response(await readFile(file), { headers: { 'content-type': STATIC_TYPES[ext] || 'application/octet-stream' } });
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
    if (request.method === 'GET' && (pathname === '/' || pathname.endsWith('.css') || pathname.endsWith('.js') || pathname.endsWith('.svg') || pathname.endsWith('.png'))) {
      return await serveStatic(pathname);
    }

    if (request.method === 'GET' && pathname === '/api/health') {
      return json({ ok: true, service: 'pet-meal-planner', ...getRuleInfo() });
    }

    if (request.method === 'POST' && pathname === '/api/profiles') {
      const raw = await request.json();
      const profile = buildProfile(raw);
      const id = await repo.saveProfile(profile);
      return json({ ok: true, id, profile }, 201);
    }

    if (request.method === 'POST' && pathname === '/api/plans/generate') {
      const body = await request.json();
      const profile = body.profileId ? await repo.getProfile(body.profileId) : buildProfile(body.profile || body);
      if (!profile) return json({ ok: false, error: '档案不存在' }, 404);
      const plan = generateMealPlan(profile);
      await repo.savePlan(plan);
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
      return json({ ok: true, order, payment: pay }, 201);
    }

    // M2.02 支付回调（幂等：重复回调不重复迁移/入账）
    if (request.method === 'POST' && pathname.startsWith('/api/orders/') && pathname.endsWith('/pay-callback')) {
      const id = decodeURIComponent(pathname.split('/')[3]);
      const order = await repo.getOrder(id);
      if (!order) return json({ ok: false, error: '订单不存在' }, 404);
      const cb = await payment.verifyCallback(await request.json());
      if (cb.status === 'success' && cb.paymentId) {
        applyOrderEvent(order, 'pay', { paymentId: cb.paymentId });
        await repo.saveOrder(order);
      }
      return json({ ok: true, order });
    }

    if (request.method === 'GET' && pathname.startsWith('/api/orders/')) {
      const id = decodeURIComponent(pathname.split('/')[3]);
      const order = await repo.getOrder(id);
      if (!order) return json({ ok: false, error: '订单不存在' }, 404);
      return json({ ok: true, order });
    }

    return json({ ok: false, error: 'not found' }, 404);
  } catch (err) {
    const status = err.code === 'PROFILE_INVALID' || err.code === 'SKU_NOT_FOUND' || err.code === 'CALLBACK_INVALID' ? 400 : 500;
    return json({ ok: false, error: err.message, code: err.code || 'INTERNAL' }, status);
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
