/**
 * 公开读取 R2 里的图片：GET /media/2025/01/xxxx-name.jpg
 * 也可以改为给 R2 绑定自定义域名（见 DEPLOY.md），这时文章里直接写那个域名的链接即可。
 */
export async function onRequest({ request, env, params }) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("method not allowed", { status: 405 });
  if (!env.MEDIA) return new Response("R2 not bound", { status: 503 });
  const key = (Array.isArray(params.key) ? params.key : [params.key]).join("/");
  if (!key || key.includes("..")) return new Response("bad key", { status: 400 });

  const obj = await env.MEDIA.get(key);
  if (!obj) return new Response("not found", { status: 404 });

  const etag = obj.httpEtag || `"${obj.etag}"`;
  const headers = new Headers({
    "content-type": (obj.httpMetadata && obj.httpMetadata.contentType) || "application/octet-stream",
    "cache-control": "public, max-age=31536000, immutable",
    etag,
    "x-content-type-options": "nosniff",
  });
  // SVG 可能内嵌脚本：沙箱化，禁止执行
  if (headers.get("content-type") === "image/svg+xml") headers.set("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(request.method === "HEAD" ? null : obj.body, { headers });
}
