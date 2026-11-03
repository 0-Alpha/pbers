/* PBers Service Worker
 * ・ページ遷移(HTML)と日次で変わるデータ(data.js等)は「ネット優先→失敗時キャッシュ」で常に最新。
 * ・その他の静的アセットは stale-while-revalidate(即キャッシュ表示＋裏で更新)で高速。
 * ・別オリジン(掲示板/最新動画API・広告・YouTube・フォント)は一切触らない。
 * ・localhost では何もしない(編集がすぐ見えるように。サーバー停止時に古いHTMLだけ返さないように)。
 * キャッシュ戦略を変えたら VERSION を上げる(古いキャッシュを自動削除)。
 */
const VERSION = 'v4';
const CACHE = 'pbers-' + VERSION;
const DATA_RE = /\/assets\/(data|news|growth|race)\.js|\/bytype\.json|\/barrace\.json/;
const IS_LOCAL = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';

/* 保存したら同じファイルの旧バージョン(?v= 違い)を消す。消さないと更新のたびに増え続ける */
async function store(req, res) {
  const c = await caches.open(CACHE);
  await c.put(req, res);
  const same = await c.keys(req, { ignoreSearch: true });
  await Promise.all(same.map(function (k) { return k.url === req.url ? null : c.delete(k); }));
}
/* ?v= が古いHTMLからの要求にも、保存してある最新版を返す(オフラインで崩れないように) */
async function fromCache(req) {
  return (await caches.match(req)) || caches.match(req, { ignoreSearch: true });
}

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
  if (IS_LOCAL || req.method !== 'GET') return;
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
        e.waitUntil(store(req, res.clone()));
        return res;
      } catch (err) {
        return (await fromCache(req)) || Response.error();
      }
    })());
    return;
  }

  // その他の静的アセット(css/コードjs/画像/フォント): stale-while-revalidate
  e.respondWith((async function () {
    const cached = await caches.match(req);
    const fetching = fetch(req).then(function (res) {
      if (res && res.status === 200) e.waitUntil(store(req, res.clone()));   // clone は返す前に。返した後だと本文が読まれて失敗する
      return res;
    }).catch(function () { return null; });
    if (cached) { e.waitUntil(fetching); return cached; }
    return (await fetching) || (await fromCache(req)) || Response.error();
  })());
});
