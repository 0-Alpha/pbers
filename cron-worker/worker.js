/* PBers Cloudflare Worker
 * - 6時間ごとの統計取得トリガー(GitHub workflow_dispatch)
 * - WebSub(PubSubHubbub)で YouTube 新着動画をリアルタイム受信
 *
 * 必要な設定(Cloudflareダッシュボード):
 *   KV binding : PBERS_KV
 *   Secrets    : GH_TOKEN, RUN_KEY, HUB_SECRET
 *   Variable   : CALLBACK_URL = https://<このworker>.workers.dev/yt
 *   Cron       : 0 3,9,15,21 * * *  (= JST 12/18/0/6時。統計＋購読更新)
 */

const HUB = "https://pubsubhubbub.appspot.com/";
const SITE = "https://pbers.com";
const TOPIC = (id) => `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${id}`;
const BATCH = 30;          // 1回で購読する数(無料プランの50サブリクエスト上限に収める)
const REFRESH_BATCH = 15;  // 1回でRSS取り込みするチャンネル数(1chにつきRSS+判定で最大3fetch)
const RECENT_PER_CH = 2;   // 初期シードで1chあたり取り込む最新本数
const FEED_MAX = 100;      // feedに保持する最大件数(投稿順タイムライン)

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try { await dispatch(env); } catch (e) {}         // 統計取得(既存)
      try { await subscribeBatch(env); } catch (e) {}   // 購読のリース更新(1回30件ずつ、cursorで巡回)
    })());
  },

  async fetch(req, env) {
   try {
    const url = new URL(req.url);

    // CORS プリフライト(最優先・空ボディの204で返す。204にボディを付けるとWorkerが例外になる)
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    // WebSub 購読確認: Hub が hub.challenge を付けて GET してくる → そのまま返す
    if (req.method === "GET" && url.pathname === "/yt") {
      const ch = url.searchParams.get("hub.challenge");
      return ch ? new Response(ch, { status: 200 }) : new Response("bad", { status: 400 });
    }

    // WebSub 新着通知: Hub が Atom XML を POST してくる
    if (req.method === "POST" && url.pathname === "/yt") {
      const body = await req.text();
      if (env.HUB_SECRET) {
        const ok = await verifySig(env.HUB_SECRET, body, req.headers.get("X-Hub-Signature") || "");
        if (!ok) return new Response("", { status: 204 });   // 2xxで返して再送ループを避ける
      }
      await handleNotification(body, env);
      return new Response("", { status: 204 });
    }

    // サイト用: 最新動画 JSON(新着30件)
    if (req.method === "GET" && url.pathname === "/videos") {
      const feed = (await env.PBERS_KV.get("feed", "json")) || [];
      return json(feed);
    }

    // ---- 掲示板(board): スレッド + レス形式 ----
    // 公開状態は env.BOARD_PUBLIC("1"で公開)。非公開の間は管理キー(X-Board-Key=env.BOARD_KEY)所持者のみ閲覧/投稿可。
    if (url.pathname === "/api/board/config") {
      return json({ public: env.BOARD_PUBLIC === "1" });
    }
    if (url.pathname === "/api/board/threads" && req.method === "GET")  return threadList(url, req, env);
    if (url.pathname === "/api/board/threads" && req.method === "POST") return threadCreate(req, env);
    if (url.pathname === "/api/board/thread"  && req.method === "GET")  return threadShow(url, req, env);
    if (url.pathname === "/api/board/posts"   && req.method === "POST") return postCreate(req, env);
    if (url.pathname === "/api/board/hide"    && req.method === "POST") return boardHide(req, env);

    // ---- ページ表示回数カウンター ----
    if (url.pathname === "/api/views" && req.method === "GET") return viewCount(url, req, env);

    // 手動/初回: 30件ずつ購読(RUN_KEY で保護)。全部やるには数回叩くか、cronに任せる
    if (url.pathname === "/subscribe" && url.searchParams.get("key") === env.RUN_KEY) {
      const msg = await subscribeBatch(env);
      return new Response(msg, { status: 200 });
    }

    // 30件ずつ RSS から最新動画を取り込む(初回シード/タイトル修正用)。RUN_KEYで保護
    if (url.pathname === "/refresh" && url.searchParams.get("key") === env.RUN_KEY) {
      const msg = await refreshBatch(env);
      return new Response(msg, { status: 200 });
    }

    // KVを全消去(やり直し用)。RUN_KEYで保護
    if (url.pathname === "/reset" && url.searchParams.get("key") === env.RUN_KEY) {
      const l = await env.PBERS_KV.list();
      await Promise.all(l.keys.map((k) => env.PBERS_KV.delete(k.name)));
      return new Response("cleared " + l.keys.length, { status: 200 });
    }

    // 統計取得の手動テスト(既存): /run?key=RUN_KEY
    if (url.pathname === "/run" && url.searchParams.get("key") === env.RUN_KEY) {
      const r = await dispatch(env);
      return new Response("dispatched: HTTP " + r.status, { status: 200 });
    }

    return new Response("ok");
   } catch (e) {
    // どんな例外も表に出さない安全網(ダッシュボードの"uncaught exception"を防ぐ)。
    // /yt は再送ループ回避のため2xxで返し、それ以外はCORS付きの500 JSONを返す。
    try { if (new URL(req.url).pathname === "/yt") return new Response("", { status: 204 }); } catch (_) {}
    return json({ error: "server_error" }, 500);
   }
  }
};

/* ---- GitHub Actions を起動(統計取得) ---- */
async function dispatch(env) {
  return fetch("https://api.github.com/repos/0-Alpha/pbers/actions/workflows/daily.yml/dispatches", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + env.GH_TOKEN,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "pbers-cron-worker",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ ref: "main" })
  });
}

/* ---- 30件ずつ購読(初回＆リース更新)。KVのcursorで巡回 ---- */
async function subscribeBatch(env) {
  const ids = await channelIds(env);
  if (!ids.length) return "no channels";
  let cur = parseInt((await env.PBERS_KV.get("subcursor")) || "0", 10);
  if (!(cur >= 0) || cur >= ids.length) cur = 0;
  const slice = ids.slice(cur, cur + BATCH);
  const results = await Promise.all(slice.map((id) => subscribeOne(id, env)));  // 並列で速く
  const n = results.filter(Boolean).length;
  const nextCur = (cur + slice.length) % ids.length;
  await env.PBERS_KV.put("subcursor", String(nextCur));
  return `subscribed ${n}/${slice.length} (ch ${cur}..${cur + slice.length} of ${ids.length}). next=${nextCur}`;
}
async function subscribeOne(id, env) {
  const form = new URLSearchParams({
    "hub.mode": "subscribe",
    "hub.topic": TOPIC(id),
    "hub.callback": env.CALLBACK_URL,
    "hub.verify": "async",
    "hub.secret": env.HUB_SECRET || "",
    "hub.lease_seconds": "864000"
  });
  try {
    const r = await fetch(HUB, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form
    });
    return r.status === 202 || r.status === 204;
  } catch (e) { return false; }
}

async function channelIds(env) {
  try {
    const r = await fetch(SITE + "/channels.json");
    return r.ok ? await r.json() : [];
  } catch (e) { return []; }
}

/* ---- RSS から最新動画を取り込んで feed(投稿順タイムライン)にマージ ---- */
async function refreshBatch(env) {
  const ids = await channelIds(env);
  if (!ids.length) return "no channels";
  let cur = parseInt((await env.PBERS_KV.get("refcursor")) || "0", 10);
  if (!(cur >= 0) || cur >= ids.length) cur = 0;
  const slice = ids.slice(cur, cur + REFRESH_BATCH);
  const per = await Promise.all(slice.map((id) => fetchRecent(id)));
  const items = [].concat.apply([], per);
  await mergeIntoFeed(env, items);
  const nextCur = (cur + slice.length) % ids.length;
  await env.PBERS_KV.put("refcursor", String(nextCur));
  return `refreshed ${slice.length} ch, +${items.length} vids (ch ${cur}..${cur + slice.length} of ${ids.length}). next=${nextCur}`;
}
// 1チャンネルの最新 RECENT_PER_CH 本を返す
async function fetchRecent(id) {
  const items = [];
  try {
    const r = await fetch("https://www.youtube.com/feeds/videos.xml?channel_id=" + id);
    if (!r.ok) return items;
    const xml = await r.text();
    const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
    for (const entry of entries.slice(0, RECENT_PER_CH)) {
      const vid = (entry.match(/<yt:videoId>(.*?)<\/yt:videoId>/) || [])[1];
      const title = decode((entry.match(/<title>(.*?)<\/title>/) || [])[1] || "");
      const published = (entry.match(/<published>(.*?)<\/published>/) || [])[1] || "";
      if (!vid) continue;
      const c = await classify(vid);
      items.push({
        vid, cid: id, title, published, short: c.short,
        url: "https://www.youtube.com/watch?v=" + vid, thumb: c.thumb, at: Date.now()
      });
    }
  } catch (e) { /* skip */ }
  return items;
}
// feed に vid 重複を避けて追加し、published 降順で FEED_MAX 件に整える
async function mergeIntoFeed(env, items) {
  let feed = (await env.PBERS_KV.get("feed", "json")) || [];
  const seen = new Set(feed.map((x) => x.vid));
  for (const it of items) { if (!seen.has(it.vid)) { feed.push(it); seen.add(it.vid); } }
  feed.sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0));
  await env.PBERS_KV.put("feed", JSON.stringify(feed.slice(0, FEED_MAX)));
}
// ショート判定＋サムネ決定(2段)。
// 1) i.ytimg.com/vi/<id>/oardefault.jpg(縦専用サムネ)が200 → 縦型ショート。CDNなので確実・高速。
// 2) 404(=横素材)のときだけ /shorts/<id> で確認。ショートは尺(3分以下)で決まりアスペクト比は問わないため、
//    横向きでもショート指定がありうる。200=ショート / リダイレクト=ロング。縦サムネが無いので横サムネを使う。
async function classify(vid) {
  const oar = "https://i.ytimg.com/vi/" + vid + "/oardefault.jpg";
  const hq = "https://i.ytimg.com/vi/" + vid + "/hqdefault.jpg";
  try {
    const r = await fetch(oar, { method: "HEAD" });
    if (r.status === 200) return { short: true, thumb: oar };   // 縦型ショート
  } catch (e) { /* fall through */ }
  // 横素材: 横型ショートかロングかを /shorts/ で判定。redirect:manual で3xxを追わずに受ける
  // (横ショートは200のまま／ロングは /watch へリダイレクト＝非200)。Cookieで同意ページ回避。
  try {
    const s = await fetch("https://www.youtube.com/shorts/" + vid, {
      method: "HEAD", redirect: "manual",
      headers: { "Cookie": "SOCS=CAI; CONSENT=YES+", "Accept-Language": "en-US,en;q=0.9" }
    });
    if (s.status === 200) return { short: true, thumb: hq };    // 横型ショート
  } catch (e) { /* 想定外(同意ページ等)は下でロング扱い＝従来通りで悪化なし */ }
  return { short: false, thumb: hq };
}
/* ---- 新着通知の処理(投稿順タイムライン: 同チャンネル複数OK) ---- */
async function handleNotification(xml, env) {
  if (/<at:deleted-entry/.test(xml)) return;                 // 削除通知は無視
  // フィード全体の<title>ではなく<entry>内から取る(でないと "YouTube video feed" になる)
  const entry = (xml.match(/<entry>[\s\S]*?<\/entry>/) || [])[0] || xml;
  const vid = (entry.match(/<yt:videoId>(.*?)<\/yt:videoId>/) || [])[1];
  const cid = (entry.match(/<yt:channelId>(.*?)<\/yt:channelId>/) || [])[1];
  const title = decode((entry.match(/<title>(.*?)<\/title>/) || [])[1] || "");
  const published = (entry.match(/<published>(.*?)<\/published>/) || [])[1] || "";
  if (!vid || !cid) return;

  const feed = (await env.PBERS_KV.get("feed", "json")) || [];
  if (feed.some((x) => x.vid === vid)) return;               // 既出(タイトル編集の再通知など)はスキップ

  const c = await classify(vid);
  await mergeIntoFeed(env, [{
    vid, cid, title, published, short: c.short,
    url: "https://www.youtube.com/watch?v=" + vid, thumb: c.thumb, at: Date.now()
  }]);
}

/* ---- 署名検証(YouTube は sha1) ---- */
async function verifySig(secret, body, header) {
  const [algo, hex] = (header || "").split("=");
  if (algo !== "sha1" || !hex) return true;                  // 不明な形式は通す
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const calc = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return calc === hex;
}

function decode(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
          .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-Board-Key",
  "Access-Control-Max-Age": "86400"
};
function json(o, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", ...CORS } });
}

/* ================= 掲示板(board): スレッド + レス形式 ================= */
/* 必要な設定:
 *   D1 binding : DB
 *   Variables  : BOARD_PUBLIC = "1" で全体公開(未設定/その他は非公開=管理者のみ)
 *   Secrets    : BOARD_KEY    (管理キー。閲覧解錠・投稿・モデレーション)
 *                SALT         (IPハッシュ / 日替りID用の塩。推奨)
 *                TURNSTILE_SECRET (任意。設定すると一般投稿にCAPTCHA必須)
 *   D1 スキーマ:
 *     CREATE TABLE IF NOT EXISTS threads(
 *       id INTEGER PRIMARY KEY AUTOINCREMENT, board TEXT NOT NULL, title TEXT NOT NULL,
 *       created INTEGER NOT NULL, bumped INTEGER NOT NULL, posts INTEGER NOT NULL DEFAULT 1,
 *       ip_hash TEXT, hidden INTEGER DEFAULT 0);
 *     CREATE INDEX IF NOT EXISTS idx_threads ON threads(board, bumped);
 *     CREATE TABLE IF NOT EXISTS posts(
 *       id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id INTEGER NOT NULL, no INTEGER NOT NULL,
 *       name TEXT NOT NULL, body TEXT NOT NULL, uid TEXT, created INTEGER NOT NULL,
 *       ip_hash TEXT, hidden INTEGER DEFAULT 0, admin INTEGER DEFAULT 0);
 *     CREATE INDEX IF NOT EXISTS idx_posts ON posts(thread_id, no);
 */
function isAdmin(req, env) {
  const k = req.headers.get("X-Board-Key") || "";
  return !!(env.BOARD_KEY && k && k === env.BOARD_KEY);
}
async function sha(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
function ymdJST() {                        // 日替りID用の日付(JST)
  const d = new Date(Date.now() + 9 * 3600e3);
  return d.toISOString().slice(0, 10);
}
function clean(s, max) { return String(s == null ? "" : s).replace(/\r\n/g, "\n").trim().slice(0, max); }
async function guard(req, env, { write, cost = 20 }) {
  // 閲覧/投稿の共通ガード。戻り値: {admin} または {err, status}
  if (!env.DB) return { err: "db_unconfigured", status: 503 };
  const pub = env.BOARD_PUBLIC === "1", admin = isAdmin(req, env);
  if (!pub && !admin) return { err: "private", status: 403 };
  return { admin, pub };
}
async function rateLimit(req, env, tag, seconds) {
  // KVのexpirationTTLは最低60秒。15秒等の短い制限も出せるよう「最終投稿時刻」を保存して経過で判定。
  const ip = req.headers.get("CF-Connecting-IP") || "0";
  const key = "rl:" + tag + ":" + (await sha(ip));
  const prev = await env.PBERS_KV.get(key);
  const now = Date.now();
  if (prev && now - parseInt(prev, 10) < seconds * 1000) return false;
  await env.PBERS_KV.put(key, String(now), { expirationTtl: Math.max(60, seconds) });
  return true;
}

async function threadList(url, req, env) {
  const g = await guard(req, env, {}); if (g.err) return json({ error: g.err }, g.status);
  const board = "general";
  const sql = g.admin
    ? "SELECT id,title,created,bumped,posts,hidden FROM threads WHERE board=?1 ORDER BY bumped DESC LIMIT 200"
    : "SELECT id,title,created,bumped,posts,hidden FROM threads WHERE board=?1 AND hidden=0 ORDER BY bumped DESC LIMIT 200";
  const { results } = await env.DB.prepare(sql).bind(board).all();
  return json({ public: g.pub, admin: g.admin, threads: results || [] });
}
async function threadShow(url, req, env) {
  const g = await guard(req, env, {}); if (g.err) return json({ error: g.err }, g.status);
  const id = parseInt(url.searchParams.get("id"), 10);
  if (!id) return json({ error: "bad_id" }, 400);
  const th = await env.DB.prepare("SELECT id,title,created,bumped,posts,hidden FROM threads WHERE id=?1").bind(id).first();
  if (!th || (th.hidden && !g.admin)) return json({ error: "not_found" }, 404);
  const sql = g.admin
    ? "SELECT no,name,body,uid,created,hidden,admin FROM posts WHERE thread_id=?1 ORDER BY no ASC LIMIT 1000"
    : "SELECT no,name,body,uid,created,hidden,admin FROM posts WHERE thread_id=?1 AND hidden=0 ORDER BY no ASC LIMIT 1000";
  const { results } = await env.DB.prepare(sql).bind(id).all();
  return json({ public: g.pub, admin: g.admin, thread: th, posts: results || [] });
}
async function threadCreate(req, env) {
  const g = await guard(req, env, { write: true }); if (g.err) return json({ error: g.err }, g.status);
  let b; try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const title = clean(b.title, 60);
  const body = clean(b.body, 2000);
  if (!title) return json({ error: "no_title" }, 400);
  if (!body) return json({ error: "empty" }, 400);
  const name = clean(b.name, 24) || "名無し";
  const ip = req.headers.get("CF-Connecting-IP") || "0";
  if (!g.admin) {
    if (env.TURNSTILE_SECRET && !(await verifyTurnstile(b.token, ip, env))) return json({ error: "captcha" }, 400);
    if (!(await rateLimit(req, env, "th", 60))) return json({ error: "too_fast" }, 429);
  }
  const iph = await sha(ip + "|" + (env.SALT || "pbers"));
  const uid = (await sha(ip + "|" + ymdJST() + "|" + (env.SALT || "pbers"))).slice(0, 6);
  const now = Date.now();
  const r = await env.DB.prepare(
    "INSERT INTO threads(board,title,created,bumped,posts,ip_hash,hidden) VALUES('general',?1,?2,?2,1,?3,0)")
    .bind(title, now, iph).run();
  const tid = r.meta.last_row_id;
  await env.DB.prepare(
    "INSERT INTO posts(thread_id,no,name,body,uid,created,ip_hash,hidden,admin) VALUES(?1,1,?2,?3,?4,?5,?6,0,?7)")
    .bind(tid, name, body, uid, now, iph, g.admin ? 1 : 0).run();
  return json({ ok: true, id: tid });
}
async function postCreate(req, env) {
  const g = await guard(req, env, { write: true }); if (g.err) return json({ error: g.err }, g.status);
  let b; try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const tid = parseInt(b.thread, 10);
  const body = clean(b.body, 2000);
  if (!tid) return json({ error: "bad_id" }, 400);
  if (!body) return json({ error: "empty" }, 400);
  const name = clean(b.name, 24) || "名無し";
  const th = await env.DB.prepare("SELECT id,posts,hidden FROM threads WHERE id=?1").bind(tid).first();
  if (!th || th.hidden) return json({ error: "not_found" }, 404);
  const ip = req.headers.get("CF-Connecting-IP") || "0";
  if (!g.admin) {
    if (env.TURNSTILE_SECRET && !(await verifyTurnstile(b.token, ip, env))) return json({ error: "captcha" }, 400);
    if (!(await rateLimit(req, env, "po", 15))) return json({ error: "too_fast" }, 429);
  }
  const iph = await sha(ip + "|" + (env.SALT || "pbers"));
  const uid = (await sha(ip + "|" + ymdJST() + "|" + (env.SALT || "pbers"))).slice(0, 6);
  const now = Date.now();
  const no = (th.posts || 1) + 1;
  await env.DB.prepare(
    "INSERT INTO posts(thread_id,no,name,body,uid,created,ip_hash,hidden,admin) VALUES(?1,?2,?3,?4,?5,?6,?7,0,?8)")
    .bind(tid, no, name, body, uid, now, iph, g.admin ? 1 : 0).run();
  await env.DB.prepare("UPDATE threads SET posts=?2, bumped=?3 WHERE id=?1").bind(tid, no, now).run();
  return json({ ok: true, no });
}
async function boardHide(req, env) {
  if (!env.DB) return json({ error: "db_unconfigured" }, 503);
  if (!isAdmin(req, env)) return json({ error: "forbidden" }, 403);
  let b; try { b = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const hide = b.hide === false ? 0 : 1;
  if (b.kind === "thread") {
    const id = parseInt(b.id, 10); if (!id) return json({ error: "bad_id" }, 400);
    await env.DB.prepare("UPDATE threads SET hidden=?2 WHERE id=?1").bind(id, hide).run();
  } else {                                   // レス1件を非表示(thread_id + no で指定)
    const tid = parseInt(b.thread, 10), no = parseInt(b.no, 10);
    if (!tid || !no) return json({ error: "bad_id" }, 400);
    await env.DB.prepare("UPDATE posts SET hidden=?3 WHERE thread_id=?1 AND no=?2").bind(tid, no, hide).run();
  }
  return json({ ok: true });
}
/* ページ表示回数: D1テーブル pageviews(page TEXT PRIMARY KEY, count INTEGER)。
 * ?page=<パス>&hit=1 で加算(重複はクライアント側でその日1回に制御)。?hit無しは閲覧のみ。 */
async function viewCount(url, req, env) {
  if (!env.DB) return json({ error: "db_unconfigured" }, 503);
  let page = (url.searchParams.get("page") || "/").slice(0, 300);
  if (page.charAt(0) !== "/") page = "/" + page;           // 自サイトのパスのみ扱う
  if (url.searchParams.get("hit") === "1") {
    await env.DB.prepare(
      "INSERT INTO pageviews(page,count) VALUES(?1,1) ON CONFLICT(page) DO UPDATE SET count=count+1"
    ).bind(page).run();
  }
  const row = await env.DB.prepare("SELECT count FROM pageviews WHERE page=?1").bind(page).first();
  return json({ page: page, count: (row && row.count) || 0 });
}
async function verifyTurnstile(token, ip, env) {
  if (!token) return false;
  try {   // 外部通信の失敗で掲示板が500にならないよう保護(失敗時は不許可=クリーンな400)
    const form = new URLSearchParams();
    form.set("secret", env.TURNSTILE_SECRET);
    form.set("response", token);
    form.set("remoteip", ip);
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    const d = await r.json().catch(() => ({}));
    return !!d.success;
  } catch (e) {
    return false;
  }
}
