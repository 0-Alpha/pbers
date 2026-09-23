// Cloudflare Pages Function — 記事(articles)をサーバー生成(SSR)で配信する。
// /articles/ = 一覧、/articles/<slug>/ = 記事本文。中身は D1(Worker経由)から取得し、
// 完全なHTMLとして返すのでクローラーが全文読める(=SEO/AdSenseに効く)。
// 管理者判定: cookie 'pbers_ak' を Worker の X-Board-Key に載せ替えて問い合わせる。
// 非公開(articles_public!=1)の間は noindex + 非管理者には「準備中」を表示。
const WORKER = "https://pbers-cron.myray0629.workers.dev";
const VER = "250954";
const SITE = "https://pbers.com";

function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function fmtDate(ms) {
  try {
    const d = new Date(Number(ms) + 9 * 3600e3);
    return d.getUTCFullYear() + "年" + (d.getUTCMonth() + 1) + "月" + d.getUTCDate() + "日";
  } catch (e) { return ""; }
}
function isoDate(ms) {
  try { return new Date(Number(ms) + 9 * 3600e3).toISOString().slice(0, 10); } catch (e) { return ""; }
}

function shell(o) {
  // o: {title, desc, canonical, robots, jsonld, body}
  const ld = o.jsonld ? '\n<script type="application/ld+json">' + o.jsonld + "</script>" : "";
  return '<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<script>if(location.hostname==="pbers.pages.dev")location.replace("https://pbers.com"+location.pathname+location.search+location.hash);</script>\n' +
    '<script>(function(){try{var q=new URLSearchParams(location.search).get(\'theme\');if(q===\'light\'||q===\'dark\'){localStorage.setItem(\'pbers_theme\',q);}var t=localStorage.getItem(\'pbers_theme\');if(t===\'light\')document.documentElement.setAttribute(\'data-theme\',\'light\');}catch(e){}})();</script>\n' +
    "<title>" + esc(o.title) + "｜PBers</title>\n" +
    '<meta name="description" content="' + esc(o.desc) + '">\n' +
    '<meta name="robots" content="' + (o.robots || "noindex,follow") + '">\n' +
    '<link rel="canonical" href="' + o.canonical + '">\n' +
    '<link rel="icon" type="image/png" href="/favicon.png">\n' +
    '<link rel="manifest" href="/manifest.webmanifest">\n' +
    '<meta name="theme-color" content="#151515">\n' +
    '<meta property="og:type" content="article">\n' +
    '<meta property="og:site_name" content="PBers">\n' +
    '<meta property="og:title" content="' + esc(o.title) + '｜PBers">\n' +
    '<meta property="og:description" content="' + esc(o.desc) + '">\n' +
    '<meta property="og:url" content="' + o.canonical + '">\n' +
    '<meta property="og:image" content="https://pbers.com/favicon.png">\n' +
    '<meta name="twitter:card" content="summary">\n' +
    '<script>if(\'serviceWorker\' in navigator){addEventListener(\'load\',function(){navigator.serviceWorker.register(\'/sw.js\').catch(function(){});});}</script>\n' +
    '<script>window.PBERS_VIEWS_API = "https://pbers-cron.myray0629.workers.dev/api/views";\n' +
    '(function(){var API=window.PBERS_VIEWS_API;if(!API)return;window.pbersTrackView=function(path){path=path||location.pathname;var hit=0;try{var k=\'vc:\'+path+\':\'+new Date().toISOString().slice(0,10);if(!localStorage.getItem(k)){hit=1;localStorage.setItem(k,\'1\');}}catch(e){}fetch(API+\'?page=\'+encodeURIComponent(path)+\'&hit=\'+hit).then(function(r){return r.json();}).then(function(d){var el=document.getElementById(\'view-count\'),n=document.getElementById(\'view-count-n\');if(el&&n&&d&&typeof d.count===\'number\'){n.textContent=d.count.toLocaleString(\'en-US\');el.hidden=false;}}).catch(function(){});};addEventListener(\'load\',function(){window.pbersTrackView(location.pathname);});})();</script>\n' +
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
    '<link rel="stylesheet" href="/assets/style.css?v=' + VER + '">\n' +
    '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-6387146293155213" crossorigin="anonymous"></script>' + ld + "\n" +
    "</head>\n<body>\n" +
    '<header class="topbar"><div class="wrap">\n' +
    '  <a class="brand" href="/"><span class="dot"></span><span>PB<b>ers</b></span></a>\n' +
    '  <button class="theme-tg" id="theme-tg" type="button" aria-label="テーマ切替">☀</button>\n' +
    "</div></header>\n" +
    '<script>(function(){var b=document.getElementById(\'theme-tg\');if(!b)return;function cur(){try{return localStorage.getItem(\'pbers_theme\')===\'light\'?\'light\':\'dark\';}catch(e){return\'dark\';}}function ref(){var t=cur();b.textContent=t===\'light\'?\'🌙\':\'☀\';b.title=t===\'light\'?\'ブラックモードに切替\':\'ホワイトモードに切替\';b.setAttribute(\'aria-label\',b.title);}ref();b.addEventListener(\'click\',function(){var t=cur()===\'light\'?\'dark\':\'light\';try{localStorage.setItem(\'pbers_theme\',t);}catch(e){}if(t===\'light\')document.documentElement.setAttribute(\'data-theme\',\'light\');else document.documentElement.removeAttribute(\'data-theme\');ref();});})();</script>\n' +
    o.body + "\n" +
    '<footer><div class="wrap">\n' +
    '  <a class="brand" href="/"><span class="dot"></span><span>PB<b>ers</b></span></a>\n' +
    '  <div>データ出典: YouTube 各チャンネル公開情報 ・ <a class="foot-link" href="/about/">PBersとは</a> ・ <a class="foot-link" href="/privacy/">プライバシーポリシー</a></div>\n' +
    '  <div class="view-count" id="view-count" hidden>👁 このページの表示回数 <span class="num" id="view-count-n">—</span></div>\n' +
    "</div></footer>\n</body>\n</html>";
}

function gateBody() {
  return '<main><div class="doc-page art-gate"><div class="doc-page">' +
    '<a class="doc-back" href="/">← トップへ戻る</a>' +
    "<h1>準備中</h1>" +
    "<p>このセクションは現在、管理者のみ閲覧できます。公開までもうしばらくお待ちください。</p>" +
    "</div></div></main>";
}
function notFoundBody() {
  return '<main><div class="doc-page">' +
    '<a class="doc-back" href="/articles/">← 記事一覧へ</a>' +
    "<h1>記事が見つかりません</h1>" +
    "<p>お探しの記事は削除されたか、URLが変更された可能性があります。</p>" +
    "</div></main>";
}
function tagsHtml(tags) {
  return (tags || []).map((t) => '<span class="art-tag">' + esc(t) + "</span>").join("");
}

function indexBody(d) {
  const items = d.items || [];
  let cards = "";
  for (const a of items) {
    const tags = (a.tags || "").split(",").map((s) => s.trim()).filter(Boolean);
    const draft = a.status !== "published" ? '<span class="art-tag" style="border-color:var(--red);color:var(--red)">下書き</span>' : "";
    cards += '<a class="art-card" href="/articles/' + encodeURIComponent(a.slug) + '/">' +
      '<div class="art-date">' + fmtDate(a.created) + "</div>" +
      "<h2>" + esc(a.title) + "</h2>" +
      (a.description ? "<p>" + esc(a.description) + "</p>" : "") +
      '<div class="art-tags">' + tagsHtml(tags) + draft + "</div>" +
      "</a>";
  }
  const empty = '<p class="art-empty">記事は準備中です。もうしばらくお待ちください。</p>';
  return '<main><div class="doc-page">' +
    '<a class="doc-back" href="/">← トップへ戻る</a>' +
    "<h1>記事・特集</h1>" +
    '<div class="doc-sub">ポーランドボールとPBer文化についての解説・読み物。</div>' +
    '<div class="art-list">' + (cards || empty) + "</div>" +
    "</div></main>";
}

function articleBody(d) {
  const meta = '<div class="art-meta"><time datetime="' + isoDate(d.created) + '">' + fmtDate(d.created) + "</time>" +
    (d.tags && d.tags.length ? '<span class="art-tags">' + tagsHtml(d.tags) + "</span>" : "") +
    (d.status !== "published" ? '<span class="art-tag" style="border-color:var(--red);color:var(--red)">下書き(管理者のみ)</span>' : "") +
    "</div>";
  return '<main><div class="doc-page article">' +
    '<a class="doc-back" href="/articles/">← 記事一覧へ</a>' +
    "<h1>" + esc(d.title) + "</h1>" + meta + d.html +
    '<hr><p class="art-foot-note">この記事は PBers 運営による解説記事です。ご指摘・ご要望は ' +
    '<a href="mailto:contact@pbers.com">contact@pbers.com</a> まで。</p>' +
    '<p><a class="doc-back" href="/articles/">← 記事一覧へ戻る</a></p>' +
    "</div></main>";
}

export async function onRequest(context) {
  const { request, params } = context;
  let segs = params && params.path ? params.path : [];
  if (typeof segs === "string") segs = [segs];
  segs = (segs || []).filter((s) => s && s.length);
  const slug = segs.length ? decodeURIComponent(segs[segs.length - 1]) : "";

  // 管理者クッキーを X-Board-Key に載せ替えて Worker に問い合わせ
  const cookie = request.headers.get("Cookie") || "";
  const mk = cookie.match(/(?:^|;\s*)pbers_ak=([^;]+)/);
  const headers = mk ? { "X-Board-Key": decodeURIComponent(mk[1]) } : {};

  let d = {};
  try {
    const r = await fetch(WORKER + "/api/articles/page?slug=" + encodeURIComponent(slug), { headers });
    d = await r.json();
  } catch (e) {
    d = { error: "fetch_failed" };
  }

  const canonical = SITE + "/articles/" + (slug ? encodeURIComponent(slug) + "/" : "");
  let body, title, desc, robots, jsonld = "", status = 200;

  if (d.index || !slug) {
    // 一覧
    if (d.gated) { body = gateBody(); title = "記事・特集"; desc = "準備中"; robots = "noindex,follow"; }
    else {
      body = indexBody(d);
      title = "記事・特集｜ポーランドボール解説";
      desc = "ポーランドボール(Polandball)やポーランドボーラー(PBer)についての解説・特集記事。";
      robots = d.public ? "index,follow" : "noindex,follow";
      jsonld = JSON.stringify({ "@context": "https://schema.org", "@type": "CollectionPage", name: "記事・特集｜PBers", url: canonical, inLanguage: "ja" });
    }
  } else if (d.found === false) {
    body = notFoundBody(); title = "記事が見つかりません"; desc = "記事が見つかりません"; robots = "noindex,follow"; status = 404;
  } else if (d.gated) {
    body = gateBody(); title = "準備中"; desc = "準備中"; robots = "noindex,follow";
  } else if (d.found) {
    body = articleBody(d);
    title = d.title; desc = d.description || "";
    const indexable = d.public && d.status === "published";
    robots = indexable ? "index,follow" : "noindex,follow";
    if (indexable) {
      jsonld = JSON.stringify({
        "@context": "https://schema.org", "@type": "Article", headline: d.title, description: d.description || "",
        datePublished: isoDate(d.created), dateModified: isoDate(d.updated), inLanguage: "ja",
        author: { "@type": "Organization", name: "PBers 運営" },
        publisher: { "@type": "Organization", name: "PBers", logo: { "@type": "ImageObject", url: "https://pbers.com/favicon.png" } },
        image: "https://pbers.com/favicon.png", mainEntityOfPage: canonical
      });
    }
  } else {
    // DB未設定など
    body = notFoundBody(); title = "記事"; desc = ""; robots = "noindex,follow"; status = 200;
  }

  const page = shell({ title, desc, canonical, robots, jsonld, body });
  return new Response(page, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": robots,
      "cache-control": "no-store"
    }
  });
}
