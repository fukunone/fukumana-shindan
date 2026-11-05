#!/usr/bin/env node
/*
 * 回線が遅い状態（Slow 3G 相当）で、トップ画面が表示されるまでの時間を計ります。
 *
 *   npm run perf                      … このフォルダのサイトを計測（3回の中央値）
 *   npm run perf -- --root ../old     … 別のフォルダ（改善前の版など）を計測
 *   npm run perf -- --runs 5          … 計測回数を変える
 *
 * 回線の条件（Chrome の開発者ツールの「Slow 3G」と同じ値）
 *   - 遅延 2,000ミリ秒（1回の通信ごと）・下り/上り 400kbps（毎秒 約50KB）
 * 公開先（GitHub Pages）と同じく、文字のファイル（HTML・CSS・JS・JSON）は gzip で圧縮して返します。
 * Googleフォントは実際のサーバーから読み込みます。Googleアナリティクスは手元では読み込みません（本番より軽くなります）。
 *
 * 計測する項目
 *   - 最初の表示（FCP）        … 画面に何か（文字など）が初めて表示された時点
 *   - トップ画面の表示          … 診断名・「診断をはじめる」ボタン・フクノネコがすべて表示された時点
 *   - ボタンが使えるまで        … 「診断をはじめる」を押すとすぐ診断が始まる状態になった時点
 *   - 読み込んだ量              … トップ画面の表示までに通信したデータ量
 *   - 2回目に開いたとき         … 一度開いた後（Service Worker が保存した後）にもう一度開いたときのトップ画面の表示
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const ROOT = path.resolve(opt('--root', path.resolve(__dirname, '..')));
const RUNS = Number(opt('--runs', 3));
const QUERY = '?field=hoiku&src=hoikuhaku';
const SLOW_3G = { offline: false, latency: 2000, downloadThroughput: 50 * 1000, uploadThroughput: 50 * 1000 };

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json' };
const TEXT = /^(text\/|application\/json|image\/svg)/;

// GitHub Pages と同じように gzip 圧縮・キャッシュ10分で返すサーバー
function serve(root) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (p.startsWith(root) && fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
      if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
      const type = MIME[path.extname(p)] || 'application/octet-stream';
      let body = fs.readFileSync(p);
      const headers = { 'Content-Type': type, 'Cache-Control': 'max-age=600' };
      if (TEXT.test(type) && /gzip/.test(req.headers['accept-encoding'] || '')) {
        body = zlib.gzipSync(body);
        headers['Content-Encoding'] = 'gzip';
      }
      headers['Content-Length'] = body.length;
      res.writeHead(200, headers);
      res.end(body);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// ページの中で、トップ画面が表示された時点・ボタンが使えるようになった時点を記録する
const PROBE = () => {
  const marks = {};
  window.__perf = marks;
  function visible(el) { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  function tick() {
    const title = document.querySelector('.screen--top h1, .top-title');
    const start = document.getElementById('start');
    const mascot = document.querySelector('.mascot--top');
    if (!marks.top && visible(title) && visible(start) && mascot && mascot.complete && mascot.naturalWidth > 0) marks.top = performance.now();
    // 手元で書き出したトップ画面（data-static）は app.js の起動前。起動後に作り直される
    if (!marks.ready && start && !start.hasAttribute('data-static') && document.documentElement.dataset.ready !== '0') marks.ready = performance.now();
    if (!marks.top || !marks.ready) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (e.name === 'first-contentful-paint') marks.fcp = e.startTime;
  }).observe({ type: 'paint', buffered: true });
};

async function measureOnce(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await ctx.addInitScript(PROBE);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', SLOW_3G);
  let bytes = 0, counting = true;
  cdp.on('Network.loadingFinished', (e) => { if (counting) bytes += e.encodedDataLength; });

  await page.goto(base + QUERY, { waitUntil: 'commit', timeout: 120000 });
  await page.waitForFunction(() => window.__perf && window.__perf.top && window.__perf.ready, null, { timeout: 120000, polling: 100 });
  const first = await page.evaluate(() => window.__perf);
  counting = false;
  const firstBytes = bytes;

  // Service Worker があれば、保存が終わるのを待ってから2回目を開く
  const hasSw = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return false;
    await navigator.serviceWorker.ready;
    return true;
  }).catch(() => false);
  if (hasSw) await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 120000 });
  else await page.waitForLoadState('load', { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(500);

  await page.goto(base + QUERY, { waitUntil: 'commit', timeout: 120000 });
  await page.waitForFunction(() => window.__perf && window.__perf.top && window.__perf.ready, null, { timeout: 120000, polling: 100 });
  const second = await page.evaluate(() => window.__perf);
  await ctx.close();
  return { fcp: first.fcp, top: first.top, ready: first.ready, bytes: firstBytes, repeat: second.top, sw: hasSw };
}

const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const sec = (ms) => (ms < 1000 ? (ms / 1000).toFixed(2) : (ms / 1000).toFixed(1)) + '秒';

(async () => {
  const server = await serve(ROOT);
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const results = [];
  console.log(`計測：${ROOT}（Slow 3G 相当・${RUNS}回）`);
  for (let i = 0; i < RUNS; i++) {
    const r = await measureOnce(browser, base);
    results.push(r);
    console.log(`  ${i + 1}回目：最初の表示 ${sec(r.fcp)}／トップ画面 ${sec(r.top)}／ボタンが使える ${sec(r.ready)}／${Math.round(r.bytes / 1024)}KB／2回目 ${sec(r.repeat)}`);
  }
  const m = (k) => median(results.map((r) => r[k]));
  const summary = { fcp: m('fcp'), top: m('top'), ready: m('ready'), bytes: m('bytes'), repeat: m('repeat') };
  console.log('\n中央値');
  console.log(`  最初の表示（FCP）    ${sec(summary.fcp)}`);
  console.log(`  トップ画面の表示     ${sec(summary.top)}`);
  console.log(`  ボタンが使えるまで   ${sec(summary.ready)}`);
  console.log(`  読み込んだ量         ${Math.round(summary.bytes / 1024)}KB`);
  console.log(`  2回目に開いたとき    ${sec(summary.repeat)}${results[0].sw ? '（Service Worker から表示）' : ''}`);
  const out = opt('--json');
  if (out) fs.writeFileSync(out, JSON.stringify({ root: ROOT, runs: results, summary }, null, 2));
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
