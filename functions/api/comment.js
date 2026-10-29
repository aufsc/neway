/**
 * 评论接口（Cloudflare Pages Functions + D1）
 *   GET  /api/comment?path=/post/xxx&limit=200 → { comments: [...] }
 *   POST /api/comment { path, name, body, email?, website?, parentId?, replyTo?, token? }
 *
 * 站主：token 与 OWNER_SECRET 一致时 is_owner=1；昵称强制为 OWNER_NAME（默认 "new"），
 *       不受限速、不用填昵称、可用保留名。
 * 只做一级回复；email 只入库（用于回复通知），不会回传给前端；website 回传。
 * 新评论会通过 waitUntil 异步通知站长（邮件 / 机器人），见 _lib/notify.js。
 * 管理：status 0 公开 / 1 隐藏 / 2 待审核（COMMENT_MODERATION=1 时游客评论先审后发）；黑名单命中返回 403。
 */
import {
  json, normPath, cleanMail, cleanSite, secretEquals, sameOrigin, ipHashOf, ensureSchema, isBlocked, NAME_MAX,
} from "../_lib/common.js";
import { notifyComment } from "../_lib/notify.js";

const BODY_MAX = 2000;
const RATE_MS = 60 * 1000;
const LIST_MAX = 200;

const RESERVED = new Set([
  "admin", "administrator", "root", "moderator", "mod", "webmaster",
  "owner", "support", "official", "team", "null", "undefined",
  "博主", "站长", "管理员", "版主", "官方", "客服", "系统",
]);
const isReservedName = (name) =>
  RESERVED.has(String(name).trim().toLowerCase().replace(/[\s_.\-·]+/g, ""));

export async function onRequest({ request, env, waitUntil }) {
  const db = env.DB;
  if (!db) return json({ error: "未绑定 D1 数据库（变量名需为 DB）" }, 500);

  const ownerName = (env.OWNER_NAME || "new").trim().slice(0, NAME_MAX) || "new";
  const url = new URL(request.url);
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);

  try {
    await ensureSchema(db);

    // ---------------------------------------------------------------- 读取
    if (request.method === "GET") {
      const path = normPath(url.searchParams.get("path") || "/");
      if (!path) return json({ error: "bad path" }, 400);
      const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "200", 10) || 200, 1), LIST_MAX);
      const { results } = await db
        .prepare(
          `SELECT id, parent_id, name, body, website, reply_to, is_owner, created_at
             FROM (SELECT * FROM comments WHERE path = ? AND status = 0 ORDER BY id DESC LIMIT ?)
            ORDER BY id ASC`
        )
        .bind(path, limit)
        .all();
      return json({ comments: results });
    }

    // ---------------------------------------------------------------- 发表
    if (request.method === "POST") {
      let payload;
      try { payload = await request.json(); } catch { return json({ error: "bad request" }, 400); }

      const path = normPath(payload && payload.path);
      if (!path) return json({ error: "bad path" }, 400);

      const rawName = typeof payload.name === "string" ? payload.name.trim() : "";
      const body = typeof payload.body === "string" ? payload.body.trim() : "";

      // 先判站主，再决定昵称是否校验
      let isOwner = 0;
      const token = typeof payload.token === "string" ? payload.token.slice(0, 200) : "";
      if (env.OWNER_SECRET && token) isOwner = (await secretEquals(token, env.OWNER_SECRET)) ? 1 : 0;

      const name = isOwner ? ownerName : rawName;
      if (!isOwner && (!name || name.length > NAME_MAX)) return json({ error: "bad name" }, 400);
      if (!isOwner && isReservedName(name)) return json({ error: "reserved name" }, 400);
      if (!body || body.length > BODY_MAX) return json({ error: "bad body" }, 400);

      const email = cleanMail(payload.email);
      const website = cleanSite(payload.website);

      // 一级回复：回复楼中楼时挂到楼主下面；找出被回复者的邮箱用于通知
      let parentId = Number.isInteger(Number(payload.parentId)) && Number(payload.parentId) > 0 ? Number(payload.parentId) : null;
      let replyTo = typeof payload.replyTo === "string" ? payload.replyTo.trim().slice(0, NAME_MAX) : "";
      let target = null;
      if (parentId) {
        const parent = await db.prepare("SELECT id, path, parent_id, name, email FROM comments WHERE id = ?").bind(parentId).first();
        if (!parent || parent.path !== path) {
          parentId = null;
          replyTo = "";
        } else {
          if (parent.parent_id) parentId = parent.parent_id;
          target = replyTo
            ? await db
                .prepare("SELECT name, email FROM comments WHERE (id = ? OR parent_id = ?) AND name = ? AND email != '' ORDER BY id DESC LIMIT 1")
                .bind(parentId, parentId, replyTo)
                .first()
            : parent;
        }
      }

      const ipHash = await ipHashOf(request, env);
      if (!isOwner && (await isBlocked(db, { name, email, ipHash }))) return json({ error: "blocked" }, 403);

      // 同 IP 60 秒限速（站主不限）
      if (ipHash && !isOwner) {
        const last = await db.prepare("SELECT created_at FROM comments WHERE ip_hash = ? ORDER BY id DESC LIMIT 1").bind(ipHash).first();
        if (last && Date.now() - last.created_at < RATE_MS) return json({ error: "too fast" }, 429);
      }

      const status = !isOwner && env.COMMENT_MODERATION === "1" ? 2 : 0;
      const now = Date.now();
      const r = await db
        .prepare(
          `INSERT INTO comments (path, name, body, created_at, ip_hash, email, website, parent_id, reply_to, is_owner, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(path, name, body, now, ipHash, email, website, parentId, replyTo, isOwner, status)
        .run();

      // 异步通知：不拖慢响应，失败也不影响评论
      const job = notifyComment(env, url.origin, { path, name, body, email, replyTo, isOwner, pending: status === 2 }, status === 2 ? null : target);
      if (typeof waitUntil === "function") waitUntil(job);

      return json(
        { comment: { id: r.meta && r.meta.last_row_id, parent_id: parentId, name, body, website, reply_to: replyTo, is_owner: isOwner, created_at: now }, pending: status === 2 },
        201
      );
    }

    return json({ error: "method not allowed" }, 405);
  } catch (e) {
    console.error("[api]", e && e.stack ? e.stack : e);   // 写入 Cloudflare 日志，便于线上排错
    return json({ error: "server error" }, 500);
  }
}
