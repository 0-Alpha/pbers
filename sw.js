/* PBers Service Worker
 * ・ページ遷移(HTML)と日次で変わるデータ(data.js等)は「ネット優先→失敗時キャッシュ」で常に最新。
 * ・その他の静的アセットは stale-while-revalidate(即キャッシュ表示＋裏で更新)で高速。
 * ・別オリジン(掲示板/最新動画API・広告・YouTube・フォント)は一切触らない。
 * キャッシュ戦略を変えたら VERSION を上げる(古いキャッシュを自動削除)。
 */
const VERSION = 'v1';
const CACHE = 'pbers-' + VERSION;
const DATA_RE = /\/assets\/(data|news|growth|race)\.js|\/bytype\.json/;

self.addEventListener('install', function () { self.skipWaiting(); });

self.addEventListener('activate', function (e) {
  e.waitUntil((async function () {
    const keys = await caches.keys();
    await Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // 別オリジンはブラウザ任せ

  // ページ遷移: ネット優先 → キャッシュ → トップ → オフライン表示
  if (req.mode === 'navigate') {
    e.respondWith((async function () {
      try {
        const res = await fetch(req);
        (await caches.open(CACHE)).put(req, res.clone());
        return res;
      } catch (err) {
        return (await caches.match(req)) || (await caches.match('/')) ||
          new Response('<meta charset="utf-8"><h1>オフライン</h1><p>接続が復帰したら再読み込みしてください。</p>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }

  // 日次で更新されるデータ: ネット優先(古い数字を出さない)
  if (DATA_RE.test(url.pathname)) {
    e.respondWith((async function () {
      try {
        const res = await fetch(req);
        (await caches.open(CACHE)).put(req, res.clone());
        return res;
      } catch (err) {
        return (await caches.match(req)) || Response.error();
      }
    })());
    return;
  }

  // その他の静的アセット(css/コードjs/画像/フォント): stale-while-revalidate
  e.respondWith((async function () {
    const cached = await caches.match(req);
    const fetching = fetch(req).then(function (res) {
      if (res && res.status === 200) caches.open(CACHE).then(function (c) { c.put(req, res.clone()); });
      return res;
    }).catch(function () { return null; });
    return cached || (await fetching) || Response.error();
  })());
});
