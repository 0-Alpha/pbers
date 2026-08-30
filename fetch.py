# -*- coding: utf-8 -*-
import urllib.request, re, json, time, html, sys, os

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
BASE = os.path.dirname(os.path.abspath(__file__))   # works on Windows and on CI (Linux)

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

def parse_videos(label):
    # label like "918 \u672c\u306e\u52d5\u753b" or "918 videos"
    if not label:
        return None
    m = re.search(r'([\d,]+)', label)
    return int(m.group(1).replace(",", "")) if m else None

# (channels \u30d5\u30a1\u30a4\u30eb, data \u51fa\u529b\u30d5\u30a1\u30a4\u30eb) \u306e\u30da\u30a2\u3002\u901a\u5e38\u30b5\u30a4\u30c8 \u3068 \u6d77\u5916\u5411\u3051\u3002
EDITIONS = [
    ("channels.txt",        "data.json"),
    ("channels_global.txt", "data_global.json"),
]

def fetch_channel(url):
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
    return {"id": cid, "url": url, "name": name,
            "subsLabel": subs_label, "subs": parse_subs(subs_label),
            "viewsLabel": views_label, "views": parse_views(views_label),
            "videosLabel": videos_label, "videos": parse_videos(videos_label), "avatar": avatar}

def build(channels_file, data_file):
    path = os.path.join(BASE, channels_file)
    if not os.path.exists(path):
        sys.stderr.write("%s not found \u2014 skip\n" % channels_file)
        return
    with open(path, encoding="utf-8") as f:
        urls = [l.strip() for l in f if l.strip() and not l.strip().startswith("#") and "/channel/" in l]
    out = []
    for url in urls:
        d = fetch_channel(url)
        out.append(d)
        sys.stderr.write("%-24s subs=%-8s views=%-11s videos=%s\n" % (d["name"][:24], d["subs"], d["views"], d["videos"]))
        time.sleep(0.5)
    with open(os.path.join(BASE, data_file), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    sys.stderr.write("wrote %s (%d channels)\n" % (data_file, len(out)))

def main():
    for channels_file, data_file in EDITIONS:
        build(channels_file, data_file)

if __name__ == "__main__":
    main()
