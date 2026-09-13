// 运营看板：读取后端 /api/stats 渲染北极星漏斗。数据为服务端白名单埋点，仅做展示，无业务写入。

(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const AUTH_KEY = 'dash_admin_key';

  const ORDER = ['profile_created', 'plan_generated', 'order_created', 'order_paid'];
  const STEP_LABEL = {
    profile_created: '建档',
    plan_generated: '生成餐单',
    order_created: '创建订阅订单',
    order_paid: '支付成功'
  };
  const STEP_COLOR = ['#0a84ff', '#30b4ff', '#64d2ff', '#22c88a'];
  const MOOD = { happy: '开心', sleepy: '犯困', proud: '傲娇', calm: '安静', naughty: '闹腾' };

  function pct(a, b) {
    if (!b) return '—';
    return ((a / b) * 100).toFixed(0) + '%';
  }

  async function load() {
    const errbar = $('#errBar');
    errbar.style.display = 'none';
    const headers = {};
    const key = sessionStorage.getItem(AUTH_KEY) || '';
    if (key) headers['X-Admin-Key'] = key;
    try {
      const res = await fetch('/api/stats', { headers });
      if (res.status === 401) {
        const input = $('#adminkey').value.trim();
        if (!input) throw new Error('该服务已启用管理密钥，请在上方输入 INTERNAL_KEY 后刷新（浏览器会记住本次会话）');
        sessionStorage.setItem(AUTH_KEY, input);
        return load();
      }
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || '加载失败');
      render(data);
    } catch (e) {
      errbar.style.display = 'block';
      errbar.textContent = '看板加载失败：' + e.message;
    }
  }

  function render(d) {
    const c = d.counters || {};
    const n = (k) => c[k] || 0;
    $('#updatedAt').textContent = '更新于 ' + new Date().toLocaleString('zh-CN');

    // 漏斗
    const funnel = $('#funnel');
    funnel.textContent = '';
    const steps = ORDER.map((k) => n(k));
    const peak = Math.max(1, ...steps);
    ORDER.forEach((k, i) => {
      const val = n(k);
      const el = document.createElement('div');
      el.className = 'fstep';
      el.style.width = pct(val, peak) === '—' ? '100%' : (val / peak) * 100 + '%';
      el.style.background = STEP_COLOR[i];
      const span = document.createElement('span');
      span.textContent = (STEP_LABEL[k] || k) + '：';
      const cnt = document.createElement('span');
      cnt.className = 'cnt';
      cnt.textContent = val;
      const rate = document.createElement('span');
      rate.className = 'rate';
      rate.textContent = i === 0 ? '（基础）' : '较上一步 ' + pct(val, steps[i - 1]);
      el.appendChild(span); el.appendChild(cnt); el.appendChild(rate);
      funnel.appendChild(el);
    });

    // 卡片指标
    const paid = n('order_paid'), created = n('profile_created');
    $('#cardRetain').innerHTML = '<h3>档案 → 付费 转化率</h3><div class="big">' + pct(paid, created) + '</div>' +
      '<p class="muted">支付成功 ' + paid + ' / 建档 ' + created + '</p>';

    const checkin = n('checkin_created');
    $('#cardCheckin').innerHTML = '<h3>建档拉动的打卡次数</h3><div class="big">' + checkin + '</div>' +
      '<p class="muted">单用户日均 1 次为满勤</p>';

    const sub = n('push_subscribe'), sent = n('push_daily_sent');
    $('#cardPush').innerHTML = '<h3>每日推送</h3><div class="big">' + sent + ' 触达</div>' +
      '<p class="muted">订阅 ' + sub + ' · 失败 ' + n('push_daily_error') + '</p>';

    // 客单价：用最近 order_paid 估算需 sku；stats 无金额，此处展示订单数
    $('#cardOrder').innerHTML = '<h3>订阅订单</h3><div class="big">' + n('order_created') + ' 笔</div>' +
      '<p class="muted">支付率 ' + pct(paid, n('order_created')) + '</p>';

    // 推送日志
    const logs = d.pushLogs || [];
    const pl = $('#pushLog');
    if (logs.length) {
      pl.innerHTML = '<h3>推送日志（最近 ' + logs.length + ' 条）</h3><ul>' +
        logs.map((l) => {
          const t = (l.at || '').replace('T', ' ').replace(/\.\d+Z$/, '');
          return '<li>[<span>' + esc(t) + '</span>] ' + esc(l.petKey || '') + ' · ' + esc(l.scene || l.action || '') +
            (l.status ? ' · ' + esc(l.status) : '') + '</li>';
        }).join('') + '</ul>';
    } else {
      pl.innerHTML = '<h3>推送日志</h3><p class="muted">暂无（订阅后可触发）</p>';
    }

    // 最近事件明细
    let table = '';
    if (d.recent && d.recent.length) {
      table = '<table><thead><tr><th>时间</th><th>事件</th><th>详情</th></tr></thead><tbody>' +
        d.recent.map((e) => {
          const meta = Object.keys(e.meta || {})
            .map((k) => k + '=' + e.meta[k])
            .join(' ');
          return '<tr><td>' + esc(shortTs(e.at)) + '</td><td>' + esc(e.name) + '</td><td class="muted">' + esc(meta) + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
    $('#recent').innerHTML = '<h3>最近事件明细</h3>' + (table || '<p class="muted">暂无</p>');
  }

  function shortTs(iso) {
    const s = String(iso || '');
    return s.replace('T', ' ').replace(/\.\d+Z$/, '');
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  $('#reloadBtn').addEventListener('click', load);
  load();
  // 看板自动刷新（30s），便于接入屏展示
  setInterval(load, 30000);
})();