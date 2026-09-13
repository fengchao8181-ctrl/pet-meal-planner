// 小程序页面事件流自检（模拟器之外的「真后端全流程」冒烟）
// 思路：shim 出 Page/wx/getApp，加载 miniprogram 三个页面文件，
// 用「事件处理器 → setData → 断言 data」的方式驱动：建档 → 生成 → 下单 → 支付。
// request.js 的 wx.request 委托到真实本地后端 127.0.0.1:3000，因此这同时验证了前后端契约。
// 运行：node test/miniprogram-flow.smoke.cjs   （需先 npm run dev）

const http = require('http');
const path = require('path');

const MP = path.resolve(__dirname, '..', 'miniprogram');
let fail = 0, pass = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  PASS  ' + msg); }
  else { fail++; console.log('  FAIL  ' + msg); }
}

// ---- shim：模拟微信运行时 ----
const navCalls = [];
const toastCalls = [];
const storage = {};
global.wx = {
  getStorageSync(key) { return storage[key] !== undefined ? storage[key] : ''; },
  setStorageSync(key, val) { storage[key] = val; },
  removeStorageSync(key) { delete storage[key]; },
  login(o) { if (o && o.success) o.success({ code: 'mock_code_' + Date.now() }); },
  request(o) {
    const base = '127.0.0.1:3000';
    const url = new URL(o.url);
    const payload = JSON.stringify(o.data);
    // 固定连本地 127.0.0.1:3000（后端监听 0.0.0.0，本机必达），不受 config.BASE_URL 真机 IP 影响
    const req = http.request({
      host: '127.0.0.1',
      port: 3000,
      path: url.pathname + url.search,
      method: o.method || 'GET',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let body = null; try { body = JSON.parse(buf); } catch (_) {}
        if (o.success) o.success({ statusCode: res.statusCode, data: body });
      });
    });
    req.on('error', (e) => { if (o.fail) o.fail({ errMsg: e.message }); });
    if (payload && o.data) req.write(payload);
    req.end();
  },
  navigateTo(o) { navCalls.push(o.url); },
  navigateBack() { navCalls.push('__back__'); },
  showToast(o) { toastCalls.push(o && o.title); }
};

// ---- shim：App / Page / getApp ----
const app = { globalData: {} };
global.App = (cfg) => { Object.assign(app, cfg); };
let currentPageCfg = null;
global.Page = (cfg) => { currentPageCfg = cfg; };
global.getApp = () => app;

// 模拟 setData（支持 'a.b.c' 点路径键）
function applyPath(target, key, val) {
  const seg = key.split('.');
  let t = target;
  for (let i = 0; i < seg.length - 1; i++) {
    if (typeof t[seg[i]] !== 'object' || t[seg[i]] === null) t[seg[i]] = {};
    t = t[seg[i]];
  }
  t[seg[seg.length - 1]] = val;
}
function makeInstance(cfg) {
  const inst = Object.assign({}, cfg);
  inst.data = JSON.parse(JSON.stringify(cfg.data || {}));
  inst.setData = function (patch, cb) {
    Object.keys(patch).forEach((k) => applyPath(this.data, k, patch[k]));
    if (cb) cb();
  };
  return inst;
}
function loadPage(rel) {
  currentPageCfg = null;
  const full = path.join(MP, rel);
  if (require.cache[require.resolve(full)]) delete require.cache[require.resolve(full)];
  require(full);
  if (!currentPageCfg) throw new Error('加载页面未捕获 Page 配置：' + rel);
  return makeInstance(currentPageCfg);
}
function fire(inst, method, ev) {
  return inst[method].call(inst, ev);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, timeoutMs, stepMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeoutMs || 6000)) {
    if (cond()) return true;
    await sleep(stepMs || 60);
  }
  return cond();
}

(async () => {
  console.log('【1】加载 app.js'); require(path.join(MP, 'app.js'));

  console.log('【2】问诊建档页 index：填表 → 下一步 → 模式B+标签 → 生成');
  const index = loadPage('pages/index/index.js');
  fire(index, 'onFormInput', { currentTarget: { dataset: { key: 'petName' } }, detail: { value: '麦麦' } });
  fire(index, 'onFormInput', { currentTarget: { dataset: { key: 'breed' } }, detail: { value: '金毛' } });
  fire(index, 'onFormInput', { currentTarget: { dataset: { key: 'weightKg' } }, detail: { value: '11' } });
  fire(index, 'onFormInput', { currentTarget: { dataset: { key: 'ageMonths' } }, detail: { value: '26' } });
  fire(index, 'onProfileNext', {});
  ok(index.data.step === 2, '体重/月龄校验通过后进入步骤2（data.step=2，实际=' + index.data.step + '）');
  fire(index, 'onModeTap', { currentTarget: { dataset: { mode: 'B' } } });
  fire(index, 'onLabelInput', { currentTarget: { dataset: { key: 'proteinPct' } }, detail: { value: '30' } });
  fire(index, 'onLabelInput', { currentTarget: { dataset: { key: 'kcalPer100g' } }, detail: { value: '380' } });
  await fire(index, 'onGenerate', {});
  await waitFor(() => !!app.globalData.plan, 8000);
  ok(!index.data.error, '生成餐单无错误（error=' + JSON.stringify(index.data.error) + '）');
  ok(!!app.globalData.plan, 'globalData.plan 已由后端写入');
  ok(navCalls.indexOf('/pages/result/result') >= 0, '生成后跳转 /pages/result/result');

  console.log('【3】餐单结果页 result：渲染模型');
  const result = loadPage('pages/result/result.js');
  fire(result, 'onLoad', {});
  const m = result.data.m;
  ok(!!m, '渲染模型 m 生成');
  if (m) {
    ok(m.derKcal > 0, 'DER 热量渲染（derKcal=' + m.derKcal + '）');
    ok(!!m.kibble, '主粮建议渲染（kibble 存在）');
    ok(!!m.kibble.summary, '主粮类型建议文案存在');
    ok(Array.isArray(m.supplement) && m.supplement.length > 0, '辅食配方渲染（' + (m.supplement || []).length + ' 项）');
    ok(m.freshMeals === null || Array.isArray(m.freshMeals), '模式B freshMeals 安全降级为 null/数组');
  }

  console.log('【4】订阅下单页 subscribe：加载 SKU → 下单 → 支付回调');
  const sub = loadPage('pages/subscribe/subscribe.js');
  await fire(sub, 'onLoad', {});
  await waitFor(() => sub.data.skus.length > 0, 6000);
  ok(sub.data.skus.length > 0, 'SKU 列表加载（' + sub.data.skus.length + ' 个）');
  ok(!!sub.data.selected && !!sub.data.selected.perksText, '默认 SKU 选中且 perksText 已预生成');
  await fire(sub, 'onCreateOrder', {});
  await waitFor(() => !!sub.data.order, 8000);
  ok(!!sub.data.order, '创建订单（order 存在）');
  ok(!!sub.data.order.displayId && !!sub.data.order.priceYuanText, '展示字段 displayId/priceYuanText 预生成');
  ok(!!sub.data.payment, 'Stub 支付参数生成（payment.paymentId）');
  ok(sub.data.payDisabled === false, '待支付态按钮可用（payDisabled=false）');
  await fire(sub, 'onPay', {});
  await waitFor(() => sub.data.order && sub.data.order.status === 'paid', 8000);
  ok(sub.data.order.status === 'paid', '支付回调后状态为 paid（实际=' + sub.data.order.status + '）');
  ok(sub.data.payDisabled === true, '支付成功后按钮禁用（payDisabled=true）');
  ok(toastCalls.some((t) => /已支付/.test(t)), '支付成功 toast 触发');

  console.log('【5】P0 优化验证：默认预填 + 按钮选择 + 免填生成');
  const idx2 = loadPage('pages/index/index.js');
  ok(idx2.data.labelForm.proteinPct === 30 && idx2.data.labelForm.kcalPer100g === 380,
    '主粮标签默认预填（蛋白30/脂肪16/纤维4/热量380）');
  ok(idx2.data.lifeStageIndex === 1 && idx2.data.activityIndex === 1, '生命阶段/活动量默认选中（成犬/中）');
  fire(idx2, 'onLifeStageSelect', { currentTarget: { dataset: { idx: 0 } } });
  fire(idx2, 'onActivitySelect', { currentTarget: { dataset: { idx: 2 } } });
  ok(idx2.data.lifeStageIndex === 0 && idx2.data.activityIndex === 2, '按钮组选择生命阶段/活动量生效');
  ok(idx2.data.stageOptionList.length === 3 && idx2.data.activityOptionList.length === 3, '选项列表提供给模板渲染');
  // 免填标签：仅填体重+月龄，用默认预填标签也能通过校验并生成（模拟"用户不调整主粮"）
  const idx3 = loadPage('pages/index/index.js');
  fire(idx3, 'onFormInput', { currentTarget: { dataset: { key: 'weightKg' } }, detail: { value: '9' } });
  fire(idx3, 'onFormInput', { currentTarget: { dataset: { key: 'ageMonths' } }, detail: { value: '20' } });
  fire(idx3, 'onProfileNext', {});
  ok(idx3.data.step === 2, '仅体重+月龄也进入步骤2（保留默认生命阶段/活动量）');
  const rawDefault = {
    weightKg: idx3.data.form.weightKg, ageMonths: idx3.data.form.ageMonths,
    lifeStage: 'adult', activity: 'mid', feedingMode: 'B',
    kibbleLabel: { proteinPct: 30, kcalPer100g: 380 }
  };
  ok(require(path.join(MP, 'utils/profile.js')).validateProfile(rawDefault).length === 0,
    '预填默认标签通过校验（用户零输入营养值亦可生成）');

  console.log('【6】餐单结果页 lockedPerks（订阅解锁占位）');
  const res2 = loadPage('pages/result/result.js');
  ok(Array.isArray(res2.data.lockedPerks) && res2.data.lockedPerks.length === 4, '订阅解锁 perks 列表（4 项）');

  console.log('【7】P1 转化优化验证：建档进度条 + 订阅折扣锚点');
  const idx4 = loadPage('pages/index/index.js');
  ok(Array.isArray(idx4.data.stepsList) && idx4.data.stepsList.length === 3, '建档步骤进度条 3 步（宠物档案/喂养方式/生成餐单）');
  ok(idx4.data.stepsList[1].label === '喂养方式' && idx4.data.stepsList[2].label === '生成餐单', '进度条步骤文案正确');
  fire(idx4, 'onFormInput', { currentTarget: { dataset: { key: 'weightKg' } }, detail: { value: '8' } });
  fire(idx4, 'onFormInput', { currentTarget: { dataset: { key: 'ageMonths' } }, detail: { value: '12' } });
  fire(idx4, 'onProfileNext', {});
  ok(idx4.data.step === 2, '下一步后 step=2（进度条高亮切到「喂养方式」）');

  const orderUtil = require(path.join(MP, 'utils/order.js'));
  const q = orderUtil.decorateSku({ id: 'sub_quarterly', name: '季订阅', priceFen: 8400, periodDays: 90, desc: '', perks: [] });
  ok(q.origText === '¥120' && q.savedYuan === 36 && /7 折/.test(q.discountText),
    '季卡折扣锚点：划线原价¥120 / 约7折 / 立省¥36');
  const mb = orderUtil.decorateSku({ id: 'sub_monthly_basic', name: '标准月订阅', priceFen: 3000, periodDays: 30, desc: '', perks: [] });
  ok(mb.origText === '' && mb.discountText === '', '30 天月卡不展示折扣锚点（避免虚假折扣）');

  console.log('【8】留存：「有爱」每日打卡 → 健康周报 全链路');
  // result 页已有「去打卡」入口
  fire(result, 'goCheckin', {});
  ok(navCalls.indexOf('/pages/checkin/checkin') >= 0, '结果页「去打卡」跳转 /pages/checkin/checkin');

  // 打卡页：载入 → 选出心情 → 打卡 → 网格+连续天数更新
  // 用本轮唯一宠名隔离数据：避免长驻 dev server 里今日已打卡导致「已打卡」短路，
  // 确保「点打卡 → 出反馈」这条强断言在重复运行时也稳定可复现
  const uniqPetName = '测' + Date.now().toString().slice(-6);
  app.globalData.plan = Object.assign({}, app.globalData.plan, { pet: Object.assign({}, app.globalData.plan.pet, { name: uniqPetName }) });
  const ck = loadPage('pages/checkin/checkin.js');
  fire(ck, 'onLoad', {});
  ok(!!ck.data.petKey && !!ck.data.today, '打卡页 petKey/today 已初始化（' + ck.data.petKey + '）');
  await waitFor(() => ck.data.grid.length === 7, 8000);
  ok(ck.data.grid.length === 7, '最近 7 天打卡网格渲染');
  ok(ck.data.grid.filter((g) => g.isToday).length === 1, '网格含且仅含今日格');
  fire(ck, 'onMoodSelect', { currentTarget: { dataset: { key: 'happy' } } });
  ok(ck.data.selMood === 'happy', '心情一戳选中 happy');
  fire(ck, 'onCheckin', {});
  await waitFor(() => ck.data.checked === true, 8000);
  ok(ck.data.checked, '打卡成功后 checked=true');
  ok(ck.data.streak >= 1, '连续天数随打卡更新（streak=' + ck.data.streak + '）');
  ok(!!ck.data.feedback, '打卡后情绪反馈文案存在');

  // 周报页：加载本周报告 + 历史
  const rp = loadPage('pages/report/report.js');
  fire(rp, 'onLoad', { petKey: encodeURIComponent(ck.data.petKey), petName: encodeURIComponent('麦麦') });
  await waitFor(() => !!rp.data.m, 8000);
  ok(!!rp.data.m, '周报渲染模型 m 生成');
  ok(rp.data.m.loveScore >= 0 && rp.data.m.loveScore <= 100, '用心值 loveScore 在 0-100（' + rp.data.m.loveScore + '）');
  ok(rp.data.m.checkRate >= 0, '本周打卡完成率渲染（' + rp.data.m.checkRate + '%）');
  ok(!!rp.data.m.summary, '情感化小结存在');
  ok(!!rp.data.m.breakdown, '用心值口径文本可展开');
  await waitFor(() => rp.data.history.length >= 1, 8000);
  ok(rp.data.history.length >= 1, '历史周报列表已返回（' + rp.data.history.length + ' 条）');

  console.log('\n==== 结果 ====');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });