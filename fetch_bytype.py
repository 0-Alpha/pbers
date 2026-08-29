# -*- coding: utf-8 -*-
"""チャンネルごとに「横動画/ショートの本数比率」と「種類別の再生数合計」を集計する。

方法B(YouTube Data API v3):
  1) channels.list        -> アップロード再生リストID＋チャンネル名
  2) playlistItems.list   -> 全動画ID(50件/ページ)
  3) videos.list          -> 各動画の再生数＋長さ(50件/ページ)
  4) 尺が短い動画(<=180秒)だけ /shorts/<id> で正確にショート判定
     (180秒超は確実にロング。ショートは最大3分=180秒なので確認不要)

使い方:
  - Google Cloud で「YouTube Data API v3」を有効化しAPIキーを作成
  - キーを同じフォルダの .yt_api_key に貼る(または環境変数 YT_API_KEY)
  - python fetch_bytype.py                # フヒフムだけ(お試し)
  - python fetch_bytype.py <ID> <ID> ...  # 任意のチャンネルID
  - python fetch_bytype.py --all          # channels.txt の全チャンネル
結果は bytype.json にも保存する。
"""
import os, sys, json, re, time, urllib.request, urllib.parse, urllib.error
from concurrent.futures import ThreadPoolExecutor

# Windowsコンソール(cp932)は「Æ」等を表示できず print で落ちるため UTF-8 に固定
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

API = "https://www.googleapis.com/youtube/v3/"
BASE = os.path.dirname(os.path.abspath(__file__))
SAMPLE = "UCkjdTrE4hiJ4qNOV7NPGSSw"   # フヒフム
SHORT_MAX_SEC = 180                    # この尺以下だけ /shorts/ で確認

def api_key():
    k = os.environ.get("YT_API_KEY")
    if k:
        return k.strip()
    p = os.path.join(BASE, ".yt_api_key")
    if os.path.exists(p):
        return open(p, encoding="utf-8").read().strip()
    sys.exit("APIキーがありません。.yt_api_key に貼るか、環境変数 YT_API_KEY を設定してください。")

KEY = api_key()

class ApiError(Exception):
    def __init__(self, code, body):
        self.code = code
        self.body = body
        super().__init__("APIエラー %s: %s" % (code, body[:200]))

def api(path, **params):
    params["key"] = KEY
    url = API + path + "?" + urllib.parse.urlencode(params)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "ignore")
            raise ApiError(e.code, body)          # 呼び出し側で握って続行/停止を判断
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2)

def uploads_playlist(cid):
    d = api("channels", part="contentDetails,snippet", id=cid)
    if not d.get("items"):
        return None, None
    it = d["items"][0]
    return it["contentDetails"]["relatedPlaylists"]["uploads"], it["snippet"]["title"]

def all_video_ids(playlist):
    ids, tok = [], None
    while True:
        kw = {"part": "contentDetails", "playlistId": playlist, "maxResults": 50}
        if tok:
            kw["pageToken"] = tok
        d = api("playlistItems", **kw)
        ids += [i["contentDetails"]["videoId"] for i in d.get("items", [])]
        print("\r  動画ID取得中... {}件".format(len(ids)), end="", flush=True)
        tok = d.get("nextPageToken")
        if not tok:
            break
    print("\r  動画ID取得: {}件".format(len(ids)))
    return ids

def iso_seconds(s):
    m = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", s or "")
    if not m:
        return 0
    h, mi, se = (int(x) if x else 0 for x in m.groups())
    return h * 3600 + mi * 60 + se

def video_stats(ids):
    out = {}
    for i in range(0, len(ids), 50):
        d = api("videos", part="statistics,contentDetails", id=",".join(ids[i:i + 50]))
        for it in d.get("items", []):
            out[it["id"]] = {
                "views": int(it.get("statistics", {}).get("viewCount", 0) or 0),
                "sec": iso_seconds(it.get("contentDetails", {}).get("duration")),
            }
        print("\r  再生数・長さ取得中... {}/{}".format(min(i + 50, len(ids)), len(ids)), end="", flush=True)
    print("\r  再生数・長さ取得: {}件".format(len(out)))
    return out

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None

_OPENER = urllib.request.build_opener(_NoRedirect)

def is_short(vid):
    """/shorts/<id> が 200 ならショート、リダイレクト(→/watch)ならロング。"""
    req = urllib.request.Request(
        "https://www.youtube.com/shorts/" + vid, method="HEAD",
        headers={"User-Agent": "Mozilla/5.0", "Cookie": "SOCS=CAI; CONSENT=YES+",
                 "Accept-Language": "en-US,en;q=0.9"})
    try:
        _OPENER.open(req, timeout=15)
        return True                       # 200 = ショート
    except urllib.error.HTTPError as e:
        return e.code == 200
    except Exception:
        return False                      # 取得失敗はロース扱い(安全側)

def analyze(cid):
    pl, title = uploads_playlist(cid)
    if not pl:
        print("!! チャンネルが見つかりません: %s" % cid)
        return None
    print("\n[{}] 集計開始...".format(title), flush=True)
    ids = all_video_ids(pl)
    stats = video_stats(ids)
    # 尺<=180秒だけ /shorts/ で判定(180秒超は確実にロング)。判定は並列で高速化。
    to_check = [vid for vid, s in stats.items() if s["sec"] <= SHORT_MAX_SEC]
    short_set = set()
    if to_check:
        done = [0]
        total_c = len(to_check)

        def work(vid):
            r = is_short(vid)
            done[0] += 1
            if done[0] % 20 == 0 or done[0] == total_c:
                print("\r  ショート判定中... {}/{}".format(done[0], total_c), end="", flush=True)
            return vid, r

        with ThreadPoolExecutor(max_workers=12) as ex:
            for vid, r in ex.map(work, to_check):
                if r:
                    short_set.add(vid)
        print("\r  ショート判定: {}本確認".format(total_c))
    longs = {"n": 0, "views": 0}
    shorts = {"n": 0, "views": 0}
    checked = len(to_check)
    for vid, s in stats.items():
        b = shorts if vid in short_set else longs
        b["n"] += 1
        b["views"] += s["views"]
    tot = longs["n"] + shorts["n"] or 1
    print("\n== {} ({}) ==".format(title, cid))
    print("総動画数: {}  (/shorts 確認 {}本)".format(longs["n"] + shorts["n"], checked))
    print("ロング : {:>4}本 ({:5.1f}%)  再生 {:,}".format(longs["n"], longs["n"] / tot * 100, longs["views"]))
    print("ショート: {:>4}本 ({:5.1f}%)  再生 {:,}".format(shorts["n"], shorts["n"] / tot * 100, shorts["views"]))
    return {"id": cid, "title": title, "total": longs["n"] + shorts["n"],
            "long": longs, "short": shorts}

def channels_from_txt():
    out = []
    with open(os.path.join(BASE, "channels.txt"), encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if "/channel/" in line:
                out.append(line.split("/channel/")[-1])
    return out

def main():
    args = sys.argv[1:]
    if args == ["--all"]:
        targets = channels_from_txt()
    elif args:
        targets = args
    else:
        targets = [SAMPLE]
    out_path = os.path.join(BASE, "bytype.json")
    existing = {}
    if os.path.exists(out_path):
        try:
            existing = {r["id"]: r for r in json.load(open(out_path, encoding="utf-8"))}
        except Exception:
            existing = {}
    t0 = time.time()
    ok = skip = 0
    for cid in targets:
        try:
            r = analyze(cid)
        except ApiError as e:
            if e.code == 403 and "quota" in e.body.lower():
                print("\n!! APIクォータ超過。ここまでを保存して停止します。")
                break
            print("\n-- スキップ {} (APIエラー {}=削除/非公開の可能性)".format(cid, e.code))
            skip += 1
            continue
        except Exception as ex:
            print("\n-- スキップ {} ({})".format(cid, ex))
            skip += 1
            continue
        if r:
            existing[r["id"]] = r
            ok += 1
            with open(out_path, "w", encoding="utf-8") as f:   # 1chごとに逐次保存(途中で落ちても残る)
                json.dump(list(existing.values()), f, ensure_ascii=False, indent=2)
        else:
            skip += 1
    print("\n完了: {} 成功 / {} スキップ / {:.1f}秒 / bytype.json({}件)".format(
        ok, skip, time.time() - t0, len(existing)))

if __name__ == "__main__":
    main()
