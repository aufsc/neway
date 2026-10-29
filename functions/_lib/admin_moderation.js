/** 管理后台：评论 · 联系留言 · 黑名单 · 评论者 · 管理员账号 · 概览 */
import { json, cleanMail } from "./common.js";
import { HttpError, ok, readJson, hashPassword, validUsername, validPassword, destroySessions } from "./auth.js";
import { notifyComment } from "./notify.js";

const page = (url) => Math.max(parseInt(url.searchParams.get("page") || "1", 10) || 1, 1);
const ids = (a) => (Array.isArray(a) ? a.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 200) : []);

// ------------------------------------------------------------------ 评论
export async function comments({ request, env, admin, parts, waitUntil }) {
  const db = env.DB;
  const url = new URL(request.url);
  const id = Number(parts[1]) || 0;

  if (request.method === "GET") {
    const per = 30, w = [], a = [];
    const q = (url.searchParams.get("q") || "").trim();
    const status = url.searchParams.get("status");
    const path = url.searchParams.get("path");
    if (q) { w.push("(body LIKE ? OR name LIKE ? OR email LIKE ?)"); a.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    if (status !== null && status !== "" && !Number.isNaN(Number(status))) { w.push("status = ?"); a.push(Number(status)); }
    if (path) { w.push("path = ?"); a.push(path); }
    const where = w.length ? "WHERE " + w.join(" AND ") : "";
    const { results } = await db.prepare(
      `SELECT id, path, name, email, website, body, created_at, status, is_owner, parent_id, reply_to, ip_hash
         FROM comments ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).bind(...a, per, (page(url) - 1) * per).all();
    const total = await db.prepare(`SELECT COUNT(*) AS n FROM comments ${where}`).bind(...a).first();
    return json({ items: results, total: total.n, per });
  }

  if (request.method === "POST" && parts[1] === "bulk") {
    const b = await readJson(request);
    const list = ids(b.ids);
    if (!list.length) throw new HttpError(400, "no ids");
    const marks = list.map(() => "?").join(",");
    if (b.action === "delete") {
      await db.prepare(`DELETE FROM comments WHERE parent_id IN (${marks})`).bind(...list).run();
      await db.prepare(`DELETE FROM comments WHERE id IN (${marks})`).bind(...list).run();
    } else if (b.action === "hide" || b.action === "show") {
      await db.prepare(`UPDATE comments SET status = ? WHERE id IN (${marks})`).bind(b.action === "hide" ? 1 : 0, ...list).run();
    } else throw new HttpError(400, "bad action");
    return ok({ count: list.length });
  }

  if (!id) throw new HttpError(405, "method not allowed");

  // 以站主身份回复：挂到楼主下，并按需通知被回复者
  if (request.method === "POST" && parts[2] === "reply") {
    const b = await readJson(request);
    const body = typeof b.body === "string" ? b.body.trim() : "";
    if (!body || body.length > 2000) throw new HttpError(400, "bad body");
    const target = await db.prepare("SELECT id, path, parent_id, name, email FROM comments WHERE id = ?").bind(id).first();
    if (!target) throw new HttpError(404, "not found");
    const ownerName = (env.OWNER_NAME || "new").trim().slice(0, 40) || "new";
    const parentId = target.parent_id || target.id;
    const now = Date.now();
    const r = await db.prepare(
      `INSERT INTO comments (path, name, body, created_at, ip_hash, email, website, parent_id, reply_to, is_owner, status)
       VALUES (?, ?, ?, ?, '', '', '', ?, ?, 1, 0)`).bind(target.path, ownerName, body, now, parentId, target.name).run();
    const job = notifyComment(env, url.origin, { path: target.path, name: ownerName, body, email: "", replyTo: target.name, isOwner: 1 }, target);
    if (typeof waitUntil === "function") waitUntil(job);
    return json({ ok: true, id: r.meta.last_row_id }, 201);
  }

  if (request.method === "PATCH") {
    const b = await readJson(request);
    if (b.status !== undefined) {
      if (![0, 1, 2].includes(Number(b.status))) throw new HttpError(400, "bad status");
      await db.prepare("UPDATE comments SET status = ? WHERE id = ?").bind(Number(b.status), id).run();
    }
    if (b.body !== undefined) {
      const body = String(b.body).trim();
      if (!body || body.length > 2000) throw new HttpError(400, "bad body");
      await db.prepare("UPDATE comments SET body = ? WHERE id = ?").bind(body, id).run();
    }
    return ok();
  }

  if (request.method === "DELETE") {
    await db.prepare("DELETE FROM comments WHERE parent_id = ?").bind(id).run();
    await db.prepare("DELETE FROM comments WHERE id = ?").bind(id).run();
    return ok();
  }
  throw new HttpError(405, "method not allowed");
}

// ------------------------------------------------------------------ 联系留言
export async function messages({ request, env, parts }) {
  const db = env.DB;
  const id = Number(parts[1]) || 0;
  if (request.method === "GET") {
    const url = new URL(request.url), per = 30;
    const { results } = await db.prepare("SELECT id, name, email, subject, body, created_at, mailed FROM messages ORDER BY id DESC LIMIT ? OFFSET ?")
      .bind(per, (page(url) - 1) * per).all();
    const total = await db.prepare("SELECT COUNT(*) AS n FROM messages").first();
    return json({ items: results, total: total.n, per });
  }
  if (request.method === "DELETE" && id) { await db.prepare("DELETE FROM messages WHERE id = ?").bind(id).run(); return ok(); }
  throw new HttpError(405, "method not allowed");
}

// ------------------------------------------------------------------ 黑名单 & 评论者
export async function blocks({ request, env, parts }) {
  const db = env.DB;
  const id = Number(parts[1]) || 0;
  if (request.method === "GET") {
    const { results } = await db.prepare("SELECT id, kind, value, note, created_at FROM blocks ORDER BY id DESC LIMIT 500").all();
    return json({ items: results });
  }
  if (request.method === "POST") {
    const b = await readJson(request);
    if (!["name", "email", "ip"].includes(b.kind)) throw new HttpError(400, "bad kind");
    let value = String(b.value || "").trim().toLowerCase();
    if (b.kind === "email") value = cleanMail(value).toLowerCase();
    if (!value || value.length > 120) throw new HttpError(400, "bad value");
    await db.prepare("INSERT OR IGNORE INTO blocks (kind, value, note, created_at) VALUES (?, ?, ?, ?)")
      .bind(b.kind, value, String(b.note || "").slice(0, 100), Date.now()).run();
    return ok();
  }
  if (request.method === "DELETE" && id) { await db.prepare("DELETE FROM blocks WHERE id = ?").bind(id).run(); return ok(); }
  throw new HttpError(405, "method not allowed");
}

export async function commenters({ request, env }) {
  const q = (new URL(request.url).searchParams.get("q") || "").trim();
  const where = q ? "AND (name LIKE ? OR email LIKE ?)" : "";
  const args = q ? [`%${q}%`, `%${q}%`] : [];
  const { results } = await env.DB.prepare(
    `SELECT name, COALESCE(email,'') AS email, COALESCE(ip_hash,'') AS ip_hash, COUNT(*) AS n, MAX(created_at) AS last_at
       FROM comments WHERE is_owner = 0 ${where} GROUP BY name, email, ip_hash ORDER BY last_at DESC LIMIT 100`).bind(...args).all();
  const bl = await env.DB.prepare("SELECT kind, value FROM blocks").all();
  const set = new Set(bl.results.map((r) => `${r.kind}:${r.value}`));
  return json({
    items: results.map((r) => ({
      ...r,
      blocked: {
        name: set.has(`name:${r.name.toLowerCase()}`),
        email: !!r.email && set.has(`email:${r.email.toLowerCase()}`),
        ip: !!r.ip_hash && set.has(`ip:${r.ip_hash}`),
      },
    })),
  });
}

// ------------------------------------------------------------------ 管理员账号（仅 admin 角色）
export async function users({ request, env, admin, parts }) {
  const db = env.DB;
  const id = Number(parts[1]) || 0;
  const activeAdmins = async (excludeId) =>
    (await db.prepare("SELECT COUNT(*) AS n FROM admins WHERE role = 'admin' AND disabled = 0 AND id != ?").bind(excludeId || 0).first()).n;

  if (request.method === "GET") {
    const { results } = await db.prepare("SELECT id, username, role, disabled, created_at, last_login FROM admins ORDER BY id").all();
    return json({ items: results, me: admin.id });
  }
  if (request.method === "POST") {
    const b = await readJson(request);
    if (!validUsername(b.username)) throw new HttpError(400, "用户名需 3–32 位字母、数字或 _ . -");
    if (!validPassword(b.password)) throw new HttpError(400, "密码至少 8 位");
    if (!["admin", "editor"].includes(b.role)) throw new HttpError(400, "bad role");
    const dup = await db.prepare("SELECT 1 AS x FROM admins WHERE username = ? COLLATE NOCASE").bind(b.username).first();
    if (dup) throw new HttpError(409, "用户名已存在");
    await db.prepare("INSERT INTO admins (username, pass_hash, role, created_at) VALUES (?, ?, ?, ?)")
      .bind(b.username, await hashPassword(b.password), b.role, Date.now()).run();
    return ok();
  }
  if (!id) throw new HttpError(405, "method not allowed");
  const target = await db.prepare("SELECT id, role, disabled FROM admins WHERE id = ?").bind(id).first();
  if (!target) throw new HttpError(404, "not found");

  if (request.method === "PATCH") {
    const b = await readJson(request);
    const losing = (b.role && b.role !== "admin" && target.role === "admin") || (b.disabled && target.role === "admin");
    if (id === admin.id && (b.disabled || (b.role && b.role !== target.role))) throw new HttpError(400, "不能修改自己的角色或停用自己");
    if (losing && (await activeAdmins(id)) < 1) throw new HttpError(400, "至少保留一位可用的管理员");
    if (b.role !== undefined) {
      if (!["admin", "editor"].includes(b.role)) throw new HttpError(400, "bad role");
      await db.prepare("UPDATE admins SET role = ? WHERE id = ?").bind(b.role, id).run();
    }
    if (b.disabled !== undefined) {
      await db.prepare("UPDATE admins SET disabled = ? WHERE id = ?").bind(b.disabled ? 1 : 0, id).run();
      if (b.disabled) await destroySessions(db, id);
    }
    if (b.password !== undefined) {
      if (!validPassword(b.password)) throw new HttpError(400, "密码至少 8 位");
      await db.prepare("UPDATE admins SET pass_hash = ? WHERE id = ?").bind(await hashPassword(b.password), id).run();
      await destroySessions(db, id);
    }
    return ok();
  }
  if (request.method === "DELETE") {
    if (id === admin.id) throw new HttpError(400, "不能删除自己");
    if (target.role === "admin" && (await activeAdmins(id)) < 1) throw new HttpError(400, "至少保留一位可用的管理员");
    await destroySessions(db, id);
    await db.prepare("DELETE FROM admins WHERE id = ?").bind(id).run();
    return ok();
  }
  throw new HttpError(405, "method not allowed");
}

// ------------------------------------------------------------------ 概览
export async function overview({ env }) {
  const db = env.DB;
  const n = async (sql) => (await db.prepare(sql).first()).n;
  const stats = await db.prepare("SELECT k, v FROM stats WHERE k IN ('pv','uv')").all();
  const st = Object.fromEntries(stats.results.map((r) => [r.k, r.v]));
  const recent = await db.prepare("SELECT id, path, name, body, created_at, status FROM comments ORDER BY id DESC LIMIT 5").all();
  const media = await db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(size),0) AS bytes FROM media").first();
  return json({
    pv: st.pv || 0, uv: st.uv || 0,
    comments: await n("SELECT COUNT(*) AS n FROM comments"),
    pending: await n("SELECT COUNT(*) AS n FROM comments WHERE status = 2"),
    hidden: await n("SELECT COUNT(*) AS n FROM comments WHERE status = 1"),
    messages: await n("SELECT COUNT(*) AS n FROM messages"),
    media: media.n, mediaBytes: media.bytes, recent: recent.results,
  });
}
