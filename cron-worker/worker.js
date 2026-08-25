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
const SITE = "https://pbers.pages.dev";
const TOPIC = (id) => `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${id}`;
const BATCH = 30;         // 1回で購読する数(無料プランの50サブリクエスト上限に収める)
const REFRESH_BATCH = 20; // 1回でRSS取り込みする数(1件につきRSS+ショート判定の2fetch)
const FEED_MAX = 100;     // feedに保持する最大件数

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      await dispatch(env);         // 統計取得(既存)
      await subscribeBatch(env);   // 購読のリース更新(1回30件ずつ、cursorで巡回)
    })());
  },

  async fetch(req, env) {
    const url = new URL(req.url);

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

    if (req.method === "OPTIONS") return json({}, 204);   // CORS プリフライト
    return new Response("ok");
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

/* ---- RSS から最新動画を取り込む(30件ずつ・cursor巡回) ---- */
async function refreshBatch(env) {
  const ids = await channelIds(env);
  if (!ids.length) return "no channels";
  let cur = parseInt((await env.PBERS_KV.get("refcursor")) || "0", 10);
  if (!(cur >= 0) || cur >= ids.length) cur = 0;
  const slice = ids.slice(cur, cur + REFRESH_BATCH);
  await Promise.all(slice.map((id) => refreshOne(id, env)));
  await rebuildFeed(env);
  const nextCur = (cur + slice.length) % ids.length;
  await env.PBERS_KV.put("refcursor", String(nextCur));
  return `refreshed ${slice.length} (ch ${cur}..${cur + slice.length} of ${ids.length}). next=${nextCur}`;
}
async function refreshOne(id, env) {
  try {
    const r = await fetch("https://www.youtube.com/feeds/videos.xml?channel_id=" + id);
    if (!r.ok) return;
    const xml = await r.text();
    const entry = (xml.match(/<entry>[\s\S]*?<\/entry>/) || [])[0];
    if (!entry) return;
    const vid = (entry.match(/<yt:videoId>(.*?)<\/yt:videoId>/) || [])[1];
    const title = decode((entry.match(/<title>(.*?)<\/title>/) || [])[1] || "");
    const published = (entry.match(/<published>(.*?)<\/published>/) || [])[1] || "";
    if (!vid) return;
    const short = await isShort(vid);
    await env.PBERS_KV.put("latest:" + id, JSON.stringify({
      vid, cid: id, title, published, short,
      url: "https://www.youtube.com/watch?v=" + vid,
      thumb: "https://i.ytimg.com/vi/" + vid + "/hqdefault.jpg",
      at: Date.now()
    }));
  } catch (e) { /* skip */ }
}
// /shorts/ がそのまま開ける(200)=ショート、/watch へリダイレクト=横動画。
// サーバーから叩くと同意ページに飛ばされるので、ブラウザ相当のUA＋同意Cookieを付ける。
async function isShort(vid) {
  try {
    const r = await fetch("https://www.youtube.com/shorts/" + vid, {
      redirect: "manual",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept-Language": "ja,en;q=0.9",
        "Cookie": "SOCS=CAISEwgDEgk0ODE3Nzk3MjQaAmphIAEaBgiA_LyaBg; CONSENT=YES+1"
      }
    });
    if (r.status === 200) return true;                      // /shorts/ がそのまま開けた=ショート
    const loc = r.headers.get("location") || "";
    if (/\/watch\b/.test(loc)) return false;                // /watch へリダイレクト=横動画
    return r.status === 200;                                 // それ以外は横扱い
  } catch (e) { return false; }
}
// latest:* をすべて集めて published 降順で feed を作り直す
async function rebuildFeed(env) {
  const l = await env.PBERS_KV.list({ prefix: "latest:" });
  const items = [];
  for (const k of l.keys) { const it = await env.PBERS_KV.get(k.name, "json"); if (it) items.push(it); }
  items.sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0));
  await env.PBERS_KV.put("feed", JSON.stringify(items.slice(0, FEED_MAX)));
}

/* ---- 新着通知の処理 ---- */
async function handleNotification(xml, env) {
  if (/<at:deleted-entry/.test(xml)) return;                 // 削除通知は無視
  // フィード全体の<title>ではなく<entry>内から取る(でないと "YouTube video feed" になる)
  const entry = (xml.match(/<entry>[\s\S]*?<\/entry>/) || [])[0] || xml;
  const vid = (entry.match(/<yt:videoId>(.*?)<\/yt:videoId>/) || [])[1];
  const cid = (entry.match(/<yt:channelId>(.*?)<\/yt:channelId>/) || [])[1];
  const title = decode((entry.match(/<title>(.*?)<\/title>/) || [])[1] || "");
  const published = (entry.match(/<published>(.*?)<\/published>/) || [])[1] || "";
  if (!vid || !cid) return;

  const prev = await env.PBERS_KV.get("latest:" + cid, "json");
  if (prev && prev.vid === vid) return;                      // タイトル編集の再通知はスキップ

  const item = {
    vid, cid, title, published, short: await isShort(vid),
    url: "https://www.youtube.com/watch?v=" + vid,
    thumb: "https://i.ytimg.com/vi/" + vid + "/hqdefault.jpg",
    at: Date.now()
  };
  await env.PBERS_KV.put("latest:" + cid, JSON.stringify(item));

  let feed = (await env.PBERS_KV.get("feed", "json")) || [];
  feed = feed.filter((x) => x.vid !== vid && x.cid !== cid);  // 同チャンネルの旧動画も除く
  feed.unshift(item);
  feed.sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0));
  feed = feed.slice(0, FEED_MAX);
  await env.PBERS_KV.put("feed", JSON.stringify(feed));
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
function json(o, status = 200) {
  return new Response(JSON.stringify(o), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": SITE,
      "Access-Control-Allow-Methods": "GET,OPTIONS"
    }
  });
}
