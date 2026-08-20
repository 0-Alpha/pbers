# -*- coding: utf-8 -*-
"""data.json -> assets/data.js（登録者数・総再生数・投稿数・固有色つき）
   history.csv -> assets/news.js（直近7日のマイルストーン突破ニュース）"""
import json, colorsys, re, os, csv, datetime

BASE = os.path.dirname(os.path.abspath(__file__))   # works on Windows and on CI (Linux)
JST = datetime.timezone(datetime.timedelta(hours=9))
# 更新日は日本時間の当日
UPDATED = datetime.datetime.now(JST).strftime("%Y-%m-%d")

# マイルストーンの刻み: 登録者=1万, 総再生=1000万, 投稿=100
STEPS = {
    "subs":   (10000,    "登録者"),
    "views":  (10000000, "総再生数"),
    "videos": (100,      "投稿数"),
}
WD = ["月", "火", "水", "木", "金", "土", "日"]  # date.weekday(): Mon=0

def milestone_label(metric, v):
    if metric == "subs":
        return "登録者 %d万人 突破" % (v // 10000)
    if metric == "views":
        if v >= 100000000:
            return "総再生数 %g億回 突破" % (v / 100000000)
        return "総再生数 %d万回 突破" % (v // 10000)
    return "投稿数 %d本 突破" % v

# 指定の固定カラー(チャンネルID -> hex)
FIXED = {
    "UCkjdTrE4hiJ4qNOV7NPGSSw": "#9b51e0",  # フヒフム
    "UCRCQ3G1d0DM2krO-Fx5LOuQ": "#eba864",  # みかんぼーる
    "UC6BwO1hK3hHd-Hr43jokcyg": "#2f80ed",  # 田中MID
}

def hsl(h, s, l):
    r, g, b = colorsys.hls_to_rgb(h / 360, l, s)
    return "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))

def vids(label):
    if not label:
        return None
    m = re.search(r"([\d,\.]+)", label)
    return int(float(m.group(1).replace(",", ""))) if m else None

def main():
    data = json.load(open(BASE + "/data.json", encoding="utf-8"))
    order = sorted(data, key=lambda x: (x.get("subs") or 0), reverse=True)

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
        "avatar": d["avatar"], "color": colors[d["id"]],
    } for d in order]

    with open(BASE + "/assets/data.js", "w", encoding="utf-8") as f:
        f.write("window.PBERS_DATA = " + json.dumps(out, ensure_ascii=False, indent=2) + ";\n")
        f.write('window.PBERS_UPDATED = "%s";\n' % UPDATED)
    print("wrote assets/data.js (%d channels)" % len(out))

    build_news(colors)

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

    today = datetime.datetime.now(JST).date()
    window = [today - datetime.timedelta(days=i) for i in range(7)]   # 当日〜6日前
    wstr = set(d.isoformat() for d in window)
    by_date = {d.isoformat(): [] for d in window}

    for cid, dmap in series.items():
        dates = sorted(dmap.keys())
        for idx, dt in enumerate(dates):
            if dt not in wstr or idx == 0:
                continue
            prev = dates[idx - 1]                      # 直前の記録日
            for metric, (step, _label) in STEPS.items():
                cur, pv = dmap[dt][metric], dmap[prev][metric]
                if cur is None or pv is None:
                    continue
                if cur // step > pv // step:            # 刻みを跨いだ
                    reached = (cur // step) * step      # 到達した最上位のキリ番
                    by_date[dt].append({
                        "name": names[cid], "color": colors.get(cid, "#8d8986"),
                        "kind": metric, "label": milestone_label(metric, reached),
                        "value": reached,
                    })

    order = {"subs": 0, "views": 1, "videos": 2}
    news = []
    for d in sorted(by_date.keys(), reverse=True):     # 新しい日が上
        items = sorted(by_date[d], key=lambda x: (order[x["kind"]], -x["value"]))
        dd = datetime.date.fromisoformat(d)
        news.append({"date": d, "label": "%d月%d日(%s)" % (dd.month, dd.day, WD[dd.weekday()]), "items": items})

    with open(BASE + "/assets/news.js", "w", encoding="utf-8") as f:
        f.write("window.PBERS_NEWS = " + json.dumps(news, ensure_ascii=False, indent=2) + ";\n")
    total = sum(len(n["items"]) for n in news)
    print("wrote assets/news.js (%d days, %d news items)" % (len(news), total))

main()
