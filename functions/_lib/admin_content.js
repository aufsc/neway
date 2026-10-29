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

const slugSeg = (s) => String(s || "")
  .replace(/\.[^.]+$/, "")
  .toLowerCase()
  .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 40);

const mediaBase = (env) => String(env.MEDIA_BASE || "").replace(/\/+$/, "");
const mediaUrl = (env, key) => (mediaBase(env) ? `${mediaBase(env)}/${key}` : `/media/${key}`);

function splitPath(raw) {
  const segs = String(raw || "").replace(/\\/g, "/").split("/").filter(Boolean);
  const base = segs.pop() || "img";
  const dir = segs.map(slugSeg).filter(Boolean).join("/");
  return { dir, base: slugSeg(base) || "img" };
}

async function keyTaken(db, key) {
  return !!(await db.prepare("SELECT 1 AS x FROM media WHERE key = ?").bind(key).first());
}

async function moveKey(env, db, oldKey, newKey) {
  if (oldKey === newKey) return oldKey;
  const obj = await env.MEDIA.get(oldKey);
  if (!obj) throw new HttpError(404, `R2 中找不到 ${oldKey}`);
  await env.MEDIA.put(newKey, await obj.arrayBuffer(), { httpMetadata: obj.httpMetadata });
  await env.MEDIA.delete(oldKey);
  await db.prepare("UPDATE media SET key = ? WHERE key = ?").bind(newKey, oldKey).run();
  return newKey;
}

export async function media({ request, env, admin, parts }) {
  if (!env.MEDIA) throw new HttpError(503, "未绑定 R2 存储桶（变量名需为 MEDIA）");
  const db = env.DB;
  const seg = parts[1] || "";
  const id = Number(seg) || 0;
  const url = new URL(request.url);

  // ---------------------------------------------------------------- 文件夹
  if (seg === "dirs") {
    const dir = decodeURIComponent(parts[2] || "").split("/").map(slugSeg).filter(Boolean).join("/");

    if (request.method === "GET") {
      const a = (await db.prepare("SELECT name FROM media_dirs ORDER BY name").all()).results.map((r) => r.name);
      const b = (await db.prepare(
        "SELECT DISTINCT substr(key, 1, instr(key, '/') - 1) AS d FROM media WHERE instr(key, '/') > 0 ORDER BY d"
      ).all()).results.map((r) => r.d);
      return json({ items: [...new Set([...a, ...b])].sort() });
    }

    if (request.method === "POST") {
      const body = await readJson(request);
      const name = String(body.name || "").split("/").map(slugSeg).filter(Boolean).join("/");
      if (!name) throw new HttpError(400, "文件夹名不能为空");
      await db.prepare("INSERT OR IGNORE INTO media_dirs (name, created_at) VALUES (?, ?)").bind(name, Date.now()).run();
      return ok({ name });
    }

    if (request.method === "PATCH") {
      if (!dir) throw new HttpError(400, "缺少原文件夹");
      const body = await readJson(request);
      const next = String(body.name || "").split("/").map(slugSeg).filter(Boolean).join("/");
      if (!next) throw new HttpError(400, "新文件夹名不能为空");
      if (next === dir) return ok({ moved: 0 });
      const rows = (await db.prepare("SELECT key FROM media WHERE key LIKE ?").bind(`${dir}/%`).all()).results;
      for (const r of rows) await moveKey(env, db, r.key, `${next}/${r.key.slice(dir.length + 1)}`);
      await db.prepare("UPDATE media_dirs SET name = ? WHERE name = ?").bind(next, dir).run();
      return ok({ moved: rows.length });
    }

    if (request.method === "DELETE") {
      if (!dir) throw new HttpError(400, "缺少文件夹");
      const n = (await db.prepare("SELECT COUNT(*) AS n FROM media WHERE key LIKE ?").bind(`${dir}/%`).first()).n;
      if (n > 0) throw new HttpError(409, "文件夹里还有图片，先清空");
      await db.prepare("DELETE FROM media_dirs WHERE name = ?").bind(dir).run();
      return ok();
    }
    throw new HttpError(405, "method not allowed");
  }

  // ---------------------------------------------------------------- 批量
  if (seg === "bulk" && request.method === "POST") {
    const body = await readJson(request);
    const list = Array.isArray(body.ids) ? body.ids.map(Number).filter((n) => n > 0).slice(0, 200) : [];
    if (!list.length) throw new HttpError(400, "no ids");
    if (body.action !== "delete") throw new HttpError(400, "bad action");
    const marks = list.map(() => "?").join(",");
    const rows = await db.prepare(`SELECT key FROM media WHERE id IN (${marks})`).bind(...list).all();
    for (const r of rows.results) await env.MEDIA.delete(r.key);
    await db.prepare(`DELETE FROM media WHERE id IN (${marks})`).bind(...list).run();
    return ok({ count: rows.results.length });
  }

  // ---------------------------------------------------------------- 列表
  if (request.method === "GET") {
    const q = (url.searchParams.get("q") || "").trim();
    const dir = (url.searchParams.get("dir") || "").trim().replace(/^\/+|\/+$/g, "");
    const page = Math.max(parseInt(url.searchParams.get("page") || "1", 10) || 1, 1);
    const per = 40;

    const w = [], a = [];
    if (q) { w.push("(name LIKE ? OR key LIKE ?)"); a.push(`%${q}%`, `%${q}%`); }
    if (dir) { w.push("key LIKE ?"); a.push(`${dir}/%`); }
    const where = w.length ? "WHERE " + w.join(" AND ") : "";

    const { results } = await db.prepare(
      `SELECT id, key, name, type, size, created_at FROM media ${where} ORDER BY key ASC LIMIT ? OFFSET ?`
    ).bind(...a, per, (page - 1) * per).all();
    const total = await db.prepare(`SELECT COUNT(*) AS n FROM media ${where}`).bind(...a).first();

    const fromKeys = (await db.prepare(
      "SELECT DISTINCT substr(key, 1, instr(key, '/') - 1) AS d FROM media WHERE instr(key, '/') > 0 ORDER BY d"
    ).all()).results.map((r) => r.d);
    const declared = (await db.prepare("SELECT name FROM media_dirs ORDER BY name").all()).results.map((r) => r.name);

    return json({
      items: results.map((m) => ({ ...m, url: mediaUrl(env, m.key) })),
      total: total.n, per,
      folders: [...new Set([...fromKeys, ...declared])].sort(),
    });
  }

  // ---------------------------------------------------------------- 上传
  if (request.method === "POST" && !id) {
    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") throw new HttpError(400, "no file");
    const custom = String(form.get("name") || "").trim();

    const max = (parseInt(env.MEDIA_MAX_MB || "10", 10) || 10) * 1048576;
    const type = (file.type || "").toLowerCase();
    if (!TYPES[type]) throw new HttpError(415, "仅支持 jpg / png / gif / webp / avif / svg");
    if (file.size > max) throw new HttpError(413, `文件超过 ${max / 1048576} MB`);

    const ext = TYPES[type];
    const { dir, base } = splitPath(custom || file.name || "img");
    const prefix = dir ? `${dir}/` : "";

    let key = `${prefix}${base}.${ext}`;
    for (let n = 2; await keyTaken(db, key); n++) {
      if (n > 99) throw new HttpError(409, "同名文件过多，请换个名字");
      key = `${prefix}${base}-${n}.${ext}`;
    }

    await env.MEDIA.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: type } });
    const display = `${base}.${ext}`;
    const r = await db.prepare("INSERT INTO media (key, name, type, size, created_at, admin_id) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(key, display, type, file.size, Date.now(), admin.id).run();
    if (dir) await db.prepare("INSERT OR IGNORE INTO media_dirs (name, created_at) VALUES (?, ?)").bind(dir, Date.now()).run();

    return json({ item: { id: r.meta.last_row_id, key, name: display, type, size: file.size, url: mediaUrl(env, key) } }, 201);
  }

  // ---------------------------------------------------------------- 改名 / 移动
  if (request.method === "PATCH" && id) {
    const body = await readJson(request);
    const row = await db.prepare("SELECT id, key, name FROM media WHERE id = ?").bind(id).first();
    if (!row) throw new HttpError(404, "not found");

    let nextKey = row.key;
    if (body.key) {
      const { dir, base } = splitPath(String(body.key));
      const ext = row.key.split(".").pop();
      nextKey = `${dir ? dir + "/" : ""}${base}.${ext}`;
      if (nextKey !== row.key) {
        if (await keyTaken(db, nextKey)) throw new HttpError(409, "目标路径已存在");
        nextKey = await moveKey(env, db, row.key, nextKey);
        if (dir) await db.prepare("INSERT OR IGNORE INTO media_dirs (name, created_at) VALUES (?, ?)").bind(dir, Date.now()).run();
      }
    }

    const display = String(body.name || row.name).trim().slice(0, 120) || row.name;
    await db.prepare("UPDATE media SET key = ?, name = ? WHERE id = ?").bind(nextKey, display, id).run();
    return ok({ key: nextKey, url: mediaUrl(env, nextKey) });
  }

  // ---------------------------------------------------------------- 删除
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