# -*- coding: utf-8 -*-
"""data.json -> assets/data.js（登録者数・総再生数・投稿数・固有色つき）
   history.csv -> assets/news.js（直近7日のマイルストーン突破ニュース）"""
import json, colorsys, re, os, csv, datetime, urllib.parse

BASE = os.path.dirname(os.path.abspath(__file__))   # works on Windows and on CI (Linux)
JST = datetime.timezone(datetime.timedelta(hours=9))
# データの基準日 = 前日(JST 0時取得を前日分とみなす)
ASOF = (datetime.datetime.now(JST) - datetime.timedelta(days=1)).date()
UPDATED = ASOF.strftime("%Y-%m-%d")
SITE = "https://pbers.pages.dev"   # 独自ドメイン接続後は https://pbers.com に変更

# マイルストーンの刻み: 登録者=1万, 総再生=1000万, 投稿=100
STEPS = {
    "subs":   (10000,    "登録者"),
    "views":  (10000000, "総再生数"),
    "videos": (100,      "投稿数"),
}
METRICWORD = {"subs": "登録者数", "views": "総再生数", "videos": "投稿数"}

# ジャンル分け。未指定は通常のポーランドボーラー。
DEFAULT_GENRE = "ポーランドボーラー"
GENRE = {
    "UCmzj8pO1YtKLmcmaMPf9wbQ": "ポーランドボーラーのようなもの",
    "UCnZNY63Txhu4ot3l2lbicOA": "PBerer",
}
# 設定パネルの並び順と初期表示（通常のみ表示、その他は非表示）
GENRES = [
    {"label": DEFAULT_GENRE,                 "on": True},
    {"label": "ポーランドボーラーのようなもの", "on": False},
    {"label": "PBerer",                      "on": False},
]
def genre_of(cid):
    return GENRE.get(cid, DEFAULT_GENRE)
WD = ["月", "火", "水", "木", "金", "土", "日"]  # date.weekday(): Mon=0

def milestone_label(metric, v):
    if metric == "subs":
        return "登録者 %d万人 突破" % (v // 10000)
    if metric == "views":
        if v >= 100000000:
            return "総再生数 %g億回 突破" % (v / 100000000)
        return "総再生数 %d万回 突破" % (v // 10000)
    return "投稿数 %d本 突破" % v

# 引退者: データ取得・記録は続けるが、グラフ・一覧・ニュースには載せない
RETIRED = {
    "UCxtGe9mRTjabQjwvmhqc5nw",  # 引退募集
    "UCH3w-77t9kRWVNqKwQPIq_A",  # リアイオ
    "UCkAgeT1zuPieZCmlCl47htA",  # 緑玉
    "UCSmj0fs41NTFbDZYyEZsoQw",  # すこるある
    "UCJgwnMYDdnyskJ7zsSXuVfw",  # スターボール
    "UC96ekumgW3ymYIz1T_3ZmVw",  # 引退
    "UCksVp34yDXswzafRM_HfO0w",  # 引退
    "UCSzLt1x0-MwXF35nP23nsVA",  # 引退
    "UCvf-UiLQzKEGKYoMvwCGYbA",  # 引退
    "UCPpw3ZMnEraWpMPSrwCzOog",  # 引退済み
}

# 指定の固定カラー(チャンネルID -> hex)
FIXED = {
    "UCkjdTrE4hiJ4qNOV7NPGSSw": "#9b51e0",  # フヒフム
    "UCRCQ3G1d0DM2krO-Fx5LOuQ": "#eba864",  # みかんぼーる
    "UC6BwO1hK3hHd-Hr43jokcyg": "#2f80ed",  # 田中MID
    "UC_qD8VahU0Fr3q1SKg6kYtg": "#e01e26",  # さとボール (b00008 の見やすい赤)
    "UCnaMFejTyu396-R4GYhXD_Q": "#7a62d2",  # エッバ (紫)
    "UC8BA486HqgHSLO82YlPNFfw": "#c62f2f",  # はなひに (さとに近い赤)
    "UCxKNMaOOdi32HNUFTOCw-8w": "#e35d52",  # ナユ (赤系・コーラル)
    "UCGo_IzKD2-TooYrTGFt2fDA": "#ecc233",  # ゆずボール (黄)
    "UC9SB9xRrmdZ9Jt0aXkWuCOg": "#46b6e0",  # BALL420 (水色)
    "UCajUGvWXtYUcTHD3E3y138w": "#40a86a",  # かにたる (緑)
    "UC-fbc__tWFtZSnyBSvTP7vg": "#8f2f2f",  # Yukkuri ball (赤系・暗)
    "UC0kY7Nwjt8qkErtdxl3iuIw": "#b5382f",  # 日本ボール (赤系・レンガ)
    "UCVxwV9hTI2DVS0exkZ-Mqww": "#3a72d6",  # 作 (青)
    "UCVYMXYU6j0M5Gj1xwywKDyg": "#db4f57",  # 新規 (赤系・ローズ)
}

def hsl(h, s, l):
    r, g, b = colorsys.hls_to_rgb(h / 360, l, s)
    return "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))

def vids(label):
    if not label:
        return None
    m = re.search(r"([\d,\.]+)", label)
    return int(float(m.group(1).replace(",", ""))) if m else None

def slugify(name, cid):
    """チャンネル名から URL 用スラッグを作る（日本語はそのまま、絵文字/記号は除去）。"""
    s = name.replace("Æž!", "").strip()
    s = re.sub(r"\s+", "-", s)                 # 空白 -> ハイフン
    s = re.sub(r"[^\w\-]", "", s, flags=re.UNICODE)  # 絵文字・記号を除去（日本語/英数字/_/-は残す）
    s = re.sub(r"[-_]{2,}", "-", s).strip("-_").lower()
    return s or cid.lower()

def assign_slugs(order):
    used = {}
    for d in order:
        base = slugify(d["name"], d["id"])
        slug, n = base, 2
        while slug in used:
            slug = base + "-" + str(n); n += 1
        used[slug] = True
        d["_slug"] = slug

def main():
    data = json.load(open(BASE + "/data.json", encoding="utf-8"))
    shown = [d for d in data if d["id"] not in RETIRED]   # 引退者はサイトに載せない
    order = sorted(shown, key=lambda x: (x.get("subs") or 0), reverse=True)
    assign_slugs(order)   # d["_slug"] を付与

    colors, pi = {}, 0
    for d in order:
        if d["id"] in FIXED:
            colors[d["id"]] = FIXED[d["id"]]
            continue
        colors[d["id"]] = hsl((pi * 53) % 360, 0.58, 0.60 if pi % 2 == 0 else 0.52)
        pi += 1

    out = [{
        "name": d["name"], "subs": d.get("subs"), "views": d.get("views"),
        "subsLabel": d.get("subsLabel"), "viewsLabel": d.get("viewsLabel"),
        "videos": vids(d.get("videosLabel")), "url": d["url"],
        "avatar": d["avatar"], "color": colors[d["id"]], "genre": genre_of(d["id"]),
        "slug": d["_slug"],
    } for d in order]

    with open(BASE + "/assets/data.js", "w", encoding="utf-8") as f:
        f.write("window.PBERS_DATA = " + json.dumps(out, ensure_ascii=False, indent=2) + ";\n")
        f.write("window.PBERS_GENRES = " + json.dumps(GENRES, ensure_ascii=False) + ";\n")
        f.write('window.PBERS_UPDATED = "%s";\n' % UPDATED)
    print("wrote assets/data.js (%d channels)" % len(out))

    build_news(colors)
    build_growth(colors)
    build_channel_pages(order, colors)
    build_sitemap(order)

CH_TPL = '''<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{TITLE}} の登録者数・再生数・投稿数｜PBers</title>
<meta name="description" content="{{TITLE}}（ポーランドボーラー）の登録者数・総再生数・投稿数の推移とデータ。PBers調べ、毎日更新。">
<meta name="robots" content="index,follow">
<link rel="canonical" href="{{SITE}}/c/{{SLUG}}/">
<link rel="icon" type="image/png" href="../../favicon.png">
<meta property="og:type" content="profile">
<meta property="og:site_name" content="PBers">
<meta property="og:title" content="{{TITLE}}｜登録者数・再生数まとめ｜PBers">
<meta property="og:description" content="{{TITLE}}の登録者数・総再生数・投稿数の推移。">
<meta property="og:url" content="{{SITE}}/c/{{SLUG}}/">
<meta property="og:image" content="{{AVATAR}}">
<meta name="twitter:card" content="summary">
<script>
(function(){var u=location.origin+location.pathname;var c=document.querySelector('link[rel=canonical]');if(c)c.href=u;var o=document.querySelector('meta[property="og:url"]');if(o)o.setAttribute('content',u);})();
</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="../../assets/style.css?v=250825">
</head>
<body>
<header class="topbar"><div class="wrap">
  <a class="brand" href="../../"><span class="dot"></span><span>PB<b>ers</b></span></a>
</div></header>
<main class="ch-page"><div class="wrap">
  <a class="ch-back" href="../../">← 一覧へ戻る</a>
  <div id="ch-root"></div>
</div></main>
<footer><div class="wrap">
  <a class="brand" href="../../"><span class="dot"></span><span>PB<b>ers</b></span></a>
  <div>データ出典: YouTube 各チャンネル公開情報</div>
</div></footer>
<script>window.CH = {{CH}};</script>
<script>window.CH_HISTORY = {{HIST}};</script>
<script src="../../assets/channel.js?v=250825"></script>
</body>
</html>
'''

def build_channel_pages(order, colors):
    import shutil, html as _html
    series, _ = load_history()
    cdir = os.path.join(BASE, "c")
    if os.path.isdir(cdir):
        shutil.rmtree(cdir)
    os.makedirs(cdir, exist_ok=True)
    total = len(order)
    for i, d in enumerate(order):
        cid = d["id"]; slug = d["_slug"]
        hist = series.get(cid, {})
        hd = sorted(hist.keys())
        HH = {"dates": hd,
              "subs": [hist[x]["subs"] for x in hd],
              "views": [hist[x]["views"] for x in hd],
              "videos": [hist[x]["videos"] for x in hd]}
        ch = {"id": cid, "name": d["name"], "subs": d.get("subs"), "views": d.get("views"),
              "videos": d.get("videos") if d.get("videos") is not None else vids(d.get("videosLabel")),
              "url": d["url"], "avatar": d["avatar"], "color": colors[cid],
              "genre": genre_of(cid), "rank": i + 1, "total": total}
        page = (CH_TPL
                .replace("{{TITLE}}", _html.escape(d["name"]))
                .replace("{{SLUG}}", urllib.parse.quote(slug))
                .replace("{{AVATAR}}", _html.escape(d["avatar"]))
                .replace("{{SITE}}", SITE)
                .replace("{{CH}}", json.dumps(ch, ensure_ascii=False))
                .replace("{{HIST}}", json.dumps(HH, ensure_ascii=False)))
        os.makedirs(os.path.join(cdir, slug), exist_ok=True)
        with open(os.path.join(cdir, slug, "index.html"), "w", encoding="utf-8") as f:
            f.write(page)
    print("wrote %d channel pages" % total)

def build_sitemap(order):
    urls = [SITE + "/"] + [SITE + "/c/" + urllib.parse.quote(d["_slug"]) + "/" for d in order]
    body = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    for u in urls:
        body += '  <url><loc>%s</loc><changefreq>daily</changefreq></url>\n' % u
    body += '</urlset>\n'
    with open(os.path.join(BASE, "sitemap.xml"), "w", encoding="utf-8") as f:
        f.write(body)
    print("wrote sitemap.xml (%d urls)" % len(urls))

def load_history():
    path = BASE + "/history.csv"
    series, names = {}, {}
    if os.path.exists(path):
        with open(path, encoding="utf-8", newline="") as f:
            for row in csv.DictReader(f):
                def num(x):
                    x = (x or "").strip()
                    return int(x) if x.lstrip("-").isdigit() else None
                cid, d = row["id"], row["date"]
                series.setdefault(cid, {})[d] = {
                    "subs": num(row["subs"]), "views": num(row["views"]), "videos": num(row["videos"])
                }
                names[cid] = row["name"]
    return series, names

def build_growth(colors):
    """直近7日（貯まっていなければある範囲）の増加数ランキングを growth.js に出力。"""
    series, names = load_history()
    shown = set(colors.keys())
    all_dates = sorted({d for m in series.values() for d in m})
    lo = (ASOF - datetime.timedelta(days=6)).isoformat()
    hi = ASOF.isoformat()
    win = [d for d in all_dates if lo <= d <= hi]

    result = {"span": {"from": None, "to": None, "days": 0}, "subs": [], "views": [], "videos": []}
    if win:
        earliest, latest = win[0], win[-1]
        span = (datetime.date.fromisoformat(latest) - datetime.date.fromisoformat(earliest)).days
        result["span"] = {"from": earliest, "to": latest, "days": span}

        def gv(cid, d, m):
            rec = series.get(cid, {}).get(d)
            return rec[m] if rec else None

        for metric in ("subs", "views", "videos"):
            arr = []
            for cid in shown:
                a, b = gv(cid, earliest, metric), gv(cid, latest, metric)
                if a is None or b is None:
                    continue
                arr.append({"name": names[cid], "color": colors[cid], "delta": b - a, "latest": b, "genre": genre_of(cid)})
            arr.sort(key=lambda x: -x["delta"])
            result[metric] = arr

    # 界隈全体の推移: 通常ジャンル(引退除く)の日別合計を全履歴ぶん
    main_ids = [cid for cid in series if cid not in RETIRED and genre_of(cid) == DEFAULT_GENRE]
    tdates = sorted({d for cid in main_ids for d in series[cid]})
    totals = {"dates": tdates, "subs": [], "views": [], "videos": []}
    for d in tdates:
        for m in ("subs", "views", "videos"):
            s = 0
            for cid in main_ids:
                rec = series.get(cid, {}).get(d)
                if rec and rec[m] is not None:
                    s += rec[m]
            totals[m].append(s)
    result["totals"] = totals

    with open(BASE + "/assets/growth.js", "w", encoding="utf-8") as f:
        f.write("window.PBERS_GROWTH = " + json.dumps(result, ensure_ascii=False, indent=2) + ";\n")
    print("wrote assets/growth.js (span %s days, %d trend points)" % (result["span"]["days"], len(tdates)))

def build_news(colors):
    """history.csv から直近7日（当日含む）のマイルストーン突破を検出して news.js を出力。
       各チャンネル・各指標について、前回記録日→当日で刻みを跨いだら「突破」ニュースにする。"""
    path = BASE + "/history.csv"
    series, names = {}, {}
    if os.path.exists(path):
        with open(path, encoding="utf-8", newline="") as f:
            for row in csv.DictReader(f):
                def num(x):
                    x = (x or "").strip()
                    return int(x) if x.lstrip("-").isdigit() else None
                cid, d = row["id"], row["date"]
                series.setdefault(cid, {})[d] = {
                    "subs": num(row["subs"]), "views": num(row["views"]), "videos": num(row["videos"])
                }
                names[cid] = row["name"]

    window = [ASOF - datetime.timedelta(days=i) for i in range(7)]   # 基準日(前日)〜6日前
    by_date = {d.isoformat(): [] for d in window}

    shown = set(colors.keys())                          # 引退者以外
    all_dates = sorted({d for m in series.values() for d in m})
    prev_of = {all_dates[i]: all_dates[i - 1] for i in range(1, len(all_dates))}

    def gv(cid, d, metric):
        rec = series.get(cid, {}).get(d)
        return rec[metric] if rec else None

    for D in sorted(by_date.keys()):
        if D not in prev_of:                            # 前日がなければ比較不可
            continue
        P = prev_of[D]
        for metric in STEPS:
            step = STEPS[metric][0]
            # (1) マイルストーン突破
            for cid in shown:
                cur, pv = gv(cid, D, metric), gv(cid, P, metric)
                if cur is None or pv is None:
                    continue
                if cur // step > pv // step:
                    reached = (cur // step) * step
                    by_date[D].append({
                        "type": "milestone", "kind": metric, "name": names[cid],
                        "color": colors[cid], "icon": "🎉", "genre": genre_of(cid),
                        "label": milestone_label(metric, reached), "value": reached,
                    })
            # (2) 追い越し（Aが前日はBの下、当日はBの上）
            elig = [c for c in shown if gv(c, D, metric) is not None and gv(c, P, metric) is not None]
            for a in elig:
                ca, pa = gv(a, D, metric), gv(a, P, metric)
                for b in elig:
                    if a == b:
                        continue
                    if pa < gv(b, P, metric) and ca > gv(b, D, metric):
                        by_date[D].append({
                            "type": "overtake", "kind": metric, "name": names[a],
                            "color": colors[a], "icon": "⤴️", "genre": genre_of(a),
                            "label": "%sで %s を追い越し" % (METRICWORD[metric], names[b]),
                            "value": ca,
                        })

    korder = {"subs": 0, "views": 1, "videos": 2}
    torder = {"milestone": 0, "overtake": 1}
    news = []
    for d in sorted(by_date.keys(), reverse=True):     # 新しい日が上
        items = sorted(by_date[d], key=lambda x: (torder[x["type"]], korder[x["kind"]], -x["value"]))
        dd = datetime.date.fromisoformat(d)
        news.append({"date": d, "label": "%d月%d日(%s)" % (dd.month, dd.day, WD[dd.weekday()]), "items": items})

    with open(BASE + "/assets/news.js", "w", encoding="utf-8") as f:
        f.write("window.PBERS_NEWS = " + json.dumps(news, ensure_ascii=False, indent=2) + ";\n")
    total = sum(len(n["items"]) for n in news)
    print("wrote assets/news.js (%d days, %d news items)" % (len(news), total))

main()
