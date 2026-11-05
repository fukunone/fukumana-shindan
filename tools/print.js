#!/usr/bin/env node
/*
 * 保育博ブース用の印刷物（PDF）と見本画像を作ります。   npm run print
 *
 *   print/pdf/pop-a4_home.pdf         卓上POP（A4縦）家庭・事務所のプリンター用（周りに余白あり）
 *   print/pdf/pop-a4_press.pdf        卓上POP（A4縦）印刷会社入稿用（塗り足し3mm・トンボ付き）
 *   print/pdf/qr-card_a4-10up.pdf     QRカード（91×55mm）A4に10面付け（1ページ目＝表、2ページ目＝裏）
 *   print/pdf/qr-card_press.pdf       QRカード 印刷会社入稿用（塗り足し3mm・トンボ付き、1ページ目＝表、2ページ目＝裏）
 *   print/preview/*.png               見本画像
 *
 * - QRコードは保育博用（公開URL?field=hoiku&src=hoikuhaku、data/content.json の site.url から作成）。図形（ベクター）なので拡大しても粗くなりません。
 * - 写真・イラスト（ロゴ・フクノネコ）は元の大きな PNG を使い、印刷サイズで 350dpi 以上になるようにしています（作成時に自動で確認）。
 * - 作成後、QRコードがスマホのカメラで1m離れて読み取れる大きさかを、画像を縮小・ぼかして読み取る方法で確認します。
 * - 価格・料金、制度や統計などの事実、営利的な表現は載せません（作成時に自動で確認）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const QRCode = require('qrcode');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT_PDF = path.join(ROOT, 'print/pdf');
const OUT_PNG = path.join(ROOT, 'print/preview');
const C = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/content.json'), 'utf8'));
const siteUrl = C.site.url.endsWith('/') ? C.site.url : C.site.url + '/';
const QR_URL = siteUrl + '?field=hoiku&src=hoikuhaku';
const FUKUMANA_URL = C.links.top; // フクマナのサイト
fs.mkdirSync(OUT_PDF, { recursive: true });
fs.mkdirSync(OUT_PNG, { recursive: true });

const BLEED = 3;      // 塗り足し（mm）
const MARK_AREA = 12; // トンボを描く場所（塗り足しの外側、mm）
const MIN_DPI = 350;

// サイトと同じ配色（css/style.css の :root）
const COLOR = { brand: '#005660', brandDark: '#00393f', accent: '#00aab2', accentText: '#00747c', tint: '#e3f4f2', bg: '#f1f9f8', text: '#1f3a3e', sub: '#4b6468', line: '#cfe6e3' };

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- QRコード（SVG・ベクター） ----------
const qr = QRCode.create(QR_URL, { errorCorrectionLevel: 'M' });
const QR_N = qr.modules.size;
function qrSvg(sizeMm) {
  let d = '';
  for (let r = 0; r < QR_N; r++) {
    for (let c = 0; c < QR_N; c++) if (qr.modules.get(r, c)) d += `M${c} ${r}h1v1h-1z`;
  }
  return `<svg class="qr" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${QR_N} ${QR_N}" width="${sizeMm}mm" height="${sizeMm}mm" shape-rendering="crispEdges" role="img" aria-label="QRコード"><path fill="#00262b" d="${d}"/></svg>`;
}
// QRコードの周りの白い余白（4マス分。読み取りに必要）
const quiet = (sizeMm) => (sizeMm / QR_N) * 4;

// ---------- トンボ（日本式：角トンボ＋センタートンボ） ----------
function cropMarks(pageW, pageH, x, y, w, h) {
  const b = BLEED, L = 10, lines = [];
  const H = (y1, x1, x2) => lines.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y1}"/>`);
  const V = (x1, y1, y2) => lines.push(`<line x1="${x1}" y1="${y1}" x2="${x1}" y2="${y2}"/>`);
  for (const [cx, sx] of [[x, -1], [x + w, 1]]) {
    for (const [cy, sy] of [[y, -1], [y + h, 1]]) {
      // 仕上がり線（内トンボ）と塗り足し線（外トンボ）
      H(cy, cx + sx * b, cx + sx * (b + L));
      H(cy + sy * b, cx + sx * b, cx + sx * (b + L));
      V(cx, cy + sy * b, cy + sy * (b + L));
      V(cx + sx * b, cy + sy * b, cy + sy * (b + L));
    }
  }
  // センタートンボ
  const mx = x + w / 2, my = y + h / 2;
  for (const s of [-1, 1]) {
    const ey = s < 0 ? y - b : y + h + b;
    V(mx, ey, ey + s * L);
    H(ey + s * L * 0.55, mx - L * 0.45, mx + L * 0.45);
    const ex = s < 0 ? x - b : x + w + b;
    H(my, ex, ex + s * L);
    V(ex + s * L * 0.55, my - L * 0.45, my + L * 0.45);
  }
  return `<svg class="marks" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pageW} ${pageH}" width="${pageW}mm" height="${pageH}mm"><g stroke="#000" stroke-width="0.1" fill="none">${lines.join('')}</g></svg>`;
}

// ---------- 共通の見た目 ----------
const BASE_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #fff; }
body { font-family: "Zen Maru Gothic", sans-serif; font-weight: 500; color: ${COLOR.text}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { position: relative; overflow: hidden; page-break-after: always; break-after: page; }
.page:last-child { page-break-after: auto; break-after: auto; }
.marks { position: absolute; left: 0; top: 0; }
.slug { position: absolute; font-size: 2.2mm; color: #000; white-space: nowrap; }
.art { position: absolute; overflow: hidden; background: ${COLOR.bg}; }
.trim { position: absolute; left: ${BLEED}mm; top: ${BLEED}mm; }
.deco { position: absolute; border-radius: 50%; opacity: .2; }
.nowrap { white-space: nowrap; }
img { display: block; }
`;

function decoCircles(w, h, items) {
  return items.map(([x, y, r, color]) => `<div class="deco" style="left:${x - r}mm;top:${y - r}mm;width:${r * 2}mm;height:${r * 2}mm;background:${color}"></div>`).join('');
}

// 10のタイプ（グループごとに少し間を空けて並べる）
function typeDots(sizeMm) {
  const groups = Object.keys(C.groups).filter((k) => !k.startsWith('_'));
  return groups.map((g) => {
    const items = Object.values(C.types).filter((t) => t.group === g).map((t) =>
      `<span class="dot" style="width:${sizeMm}mm;height:${sizeMm}mm;border-color:${t.color};background:color-mix(in srgb, ${t.accent} 28%, #fff)"><img src="/assets/${esc(t.mascot)}" alt=""></span>`).join('');
    return `<span class="dot-group">${items}</span>`;
  }).join('');
}

// ---------- 卓上POP（A4縦） ----------
const POP_W = 210, POP_H = 297;
const POP_QR = 112; // QRコードの大きさ（mm）。1m離れて読み取れる目安（読み取る距離の1/10＝100mm）より大きく

function popArt() {
  const q = quiet(POP_QR);
  return `
<div class="art" style="left:0;top:0;width:${POP_W + BLEED * 2}mm;height:${POP_H + BLEED * 2}mm">
  ${decoCircles(POP_W + BLEED * 2, POP_H + BLEED * 2, [[POP_W - 4, 18, 46, COLOR.accent], [6, POP_H - 10, 40, COLOR.accent], [POP_W + 2, POP_H - 60, 18, '#e3b23c']])}
  <div class="trim pop" style="width:${POP_W}mm;height:${POP_H}mm">
    <img class="pop-logo" src="/assets/${esc(C.images.logoTop)}" alt="福祉経営を学ぶなら フクマナ">
    <p class="pop-pill">約2分・無料</p>
    <h1 class="pop-title">福祉経営 学びタイプ診断</h1>
    <p class="pop-lead"><span class="nowrap">いくつかの質問に答えるだけで、</span><br><span class="nowrap">あなたに合った学び方とおすすめ講義がわかります</span></p>
    <div class="pop-card" style="padding:${q}mm ${q}mm 7mm">
      ${qrSvg(POP_QR)}
      <p class="pop-scan">${phoneIcon(7)}<span>スマホのカメラで読み取ってください</span></p>
    </div>
    <img class="pop-mascot" src="/assets/Fukunoneko_05.png" alt="">
    <p class="pop-types-title">あなたは、どのタイプ？</p>
    <div class="dots pop-dots">${typeDots(15)}</div>
    <p class="pop-types-note">診断でわかる${Object.keys(C.types).length}のタイプ</p>
    <p class="pop-foot"><span>回答内容は保存されません</span><span>運営 合同会社フクノネ</span></p>
  </div>
</div>`;
}

function phoneIcon(mm) {
  return `<svg class="phone" viewBox="0 0 24 24" width="${mm}mm" height="${mm}mm" aria-hidden="true"><rect x="6" y="1.5" width="12" height="21" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><rect x="9" y="7" width="6" height="6" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="19" r="1.2" fill="currentColor"/></svg>`;
}

const POP_CSS = `
.pop { display: flex; flex-direction: column; align-items: center; text-align: center; padding-top: 11mm; }
.pop-logo { height: 19mm; width: auto; margin-bottom: 2mm; }
.pop-pill { display: inline-block; background: ${COLOR.brand}; color: #fff; font-weight: 700; font-size: 7.4mm; line-height: 1; padding: 2.2mm 7mm 2.4mm; border-radius: 99mm; letter-spacing: .06em; }
.pop-title { color: ${COLOR.brand}; font-weight: 700; font-size: 14.6mm; line-height: 1.25; margin-top: 3.5mm; letter-spacing: .02em; white-space: nowrap; }
.pop-lead { font-size: 5.3mm; line-height: 1.55; margin-top: 2.5mm; color: ${COLOR.text}; }
.pop-card { position: relative; margin-top: 6mm; background: #fff; border: .7mm solid ${COLOR.line}; border-radius: 7mm; display: flex; flex-direction: column; align-items: center; }
.pop-scan { display: flex; align-items: center; gap: 1.6mm; margin-top: 3mm; color: ${COLOR.brand}; font-weight: 700; font-size: 6mm; line-height: 1; }
.pop-mascot { position: absolute; width: 44mm; height: 44mm; object-fit: contain; right: 4mm; top: 196mm; }
.pop-types-title { margin-top: 7mm; font-size: 5mm; font-weight: 700; color: ${COLOR.accentText}; }
.dots { display: flex; justify-content: center; }
.pop-dots { gap: 4.5mm; margin-top: 2.5mm; }
.dot-group { display: flex; gap: 1.8mm; }
.dot { display: flex; align-items: center; justify-content: center; border-radius: 50%; border: .6mm solid; overflow: hidden; }
.dot img { width: 112%; height: 112%; object-fit: contain; margin-top: 12%; }
.pop-types-note { margin-top: 2.5mm; font-size: 3.8mm; color: ${COLOR.sub}; }
.pop-foot { position: absolute; left: 0; right: 0; bottom: 7mm; display: flex; justify-content: center; gap: 8mm; font-size: 3.4mm; color: ${COLOR.sub}; }
`;

// ---------- QRカード（91×55mm） ----------
const CARD_W = 91, CARD_H = 55;
const CARD_QR = 34;

function cardFront() {
  const q = quiet(CARD_QR);
  return `
<div class="art" style="left:0;top:0;width:${CARD_W + BLEED * 2}mm;height:${CARD_H + BLEED * 2}mm">
  ${decoCircles(CARD_W + BLEED * 2, CARD_H + BLEED * 2, [[4, 6, 14, COLOR.accent], [44, CARD_H + 6, 9, '#e3b23c']])}
  <div class="trim card card--front" style="width:${CARD_W}mm;height:${CARD_H}mm">
    <div class="cf-left">
      <p class="cf-pill">約2分・無料</p>
      <p class="cf-title"><span class="nowrap">福祉経営</span><br><span class="nowrap">学びタイプ診断</span></p>
      <p class="cf-scan">スマホのカメラで<br>読み取ってください</p>
      <img class="cf-mascot" src="/assets/${esc(C.images.top)}" alt="">
    </div>
    <div class="cf-qr" style="padding:${q}mm">${qrSvg(CARD_QR)}</div>
  </div>
</div>`;
}

function cardBack() {
  return `
<div class="art" style="left:0;top:0;width:${CARD_W + BLEED * 2}mm;height:${CARD_H + BLEED * 2}mm;background:#fff">
  ${decoCircles(CARD_W + BLEED * 2, CARD_H + BLEED * 2, [[CARD_W + 4, 4, 13, COLOR.accent]])}
  <div class="trim card card--back" style="width:${CARD_W}mm;height:${CARD_H}mm">
    <img class="cb-logo" src="/assets/${esc(C.images.logoTop)}" alt="福祉経営を学ぶなら フクマナ">
    <p class="cb-text">福祉経営を、スマホで好きなときに学べるeラーニング</p>
    <p class="cb-url">${esc(FUKUMANA_URL.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</p>
    <p class="cb-op">運営 合同会社フクノネ</p>
  </div>
</div>`;
}

const CARD_CSS = `
.card { overflow: hidden; }
.card--front .cf-left { position: absolute; left: 5mm; top: 6mm; width: 40mm; }
.cf-pill { display: inline-block; background: ${COLOR.brand}; color: #fff; font-weight: 700; font-size: 2.7mm; line-height: 1; padding: .9mm 2.6mm 1mm; border-radius: 9mm; letter-spacing: .04em; }
.cf-title { margin-top: 2mm; color: ${COLOR.brand}; font-weight: 700; font-size: 5.1mm; line-height: 1.35; }
.cf-scan { margin-top: 2mm; font-size: 2.6mm; line-height: 1.45; color: ${COLOR.sub}; }
.cf-mascot { position: absolute; left: 22mm; top: 25.5mm; width: 21mm; height: 21mm; object-fit: contain; }
.cf-qr { position: absolute; right: 4mm; top: 50%; transform: translateY(-50%); background: #fff; border-radius: 2.4mm; border: .35mm solid ${COLOR.line}; }
.cf-qr .qr { display: block; }
.card--back { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.cb-logo { height: 19mm; width: auto; margin-top: -1mm; }
.cb-text { margin-top: 1.5mm; font-size: 3.2mm; line-height: 1.5; color: ${COLOR.text}; font-weight: 700; }
.cb-url { margin-top: 3mm; background: ${COLOR.brand}; color: #fff; font-weight: 700; font-size: 3.6mm; line-height: 1; padding: 1.6mm 5mm 1.8mm; border-radius: 9mm; letter-spacing: .03em; }
.cb-op { margin-top: 2.6mm; font-size: 2.4mm; color: ${COLOR.sub}; }
`;

// ---------- ページの組み立て ----------
function doc(pageW, pageH, pages, css) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@500;700&display=block">
<style>@page { size: ${pageW}mm ${pageH}mm; margin: 0; } ${BASE_CSS} ${css}
.page { width: ${pageW}mm; height: ${pageH}mm; }</style></head><body>${pages.join('')}</body></html>`;
}

// 印刷会社入稿用：塗り足しの外側にトンボを描く
function pressPage(trimW, trimH, art, slug) {
  const pageW = trimW + (BLEED + MARK_AREA) * 2, pageH = trimH + (BLEED + MARK_AREA) * 2;
  const x = BLEED + MARK_AREA, y = BLEED + MARK_AREA;
  return {
    pageW, pageH,
    html: `<div class="page"><div style="position:absolute;left:${MARK_AREA}mm;top:${MARK_AREA}mm;width:${trimW + BLEED * 2}mm;height:${trimH + BLEED * 2}mm">${art}</div>
      ${cropMarks(pageW, pageH, x, y, trimW, trimH)}
      <p class="slug" style="left:${x + 14}mm;top:${2.5}mm">${esc(slug)}</p></div>`
  };
}

// 家庭用：仕上がりの大きさの枠に入れて、塗り足し部分は切り落として表示
function cut(trimW, trimH, art, style) {
  return `<div style="position:absolute;overflow:hidden;width:${trimW}mm;height:${trimH}mm;${style}"><div style="position:absolute;left:-${BLEED}mm;top:-${BLEED}mm;width:${trimW + BLEED * 2}mm;height:${trimH + BLEED * 2}mm">${art}</div></div>`;
}

function jobs() {
  const list = [];
  // POP：家庭用（A4・周り8mm以上の余白。家庭用プリンターはふちなし印刷ができない機種が多いため）
  {
    const margin = 8;
    const s = Math.min((POP_W - margin * 2) / POP_W, (POP_H - margin * 2) / POP_H);
    const w = POP_W * s, h = POP_H * s;
    const html = `<div class="page"><div style="position:absolute;left:${(POP_W - w) / 2}mm;top:${(POP_H - h) / 2}mm;width:${w}mm;height:${h}mm;border-radius:5mm;overflow:hidden">
      <div style="transform:scale(${s});transform-origin:0 0">${cut(POP_W, POP_H, popArt(), 'left:0;top:0')}</div></div></div>`;
    list.push({ name: 'pop-a4_home', pageW: POP_W, pageH: POP_H, css: POP_CSS, pages: [html], scale: s, qrMm: POP_QR * s, label: '卓上POP（家庭・事務所のプリンター用）' });
  }
  // POP：入稿用
  {
    const p = pressPage(POP_W, POP_H, popArt(), `卓上POP A4縦（仕上がり210×297mm・塗り足し3mm）福祉経営 学びタイプ診断`);
    list.push({ name: 'pop-a4_press', pageW: p.pageW, pageH: p.pageH, css: POP_CSS, pages: [p.html], scale: 1, qrMm: POP_QR, label: '卓上POP（印刷会社入稿用）' });
  }
  // QRカード：A4に10面付け（2列×5段・上下11mm・左右14mm。市販の名刺用紙（A4・10面）と同じ配置）
  {
    const L = 14, T = 11;
    const sheet = (artFn) => {
      let cards = '';
      for (let r = 0; r < 5; r++) for (let c = 0; c < 2; c++) cards += cut(CARD_W, CARD_H, artFn(), `left:${L + c * CARD_W}mm;top:${T + r * CARD_H}mm`);
      // 普通紙に印刷して切るとき用の切り取り線の目印（用紙のふち＝名刺用紙では捨てる部分に描く）
      const ticks = [];
      for (let c = 0; c <= 2; c++) { const x = L + c * CARD_W; ticks.push(`<line x1="${x}" y1="2" x2="${x}" y2="${T - 2}"/><line x1="${x}" y1="${297 - T + 2}" x2="${x}" y2="295"/>`); }
      for (let r = 0; r <= 5; r++) { const y = T + r * CARD_H; ticks.push(`<line x1="2" y1="${y}" x2="${L - 2}" y2="${y}"/><line x1="${210 - L + 2}" y1="${y}" x2="208" y2="${y}"/>`); }
      return `<div class="page">${cards}<svg class="marks" viewBox="0 0 210 297" width="210mm" height="297mm"><g stroke="#9bb" stroke-width="0.15">${ticks.join('')}</g></svg></div>`;
    };
    list.push({ name: 'qr-card_a4-10up', pageW: 210, pageH: 297, css: CARD_CSS, pages: [sheet(cardFront), sheet(cardBack)], scale: 1, qrMm: CARD_QR, label: 'QRカード（A4・10面付け）' });
  }
  // QRカード：入稿用（表・裏）
  {
    const f = pressPage(CARD_W, CARD_H, cardFront(), 'QRカード 表（仕上がり91×55mm・塗り足し3mm）');
    const b = pressPage(CARD_W, CARD_H, cardBack(), 'QRカード 裏（仕上がり91×55mm・塗り足し3mm）');
    list.push({ name: 'qr-card_press', pageW: f.pageW, pageH: f.pageH, css: CARD_CSS, pages: [f.html, b.html], scale: 1, qrMm: CARD_QR, label: 'QRカード（印刷会社入稿用）' });
  }
  return list;
}

// ---------- 確認 ----------
const BANNED = [
  [/儲|もうけ|モウケ|稼/, '営利的な表現'],
  [/[0-9０-９,，]+\s*円|￥|¥|価格|料金|税込|税抜|月額|年額|割引/, '価格・料金'],
  [/加算|報酬改定|算定|[0-9０-９.]+\s*[%％]|制度/, '制度・統計']
];

function serve() {
  const MIME = { '.png': 'image/png', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript' };
  const pages = new Map();
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (pages.has(u)) { res.writeHead(200, { 'Content-Type': MIME['.html'] }); return res.end(pages.get(u)); }
      const p = path.join(ROOT, u);
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, pages, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

(async () => {
  const S = await serve();
  const browser = await chromium.launch();
  let problems = 0;
  const report = [];
  try {
    for (const job of jobs()) {
      const html = doc(job.pageW, job.pageH, job.pages, job.css);
      // 載せる文言のチェック
      const text = html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');
      for (const [re, label] of BANNED) if (re.test(text)) { console.error(`  ✘ ${job.name}：${label}が含まれています（${text.match(re)[0]}）`); problems++; }

      S.pages.set(`/__print/${job.name}.html`, html);
      const page = await browser.newPage({ viewport: { width: Math.ceil(job.pageW * 96 / 25.4), height: Math.ceil(job.pageH * job.pages.length * 96 / 25.4) }, deviceScaleFactor: 2 });
      await page.goto(`${S.base}/__print/${job.name}.html`, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      const fontOk = await page.evaluate(() => {
        // 英数字は複数の分割ファイルにまたがって登録されているため、日本語の文字で確認する
        const t = document.body.innerText.replace(/[\x00-\x7f\s]/g, '');
        return [...new Set(t)].filter((c) => !document.fonts.check('700 20px "Zen Maru Gothic"', c) && !document.fonts.check('500 20px "Zen Maru Gothic"', c)).join('');
      });
      if (fontOk) { console.error(`  ✘ ${job.name}：フォント（Zen Maru Gothic）を読み込めていない文字があります：${fontOk}`); problems++; }

      // 画像の解像度（印刷サイズで 350dpi 以上か）
      const imgs = await page.evaluate(() => Array.from(document.images).map((i) => {
        const r = i.getBoundingClientRect();
        // object-fit: contain のときは、実際に描かれる大きさで計算する
        const ratio = Math.min(r.width / i.naturalWidth, r.height / i.naturalHeight);
        const cssPx = i.naturalWidth * ratio;
        return { src: i.getAttribute('src'), natural: i.naturalWidth, cssPx };
      }));
      let minDpi = Infinity, minSrc = '';
      for (const im of imgs) {
        const mm = (im.cssPx * job.scale) * 25.4 / 96;
        const dpi = im.natural / (mm / 25.4);
        if (dpi < minDpi) { minDpi = dpi; minSrc = im.src; }
      }
      if (minDpi < MIN_DPI) { console.error(`  ✘ ${job.name}：${minSrc} が ${Math.round(minDpi)}dpi（${MIN_DPI}dpi 未満）`); problems++; }

      // はみ出し（POP・カードの仕上がり枠からはみ出す文字がないか）
      const overflow = await page.evaluate(() => {
        const bad = [];
        document.querySelectorAll('.trim').forEach((t) => {
          const tr = t.getBoundingClientRect();
          t.querySelectorAll('p, h1, img, svg, .dot').forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.left < tr.left - 0.5 || r.right > tr.right + 0.5 || r.top < tr.top - 0.5 || r.bottom > tr.bottom + 0.5) bad.push(el.className.baseVal != null ? el.className.baseVal : el.className);
          });
        });
        return [...new Set(bad)];
      });
      if (overflow.length) { console.error(`  ✘ ${job.name}：仕上がり枠からはみ出し ${overflow.join(', ')}`); problems++; }

      await page.pdf({ path: path.join(OUT_PDF, job.name + '.pdf'), preferCSSPageSize: true, printBackground: true });
      // 見本画像（ページごと）
      const shots = [];
      for (let i = 0; i < job.pages.length; i++) {
        const file = path.join(OUT_PNG, `${job.name}${job.pages.length > 1 ? '_' + (i + 1) : ''}.png`);
        const h = job.pageH * 96 / 25.4;
        await page.screenshot({ path: file, clip: { x: 0, y: i * h, width: job.pageW * 96 / 25.4, height: h } });
        shots.push(file);
      }

      // QRコードの読み取り確認：スマホのカメラで離れて写したときの粗さまで縮小・ぼかして読み取る
      // （縦持ちのスマホ・横方向の画角 約51度・フルHD（1080画素）の映像で、1m先の幅 約95cm を写したときの細かさ）
      const qrMm = job.qrMm;
      const pxPerMmAt1m = 1080 / (2 * Math.tan((51 / 2) * Math.PI / 180) * 1000);
      // QRコード1つ分（周り15mmを含む）を切り出して確認する（10面付けでも1枚分で確認）
      const box = await page.$eval('.qr', (q) => { const r = q.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
      const m = 15 * 96 / 25.4;
      const qrShot = path.join(OUT_PNG, '.qr-check.png');
      await page.screenshot({ path: qrShot, clip: { x: Math.max(0, box.x - m), y: Math.max(0, box.y - m), width: box.w + m * 2, height: box.h + m * 2 } });
      const shot = fs.readFileSync(qrShot).toString('base64');
      fs.unlinkSync(qrShot);
      const dec = await page.evaluate(async ({ shot, pxPerMmAt1m, cssPxPerMm, jsqr }) => {
        if (!window.jsQR) { const s = document.createElement('script'); s.textContent = jsqr; document.head.appendChild(s); }
        const img = new Image();
        img.src = 'data:image/png;base64,' + shot;
        await img.decode();
        const results = {};
        for (const dist of [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]) {
          const ppm = pxPerMmAt1m / dist;               // 1mm あたりの画素数
          const scale = ppm / (cssPxPerMm * 2);         // 見本画像は 2倍の細かさ
          const c = document.createElement('canvas');
          c.width = Math.round(img.naturalWidth * scale);
          c.height = Math.round(img.naturalHeight * scale);
          const ctx = c.getContext('2d');
          ctx.filter = 'blur(0.6px)';                   // ピントのずれ・手ぶれ
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, c.width, c.height);
          const d = ctx.getImageData(0, 0, c.width, c.height);
          const r = window.jsQR(d.data, d.width, d.height);
          results[dist] = r ? r.data : null;
        }
        return results;
      }, { shot, pxPerMmAt1m, cssPxPerMm: 96 / 25.4, jsqr: fs.readFileSync(require.resolve('jsqr/dist/jsQR.js'), 'utf8') });
      const okDists = Object.keys(dec).filter((k) => dec[k] === QR_URL).map(Number);
      const maxOk = okDists.length ? Math.max(...okDists) : 0;
      const needed = job.name.startsWith('pop') ? 1 : 0.5;
      if (!(dec[needed] === QR_URL)) { console.error(`  ✘ ${job.name}：QRコードが ${needed}m の想定で読み取れません`); problems++; }
      if (Object.values(dec).some((v) => v && v !== QR_URL)) { console.error(`  ✘ ${job.name}：QRコードの読み取り結果が違います`); problems++; }
      report.push({ job: job.label, file: `print/pdf/${job.name}.pdf`, pageMm: `${Math.round(job.pageW)}×${Math.round(job.pageH)}`, qrMm: qrMm.toFixed(0), moduleMm: (qrMm / QR_N).toFixed(2), minDpi: Math.round(minDpi), maxDist: maxOk });
      await page.close();
    }
  } finally {
    await browser.close();
    S.server.close();
  }
  console.log(`QRコードの読み取り先：${QR_URL}（${QR_N}×${QR_N}マス・誤り訂正レベルM）`);
  for (const r of report) {
    console.log(`  ✔ ${r.job}：${r.file}（用紙 ${r.pageMm}mm）QR ${r.qrMm}mm（1マス ${r.moduleMm}mm）・画像の解像度 最低 ${r.minDpi}dpi・読み取り確認 ${r.maxDist}m まで`);
  }
  fs.writeFileSync(path.join(OUT_PNG, 'report.json'), JSON.stringify({ url: QR_URL, modules: QR_N, report }, null, 2) + '\n');
  if (problems) { console.error(`\n${problems}件の問題があります`); process.exit(1); }
  console.log('\n完了しました。');
})().catch((e) => { console.error(e); process.exit(1); });
