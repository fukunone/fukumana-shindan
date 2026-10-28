/*
 * 結果カード画像の描画（Canvas）
 * - 結果画面の「結果画像を保存」（1080×1080）
 * - tools/build.mjs による OGP 画像の生成（1200×630）
 * の両方で同じコードを使います。
 */
(function (root) {
  'use strict';

  var FONT = '"Zen Maru Gothic", "Hiragino Maru Gothic ProN", "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif';

  // css/style.css の :root と同じ配色（ロゴ・フクノネコの色が基準）
  var THEME = {
    bg: '#f1f9f8',
    card: '#ffffff',
    text: '#1f3a3e',
    sub: '#4b6468',
    brand: '#005660'
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
      // 句読点は行末にぶら下げてよい（次の行の頭に来ないように）
      if ('、。，．'.indexOf(ch) >= 0) continue;
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
      lines = wrap(ctx, text, /[、。]/.test(text) ? maxWidth - s : maxWidth); // ぶら下げる句読点1文字分を空けておく
      // 最終行が2文字以下（「人。」だけ等）になる組み方は避ける
      var last = Array.from(lines[lines.length - 1] || '');
      if (lines.length <= maxLines && (lines.length === 1 || last.length > 2)) return { size: s, lines: lines };
    }
    for (s = size; s >= minSize; s -= 2) {
      ctx.font = weight + ' ' + s + 'px ' + FONT;
      lines = wrap(ctx, text, /[、。]/.test(text) ? maxWidth - s : maxWidth); // ぶら下げる句読点1文字分を空けておく
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

  /** 画像の透明な余白を除いた範囲（{x, y, w, h}）を求める */
  function trimBox(img) {
    if (img.__box) return img.__box;
    var box = { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
    try {
      var c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      var cx = c.getContext('2d');
      cx.drawImage(img, 0, 0);
      var d = cx.getImageData(0, 0, c.width, c.height).data;
      var minX = c.width, minY = c.height, maxX = -1, maxY = -1;
      for (var y = 0; y < c.height; y++) {
        for (var x = 0; x < c.width; x++) {
          if (d[(y * c.width + x) * 4 + 3] > 8) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX >= 0) box = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
    } catch (e) { /* 読み取れない場合は画像全体を使う */ }
    img.__box = box;
    return box;
  }

  /** 白・透明以外（文字や図柄）が描かれている範囲。白い背景つきの画像の位置合わせに使う */
  function inkBox(img) {
    if (img.__ink) return img.__ink;
    var box = trimBox(img);
    try {
      var c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      var cx = c.getContext('2d');
      cx.drawImage(img, 0, 0);
      var d = cx.getImageData(0, 0, c.width, c.height).data;
      var minX = c.width, minY = c.height, maxX = -1, maxY = -1;
      for (var y = 0; y < c.height; y++) {
        for (var x = 0; x < c.width; x++) {
          var i = (y * c.width + x) * 4;
          if (d[i + 3] > 8 && (d[i] < 235 || d[i + 1] < 235 || d[i + 2] < 235)) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX >= 0) box = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
    } catch (e) { /* 読み取れない場合は余白を除いた範囲を使う */ }
    img.__ink = box;
    return box;
  }

  /**
   * アイコンを、文字部分の左上が (x, y)・高さ inkH になるよう描く。
   * 白い背景もそのまま描くが、clipPath（カードの形）の外には出さない。
   */
  function drawIcon(ctx, img, x, y, inkH, clipPath) {
    var ink = inkBox(img);
    var r = inkH / ink.h;
    ctx.save();
    clipPath();
    ctx.clip();
    ctx.drawImage(img, x - ink.x * r, y - ink.y * r, img.naturalWidth * r, img.naturalHeight * r);
    ctx.restore();
    return { inkW: ink.w * r, inkH: inkH };
  }

  /** 余白を除いて、枠に収まるよう下揃えで描く。描いた範囲を返す */
  function drawImageContain(ctx, img, x, y, w, h, align) {
    if (!img || !img.naturalWidth) return null;
    var b = trimBox(img);
    var r = Math.min(w / b.w, h / b.h);
    var dw = b.w * r, dh = b.h * r;
    var dx = align === 'left' ? x : x + (w - dw) / 2;
    var dy = align === 'left' ? y + (h - dh) / 2 : y + (h - dh);
    ctx.drawImage(img, b.x, b.y, b.w, b.h, dx, dy, dw, dh);
    return { w: dw, h: dh };
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
    var color = opts.color || THEME.brand;     // 文字・帯（濃い色）
    var accent = opts.accent || color;         // 飾り（明るい色）

    // 背景
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.18;
    ctx.beginPath(); ctx.arc(W - 60, 60, square ? 260 : 200, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(40, H - 20, square ? 200 : 140, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;

    var m = square ? 64 : 40;
    roundRect(ctx, m, m, W - m * 2, H - m * 2, 40);
    ctx.fillStyle = THEME.card;
    ctx.fill();

    // 上部の帯
    var bandH = square ? 124 : 96;
    ctx.save();
    roundRect(ctx, m, m, W - m * 2, H - m * 2, 40);
    ctx.clip();
    ctx.fillStyle = color;
    ctx.fillRect(m, m, W - m * 2, bandH);
    ctx.restore();

    var pad = square ? 72 : 56;
    var left = m + pad;
    var contentW = W - m * 2 - pad * 2;

    // 帯には診断名だけを表示
    ctx.font = '700 ' + (square ? 44 : 36) + 'px ' + FONT;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(opts.title, left, m + bandH / 2 + 2);

    // マスコット（右下）
    var mascotSize = square ? 330 : 300;
    var mascotX = W - m - mascotSize - (square ? 24 : 16);
    var mascotY = H - m - mascotSize - (square ? 24 : 16);
    var drawn = drawImageContain(ctx, opts.mascot, mascotX, mascotY, mascotSize, mascotSize);
    // フクノネコが実際に描かれた左端（URL の幅の上限に使う）
    var mascotLeft = drawn ? mascotX + (mascotSize - drawn.w) / 2 : mascotX;

    // フクマナのアイコン（白い部分の左下。目立ちすぎない大きさ）
    var footY = H - m - (square ? 72 : 52);
    var footX = left;
    if (opts.icon && opts.icon.naturalWidth) {
      var inkH = square ? 96 : 72;                  // 「フクマナ」の文字部分の高さ
      var inkBottom = square ? footY + 44 : H - m - 18;
      var placed = drawIcon(ctx, opts.icon, left, inkBottom - inkH, inkH, function () {
        roundRect(ctx, m, m, W - m * 2, H - m * 2, 40);  // カードの外にはみ出さない
      });
      if (square) footX = left + placed.inkW + 22;
    }

    var y = m + bandH + (square ? 52 : 40);
    var textW = square ? contentW : contentW - mascotSize + 40;

    if (opts.label) {
      ctx.font = '500 ' + (square ? 38 : 30) + 'px ' + FONT;
      ctx.fillStyle = THEME.sub;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(opts.label, left, y);
      y += square ? 58 : 50;
    }

    if (opts.name) {
      var nameFit = fitText(ctx, opts.name, textW, square ? 80 : 64, 46, 2, '700');
      y = drawLines(ctx, nameFit, left, y, 1.3, color, '700');
      // 区切り線
      ctx.fillStyle = accent;
      ctx.fillRect(left, y + 6, square ? 160 : 120, square ? 10 : 8);
      y += square ? 50 : 34;
    }

    if (opts.catch) {
      var catchW = square ? contentW - mascotSize * 0.66 : textW;
      var catchFit = fitText(ctx, opts.catch, catchW, square ? 46 : 36, 30, 3, '500');
      y = drawLines(ctx, catchFit, left, y, 1.55, THEME.text, '500');
    }

    // フッター（URL）
    var footW = mascotLeft - footX - 16;   // フクノネコに重ならない幅
    if (opts.footer) {
      var footFit = fitText(ctx, opts.footer, footW, square ? 32 : 26, 20, 1, '500');
      ctx.font = '500 ' + footFit.size + 'px ' + FONT;
      ctx.fillStyle = THEME.sub;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(footFit.lines[0], footX, footY - (square ? 50 : 38));
    }
    if (opts.url) {
      var urlFit = fitText(ctx, opts.url, footW, square ? 34 : 26, 18, 1, '700');
      ctx.font = '700 ' + urlFit.size + 'px ' + FONT;
      ctx.fillStyle = color;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(urlFit.lines[0], footX, footY);
    }
    if (opts.hashtags && square) {
      var tagFit = fitText(ctx, opts.hashtags, footW, 28, 20, 1, '500');
      ctx.font = '500 ' + tagFit.size + 'px ' + FONT;
      ctx.fillStyle = THEME.sub;
      ctx.fillText(tagFit.lines[0], footX, footY + 44);
    }
    return canvas;
  }

  root.FukumanaCard = { draw: draw, loadImage: loadImage, waitFonts: waitFonts, FONT: FONT };
})(typeof self !== 'undefined' ? self : this);
