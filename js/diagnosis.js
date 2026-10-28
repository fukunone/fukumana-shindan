/*
 * 診断ロジック（画面に依存しない純粋な計算部分）
 * ブラウザでは window.FukumanaDiagnosis、Node.js（テスト・ビルド）では require で使います。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FukumanaDiagnosis = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var GENERIC_FIELD = { place: '職場', staff: '職員' };

  /** {place} {staff} を分野ごとの呼び方に置き換える */
  function fill(text, field) {
    var f = field || GENERIC_FIELD;
    return String(text == null ? '' : text)
      .replace(/\{place\}/g, f.place)
      .replace(/\{staff\}/g, f.staff);
  }

  /** 読点「、」と「？」の後ろで区切る（画面で改行位置をそろえるため）。例：「人が育つ職場を、」「まんなかで支える人。」 */
  function phrases(text) {
    // 古い iPhone でも動くよう、後読みの正規表現は使わない
    return String(text == null ? '' : text).replace(/([、？])/g, '$1\n').split('\n').filter(function (p) { return p; });
  }

  function findField(content, id) {
    for (var i = 0; i < content.fields.length; i++) {
      if (content.fields[i].id === id) return content.fields[i];
    }
    return null;
  }

  /**
   * @param content   data/content.json の中身
   * @param roleId    'A' | 'B' | 'C' | 'D'
   * @param answers   立場別の各質問で選んだ選択肢の番号（0始まり）の配列
   */
  function diagnose(content, roleId, answers) {
    var role = content.roles[roleId];
    if (!role) throw new Error('unknown role: ' + roleId);

    var scores = {};
    Object.keys(content.courses).forEach(function (id) { scores[id] = 0; });
    var tags = {};
    var ensures = []; // 選んだ回答に対応する講義の候補（それぞれ1件以上をおすすめに入れる）

    role.questions.forEach(function (q, i) {
      var opt = q.options[answers[i]];
      if (!opt) return;
      var s = opt.scores || {};
      Object.keys(s).forEach(function (id) { scores[id] = (scores[id] || 0) + s[id]; });
      var t = opt.tags || {};
      Object.keys(t).forEach(function (k) { tags[k] = t[k]; });
      if (opt.ensureCourses && opt.ensureCourses.length) ensures.push(opt.ensureCourses);
    });

    // スコア順に並べる（同点は立場ごとの priority 順）
    var priority = role.priority;
    var rankOf = function (id) {
      var p = priority.indexOf(id);
      return p < 0 ? 999 : p;
    };
    var ranking = Object.keys(scores).sort(function (a, b) {
      return (scores[b] - scores[a]) || (rankOf(a) - rankOf(b));
    });

    // タイプ判定
    var rule = role.typeRule;
    var typeId;
    if (rule.by === 'fixed') {
      typeId = rule.type;
    } else if (rule.by === 'tag') {
      typeId = rule.map[tags[rule.key]] || rule.map[Object.keys(rule.map)[0]];
    } else if (rule.by === 'group') {
      var best = -1;
      rule.groups.forEach(function (g) {
        var v = Math.max.apply(null, g.courses.map(function (id) { return scores[id] || 0; }));
        if (v > best) { best = v; typeId = g.type; }
      });
    }
    var type = content.types[typeId];

    // おすすめ講義（上位3件。タイプによって必ず含める講義あり）
    var must = (type.mustInclude || []).slice();
    var picked = must.slice();
    ranking.forEach(function (id) {
      if (picked.length < 3 && picked.indexOf(id) < 0) picked.push(id);
    });
    // 優先課題などに対応する講義が1件も入っていなければ、候補のうち点数がいちばん高い講義と入れ替える
    var fixed = must.slice();
    ensures.forEach(function (set) {
      var hit = picked.filter(function (id) { return set.indexOf(id) >= 0; })[0];
      if (hit) { fixed.push(hit); return; }
      var add = ranking.filter(function (id) { return set.indexOf(id) >= 0; })[0];
      // 入れ替えるのは、必須でない講義のうち順位がいちばん低いもの
      for (var i = picked.length - 1; i >= 0; i--) {
        if (fixed.indexOf(picked[i]) < 0) { picked[i] = add; fixed.push(add); break; }
      }
    });
    picked.sort(function (a, b) { return ranking.indexOf(a) - ranking.indexOf(b); });

    // 伸びしろ分野
    var areas = [];
    picked.forEach(function (id) {
      var a = content.courses[id].area;
      if (areas.indexOf(a) < 0) areas.push(a);
    });

    // 結果文（時期などで出し分け）
    var description = type.description;
    if (type.descriptionByTag && tags[type.descriptionByTag.key] && type.descriptionByTag[tags[type.descriptionByTag.key]]) {
      description = type.descriptionByTag[tags[type.descriptionByTag.key]];
    }

    // 学び方アドバイス
    var advice = [content.advice.base];
    var ra = role.advice || {};
    if (ra.key && ra.byTag && ra.byTag[tags[ra.key]]) advice.push(ra.byTag[tags[ra.key]]);
    else if (ra.default) advice.push(ra.default);

    return {
      typeId: typeId,
      type: type,
      description: description,
      courses: picked,
      areas: areas,
      advice: advice,
      scores: scores,
      tags: tags
    };
  }

  return { fill: fill, phrases: phrases, findField: findField, diagnose: diagnose, GENERIC_FIELD: GENERIC_FIELD };
});
