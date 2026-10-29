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
// 管理職・経営者：最後の質問の答えでタイプが決まり、対応する講義が必ずおすすめに入る
const DECIDING = {
  B: {
    text: '今いちばん伸ばしたい力は？いちばん近いものを1つ選んでください',
    options: [
      ['職員一人ひとりを育てる力', 'core'],
      ['チームをまとめ、現場を動かす力', 'core'],
      ['収支や数字で現場の状況を説明する力', 'manager'],
      ['経営の考えを理解し、現場に伝える力', 'manager']
    ]
  },
  C: {
    text: '今いちばん優先したい課題は？いちばん近いものを1つ選んでください',
    options: [
      ['次の幹部・リーダーを育てること', 'exec-people'],
      ['職員が長く働き続けられる職場をつくること', 'exec-people'],
      ['資金繰りや金融機関との関係を安定させること', 'exec-finance'],
      ['決算や税務を含め、経営状況を数字でつかむこと', 'exec-finance'],
      ['必要な職員を採用すること', 'exec-brand'],
      ['利用者や地域から選ばれること', 'exec-brand'],
      ['上記以外の課題がある', 'exec-overall']
    ]
  }
};
for (const [roleId, spec] of Object.entries(DECIDING)) {
  const role = C.roles[roleId];
  const qs = role.questions;
  const pq = qs[qs.length - 1];
  check(pq.text === spec.text && JSON.stringify(pq.options.map((o) => o.label)) === JSON.stringify(spec.options.map((e) => e[0])),
    `${role.name}：最後の質問「${spec.text.split('？')[0]}？」と選択肢の文言が指定どおり`);
  const wrong = [];
  const missing = [];
  let n = 0;
  for (const ans of combos(qs)) {
    n++;
    const r = D.diagnose(C, roleId, ans);
    const k = ans[ans.length - 1];
    if (r.typeId !== spec.options[k][1]) wrong.push(`${ans}→${r.typeId}`);
    const set = pq.options[k].ensureCourses;
    // 「上記以外の課題がある」のように対応する講義を決めていない答えは、点数上位から選ぶ
    if (set && !r.courses.some((c) => set.includes(c))) missing.push(`${ans}`);
  }
  check(wrong.length === 0, `${role.name}：全${n}パターンでタイプが最後の質問の答えどおり` + (wrong.length ? '：' + wrong.slice(0, 5).join(' ') : ''));
  check(missing.length === 0, `${role.name}：全${n}パターンで選んだ答えに対応する講義がおすすめに1件以上入る` + (missing.length ? '：' + missing.slice(0, 5).join(' ') : ''));
}

// 同点（点数の比較）でタイプが決まるケースがないこと：
// すべての立場で、タイプは「答え（tag）」か「固定」で決まり、同じ答えなら他の回答に関係なく同じタイプになる
for (const [roleId, role] of Object.entries(C.roles)) {
  const rule = role.typeRule;
  let byScore = 0;
  let n = 0;
  if (rule.by === 'tag') {
    for (const ans of combos(role.questions)) {
      n++;
      const r = D.diagnose(C, roleId, ans);
      if (r.tags[rule.key] === undefined || r.typeId !== rule.map[r.tags[rule.key]]) byScore++;
    }
  } else if (rule.by === 'fixed') {
    n = [...combos(role.questions)].length;
  } else {
    byScore = -1;
  }
  check(byScore === 0, `${role.name}：同点（点数の比較）でタイプが決まるケース ${byScore < 0 ? '判定方法が不正' : byScore + '件'}／全${n}パターン（${rule.by === 'tag' ? '答えで判定' : '固定'}）`);
}
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
  for (const [id, g] of Object.entries(C.groups).filter(([k]) => !k.startsWith('_'))) {
    const c = contrast(g.color, '#ffffff');
    check(c >= 4.5, `グループ色 ${g.name}（${g.color}）／白 ${c.toFixed(2)}`);
  }
  // シェアページのタイプ一覧で表示中のタイプ：グループ色の文字／明るい色を10%混ぜた背景（css の .types-list a[aria-current]）
  const tint = (hex, p) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * p + 255 * (1 - p)).toString(16).padStart(2, '0')).join('');
  for (const g of Object.entries(C.groups).filter(([k]) => !k.startsWith('_')).map(([, v]) => v)) {
    const c = contrast(g.color, tint(g.accent, 0.1));
    check(c >= 4.5, `タイプ一覧（表示中）${g.name}（${g.color} / ${tint(g.accent, 0.1)}）${c.toFixed(2)}`);
  }
  for (const [id, t] of Object.entries(C.types)) {
    const c = contrast(t.color, '#ffffff');
    check(c >= 4.5, `タイプ色 ${C.types[id].name}（${t.color}）／白 ${c.toFixed(2)}`);
  }
}

console.log(failed ? `\n${failed}件の問題があります` : '\nすべてのチェックに合格しました');
process.exit(failed ? 1 : 0);
