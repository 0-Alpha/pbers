# -*- coding: utf-8 -*-
"""X(Twitter)アカウントの指標を取得して x_data.json に保存し、x_history.csv に追記する。

- 対象は x_accounts.txt(1行1アカウント: 「ハンドル  YouTubeチャンネルID」。IDは不明なら省略可)
- 取得元は FxTwitter の公開API(api.fxtwitter.com)。キー不要だが非公式なので、
  失敗しても他の処理を止めないこと(workflow 側でも continue-on-error)。
- x_history.csv は追記専用。record.py と同じ JST 6時間スロットで記録し、同じスロットがあれば追記しない。
  取得に失敗したアカウントはその回の行を書かない(欠損として扱う)。
- 投稿指標は「本人の投稿」だけで計算する(リポスト・リプライ・固定ポストは除外)。
  表示回数は投稿直後ほど伸び途中なので、中央値は投稿から MATURE_DAYS 日以上たったものだけで取る。
"""
import os, sys, csv, json, time, datetime, statistics, urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
JST = datetime.timezone(datetime.timedelta(hours=9))
API = "https://api.fxtwitter.com/2/profile/"
UA = {"User-Agent": "Mozilla/5.0 (compatible; PBers/1.0; +https://pbers.com/)"}

ACCOUNTS_FILE = "x_accounts.txt"
DATA_FILE = "x_data.json"
HIST_FILE = "x_history.csv"
HIST_COLS = ["date", "handle", "cid", "followers", "following", "posts", "likes",
             "posts30", "med_views", "med_likes", "eng"]

WINDOW_DAYS = 30    # 投稿頻度を数える期間
MATURE_DAYS = 3     # 表示回数が落ち着いたとみなす経過日数
MAX_PAGES = 5       # 1ページ20件。最大100件まで遡る


def get(url, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                d = json.load(r)
            if d.get("code") == 200:
                return d
            sys.stderr.write("code %s: %s\n" % (d.get("code"), url))
        except Exception as e:
            sys.stderr.write("retry %d %s: %s\n" % (i, url, e))
        time.sleep(3 * (i + 1))
    return None


def load_accounts():
    out = []
    with open(os.path.join(BASE, ACCOUNTS_FILE), encoding="utf-8") as f:
        for line in f:
            line = line.split("#", 1)[0].strip()
            if not line:
                continue
            parts = line.split()
            out.append((parts[0].lstrip("@"), parts[1] if len(parts) > 1 else ""))
    return out


def own_posts(handle, now):
    """本人の投稿(リポスト・リプライ・固定ポスト除外)を新しい順に、WINDOW_DAYS+MATURE_DAYS 日分まで集める。"""
    limit = now - (WINDOW_DAYS + MATURE_DAYS) * 86400
    posts, cursor = [], None
    for page in range(MAX_PAGES):
        url = API + handle + "/statuses?count=20" + ("&cursor=" + urllib.request.quote(cursor) if cursor else "")
        d = get(url)
        if not d:
            break
        res = d.get("results") or []
        if not res:
            break
        # 固定ポストは先頭に置かれ、2件目より古い(時系列が逆転する)
        if page == 0 and len(res) > 1 and res[0].get("created_timestamp", 0) < res[1].get("created_timestamp", 0):
            res = res[1:]
        for s in res:
            if (s.get("author") or {}).get("screen_name", "").lower() != handle.lower():
                continue
            if s.get("reposted_by") or s.get("replying_to"):
                continue
            posts.append(s)
        oldest = min(s.get("created_timestamp", now) for s in res)
        cursor = (d.get("cursor") or {}).get("bottom")
        if oldest < limit or not cursor:
            break
        time.sleep(1)
    return posts


def fetch_account(handle, cid, now):
    d = get(API + handle)
    if not d or not d.get("user"):
        return None
    u = d["user"]
    posts = own_posts(handle, now)
    in_window = [s for s in posts if now - s.get("created_timestamp", 0) <= WINDOW_DAYS * 86400]
    mature = [s for s in posts
              if MATURE_DAYS * 86400 <= now - s.get("created_timestamp", 0) <= (WINDOW_DAYS + MATURE_DAYS) * 86400
              and s.get("views")]
    med_views = int(statistics.median([s["views"] for s in mature])) if mature else None
    med_likes = int(statistics.median([s.get("likes") or 0 for s in mature])) if mature else None
    # エンゲージメント率 = (いいね+リポスト+リプライ+引用) / 表示回数 の中央値(%)
    eng = round(statistics.median([
        ((s.get("likes") or 0) + (s.get("reposts") or 0) + (s.get("replies") or 0) + (s.get("quotes") or 0))
        * 100.0 / s["views"] for s in mature]), 2) if mature else None
    top = max(mature or in_window, key=lambda s: s.get("views") or 0, default=None)
    return {
        "handle": u.get("screen_name") or handle, "cid": cid, "name": u.get("name"),
        "followers": u.get("followers"), "following": u.get("following"),
        "posts": u.get("statuses"), "likes": u.get("likes"), "media": u.get("media_count"),
        "avatar": (u.get("avatar_url") or "").replace("_normal.", "_200x200."),
        "joined": u.get("joined"), "protected": u.get("protected"),
        "posts30": len(in_window), "sample": len(mature),
        "med_views": med_views, "med_likes": med_likes, "eng": eng,
        "top": {"url": top.get("url"), "views": top.get("views"), "likes": top.get("likes"),
                "created": top.get("created_timestamp"), "text": (top.get("text") or "")[:80]} if top else None,
    }


def slot_ts():
    # record.py と同じ: 現在時刻(JST)を直近の6時間スロット(0/6/12/18時)に丸める
    n = datetime.datetime.now(JST)
    return n.replace(hour=(n.hour // 6) * 6, minute=0, second=0, microsecond=0).strftime("%Y-%m-%d %H:%M")


def append_history(rows, ts):
    path = os.path.join(BASE, HIST_FILE)
    done = set()
    if os.path.exists(path):
        with open(path, encoding="utf-8", newline="") as f:
            for r in csv.reader(f):
                if r and r[0] != "date":
                    done.add((r[0], r[1].lower()))
    new = not os.path.exists(path)
    n = 0
    with open(path, "a", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        if new:
            w.writerow(HIST_COLS)
        for d in rows:
            if (ts, d["handle"].lower()) in done:
                continue
            w.writerow([ts] + [d.get(c) for c in HIST_COLS[1:]])
            n += 1
    print("appended %d rows for %s to %s" % (n, ts, HIST_FILE))


def main():
    now = int(time.time())
    accounts = load_accounts()
    prev = {}
    path = os.path.join(BASE, DATA_FILE)
    if os.path.exists(path):
        prev = {d["handle"].lower(): d for d in json.load(open(path, encoding="utf-8"))}
    out, fresh = [], []
    for handle, cid in accounts:
        d = fetch_account(handle, cid, now)
        if d:
            d["fetched"] = now
            fresh.append(d)
            sys.stderr.write("@%-18s followers=%-7s posts30=%-3s med_views=%-7s eng=%s\n" % (
                handle, d["followers"], d["posts30"], d["med_views"], d["eng"]))
        else:
            d = prev.get(handle.lower())   # 失敗時は前回値を表示用に残す(履歴には書かない)
            sys.stderr.write("@%-18s FAILED%s\n" % (handle, " (keep previous)" if d else ""))
        if d:
            out.append(d)
        time.sleep(1)
    if not fresh:
        sys.stderr.write("no account fetched - leave files untouched\n")
        return
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    append_history(fresh, slot_ts())


if __name__ == "__main__":
    main()
