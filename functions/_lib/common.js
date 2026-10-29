/**
 * 三个接口共用的工具：响应、校验、哈希、建表。
 * 注意：Pages Functions 只会把 export 了 onRequest* 的文件当作路由，本文件不会暴露为接口。
 */
export const PATH_RE = /^\/[A-Za-z0-9_\-.%~\/]{0,190}$/;
export const NAME_MAX = 40;
export const MAIL_MAX = 120;

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

/** "/about.html"、"/about"、"/about/" → "/about"；"/index.html" → "/" */
export function normPath(p) {
  if (typeof p !== "string") return null;
  p = p.split(/[?#]/)[0].replace(/\.html$/, "").replace(/\/index$/, "/");
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return PATH_RE.test(p) && !p.includes("..") ? p : null;
}

export function cleanMail(v) {
  if (typeof v !== "string") return "";
  const s = v.trim();
  return s && s.length <= MAIL_MAX && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : "";
}

export function cleanSite(v) {
  if (typeof v !== "string") return "";
  const s = v.trim();
  return s && s.length <= 200 && /^https?:\/\/[^\s]+$/i.test(s) ? s : "";
}

async function digest(algo, text) {
  const buf = await crypto.subtle.digest(algo, new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export const sha1 = (t) => digest("SHA-1", t);
export const sha256 = (t) => digest("SHA-256", t);

/** 常量时间比较（先哈希成等长串，避免泄露口令长度） */
export async function secretEquals(a, b) {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/** 同源校验：浏览器发来的跨站请求直接拒绝 */
export function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function ipHashOf(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "";
  return ip ? sha1((env.IP_SALT || "") + ip) : "";
}

/** 归属地（Cloudflare request.cf），不涉及 IP */
export function geoOf(request) {
  const cf = request.cf || {};
  return {
    country: cf.country || "",
    region: cf.region || "",
    city: cf.city || "",
    asn: cf.asn ? Number(cf.asn) : 0,
    org: cf.asOrganization || "",
  };
}

/** 累加来源计数 + 写一条访问明细（不存 IP） */
export async function recordGeo(db, request, meta = {}) {
  const g = geoOf(request);
  if (!g.country && !g.city) return;                // 本地开发没有 request.cf
  const now = Date.now();
  try {
    await db.prepare(
      `INSERT INTO geo_stats (country, region, city, asn, org, hits, last_seen)
       VALUES (?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(country, region, city, asn) DO UPDATE SET
         hits = geo_stats.hits + 1, last_seen = excluded.last_seen`
    ).bind(g.country, g.region, g.city, g.asn, g.org, now).run();

    await db.prepare(
      "INSERT INTO visit_log (created_at, country, region, city, path, kind) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(now, g.country, g.region, g.city, String(meta.path || "").slice(0, 190), String(meta.kind || "hit").slice(0, 16)).run();

    // 只保留最近 5000 条，避免无限增长
    if (Math.random() < 0.02) {
      await db.prepare("DELETE FROM visit_log WHERE id <= (SELECT MAX(id) - 5000 FROM visit_log)").run();
    }
  } catch (e) { /* 统计失败不影响主流程 */ }
}

export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** 建表（首次请求时执行一次；也可以用 schema.sql 手动执行） */
let ready = false;
export async function ensureSchema(db) {
  if (ready) return;
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS stats (k TEXT PRIMARY KEY, v INTEGER NOT NULL DEFAULT 0)"),
    db.prepare("CREATE TABLE IF NOT EXISTS visitors (id TEXT PRIMARY KEY)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL, name TEXT NOT NULL, body TEXT NOT NULL,
      created_at INTEGER NOT NULL, ip_hash TEXT, email TEXT, website TEXT,
      parent_id INTEGER, reply_to TEXT, is_owner INTEGER NOT NULL DEFAULT 0)`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_comments_path ON comments (path, id DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_comments_ip ON comments (ip_hash)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments (parent_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL, subject TEXT,
      body TEXT NOT NULL, created_at INTEGER NOT NULL, ip_hash TEXT, mailed INTEGER NOT NULL DEFAULT 0)`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_messages_ip ON messages (ip_hash)"),
    // ---- 管理后台 ----
    db.prepare(`CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'editor', disabled INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, last_login INTEGER)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, admin_id INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`),
    db.prepare("CREATE TABLE IF NOT EXISTS login_fails (ip_hash TEXT NOT NULL, ts INTEGER NOT NULL)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS media (
      id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, type TEXT NOT NULL,
      size INTEGER NOT NULL, created_at INTEGER NOT NULL, admin_id INTEGER)`),
    db.prepare("CREATE TABLE IF NOT EXISTS media_dirs (name TEXT PRIMARY KEY, created_at INTEGER NOT NULL)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, value TEXT NOT NULL, note TEXT,
      created_at INTEGER NOT NULL, UNIQUE(kind, value))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS post_index (
      name TEXT PRIMARY KEY, sha TEXT, title TEXT, date TEXT, category TEXT, tags TEXT, cover TEXT, updated_at INTEGER)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS geo_stats (
      country TEXT NOT NULL DEFAULT '', region TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '', asn INTEGER NOT NULL DEFAULT 0,
      org TEXT NOT NULL DEFAULT '', hits INTEGER NOT NULL DEFAULT 0,
      last_seen INTEGER NOT NULL, PRIMARY KEY (country, region, city, asn))`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_geo_hits ON geo_stats (hits DESC)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS visit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL,
      country TEXT NOT NULL DEFAULT '', region TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '',
      path TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'hit')`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_visit_time ON visit_log (created_at DESC)"),
  ]);
  // 兼容旧库：缺列时补列（已存在会报错，忽略即可）
  for (const sql of [
    "ALTER TABLE comments ADD COLUMN email TEXT",
    "ALTER TABLE comments ADD COLUMN website TEXT",
    "ALTER TABLE comments ADD COLUMN parent_id INTEGER",
    "ALTER TABLE comments ADD COLUMN reply_to TEXT",
    "ALTER TABLE comments ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE comments ADD COLUMN status INTEGER NOT NULL DEFAULT 0", // 0 公开 1 隐藏 2 待审核
  ]) {
    try { await db.prepare(sql).run(); } catch (e) { }
  }
  ready = true;
}

/** 黑名单检查：昵称 / 邮箱（小写）/ IP 哈希 任一命中即拦截 */
export async function isBlocked(db, { name = "", email = "", ipHash = "" }) {
  const vals = [["name", String(name).trim().toLowerCase()], ["email", String(email).trim().toLowerCase()], ["ip", ipHash]]
    .filter(([, v]) => v);
  if (!vals.length) return false;
  const where = vals.map(() => "(kind = ? AND value = ?)").join(" OR ");
  const row = await db.prepare(`SELECT 1 AS hit FROM blocks WHERE ${where} LIMIT 1`).bind(...vals.flat()).first();
  return !!row;
}