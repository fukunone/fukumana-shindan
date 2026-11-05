#!/usr/bin/env node
/*
 * ブラウザ（Playwright / Chromium）で実際に画面を操作する確認テスト。
 *   - 4分野×4立場の通し操作、全9タイプの表示
 *   - ?field=hoiku でQ1がスキップされること
 *   - 幅 360 / 390 / 768px で横はみ出しがないこと・文字16px以上
 *   - シェアボタン（X・LINE・コピー）と結果画像の保存（iPhone / Android の端末設定で）
 * 使い方:  npm run e2e   （スクリーンショットは test-results/ に保存）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium, devices } = require('playwright');
const D = require('../js/diagnosis');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'test-results');
const C = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/content.json'), 'utf8'));
fs.mkdirSync(OUT, { recursive: true });

let failed = 0;
function check(ok, msg) {
  console.log((ok ? '  ✔ ' : '  ✘ ') + msg);
  if (!ok) failed++;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
      if (!p.startsWith(ROOT) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// 各タイプに到達する回答を1つずつ探す
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

// 画面に表示する画像は、軽い WebP（assets/opt/、tools/build.js が作成）
const opt = (file) => 'assets/opt/' + file.replace(/\.png$/, '.webp');

async function clickOption(page, index) {
  await page.locator('.option').nth(index).click();
  await page.waitForTimeout(220);
}

async function runFlow(page, base, { fieldIndex, roleId, ans, query = '' }) {
  await page.goto(base + 'index.html' + query);
  await page.click('#start');
  if (fieldIndex != null) await clickOption(page, fieldIndex);
  await clickOption(page, ['A', 'B', 'C', 'D'].indexOf(roleId));
  for (const a of ans) await clickOption(page, a);
  await page.waitForSelector('.screen--result');
}

async function layoutReport(page) {
  return page.evaluate(() => {
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    let minFont = 99, minEl = '';
    document.querySelectorAll('body *').forEach((el) => {
      if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return;
      const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!hasText) return;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < minFont) { minFont = fs; minEl = el.className || el.tagName; }
    });
    let smallTap = [];
    document.querySelectorAll('button, a.btn, .share__btn, .option').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width && r.height < 44) smallTap.push((el.className || el.tagName) + ':' + Math.round(r.height));
    });
    return { overflow, minFont, minEl, smallTap };
  });
}

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();

  // ---------- 1. 4分野×4立場の通し ----------
  console.log('\n[1] 4分野×4立場の通し操作');
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    for (let fi = 0; fi < C.fields.length; fi++) {
      const field = C.fields[fi];
      for (const roleId of ['A', 'B', 'C', 'D']) {
        const n = C.roles[roleId].questions.length;
        // 分野・立場ごとに回答を変えて通す（全部「最後の選択肢」になる組み合わせなど）
        const ans = C.roles[roleId].questions.map((q, i) => (i + fi) % q.options.length);
        await runFlow(page, base, { fieldIndex: fi, roleId, ans });
        const expected = D.diagnose(C, roleId, ans);
        const name = await page.textContent('.result-hero__name');
        const courses = await page.locator('.course').count();
        const desc = await page.textContent('.result-hero__desc');
        check(name === expected.type.name && courses === 3 && !/\{\w+\}/.test(desc),
          `${field.label} × ${C.roles[roleId].name}（${n}問）→ ${name}`);
      }
    }
    check(errors.length === 0, 'JavaScriptエラーなし' + (errors.length ? '：' + errors.join(' / ') : ''));

    // 分野ごとの呼び方
    await page.goto(base + 'index.html');
    await page.click('#start');
    await clickOption(page, 1); // 障がい福祉
    const roleNoteB = await page.locator('.option__sub').nth(1).textContent();
    await clickOption(page, 0); // 一般職員
    await clickOption(page, 0);
    await clickOption(page, 0);
    const q3 = await page.textContent('.question');
    check(q3.includes('事業所・施設') && roleNoteB.includes('施設長'), `障がい福祉の呼び方：「${q3}」`);
    const q3img = await page.$eval('.mascot--question', (i) => i.getAttribute('src'));
    check(q3img === opt(C.images.question), `ふつうの質問のフクノネコ：${q3img}`);

    // 戻るボタン
    await page.click('#back');
    await page.waitForTimeout(100);
    const backQ = await page.textContent('.question');
    const worryImg = await page.$eval('.mascot--question', (i) => i.getAttribute('src'));
    check(worryImg === opt(C.roles.A.questions[1].mascot), `悩みを聞く質問のフクノネコ：${worryImg}`);
    const sel = await page.locator('.option.is-selected').count();
    check(backQ === C.roles.A.questions[1].text && sel === 1, '戻るボタンで前の質問に戻り、前回の選択が表示される');
    await page.goBack();
    await page.waitForTimeout(100);
    check((await page.textContent('.question')) === C.roles.A.questions[0].text.replace('{place}', '事業所・施設'), 'ブラウザの「戻る」でも1問戻る');
    await page.close();
  }

  // ---------- 2. 全タイプ ----------
  console.log('\n[2] 全タイプの結果表示');
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    let fi = 0;
    for (const typeId of Object.keys(C.types)) {
      const a = answersFor(typeId);
      await runFlow(page, base, { fieldIndex: fi++ % 4, ...a });
      const name = await page.textContent('.result-hero__name');
      const groupShown = await page.evaluate((n) => document.body.textContent.includes(n), C.groups[C.types[typeId].group].name);
      check(!groupShown, '  グループ名のラベルは表示しない');
      const logo = await page.getAttribute('.site-header__logo', 'src');
      check(logo === opt(C.images.logo), `  結果画面のヘッダーロゴ：${logo}`);
      const mascot = await page.$eval('.mascot--result', (i) => [i.getAttribute('src'), i.naturalWidth]);
      check(mascot[0] === opt(C.types[typeId].mascot) && mascot[1] > 0, `  フクノネコ：${mascot[0]}`);
      const ctas = await page.$$eval('[data-cta]', (els) => els.map((e) => e.getAttribute('href')));
      const expectedCtas = C.types[typeId].ctas.map((c) => C.links[c.link]);
      check(name === C.types[typeId].name && JSON.stringify(ctas) === JSON.stringify(expectedCtas),
        `${C.types[typeId].name}（次の一歩：${C.types[typeId].ctas.map((c) => c.label).join('／')}）`);
    }
    await page.close();
  }

  // ---------- 3. ?field=hoiku ----------
  console.log('\n[3] 保育博用URL（?field=hoiku）');
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(base + 'index.html?field=hoiku');
    await page.waitForSelector('#start');
    check((await page.getAttribute('.site-header__logo', 'src')) === opt(C.images.logoTop), 'トップ画面のヘッダーは「福祉経営を学ぶなら フクマナ」のロゴ');
    await page.click('#start');
    const q = await page.textContent('.question');
    const note = await page.locator('.option__sub').nth(0).textContent();
    check((await page.getAttribute('.site-header__logo', 'src')) === opt(C.images.logo), '設問画面のヘッダーは「フクマナ」のみのロゴ');
    const roleImg = await page.$eval('.mascot--question', (i) => i.getAttribute('src'));
    check(roleImg === opt(C.images.basicQuestion), `立場の質問のフクノネコ：${roleImg}`);
    check(q === C.roleQuestion.text && note.includes('保育士'), `Q1（分野）をスキップし、立場の質問から開始（${note}）`);
    await clickOption(page, 0);
    await clickOption(page, 0);
    await clickOption(page, 0);
    check((await page.textContent('.question')).includes('園の運営'), '保育の呼び方（園）で表示');
    const total = await page.textContent('.progress__text');
    check(/\/ 7$/.test(total.trim()), `進捗表示（立場1問＋質問6問）：${total.trim()}`);
    await page.close();
  }

  // ---------- 4. 画面幅 ----------
  console.log('\n[4] 画面幅 360 / 390 / 768px');
  for (const width of [360, 390, 768]) {
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const shots = [];
    const checkPage = async (label, file) => {
      const r = await layoutReport(page);
      check(r.overflow <= 0 && r.minFont >= 16 && r.smallTap.length === 0,
        `${width}px ${label}：横はみ出し ${r.overflow}px／最小文字 ${r.minFont}px` +
        (r.smallTap.length ? `／小さいボタン ${r.smallTap.join(',')}` : '') + (r.minFont < 16 ? `（${r.minEl}）` : ''));
      const f = path.join(OUT, `${width}-${file}.png`);
      await page.screenshot({ path: f, fullPage: true });
      shots.push(f);
    };
    await page.goto(base + 'index.html');
    await page.waitForSelector('#start');
    await checkPage('トップ', '1-top');
    await page.click('#start');
    await checkPage('Q1 分野', '2-field');
    await clickOption(page, 0);
    await checkPage('Q2 立場', '3-role');
    await clickOption(page, 2);
    await checkPage('立場別の質問', '4-question');
    for (let i = 0; i < C.roles.C.questions.length; i++) await clickOption(page, 3 % C.roles.C.questions[i].options.length);
    await page.waitForSelector('.screen--result');
    await page.evaluate(() => document.fonts.ready);
    await checkPage('結果', '5-result');
    await page.click('#share-image');
    await page.waitForSelector('.modal__preview img');
    await checkPage('結果画像ダイアログ', '6-modal');
    await page.goto(base + 'r/exec-people.html');
    await checkPage('タイプ別結果ページ', '7-sharepage');
    await ctx.close();
  }

  // ---------- 5. シェア・画像保存 ----------
  console.log('\n[5] シェア・結果画像の保存（端末エミュレーション）');
  const typeId = 'core';
  const a = answersFor(typeId);
  for (const [label, device, mockShare] of [
    ['Android（Pixel 7 / Chrome）', devices['Pixel 7'], false],
    ['Android（Pixel 7 / Chrome・共有あり）', devices['Pixel 7'], true],
    ['iPhone（iPhone 13 / Safari相当）', devices['iPhone 13'], true]
  ]) {
    const ctx = await browser.newContext({ ...device, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
    if (mockShare) {
      // 実機の共有シート（navigator.share）の代わりに呼び出し内容を記録する
      await ctx.addInitScript(() => {
        window.__shared = [];
        navigator.canShare = (d) => !!(d && d.files && d.files.length);
        navigator.share = (d) => { window.__shared.push(d.files.map((f) => ({ name: f.name, type: f.type, size: f.size }))); return Promise.resolve(); };
      });
    }
    const page = await ctx.newPage();
    await runFlow(page, base, { fieldIndex: 0, ...a });
    const share = await page.evaluate(() => ({
      x: document.getElementById('share-x').href,
      line: document.getElementById('share-line').href
    }));
    const pageUrl = base + 'r/' + typeId + '.html';
    const x = new URL(share.x);
    check(x.origin + x.pathname === 'https://twitter.com/intent/tweet' &&
      x.searchParams.get('url') === pageUrl &&
      x.searchParams.get('hashtags') === 'フクマナ,福祉経営' &&
      x.searchParams.get('text').includes(C.types[typeId].name) &&
      x.searchParams.get('text').includes(C.types[typeId].catch), `${label}：Xシェアの文面（タイプ名・キャッチ・URL・ハッシュタグ）`);
    const xText = x.searchParams.get('text');
    const leaks = C.roles[C.types[typeId].role].questions.flatMap((q) => q.options.map((o) => D.plain(o.label))).filter((l) => l.length > 3 && xText.includes(l));
    check(leaks.length === 0, `${label}：シェア文に回答内容が含まれない`);
    const line = new URL(share.line);
    check(line.searchParams.get('url') === pageUrl, `${label}：LINEで送るのURL`);

    await page.click('#share-copy');
    await page.waitForSelector('.toast.is-show');
    const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
    check(clip === pageUrl, `${label}：リンクをコピー（${clip}）`);

    await page.click('#share-image');
    await page.waitForSelector('.modal__preview img');
    const dims = await page.$eval('.modal__preview img', (img) => [img.naturalWidth, img.naturalHeight]);
    check(dims[0] === 1080 && dims[1] === 1080, `${label}：結果画像 ${dims.join('×')}`);
    const buttons = await page.$$eval('.modal__actions button', (b) => b.map((x) => x.textContent));
    const isIOS = /iPhone/.test(device.userAgent);
    if (isIOS) {
      await page.click('.modal__actions button');
      const shared = await page.evaluate(() => window.__shared);
      check(shared.length === 1 && shared[0][0].type === 'image/png' && shared[0][0].size > 10000,
        `${label}：「${buttons[0]}」で共有シート（写真に保存）を呼び出し ${JSON.stringify(shared[0])}`);
    } else {
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.modal__actions button >> nth=0')]);
      const f = path.join(OUT, `download-${mockShare ? 'share' : 'plain'}.png`);
      await dl.saveAs(f);
      const buf = fs.readFileSync(f);
      check(dl.suggestedFilename() === `fukumana-${typeId}.png` && buf.readUInt32BE(16) === 1080 && buf.readUInt32BE(20) === 1080,
        `${label}：「${buttons[0]}」でPNGをダウンロード（${dl.suggestedFilename()}）`);
      if (mockShare) {
        await page.click('.modal__actions button >> nth=1');
        const shared = await page.evaluate(() => window.__shared);
        check(shared.length === 1 && shared[0][0].type === 'image/png', `${label}：「${buttons[1]}」で共有シートを呼び出し`);
      }
    }
    if (label.startsWith('iPhone')) {
      const img = await page.$eval('.modal__preview img', (i) => i.src);
      fs.writeFileSync(path.join(OUT, 'card-' + typeId + '.png'), Buffer.from(img.split(',')[1], 'base64'));
    }
    await ctx.close();
  }

  // ---------- 5b. キャッチコピーの改行 ----------
  console.log('\n[5b] キャッチコピーが読点の位置で改行される（1〜2文字だけの行ができない）');
  for (const width of [360, 390, 768]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    const bad = [];
    for (const id of Object.keys(C.types)) {
      await page.goto(base + `r/${id}.html`);
      await page.evaluate(() => document.fonts.ready);
      const r = await page.evaluate(() => {
        const lh = parseFloat(getComputedStyle(document.querySelector('.result-hero__catch')).lineHeight);
        return Array.from(document.querySelectorAll('.result-hero__catch .phrase')).map((p) => [p.textContent, p.getBoundingClientRect().height <= lh * 1.2]);
      });
      r.filter(([, ok]) => !ok).forEach(([t]) => bad.push(`${id}「${t}」`));
      if (!r.length) bad.push(`${id}：かたまりが見つからない`);
    }
    check(bad.length === 0, `${width}px：9タイプすべてで、読点ごとのかたまりが1行に収まる` + (bad.length ? '：' + bad.join(' ') : ''));
    await page.close();
  }

  // ---------- 5c. タイプを決める質問の改行（{br} の位置） ----------
  console.log('\n[5c] 管理職・経営者の最後の質問：目印 {br} が表示されず、かたまりごとに改行される');
  for (const width of [360, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    for (const roleId of ['B', 'C']) {
      const qs = C.roles[roleId].questions;
      await page.goto(base + 'index.html?field=hoiku');
      await page.click('#start');
      await clickOption(page, ['A', 'B', 'C', 'D'].indexOf(roleId));
      for (let i = 0; i < qs.length - 1; i++) await clickOption(page, 0);
      await page.evaluate(() => document.fonts.ready);
      const r = await page.evaluate(() => {
        const h = document.querySelector('.question');
        const lh = parseFloat(getComputedStyle(h).lineHeight);
        return {
          text: h.textContent,
          shown: document.body.innerText.includes('{'),
          chunks: Array.from(h.querySelectorAll('.phrase')).map((p) => [p.textContent, p.getBoundingClientRect().height <= lh * 1.2])
        };
      });
      const bad = r.chunks.filter(([, ok]) => !ok).map(([t]) => t);
      check(r.text === D.plain(qs[qs.length - 1].text) && !r.shown && bad.length === 0,
        `${width}px ${C.roles[roleId].name}：「${r.chunks.map(([t]) => t).join('／')}」` + (bad.length ? ` 折り返し：${bad.join(',')}` : ''));
    }
    await page.close();
  }

  // ---------- 6. タイプ別結果ページ ----------
  console.log('\n[6] タイプ別結果ページ（シェアされたリンクの先）');
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    for (const id of Object.keys(C.types)) {
      const res = await page.goto(base + `r/${id}.html`);
      const meta = await page.evaluate(() => ({
        title: document.title,
        image: document.querySelector('meta[property="og:image"]').content,
        name: document.querySelector('h1').textContent,
        ctaHref: document.querySelector('.shared-cta a').href,
        groups: Array.from(document.querySelectorAll('.type-group')).map((g) => [g.dataset.group, g.querySelectorAll('li').length]),
        headings: document.querySelectorAll('.type-group h3, .type-group__name').length,
        gap: parseFloat(getComputedStyle(document.querySelector('.type-groups')).rowGap),
        colors: Array.from(document.querySelectorAll('.type-group')).map((g) => Array.from(g.querySelectorAll('a')).map((a) => getComputedStyle(a).color)),
        logo: document.querySelector('.site-header__logo').getAttribute('src')
      }));
      const groupList = Object.entries(C.groups).filter(([k]) => !k.startsWith('_'));
      const expectedGroups = groupList.map(([k]) => [k, Object.values(C.types).filter((t) => t.group === k).length]);
      const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
      const colorsOk = meta.colors.every((cs, i) => cs.every((c) => c === rgb(groupList[i][1].color)));
      check(JSON.stringify(meta.groups) === JSON.stringify(expectedGroups) && meta.headings === 0 && meta.gap > 8 && colorsOk && meta.logo === '../assets/' + C.images.logo,
        `r/${id}.html：タイプ一覧をグループごとに並べ（${meta.groups.map((g) => g.join(':')).join('／')}・間隔${meta.gap}px・見出しなし）、グループ色で表示`);
      check(res.ok() && meta.name === C.types[id].name && meta.image.endsWith(`/assets/ogp/${id}.png`) && meta.ctaHref === base,
        `r/${id}.html：「${meta.title}」・あなたも診断するボタン`);
    }
    await page.close();
  }

  // ---------- 7. アクセス解析（GA4） ----------
  console.log('\n[7] アクセス解析（GA4）：送るイベントと、回答内容を送らないこと');
  {
    // 手元（127.0.0.1）では Google には送信せず、dataLayer に積まれた内容だけを確認する
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await ctx.newPage();
    const gaRequests = [];
    page.on('request', (r) => { if (/googletagmanager|google-analytics/.test(r.url())) gaRequests.push(r.url()); });
    const events = () => page.evaluate(() => (window.dataLayer || []).map((a) => Array.from(a)).filter((a) => a[0] === 'event').map((a) => [a[1], a[2] || {}]));

    await page.goto(base + 'index.html?field=hoiku&src=hoikuhaku');
    await page.waitForSelector('#start');
    const cfg = await page.evaluate(() => (window.dataLayer || []).map((a) => Array.from(a)).find((a) => a[0] === 'config'));
    const loc = new URL(cfg[2].page_location);
    check(cfg[1] === C.analytics.measurementId && loc.searchParams.get('utm_source') === 'hoikuhaku' && loc.searchParams.get('utm_medium') === 'qr',
      `測定ID ${cfg[1]}・流入元 src=hoikuhaku → 参照元/メディア「${loc.searchParams.get('utm_source')} / ${loc.searchParams.get('utm_medium')}」`);

    // 管理職で通しで回答（途中で「戻る」も使う）
    const roleId = 'B';
    const qs = C.roles[roleId].questions;
    await page.click('#start');
    await clickOption(page, ['A', 'B', 'C', 'D'].indexOf(roleId));
    await clickOption(page, 1);
    await page.click('#back');
    await page.waitForTimeout(150);
    await clickOption(page, 2);
    for (let i = 1; i < qs.length; i++) await clickOption(page, i % qs[i].options.length);
    await page.waitForSelector('.screen--result');
    // 結果画面を表示し直しても完了は1回だけ
    await page.goBack();
    await page.waitForTimeout(150);
    await page.goForward();
    await page.waitForTimeout(150);
    if (!(await page.$('.screen--result'))) await clickOption(page, 0);
    await page.waitForSelector('.screen--result');
    const typeId = await page.$eval('.screen--result', (el) => el.dataset.type);

    // 外部サイトは開かずに、クリックだけを確認する
    await page.evaluate(() => document.querySelectorAll('a[target=_blank]').forEach((a) => a.addEventListener('click', (e) => e.preventDefault())));
    for (const sel of ['[data-cta="line"]', '[data-cta="company"]', '#share-x', '#share-line', '#share-copy']) {
      if (await page.$(sel)) await page.click(sel);
    }
    await page.click('#share-image');
    await page.waitForSelector('.modal');

    const ev = await events();
    const names = ev.map((e) => e[0]);
    const reach = ev.filter((e) => e[0] === 'question_reach').map((e) => e[1].question_number);
    const total = 1 + qs.length; // 分野の質問はスキップ（?field=hoiku）
    check(names[0] === 'diagnosis_start' && names.filter((n) => n === 'diagnosis_start').length === 1, '診断の開始：diagnosis_start が1回');
    check(JSON.stringify(reach) === JSON.stringify(Array.from({ length: total }, (_, i) => i + 1)),
      `設問への到達：question_reach が Q1〜Q${total} を1回ずつ（「戻る」で重複しない）：${reach.join(',')}`);
    const done = ev.filter((e) => e[0] === 'diagnosis_complete');
    check(done.length === 1 && done[0][1].role_id === roleId && done[0][1].type_id === typeId && Object.keys(done[0][1]).length === 2,
      `診断の完了：diagnosis_complete が1回（${JSON.stringify(done[0] && done[0][1])}）`);
    const cta = ev.filter((e) => e[0] === 'cta_click').map((e) => e[1].link_type);
    check(JSON.stringify(cta) === JSON.stringify(['line', 'company']), `ボタンのクリック：cta_click（${cta.join(', ')}）`);
    const share = ev.filter((e) => e[0] === 'share_click').map((e) => e[1].share_method);
    check(JSON.stringify(share) === JSON.stringify(['x', 'line', 'copy_link', 'save_image']), `シェアのクリック：share_click（${share.join(', ')}）`);
    const allowed = { diagnosis_start: [], question_reach: ['question_number'], diagnosis_complete: ['role_id', 'type_id'], cta_click: ['link_type', 'type_id'], share_click: ['share_method', 'type_id'] };
    const extra = ev.filter((e) => !allowed[e[0]] || Object.keys(e[1]).some((k) => !allowed[e[0]].includes(k)));
    check(extra.length === 0, '決めたイベント名・項目以外は送らない' + (extra.length ? '：' + JSON.stringify(extra) : ''));
    // 回答内容（選択肢・分野の文言）が送信内容に含まれない
    const answerTexts = Object.values(C.roles).flatMap((r) => r.questions.flatMap((q) => q.options.map((o) => D.plain(o.label))))
      .concat(C.fields.map((f) => f.label), C.roleQuestion.options.map((o) => o.label));
    const sentText = JSON.stringify(await page.evaluate(() => (window.dataLayer || []).map((a) => Array.from(a)).filter((a) => a[0] !== 'js')));
    const leaked = answerTexts.filter((t) => t.length >= 2 && sentText.includes(t));
    check(leaked.length === 0, '回答内容（選択肢・分野の文言）を送っていない' + (leaked.length ? '：' + leaked.join(' / ') : ''));
    check(gaRequests.length === 0 && !(await page.$('script[src*="googletagmanager"]')), '手元（localhost）では Google に送信しない');

    // シェアされたリンクの先（タイプ別ページ）もページの表示だけを計測
    await page.goto(base + 'r/core.html');
    const rcfg = await page.evaluate(() => (window.dataLayer || []).map((a) => Array.from(a)).filter((a) => a[0] === 'config' || a[0] === 'event').map((a) => a[0]));
    check(JSON.stringify(rcfg) === JSON.stringify(['config']), 'タイプ別結果ページ：ページ表示のみ（イベントなし）');
    // SNS用QR
    await page.goto(base + 'index.html?src=sns');
    const scfg = await page.evaluate(() => (window.dataLayer || []).map((a) => Array.from(a)).find((a) => a[0] === 'config'));
    check(new URL(scfg[2].page_location).searchParams.get('utm_source') === 'sns', '流入元 src=sns → 参照元「sns / qr」');
    await ctx.close();
  }

  await browser.close();
  server.close();
  console.log(failed ? `\n${failed}件の問題があります` : '\nすべてのチェックに合格しました');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
