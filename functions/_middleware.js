// Cloudflare Pages Function (全リクエストで実行)
// pbers.pages.dev への本番アクセスを pbers.com へ 301(恒久)リダイレクトし、
// 検索エンジンの評価を pbers.com に一本化する(重複ドメイン対策)。
// ・プレビュー用の <hash>.pbers.pages.dev は対象外(完全一致のみ)なので壊れない。
// ・pbers.com はそのまま静的アセットを配信(next())。
//
// 掲載削除依頼により非公開化したページ: 静的ファイルが配信に残っていても、
// ここで確実に 410 Gone を返して遮断する(検索エンジンにも削除を促す)。
// 追加する場合はデコード済み・小文字のパスを GONE_PATHS に足す。
const GONE_PATHS = [
  "/c/ikasumi帝国/",
  "/c/ikasumi帝国"
];
export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (url.hostname === "pbers.pages.dev") {
    return Response.redirect("https://pbers.com" + url.pathname + url.search, 301);
  }
  let decoded;
  try { decoded = decodeURIComponent(url.pathname); } catch (e) { decoded = url.pathname; }
  if (GONE_PATHS.indexOf(decoded.toLowerCase()) !== -1) {
    return new Response("このページは公開を終了しました。", {
      status: 410,
      headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" }
    });
  }
  return context.next();
}
