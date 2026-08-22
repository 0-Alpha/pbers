# -*- coding: utf-8 -*-
"""data.json のスナップショットを history.csv に追記(上書きせず蓄積)。

- JST 6時間ごと(0/6/12/18時)のスロットで記録する。
- 記録キーは「YYYY-MM-DD HH:MM」(JST スロット時刻)。0時分を前日24時とみなす扱いは
  表示側(gen_data.py の day_of)で行う。
- 同じスロットが既にあれば追記しない(手動再実行しても重複しない)。
- 列: date(=スロット時刻), id, name, subs, views, videos
"""
import os, csv, json, datetime

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data.json")
HIST = os.path.join(BASE, "history.csv")

JST = datetime.timezone(datetime.timedelta(hours=9))

def slot_ts():
    # 現在時刻(JST)を直近の6時間スロット(0/6/12/18時)に丸める
    n = datetime.datetime.now(JST)
    hour = (n.hour // 6) * 6
    return n.replace(hour=hour, minute=0, second=0, microsecond=0).strftime("%Y-%m-%d %H:%M")

def existing_ts():
    ts = set()
    if os.path.exists(HIST):
        with open(HIST, encoding="utf-8", newline="") as f:
            for row in csv.reader(f):
                if row and row[0] != "date":
                    ts.add(row[0])
    return ts

def main():
    ts = slot_ts()
    if ts in existing_ts():
        print("history.csv already has %s — skip" % ts)
        return

    data = json.load(open(DATA, encoding="utf-8"))
    new = not os.path.exists(HIST)
    with open(HIST, "a", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        if new:
            w.writerow(["date", "id", "name", "subs", "views", "videos"])
        for d in data:
            w.writerow([ts, d.get("id"), d.get("name"),
                        d.get("subs"), d.get("views"), d.get("videos")])
    print("appended %d rows for %s to history.csv" % (len(data), ts))

main()
