/*
 * 結果カード画像の描画（Canvas）
 * - 結果画面の「結果画像を保存」（1080×1080）
 * - tools/build.mjs による OGP 画像の生成（1200×630）
 * の両方で同じコードを使います。
 */
(function (root) {
  'use strict';

  var FONT = '"Zen Maru Gothic", "Hiragino Maru Gothic ProN", "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif';

  var THEME = {
    bg: '#fff6e9',
    card: '#ffffff',
    text: '#3b3430',
    sub: '#7a6c62',
    brand: '#f08a3c'
  };

  // 行頭に置かない文字（簡易禁則）
  var NO_LINE_START = '、。，．・：；？！ー」』）】〉》ぁぃぅぇぉっゃゅょァィゥェォッャュョ…';

  var HIRA = /[ぁ-ゟ]/;
  var KATA = /[゠-ヿ]/;
  var BREAK_AFTER = '、。！？ 　）」』';

  // prev と cur の間で改行するときの「不自然さ」（小さいほど自然）
  function breakPenalty(prev, cur) {
    if (NO_LINE_START.indexOf(cur) >= 0) return 99;
    if (BREAK_AFTER.indexOf(prev) >= 0 || cur === ' ' || cur === '　') return 0;
    if (HIRA.test(prev) && !HIRA.test(cur)) return 1;   // 例：「つくる｜経営者」
    if (KATA.test(prev) && KATA.test(cur)) return 6;    // カタカナ語の途中
    if (KATA.test(prev) !== KATA.test(cur) && !HIRA.test(cur)) return 2; // 例：「候補｜タイプ」
    if (!HIRA.test(prev) && HIRA.test(cur)) return 4;
    return 3;
  }

  function wrap(ctx, text, maxWidth) {
    var lines = [];
    var line = [];
    var chars = Array.from(text);
    for (var i = 0; i < chars.length; i++) {
      var ch = chars[i];
      if (ch === '\n') { lines.push(line.join('')); line = []; continue; }
      line.push(ch);
      if (line.length > 1 && ctx.measureText(line.join('')).width > maxWidth) {
        // 行の後半で、いちばん自然な位置を探して改行する
        var best = line.length - 1, bestP = 999;
        for (var j = line.length - 1; j >= 1; j--) {
          // 1行目が極端に短くなる位置は少し不利にする
          var p = breakPenalty(line[j - 1], line[j]) + (j < line.length * 0.4 ? 3 : 0);
          if (p < bestP) { bestP = p; best = j; }
        }
        lines.push(line.slice(0, best).join('').replace(/[ 　]+$/, ''));
        line = line.slice(best);
        while (line.length && (line[0] === ' ' || line[0] === '　')) line.shift();
      }
    }
    if (line.length) lines.push(line.join(''));
    return lines;
  }

  /** 指定行数に収まるまでフォントサイズを下げて折り返す */
  function fitText(ctx, text, maxWidth, size, minSize, maxLines, weight) {
    var lines;
    for (var s = size; s >= minSize; s -= 2) {
      ctx.font = weight + ' ' + s + 'px ' + FONT;
      lines = wrap(ctx, text, maxWidth);
      if (lines.length <= maxLines) return { size: s, lines: lines };
    }
    return { size: minSize, lines: lines.slice(0, maxLines) };
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawLines(ctx, fit, x, y, lineHeight, color, weight, align) {
    ctx.font = weight + ' ' + fit.size + 'px ' + FONT;
    ctx.fillStyle = color;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'top';
    fit.lines.forEach(function (l, i) { ctx.fillText(l, x, y + i * fit.size * lineHeight); });
    return y + fit.lines.length * fit.size * lineHeight;
  }

  function drawImageContain(ctx, img, x, y, w, h) {
    if (!img || !img.naturalWidth) return;
    var r = Math.min(w / img.naturalWidth, h / img.naturalHeight);
    var dw = img.naturalWidth * r, dh = img.naturalHeight * r;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh), dw, dh);
  }

  function loadImage(src) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  /** Webフォントの読み込みを待つ（最大3秒。失敗しても端末のフォントで描画） */
  function waitFonts(text) {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var loads = Promise.all([
      document.fonts.load('700 40px "Zen Maru Gothic"', text),
      document.fonts.load('500 40px "Zen Maru Gothic"', text)
    ]).catch(function () {});
    var timeout = new Promise(function (r) { setTimeout(r, 3000); });
    return Promise.race([loads, timeout]);
  }

  /**
   * @param canvas  描画先
   * @param opts {
   *   layout: 'square' | 'ogp',
   *   title:  診断名, name: タイプ名（無ければトップ用）, catch: キャッチコピー,
   *   label:  タイプ名の上の小見出し, color: アクセント色, url: 表示するURL, footer: 下部の一文,
   *   hashtags: '#フクマナ #福祉経営', mascot: Image, logo: Image
   * }
   */
  function draw(canvas, opts) {
    var square = opts.layout !== 'ogp';
    var W = square ? 1080 : 1200;
    var H = square ? 1080 : 630;
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext('2d');
    var color = opts.color || THEME.brand;

    // 背景
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.12;
    ctx.beginPath(); ctx.arc(W - 60, 60, square ? 260 : 200, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(40, H - 20, square ? 200 : 140, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;

    var m = square ? 64 : 40;
    roundRect(ctx, m, m, W - m * 2, H - m * 2, 40);
    ctx.fillStyle = THEME.card;
    ctx.fill();

    // 上部の帯
    var bandH = square ? 110 : 80;
    ctx.save();
    roundRect(ctx, m, m, W - m * 2, H - m * 2, 40);
    ctx.clip();
    ctx.fillStyle = color;
    ctx.fillRect(m, m, W - m * 2, bandH);
    ctx.restore();

    var pad = square ? 72 : 56;
    var left = m + pad;
    var contentW = W - m * 2 - pad * 2;

    var headerX = left;
    if (opts.logo && opts.logo.naturalWidth) {
      var lh = bandH - 40;
      var lw = opts.logo.naturalWidth * (lh / opts.logo.naturalHeight);
      roundRect(ctx, left - 12, m + 14, lw + 24, lh + 12, 14);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.drawImage(opts.logo, left, m + 20, lw, lh);
      headerX = left + lw + 32;
    }
    ctx.font = '700 ' + (square ? 40 : 32) + 'px ' + FONT;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(opts.title, headerX, m + bandH / 2 + 2);

    // マスコット（右下）
    var mascotSize = square ? 360 : 300;
    var mascotX = W - m - mascotSize - (square ? 24 : 16);
    var mascotY = H - m - mascotSize - (square ? 24 : 16);
    drawImageContain(ctx, opts.mascot, mascotX, mascotY, mascotSize, mascotSize);

    var y = m + bandH + (square ? 64 : 40);
    var textW = square ? contentW : contentW - mascotSize + 40;

    if (opts.label) {
      ctx.font = '500 ' + (square ? 40 : 30) + 'px ' + FONT;
      ctx.fillStyle = THEME.sub;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(opts.label, left, y);
      y += square ? 70 : 50;
    }

    if (opts.name) {
      var nameFit = fitText(ctx, opts.name, textW, square ? 88 : 68, 48, 2, '700');
      y = drawLines(ctx, nameFit, left, y, 1.3, color, '700');
      // 下線
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.25;
      ctx.fillRect(left, y + 8, square ? 160 : 120, 10);
      ctx.globalAlpha = 1;
      y += square ? 56 : 36;
    }

    if (opts.catch) {
      var catchW = square ? contentW - mascotSize * 0.45 : textW;
      var catchFit = fitText(ctx, opts.catch, catchW, square ? 50 : 38, 30, 3, '500');
      y = drawLines(ctx, catchFit, left, y, 1.55, THEME.text, '500');
    }

    // フッター（URL）
    var footY = H - m - (square ? 72 : 52);
    if (opts.footer) {
      ctx.font = '500 ' + (square ? 34 : 26) + 'px ' + FONT;
      ctx.fillStyle = THEME.sub;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(opts.footer, left, footY - (square ? 52 : 38));
    }
    if (opts.url) {
      var urlFit = fitText(ctx, opts.url, mascotX - left - 8, square ? 34 : 26, 18, 1, '700');
      ctx.font = '700 ' + urlFit.size + 'px ' + FONT;
      ctx.fillStyle = color;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(urlFit.lines[0], left, footY);
    }
    if (opts.hashtags && square) {
      ctx.font = '500 30px ' + FONT;
      ctx.fillStyle = THEME.sub;
      ctx.fillText(opts.hashtags, left, footY + 48);
    }
    return canvas;
  }

  root.FukumanaCard = { draw: draw, loadImage: loadImage, waitFonts: waitFonts, FONT: FONT };
})(typeof self !== 'undefined' ? self : this);
