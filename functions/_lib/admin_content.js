/** 管理后台：文章（GitHub）· 媒体库（R2）· 构建状态 */
import { json } from "./common.js";
import { HttpError, ok, readJson } from "./auth.js";
import { listPosts, getPost, putPost, deletePost, checkName, parseHeader } from "./github.js";

// ------------------------------------------------------------------ 文章
async function upsertIndex(db, name, sha, text) {
  const h = parseHeader(text);
  await db.prepare(
    `INSERT INTO post_index (name, sha, title, date, category, tags, cover, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET sha=excluded.sha, title=excluded.title, date=excluded.date,
       category=excluded.category, tags=excluded.tags, cover=excluded.cover, updated_at=excluded.updated_at`
  ).bind(name, sha, h.title, h.date, h.category, h.tags, h.cover, Date.now()).run();
}

export async function posts({ request, env, admin, parts }) {
  const db = env.DB;
  const [, name, extra] = parts;

  if (request.method === "GET" && !name) {
    const files = await listPosts(env);
    const { results } = await db.prepare("SELECT * FROM post_index").all();
    const idx = new Map(results.map((r) => [r.name, r]));
    const list = files.map((f) => {
      const i = idx.get(f.name);
      return {
        name: f.name, sha: f.sha, size: f.size, draft: f.name.startsWith("_"),
        indexed: !!(i && i.sha === f.sha),
        title: (i && i.title) || f.name.replace(/\.md$/, ""), date: (i && i.date) || "",
        category: (i && i.category) || "", tags: (i && i.tags) || "", cover: (i && i.cover) || "",
      };
    });
    list.sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.name.localeCompare(b.name));
    return json({ posts: list });
  }

  // 补全索引：每次最多取 30 篇（Workers 子请求数有限）
  if (request.method === "POST" && name === "sync") {
    const files = await listPosts(env);
    const { results } = await db.prepare("SELECT name, sha FROM post_index").all();
    const have = new Map(results.map((r) => [r.name, r.sha]));
    const names = new Set(files.map((f) => f.name));
    for (const r of results) if (!names.has(r.name)) await db.prepare("DELETE FROM post_index WHERE name = ?").bind(r.name).run();
    const stale = files.filter((f) => have.get(f.name) !== f.sha);
    for (const f of stale.slice(0, 30)) { const p = await getPost(env, f.name); await upsertIndex(db, f.name, p.sha, p.content); }
    return ok({ synced: Math.min(stale.length, 30), remaining: Math.max(stale.length - 30, 0) });
  }

  if (!name) throw new HttpError(405, "method not allowed");
  checkName(name);

  if (request.method === "GET") return json(await getPost(env, name));

  if (request.method === "PUT") {
    const b = await readJson(request);
    if (typeof b.content !== "string" || !b.content.trim() || b.content.length > 900000) throw new HttpError(400, "bad content");
    const msg = `${b.sha ? "update" : "create"}: ${name} (by ${admin.username})`;
    const r = await putPost(env, name, b.content, b.sha || undefined, msg);
    await upsertIndex(db, name, r.sha, b.content);
    return ok({ sha: r.sha, commit: r.commit });
  }

  if (request.method === "DELETE") {
    const b = await readJson(request);
    if (!b.sha) throw new HttpError(400, "sha required");
    const r = await deletePost(env, name, b.sha, `delete: ${name} (by ${admin.username})`);
    await db.prepare("DELETE FROM post_index WHERE name = ?").bind(name).run();
    return ok({ commit: r.commit });
  }
  throw new HttpError(405, extra ? "bad route" : "method not allowed");
}

// ------------------------------------------------------------------ 媒体库（R2）
const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif", "image/svg+xml": "svg" };
const slug = (s) => s.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "img";

export async function media({ request, env, admin, parts }) {
  if (!env.MEDIA) throw new HttpError(503, "未绑定 R2 存储桶（变量名需为 MEDIA）");
  const db = env.DB;
  const id = Number(parts[1]) || 0;

  if (request.method === "GET") {
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") || "").trim();
    const page = Math.max(parseInt(url.searchParams.get("page") || "1", 10) || 1, 1);
    const per = 40;
    const where = q ? "WHERE name LIKE ?" : "";
    const args = q ? [`%${q}%`] : [];
    const { results } = await db.prepare(`SELECT id, key, name, type, size, created_at FROM media ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .bind(...args, per, (page - 1) * per).all();
    const total = await db.prepare(`SELECT COUNT(*) AS n FROM media ${where}`).bind(...args).first();
    return json({ items: results.map((m) => ({ ...m, url: `/media/${m.key}` })), total: total.n, per });
  }

  if (request.method === "POST") {
    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") throw new HttpError(400, "no file");
    const max = (parseInt(env.MEDIA_MAX_MB || "10", 10) || 10) * 1048576;
    const type = (file.type || "").toLowerCase();
    if (!TYPES[type]) throw new HttpError(415, "仅支持 jpg / png / gif / webp / avif / svg");
    if (file.size > max) throw new HttpError(413, `文件超过 ${max / 1048576} MB`);
    const d = new Date();
    const rand = [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const key = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${rand}-${slug(file.name || "img")}.${TYPES[type]}`;
    await env.MEDIA.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: type } });
    const r = await db.prepare("INSERT INTO media (key, name, type, size, created_at, admin_id) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(key, (file.name || "img").slice(0, 120), type, file.size, Date.now(), admin.id).run();
    return json({ item: { id: r.meta.last_row_id, key, name: file.name, type, size: file.size, url: `/media/${key}` } }, 201);
  }

  if (request.method === "DELETE" && id) {
    const row = await db.prepare("SELECT key FROM media WHERE id = ?").bind(id).first();
    if (!row) throw new HttpError(404, "not found");
    await env.MEDIA.delete(row.key);
    await db.prepare("DELETE FROM media WHERE id = ?").bind(id).run();
    return ok();
  }
  throw new HttpError(405, "method not allowed");
}

// ------------------------------------------------------------------ 构建状态 / 手动触发
export async function deploy({ request, env }) {
  if (request.method === "POST") {
    if (!env.DEPLOY_HOOK_URL) throw new HttpError(503, "未配置 DEPLOY_HOOK_URL");
    const r = await fetch(env.DEPLOY_HOOK_URL, { method: "POST" });
    if (!r.ok) throw new HttpError(502, `deploy hook ${r.status}`);
    return ok();
  }
  const { CF_API_TOKEN, CF_ACCOUNT_ID, CF_PROJECT } = env;
  if (!CF_API_TOKEN || !CF_ACCOUNT_ID || !CF_PROJECT) return json({ configured: false });
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects/${CF_PROJECT}/deployments?per_page=1`,
    { headers: { authorization: `Bearer ${CF_API_TOKEN}` } });
  if (!r.ok) return json({ configured: true, error: `HTTP ${r.status}` });
  const d = ((await r.json()).result || [])[0];
  if (!d) return json({ configured: true, status: "none" });
  const st = d.latest_stage || {};
  return json({ configured: true, status: st.status, stage: st.name, created_on: d.created_on, url: d.url });
}
