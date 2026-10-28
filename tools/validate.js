/*
 * data/content.json の書き間違いをチェックします（build と test で使用）。
 */
'use strict';

// 7章「リンク先（変更しないこと）」
const EXPECTED_LINKS = {
  line: 'https://lin.ee/ru4M1zks',
  company: 'https://fukunone.org/company-plan/',
  keiei: 'https://wwmc.fukunone.org/curriculum/index.html#keiei',
  top: 'https://wwmc.fukunone.org/',
  contactEmail: 'support@fukunone.org'
};

function validate(C) {
  const errors = [];
  const courseIds = Object.keys(C.courses || {});
  const typeIds = Object.keys(C.types || {});

  for (const [k, v] of Object.entries(EXPECTED_LINKS)) {
    if (!C.links || C.links[k] !== v) errors.push(`links.${k} が仕様のURL（${v}）と異なります`);
  }
  if (!/^https:\/\/.+\/$/.test(C.site && C.site.url || '')) errors.push('site.url は https:// で始まり / で終わる公開URLにしてください');

  const fieldIds = (C.fields || []).map((f) => f.id);
  if (!fieldIds.includes('hoiku')) errors.push('fields に hoiku（保育）がありません');
  (C.fields || []).forEach((f) => {
    ['label', 'place', 'staff'].forEach((k) => { if (!f[k]) errors.push(`fields.${f.id}.${k} が空です`); });
    ['A', 'B', 'C', 'D'].forEach((r) => { if (!f.roleNotes || !f.roleNotes[r]) errors.push(`fields.${f.id}.roleNotes.${r} が空です`); });
  });

  for (const [rid, role] of Object.entries(C.roles || {})) {
    const n = role.questions.length;
    if (n < 4 || n > 6) errors.push(`roles.${rid} の質問数が ${n} 問です（4〜6問にしてください）`);
    role.questions.forEach((q, qi) => {
      if (!q.text) errors.push(`roles.${rid} の${qi + 1}問目に text がありません`);
      if (!q.options || q.options.length < 2 || q.options.length > 5) errors.push(`roles.${rid} の${qi + 1}問目の選択肢は2〜5個にしてください`);
      (q.options || []).forEach((o, oi) => {
        if (!o.label) errors.push(`roles.${rid} の${qi + 1}問目・選択肢${oi + 1}に label がありません`);
        Object.keys(o.scores || {}).forEach((c) => {
          if (!courseIds.includes(c)) errors.push(`roles.${rid} の${qi + 1}問目で未定義の講義「${c}」が使われています`);
        });
      });
    });
    role.priority.forEach((c) => { if (!courseIds.includes(c)) errors.push(`roles.${rid}.priority に未定義の講義「${c}」があります`); });
    const rule = role.typeRule;
    const ruleTypes = rule.by === 'fixed' ? [rule.type] : rule.by === 'tag' ? Object.values(rule.map) : rule.groups.map((g) => g.type);
    ruleTypes.forEach((t) => { if (!typeIds.includes(t)) errors.push(`roles.${rid}.typeRule に未定義のタイプ「${t}」があります`); });
  }

  for (const [tid, t] of Object.entries(C.types || {})) {
    if (!/^[a-z0-9-]+$/.test(tid)) errors.push(`タイプID「${tid}」は半角英小文字・数字・ハイフンのみにしてください（結果ページのURLになります）`);
    ['name', 'catch', 'description', 'color'].forEach((k) => { if (!t[k]) errors.push(`types.${tid}.${k} が空です`); });
    if (!C.roles[t.role]) errors.push(`types.${tid}.role「${t.role}」が不正です`);
    (t.ctas || []).forEach((c) => { if (!C.links[c.link]) errors.push(`types.${tid}.ctas の link「${c.link}」が links にありません`); });
    if (!t.ctas || !t.ctas.length) errors.push(`types.${tid}.ctas が空です`);
    (t.mustInclude || []).forEach((c) => { if (!courseIds.includes(c)) errors.push(`types.${tid}.mustInclude に未定義の講義「${c}」があります`); });
  }
  return errors;
}

module.exports = { validate, EXPECTED_LINKS };
