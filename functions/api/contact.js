/**
 * 联系页留言（Cloudflare Pages Functions + D1）
 *   POST /api/contact { name, email, subject?, body, website? }  → { ok: true }
 *
 * 流程：校验 → 蜜罐/限速 → 写入 D1（不丢信）→ 发邮件给站长（reply-to=访客邮箱）+ 机器人通知。
 * 邮件与机器人都没配置 / 都失败时返回 502，前端会提示改用邮件客户端；留言仍保存在 D1 的 messages 表。
 */
import { json, cleanMail, sameOrigin, ipHashOf, ensureSchema, isBlocked, NAME_MAX, recordGeo } from "../_lib/common.js";
import { notifyMessage } from "../_lib/notify.js";

const BODY_MAX = 3000;
const SUBJECT_MAX = 100;
const RATE_MS = 60 * 1000;
const DAILY_MAX = 5;

export async function onRequest({ request, env }) {
  const db = env.DB;
  if (!db) return json({ error: "未绑定 D1 数据库（变量名需为 DB）" }, 500);
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);

  try {
    await ensureSchema(db);

    let p;
    try { p = await request.json(); } catch { return json({ error: "bad request" }, 400); }
    if (!p || typeof p !== "object") return json({ error: "bad request" }, 400);

    // 蜜罐：机器人会填隐藏字段。假装成功，不入库不通知
    if (typeof p.website === "string" && p.website.trim()) return json({ ok: true });

    const name = typeof p.name === "string" ? p.name.trim() : "";
    const email = cleanMail(p.email);
    const subject = typeof p.subject === "string" ? p.subject.trim().slice(0, SUBJECT_MAX) : "";
    const body = typeof p.body === "string" ? p.body.trim() : "";
    if (!name || name.length > NAME_MAX) return json({ error: "bad name" }, 400);
    if (!email) return json({ error: "bad email" }, 400);
    if (!body || body.length > BODY_MAX) return json({ error: "bad body" }, 400);

    const ipHash = await ipHashOf(request, env);
    if (await isBlocked(db, { email, ipHash })) return json({ ok: true });   // 黑名单：假装成功，不入库不通知
    const now = Date.now();
    if (ipHash) {
      const last = await db.prepare("SELECT created_at FROM messages WHERE ip_hash = ? ORDER BY id DESC LIMIT 1").bind(ipHash).first();
      if (last && now - last.created_at < RATE_MS) return json({ error: "too fast" }, 429);
      const day = await db.prepare("SELECT COUNT(*) AS n FROM messages WHERE ip_hash = ? AND created_at > ?").bind(ipHash, now - 86400000).first();
      if (day && day.n >= DAILY_MAX) return json({ error: "too fast" }, 429);
    }

    const r = await db
      .prepare("INSERT INTO messages (name, email, subject, body, created_at, ip_hash) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(name, email, subject, body, now, ipHash)
      .run();

    await recordGeo(db, request, { path: "/contact", kind: "message" });

    const { mailed, bots } = await notifyMessage(env, { name, email, subject, body });
    const notified = mailed || (Array.isArray(bots) && bots.length > 0);   // 任一渠道成功即算已通知
    if (notified) {
      try { await db.prepare("UPDATE messages SET mailed = 1 WHERE id = ?").bind(r.meta.last_row_id).run(); } catch (e) {}
    }
    if (!notified) return json({ error: "notify not configured" }, 502);
    return json({ ok: true, mailed, bots });
  } catch (e) {
    console.error("[api]", e && e.stack ? e.stack : e);   // 写入 Cloudflare 日志，便于线上排错
    return json({ error: "server error" }, 500);
  }
}