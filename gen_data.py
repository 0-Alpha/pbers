# -*- coding: utf-8 -*-
"""data.json -> assets/data.js（登録者数・総再生数・投稿数・固有色つき）
   history.csv -> assets/news.js（直近7日のマイルストーン突破ニュース）"""
import json, colorsys, re, os, csv, datetime, urllib.parse

BASE = os.path.dirname(os.path.abspath(__file__))   # works on Windows and on CI (Linux)
JST = datetime.timezone(datetime.timedelta(hours=9))

def day_of(ts):
    """記録スロット(YYYY-MM-DD HH:MM)が属する「日」を返す。
       0時分は前日(=前日24時)として扱う。旧形式(日付のみ)はその日。"""
    ts = str(ts)
    if len(ts) <= 10:            # 旧形式(日付のみ) = その日
        return ts
    d, t = ts[:10], ts[11:16]
    if t == "00:00":
        return (datetime.date.fromisoformat(d) - datetime.timedelta(days=1)).isoformat()
    return d

def daily_reps(ts_iterable):
    """スロット群を「日 -> その日の最終スロット」に集約する(グラフ表示を1日1点にするため)。"""
    rep = {}
    for t in sorted(ts_iterable):     # 昇順なので各日は最後(=最新)のスロットで上書きされる
        rep[day_of(t)] = t
    return rep

# データの基準日 = 直近スロットが属する日(JST 0時取得は前日分とみなす)
_now = datetime.datetime.now(JST)
ASOF = (_now.date() - datetime.timedelta(days=1)) if (_now.hour // 6) * 6 == 0 else _now.date()
UPDATED = ASOF.strftime("%Y-%m-%d")   # main() で実データの最新日に更新
SITE = "https://pbers.pages.dev"   # 独自ドメイン接続後は https://pbers.com に変更

# ---- エディション: 通常サイト(ルート) と 海外向けサイト(/global/) ----
# 各エディションは自分の channels/data/history を持ち、自分のサブパス配下に出力する。
# コード(style.css, app.js, channel.js)は /assets/ を共有する。
EDITIONS = [
    {"sub": "",       "channels": "channels.txt",        "data": "data.json",        "history": "history.csv",        "label": "PBers"},
    {"sub": "global", "channels": "channels_global.txt", "data": "data_global.json", "history": "history_global.csv", "label": "PBers Global"},
]
ED = EDITIONS[0]   # ビルド中のエディション(build_all で切替)

def ed_root():   # 出力ルート(BASE または BASE/global)
    return BASE if not ED["sub"] else os.path.join(BASE, ED["sub"])
def ed_out(*parts):
    return os.path.join(ed_root(), *parts)
def ed_base():   # ページ内のベースパス("/" または "/global/")
    return "/" if not ED["sub"] else "/" + ED["sub"] + "/"
def ed_site():   # 絶対URL(sitemap/canonical用)
    return SITE if not ED["sub"] else SITE + "/" + ED["sub"]
def ed_data_path():
    return os.path.join(BASE, ED["data"])

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
    "UCnZNY63Txhu4ot3l2lbicOA": "PBerer",
}
# 設定パネルの並び順と初期表示（通常のみ表示、その他は非表示）
GENRES = [
    {"label": DEFAULT_GENRE,                 "on": True},
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

def view_milestone(cur):
    # 1億以上=5000万毎 / 1000万以上=1000万毎 / 100万以上=100万毎 / 100万未満=対象外
    if cur >= 100000000:
        step = 50000000
    elif cur >= 10000000:
        step = 10000000
    elif cur >= 1000000:
        step = 1000000
    else:
        return None
    return (cur // step) * step

def milestone_reached(metric, pv, cur):
    """前回値 pv から当日値 cur で新たに到達した最上位のキリ番。無ければ None。"""
    if pv is None or cur is None:
        return None
    if metric == "subs":
        s = 10000
        return (cur // s) * s if cur // s > pv // s else None
    if metric == "videos":
        s = 100
        return (cur // s) * s if cur // s > pv // s else None
    if metric == "views":
        m = view_milestone(cur)
        return m if (m is not None and m > pv) else None
    return None

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
    "UC8BA486HqgHSLO82YlPNFfw",  # はなひに (2026-08-26 YouTube側で削除/利用不可)
    "UCPgo3vhueVGcmxye8KXomag",  # 削除済み (name=ID・取得不可。2026-08 確認)
    "UCxo0gJCLvrgRdAGuPlpz4Pw",  # 英仏マン (引退済み)
    "UC0dwNfKKsU48BC_jlVzJdig",  # ノキア (引退済み)
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
    "UCvYaUyxK_wqez1bJYyFslRg": "#e3e5ea",  # ボウコムボール (白め)
    "UCpOhdzl-CTUQ8xHonbVWsZw": "#4ec3e6",  # うずまき (水色)
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

def build_edition_index():
    """海外向けエディションの index.html を通常版から生成。
       データ系スクリプトだけ /global/assets/ を指し、コード(app.js/style.css)は共有。
       window.PBERS_BASE でSPAのリンク/ルーティングの基点を /global/ に切り替える。"""
    with open(os.path.join(BASE, "index.html"), encoding="utf-8") as f:
        html = f.read()
    base = ed_base()   # "/global/"
    for name in ("data.js", "news.js", "growth.js", "race.js"):
        html = html.replace("/assets/" + name, base + "assets/" + name)
    html = html.replace('<script src="/assets/app.js',
                        '<script>window.PBERS_BASE="%s";</script>\n<script src="/assets/app.js' % base)
    # 海外向けは別Worker未設定なので最新動画APIは無効化(タブは「準備中」表示になる)
    html = html.replace('window.PBERS_VIDEOS_API = "https://pbers-cron.myray0629.workers.dev/videos"',
                        'window.PBERS_VIDEOS_API = ""')
    html = html.replace("ポーランドボーラー登録者・再生数まとめ分析｜PBers",
                        "海外向けポーランドボーラー まとめ分析｜PBers Global")
    os.makedirs(ed_root(), exist_ok=True)
    with open(ed_out("index.html"), "w", encoding="utf-8") as f:
        f.write(html)

def main():
    """全エディション(通常 + 海外向け)をビルド。"""
    global ED
    for ed in EDITIONS:
        ED = ed
        print("=== build edition: %s (%s) ===" % (ed["label"], ed["sub"] or "root"))
        build_edition()
    ED = EDITIONS[0]

def build_edition():
    global UPDATED
    os.makedirs(ed_out("assets"), exist_ok=True)
    if ED["sub"]:
        build_edition_index()   # /global/index.html を先に用意(view pages の元になる)
    # 実データの最新スロットが属する日を「更新日」にする
    _series, _ = load_history()
    _all_ts = sorted({t for m in _series.values() for t in m})
    UPDATED = day_of(_all_ts[-1]) if _all_ts else ASOF.strftime("%Y-%m-%d")

    data = json.load(open(ed_data_path(), encoding="utf-8")) if os.path.exists(ed_data_path()) else []
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

    with open(ed_out("assets", "data.js"), "w", encoding="utf-8") as f:
        f.write("window.PBERS_DATA = " + json.dumps(out, ensure_ascii=False, indent=2) + ";\n")
        f.write("window.PBERS_GENRES = " + json.dumps(GENRES, ensure_ascii=False) + ";\n")
        f.write('window.PBERS_UPDATED = "%s";\n' % UPDATED)
        f.write("window.PBERS_PREDICT = " + json.dumps(compute_predict(colors), ensure_ascii=False) + ";\n")
    print("wrote assets/data.js (%d channels)" % len(out))

    build_news(colors)
    build_growth(colors)
    build_race(colors)
    build_channel_pages(order, colors)
    build_view_pages()
    build_sitemap(order)

    # WebSub(新着動画通知)用: 監視対象チャンネルIDの一覧
    with open(ed_out("channels.json"), "w", encoding="utf-8") as f:
        json.dump([d["id"] for d in order], f, ensure_ascii=False)
    print("wrote channels.json (%d ids)" % len(order))

def build_race(colors):
    """登録者が接戦(隣接との差が1%以内)のチャンネルを2〜3件ずつグループ化し、
       各メンバーの登録者推移とともに race.js に出力。"""
    series, names = load_history()
    by_id = {}
    amap = {}
    try:
        for d in json.load(open(ed_data_path(), encoding="utf-8")):
            by_id[d["id"]] = d; amap[d["id"]] = d.get("avatar", "")
    except Exception:
        pass
    items = [(cid, (by_id[cid].get("subs") or 0)) for cid in colors
             if genre_of(cid) == DEFAULT_GENRE and cid in by_id and (by_id[cid].get("subs"))]
    items.sort(key=lambda x: -x[1])

    groups, i = [], 0
    while i < len(items):
        j = i
        while j + 1 < len(items) and (j - i + 1) < 3:
            hi = items[j][1]
            if hi > 0 and (hi - items[j + 1][1]) <= hi / 100.0:
                j += 1
            else:
                break
        if j > i:
            groups.append([items[k][0] for k in range(i, j + 1)])
            i = j + 1
        else:
            i += 1

    def member(cid):
        hist = series.get(cid, {})
        rep = daily_reps(hist.keys())    # 1日1点(その日の最終値)に集約
        pts = [{"d": d, "s": hist[rep[d]]["subs"]} for d in sorted(rep) if hist[rep[d]]["subs"] is not None]
        return {"name": names.get(cid, ""), "color": colors[cid], "avatar": amap.get(cid, ""),
                "subs": by_id[cid].get("subs"), "history": pts}

    out = []
    # 特別枠: 上位3チャンネルの首位争い(差に関係なく必ず表示)
    top = [cid for cid, _ in items[:3]]
    if len(top) >= 2:
        out.append({"special": True, "title": "首位争い TOP3", "members": [member(cid) for cid in top]})

    for g in groups:
        out.append({"members": [member(cid) for cid in g]})

    with open(ed_out("assets", "race.js"), "w", encoding="utf-8") as f:
        f.write("window.PBERS_RACE = " + json.dumps(out, ensure_ascii=False, indent=2) + ";\n")
    print("wrote assets/race.js (%d races incl. TOP3)" % len(out))

CH_TPL = '''<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{TITLE}} の登録者数・再生数・投稿数｜PBers</title>
<meta name="description" content="{{TITLE}}（ポーランドボーラー）の登録者数・総再生数・投稿数の推移とデータ。PBers調べ、毎日更新。">
<meta name="robots" content="index,follow">
<link rel="canonical" href="{{SITE}}/c/{{SLUG}}/">
<link rel="icon" type="image/png" href="/favicon.png">
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
<link rel="stylesheet" href="/assets/style.css?v=250873">
</head>
<body>
<header class="topbar"><div class="wrap">
  <a class="brand" href="../../"><span class="dot"></span><span>PB<b>ers</b></span></a>
</div></header>
<main class="ch-page"><div class="wrap">
  <a class="ch-back" href="../../">← 一覧へ戻る</a>
  <div id="ch-root" style="--accent:{{COLOR}}">{{HEADER}}</div>
</div></main>
<footer><div class="wrap">
  <a class="brand" href="../../"><span class="dot"></span><span>PB<b>ers</b></span></a>
  <div>データ出典: YouTube 各チャンネル公開情報</div>
</div></footer>
<script>window.CH = {{CH}};</script>
<script>window.CH_HISTORY = {{HIST}};</script>
<script src="/assets/channel.js?v=250873"></script>
</body>
</html>
'''

def _sig3(x):
    d = 2 if x < 10 else (1 if x < 100 else 0)
    return ("%.*f" % (d, x)).rstrip("0").rstrip(".")

def _jp(n):
    if n is None:
        return "—"
    if n >= 1e8:
        return _sig3(n / 1e8) + "億"
    if n >= 1e4:
        return _sig3(n / 1e4) + "万"
    return "{:,}".format(n)

def _stat_tile(label, v, unit):
    if v is None:
        return '<div class="ch-tile"><div class="k">%s</div><div class="v num">非公開</div><div class="sub"></div></div>' % label
    return ('<div class="ch-tile"><div class="k">%s</div>'
            '<div class="v num">%s<small>%s</small></div>'
            '<div class="sub">%s%s</div></div>') % (label, "{:,}".format(v), unit, _jp(v), unit)

def ch_header_html(d, videos, rank, total, esc, bytype_html=""):
    """チャンネル個別ページのヘッダを静的HTMLで生成(SEO用に名前・数値・説明文を本文に載せる)。"""
    name = esc(d["name"])
    return (
        '<div class="ch-head">'
          '<img class="ch-av" src="' + esc(d["avatar"]) + '" alt="' + name + ' のアイコン" onerror="this.style.visibility=\'hidden\'">'
          '<div class="ch-meta">'
            '<div class="ch-genre">' + esc(genre_of(d["id"])) + ' ・ 総合 ' + str(rank) + '位 / ' + str(total) + '</div>'
            '<h1 class="ch-name">' + name + '</h1>'
            '<p class="ch-lead">' + name + '（ポーランドボーラー）の登録者数・総再生数・投稿数と、その推移をまとめたページです。PBers調べ・毎日更新。</p>'
            '<div class="ch-actions">'
              '<a class="yt-btn" href="' + esc(d["url"]) + '" target="_blank" rel="noopener">YouTube ↗</a>'
              '<button class="sh sh-x" id="sh-x">𝕏 シェア</button>'
              '<button class="sh sh-copy" id="sh-copy">リンクをコピー</button>'
            '</div>'
          '</div>'
        '</div>'
        '<div class="ch-stats">' +
          _stat_tile("登録者数", d.get("subs"), "人") +
          _stat_tile("総再生数", d.get("views"), "回") +
          _stat_tile("投稿数", videos, "本") +
        '</div>'
        + bytype_html +
        '<div class="sec-head" style="margin-top:34px"><h2>推移 <span class="en">History</span></h2>'
          '<span class="note" id="ch-note"></span></div>'
        '<div class="controls" style="justify-content:flex-start"><div class="toggle" id="ch-toggle">'
          '<button class="tg on" data-gm="subs">登録者</button>'
          '<button class="tg" data-gm="views">総再生数</button>'
          '<button class="tg" data-gm="videos">投稿数</button>'
          '<span class="tg-ind" id="ch-tind"></span></div></div>'
        '<div class="trend" id="ch-chart"></div>'
    )

def load_bytype():
    """fetch_bytype.py が出力した bytype.json を {id: data} で読む。無ければ空。"""
    p = os.path.join(BASE, "bytype.json")
    if not os.path.exists(p):
        return {}
    try:
        return {r["id"]: r for r in json.load(open(p, encoding="utf-8"))}
    except Exception:
        return {}

def ch_bytype_html(bt):
    """ロング/ショートの「投稿数」「総再生数」の比率バーを2本並べ、境目を点線で結ぶ。
       実数はカードに必ず載せ、バーは幅に余裕がある時だけ実数を添える(押し潰れ防止)。"""
    if not bt:
        return ""
    L, S = bt.get("long", {}), bt.get("short", {})
    ln, sn = L.get("n", 0), S.get("n", 0)
    lv, sv = L.get("views", 0), S.get("views", 0)
    tot, totv = ln + sn, lv + sv
    if tot == 0:
        return ""
    lp, sp = ln / tot * 100, sn / tot * 100                 # 投稿数の比率
    lvp = (lv / totv * 100) if totv else 0                  # 総再生数の比率(ロング/ショート)
    svp = (sv / totv * 100) if totv else 0
    la = lv // ln if ln else 0                              # ロング1本あたり平均再生
    sa = sv // sn if sn else 0                              # ショート1本あたり平均再生
    mx = max(la, sa) or 1
    p1 = lambda x: "%.1f" % x
    p0 = lambda x: "%.0f" % x

    def seg(cls, pct, raw):
        inner = '<b>' + p0(pct) + '%</b>'
        if pct >= 22:                                       # 幅に余裕がある時だけ実数を添える
            inner += '<i class="bt-raw">' + raw + '</i>'
        return ('<div class="bt-seg ' + cls + '" style="width:' + p1(pct) + '%">'
                '<span>' + inner + '</span></div>')

    def bar(lw, sw, lraw, sraw):
        return '<div class="bt-bar">' + seg("bt-long", lw, lraw) + seg("bt-short", sw, sraw) + '</div>'

    def card(cls, dot, label, n, vv, avg):
        return ('<div class="bt-card">'
                  '<div class="bt-k"><i class="bt-dot ' + dot + '"></i>' + label + '</div>'
                  '<div class="bt-rows">'
                    '<div class="bt-row"><span>投稿</span><b>' + "{:,}".format(n) + '<small>本</small></b></div>'
                    '<div class="bt-row"><span>再生</span><b>' + _jp(vv) + '<small>回</small></b></div>'
                  '</div>'
                  '<div class="bt-avgwrap">'
                    '<div class="bt-avglab">1本あたり <b>' + _jp(avg) + '</b> 回</div>'
                    '<div class="bt-avgbar"><span class="bt-fill ' + cls + '" style="width:'
                      + p1(avg / mx * 100) + '%"></span></div>'
                  '</div>'
                '</div>')

    # 上バー(投稿)の境目 lp% と 下バー(再生)の境目 lvp% を点線で結ぶ
    link = ('<div class="bt2-link"><span class="bt2-lab"></span>'
            '<svg class="bt-linksvg" viewBox="0 0 100 18" preserveAspectRatio="none" aria-hidden="true">'
              '<line x1="' + p1(lp) + '" y1="0" x2="' + p1(lvp) + '" y2="18"/>'
            '</svg></div>')

    return (
        '<div class="sec-head" style="margin-top:34px"><h2>動画タイプ別 <span class="en">By type</span></h2>'
          '<span class="note">全' + str(tot) + '本</span></div>'
        '<div class="bt bt2">'
          '<div class="bt-legend">'
            '<span class="bt-lg"><i class="bt-dot bt-dl"></i>ロング</span>'
            '<span class="bt-lg"><i class="bt-dot bt-ds"></i>ショート</span></div>'
          '<div class="bt2-row"><span class="bt2-lab">投稿数</span>'
            + bar(lp, sp, "{:,}本".format(ln), "{:,}本".format(sn)) + '</div>'
          + link +
          '<div class="bt2-row"><span class="bt2-lab">総再生数</span>'
            + bar(lvp, svp, _jp(lv) + "回", _jp(sv) + "回") + '</div>'
          '<div class="bt-cards">'
            + card("bt-fl", "bt-dl", "ロング", ln, lv, la)
            + card("bt-fs", "bt-ds", "ショート", sn, sv, sa) +
          '</div>'
        '</div>'
    )

def _rc_chip(d, esc):
    return ('<a class="rc-chip" href="../' + urllib.parse.quote(d["_slug"]) + '/">'
            '<img class="rc-av" loading="lazy" src="' + esc(d["avatar"]) + '" alt="" '
            'onerror="this.style.visibility=\'hidden\'">'
            '<span class="rc-nm">' + esc(d["name"]) + '</span>'
            '<span class="rc-sub">' + _jp(d.get("subs")) + '人</span></a>')

def ch_footer_html(order, i, growth_map, esc):
    """個別ページ下部: 前後ナビ + 関連チャンネル(近い規模 / 急上昇)。回遊導線。"""
    total = len(order)
    cur = order[i]
    # 前後ナビ(登録者ランキング順)
    nav = '<nav class="ch-nav" aria-label="前後のチャンネル">'
    if i > 0:
        p = order[i - 1]
        nav += ('<a class="cnav cn-prev" href="../' + urllib.parse.quote(p["_slug"]) + '/">'
                '<span class="cn-dir">◀ ' + str(i) + '位</span>'
                '<span class="cn-nm">' + esc(p["name"]) + '</span></a>')
    else:
        nav += '<span class="cnav cn-off"></span>'
    if i < total - 1:
        nx = order[i + 1]
        nav += ('<a class="cnav cn-next" href="../' + urllib.parse.quote(nx["_slug"]) + '/">'
                '<span class="cn-dir">' + str(i + 2) + '位 ▶</span>'
                '<span class="cn-nm">' + esc(nx["name"]) + '</span></a>')
    else:
        nav += '<span class="cnav cn-off"></span>'
    nav += '</nav>'
    # 近い規模(ランキング前後 ±4 から自分を除いて最大6)
    lo = max(0, i - 4); hi = min(total, i + 5)
    near = [order[j] for j in range(lo, hi) if j != i][:6]
    # 急上昇(直近7日の登録者増、自分を除く)
    rising = sorted((d for d in order if d["id"] != cur["id"]),
                    key=lambda d: growth_map.get(d["id"], 0), reverse=True)
    rising = [d for d in rising if growth_map.get(d["id"], 0) > 0][:6]
    out = nav
    if near:
        out += ('<div class="rc-block"><div class="rc-h">近い規模のチャンネル</div>'
                '<div class="rc-row">' + "".join(_rc_chip(d, esc) for d in near) + '</div></div>')
    if rising:
        out += ('<div class="rc-block"><div class="rc-h">急上昇中 <span class="rc-en">Rising</span></div>'
                '<div class="rc-row">' + "".join(_rc_chip(d, esc) for d in rising) + '</div></div>')
    return '<div class="ch-more">' + out + '</div>'

def build_channel_pages(order, colors):
    import shutil, html as _html
    series, _ = load_history()
    cdir = ed_out("c")
    if os.path.isdir(cdir):
        shutil.rmtree(cdir)
    os.makedirs(cdir, exist_ok=True)
    total = len(order)
    # 関連チャンネル「急上昇」用: 直近7日の登録者増(cid -> delta)
    _glo = (ASOF - datetime.timedelta(days=6)).isoformat()
    _ghi = ASOF.isoformat()
    growth_map = {}
    for cid, m in series.items():
        pts = [t for t in sorted(m) if _glo <= day_of(t) <= _ghi and m[t]["subs"] is not None]
        if len(pts) >= 2:
            growth_map[cid] = m[pts[-1]]["subs"] - m[pts[0]]["subs"]
    bt_map = load_bytype()   # 横/ショート内訳(bytype.json)。無いチャンネルはセクション非表示
    for i, d in enumerate(order):
        cid = d["id"]; slug = d["_slug"]
        hist = series.get(cid, {})
        rep = daily_reps(hist.keys())          # 1日1点(その日の最終値)に集約
        hd = sorted(rep.keys())
        HH = {"dates": hd,
              "subs": [hist[rep[x]]["subs"] for x in hd],
              "views": [hist[rep[x]]["views"] for x in hd],
              "videos": [hist[rep[x]]["videos"] for x in hd]}
        vcount = d.get("videos") if d.get("videos") is not None else vids(d.get("videosLabel"))
        ch = {"id": cid, "name": d["name"], "subs": d.get("subs"), "views": d.get("views"),
              "videos": vcount,
              "url": d["url"], "avatar": d["avatar"], "color": colors[cid],
              "genre": genre_of(cid), "rank": i + 1, "total": total}
        header = (ch_header_html(d, vcount, i + 1, total, _html.escape, ch_bytype_html(bt_map.get(cid)))
                  + ch_footer_html(order, i, growth_map, _html.escape))
        page = (CH_TPL
                .replace("{{TITLE}}", _html.escape(d["name"]))
                .replace("{{SLUG}}", urllib.parse.quote(slug))
                .replace("{{AVATAR}}", _html.escape(d["avatar"]))
                .replace("{{SITE}}", ed_site())
                .replace("{{COLOR}}", colors[cid])
                .replace("{{HEADER}}", header)
                .replace("{{CH}}", json.dumps(ch, ensure_ascii=False))
                .replace("{{HIST}}", json.dumps(HH, ensure_ascii=False)))
        os.makedirs(os.path.join(cdir, slug), exist_ok=True)
        with open(os.path.join(cdir, slug, "index.html"), "w", encoding="utf-8") as f:
            f.write(page)
    print("wrote %d channel pages" % total)

VIEW_ROUTES = ("growth", "news", "race", "game", "videos", "channels")

def build_view_pages():
    """SPAタブの実URL(/growth/ 等)への直アクセス・リロード用に index.html の複製を置く。
       pushStateのクリーンURLをCloudflare Pagesで成立させる。中身は同一シェルなので
       重複コンテンツ回避のため noindex にする(検索対象はトップ / のまま)。"""
    src = ed_out("index.html")
    if not os.path.exists(src):
        return
    with open(src, encoding="utf-8") as f:
        html_src = f.read()
    html_src = html_src.replace('name="robots" content="index,follow"',
                                'name="robots" content="noindex,follow"')
    for v in VIEW_ROUTES:
        d = ed_out(v)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "index.html"), "w", encoding="utf-8") as f:
            f.write(html_src)
    print("wrote view pages (%s)" % "/".join(VIEW_ROUTES))

def build_sitemap(order):
    urls = [ed_site() + "/"] + [ed_site() + "/c/" + urllib.parse.quote(d["_slug"]) + "/" for d in order]
    body = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    for u in urls:
        body += '  <url><loc>%s</loc><changefreq>daily</changefreq></url>\n' % u
    body += '</urlset>\n'
    with open(ed_out("sitemap-pbers.xml"), "w", encoding="utf-8") as f:
        f.write(body)
    print("wrote sitemap-pbers.xml (%d urls)" % len(urls))

def ts_to_ms(s):
    """記録スロット文字列(JSTの壁時計)を絶対時刻(epoch ms)にする。"""
    s = str(s)
    y, mo, da = int(s[:4]), int(s[5:7]), int(s[8:10])
    hh = int(s[11:13]) if len(s) > 10 else 0
    mm = int(s[14:16]) if len(s) > 10 else 0
    return int(datetime.datetime(y, mo, da, hh, mm, tzinfo=JST).timestamp() * 1000)

def compute_predict(colors):
    """「リアル予測」用モデル: 各チャンネルの過去7日の推移から増加率を出して合算。
       - チャンネル単位で算出するので、集計対象チャンネルの増減(名簿変更)が偽の増加にならない。
       - 直近ほど重い加重平均(半減期2日)。総再生数の減少区間は無視する。
       返り値: {asOfMs, subs:{base,rate}, views:{base,rate}}  rateは1msあたり。"""
    series, _ = load_history()
    try:
        cur = {d["id"]: d for d in json.load(open(ed_data_path(), encoding="utf-8"))}
    except Exception:
        cur = {}
    main_ids = [cid for cid in colors if cid not in RETIRED and genre_of(cid) == DEFAULT_GENRE]
    all_ts = sorted({t for cid in main_ids for t in series.get(cid, {})})
    as_of_ms = ts_to_ms(all_ts[-1]) if all_ts else int(datetime.datetime.now(JST).timestamp() * 1000)

    DAY = 86400000.0
    HALF = 2.0
    WEEK = 7 * DAY

    def ch_rate(cid, metric, exclude_neg):
        h = series.get(cid, {})
        ts = sorted(h)
        if not ts:
            return 0.0
        latest = ts_to_ms(ts[-1])
        pts = [(ts_to_ms(x), h[x][metric]) for x in ts
               if h[x][metric] is not None and (latest - ts_to_ms(x)) <= WEEK]
        if len(pts) < 2:
            return 0.0
        num = den = 0.0
        for i in range(1, len(pts)):
            dt = pts[i][0] - pts[i - 1][0]
            if dt <= 0:
                continue
            dv = pts[i][1] - pts[i - 1][1]
            if exclude_neg and dv < 0:      # 総再生数の減少は含めない
                continue
            r = dv / dt
            age = (latest - (pts[i][0] + pts[i - 1][0]) / 2) / DAY
            w = 0.5 ** (age / HALF)         # 直近ほど重い
            num += w * r
            den += w
        rate = (num / den) if den else 0.0
        return rate if rate > 0 else 0.0    # ライブ表示は下がらない

    sb = vb = 0
    sr = vr = 0.0
    for cid in main_ids:
        c = cur.get(cid, {})
        if c.get("subs"):
            sb += c["subs"]
        if c.get("views"):
            vb += c["views"]
        sr += ch_rate(cid, "subs", False)
        vr += ch_rate(cid, "views", True)
    return {"asOfMs": as_of_ms,
            "subs":  {"base": sb, "rate": sr},
            "views": {"base": vb, "rate": vr}}

def _rate_vol(pts, exclude_neg):
    """(t_ms, value) の並びから、1日あたりの増加率(加重平均, 半減期2日)と
       日次増加率のばらつき(標準偏差)を返す。exclude_negなら減少区間は無視。"""
    DAY = 86400000.0
    if len(pts) < 2:
        return 0.0, 0.0
    latest = pts[-1][0]
    num = den = 0.0
    day_rates = []
    for i in range(1, len(pts)):
        dt = pts[i][0] - pts[i - 1][0]
        if dt <= 0:
            continue
        dv = pts[i][1] - pts[i - 1][1]
        if exclude_neg and dv < 0:
            continue
        rday = dv / dt * DAY                      # 1日あたり
        age = (latest - (pts[i][0] + pts[i - 1][0]) / 2) / DAY
        w = 0.5 ** (age / 2.0)
        num += w * rday
        den += w
        day_rates.append(rday)
    rate = (num / den) if den else 0.0
    if rate < 0:
        rate = 0.0
    if len(day_rates) >= 2:
        m = sum(day_rates) / len(day_rates)
        vol = (sum((x - m) ** 2 for x in day_rates) / len(day_rates)) ** 0.5
    else:
        vol = abs(rate) * 0.5                     # データが少ないときの目安
    return rate, vol

def channel_models(colors):
    """主要ジャンル各チャンネルの現在値・1日あたり増加率・ばらつきを返す。"""
    series, names = load_history()
    try:
        cur = {d["id"]: d for d in json.load(open(ed_data_path(), encoding="utf-8"))}
    except Exception:
        cur = {}
    main_ids = [cid for cid in colors if cid not in RETIRED and genre_of(cid) == DEFAULT_GENRE]
    all_ts = sorted({t for cid in main_ids for t in series.get(cid, {})})
    as_of_ms = ts_to_ms(all_ts[-1]) if all_ts else int(datetime.datetime.now(JST).timestamp() * 1000)
    WEEK = 7 * 86400000.0
    models = {}
    for cid in main_ids:
        c = cur.get(cid, {})
        if not (c.get("subs")):
            continue
        h = series.get(cid, {})
        ts = sorted(h)
        latest = ts_to_ms(ts[-1]) if ts else as_of_ms
        def pts(metric):
            return [(ts_to_ms(x), h[x][metric]) for x in ts
                    if h[x][metric] is not None and (latest - ts_to_ms(x)) <= WEEK]
        sr, sv = _rate_vol(pts("subs"), False)
        vr, vv = _rate_vol(pts("views"), True)
        models[cid] = {
            "name": names.get(cid, c.get("name", "")), "color": colors[cid],
            "avatar": c.get("avatar", ""),
            "subs": c.get("subs") or 0, "views": c.get("views") or 0,
            "subs_rate": sr, "subs_vol": sv, "views_rate": vr, "views_vol": vv,
        }
    return models, as_of_ms

def compute_oligopoly(colors):
    """寡占予測: トップ3の占有率が1ヶ月後どう変わるか＋順位変動の可能性(加重平均予測)。"""
    import math
    models, as_of = channel_models(colors)
    ids = sorted(models.keys(), key=lambda c: -models[c]["subs"])
    H = 30  # 日
    if len(ids) < 3:
        return {"asOfMs": as_of, "horizonDays": H, "enough": False}

    def proj(cid, metric):
        m = models[cid]
        return m[metric] + m[metric + "_rate"] * H

    out = {"asOfMs": as_of, "horizonDays": H, "enough": True,
           "top3": [{"name": models[c]["name"], "color": models[c]["color"], "avatar": models[c]["avatar"]} for c in ids[:3]]}

    for metric in ("subs", "views"):
        tot_n = sum(models[c][metric] for c in ids)
        t3_n = sum(models[c][metric] for c in ids[:3])
        tot_f = sum(proj(c, metric) for c in ids)
        t3_f = sum(proj(c, metric) for c in ids[:3])
        out[metric] = {
            "shareNow": (t3_n / tot_n) if tot_n else 0,
            "shareFuture": (t3_f / tot_f) if tot_f else 0,
            "top3Now": round(t3_n), "totalNow": round(tot_n),
            "top3Future": round(t3_f), "totalFuture": round(tot_f),
        }

    def ncdf(x):
        return 0.5 * (1 + math.erf(x / math.sqrt(2)))

    def rank_pairs(metric):
        by = sorted(models.keys(), key=lambda c: -models[c][metric])
        topN = by[:4]
        pairs = []
        for i in range(1, len(topN)):
            A, B = topN[i - 1], topN[i]          # A=上位, B=下位
            a, b = models[A], models[B]
            gap_now = a[metric] - b[metric]
            mean_lead = gap_now + (a[metric + "_rate"] - b[metric + "_rate"]) * H   # 1ヶ月後のAのリード
            var = (a[metric + "_vol"] ** 2 + b[metric + "_vol"] ** 2) * H
            sigma = math.sqrt(var) if var > 0 else max(1.0, abs(mean_lead) * 0.25)
            prob = ncdf(-mean_lead / sigma) if sigma > 0 else (1.0 if mean_lead < 0 else 0.0)
            close = b[metric + "_rate"] - a[metric + "_rate"]                        # Bの追い上げ速度/日
            days = (gap_now / close) if close > 1e-9 else None
            pairs.append({
                "higher": {"name": a["name"], "color": a["color"]},
                "lower":  {"name": b["name"], "color": b["color"]},
                "gapNow": round(gap_now), "gapFuture": round(mean_lead),
                "prob": max(0.0, min(1.0, prob)),
                "days": (round(days) if (days and 0 < days) else None),
            })
        return pairs

    out["ranks"] = {"subs": rank_pairs("subs"), "views": rank_pairs("views")}
    return out

def load_history():
    path = os.path.join(BASE, ED["history"])
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
    all_ts = sorted({t for m in series.values() for t in m})
    lo = (ASOF - datetime.timedelta(days=6)).isoformat()
    hi = ASOF.isoformat()
    win = [t for t in all_ts if lo <= day_of(t) <= hi]

    result = {"span": {"from": None, "to": None, "days": 0}, "subs": [], "views": [], "videos": []}
    if win:
        earliest, latest = win[0], win[-1]
        span = (datetime.date.fromisoformat(day_of(latest)) - datetime.date.fromisoformat(day_of(earliest))).days
        result["span"] = {"from": day_of(earliest), "to": day_of(latest), "days": span}
        win_set = set(win)

        for metric in ("subs", "views", "videos"):
            arr = []
            for cid in shown:
                # 各チャンネル自身の「ウィンドウ内の最古〜最新」で増減を出す
                # (集計対象に後から加わったチャンネルも、値が2点以上あれば必ず載る)
                pts = [t for t in sorted(series.get(cid, {}))
                       if t in win_set and series[cid][t][metric] is not None]
                if len(pts) < 2:
                    continue
                a = series[cid][pts[0]][metric]
                b = series[cid][pts[-1]][metric]
                arr.append({"name": names[cid], "color": colors[cid], "delta": b - a, "latest": b, "genre": genre_of(cid)})
            arr.sort(key=lambda x: -x["delta"])
            result[metric] = arr

    # 界隈全体の推移: 通常ジャンル(引退除く)の日別合計(グラフは1日1点=その日の最終スロット)
    main_ids = [cid for cid in series if cid not in RETIRED and genre_of(cid) == DEFAULT_GENRE]
    all_ts = sorted({t for cid in main_ids for t in series[cid]})
    rep = daily_reps(all_ts)                       # 日 -> その日の最終スロット
    tdays = sorted(rep.keys())
    totals = {"dates": tdays, "subs": [], "views": [], "videos": []}
    for d in tdays:
        t = rep[d]
        for m in ("subs", "views", "videos"):
            s = 0
            for cid in main_ids:
                rec = series.get(cid, {}).get(t)
                if rec and rec[m] is not None:
                    s += rec[m]
            totals[m].append(s)
    result["totals"] = totals

    with open(ed_out("assets", "growth.js"), "w", encoding="utf-8") as f:
        f.write("window.PBERS_GROWTH = " + json.dumps(result, ensure_ascii=False, indent=2) + ";\n")
    print("wrote assets/growth.js (span %s days, %d trend points)" % (result["span"]["days"], len(tdays)))

def build_news(colors):
    """history.csv から直近7日（当日含む）のマイルストーン突破を検出して news.js を出力。
       各チャンネル・各指標について、前回記録日→当日で刻みを跨いだら「突破」ニュースにする。"""
    path = os.path.join(BASE, ED["history"])
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

    window = [ASOF - datetime.timedelta(days=i) for i in range(7)]   # 基準日〜6日前
    by_date = {d.isoformat(): [] for d in window}

    shown = set(colors.keys())                          # 引退者以外
    all_ts = sorted({t for m in series.values() for t in m})   # 6時間ごとのスロット
    prev_of = {all_ts[i]: all_ts[i - 1] for i in range(1, len(all_ts))}

    amap = {}   # id -> avatar
    try:
        for d in json.load(open(ed_data_path(), encoding="utf-8")):
            amap[d["id"]] = d.get("avatar", "")
    except Exception:
        pass

    def gv(cid, d, metric):
        rec = series.get(cid, {}).get(d)
        return rec[metric] if rec else None

    for T in all_ts:                                    # 各スロットを直前スロットと比較
        if T not in prev_of:                            # 直前がなければ比較不可
            continue
        D = day_of(T)                                   # この記録が属する「日」
        if D not in by_date:                            # 直近7日の枠外はスキップ
            continue
        P = prev_of[T]
        for metric in STEPS:
            # (1) マイルストーン突破（段階式）
            for cid in shown:
                reached = milestone_reached(metric, gv(cid, P, metric), gv(cid, T, metric))
                if reached is not None:
                    by_date[D].append({
                        "type": "milestone", "kind": metric, "name": names[cid],
                        "color": colors[cid], "avatar": amap.get(cid, ""), "icon": "🎉",
                        "genre": genre_of(cid), "label": milestone_label(metric, reached),
                        "value": reached,
                    })
            # (2) 追い越し（Aが直前はBの下、今回はBの上）
            elig = [c for c in shown if gv(c, T, metric) is not None and gv(c, P, metric) is not None]
            for a in elig:
                ca, pa = gv(a, T, metric), gv(a, P, metric)
                for b in elig:
                    if a == b:
                        continue
                    if pa < gv(b, P, metric) and ca > gv(b, T, metric):
                        by_date[D].append({
                            "type": "overtake", "kind": metric, "name": names[a],
                            "color": colors[a], "avatar": amap.get(a, ""), "icon": "⤴️",
                            "genre": genre_of(a),
                            "opp": {"name": names[b], "color": colors.get(b, "#8d8986"), "avatar": amap.get(b, "")},
                            "label": "%sで %s を追い越し" % (METRICWORD[metric], names[b]),
                            "value": ca,
                        })

    korder = {"subs": 0, "views": 1, "videos": 2}
    torder = {"milestone": 0, "overtake": 1}

    def dedup(items):
        # 同じ日に6時間ごとで重複しうる同一ニュースを1件にまとめる
        seen, out = {}, []
        for it in items:
            if it["type"] == "milestone":
                key = ("milestone", it["kind"], it["name"], it["value"])
            else:
                key = ("overtake", it["kind"], it["name"], it["opp"]["name"])
            if key in seen:
                if it["value"] > seen[key]["value"]:
                    seen[key].update(value=it["value"])
                continue
            seen[key] = it
            out.append(it)
        return out

    news = []
    for d in sorted(by_date.keys(), reverse=True):     # 新しい日が上
        items = sorted(dedup(by_date[d]), key=lambda x: (torder[x["type"]], korder[x["kind"]], -x["value"]))
        dd = datetime.date.fromisoformat(d)
        news.append({"date": d, "label": "%d月%d日(%s)" % (dd.month, dd.day, WD[dd.weekday()]), "items": items})

    with open(ed_out("assets", "news.js"), "w", encoding="utf-8") as f:
        f.write("window.PBERS_NEWS = " + json.dumps(news, ensure_ascii=False, indent=2) + ";\n")
    total = sum(len(n["items"]) for n in news)
    print("wrote assets/news.js (%d days, %d news items)" % (len(news), total))

main()
