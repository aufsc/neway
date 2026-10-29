#!/usr/bin/env node
/**
 * 本地完整联调（不需要 Cloudflare 账号 / GitHub Token）：
 *   node --experimental-sqlite tools/local_admin.mjs [--port 5002] [--moderation]
 * 直接运行 functions/ 里的真实代码，并用本地资源模拟：
 *   D1     → .local/d1.sqlite        R2 → .local/r2/        GitHub → 本地 posts/ 目录（保存即写文件，需再 python build.py 才会更新静态页）
 * 需要 Node 22+。首个管理员的初始化口令默认 dev-setup（可用环境变量 ADMIN_SETUP_TOKEN 覆盖）。
 */
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const PORT = Number(arg("--port", 5002));
const DIST = path.join(ROOT, "dist");
const POSTS = path.join(ROOT, "posts");
const LOCAL = path.join(ROOT, ".local");
fs.mkdirSync(path.join(LOCAL, "r2"), { recursive: true });
fs.mkdirSync(POSTS, { recursive: true });

// ---------------------------------------------------------------- D1 替身
const raw = new DatabaseSync(path.join(LOCAL, "d1.sqlite"));
const stmt = (sql, args = []) => ({
  bind: (...a) => stmt(sql, a),
  run: async () => { const r = raw.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; },
  first: async () => raw.prepare(sql).get(...args) ?? null,
  all: async () => ({ results: raw.prepare(sql).all(...args) }),
});
const DB = { prepare: (s) => stmt(s), batch: async (list) => { for (const s of list) await s.run(); return []; } };

// ---------------------------------------------------------------- R2 替身
const r2path = (k) => path.join(LOCAL, "r2", ...k.split("/"));
const MEDIA = {
  put: async (k, buf, o) => {
    fs.mkdirSync(path.dirname(r2path(k)), { recursive: true });
    fs.writeFileSync(r2path(k), Buffer.from(buf));
    fs.writeFileSync(r2path(k) + ".type", (o.httpMetadata || {}).contentType || "");
  },
  get: async (k) => {
    if (!fs.existsSync(r2path(k))) return null;
    const buf = fs.readFileSync(r2path(k));
    return { body: buf, httpMetadata: { contentType: fs.readFileSync(r2path(k) + ".type", "utf8") }, etag: createHash("md5").update(buf).digest("hex") };
  },
  delete: async (k) => { for (const f of [r2path(k), r2path(k) + ".type"]) if (fs.existsSync(f)) fs.unlinkSync(f); },
};

// ---------------------------------------------------------------- GitHub 替身：把本地 posts/ 当作仓库
const sha = (buf) => createHash("sha1").update(buf).digest("hex");
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (!url.startsWith("https://api.github.com/")) return realFetch(url, opts);
  const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s });
  const m = url.match(/contents\/posts(?:\/([^?]+))?/);
  const name = m && m[1] && decodeURIComponent(m[1]);
  const file = name && path.join(POSTS, name);
  const method = opts.method || "GET";
  const body = opts.body ? JSON.parse(opts.body) : {};
  if (method === "GET" && !name) {
    return J(fs.readdirSync(POSTS).filter((f) => f.endsWith(".md")).map((f) => {
      const b = fs.readFileSync(path.join(POSTS, f)); return { type: "file", name: f, sha: sha(b), size: b.length };
    }));
  }
  if (method === "GET") { if (!fs.existsSync(file)) return J({}, 404); const b = fs.readFileSync(file); return J({ sha: sha(b), content: b.toString("base64") }); }
  if (method === "PUT") {
    if (fs.existsSync(file) && sha(fs.readFileSync(file)) !== body.sha) return J({}, 409);
    const b = Buffer.from(body.content, "base64"); fs.writeFileSync(file, b);
    return J({ content: { sha: sha(b) }, commit: { html_url: "#local-commit" } });
  }
  if (method === "DELETE") { if (fs.existsSync(file)) fs.unlinkSync(file); return J({ commit: { html_url: "#local-commit" } }); }
  return J({}, 400);
};

// ---------------------------------------------------------------- 环境变量
const env = {
  DB, MEDIA, ADMIN_SETUP_TOKEN: "dev-setup", GITHUB_TOKEN: "local", GITHUB_REPO: "local/local", OWNER_NAME: "new",
  OWNER_SECRET: "", ...process.env,
  ...(argv.includes("--moderation") ? { COMMENT_MODERATION: "1" } : {}),
};

// ---------------------------------------------------------------- 路由
const load = (f) => import(pathToFileURL(path.join(ROOT, "functions", f)).href);
const routes = [
  [/^\/api\/hit$/, "api/hit.js", () => ({})],
  [/^\/api\/comment$/, "api/comment.js", () => ({})],
  [/^\/api\/contact$/, "api/contact.js", () => ({})],
  [/^\/api\/admin\/(.+)$/, "api/admin/[[path]].js", (m) => ({ path: m[1].split("/").map(decodeURIComponent) })],
  [/^\/media\/(.+)$/, "media/[[key]].js", (m) => ({ key: m[1].split("/").map(decodeURIComponent) })],
];
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".xml": "application/xml", ".txt": "text/plain", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json" };

function serveStatic(pathname, res) {
  const clean = decodeURIComponent(pathname).replace(/\.\./g, "");
  const tries = [clean, clean + ".html", path.join(clean, "index.html")];
  for (const t of tries) {
    const f = path.join(DIST, t);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
      return res.end(fs.readFileSync(f));
    }
  }
  res.writeHead(404, { "content-type": "text/plain" }); res.end("not found");
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const hit = routes.map(([re, file, mk]) => [re.exec(url.pathname), file, mk]).find(([m]) => m);
  if (!hit) return serveStatic(url.pathname, res);
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = chunks.length && !["GET", "HEAD"].includes(req.method) ? Buffer.concat(chunks) : undefined;
  const request = new Request(url, { method: req.method, headers: req.headers, body });
  const jobs = [];
  try {
    const mod = await load(hit[1]);
    const out = await mod.onRequest({ request, env, params: hit[2](hit[0]), waitUntil: (p) => jobs.push(p) });
    const headers = {}; out.headers.forEach((v, k) => { if (k !== "set-cookie") headers[k] = v; });
    const cookies = out.headers.getSetCookie ? out.headers.getSetCookie() : [];
    if (cookies.length) headers["set-cookie"] = cookies;
    res.writeHead(out.status, headers); res.end(Buffer.from(await out.arrayBuffer()));
  } catch (e) { console.error(e); res.writeHead(500); res.end("dev server error"); }
  Promise.allSettled(jobs);
}).listen(PORT, "127.0.0.1", () => {
  console.log(`✅ 本地 Cloudflare 模拟已启动 http://127.0.0.1:${PORT}`);
  console.log(`   管理后台  http://127.0.0.1:${PORT}/admin   （首个管理员初始化口令：${env.ADMIN_SETUP_TOKEN}）`);
  console.log(`   D1 → .local/d1.sqlite   R2 → .local/r2/   “GitHub” → posts/（保存后重新 python build.py 查看静态页）`);
});
