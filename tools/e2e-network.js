#!/usr/bin/env node
/*
 * 会場の電波対策の確認テスト（Playwright / Chromium）。npm run e2e の後半で実行します。
 *   [8] 一度トップ画面を開けば、電波が切れても最後まで診断でき、結果画面の表示と結果画像の保存までできる
 *   [9] 電波が切れているときに LINE・法人フォーム・シェアのボタンを押すと「電波が戻ったら…」と案内する
 *   [10] サイトを更新すると、次に開いたときに新しい版に切り替わり、古い保存が消える
 *   [11] 公開サイトと同じ条件（localhost 以外）で Googleアナリティクスのタグが読み込まれ、記録が届く
 * スクリーンショットは test-results/ に保存します。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { chromium, devices } = require('playwright');
const D = require('../js/diagnosis');
const { buildServiceWorker } = require('./build');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'test-results');
const C = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/content.json'), 'utf8'));
fs.mkdirSync(OUT, { recursive: true });

let failed = 0;
function check(ok, msg) {
  console.log((ok ? '  ✔ ' : '  ✘ ') + msg);
  if (!ok) failed++;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.svg': 'image/svg+xml' };
// 止められるサーバー（電波が切れた状態を、サーバーを止めて再現する）
function serve(root, port = 0) {
  return new Promise((resolve) => {
    const sockets = new Set();
    let hits = 0;
    const server = http.createServer((req, res) => {
      hits++;
      let p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
      if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'max-age=600' });
      fs.createReadStream(p).pipe(res);
    });
    server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
    server.listen(port, '127.0.0.1', () => resolve({
      server,
      port: server.address().port,
      hits: () => hits,
      stop: () => new Promise((r) => { sockets.forEach((s) => s.destroy()); server.close(() => r()); })
    }));
  });
}

function answersFor(typeId) {
  const roleId = C.types[typeId].role;
  const qs = C.roles[roleId].questions;
  const ans = qs.map(() => 0);
  for (;;) {
    if (D.diagnose(C, roleId, ans).typeId === typeId) return { roleId, ans: ans.slice() };
    let i = qs.length - 1;
    while (i >= 0 && ++ans[i] >= qs[i].options.length) { ans[i] = 0; i--; }
    if (i < 0) return null;
  }
}

async function clickOption(page, index) {
  await page.locator('.option').nth(index).click();
  await page.waitForTimeout(220);
}

// Service Worker が有効になり、保存するファイルがすべて端末に入るまで待つ
async function waitPrecached(page) {
  return page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    for (let i = 0; i < 100 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 100));
    const src = await (await fetch('sw.js', { cache: 'no-store' })).text();
    const version = src.match(/var VERSION = '([^']+)'/)[1];
    const files = JSON.parse(src.match(/var FILES = (\[[\s\S]*?\]);/)[1]);
    const cache = await caches.open('fukumana-' + version);
    const keys = (await cache.keys()).map((r) => new URL(r.url).pathname.replace(/^\//, ''));
    return { version, controlled: !!navigator.serviceWorker.controller, files, missing: files.filter((f) => !keys.includes(f)) };
  });
}

(async () => {
  const browser = await chromium.launch();
  const S = await serve(ROOT);
  const base = `http://127.0.0.1:${S.port}/`;
  const MSG = C.offline.message;

  // ---------- 8・9. 電波が切れても最後まで ----------
  console.log('\n[8] 一度トップ画面を開けば、電波が切れても最後まで診断できる（Service Worker）');
  for (const [label, device] of [['Android（Pixel 7）', devices['Pixel 7']], ['iPhone（iPhone 13）', devices['iPhone 13']]]) {
    const typeId = 'exec-brand';
    const a = answersFor(typeId);
    const ctx = await browser.newContext({ ...device, acceptDownloads: true });
    await ctx.addInitScript(() => {
      window.__shared = [];
      if (/iPhone/.test(navigator.userAgent)) {
        navigator.canShare = (d) => !!(d && d.files && d.files.length);
        navigator.share = (d) => { window.__shared.push(d.files.map((f) => ({ type: f.type, size: f.size }))); return Promise.resolve(); };
      }
    });
    const page = await ctx.newPage();
    const popups = [];
    ctx.on('page', (p) => popups.push(p.url()));

    await page.goto(base + '?field=hoiku&src=hoikuhaku');
    await page.waitForSelector('html[data-ready="1"]');
    const pc = await waitPrecached(page);
    check(pc.controlled && pc.missing.length === 0, `${label}：トップ画面を開くと ${pc.files.length} ファイルを端末に保存（版 ${pc.version}）` + (pc.missing.length ? '：未保存 ' + pc.missing.join(', ') : ''));

    // ここで電波が切れる（端末をオフライン＋サーバーも停止）
    await ctx.setOffline(true);
    await S.stop();
    const hitsAtOffline = S.hits();

    await page.click('#start');
    await clickOption(page, ['A', 'B', 'C', 'D'].indexOf(a.roleId));
    const qImg = await page.$eval('.mascot--question', (i) => i.complete && i.naturalWidth > 0);
    check(qImg, `${label}：電波が切れた後も、設問のフクノネコが表示される`);
    for (const x of a.ans) await clickOption(page, x);
    await page.waitForSelector('.screen--result');
    await page.waitForFunction(() => { const i = document.querySelector('.mascot--result'); return i && i.complete; });
    const res = await page.evaluate(() => ({
      type: document.querySelector('.screen--result').dataset.type,
      mascot: document.querySelector('.mascot--result').naturalWidth,
      courses: document.querySelectorAll('.course').length
    }));
    check(res.type === typeId && res.mascot > 0 && res.courses === 3, `${label}：結果画面（${C.types[typeId].name}・フクノネコ・おすすめ講義3件）が表示される`);
    await page.screenshot({ path: path.join(OUT, `offline-result-${/iPhone/.test(label) ? 'iphone' : 'android'}.png`) });

    // [9] 外部のページへ進むボタン
    for (const sel of ['[data-cta]', '#share-x', '#share-line']) {
      const el = await page.$(sel);
      if (!el) continue;
      await page.evaluate(() => { const t = document.getElementById('toast'); t.classList.remove('is-show'); t.textContent = ''; });
      await el.click();
      await page.waitForTimeout(300);
      const toast = await page.$eval('#toast', (t) => (t.classList.contains('is-show') ? t.textContent : ''));
      const name = await el.evaluate((e) => e.textContent.trim());
      check(toast === MSG && popups.length === 0, `${label}：電波がないときに「${name}」を押すと「${toast}」と案内し、ページは開かない`);
    }
    await page.screenshot({ path: path.join(OUT, `offline-toast-${/iPhone/.test(label) ? 'iphone' : 'android'}.png`) });

    // 結果画像の保存
    await page.click('#share-image');
    await page.waitForSelector('.modal__preview img', { timeout: 15000 });
    const dims = await page.$eval('.modal__preview img', (img) => [img.naturalWidth, img.naturalHeight]);
    check(dims[0] === 1080 && dims[1] === 1080, `${label}：電波がなくても結果画像（${dims.join('×')}）を作成できる`);
    if (/iPhone/.test(label)) {
      await page.click('.modal__actions button');
      const shared = await page.evaluate(() => window.__shared);
      check(shared.length === 1 && shared[0][0].type === 'image/png' && shared[0][0].size > 10000, `${label}：「画像を保存・共有」で共有シート（写真に保存）を呼び出せる`);
    } else {
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.modal__actions button >> nth=0')]);
      const f = path.join(OUT, 'offline-download.png');
      await dl.saveAs(f);
      const buf = fs.readFileSync(f);
      check(buf.readUInt32BE(16) === 1080 && buf.length > 10000, `${label}：電波がなくても「画像を保存」で PNG を保存できる（${Math.round(buf.length / 1024)}KB）`);
      const img = await page.$eval('.modal__preview img', (i) => i.src);
      fs.writeFileSync(path.join(OUT, 'offline-card.png'), Buffer.from(img.split(',')[1], 'base64'));
    }
    await page.click('[data-close]');

    // 電波がないまま、もう一度開き直しても使える
    await page.goto(base + '?field=hoiku&src=hoikuhaku');
    await page.waitForSelector('html[data-ready="1"]');
    await page.click('#start');
    await page.waitForSelector('.screen--question');
    check(true, `${label}：電波がないまま開き直しても、トップ画面から診断を始められる`);
    check(S.hits() === hitsAtOffline, `${label}：電波が切れた後はサーバーへの通信が0件`);
    await ctx.close();
    // 次の端末のためにサーバーを同じポートで再開
    Object.assign(S, await serve(ROOT, S.port));
  }

  // ---------- 10. 更新 ----------
  console.log('\n[10] サイトを更新すると、次に開いたときに新しい版に切り替わる');
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fukumana-update-'));
    for (const f of ['index.html', 'sw.js', 'css', 'js', 'data', 'assets']) fs.cpSync(path.join(ROOT, f), path.join(tmp, f), { recursive: true });
    const U = await serve(tmp);
    const ubase = `http://127.0.0.1:${U.port}/`;
    const ctx = await browser.newContext({ ...devices['Pixel 7'] });
    const page = await ctx.newPage();
    await page.goto(ubase + '?field=hoiku&src=hoikuhaku');
    await page.waitForSelector('html[data-ready="1"]');
    const v1 = await waitPrecached(page);
    const oldLead = await page.textContent('.lead');

    // サイトを更新（トップ画面の説明文を変える）→ npm run build と同じく sw.js の版を作り直す
    const newLead = '【更新テスト】新しい説明文です。';
    const cj = path.join(tmp, 'data/content.json');
    fs.writeFileSync(cj, fs.readFileSync(cj, 'utf8').replace(JSON.stringify(C.top.lead), JSON.stringify(newLead)));
    const ih = path.join(tmp, 'index.html');
    fs.writeFileSync(ih, fs.readFileSync(ih, 'utf8').replace(D.esc(C.top.lead), D.esc(newLead)));
    buildServiceWorker(tmp);
    const v2 = fs.readFileSync(path.join(tmp, 'sw.js'), 'utf8').match(/var VERSION = '([^']+)'/)[1];
    check(v1.version !== v2, `更新すると sw.js の版が変わる（${v1.version} → ${v2}）`);

    // 次に開いたとき（同じ端末で、もう一度QRを読み取ったとき）
    const t0 = Date.now();
    await page.goto(ubase + '?field=hoiku&src=hoikuhaku');
    await page.waitForFunction((t) => document.querySelector('.lead') && document.querySelector('.lead').textContent === t, newLead, { timeout: 30000 }).catch(() => {});
    const lead = await page.textContent('.lead');
    check(lead === newLead && oldLead !== newLead, `次に開いたとき、新しい版に切り替わる（${((Date.now() - t0) / 1000).toFixed(1)}秒で「${lead}」）`);
    const keys = await page.evaluate(() => caches.keys());
    check(keys.includes('fukumana-' + v2) && !keys.includes('fukumana-' + v1.version), `古い版の保存は削除される（保存：${keys.join(', ')}）`);
    // その次に開いたときは、最初から新しい版
    const page2 = await ctx.newPage();
    await page2.goto(ubase);
    await page2.waitForSelector('html[data-ready="1"]');
    check((await page2.textContent('.lead')) === newLead, 'その後に開いたときは、最初から新しい版が表示される');

    // 診断の途中で更新が届いても、診断は中断されない（次に開いたときに新しい版になる）
    await page2.click('#start');
    await page2.waitForSelector('.screen--question');
    const newer = '【更新テスト2】さらに新しい説明文です。';
    fs.writeFileSync(cj, fs.readFileSync(cj, 'utf8').replace(JSON.stringify(newLead), JSON.stringify(newer)));
    fs.writeFileSync(ih, fs.readFileSync(ih, 'utf8').replace(D.esc(newLead), D.esc(newer)));
    buildServiceWorker(tmp);
    await page2.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
    await page2.waitForTimeout(3000);
    check(!!(await page2.$('.screen--question')), '診断の途中で更新が届いても、画面は開き直されず診断を続けられる');
    await ctx.close();
    await U.stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  await S.stop();
  await browser.close();

  // ---------- 11. Googleアナリティクス ----------
  console.log('\n[11] Googleアナリティクス：公開サイトと同じ条件でタグが読み込まれ、記録が届く');
  {
    // localhost 以外の名前（fukunone.test）で開く。Google には送らず、タグ（gtag.js）を代わりのものに差し替えて記録を確認する
    const G = await serve(ROOT);
    const origin = `http://fukunone.test:${G.port}`;
    // 「安全な接続」とみなす設定（Service Worker を使うため）は、通常版の Chromium（channel: 'chromium'）でだけ有効
    const gb = await chromium.launch({ channel: 'chromium', args: [`--host-resolver-rules=MAP fukunone.test 127.0.0.1`, `--unsafely-treat-insecure-origin-as-secure=${origin}`] });
    const ctx = await gb.newContext({ ...devices['Pixel 7'] });
    const tagRequests = [];
    let collect = 0;
    await ctx.route('https://www.googletagmanager.com/**', (route) => {
      tagRequests.push(route.request().url());
      route.fulfill({
        contentType: 'text/javascript',
        body: `(function () {
          var q = window.dataLayer || [];
          window.__ga = { loadedAt: performance.now(), loadEventEnd: performance.timing.loadEventStart - performance.timing.navigationStart, received: q.map(function (a) { return Array.from(a); }) };
          var push = q.push;
          q.push = function (a) { window.__ga.received.push(Array.from(a)); return push.apply(q, arguments); };
        })();`
      });
    });
    await ctx.route(/google-analytics\.com/, (route) => { collect++; route.abort(); });
    const page = await ctx.newPage();
    const ev = () => page.evaluate(() => (window.__ga ? window.__ga.received : []).filter((a) => a[0] === 'event').map((a) => a[1]));

    await page.goto(origin + '/?field=hoiku&src=hoikuhaku');
    await page.waitForFunction(() => window.__ga, null, { timeout: 30000 });
    const ga = await page.evaluate(() => window.__ga);
    const cfg = ga.received.find((a) => a[0] === 'config');
    const loc = cfg && new URL(cfg[2].page_location);
    check(tagRequests.length === 1 && tagRequests[0] === `https://www.googletagmanager.com/gtag/js?id=${C.analytics.measurementId}`, `タグ（gtag.js?id=${C.analytics.measurementId}）を1回読み込む`);
    check(ga.loadedAt >= ga.loadEventEnd, `タグはページの読み込み後に読み込む（表示を優先）：読み込み完了 ${Math.round(ga.loadEventEnd)}ms → タグ ${Math.round(ga.loadedAt)}ms`);
    check(cfg && cfg[1] === C.analytics.measurementId && loc.searchParams.get('utm_source') === 'hoikuhaku' && loc.searchParams.get('utm_medium') === 'qr',
      'ページの表示（config）が、タグの読み込み前の分もそろって届く・流入元は hoikuhaku / qr');

    const a = answersFor('core');
    await page.click('#start');
    await clickOption(page, ['A', 'B', 'C', 'D'].indexOf(a.roleId));
    for (const x of a.ans) await clickOption(page, x);
    await page.waitForSelector('.screen--result');
    const names = await ev();
    const total = 1 + a.ans.length;
    check(names[0] === 'diagnosis_start' && names.filter((n) => n === 'question_reach').length === total && names.includes('diagnosis_complete'),
      `診断の開始・各設問（${total}問）・完了の記録が届く`);

    // Service Worker が有効になった後（2回目以降に開いたとき）も同じように届く
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 30000 });
    await page.goto(origin + '/?field=hoiku&src=hoikuhaku');
    await page.waitForFunction(() => window.__ga, null, { timeout: 30000 });
    const ctrl = await page.evaluate(() => !!navigator.serviceWorker.controller);
    const cfg2 = await page.evaluate(() => window.__ga.received.find((a) => a[0] === 'config'));
    check(ctrl && tagRequests.length === 2 && !!cfg2, 'Service Worker から表示したときも、タグを読み込み、ページの表示が記録される（Service Worker はアナリティクスの通信に関わらない）');
    await ctx.close();
    await gb.close();
    await G.stop();
  }

  console.log(failed ? `\n${failed}件の問題があります` : '\nすべてのチェックに合格しました');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
