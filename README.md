# PBers — ポーランドボール チャンネル分析サイト

将来的に **pbers.com** として公開するための準備版サイト。日本のポーランドボール系
YouTubeチャンネルの登録者数を集計し、ランキング(棒グラフ)・シェア(円グラフ)で可視化する。

## 構成

| ファイル | 役割 |
|---|---|
| `index.html` | サイト本体 |
| `assets/style.css` | スタイル(ベースカラー `#ac1c1c` / `#3c3c3c`、英数字は Space Grotesk) |
| `assets/app.js` | 棒グラフ・円グラフ・一覧の描画 |
| `assets/data.js` | 表示用データ(自動生成) |
| `channels.txt` | 集計対象チャンネルURL一覧 |
| `fetch.py` | 各チャンネルの登録者数を取得して `data.json` を出力 |
| `data.json` | 取得結果(生データ) |

## データ更新の手順

```bash
python fetch.py      # channels.txt を読み、登録者数・総再生数を data.json に保存
python gen_data.py   # data.json -> assets/data.js(固有色つきの表示用データ)
```

チャンネルを追加/削除する場合は `channels.txt` を編集してから上記を実行する。
固定カラー(フヒフム/みかんぼーる/田中MID)は `gen_data.py` の `FIXED` で管理。
更新日は `gen_data.py` の `UPDATED` を変更する。

## 表示モード

ヒーローのトグルで **登録者数 / 総再生数** を切り替え可能。円グラフ・棒グラフ・
一覧・合計値がモードに応じて並び替え・再描画される。総再生数を非公開にしている
チャンネルは `—`(円グラフでは 0)として扱う。

## ローカルで確認

```bash
python -m http.server 8823
```

ブラウザで <http://127.0.0.1:8823/> を開く。`index.html` を直接開いてもデータは表示される
(データは `data.js` に埋め込み済みのため)。

## 取得ロジックの注意点

登録者数・総再生数は各チャンネルの **`/about` ページ**に含まれる
`aboutChannelViewModel` から取得している。ここには本人の
`subscriberCountText`(文字列)と `viewCountText`(総再生回数)が並んでおり、
本人の値であることが保証される。

- 登録者数: `"subscriberCountText":"チャンネル登録者数 …"`(**文字列形式**)。
  オブジェクト形式 `"subscriberCountText":{…}` はサイドバーの**関連チャンネル**の値なので拾わない。
- 総再生数: `"viewCountText":"…回視聴"`。
