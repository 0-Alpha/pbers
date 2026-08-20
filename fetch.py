# -*- coding: utf-8 -*-
import urllib.request, re, json, time, html, sys

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
BASE = "D:/aPB\u7528\u30d5\u30a1\u30a4\u30eb/movie/!tool/pbers"

def fetch(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA,
                "Accept-Language": "ja,en;q=0.9",
                "Cookie": "CONSENT=YES+cb; SOCS=CAI",
            })
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:
            sys.stderr.write("retry %d %s: %s\n" % (i, url, e))
            time.sleep(2)
    return ""

def parse_subs(label):
    # label like "\u30c1\u30e3\u30f3\u30cd\u30eb\u767b\u9332\u8005\u6570 1.62\u4e07\u4eba" or "1.62M subscribers"
    if not label:
        return None
    m = re.search(r'([\d,\.]+)\s*(\u4e07|\u5104|M|K|B)?', label)
    if not m:
        return None
    num = float(m.group(1).replace(",", ""))
    unit = m.group(2)
    mult = {"\u4e07":1e4, "\u5104":1e8, "M":1e6, "K":1e3, "B":1e9}.get(unit, 1)
    return int(round(num * mult))

def parse_views(label):
    # label like "390,681,591\u56de\u8996\u8074" or "390,681,591 views"
    if not label:
        return None
    m = re.search(r'([\d,]+)', label)
    return int(m.group(1).replace(",", "")) if m else None

def main():
    with open(BASE + "/channels.txt", encoding="utf-8") as f:
        urls = [l.strip() for l in f if l.strip()]
    out = []
    for url in urls:
        cid = url.split("/channel/")[-1]
        # The /about page carries aboutChannelViewModel, which holds this
        # channel's OWN subscriber count AND total view count as plain strings.
        h = fetch(url + "/about")
        # subscriber: direct-string form (about model), owner's own value
        m = re.search(r'"subscriberCountText":"([^"]*(?:\u767b\u9332\u8005|subscribers)[^"]*)"', h)
        subs_label = m.group(1) if m else None
        if not subs_label:  # fallback: main-header metadataParts
            m = re.search(r'"content":"(\u30c1\u30e3\u30f3\u30cd\u30eb\u767b\u9332\u8005\u6570[^"]*)"', h)
            subs_label = m.group(1) if m else None
        # total views
        vm = re.search(r'"viewCountText":"([^"]*(?:\u56de\u8996\u8074|views)[^"]*)"', h)
        views_label = vm.group(1) if vm else None
        # video count (bonus)
        cm = re.search(r'"videoCountText":"([^"]*)"', h)
        videos_label = cm.group(1) if cm else None
        name_m = re.search(r'<meta property="og:title" content="([^"]*)"', h)
        av_m = re.search(r'<meta property="og:image" content="([^"]*)"', h)
        name = html.unescape(name_m.group(1)) if name_m else cid
        avatar = av_m.group(1) if av_m else ""
        subs = parse_subs(subs_label)
        views = parse_views(views_label)
        out.append({"id": cid, "url": url, "name": name,
                    "subsLabel": subs_label, "subs": subs,
                    "viewsLabel": views_label, "views": views,
                    "videosLabel": videos_label, "avatar": avatar})
        sys.stderr.write("%-28s subs=%-9s views=%s\n" % (name[:28], subs, views))
        time.sleep(0.5)
    with open(BASE + "/data.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    sys.stderr.write("wrote data.json (%d channels)\n" % len(out))

main()
