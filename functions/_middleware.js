// Cloudflare Pages Function (全リクエストで実行)
// pbers.pages.dev への本番アクセスを pbers.com へ 301(恒久)リダイレクトし、
// 検索エンジンの評価を pbers.com に一本化する(重複ドメイン対策)。
// ・プレビュー用の <hash>.pbers.pages.dev は対象外(完全一致のみ)なので壊れない。
// ・pbers.com はそのまま静的アセットを配信(next())。
export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (url.hostname === "pbers.pages.dev") {
    return Response.redirect("https://pbers.com" + url.pathname + url.search, 301);
  }
  return context.next();
}
