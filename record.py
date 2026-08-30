# -*- coding: utf-8 -*-
"""各エディションの data.json スナップショットを history.csv に追記(上書きせず蓄積)。

- 通常サイト: data.json -> history.csv
- 海外向け:   data_global.json -> history_global.csv
- JST 6時間ごと(0/6/12/18時)のスロットで記録する。
- 記録キーは「YYYY-MM-DD HH:MM」(JST スロット時刻)。0時分を前日24時とみなす扱いは
  表示側(gen_data.py の day_of)で行う。
- 同じスロットが既にあれば追記しない(手動再実行しても重複しない)。
- 列: date(=スロット時刻), id, name, subs, views, videos
"""
import os, csv, json, datetime

BASE = os.path.dirname(os.path.abspath(__file__))
JST = datetime.timezone(datetime.timedelta(hours=9))

# (data.json, history.csv) のペア
EDITIONS = [
    ("data.json",        "history.csv"),
    ("data_global.json", "history_global.csv"),
]

def slot_ts():
    # 現在時刻(JST)を直近の6時間スロット(0/6/12/18時)に丸める
    n = datetime.datetime.now(JST)
    hour = (n.hour // 6) * 6
    return n.replace(hour=hour, minute=0, second=0, microsecond=0).strftime("%Y-%m-%d %H:%M")

def existing_ts(hist_path):
    ts = set()
    if os.path.exists(hist_path):
        with open(hist_path, encoding="utf-8", newline="") as f:
            for row in csv.reader(f):
                if row and row[0] != "date":
                    ts.add(row[0])
    return ts

def record(data_file, hist_file, ts):
    data_path = os.path.join(BASE, data_file)
    hist_path = os.path.join(BASE, hist_file)
    if not os.path.exists(data_path):
        print("%s not found - skip" % data_file)
        return
    data = json.load(open(data_path, encoding="utf-8"))
    if not data:
        print("%s empty - skip" % data_file)
        return
    if ts in existing_ts(hist_path):
        print("%s already has %s - skip" % (hist_file, ts))
        return
    new = not os.path.exists(hist_path)
    with open(hist_path, "a", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        if new:
            w.writerow(["date", "id", "name", "subs", "views", "videos"])
        for d in data:
            w.writerow([ts, d.get("id"), d.get("name"),
                        d.get("subs"), d.get("views"), d.get("videos")])
    print("appended %d rows for %s to %s" % (len(data), ts, hist_file))

def main():
    ts = slot_ts()
    for data_file, hist_file in EDITIONS:
        record(data_file, hist_file, ts)

main()
