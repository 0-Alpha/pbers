# PBers Cron Worker (統計トリガー + WebSub 新着通知)

`worker.js` を Cloudflare Worker(ダッシュボードの `pbers-cron`)に貼り替えて使う。

## セットアップ手順

### 1. KV を作成してバインド
1. Cloudflare → **Workers & Pages → KV → Create namespace**（例: `pbers_kv`）
2. Worker `pbers-cron` → **Settings → Variables → KV Namespace Bindings**
   - Variable name: **`PBERS_KV`** / Namespace: いま作った `pbers_kv`

### 2. Secret / Variable を登録
Worker → **Settings → Variables and Secrets**

| 名前 | 種類 | 値 |
|---|---|---|
| `GH_TOKEN` | Secret | GitHub の fine-grained token（既存） |
| `RUN_KEY` | Secret | 手動実行用の合言葉（既存） |
| `HUB_SECRET` | Secret | 任意の秘密文字列（署名検証用・新規） |
| `CALLBACK_URL` | Variable(Text) | `https://pbers-cron.<あなたのサブドメイン>.workers.dev/yt` |

### 3. コードを貼り替え
Worker の **Edit code** で中身を全部消して `worker.js` を貼り付け → **Deploy**。

### 4. Cron を確認
**Settings → Triggers → Cron Triggers** に `0 3,9,15,21 * * *`（既存）。
※このcronで「統計取得＋購読のリース更新」が毎回走る（購読は失効しない）。

### 5. 購読を開始
ブラウザで下記を開く:

```
https://pbers-cron.<サブドメイン>.workers.dev/subscribe?key=<RUN_KEY>
```

- 無料プランの「1リクエスト最大50サブリクエスト」上限のため、**1回で30チャンネルずつ**購読する。
- 返り値の例: `subscribed 30/30 (ch 0..30 of 92). next=30`
- **全部購読するには、続けて数回叩く**（`next=30 → 60 → 90 → 0`）。KVの `subcursor` が巡回位置を覚えている。
- 以降は cron（6時間ごと）が自動で30件ずつ巡回し、リースを更新し続ける。
- 購読すると直後に Hub が確認 GET（`/yt`）＋各チャンネルの最新動画を初回通知（`POST /yt`）してくるので、`/videos` にデータが入り始める。

### 6. 動作確認
- どれかのチャンネルが新着動画を上げる（またはあなたのテスト動画）と、数秒後に `POST /yt` へ通知が届く。
- `https://pbers-cron.<サブドメイン>.workers.dev/videos` を開いて、最新動画 JSON が入っていれば成功。

## サイト側
サイトは `window.PBERS_VIDEOS_API` に Worker の `/videos` URL を設定すると「最新動画」を表示する（`index.html` 参照）。
例: `window.PBERS_VIDEOS_API = "https://pbers-cron.<サブドメイン>.workers.dev/videos";`

## 仕組みメモ
- Topic: `https://www.youtube.com/xml/feeds/videos.xml?channel_id=UCxxxx`
- Hub: `https://pubsubhubbub.appspot.com/`
- 監視対象は `https://pbers.pages.dev/channels.json`（`gen_data.py` が自動生成）。
- 通知はタイトル編集でも飛ぶため `videoId` で重複排除。削除通知は無視。
- リースは最大約10日。cron で毎回再購読して更新。
