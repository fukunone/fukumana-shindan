#!/usr/bin/env node
/*
 * 仕様書10章の確認事項のうち、ブラウザを使わずに確認できるものを自動チェックします。
 *   1. content.json の書き間違い
 *   2. 4分野×4立場の「すべての回答の組み合わせ」で診断が成立し、全タイプが出ること
 *   3. 禁止表現・価格表記・制度/数値の記述がないこと
 *   4. 外部リンクが仕様7章のURLどおりであること
 * 使い方:  npm test
 */
'use strict';

const fs = require('fs');
const path = require('path');
const D = require('../js/diagnosis');
const { validate, EXPECTED_LINKS } = require('./validate');

const ROOT = path.resolve(__dirname, '..');
const C = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/content.json'), 'utf8'));
let failed = 0;
function check(ok, msg) {
  console.log((ok ? '  ✔ ' : '  ✘ ') + msg);
  if (!ok) failed++;
}

// ---------- 1. content.json ----------
console.log('\n[1] content.json の構造');
const errors = validate(C, ROOT);
check(errors.length === 0, 'content.json の構造チェック' + (errors.length ? '：\n     ' + errors.join('\n     ') : ''));

// ---------- 2. 全パターン ----------
console.log('\n[2] 4分野×4立場 × 全回答パターン');
function* combos(questions, i = 0, acc = []) {
  if (i === questions.length) { yield acc.slice(); return; }
  for (let k = 0; k < questions[i].options.length; k++) {
    acc.push(k);
    yield* combos(questions, i + 1, acc);
    acc.pop();
  }
}
const seen = {};
let total = 0;
const problems = [];
for (const field of C.fields) {
  for (const roleId of Object.keys(C.roles)) {
    const role = C.roles[roleId];
    let n = 0;
    for (const ans of combos(role.questions)) {
      const r = D.diagnose(C, roleId, ans);
      n++;
      seen[r.typeId] = (seen[r.typeId] || 0) + 1;
      const texts = [r.type.name, r.type.catch, D.fill(r.description, field)].concat(r.advice.map((a) => D.fill(a, field)));
      if (!r.type || r.type.role !== roleId) problems.push(`${field.id}/${roleId}/${ans}: 立場と異なるタイプ ${r.typeId}`);
      if (r.courses.length !== 3 || new Set(r.courses).size !== 3) problems.push(`${field.id}/${roleId}/${ans}: おすすめ講義が3件ではない`);
      (r.type.mustInclude || []).forEach((c) => { if (!r.courses.includes(c)) problems.push(`${field.id}/${roleId}/${ans}: ${c} が含まれない`); });
      if (r.advice.length < 2) problems.push(`${field.id}/${roleId}/${ans}: 学び方アドバイスが不足`);
      if (!r.areas.length) problems.push(`${field.id}/${roleId}/${ans}: 伸びしろ分野が空`);
      if (texts.some((t) => !t || /\{\w+\}/.test(t))) problems.push(`${field.id}/${roleId}/${ans}: 空の文言または置換漏れ`);
    }
    // 質問文・選択肢の置換漏れ
    role.questions.forEach((q) => {
      [q.text, q.note].concat(q.options.map((o) => o.label)).forEach((t) => {
        if (t && /\{\w+\}/.test(D.fill(t, field))) problems.push(`${field.id}/${roleId}: 置換漏れ「${t}」`);
      });
    });
    total += n;
    console.log(`     ${field.label.padEnd(6, '　')} × ${roleId}（${role.name}）: ${n}パターン`);
  }
}
check(problems.length === 0, `全${total}パターンで診断結果が成立` + (problems.length ? '：\n     ' + problems.slice(0, 20).join('\n     ') : ''));
for (const id of Object.keys(C.types)) {
  check(seen[id] > 0, `タイプ「${C.types[id].name}」が出現する（${seen[id] || 0}パターン）`);
}
// D：開業時期による出し分け
['soon', 'mid', 'undecided'].forEach((t, i) => {
  const r = D.diagnose(C, 'D', [i, 0, 0, 0, 0]);
  check(r.description === C.types.kaigyo.descriptionByTag[t], `開業準備タイプ：時期「${C.roles.D.questions[0].options[i].label}」の結果文`);
});
// A：開業志向は開業・財務会計を必ず含む
check(['kaigyo', 'finance'].every((c) => D.diagnose(C, 'A', [2, 0, 2, 0, 0, 0]).courses.includes(c)), '未来の経営者タイプ：関心が低くても「開業」「財務・会計」を推薦');

// ---------- 3・4. サイトのファイルを走査 ----------
function siteFiles() {
  const out = ['index.html', 'data/content.json', 'css/style.css'];
  for (const dir of ['js', 'r']) {
    fs.readdirSync(path.join(ROOT, dir)).forEach((f) => out.push(`${dir}/${f}`));
  }
  return out;
}
const files = siteFiles().map((f) => ({ f, s: fs.readFileSync(path.join(ROOT, f), 'utf8') }));

console.log('\n[3] 禁止表現・価格表記・制度/数値');
const BANNED = [
  [/儲|もうけ|モウケ|儲け|稼/, '営利的表現（もうけ・儲・稼）'],
  [/[0-9０-９,，]+\s*円|￥|¥|\bJPY\b|価格|料金|税込|税抜|月額|年額|割引|% ?OFF/i, '価格表記'],
  [/加算|報酬改定|算定|[0-9０-９.]+\s*[%％]/, '制度・数値（加算名・統計）'],
  [/弱み|弱点|苦手分野|欠点/, '否定的な表現（「伸びしろ」と表現する）']
];
for (const [re, label] of BANNED) {
  const hits = [];
  files.filter(({ f }) => !f.endsWith('.css')).forEach(({ f, s }) => s.split('\n').forEach((line, i) => { if (re.test(line)) hits.push(`${f}:${i + 1} ${line.trim().slice(0, 60)}`); }));
  check(hits.length === 0, `${label} を含まない` + (hits.length ? '：\n     ' + hits.join('\n     ') : ''));
}

console.log('\n[4] 外部リンク');
const ALLOWED_PREFIX = [
  'https://fonts.googleapis.com', 'https://fonts.gstatic.com',            // フォント
  'https://twitter.com/intent/tweet', 'https://social-plugins.line.me/lineit/share', // シェア
  C.site.url                                                              // 自サイト（OGP）
];
const linkValues = Object.values(EXPECTED_LINKS);
const urlHits = [];
files.forEach(({ f, s }) => {
  (s.match(/https?:\/\/[^\s"'<>)\\]+/g) || []).forEach((u) => {
    if (linkValues.includes(u)) return;
    if (ALLOWED_PREFIX.some((p) => u.startsWith(p))) return;
    if (f === 'js/card.js' || f === 'js/diagnosis.js') return;
    urlHits.push(`${f}: ${u}`);
  });
  (s.match(/mailto:[^\s"'<>]+/g) || []).forEach((m) => {
    if (m !== 'mailto:' + EXPECTED_LINKS.contactEmail && !/mailto:'\s*$/.test(m)) urlHits.push(`${f}: ${m}`);
  });
});
check(urlHits.length === 0, '7章以外のURLが使われていない' + (urlHits.length ? '：\n     ' + urlHits.join('\n     ') : ''));
for (const [k, v] of Object.entries(EXPECTED_LINKS)) {
  check(C.links[k] === v, `links.${k} = ${v}`);
}
// 結果ページのOGP
for (const id of Object.keys(C.types)) {
  const html = fs.readFileSync(path.join(ROOT, `r/${id}.html`), 'utf8');
  check(html.includes(`content="${C.site.url}assets/ogp/${id}.png"`) && fs.existsSync(path.join(ROOT, `assets/ogp/${id}.png`)),
    `r/${id}.html に OGP画像（assets/ogp/${id}.png）が設定されている`);
}

// ---------- 5. 配色のコントラスト ----------
console.log('\n[5] 配色のコントラスト（文字 4.5 以上）');
{
  const { contrast } = require('./validate');
  const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  const v = {};
  (css.match(/--color-[\w-]+:\s*#[0-9a-fA-F]{6}/g) || []).forEach((m) => {
    const [k, val] = m.split(/:\s*/);
    v[k.replace('--color-', '')] = val;
  });
  const pairs = [
    ['text', 'bg', '本文／背景'], ['text', 'surface', '本文／カード'], ['sub', 'bg', '補足文／背景'], ['sub', 'surface', '補足文／カード'],
    ['accent-text', 'bg', 'リンク・Q番号／背景'], ['accent-text', 'surface', 'リンク／カード'], ['brand', 'tint', '注意書き・選択中／淡い背景'],
    ['text', 'tint', '本文／淡い背景'], ['brand', 'surface', '副ボタン文字／白'], ['line-app-text', 'line-app', 'LINEボタン']
  ];
  pairs.forEach(([fg, bg, label]) => {
    const r = contrast(v[fg], v[bg]);
    check(r >= 4.5, `${label}（${v[fg]} / ${v[bg]}）${r.toFixed(2)}`);
  });
  const r = contrast('#ffffff', v.brand);
  check(r >= 4.5, `メインボタン 白文字／${v.brand} ${r.toFixed(2)}`);
  for (const [id, t] of Object.entries(C.types)) {
    const c = contrast(t.color, '#ffffff');
    check(c >= 4.5, `タイプ色 ${C.types[id].name}（${t.color}）／白 ${c.toFixed(2)}`);
  }
}

console.log(failed ? `\n${failed}件の問題があります` : '\nすべてのチェックに合格しました');
process.exit(failed ? 1 : 0);
