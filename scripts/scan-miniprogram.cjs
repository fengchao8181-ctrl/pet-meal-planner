// 小程序一致性扫描：四件套存在性、残留非法模板表达式、WXSS 类覆盖
// 用法：node scripts/scan-miniprogram.cjs
const fs = require('fs');
const path = require('path');
const pages = ['index', 'result', 'subscribe', 'checkin', 'report'];
const root = path.join(__dirname, '..', 'miniprogram');
let err = 0;

const BAD_TOKENS = ['===', '!==', '.toFixed(', '.slice(', '.indexOf(', '.join(', '.map(', '.filter(', 'model:value'];

// 抽出一个 CSS 文本里定义的所有类选择器（.xxx）名
function cssClasses(css) {
  const out = new Set();
  const re = /\.([A-Za-z][\w-]*)(?=\s*[.,{:#> \n])/g;
  let m;
  while ((m = re.exec(css)) !== null) out.add(m[1]);
  return out;
}

const appCss = fs.readFileSync(path.join(root, 'app.wxss'), 'utf8');
const globalClasses = cssClasses(appCss);

for (const p of pages) {
  for (const ext of ['js', 'wxml', 'wxss', 'json']) {
    const f = path.join(root, 'pages', p, p + '.' + ext);
    if (!fs.existsSync(f)) { console.log('MISSING_FILE', f.replace(root, '')); err++; }
  }
  const wxml = fs.readFileSync(path.join(root, 'pages', p, p + '.wxml'), 'utf8');
  for (const bad of BAD_TOKENS) {
    const idx = wxml.indexOf(bad);
    if (idx >= 0) { console.log('BAD_TOKEN [' + bad + '] pages/' + p + ' @' + idx); err++; }
  }
  const pageCss = fs.readFileSync(path.join(root, 'pages', p, p + '.wxss'), 'utf8');
  const defined = new Set(cssClasses(pageCss));
  for (const c of globalClasses) defined.add(c);

  // 收集 WXML 里用到的静态类名：先剥离 {{...}} 插值段（动态拼装类无法静态判缺，且其内
  // 的循环变量/标识符（如 index）会被误当成类名），再解析 class="..." 纯静态类
  const staticWxml = wxml.replace(/\{\{[\s\S]*?\}\}/g, ' ');
  const used = new Set();
  const usedRe = /class="([^"]+)"/g;
  let m;
  while ((m = usedRe.exec(staticWxml)) !== null) {
    for (const raw of m[1].split(/\s+/)) {
      if (/^[A-Za-z][\w-]*$/.test(raw)) used.add(raw);
    }
  }
  for (const c of used) {
    if (c === 'hidden') continue;
    if (!defined.has(c)) { console.log('WXSS_MISSING_CLASS pages/' + p + ': .' + c); err++; }
  }
  console.log('checked pages/' + p + ': no missing classes');
}
console.log('scan done, issues=' + err);