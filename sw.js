/*
 * Service Worker
 * 一度トップ画面を開けば、途中で電波が切れても最後まで診断でき、結果画面の表示と結果画像の保存までできるように、
 * 診断に必要なファイルを端末に保存しておきます（README「会場の電波対策」）。
 *
 * - 保存するファイルと版（VERSION）は tools/build.js が自動で書き換えます。手で編集しないでください。
 * - ファイルの中身が1文字でも変わると VERSION が変わり、次に開いたときに新しい版へ切り替わって古い保存は消えます。
 * - Googleアナリティクスなど外部への通信には関わりません（Googleフォントだけ、表示に使った分を保存します）。
 */
'use strict';

// PRECACHE:START（tools/build.js が自動生成します）
var VERSION = '364659e85653';
var FILES = [
  "index.html",
  "js/diagnosis.js",
  "js/app.js",
  "js/card.js",
  "data/content.json",
  "assets/favicon.png",
  "assets/opt/FUKUMANA_LOGO_FIX-03.webp",
  "assets/opt/FUKUMANA_LOGO_FIX-02.webp",
  "assets/opt/FUKUMANA_ICON-02.webp",
  "assets/opt/Fukunoneko_08.webp",
  "assets/opt/Fukunoneko_01.webp",
  "assets/opt/Fukunoneko_03.webp",
  "assets/opt/Fukunoneko_02.webp",
  "assets/opt/Fukunoneko_04.webp",
  "assets/opt/Fukunoneko_07.webp",
  "assets/opt/Fukunoneko_09.webp",
  "assets/opt/Fukunoneko_06.webp",
  "assets/opt/Fukunoneko_05.webp"
];
// PRECACHE:END

var CACHE = 'fukumana-' + VERSION;
var FONT_CACHE = 'fukumana-fonts';
var FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // 'no-cache'：ブラウザに残っている古いファイルではなく、公開中の最新のファイルを確かめて保存する
      return cache.addAll(FILES.map(function (f) { return new Request(f, { cache: 'no-cache' }); }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k.indexOf('fukumana-') === 0 && k !== CACHE && k !== FONT_CACHE;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function fromCache(request) {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(request, { ignoreSearch: true, ignoreVary: true });
  });
}

// フォント：保存済みならそれを使い、なければ読み込んで保存する（電波がないときは端末のフォントで表示）
function font(request) {
  return caches.open(FONT_CACHE).then(function (cache) {
    return cache.match(request).then(function (hit) {
      var update = fetch(request).then(function (res) {
        if (res.ok) cache.put(request, res.clone());
        return res;
      });
      if (hit) {
        if (/fonts\.googleapis\.com/.test(request.url)) update.catch(function () {}); // CSS は裏で新しくしておく
        return hit;
      }
      return update;
    });
  });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;
  var url = new URL(request.url);

  if (url.origin === self.location.origin) {
    var scope = new URL(self.registration.scope);
    // 診断ページ（?field=hoiku などの付いたURLも同じページ）
    if (request.mode === 'navigate' && (url.pathname === scope.pathname || url.pathname === scope.pathname + 'index.html')) {
      event.respondWith(fromCache(new URL('index.html', scope).href).then(function (hit) { return hit || fetch(request); }));
      return;
    }
    event.respondWith(fromCache(request).then(function (hit) { return hit || fetch(request); }));
    return;
  }
  if (FONT_HOSTS.indexOf(url.hostname) >= 0) {
    event.respondWith(font(request));
  }
  // それ以外（Googleアナリティクス・LINE など）は Service Worker を通さない
});
