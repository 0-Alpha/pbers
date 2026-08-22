# -*- coding: utf-8 -*-
"""その日のニュース(突破・追い越し)を X に自動投稿する。

- assets/news.js の最新日のニュースを読み、1ツイートにまとめて投稿。
- ニュースが無ければ何もしない。
- 認証情報(GitHub Secrets)が無ければスキップ(ジョブは失敗させない)。
  必要な環境変数: X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET
"""
import os, re, json

BASE = os.path.dirname(os.path.abspath(__file__))
SITE = "https://pbers.pages.dev"
MAX_ITEMS = 4

def load_news():
    p = os.path.join(BASE, "assets", "news.js")
    if not os.path.exists(p):
        return []
    m = re.search(r"window\.PBERS_NEWS = (\[.*\]);", open(p, encoding="utf-8").read(), re.S)
    return json.loads(m.group(1)) if m else []

def build_text():
    news = load_news()
    if not news:
        return None
    day = news[0]                      # 最新日
    items = day.get("items", [])
    if not items:
        return None
    lines = ["📊 ポーランドボーラー界隈ニュース " + day.get("label", "")]
    for it in items[:MAX_ITEMS]:
        lines.append(it.get("icon", "") + " " + it["name"] + " が " + it["label"])
    if len(items) > MAX_ITEMS:
        lines.append("ほか" + str(len(items) - MAX_ITEMS) + "件")
    lines.append("")
    lines.append(SITE + "/ #ポーランドボール")
    return "\n".join(lines)

def main():
    text = build_text()
    if not text:
        print("no news today; nothing to post")
        return
    ck = os.environ.get("X_API_KEY"); cs = os.environ.get("X_API_SECRET")
    at = os.environ.get("X_ACCESS_TOKEN"); ats = os.environ.get("X_ACCESS_SECRET")
    if not all([ck, cs, at, ats]):
        print("X credentials not set; skip. Would post:\n" + text)
        return
    try:
        from requests_oauthlib import OAuth1Session
        x = OAuth1Session(ck, client_secret=cs, resource_owner_key=at, resource_owner_secret=ats)
        r = x.post("https://api.twitter.com/2/tweets", json={"text": text})
        print("X response:", r.status_code, r.text[:300])
    except Exception as e:
        print("X post failed (ignored):", e)

main()
