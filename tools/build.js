#!/usr/bin/env node
/*
 * data/content.json をもとに、次のファイルを作り直します。
 *   - index.html の OGP（SNSで表示されるタイトル・説明・画像）
 *   - r/<タイプ>.html … タイプ別の結果ページ（シェアされたリンクの先）
 *   - assets/ogp/*.png … OGP画像（1200×630）
 *   - assets/qr/*.png, *.svg … QRコード（保育博用・SNS用）
 *   - assets/opt/*.webp … 画面に表示する軽い画像（元の PNG を縮小して WebP にしたもの）
 *   - sw.js の保存ファイル一覧と版（電波が切れても診断を続けられるように端末に保存するファイル）
 *
 * 使い方:  npm run build            （すべて）
 *          npm run build -- --no-images   （HTMLだけ。画像を作らない）
 */
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const http = require('http');
const { validate } = require('./validate');
const D = require('../js/diagnosis');

const ROOT = path.resolve(__dirname, '..');
const C = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/content.json'), 'utf8'));
const args = process.argv.slice(2);
const withImages = !args.includes('--no-images');

const siteUrl = C.site.url.endsWith('/') ? C.site.url : C.site.url + '/';

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function write(rel, data) {
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  console.log('  書き出し:', rel);
}

function ogpTags({ title, description, url, image }) {
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="フクマナ">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:image" content="${esc(image)}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta name="twitter:card" content="summary_large_image">`
  ].join('\n');
}

function footerHtml() {
  const L = C.links, F = C.footer;
  return `<footer class="site-footer">
  <p><a href="${esc(L.top)}" target="_blank" rel="noopener">フクマナ（福祉経営を学ぶeラーニング）</a></p>
  <p>${esc(F.operator)}</p>
  <p>${esc(F.contactLabel)} <a href="mailto:${esc(L.contactEmail)}">${esc(L.contactEmail)}</a></p>${analyticsId() && F.analyticsNote ? `
  <p class="site-footer__note">${esc(F.analyticsNote)}</p>` : ''}
</footer>`;
}

// ---------- アクセス解析（GA4） ----------
function analyticsId() {
  return (C.analytics && C.analytics.measurementId) || '';
}

/**
 * GA4 のタグ。回答内容は送らない（送るイベントは js/app.js の track() と README「アクセス解析」）。
 * - 手元（localhost）で開いたときは Google に送信しない（テストや確認でデータが混ざらないように）
 * - URL の ?src=hoikuhaku などを、GA4 の「参照元」（utm_source）として記録する
 */
function analyticsTag() {
  const id = analyticsId();
  if (!id) return '<!-- アクセス解析なし（data/content.json の analytics.measurementId が空） -->';
  return `<script>
  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  (function () {
    var local = location.protocol === 'file:' || /^(localhost|127\\.0\\.0\\.1|\\[::1\\])$/.test(location.hostname);
    if (!local) {
      // 画面の表示を優先し、ページの読み込みが終わってから計測用のスクリプトを読み込む。
      // それまでの記録（ページの表示・診断の開始など）は dataLayer にたまり、読み込み後にまとめて送られる
      var load = function () {
        var s = document.createElement('script');
        s.async = true;
        s.src = 'https://www.googletagmanager.com/gtag/js?id=${id}';
        document.head.appendChild(s);
      };
      if (document.readyState === 'complete') load(); else window.addEventListener('load', load);
    }
    var cfg = {};
    try {
      var u = new URL(location.href);
      var src = u.searchParams.get('src');
      if (src && /^[a-z0-9_-]{1,40}$/.test(src) && !u.searchParams.get('utm_source')) {
        u.searchParams.set('utm_source', src);
        u.searchParams.set('utm_medium', 'qr');
        cfg.page_location = u.href;
      }
    } catch (e) { /* 古いブラウザでは参照元の付け替えをしない */ }
    gtag('js', new Date());
    gtag('config', '${id}', cfg);
  })();
</script>`;
}

// top=true：「福祉経営を学ぶなら フクマナ」（トップ画面）、false：「フクマナ」のみ（設問・結果）
function logoTag(prefix, top) {
  return top
    ? `<img src="${prefix}${esc(C.images.logoTop)}" alt="福祉経営を学ぶなら フクマナ" class="site-header__logo">`
    : `<img src="${prefix}${esc(C.images.logo)}" alt="フクマナ" class="site-header__logo site-header__logo--simple">`;
}

// ---------- 画面用の軽い画像（assets/opt/*.webp） ----------
// 表示サイズの約3倍（スマホの高精細な画面でもぼやけない大きさ）に縮小し、WebP にする
const OPT_SIZE = { mascot: 720, logo: 420, icon: 300 };
// 画質（1 は劣化なし）。アイコンは結果画像の中で白い背景との境目を見分けるため劣化なしにする
const OPT_QUALITY = { mascot: 0.85, logo: 0.9, icon: 1 };
function optName(file) { return 'assets/opt/' + file.replace(/\.png$/i, '.webp'); }
function appImages() {
  const I = C.images;
  const list = [
    { file: I.logo, kind: 'logo' }, { file: I.logoTop, kind: 'logo' }, { file: I.icon, kind: 'icon' },
    { file: I.top, kind: 'mascot' }, { file: I.basicQuestion, kind: 'mascot' }, { file: I.question, kind: 'mascot' }
  ];
  Object.values(C.roles).forEach((r) => r.questions.forEach((q) => { if (q.mascot) list.push({ file: q.mascot, kind: 'mascot' }); }));
  Object.values(C.types).forEach((t) => list.push({ file: t.mascot, kind: 'mascot' }));
  const seen = new Set();
  return list.filter((x) => x.file && !seen.has(x.file) && seen.add(x.file));
}
// WebP を表示できる端末は WebP、できない端末は元の PNG。
// inline=true のときは WebP を HTML に埋め込む（トップ画面のフクノネコ。通信を1回減らして早く表示するため）
function pictureTag(prefix, file, imgAttrs, inline) {
  const src = inline
    ? 'data:image/webp;base64,' + fs.readFileSync(path.join(ROOT, optName(file))).toString('base64')
    : prefix + optName(file).replace(/^assets\//, '');
  return `<picture><source srcset="${esc(src)}" type="image/webp"><img src="${prefix}${esc(file)}" ${imgAttrs}></picture>`;
}

function groupIds() {
  return Object.keys(C.groups).filter((k) => !k.startsWith('_'));
}

// ---------- index.html の OGP ----------
function buildIndex() {
  const file = path.join(ROOT, 'index.html');
  const html = fs.readFileSync(file, 'utf8');
  const block = ogpTags({
    title: C.site.title,
    description: C.site.description,
    url: siteUrl,
    image: siteUrl + 'assets/ogp/top.png'
  });
  const re = /(<!-- OGP:START[^>]*-->\n)[\s\S]*?(\n<!-- OGP:END -->)/;
  if (!re.test(html)) throw new Error('index.html に OGP:START / OGP:END の目印が見つかりません');
  const header = `  <a class="site-header__brand" href="${esc(C.links.top)}" target="_blank" rel="noopener">
    ${pictureTag('assets/', C.images.logoTop, 'alt="福祉経営を学ぶなら フクマナ" class="site-header__logo"')}
  </a>`;
  // トップ画面（JavaScript の読み込みを待たずに表示する。js/app.js が起動したらボタンが使えるようになる）
  const top = D.topHtml(C,
    pictureTag('assets/', C.images.top, 'class="mascot mascot--top" alt="フクマナ公式キャラクター フクノネコ" width="240" height="240"', true),
    ` data-static data-label="${esc(C.top.start)}" onclick="window.__startPending=true;this.disabled=true;this.textContent='準備中…'"`);
  // 見た目（css/style.css）を埋め込む
  const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8').replace(/<\/style/gi, '<\\/style');
  const reStyle = /(<!-- STYLE:START[^>]*-->\n)[\s\S]*?(<!-- STYLE:END -->)/;
  if (!reStyle.test(html)) throw new Error('index.html に STYLE:START / STYLE:END の目印が見つかりません');
  const reTop = /(<!-- TOP:START[^>]*-->\n)[\s\S]*?(\n?<!-- TOP:END -->)/;
  if (!reTop.test(html)) throw new Error('index.html に TOP:START / TOP:END の目印が見つかりません');
  const reHeader = /(<!-- HEADER:START[^>]*-->\n)[\s\S]*?(\n<!-- HEADER:END -->)/;
  if (!reHeader.test(html)) throw new Error('index.html に HEADER:START / HEADER:END の目印が見つかりません');
  const reGa = /(<!-- ANALYTICS:START[^>]*-->\n)[\s\S]*?(\n<!-- ANALYTICS:END -->)/;
  if (!reGa.test(html)) throw new Error('index.html に ANALYTICS:START / ANALYTICS:END の目印が見つかりません');
  write('index.html', html.replace(re, (_, a, b) => a + block + b).replace(reHeader, (_, a, b) => a + header + b)
    .replace(reGa, (_, a, b) => a + analyticsTag() + b).replace(reTop, (_, a, b) => a + top + '\n' + b.replace(/^\n/, ''))
    .replace(reStyle, (_, a, b) => a + '<style>\n' + css.trim() + '\n</style>\n' + b));
}

// ---------- タイプ別結果ページ ----------
function buildTypePage(id) {
  const t = C.types[id];
  const S = C.sharePage;
  const desc = D.fill(t.description, D.GENERIC_FIELD);
  // 「診断でわかる9つのタイプ」をグループごとにまとめ、グループの色で表示（見出しなし・グループ間に余白）
  const others = groupIds().map((gid) => {
    const grp = C.groups[gid];
    const items = Object.keys(C.types).filter((k) => C.types[k].group === gid).map((k) =>
      `<li><a href="${esc(k)}.html" style="--type-color:${esc(grp.color)};--type-accent:${esc(grp.accent)}"${k === id ? ' aria-current="page"' : ''}>${esc(C.types[k].name)}</a></li>`
    ).join('\n            ');
    return `<div class="type-group" data-group="${esc(gid)}">
          <ul class="types-list">
            ${items}
          </ul>
        </div>`;
  }).join('\n        ');

  const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#005660">
<!-- このファイルは tools/build.js が自動生成します。直接編集せず data/content.json を編集してください。 -->
${ogpTags({
  title: `${t.name}｜${C.site.title}`,
  description: `${D.plain(t.catch)}${D.plain(desc)}`,
  url: `${siteUrl}r/${id}.html`,
  image: `${siteUrl}assets/ogp/${id}.png`
})}
${analyticsTag()}
<link rel="icon" href="../assets/favicon.png">
<link rel="stylesheet" href="../css/style.css">
<link rel="preconnect" href="https://fonts.googleapis.com" crossorigin>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@500;700&display=swap" crossorigin media="print" onload="this.media='all'">
</head>
<body>
<header class="site-header">
  <a class="site-header__brand" href="${esc(C.links.top)}" target="_blank" rel="noopener">
    ${logoTag('../assets/', false)}
  </a>
</header>

<main class="container">
  <section class="screen screen--result" style="--type-color:${esc(t.color)};--type-accent:${esc(t.accent)}" data-type="${esc(id)}" data-group="${esc(t.group)}">
    <div class="result-hero">
      <p class="result-hero__label">${esc(S.label)}</p>
      <img class="mascot mascot--result" src="../assets/${esc(t.mascot)}" alt="フクマナ公式キャラクター フクノネコ" width="180" height="180">
      <h1 class="result-hero__name">${esc(t.name)}</h1>
      <p class="result-hero__catch">${D.phrases(t.catch).map((p) => `<span class="phrase">${esc(p)}</span>`).join('')}</p>
      <p class="result-hero__desc">${esc(desc)}</p>
    </div>

    <div class="shared-cta">
      <a class="btn btn--primary btn--large" href="../">${esc(S.cta)}</a>
      <p class="shared-cta__note">${esc(S.ctaNote)}</p>
    </div>

    <div class="block">
      <h2 class="block__title">${esc(S.allTypesTitle.replace(/\d+/, String(Object.keys(C.types).length)))}</h2>
      <div class="type-groups">
        ${others}
      </div>
    </div>
  </section>
</main>

${footerHtml()}
</body>
</html>
`;
  write(`r/${id}.html`, html);
}

// ---------- 画像（OGP・QR） ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' };

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
        res.writeHead(404); return res.end();
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function buildOgpImages() {
  const { chromium } = require('playwright');
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(base + 'tools/ogp.html');
    const jobs = [{ id: 'top', opts: { title: C.site.shortTitle, label: 'あなたに合った学び方がわかる', name: C.site.shortTitle, catch: '約2分・無料。おすすめの講義と次の一歩をご提案します。', mascot: C.images.ogpTop } }];
    for (const [id, t] of Object.entries(C.types)) {
      jobs.push({ id, opts: { title: C.site.shortTitle, name: D.plain(t.name), catch: D.plain(t.catch), color: t.color, accent: t.accent, mascot: t.mascot } });
    }
    for (const job of jobs) {
      const dataUrl = await page.evaluate((opts) => window.renderOgp(opts), { ...job.opts, icon: C.images.icon });
      write(`assets/ogp/${job.id}.png`, Buffer.from(dataUrl.split(',')[1], 'base64'));
    }
  } finally {
    await browser.close();
    server.close();
  }
}

async function buildOptImages() {
  const { chromium } = require('playwright');
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(base + 'tools/ogp.html');
    for (const { file, kind } of appImages()) {
      const dataUrl = await page.evaluate(async ({ src, max, quality }) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const r = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * r);
        c.height = Math.round(img.naturalHeight * r);
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, c.width, c.height);
        return c.toDataURL('image/webp', quality);
      }, { src: base + 'assets/' + encodeURIComponent(file), max: OPT_SIZE[kind], quality: OPT_QUALITY[kind] });
      if (!dataUrl.startsWith('data:image/webp')) throw new Error('WebP に変換できませんでした：' + file);
      write(optName(file), Buffer.from(dataUrl.split(',')[1], 'base64'));
    }
  } finally {
    await browser.close();
    server.close();
  }
}

// ---------- Service Worker（sw.js）の保存ファイル一覧と版 ----------
function precacheFiles() {
  return ['index.html', 'js/diagnosis.js', 'js/app.js', 'js/card.js', 'data/content.json', 'assets/favicon.png']
    .concat(appImages().map((x) => optName(x.file)));
}
function swBlock(root) {
  const files = precacheFiles();
  const hash = crypto.createHash('sha256');
  for (const f of files) {
    const p = path.join(root, f);
    if (!fs.existsSync(p)) throw new Error(`sw.js に保存するファイルがありません：${f}（npm run build で作り直してください）`);
    hash.update(f + '\0').update(fs.readFileSync(p)).update('\0');
  }
  return `var VERSION = '${hash.digest('hex').slice(0, 12)}';\nvar FILES = ${JSON.stringify(files, null, 2).replace(/\n/g, '\n')};`;
}
const RE_SW = /(\/\/ PRECACHE:START[^\n]*\n)[\s\S]*?(\n\/\/ PRECACHE:END)/;
function buildServiceWorker(root = ROOT) {
  const file = path.join(root, 'sw.js');
  const src = fs.readFileSync(file, 'utf8');
  if (!RE_SW.test(src)) throw new Error('sw.js に PRECACHE:START / PRECACHE:END の目印が見つかりません');
  const out = src.replace(RE_SW, (_, a, b) => a + swBlock(root) + b);
  fs.writeFileSync(file, out);
  if (root === ROOT) console.log('  書き出し: sw.js');
}

async function buildQr() {
  const QRCode = require('qrcode');
  const targets = [
    // src は GA4 で流入元を区別するための目印（README「アクセス解析」）
    { name: 'qr-hoiku', url: siteUrl + '?field=hoiku&src=hoikuhaku' },
    { name: 'qr-sns', url: siteUrl + '?src=sns' }
  ];
  const opt = { errorCorrectionLevel: 'M', margin: 4, color: { dark: '#000000', light: '#ffffff' } };
  for (const t of targets) {
    write(`assets/qr/${t.name}.png`, await QRCode.toBuffer(t.url, { ...opt, width: 1200 }));
    write(`assets/qr/${t.name}.svg`, await QRCode.toString(t.url, { ...opt, type: 'svg' }));
  }
  write('assets/qr/README.txt',
    `このフォルダのQRコードは tools/build.js が data/content.json の site.url から生成しています。\n` +
    `qr-hoiku … 保育博用（${siteUrl}?field=hoiku&src=hoikuhaku）\n` +
    `qr-sns   … SNS・チラシ用（${siteUrl}?src=sns）\n` +
    `src は Googleアナリティクスで流入元を区別するための目印です。\n` +
    `印刷にはSVG（拡大しても劣化しません）、SNSにはPNGをお使いください。\n`);
}

module.exports = { buildServiceWorker, swBlock, precacheFiles, RE_SW };
if (require.main !== module) return;

(async () => {
  const errors = validate(C, ROOT);
  if (errors.length) {
    console.error('data/content.json に問題があります：\n- ' + errors.join('\n- '));
    process.exit(1);
  }
  console.log('公開URL:', siteUrl);
  if (withImages) {
    await buildOgpImages();
    await buildOptImages();
    await buildQr();
  }
  buildIndex(); // トップ画面に assets/opt の画像を埋め込むため、画像の後に作る
  Object.keys(C.types).forEach(buildTypePage);
  // 画像・文言・プログラムのどれかが変わると、sw.js の版が変わり、次に開いたときに新しい版へ切り替わる
  buildServiceWorker();
  console.log('完了しました。');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
