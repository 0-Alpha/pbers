# -*- coding: utf-8 -*-
"""data.json のスナップショットを history.csv に追記(上書きせず蓄積)。

- 日付は「前日」(JST当日の1日前)。JST 0時に取得した値は前日の最終値とみなすため。
- 1日1回分のみ。同じ日付が既にあれば追記しない(手動再実行しても重複しない)。
- 列: date, id, name, subs, views, videos
"""
import os, csv, json, datetime

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data.json")
HIST = os.path.join(BASE, "history.csv")

JST = datetime.timezone(datetime.timedelta(hours=9))

def as_of_date():
    # JST 0時の取得を前日分として記録する
    return (datetime.datetime.now(JST) - datetime.timedelta(days=1)).strftime("%Y-%m-%d")

def existing_dates():
    dates = set()
    if os.path.exists(HIST):
        with open(HIST, encoding="utf-8", newline="") as f:
            for row in csv.reader(f):
                if row and row[0] != "date":
                    dates.add(row[0])
    return dates

def main():
    date = as_of_date()
    if date in existing_dates():
        print("history.csv already has %s — skip" % date)
        return

    data = json.load(open(DATA, encoding="utf-8"))
    new = not os.path.exists(HIST)
    with open(HIST, "a", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        if new:
            w.writerow(["date", "id", "name", "subs", "views", "videos"])
        for d in data:
            w.writerow([date, d.get("id"), d.get("name"),
                        d.get("subs"), d.get("views"), d.get("videos")])
    print("appended %d rows for %s to history.csv" % (len(data), date))

main()
