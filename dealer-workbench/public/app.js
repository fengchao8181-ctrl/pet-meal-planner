/* ============ 荷官全能工作台 ============ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---------- 常量 ---------- */
const STATUS = [
  { id: 'new', label: '新需求', cls: 'st-new' },
  { id: 'wait', label: '待回复', cls: 'st-wait' },
  { id: 'done', label: '已对接', cls: 'st-done' },
  { id: 'closed', label: '已成交', cls: 'st-closed' },
  { id: 'dead', label: '无效客源', cls: 'st-dead' },
];
const TIER = [
  { id: 'new', label: '新客户', cls: 'tier-new' },
  { id: 'exp', label: '体验客户', cls: 'tier-exp' },
  { id: 'high', label: '高价值客户', cls: 'tier-high' },
  { id: 'agent', label: '代理合作', cls: 'tier-agent' },
];
const SOURCES = ['采集器', '小红书', '抖音', '视频号', '老客转介绍', '同城'];
const NEEDS = ['找荷官驻场', '新手教学', '私人组局', '赛事主持', '规则咨询'];
const sMeta = id => STATUS.find(s => s.id === id) || STATUS[0];
const tMeta = id => TIER.find(t => t.id === id) || TIER[0];

/* ---------- 存储 ---------- */
const LS_KEY = 'dealer_leads_v1';
const seedLeads = () => {
  const now = Date.now();
  const mk = (name, phone, source, needs, status, tier, note, ageH) => ({
    id: 'L' + Math.random().toString(36).slice(2, 8).toUpperCase(),
    name, phone, source, needs, status, tier, note,
    time: now - ageH * 3600e3, link: '',
  });
  return [
    mk('王姐', '13900001111', '小红书', ['找荷官驻场'], 'done', 'high', '周六夜场档期，谈分成', 5),
    mk('陈先生', '13900002222', '采集器', ['私人组局'], 'new', 'new', '朋友局 8 人，想付费组局', 2),
    mk('Lily', '13900003333', '抖音', ['新手教学'], 'wait', 'new', '零基础，问课时和价格', 8),
    mk('老李', '13900004444', '老客转介绍', ['赛事主持'], 'closed', 'agent', '小型赛事主持，已成单，转介绍源', 30),
    mk('小林', '13900005555', '同城', ['规则咨询'], 'dead', 'new', '只问不买，暂无效', 50),
    mk('阿豪', '13900006666', '视频号', ['找荷官驻场', '新手教学'], 'wait', 'exp', '想驻场+顺便教学', 12),
    mk('周总', '13900007777', '同城', ['私人组局'], 'done', 'high', '俱乐部组局，谈长期合作', 3),
    mk('Momo', '13900008888', '采集器', ['新手教学'], 'new', 'new', '评论区求入门教程', 1),
  ];
};
const load = () => {
  try { const d = JSON.parse(localStorage.getItem(LS_KEY)); if (Array.isArray(d)) return d; } catch {}
  const s = seedLeads(); localStorage.setItem(LS_KEY, JSON.stringify(s)); return s;
};
const save = leads => localStorage.setItem(LS_KEY, JSON.stringify(leads));
let leads = load();

/* ---------- 工具 ---------- */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));
let toastT;
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2200);
}
async function copy(text, tip = '已复制') {
  try { await navigator.clipboard.writeText(text); toast(tip); }
  catch { toast('复制失败，请手动复制'); }
}
const fmtRel = t => {
  const d = (Date.now() - t) / 3600e3;
  if (d < 1) return Math.max(1, Math.round(d * 60)) + ' 分钟前';
  if (d < 24) return Math.round(d) + ' 小时前';
  return Math.round(d / 24) + ' 天前';
};
const fmtDate = t => new Date(t).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });

/* ---------- 路由 ---------- */
const VIEWS = ['overview', 'leads', 'scripts', 'ai', 'auto'];
function navigate(view) {
  if (!VIEWS.includes(view)) view = 'overview';
  history.replaceState(null, '', '#' + view);
  $$('.nav-link').forEach(a => a.classList.toggle('active', a.dataset.view === view));
  const render = { overview: renderOverview, leads: renderLeads, scripts: renderScripts, ai: renderAi, auto: renderAuto }[view];
  render();
}
$$('.nav-link').forEach(a => a.addEventListener('click', () => navigate(a.dataset.view)));
window.addEventListener('hashchange', () => navigate(location.hash.slice(1) || 'overview'));

/* ============ 总览 ============ */
function renderOverview() {
  const total = leads.length;
  const today = leads.filter(l => Date.now() - l.time < 24 * 3600e3).length;
  const wait = leads.filter(l => l.status === 'wait' || l.status === 'new').length;
  const closed = leads.filter(l => l.status === 'closed').length;
  const rate = total ? Math.round(closed / total * 100) : 0;

  const srcMap = {}; leads.forEach(l => srcMap[l.source] = (srcMap[l.source] || 0) + 1);
  const srcs = SOURCES.map(s => [s, srcMap[s] || 0]).sort((a, b) => b[1] - a[1]);
  const maxSrc = Math.max(1, ...srcs.map(s => s[1]));

  const stage = {
    new: leads.filter(l => l.status === 'new').length,
    wait: leads.filter(l => l.status === 'wait').length,
    done: leads.filter(l => l.status === 'done').length,
    closed: leads.filter(l => l.status === 'closed').length,
  };
  const recents = [...leads].sort((a, b) => b.time - a.time).slice(0, 6);
  const spark = [4, 7, 5, 9, 6, 10, 8, 12, 9, 14];

  $('#view').innerHTML = `
    <div class="topbar">
      <div>
        <h1>总览</h1>
        <div class="crumb">新客获客 · 跟进转化 · 实时台账</div>
      </div>
      <div class="right">
        <button class="btn btn-ghost" onclick="copy('${FEISHU_FORM}','表单链接已复制')">复制新客登记链接</button>
        <button class="btn btn-primary" onclick="openLeadModal()">+ 新增新客</button>
      </div>
    </div>

    <div class="grid kpis" style="margin-bottom:14px">
      ${kpi('新客总数', total, '', `累计登记 ${total} 位`)}
      ${kpi('今日新客', today, 'rise', `较近 7 日均值，上升 12%`)}
      ${kpi('待跟进', wait, '', `需优先触达 ${wait} 位`, 'warn')}
      ${kpi('成交率', rate + '%', 'rise', `累计成交 ${closed} 单`, 'ok')}
    </div>

    <div class="grid group">
      <div class="card pad">
        <div class="card-head"><h3>新客来源分布</h3><span class="hint">采集器 · 公域 · 转介绍</span></div>
        ${srcs.map(([k, v]) => `
          <div class="bar-row"><span class="k">${k}</span>
            <div class="bar-track"><div class="bar-fill" style="width:${Math.round(v / maxSrc * 100)}%"></div></div>
            <span class="v">${v}</span></div>`).join('')}
      </div>
      <div class="card pad">
        <div class="card-head"><h3>跟进漏斗</h3><span class="hint">新客 → 成交</span></div>
        <div class="funnel">
          ${[['新需求', stage.new], ['待回复', stage.wait], ['已对接', stage.done], ['已成交', stage.closed]].map(([l, c]) => {
            const w = total ? Math.round(c / total * 100) : 0;
            return `<div class="fstep"><span class="l">${l}</span><div class="bar" style="width:${w}%">${c}</div><span class="small muted">${w}%</span></div>`;
          }).join('')}
        </div>
        <div class="card-head" style="margin-top:18px"><h3>近 7 日获客</h3></div>
        <div class="kpi"><div class="spark">${spark.map(h => `<i style="height:${h * 2.2}px"></i>`).join('')}</div></div>
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="card-head pad" style="margin-bottom:0;border-bottom:none"><h3>最近新客</h3><a href="#leads" style="color:var(--brand-ink);font-weight:600;font-size:13px">全部 →</a></div>
      <div style="padding:0 20px 8px">${leadTable(recents, true)}</div>
    </div>`;
}
function kpi(label, val, deltaCls, deltaText, accentCls) {
  const dot = accentCls ? ' · ' + deltaText.replace(/^.*?。/,'') : deltaText;
  return `<div class="card pad kpi">
    <span class="lab">${label}</span>
    <span class="val">${val}</span>
    <span class="delta">${deltaCls ? `<span class="pill ${deltaCls}">▲</span>` : ''}${dot}</span>
  </div>`;
}

function leadTable(list, simple = false) {
  if (!list.length) return `<div class="empty"><div class="big">♠</div>还没有新客，去新增一条吧。</div>`;
  return `<div style="overflow-x:auto">
  <table>
    <thead><tr><th>客户</th><th>来源</th><th>需求</th><th>状态</th><th>分层</th><th>接入时间</th>${simple ? '' : '<th></th>'}</tr></thead>
    <tbody>
      ${list.map(l => `
        <tr>
          <td><div class="cell-name">${esc(l.name)}</div><div class="cell-sub">${esc(l.phone)}</div></td>
          <td>${esc(l.source)}</td>
          <td>${l.needs.map(n => `<span class="chip" style="background:var(--surface-muted);color:var(--muted);margin-right:4px">${n}</span>`).join('')}</td>
          <td><span class="chip ${sMeta(l.status).cls}">${sMeta(l.status).label}</span></td>
          <td><span class="chip ${tMeta(l.tier).cls}">${tMeta(l.tier).label}</span></td>
          <td class="muted">${fmtRel(l.time)}</td>
          ${simple ? '' : `<td class="small">
              <button class="btn btn-ghost btn-sm" onclick="editLead('${l.id}')">跟进</button>
            </td>`}
        </tr>`).join('')}
    </tbody>
  </table></div>`;
}

/* ============ 新客台账 ============ */
let leadsFilter = {};
function renderLeads(q = '') {
  const { status = 'all', source = 'all', tier = 'all', kw = '' } = leadsFilter;
  let list = leads.filter(l =>
    (status === 'all' || l.status === status) &&
    (source === 'all' || l.source === source) &&
    (tier === 'all' || l.tier === tier) &&
    (l.name + l.phone + l.note).includes(kw)
  );
  list = [...list].sort((a, b) => b.time - a.time);
  $('#view').innerHTML = `
    <div class="topbar">
      <div><h1>新客台账</h1><div class="crumb">新客信息实时汇入 · 一键跟进转化</div></div>
      <div class="right">
        <button class="btn btn-ghost" onclick="copy('${FEISHU_FORM}','表单链接已复制')">复制登记链接</button>
        <button class="btn btn-primary" onclick="openLeadModal()">+ 新增新客</button>
      </div>
    </div>
    <div class="card">
      <div class="toolbar">
        <input class="input" style="width:220px" placeholder="搜索姓名/电话/备注" value="${esc(leadsFilter.kw || '')}" oninput="onSearch(this.value)" />
        <select class="input" onchange="leadsFilter.status=this.value;renderLeads()">${selOpts(leadsFilter.status, [['all','状态'], ...STATUS.map(s=>[s.id,s.label])])}</select>
        <select class="input" onchange="leadsFilter.source=this.value;renderLeads()">${selOpts(leadsFilter.source, [['all','来源'], ...SOURCES.map(s=>[s,s])])}</select>
        <select class="input" onchange="leadsFilter.tier=this.value;renderLeads()">${selOpts(leadsFilter.tier, [['all','分层'], ...TIER.map(t=>[t.id,t.label])])}</select>
        <span class="small muted" style="margin-left:auto">共 ${list.length} 位新客</span>
      </div>
      <div style="padding:8px 20px 16px">${leadTable(list)}</div>
    </div>`;
}
const selOpts = (cur, pairs) => pairs.map(([v, t]) => `<option value="${v}" ${v === (cur || 'all') ? 'selected' : ''}>${t}</option>`).join('');
function onSearch(v) { leadsFilter.kw = v; renderLeads(); }
function setStatus(id) {}

/* ---------- 新增 / 跟进 ---------- */
function openLeadModal(id) {
  const l = id ? leads.find(x => x.id === id) : null;
  $('#modal-box').innerHTML = `
    <div class="modal-head"><h3>${l ? '跟进：' + esc(l.name) : '新增新客'}</h3><button class="btn btn-icon btn-ghost" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      ${l ? `
        <div class="field"><label class="bl">跟进状态</label>
          <select class="input" id="f-status">${STATUS.map(s => `<option value="${s.id}" ${s.id === l.status ? 'selected' : ''}>${s.label}</option>`).join('')}</select></div>
        <div class="field"><label class="bl">客户分层</label>
          <select class="input" id="f-tier">${TIER.map(t => `<option value="${t.id}" ${t.id === l.tier ? 'selected' : ''}>${t.label}</option>`).join('')}</select></div>
        <div class="field"><label class="bl">备注</label><textarea class="input" id="f-note">${esc(l.note || '')}</textarea></div>
      ` : `
        <div class="form-grid">
          <div class="field"><label class="bl">称呼（必填）</label><input class="input" id="f-name" placeholder="如：王姐" /></div>
          <div class="field"><label class="bl">联系方式（必填）</label><input class="input" id="f-phone" placeholder="微信 / 手机号" /></div>
          <div class="field"><label class="bl">来源平台</label><select class="input" id="f-source">${SOURCES.map(s => `<option>${s}</option>`).join('')}</select></div>
          <div class="field"><label class="bl">客户需求（可多选）</label>
            <select class="input" id="f-needs" multiple size="4">${NEEDS.map(n => `<option>${n}</option>`).join('')}</select></div>
          <div class="field full"><label class="bl">备注</label><textarea class="input" id="f-note" placeholder="需求补充 / 档期 / 预算等"></textarea></div>
        </div>
      `}
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="${l ? `saveLead('${l.id}')` : 'createLead()'}">${l ? '保存' : '入库'}</button>
    </div>`;
  $('#modal').classList.add('open');
  if (!l) setTimeout(() => $('#f-name').focus(), 50);
}
function closeModal() { $('#modal').classList.remove('open'); }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

function createLead() {
  const name = $('#f-name').value.trim(), phone = $('#f-phone').value.trim();
  if (!name || !phone) return toast('称呼与联系方式为必填');
  const needs = [...$('#f-needs').selectedOptions].map(o => o.value);
  leads.push({
    id: 'L' + Math.random().toString(36).slice(2, 8).toUpperCase(),
    name, phone, source: $('#f-source').value,
    needs: needs.length ? needs : ['规则咨询'],
    status: 'new', tier: 'new', note: $('#f-note').value.trim(),
    time: Date.now(), link: '', auto: true,
  });
  save(leads); closeModal(); toast('新客已实时入表'); renderLeads();
}
function saveLead(id) {
  const l = leads.find(x => x.id === id); if (!l) return;
  l.status = $('#f-status').value; l.tier = $('#f-tier').value; l.note = $('#f-note').value.trim();
  save(leads); closeModal(); toast('已保存');
  const v = location.hash.slice(1); v === 'leads' ? renderLeads() : renderOverview();
}
function editLead(id) { openLeadModal(id); }

/* ============ 话术库 ============ */
const SCRIPTS = {
  '破冰开场': [
    { t: '小红书评论·第一个私信', c: '姐妹你好～看到你在评论区问荷官驻场的事，我是专业荷官，主打正规休闲娱乐局主持。方便的话大概想办多大场子、几个人？我先帮你估个档期。' },
    { t: '抖音私信·新手开场', c: '你好呀～刷到你主页在看德州教学，我是职业荷官，也带新手入门。你是想先学规则，还是想找人组休闲局练练手？' },
    { t: '同城·首条问候', c: '嗨，看到我们在同一个城市，正好我这边承接正规休闲局荷官主持～你平时和朋友打德州多吗？想了解的话随时聊。' },
  ],
  '深度沟通': [
    { t: '挖需求·档期', c: '想确认下：你们大概什么时间、多大的局？（比如周六晚、8 人桌）我好帮你看那天有没有空，顺便给你报价和配套方案。' },
    { t: '挖需求·预算', c: '方便的话可以透露下你们的预算区间吗？我这边有不同档位的正规主持套餐，能匹配你合适的，绝不乱推荐。' },
    { t: '建立信任', c: '我服务的是正规休闲娱乐场景，风格是控场稳、气氛好、不冷场，牌局节奏和经验都到位，回头客不少。需要的话可以看看我以往的局照/评价。' },
  ],
  '犹豫逼单': [
    { t: '小额试水', c: '其实你可以先约一场小局试试手感，成本不高，体验好自然就长期合作了～我一般会照顾好第一场，让你放心。' },
    { t: '稀缺·档期', c: '提醒一下，这个周末的档期已经很紧张了，你要的那天目前还有 1 个空位。可以的话先定个时间，我好把位子给你留出来。' },
    { t: '承诺兜底', c: '我做事透明：流程、价格、服务内容都先讲清楚，没有隐藏费用。你先报个时间，不合适再退不迟。' },
  ],
  '老客维护': [
    { t: '回访', c: '上次的局你感受怎么样？有想调节奏或者加内容的，直接跟我说，这一场我包你更顺手。' },
    { t: '转介绍', c: '如果你身边有朋友也想办正规休闲局，或需要教学，介绍过来我给你安排一个专属老客价。' },
  ],
};
function renderScripts() {
  let active = '破冰开场';
  const cats = Object.keys(SCRIPTS);
  $('#view').innerHTML = `
    <div class="topbar">
      <div><h1>话术库</h1><div class="crumb">可分场景直接复制的换代转化话术</div></div>
      <button class="btn btn-ghost" onclick="copy(${JSON.stringify(JSON.stringify(Object.values(SCRIPTS).flat().map(s => s.t + '\n' + s.c).join('\n\n---\n\n')))})">导出全部</button>
    </div>
    <div class="tagrow">${cats.map(c => `<button class="tag ${c === active ? 'active' : ''}" onclick="useScriptCat('${c}')">${c}</button>`).join('')}</div>
    <div class="grid cols-2" id="script-grid"></div>`;
  window.__scriptCat = active;
  renderScriptCards();
}
function useScriptCat(c) { window.__scriptCat = c; renderScripts(); }
function renderScriptCards() {
  const c = window.__scriptCat || '破冰开场';
  $$('.tag').forEach(t => t.classList.toggle('active', t.textContent === c));
  $('#script-grid').innerHTML = SCRIPTS[c].map((s, i) => `
    <div class="copy-card"><div><span class="small muted">${esc(s.t)}</span><p style="margin-top:6px">${esc(s.c)}</p></div>
    <button class="btn btn-soft btn-sm" onclick="copy(this.previousElementSibling.querySelector('p').textContent)">复制</button></div>`).join('');
}

/* ============ AI 助手 ============ */
const AI_CONFIG_KEY = 'dealer_ai_config';
const AI_HISTORY_KEY = 'dealer_ai_history';
const aiConfig = () => {
  try { return JSON.parse(localStorage.getItem(AI_CONFIG_KEY)) || {}; } catch { return {}; }
};
function saveAiConfig(c) { localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(c)); }
function aiHistory() {
  try { const h = JSON.parse(localStorage.getItem(AI_HISTORY_KEY)); if (Array.isArray(h)) return h; } catch {}
  return [];
}
function saveAiHistory(h) { localStorage.setItem(AI_HISTORY_KEY, JSON.stringify(h.slice(-40))); }

const AI_PROMPTS = {
  '生成回复话术': '你是资深荷官运营场景的文案助手。请基于以下新客信息，生成一段可直接发送的、合规的破冰转化回复话术（只做正规休闲娱乐/赛事/教学场景，不涉赌推广），语气自然、不油腻，15-30 个回复句。',
  '写一条口播脚本': '请为一位低粉账号的德州荷官博主，写一条 30 秒的手机直拍口播脚本（标题占位 + 开场钩子 + 干货主体 + 行动引导），主题围绕正规休闲局和荷官职业日常，自带完播和点赞属性。',
  '复盘本周转化': '请把我下面这些新客信息做一个简要复盘：渠道分布如何、哪类需求用哪种话术更易成交、下周该优先跟进谁。输出结构化要点。',
};
function renderAi() {
  const cfg = aiConfig();
  const history = aiHistory();
  $('#view').innerHTML = `
    <div class="topbar">
      <div><h1>AI 助手</h1><div class="crumb">文案生成 · 话术点拨 · 转化复盘</div></div>
      <button class="btn btn-ghost" onclick="openAiSettings()">⚙ 接口设置</button>
    </div>
    <div class="chat-quick">
      ${Object.keys(AI_PROMPTS).map(p => `<button class="tag" onclick="aiQuick('${p}')">${p}</button>`).join('')}
    </div>
    <div class="card chat">
      <div class="chat-log" id="chat-log"></div>
      <div class="chat-input">
        <textarea class="input" id="ai-input" placeholder="描述你的需求，或用上方模板快速生成… (Enter 发送)"></textarea>
        <button class="btn btn-primary" onclick="aiSend()">发送</button>
      </div>
    </div>`;
  const bg = cfg.connector ? '已连接 ' + (cfg.baseUrl || '默认') : '未配置接口，AI 暂不可用';
  history.forEach(m => appendMsg(m.role, m.content));
  if (!history.length) appendMsg('ai', '你好，我是荷官工作台的 AI 助手。把要写的回复话术、口播脚本或要复盘的新客信息发给我；也可以用上方模板一键生成。');
  const inp = $('#ai-input');
  inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); aiSend(); } });
}
function appendMsg(role, text) {
  const log = $('#chat-log'); if (!log) return;
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  div.innerHTML = role === 'ai' ? `<div class="head"><span>✦ AI 助手</span></div>${esc(text)}` : '';
  if (role === 'user') div.textContent = text;
  div.dataset.text = text;
  log.appendChild(div); log.scrollTop = log.scrollHeight;
  return div;
}
async function aiSend() {
  const inp = $('#ai-input'); const text = inp.value.trim(); if (!text) return;
  const cfg = aiConfig();
  if (!cfg.connector) return toast('请先到 ⚙ 接口设置 里配置 AI 接口');
  inp.value = ''; if (window.__aiBooting) return;
  appendMsg('user', text);
  const typing = appendMsg('ai', '');
  typing.innerHTML = '<div class="head"><span>✦ AI 助手</span></div><span class="typing"><i></i><i></i><i></i></span>';
  const history = aiHistory();
  const messages = [...history].map(m => ({ role: m.role, content: m.content })).concat({ role: 'user', content: text });
  try {
    const res = await fetch('/api/ai', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, messages }),
    });
    const data = await res.json();
    const content = res.ok && data.ok ? data.content : ('（调用失败）' + (data.error || res.status));
    typing.innerHTML = `<div class="head"><span>✦ AI 助手</span></div>${esc(content)}`;
    typing.dataset.text = content;
    const next = [...history, { role: 'user', content: text }, { role: 'assistant', content }];
    saveAiHistory(next);
  } catch (e) {
    typing.innerHTML = `<div class="head"><span>✦ AI 助手</span></div>（网络错误）` + esc(String(e && e.message || e));
  }
}
function aiQuick(promptKey) {
  const p = AI_PROMPTS[promptKey];
  if (!p) return;
  const cfg = aiConfig();
  // 附带相关上下文（最近新客几则）
  const sample = leads.slice(0, 4).map(l => `· ${l.name}（${l.source}/${l.needs.join('/')}，状态${sMeta(l.status).label}）`).join('\n');
  const full = p + '\n\n【相关新客信息】\n' + (sample || '（暂无新客）');
  const inp = $('#ai-input'); inp.value = full; inp.focus();
}
function openAiSettings() {
  const cfg = aiConfig();
  $('#modal-box').innerHTML = `
    <div class="modal-head"><h3>AI 接口设置</h3><button class="btn btn-icon btn-ghost" onclick="closeModal()">✕</button></div>
    <div class="modal-body ai-settings">
      <div class="field"><label class="bl">接口类型</label>
        <select class="input" id="a-connector" onchange="toggleConnector()">
          <option value="openai" ${cfg.connector === 'openai' || !cfg.connector ? 'selected' : ''}>OpenAI 兼容接口</option>
          <option value="none" ${cfg.connector === 'none' ? 'selected' : ''}>暂不开启</option>
        </select></div>
      <div class="field"><label class="bl">接口地址（Base URL，可留空用默认）</label>
        <input class="input" id="a-base" placeholder="https://your-endpoint.com/v1" value="${esc(cfg.baseUrl || '')}" /></div>
      <div class="field"><label class="bl">API Key</label>
        <input class="input" type="password" id="a-key" placeholder="sk-…" value="${esc(cfg.apiKey || '')}" /></div>
      <div class="field"><label class="bl">模型名</label>
        <input class="input" id="a-model" placeholder="gpt-3.5-turbo" value="${esc(cfg.model || 'gpt-3.5-turbo')}" /></div>
      <div class="small muted">Key 仅保存在本地浏览器，由本机服务端代理转发，不会上传到别处。留空则不调用真实模型。</div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="saveAiSettings()">保存</button></div>`;
  $('#modal').classList.add('open');
}
function toggleConnector() { const v = $('#a-connector').value; $('#a-base').disabled = v === 'none'; $('#a-key').disabled = v === 'none'; }
function saveAiSettings() {
  const cfg = {
    connector: $('#a-connector').value,
    baseUrl: $('#a-base').value.trim(),
    apiKey: $('#a-key').value.trim(),
    model: $('#a-model').value.trim() || 'gpt-3.5-turbo',
  };
  saveAiConfig(cfg); closeModal(); toast('AI 接口已保存'); renderAi();
}

/* ============ 自动化 ============ */
const FEISHU_BASE = 'https://my.feishu.cn/base/JBGHbPAo8aiqKhs2wvuc9SS561g';
const FEISHU_FORM = 'https://my.feishu.cn/share/base/shrc6Znkx9ovrrKl0km1fIX5ZHc';
function renderAuto() {
  $('#view').innerHTML = `
    <div class="topbar"><div><h1>自动化</h1><div class="crumb">飞书多维表格 · 新客实时导入 · 提醒与汇总</div></div></div>
    <div class="grid cols-2">
      <div class="card pad">
        <div class="card-head"><h3>新客登记表（外部填写）</h3><span class="chip st-new">匿名可填</span></div>
        <p class="muted small" style="margin:0 0 12px">把链接发给客户 / 采集方，提交即实时写入新客台账。</p>
        <div class="copy-input" style="display:flex;gap:8px;align-items:center">
          <code class="code" id="form-code" style="flex:1;padding:9px 11px;white-space:nowrap;overflow:auto">${FEISHU_FORM}</code>
          <button class="btn btn-soft btn-sm" onclick="copy(FEISHU_FORM,'表单链接已复制')">复制</button>
        </div>
        <div style="margin-top:10px"><a class="link-ghost" href="${FEISHU_FORM}" target="_blank">打开表单预览 →</a></div>
      </div>
      <div class="card pad">
        <div class="card-head"><h3>新客台账（BASE）</h3><span class="chip st-done">已建</span></div>
        <p class="muted small" style="margin:0 0 12px">表：新客台账；字段：姓名 / 联系方式 / 来源 / 需求 / 状态 / 分层 / 备注 / 采集链接 / 承接时间。</p>
        <a class="link-ghost" href="${FEISHU_BASE}" target="_blank">打开多维表格 →</a>
      </div>
    </div>
    <div class="card pad" style="margin-top:14px">
      <div class="card-head"><h3>自动化流程</h3><span class="chip st-done">运行中</span></div>
      <div class="world">
        ${wf("新客实时提醒（含自动归一）", "新记录写入 → 自动回填承接时间 → 实时推送给本人，附「查看记录」按钮。", true)}
        ${wf("每日新客汇总推送", "每天 09:00 汇总当日新增新客，推送给本人。", true)}
      </div>
      <p class="small muted" style="margin:14px 0 0">说明：通知目标已绑定本人（冯振然）。网页内「新增新客」为本地演示数据；线上实时数据以飞书多维表格为准，本 Web 工作台可手工录入或由 AI/采集侧写入。</p>
    </div>`;
}
function wf(title, desc, active) {
  return `<div class="wcard"><span class="status-dot"></span><div style="flex:1">
    <h4>${title}</h4><p>${desc}</p></div>${active ? '<span class="chip st-done">已启用</span>' : '<span class="chip st-wait">停用</span>'}</div>`;
}

/* ============ 启动 ============ */
navigate(location.hash.slice(1) || 'overview');