#!/usr/bin/env python3
"""本地联调用的 D1 替身（不依赖 wrangler / Cloudflare）

在 dist/ 静态服务之上，复刻 functions/api/ 下的 /api/hit、/api/comment、/api/contact：
- 路径归一化、字段校验、Origin 校验、同 IP 60 秒限速（站主不限速）
- 一级回复（parent_id / reply_to）
- 站主识别（token 与 --owner-secret 或环境变量 OWNER_SECRET 一致 → is_owner=1，昵称强制为 --owner-name）
- 联系页留言 /api/contact（蜜罐、限速、入库）；"通知"只打印到控制台，不会真的发邮件
- 保留昵称（admin / 博主 等，站主可用）
- 首次请求自动建表

用法：
    python local_api.py                       # http://127.0.0.1:5000
    python local_api.py --port 5000 --clean
    python local_api.py --owner-name new --owner-secret 你的口令
    $env:OWNER_SECRET="S1hH..." ; python local_api.py
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import re
import sqlite3
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

BASE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(BASE, "dist")

PATH_RE = re.compile(r"^/[A-Za-z0-9_\-.%~/]{0,190}$")
NAME_MAX, BODY_MAX, MAIL_MAX, SITE_MAX = 40, 2000, 120, 200
RATE_MS, LIST_MAX = 60 * 1000, 200

RESERVED = {
    "admin", "administrator", "root", "moderator", "mod", "webmaster",
    "owner", "support", "official", "team", "null", "undefined",
    "博主", "站长", "管理员", "版主", "官方", "客服", "系统",
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS stats (
  k TEXT PRIMARY KEY,
  v INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS visitors (
  id TEXT PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  path       TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  body       TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  ip_hash    TEXT,
  email      TEXT,
  website    TEXT,
  parent_id  INTEGER,
  reply_to   TEXT,
  is_owner   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_comments_path ON comments (path, id DESC);
CREATE INDEX IF NOT EXISTS idx_comments_ip   ON comments (ip_hash);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments (parent_id);
CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  email      TEXT    NOT NULL,
  subject    TEXT,
  body       TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  ip_hash    TEXT,
  mailed     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_messages_ip ON messages (ip_hash);
"""


# ---------------------------------------------------------------- 工具函数
def norm_path(value):
    """与 functions/api/*.js 的 normPath() 规则一致。"""
    if not isinstance(value, str):
        return None
    p = re.split(r"[?#]", value)[0]
    p = re.sub(r"\.html$", "", p)
    p = re.sub(r"/index$", "/", p)
    if len(p) > 1:
        p = re.sub(r"/+$", "", p)
    if not PATH_RE.match(p) or ".." in p:
        return None
    return p


def clean_mail(value):
    if not isinstance(value, str):
        return ""
    s = value.strip()
    return s if s and len(s) <= MAIL_MAX and re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", s) else ""


def clean_site(value):
    if not isinstance(value, str):
        return ""
    s = value.strip()
    return s if s and len(s) <= SITE_MAX and re.match(r"^https?://\S+$", s, re.I) else ""


def is_reserved(name):
    return re.sub(r"[\s_.\-·]+", "", str(name).strip().lower()) in RESERVED


def ip_hash_of(ip):
    return hashlib.sha1(ip.encode("utf-8")).hexdigest() if ip else ""


# ---------------------------------------------------------------- 数据访问
def connect(db_path):
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    conn.commit()
    return conn


def read_stats(conn, path):
    rows = conn.execute(
        "SELECT k, v FROM stats WHERE k IN ('pv', 'uv', ?)", ("p:" + path,)
    ).fetchall()
    m = {r["k"]: r["v"] for r in rows}
    return {"pv": m.get("pv", 0), "uv": m.get("uv", 0), "page_pv": m.get("p:" + path, 0)}


def bump(conn, key):
    conn.execute(
        "INSERT INTO stats (k, v) VALUES (?, 1) ON CONFLICT(k) DO UPDATE SET v = v + 1",
        (key,),
    )


# ---------------------------------------------------------------- HTTP
class Handler(SimpleHTTPRequestHandler):
    conn: sqlite3.Connection
    lock = threading.Lock()
    owner_secret = ""
    owner_name = "new"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST, **kwargs)

    # -- 基础工具 --------------------------------------------------
    def _json(self, code, payload):
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def _payload(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(n) if n > 0 else b"{}"
            data = json.loads(raw.decode("utf-8") or "{}")
            return data if isinstance(data, dict) else None
        except Exception:
            return None

    def _origin_ok(self):
        origin = self.headers.get("Origin")
        if not origin:
            return True
        host = self.headers.get("Host") or ""
        return origin in (f"http://{host}", f"https://{host}")

    def _ip_hash(self):
        ip = (self.headers.get("CF-Connecting-IP") or "").strip()
        return ip_hash_of(ip)

    def _is_owner(self, token):
        if not self.owner_secret or not token:
            return 0
        return 1 if hmac.compare_digest(str(token), self.owner_secret) else 0

    def log_message(self, fmt, *args):
        print("[api] " + (fmt % args), flush=True)

    # -- 路由 ------------------------------------------------------
    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/api/hit":
            return self.hit_get(url)
        if url.path == "/api/comment":
            return self.comment_get(url)
        return super().do_GET()

    def do_POST(self):
        url = urlparse(self.path)
        if url.path == "/api/hit":
            return self.hit_post()
        if url.path == "/api/comment":
            return self.comment_post()
        if url.path == "/api/contact":
            return self.contact_post()
        return super().do_POST()

    # -- /api/hit --------------------------------------------------
    def hit_get(self, url):
        if not self._origin_ok():
            return self._json(403, {"error": "forbidden"})
        path = norm_path(parse_qs(url.query).get("path", ["/"])[0])
        if not path:
            return self._json(400, {"error": "bad path"})
        with self.lock:
            return self._json(200, read_stats(self.conn, path))

    def hit_post(self):
        if not self._origin_ok():
            return self._json(403, {"error": "forbidden"})
        body = self._payload()
        if body is None:
            return self._json(400, {"error": "bad request"})
        path = norm_path(body.get("path"))
        if not path:
            return self._json(400, {"error": "bad path"})
        vid = body.get("vid")
        if not (isinstance(vid, str) and re.fullmatch(r"[\w-]{8,64}", vid)):
            vid = None
        with self.lock:
            bump(self.conn, "pv")
            bump(self.conn, "p:" + path)
            if vid:
                cur = self.conn.execute("INSERT OR IGNORE INTO visitors (id) VALUES (?)", (vid,))
                if cur.rowcount > 0:
                    bump(self.conn, "uv")
            self.conn.commit()
            return self._json(200, read_stats(self.conn, path))

    # -- /api/comment ----------------------------------------------
    def comment_get(self, url):
        if not self._origin_ok():
            return self._json(403, {"error": "forbidden"})
        qs = parse_qs(url.query)
        path = norm_path(qs.get("path", ["/"])[0])
        if not path:
            return self._json(400, {"error": "bad path"})
        try:
            limit = int(qs.get("limit", ["200"])[0])
        except ValueError:
            limit = 200
        limit = min(max(limit, 1), LIST_MAX)
        with self.lock:
            rows = self.conn.execute(
                """SELECT id, parent_id, name, body, website, reply_to, is_owner, created_at
                     FROM (SELECT * FROM comments WHERE path = ? ORDER BY id DESC LIMIT ?)
                    ORDER BY id ASC""",
                (path, limit),
            ).fetchall()
            return self._json(200, {"comments": [dict(r) for r in rows]})

    def comment_post(self):
        if not self._origin_ok():
            return self._json(403, {"error": "forbidden"})
        payload = self._payload()
        if payload is None:
            return self._json(400, {"error": "bad request"})

        path = norm_path(payload.get("path"))
        if not path:
            return self._json(400, {"error": "bad path"})

        raw_name = payload.get("name").strip() if isinstance(payload.get("name"), str) else ""
        body = payload.get("body").strip() if isinstance(payload.get("body"), str) else ""

        # 先判站主：站主昵称强制为预设名，不校验昵称、不受保留名限制
        token = payload.get("token") if isinstance(payload.get("token"), str) else ""
        is_owner = self._is_owner(token[:200])
        name = self.owner_name if is_owner else raw_name
        if not is_owner and (not name or len(name) > NAME_MAX):
            return self._json(400, {"error": "bad name"})
        if not is_owner and is_reserved(name):
            return self._json(400, {"error": "reserved name"})
        if not body or len(body) > BODY_MAX:
            return self._json(400, {"error": "bad body"})

        email = clean_mail(payload.get("email"))
        website = clean_site(payload.get("website"))

        # 一级回复
        parent_id = None
        raw_parent = payload.get("parentId")
        if isinstance(raw_parent, int) and raw_parent > 0:
            parent_id = raw_parent
        elif isinstance(raw_parent, str) and raw_parent.isdigit():
            parent_id = int(raw_parent)
        reply_to = payload.get("replyTo").strip()[:NAME_MAX] if isinstance(payload.get("replyTo"), str) else ""

        ip_hash = self._ip_hash()
        now = int(time.time() * 1000)

        with self.lock:
            if parent_id:
                parent = self.conn.execute(
                    "SELECT id, path, parent_id FROM comments WHERE id = ?", (parent_id,)
                ).fetchone()
                if not parent or parent["path"] != path:
                    parent_id, reply_to = None, ""
                elif parent["parent_id"]:
                    parent_id = parent["parent_id"]

            if ip_hash and not is_owner:
                last = self.conn.execute(
                    "SELECT created_at FROM comments WHERE ip_hash = ? ORDER BY id DESC LIMIT 1",
                    (ip_hash,),
                ).fetchone()
                if last and now - last["created_at"] < RATE_MS:
                    return self._json(429, {"error": "too fast"})

            cur = self.conn.execute(
                """INSERT INTO comments
                   (path, name, body, created_at, ip_hash, email, website, parent_id, reply_to, is_owner)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (path, name, body, now, ip_hash, email, website, parent_id, reply_to, is_owner),
            )
            self.conn.commit()
            if not is_owner:
                print(f"[notify] 💬 新评论 {path} by {name}: {body[:60]!r}（线上会发邮件/机器人）", flush=True)
            return self._json(201, {
                "comment": {
                    "id": cur.lastrowid,
                    "parent_id": parent_id,
                    "name": name,
                    "body": body,
                    "website": website,
                    "reply_to": reply_to,
                    "is_owner": is_owner,
                    "created_at": now,
                }
            })


# ---------------------------------------------------------------- /api/contact
def _contact_post(self):
    if not self._origin_ok():
        return self._json(403, {"error": "forbidden"})
    p = self._payload()
    if p is None:
        return self._json(400, {"error": "bad request"})
    if isinstance(p.get("website"), str) and p["website"].strip():      # 蜜罐
        return self._json(200, {"ok": True})

    def text(key, limit):
        v = p.get(key)
        return v.strip()[:limit] if isinstance(v, str) else ""

    name, email, subject = text("name", 10_000), clean_mail(p.get("email")), text("subject", 100)
    body = text("body", 10_000)
    if not name or len(name) > NAME_MAX:
        return self._json(400, {"error": "bad name"})
    if not email:
        return self._json(400, {"error": "bad email"})
    if not body or len(body) > 3000:
        return self._json(400, {"error": "bad body"})

    ip_hash, now = self._ip_hash(), int(time.time() * 1000)
    with self.lock:
        if ip_hash:
            last = self.conn.execute(
                "SELECT created_at FROM messages WHERE ip_hash = ? ORDER BY id DESC LIMIT 1", (ip_hash,)
            ).fetchone()
            if last and now - last["created_at"] < RATE_MS:
                return self._json(429, {"error": "too fast"})
        self.conn.execute(
            "INSERT INTO messages (name, email, subject, body, created_at, ip_hash) VALUES (?, ?, ?, ?, ?, ?)",
            (name, email, subject, body, now, ip_hash),
        )
        self.conn.commit()
    print(f"[notify] ✉️ 新留言 {name} <{email}> {subject!r}: {body[:60]!r}（线上会发邮件/机器人）", flush=True)
    return self._json(200, {"ok": True, "mailed": False, "bots": []})


Handler.contact_post = _contact_post


# ---------------------------------------------------------------- 入口
def main():
    ap = argparse.ArgumentParser(description="本地 D1 替身：/api/hit 与 /api/comment")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=5000)
    ap.add_argument("--db", default=os.path.join(BASE, "local_api.sqlite3"))
    ap.add_argument("--owner-secret", default=os.environ.get("OWNER_SECRET", ""),
                    help="站主口令；不传则读环境变量 OWNER_SECRET")
    ap.add_argument("--owner-name", default=os.environ.get("OWNER_NAME", "new"), help="站主评论显示名")
    ap.add_argument("--clean", action="store_true", help="启动前清空本地库")
    args = ap.parse_args()

    if not os.path.isdir(DIST):
        raise SystemExit(f"缺少 {DIST}/，先运行 python build.py")

    if args.clean and os.path.exists(args.db):
        os.remove(args.db)
        print(f"已清空本地库：{args.db}")

    Handler.conn = connect(args.db)
    Handler.owner_secret = args.owner_secret.strip()
    Handler.owner_name = (args.owner_name.strip() or "new")[:NAME_MAX]
    ThreadingHTTPServer.daemon_threads = True
    srv = ThreadingHTTPServer((args.host, args.port), Handler)

    print(f"✅ 本地假后端已启动 http://{args.host}:{args.port}")
    print(f"   静态目录 {DIST}")
    print(f"   数据库   {args.db}")
    print(f"   站主口令 {'已设置（' + str(len(Handler.owner_secret)) + ' 位）' if Handler.owner_secret else '未设置（无人能拿到博主徽章）'}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
    finally:
        srv.server_close()


if __name__ == "__main__":
    main()