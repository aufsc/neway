/**
 * 访客统计（Cloudflare Pages Functions + D1）
 *   POST /api/hit   {path, vid}  → 计数并返回 {pv, uv, page_pv}
 *   GET  /api/hit?path=/xxx      → 只读取，不计数
 * 访客只记录浏览器里随机生成的匿名 ID，不含任何个人信息。
 */
import { json, normPath, sameOrigin, ensureSchema } from "../_lib/common.js";

async function readStats(db, path) {
  const { results } = await db
    .prepare("SELECT k, v FROM stats WHERE k IN ('pv', 'uv', ?)")
    .bind("p:" + path)
    .all();
  const m = Object.fromEntries(results.map((r) => [r.k, r.v]));
  return { pv: m.pv || 0, uv: m.uv || 0, page_pv: m["p:" + path] || 0 };
}

export async function onRequest({ request, env }) {
  const db = env.DB;
  if (!db) return json({ error: "未绑定 D1 数据库（变量名需为 DB）" }, 500);
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);

  try {
    await ensureSchema(db);

    if (request.method === "GET") {
      const path = normPath(new URL(request.url).searchParams.get("path") || "/");
      if (!path) return json({ error: "bad path" }, 400);
      return json(await readStats(db, path));
    }

    if (request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
      const path = normPath(body && body.path);
      if (!path) return json({ error: "bad path" }, 400);
      const vid = typeof body.vid === "string" && /^[\w-]{8,64}$/.test(body.vid) ? body.vid : null;

      const inc = "INSERT INTO stats (k, v) VALUES (?, 1) ON CONFLICT(k) DO UPDATE SET v = v + 1";
      const stmts = [db.prepare(inc).bind("pv"), db.prepare(inc).bind("p:" + path)];
      if (vid) {
        const r = await db.prepare("INSERT OR IGNORE INTO visitors (id) VALUES (?)").bind(vid).run();
        if (r.meta && r.meta.changes > 0) stmts.push(db.prepare(inc).bind("uv")); // 新访客
      }
      await db.batch(stmts);
      return json(await readStats(db, path));
    }

    return json({ error: "method not allowed" }, 405);
  } catch (e) {
    console.error("[api]", e && e.stack ? e.stack : e);   // 写入 Cloudflare 日志，便于线上排错
    return json({ error: "server error" }, 500);
  }
}
