// EdgeOne 云函数兼容入口：export async function handler(request, env)
// 本地开发：node src/server/app.js 直接启动（用原生 http 包装同一 handler）
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createServer } from 'node:http';
import { buildProfile } from '../domain/profile.js';
import { generateMealPlan } from '../domain/meal-plan.js';
import { getRuleInfo } from '../domain/rules-engine.js';
import { MockRepository } from '../services/mock-repository.js';

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const repo = new MockRepository();

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

    return json({ ok: false, error: 'not found' }, 404);
  } catch (err) {
    const status = err.code === 'PROFILE_INVALID' ? 400 : 500;
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
