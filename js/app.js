/*
 * 診断画面の制御
 * 文言はすべて data/content.json から読み込みます（このファイルに文言は書きません）。
 */
(function () {
  'use strict';

  var D = window.FukumanaDiagnosis;
  var Card = window.FukumanaCard;
  var app = document.getElementById('app');
  var C = null; // content.json

  var params = new URLSearchParams(location.search);
  var presetFieldId = params.get('field');

  var state = {
    started: false,
    picks: [],     // 選んだ答え（[分野?, 立場, 質問1, 質問2, ...]）
    memo: []       // 「戻る」のときに前の選択を表示するための控え
  };
  var imageJob = null;

  // ---------- 小さなヘルパー ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content;
  }
  function baseUrl() { return new URL('./', location.href.split('#')[0]).href.split('?')[0]; }
  function displayUrl(u) { return u.replace(/^https?:\/\//, '').replace(/\/$/, ''); }
  function img(file) { return 'assets/' + file; }
  // 読点ごとに改行しないかたまりにする（「支える／人。」のような1文字だけの改行を防ぐ）
  function phraseHtml(text) {
    return D.phrases(text).map(function (p) { return '<span class="phrase">' + esc(p) + '</span>'; }).join('');
  }
  var MASCOT_ALT = 'フクマナ公式キャラクター フクノネコ';

  function presetField() {
    return presetFieldId ? D.findField(C, presetFieldId) : null;
  }
  function fieldOffset() { return presetField() ? 0 : 1; }
  function currentField() {
    return presetField() || (state.picks.length ? D.findField(C, state.picks[0]) : null);
  }
  function currentRoleId() { return state.picks[fieldOffset()] || null; }
  function roleAnswers() { return state.picks.slice(fieldOffset() + 1); }

  function totalSteps() {
    var roleId = currentRoleId();
    var qn = roleId ? C.roles[roleId].questions.length
      : Math.max.apply(null, Object.keys(C.roles).map(function (k) { return C.roles[k].questions.length; }));
    return fieldOffset() + 1 + qn;
  }

  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('is-show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { t.classList.remove('is-show'); }, 2200);
  }

  // ---------- 画面遷移 ----------
  function go(push) {
    if (push) history.pushState({ started: state.started, n: state.picks.length }, '');
    render();
  }

  window.addEventListener('popstate', function (e) {
    var s = e.state;
    if (!s || !s.started) {
      state.started = false;
      state.picks = [];
    } else {
      state.started = true;
      if (s.n < state.picks.length) state.picks.length = s.n;
    }
    render();
  });

  // ヘッダーのロゴ：トップは「福祉経営を学ぶなら フクマナ」、設問・結果は「フクマナ」のみ
  function setHeaderLogo(isTop) {
    var logo = document.querySelector('.site-header__logo');
    if (!logo) return;
    var file = isTop ? C.images.logoTop : C.images.logo;
    if (logo.getAttribute('src') !== img(file)) logo.setAttribute('src', img(file));
    logo.setAttribute('alt', isTop ? '福祉経営を学ぶなら フクマナ' : 'フクマナ');
    logo.classList.toggle('site-header__logo--simple', !isTop);
  }

  function render() {
    setHeaderLogo(!state.started);
    if (!state.started) return renderTop();
    if (state.picks.length >= totalSteps()) return renderResult();
    return renderQuestion();
  }

  function focusTitle() {
    window.scrollTo(0, 0);
    var h = app.querySelector('[data-focus]');
    if (h) h.focus({ preventScroll: true });
  }

  // ---------- トップ ----------
  function renderTop() {
    var t = C.top;
    app.innerHTML = '';
    app.appendChild(el(
      '<section class="screen screen--top">' +
        '<img class="mascot mascot--top" src="' + esc(img(C.images.top)) + '" alt="' + MASCOT_ALT + '" width="240" height="240">' +
        '<p class="eyebrow">' + esc(t.eyebrow) + '</p>' +
        '<h1 class="top-title" tabindex="-1" data-focus>' + t.title.split(' ').map(function (w) { return '<span class="nowrap">' + esc(w) + '</span>'; }).join(' ') + '</h1>' +
        '<p class="lead">' + esc(t.lead) + '</p>' +
        '<ul class="badges">' +
          '<li class="badge">⏱ ' + esc(t.time) + '</li>' +
        '</ul>' +
        '<p class="privacy">🔒 ' + esc(t.privacy) + '</p>' +
        '<button type="button" class="btn btn--primary btn--large" id="start">' + esc(t.start) + '</button>' +
      '</section>'
    ));
    document.getElementById('start').addEventListener('click', function () {
      state.started = true;
      state.picks = [];
      state.memo = [];
      go(true);
    });
    focusTitle();
  }

  // ---------- 質問 ----------
  function questionAt(step) {
    var field = currentField();
    var off = fieldOffset();
    if (step < off) {
      return {
        text: C.fieldQuestion.text,
        note: C.fieldQuestion.note,
        mascot: C.images.basicQuestion,
        options: C.fields.map(function (f) { return { value: f.id, label: f.label }; })
      };
    }
    if (step === off) {
      return {
        text: C.roleQuestion.text,
        mascot: C.images.basicQuestion,
        options: C.roleQuestion.options.map(function (o) {
          return { value: o.id, label: o.label, sub: field.roleNotes[o.id] };
        })
      };
    }
    var q = C.roles[currentRoleId()].questions[step - off - 1];
    return {
      text: D.fill(q.text, field),
      note: q.note ? D.fill(q.note, field) : '',
      mascot: q.mascot || C.images.question,
      options: q.options.map(function (o, i) { return { value: i, label: D.fill(o.label, field) }; })
    };
  }

  function renderQuestion() {
    var step = state.picks.length;
    var total = totalSteps();
    var q = questionAt(step);
    var prev = state.memo[step];
    var pct = Math.round((step / total) * 100);

    var opts = q.options.map(function (o, i) {
      var selected = prev === o.value && state.memo.length > step ? ' is-selected' : '';
      return '<li><button type="button" class="option' + selected + '" data-i="' + i + '">' +
        '<span class="option__label">' + phraseHtml(o.label) + '</span>' +
        (o.sub ? '<span class="option__sub">' + esc(o.sub) + '</span>' : '') +
        '</button></li>';
    }).join('');

    app.innerHTML = '';
    app.appendChild(el(
      '<section class="screen screen--question">' +
        '<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="' + total + '" aria-valuenow="' + step + '" aria-label="進み具合">' +
          '<div class="progress__bar" style="width:' + pct + '%"></div>' +
        '</div>' +
        '<p class="progress__text">Q' + (step + 1) + ' <span>/ ' + total + '</span></p>' +
        '<div class="question-head">' +
          '<img class="mascot mascot--question" src="' + esc(img(q.mascot)) + '" alt="" width="96" height="96">' +
          '<h2 class="question" tabindex="-1" data-focus>' + phraseHtml(q.text) + '</h2>' +
        '</div>' +
        (q.note ? '<p class="question__note">' + esc(q.note) + '</p>' : '') +
        '<ul class="options">' + opts + '</ul>' +
        '<button type="button" class="btn btn--ghost btn--back" id="back">← 戻る</button>' +
      '</section>'
    ));

    var busy = false;
    app.querySelectorAll('.option').forEach(function (b) {
      b.addEventListener('click', function () {
        if (busy) return;
        busy = true;
        app.querySelectorAll('.option').forEach(function (x) { x.classList.remove('is-selected'); });
        b.classList.add('is-selected');
        var value = q.options[+b.getAttribute('data-i')].value;
        // 分野・立場を変えたら、それ以降の控えは使わない
        if (state.memo[step] !== value && step <= fieldOffset()) state.memo = state.memo.slice(0, step);
        state.memo[step] = value;
        setTimeout(function () {
          state.picks.push(value);
          go(true);
        }, 160);
      });
    });
    document.getElementById('back').addEventListener('click', function () { history.back(); });
    focusTitle();
  }

  // ---------- 結果 ----------
  function shareInfo(typeId, type) {
    var url = new URL('r/' + typeId + '.html', baseUrl()).href;
    var text = C.site.shareText.replace('{name}', D.plain(type.name)).replace('{catch}', D.plain(type.catch));
    return {
      url: url,
      text: text,
      x: 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) +
        '&url=' + encodeURIComponent(url) +
        '&hashtags=' + encodeURIComponent(C.site.hashtags.join(',')),
      line: 'https://social-plugins.line.me/lineit/share?url=' + encodeURIComponent(url)
    };
  }

  function ctaHtml(cta) {
    var href = C.links[cta.link];
    return '<div class="cta">' +
      (cta.heading ? '<p class="cta__heading">' + esc(cta.heading) + '</p>' : '') +
      '<a class="btn btn--' + (cta.style === 'primary' ? 'primary' : 'secondary') + ' btn--block" href="' + esc(href) +
        '" target="_blank" rel="noopener" data-cta="' + esc(cta.link) + '">' + esc(cta.label) + '</a>' +
      (cta.sub ? '<p class="cta__sub">' + esc(cta.sub) + '</p>' : '') +
      '</div>';
  }

  function renderResult() {
    var field = currentField();
    var r = D.diagnose(C, currentRoleId(), roleAnswers());
    var type = r.type;
    var R = C.result;
    var share = shareInfo(r.typeId, type);

    var courses = r.courses.map(function (id, i) {
      var c = C.courses[id];
      return '<li class="course">' +
        '<span class="course__no">' + (i + 1) + '</span>' +
        '<div><p class="course__kind">' + esc(c.kind) + '</p>' +
        '<p class="course__name">' + esc(c.name) + '</p>' +
        '<p class="course__desc">' + esc(c.desc) + '</p></div></li>';
    }).join('');

    app.innerHTML = '';
    app.appendChild(el(
      '<section class="screen screen--result" style="--type-color:' + esc(type.color) + ';--type-accent:' + esc(type.accent) + '" data-type="' + esc(r.typeId) + '" data-group="' + esc(type.group) + '">' +
        '<div class="result-hero">' +
          '<p class="result-hero__label">' + esc(R.label) + '</p>' +
          '<img class="mascot mascot--result" src="' + esc(img(type.mascot)) + '" alt="' + MASCOT_ALT + '" width="180" height="180">' +
          '<h1 class="result-hero__name" tabindex="-1" data-focus>' + esc(type.name) + '</h1>' +
          '<p class="result-hero__catch">' + phraseHtml(type.catch) + '</p>' +
          '<p class="result-hero__desc">' + esc(D.fill(r.description, field)) + '</p>' +
        '</div>' +

        '<div class="block">' +
          '<h2 class="block__title">' + esc(R.areasTitle) + '</h2>' +
          '<ul class="chips">' + r.areas.map(function (a) { return '<li class="chip">' + esc(a) + '</li>'; }).join('') + '</ul>' +
        '</div>' +

        '<div class="block">' +
          '<h2 class="block__title">' + esc(R.coursesTitle) + '</h2>' +
          '<ol class="courses">' + courses + '</ol>' +
        '</div>' +

        '<div class="block">' +
          '<h2 class="block__title">' + esc(R.adviceTitle) + '</h2>' +
          r.advice.map(function (a) { return '<p class="advice">' + esc(D.fill(a, field)) + '</p>'; }).join('') +
        '</div>' +

        '<div class="block block--next">' +
          '<h2 class="block__title">' + esc(R.nextTitle) + '</h2>' +
          type.ctas.map(ctaHtml).join('') +
        '</div>' +

        '<div class="block">' +
          '<h2 class="block__title">' + esc(R.shareTitle) + '</h2>' +
          '<div class="share">' +
            '<a class="share__btn share__btn--x" id="share-x" href="' + esc(share.x) + '" target="_blank" rel="noopener">Xでシェア</a>' +
            '<a class="share__btn share__btn--line" id="share-line" href="' + esc(share.line) + '" target="_blank" rel="noopener">LINEで送る</a>' +
            '<button type="button" class="share__btn share__btn--copy" id="share-copy">リンクをコピー</button>' +
            '<button type="button" class="share__btn share__btn--image" id="share-image">結果画像を保存</button>' +
          '</div>' +
          '<p class="share__note">' + esc(R.shareNote) + '</p>' +
        '</div>' +

        '<button type="button" class="btn btn--ghost btn--block" id="retry">' + esc(R.retry) + '</button>' +
      '</section>'
    ));

    document.getElementById('share-copy').addEventListener('click', function () { copyText(share.url); });
    document.getElementById('retry').addEventListener('click', function () {
      state.picks = [];
      state.memo = [];
      state.started = true;
      history.replaceState({ started: false, n: 0 }, '');
      go(true);
    });

    // 画像はあらかじめ作っておく（保存ボタンを押した瞬間に共有シートを開けるように）
    imageJob = makeImage(r.typeId, type);
    document.getElementById('share-image').addEventListener('click', function () {
      openImageDialog(imageJob, r.typeId);
    });
    focusTitle();
  }

  // ---------- リンクのコピー ----------
  function copyText(text) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      toast(ok ? 'リンクをコピーしました' : 'コピーできませんでした');
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { toast('リンクをコピーしました'); }, fallback);
    } else {
      fallback();
    }
  }

  // ---------- 結果画像 ----------
  function makeImage(typeId, type) {
    var text = C.site.shortTitle + D.plain(type.name) + D.plain(type.catch) + 'わたしの学びタイプはあなたも約2分で診断できます' + displayUrl(baseUrl()) + '#フクマナ福祉経営';
    return Promise.all([
      Card.loadImage(img(type.mascot)),
      Card.loadImage(img(C.images.icon)),
      Card.waitFonts(text)
    ]).then(function (res) {
      var canvas = document.createElement('canvas');
      Card.draw(canvas, {
        layout: 'square',
        title: C.site.shortTitle,
        label: 'わたしの学びタイプは',
        name: D.plain(type.name),
        catch: D.plain(type.catch),
        color: type.color,
        accent: type.accent,
        url: displayUrl(baseUrl()),
        footer: 'あなたも約2分で診断できます',
        hashtags: C.site.hashtags.map(function (h) { return '#' + h; }).join(' '),
        mascot: res[0],
        icon: res[1]
      });
      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          if (!blob) return reject(new Error('toBlob failed'));
          resolve({
            blob: blob,
            dataUrl: canvas.toDataURL('image/png'),
            file: typeof File === 'function' ? new File([blob], 'fukumana-' + typeId + '.png', { type: 'image/png' }) : null
          });
        }, 'image/png');
      });
    });
  }

  function isIOS() {
    return /iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  }
  function canShareFile(file) {
    try { return !!(file && navigator.canShare && navigator.canShare({ files: [file] })); } catch (e) { return false; }
  }

  function download(img, typeId) {
    var url = URL.createObjectURL(img.blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'fukumana-' + typeId + '.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  function shareFile(img) {
    navigator.share({ files: [img.file] }).catch(function (e) {
      if (e && e.name === 'AbortError') return;
      toast('共有できませんでした。画像を長押しして保存してください');
    });
  }

  function openImageDialog(job, typeId) {
    var dlg = document.createElement('div');
    dlg.className = 'modal';
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-label', '結果画像');
    dlg.innerHTML =
      '<div class="modal__body">' +
        '<p class="modal__title">結果画像（1080×1080）</p>' +
        '<div class="modal__preview"><p class="loading">画像を作成中…</p></div>' +
        '<div class="modal__actions"></div>' +
        '<p class="modal__hint">うまく保存できないときは、画像を長押しして「写真に追加」「画像をダウンロード」を選んでください。</p>' +
        '<button type="button" class="btn btn--ghost btn--block" data-close>閉じる</button>' +
      '</div>';
    document.body.appendChild(dlg);
    document.body.classList.add('is-modal-open');

    function close() {
      document.body.classList.remove('is-modal-open');
      dlg.remove();
      document.getElementById('share-image').focus();
    }
    dlg.addEventListener('click', function (e) {
      if (e.target === dlg || e.target.hasAttribute('data-close')) close();
    });
    dlg.querySelector('[data-close]').focus();

    job.then(function (img) {
      dlg.querySelector('.modal__preview').innerHTML =
        '<img src="' + img.dataUrl + '" alt="結果画像のプレビュー">';
      var actions = dlg.querySelector('.modal__actions');
      var sharable = canShareFile(img.file);
      var buttons = [];
      if (isIOS() && sharable) {
        // iPhone は共有シートの「画像を保存」で写真アプリに保存できる
        buttons.push(['画像を保存・共有', function () { shareFile(img); }, 'primary']);
      } else {
        buttons.push(['画像を保存', function () { download(img, typeId); toast('画像を保存しました'); }, 'primary']);
        if (sharable) buttons.push(['アプリで共有（Instagram など）', function () { shareFile(img); }, 'secondary']);
      }
      buttons.forEach(function (b) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn--' + b[2] + ' btn--block';
        btn.textContent = b[0];
        btn.addEventListener('click', b[1]);
        actions.appendChild(btn);
      });
    }).catch(function () {
      dlg.querySelector('.modal__preview').innerHTML = '<p class="loading">画像を作成できませんでした。時間をおいてお試しください。</p>';
    });
  }

  // ---------- フッター ----------
  function renderFooter() {
    var L = C.links, F = C.footer;
    document.getElementById('footer').innerHTML =
      '<p><a href="' + esc(L.top) + '" target="_blank" rel="noopener">フクマナ（福祉経営を学ぶeラーニング）</a></p>' +
      '<p>' + esc(F.operator) + '</p>' +
      '<p>' + esc(F.contactLabel) + ' <a href="mailto:' + esc(L.contactEmail) + '">' + esc(L.contactEmail) + '</a></p>';
  }

  // ---------- 起動 ----------
  fetch('data/content.json', { cache: 'no-cache' })
    .then(function (res) {
      if (!res.ok) throw new Error(res.status);
      return res.json();
    })
    .then(function (json) {
      C = json;
      if (presetFieldId && !D.findField(C, presetFieldId)) presetFieldId = null;
      renderFooter();
      history.replaceState({ started: false, n: 0 }, '');
      render();
    })
    .catch(function () {
      app.innerHTML = '<p class="loading">読み込みに失敗しました。ページを再読み込みしてください。</p>';
    });
})();
