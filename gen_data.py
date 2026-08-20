# -*- coding: utf-8 -*-
"""data.json -> assets/data.js (登録者数・総再生数・投稿数・固有色つき)"""
import json, colorsys, re, os, datetime

BASE = os.path.dirname(os.path.abspath(__file__))   # works on Windows and on CI (Linux)
# 更新日は日本時間の当日
UPDATED = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).strftime("%Y-%m-%d")

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

main()
