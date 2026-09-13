// 本地开发一键启动：加载 .env（飞书/微信支付凭证）后启动同一 handler
// 监听 0.0.0.0，便于真机预览（手机通过电脑局域网 IP 访问）
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import os from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// 读取 .env 注入 process.env（不覆盖已有环境变量）
try {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
} catch (e) {
  console.warn('未找到 .env，将以 Mock 内存存储/Stub 支付运行：', e.message);
}

const { handler, pushService } = await import('../src/server/app.js');
const port = Number(process.env.PORT || 3000);

createServer((req, res) => {
  const { headers, method } = req;
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    try {
      const request = new Request(`http://localhost:${port}${req.url}`, { method, headers, body: body || undefined });
      const resp = await handler(request);
      res.writeHead(resp.status, Object.fromEntries(resp.headers));
      res.end(await resp.text());
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  });
}).listen(port, '0.0.0.0', () => {
  const LAN = Object.values(os.networkInterfaces())
    .flat().find((i) => i && i.family === 'IPv4' && !i.internal);
  console.log(`pet-meal-planner dev server 已启动`);
  console.log(`  模拟器/本机: http://127.0.0.1:${port}`);
  console.log(`  真机预览用: http://${LAN ? LAN.address : '<电脑局域网IP>'}:${port}`);
  startDailyScheduler();
});

// 每日推送自动调度（本地开发）：到 PUSH_HOUR（默认 8 点）后当日执行一次每日 H5 推送。
// 幂等：sendDaily 按 petKey@date 去重，重复触发不会重发；跨天自然更新。
// EdgeOne 生产环境改用 scheduled trigger 定时绑定（见推送实现计划 §阶段B），逻辑同一 sendDaily。
function startDailyScheduler() {
  const hour = Number(process.env.PUSH_HOUR || 8);
  let lastDay = null;
  const check = async () => {
    try {
      const now = new Date();
      const day = now.toISOString().slice(0, 10);
      if (day === lastDay || now.getHours() < hour) return;
      lastDay = day;
      const res = await pushService.sendDaily();
      console.log(`[push-scheduler] ${day} 每日推送: sent=${res.sent.length} skipped=${res.skipped.length} errors=${res.errors.length}`);
    } catch (err) {
      console.warn('[push-scheduler] 执行失败:', err.message);
    }
  };
  check();
  setInterval(check, 60 * 1000);
}