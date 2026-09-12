(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const steps = { 1: $('#step1'), 2: $('#step2'), 3: $('#step3') };
  let current = 1;
  let selectedMode = 'B';
  const state = { profile: {}, profileId: null };

  function showStep(n) {
    current = n;
    Object.entries(steps).forEach(([k, el]) => { el.hidden = Number(k) !== n; });
    $('#stepBadge').textContent = `${n} / 3`;
    document.querySelectorAll('.step-dot').forEach((d) => {
      d.classList.toggle('active', Number(d.dataset.step) <= n);
    });
    window.scrollTo({ top: 0 });
  }

  function showError(msg) {
    const bar = $('#errorBar');
    bar.textContent = msg;
    bar.hidden = !msg;
  }

  // 步骤 1：档案
  $('#profileForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    state.profile = {
      petName: fd.get('petName') || '',
      breed: fd.get('breed') || '',
      weightKg: Number(fd.get('weightKg')),
      ageMonths: Number(fd.get('ageMonths')),
      lifeStage: fd.get('lifeStage'),
      activity: fd.get('activity'),
      neutered: fd.get('neutered') === 'true',
      allergies: fd.getAll('allergies')
    };
    if (!(state.profile.weightKg > 0) || !(state.profile.ageMonths > 0)) {
      showError('请填写有效的体重与月龄');
      return;
    }
    showError('');
    showStep(2);
  });

  // 步骤 2：模式选择
  const cards = document.querySelectorAll('.mode-card');
  cards.forEach((card) => {
    card.addEventListener('click', () => {
      selectedMode = card.dataset.mode;
      cards.forEach((c) => c.classList.toggle('selected', c === card));
      $('#labelForm').hidden = selectedMode === 'A';
    });
  });
  cards[0].classList.add('selected');

  $('#backToStep1').addEventListener('click', () => showStep(1));
  $('#restartBtn').addEventListener('click', () => location.reload());

  $('#generateBtn').addEventListener('click', async () => {
    const payload = {
      ...state.profile,
      feedingMode: selectedMode
    };
    if (selectedMode !== 'A') {
      const fd = new FormData($('#labelForm'));
      const label = {
        proteinPct: fd.get('proteinPct') ? Number(fd.get('proteinPct')) : null,
        fatPct: fd.get('fatPct') ? Number(fd.get('fatPct')) : null,
        fiberPct: fd.get('fiberPct') ? Number(fd.get('fiberPct')) : null,
        kcalPer100g: fd.get('kcalPer100g') ? Number(fd.get('kcalPer100g')) : null,
        grainFree: fd.get('grainFree') === 'on',
        avoidSources: fd.getAll('avoid')
      };
      if (label.proteinPct === null && label.kcalPer100g === null) {
        showError('模式 B/C 请至少填写主粮「粗蛋白」或「热量」一项（用于类型建议与克数换算）');
        return;
      }
      payload.kibbleLabel = label;
    }

    const btn = $('#generateBtn');
    btn.disabled = true;
    btn.textContent = '生成中…';
    showError('');
    try {
      const res = await fetch('/api/plans/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || '生成失败');
      renderPlan(data.plan);
      showStep(3);
    } catch (err) {
      showError(err.message || '网络错误，请重试');
    } finally {
      btn.disabled = false;
      btn.textContent = '生成我的餐单';
    }
  });

  function renderPlan(plan) {
    const el = $('#planResult');
    const parts = [];
    parts.push(`<div class="result-title">${plan.pet.name} 的${plan.modeLabel}餐单</div>`);
    parts.push(`<p class="result-sub">${plan.pet.breed} · ${plan.pet.weightKg}kg · ${plan.pet.bodyType}体型 · ${plan.pet.stage} · 规则引擎 v${plan.ruleVersion}</p>`);
    parts.push(`<div class="kcal-row"><span>每日所需热量（DER）</span><b>${plan.derKcal} kcal</b></div>`);

    if (plan.kibble) {
      parts.push('<div class="block"><h3>🍚 主粮建议（只给类型，不推荐品牌）</h3>');
      if (plan.kibble.typeAdvice) {
        parts.push('<div class="advice-card"><div>' + esc(plan.kibble.typeAdvice.summary) + '</div><ul>');
        plan.kibble.typeAdvice.tips.forEach((t) => parts.push('<li>' + esc(t) + '</li>'));
        parts.push('</ul></div>');
      }
      if (plan.kibble.gramsPerDay) {
        parts.push(`<p class="note">按标签热量换算，主粮建议每日 <b>${plan.kibble.gramsPerDay} g</b>（约占总热量 ${plan.mode === 'B' ? '90%' : '70%'}）</p>`);
      }
      parts.push('</div>');
    }

    if (plan.supplement && plan.supplement.length > 0) {
      parts.push('<div class="block"><h3>🥗 每周辅食配方（约占总热量 10%）</h3>');
      parts.push('<table class="plan-table"><thead><tr><th>食材</th><th>每日克数</th><th>功能方向</th></tr></thead><tbody>');
      plan.supplement.forEach((s) => {
        parts.push(`<tr><td>${esc(s.name)}</td><td><b>${s.grams} g</b></td><td>${purposeLabel(s.purpose)}</td></tr>`);
      });
      parts.push('</tbody></table></div>');
    }

    if (plan.freshMeals) {
      const isPure = plan.mode === 'A';
      parts.push(`<div class="block"><h3>${isPure ? '🍖 每日鲜食配方' : '🥘 鲜食顿次配方（每周 ' + plan.freshMeals.length + ' 种搭配）'}</h3>`);
      parts.push('<table class="plan-table"><thead><tr><th>食材</th><th>克数</th><th>热量</th></tr></thead><tbody>');
      plan.freshMeals.forEach((m) => {
        parts.push(`<tr><td>${esc(m.name)}</td><td><b>${m.grams} g</b></td><td>${m.kcal} kcal</td></tr>`);
      });
      parts.push('</tbody></table></div>');
    }

    if (plan.warnings && plan.warnings.length > 0) {
      plan.warnings.forEach((w) => parts.push(`<div class="warn">⚠️ ${esc(w)}</div>`));
    }

    parts.push(`<p class="note">本餐单由规则引擎生成（可审计），正式执行前建议经执业兽医师审核；辅食食材均经过犬安全黑名单校验。</p>`);
    parts.push(`<details class="audit"><summary>查看审计决策链（${plan.decisions.length} 条规则）</summary><pre>${esc(JSON.stringify(plan.decisions, null, 2))}</pre></details>`);
    el.innerHTML = parts.join('');
  }

  function purposeLabel(p) {
    return { joint: '关节', skin: '皮肤毛发', gut: '肠胃', none: '常规' }[p] || p;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
})();
