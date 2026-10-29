/**
 * 管理后台 API 路由（/api/admin/*）。
 *   auth/setup | auth/login | auth/logout | auth/me | auth/password
 *   posts · media · deploy · comments · messages · blocks · commenters · overview · visits   （admin / editor）
 *   users                                                                                    （仅 admin）
 */
import { json, sameOrigin, ensureSchema, ipHashOf, sha256, secretEquals } from "../../_lib/common.js";
import {
  HttpError, ok, readJson, csrfOk, getAdmin, hashPassword, verifyPassword, validUsername, validPassword,
  createSession, sessionCookie, cookieValue,
} from "../../_lib/auth.js";
import * as content from "../../_lib/admin_content.js";
import * as mod from "../../_lib/admin_moderation.js";

const FAIL_WINDOW = 15 * 60 * 1000;
const FAIL_MAX = 8;
const DUMMY = "pbkdf2$100000$00000000000000000000000000000000$" + "0".repeat(64);

async function authRoutes({ request, env, parts }) {
  const db = env.DB;
  const act = parts[1];

  // 首个管理员：仅当 admins 为空，且提供了 ADMIN_SETUP_TOKEN
  if (act === "setup" && request.method === "POST") {
    const count = (await db.prepare("SELECT COUNT(*) AS n FROM admins").first()).n;
    if (count > 0) throw new HttpError(403, "已初始化");
    if (!env.ADMIN_SETUP_TOKEN) throw new HttpError(503, "未配置 ADMIN_SETUP_TOKEN");
    const b = await readJson(request);
    if (!b.setup_token || !(await secretEquals(String(b.setup_token), env.ADMIN_SETUP_TOKEN))) throw new HttpError(403, "初始化口令不正确");
    if (!validUsername(b.username)) throw new HttpError(400, "用户名需 3–32 位字母、数字或 _ . -");
    if (!validPassword(b.password)) throw new HttpError(400, "密码至少 8 位");
    await db.prepare("INSERT INTO admins (username, pass_hash, role, created_at) VALUES (?, ?, 'admin', ?)")
      .bind(b.username, await hashPassword(b.password), Date.now()).run();
    return ok();
  }

  if (act === "login" && request.method === "POST") {
    const ip = await ipHashOf(request, env);
    if (ip) {
      const f = await db.prepare("SELECT COUNT(*) AS n FROM login_fails WHERE ip_hash = ? AND ts > ?").bind(ip, Date.now() - FAIL_WINDOW).first();
      if (f.n >= FAIL_MAX) throw new HttpError(429, "尝试次数过多，请 15 分钟后再试");
    }
    const b = await readJson(request);
    const row = typeof b.username === "string"
      ? await db.prepare("SELECT id, pass_hash, disabled, role, username FROM admins WHERE username = ? COLLATE NOCASE").bind(b.username.trim()).first()
      : null;
    const good = await verifyPassword(String(b.password || ""), row ? row.pass_hash : DUMMY);   // 用户不存在也跑一次，避免计时差异
    if (!row || !good || row.disabled) {
      if (ip) await db.prepare("INSERT INTO login_fails (ip_hash, ts) VALUES (?, ?)").bind(ip, Date.now()).run();
      throw new HttpError(401, "用户名或密码不正确");
    }
    if (ip) await db.prepare("DELETE FROM login_fails WHERE ip_hash = ?").bind(ip).run();
    await db.prepare("UPDATE admins SET last_login = ? WHERE id = ?").bind(Date.now(), row.id).run();
    const token = await createSession(db, row.id);
    return json({ ok: true, user: { id: row.id, username: row.username, role: row.role } }, 200,
      { "set-cookie": sessionCookie(token, request, 7 * 86400) });
  }

  if (act === "logout" && request.method === "POST") {
    const t = cookieValue(request);
    if (t) await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(t)).run();
    return json({ ok: true }, 200, { "set-cookie": sessionCookie("", request, 0) });
  }

  if (act === "me" && request.method === "GET") {
    const admin = await getAdmin(request, env);
    const count = admin ? 1 : (await db.prepare("SELECT COUNT(*) AS n FROM admins").first()).n;
    return json({ user: admin || null, needSetup: !admin && count === 0 });
  }
  return null;
}

export async function onRequest(ctx) {
  const { request, env, params, waitUntil } = ctx;
  const parts = (Array.isArray(params.path) ? params.path : [params.path]).filter(Boolean);
  try {
    if (!env.DB) throw new HttpError(500, "未绑定 D1 数据库（变量名需为 DB）");
    if (!sameOrigin(request)) throw new HttpError(403, "forbidden");
    if (!csrfOk(request)) throw new HttpError(403, "bad request header");
    await ensureSchema(env.DB);

    if (parts[0] === "auth") {
      const r = await authRoutes({ request, env, parts });
      if (r) return r;
    }

    const admin = await getAdmin(request, env);
    if (!admin) throw new HttpError(401, "未登录");
    const c = { request, env, admin, parts, waitUntil };

    switch (parts[0]) {
      case "auth":
        if (parts[1] === "password" && request.method === "POST") {   // 修改自己的密码
          const b = await readJson(request);
          const row = await env.DB.prepare("SELECT pass_hash FROM admins WHERE id = ?").bind(admin.id).first();
          if (!(await verifyPassword(String(b.old || ""), row.pass_hash))) throw new HttpError(400, "原密码不正确");
          if (!validPassword(b.password)) throw new HttpError(400, "新密码至少 8 位");
          await env.DB.prepare("UPDATE admins SET pass_hash = ? WHERE id = ?").bind(await hashPassword(b.password), admin.id).run();
          const keep = await sha256(cookieValue(request));
          await env.DB.prepare("DELETE FROM sessions WHERE admin_id = ? AND token_hash != ?").bind(admin.id, keep).run();
          return ok();
        }
        break;
      case "overview": return await mod.overview(c);
      case "visits": return await mod.visits(c);
      case "posts": return await content.posts(c);
      case "media": return await content.media(c);
      case "deploy": return await content.deploy(c);
      case "comments": return await mod.comments(c);
      case "messages": return await mod.messages(c);
      case "blocks": return await mod.blocks(c);
      case "commenters": return await mod.commenters(c);
      case "users":
        if (admin.role !== "admin") throw new HttpError(403, "需要管理员权限");
        return await mod.users(c);
    }
    throw new HttpError(404, "not found");
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error("[api]", e && e.stack ? e.stack : e);   // 写入 Cloudflare 日志，便于线上排错
    return json({ error: "server error" }, 500);
  }
}