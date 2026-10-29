#!/usr/bin/env node
/*
 * data/content.json をもとに、次のファイルを作り直します。
 *   - index.html の OGP（SNSで表示されるタイトル・説明・画像）
 *   - r/<タイプ>.html … タイプ別の結果ページ（シェアされたリンクの先）
 *   - assets/ogp/*.png … OGP画像（1200×630）
 *   - assets/qr/*.png, *.svg … QRコード（保育博用・SNS用）
 *
 * 使い方:  npm run build            （すべて）
 *          npm run build -- --no-images   （HTMLだけ。画像を作らない）
 */
'use strict';

const fs = require('fs');
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
  <p>${esc(F.contactLabel)} <a href="mailto:${esc(L.contactEmail)}">${esc(L.contactEmail)}</a></p>
</footer>`;
}

// top=true：「福祉経営を学ぶなら フクマナ」（トップ画面）、false：「フクマナ」のみ（設問・結果）
function logoTag(prefix, top) {
  return top
    ? `<img src="${prefix}${esc(C.images.logoTop)}" alt="福祉経営を学ぶなら フクマナ" class="site-header__logo">`
    : `<img src="${prefix}${esc(C.images.logo)}" alt="フクマナ" class="site-header__logo site-header__logo--simple">`;
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
    ${logoTag('assets/', true)}
  </a>`;
  const reHeader = /(<!-- HEADER:START[^>]*-->\n)[\s\S]*?(\n<!-- HEADER:END -->)/;
  if (!reHeader.test(html)) throw new Error('index.html に HEADER:START / HEADER:END の目印が見つかりません');
  write('index.html', html.replace(re, (_, a, b) => a + block + b).replace(reHeader, (_, a, b) => a + header + b));
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
<link rel="icon" href="../assets/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@500;700&display=swap">
<link rel="stylesheet" href="../css/style.css">
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
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

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

async function buildQr() {
  const QRCode = require('qrcode');
  const targets = [
    { name: 'qr-hoiku', url: siteUrl + '?field=hoiku' },
    { name: 'qr-sns', url: siteUrl }
  ];
  const opt = { errorCorrectionLevel: 'M', margin: 4, color: { dark: '#000000', light: '#ffffff' } };
  for (const t of targets) {
    write(`assets/qr/${t.name}.png`, await QRCode.toBuffer(t.url, { ...opt, width: 1200 }));
    write(`assets/qr/${t.name}.svg`, await QRCode.toString(t.url, { ...opt, type: 'svg' }));
  }
  write('assets/qr/README.txt',
    `このフォルダのQRコードは tools/build.js が data/content.json の site.url から生成しています。\n` +
    `qr-hoiku … 保育博用（${siteUrl}?field=hoiku）\n` +
    `qr-sns   … SNS・チラシ用（${siteUrl}）\n` +
    `印刷にはSVG（拡大しても劣化しません）、SNSにはPNGをお使いください。\n`);
}

(async () => {
  const errors = validate(C, ROOT);
  if (errors.length) {
    console.error('data/content.json に問題があります：\n- ' + errors.join('\n- '));
    process.exit(1);
  }
  console.log('公開URL:', siteUrl);
  buildIndex();
  Object.keys(C.types).forEach(buildTypePage);
  if (withImages) {
    await buildOgpImages();
    await buildQr();
  }
  console.log('完了しました。');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
