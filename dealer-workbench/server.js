import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');
const PORT = process.env.PORT || 5874;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// 通用 AI 代理：浏览器把接口地址 / Key / 模型 / 消息传过来，由服务端转发，避免跨域。
async function handleAi(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req) || '{}');
  } catch {
    return sendJson(res, 400, { ok: false, error: '请求体不是有效 JSON' });
  }
  const { baseUrl, apiKey, model, messages } = body;
  if (!Array.isArray(messages) || !messages.length) {
    return sendJson(res, 400, { ok: false, error: '缺少 messages' });
  }
  const endpoint = baseUrl
    ? baseUrl.replace(/\/$/, '') + '/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';
  const target = endpoint.includes('/v1/') || endpoint.includes('/chat/completions')
    ? endpoint
    : (endpoint.includes('openai') ? endpoint + '/v1/chat/completions' : endpoint);
  try {
    const upstream = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model: model || 'gpt-3.5-turbo', messages, stream: false }),
    });
    const text = await upstream.text();
    let json;
    try { json = JSON.parse(text); } catch { json = null; }
    if (!upstream.ok) {
      return sendJson(res, upstream.status, {
        ok: false, error: json?.error?.message || `上游返回 ${upstream.status}`,
      });
    }
    const content = json?.choices?.[0]?.message?.content || '';
    return sendJson(res, 200, { ok: true, content });
  } catch (e) {
    return sendJson(res, 502, { ok: false, error: String(e && e.message || e) });
  }
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = decodeURIComponent(urlObj.pathname);

  if (req.method === 'POST' && pathname === '/api/ai') return handleAi(req, res);

  if (req.method === 'GET' && pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, service: 'dealer-workbench' });
  }

  // 静态文件
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405); return res.end();
  }
  let rel = pathname === '/' ? '/index.html' : pathname;
  let filePath = normalize(join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  try {
    const st = await stat(filePath);
    if (st.isDirectory()) filePath = join(filePath, 'index.html');
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`dealer-workbench running at http://localhost:${PORT}`);
});