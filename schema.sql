-- D1 表结构。接口首次请求时会自动建表；也可以手动执行：
--   npx wrangler d1 execute blog-db --remote --file=schema.sql      （线上）
--   npx wrangler d1 execute blog-db --local  --file=schema.sql      （wrangler pages dev 本地）
CREATE TABLE IF NOT EXISTS stats    (k TEXT PRIMARY KEY, v INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS visitors (id TEXT PRIMARY KEY);

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
  is_owner   INTEGER NOT NULL DEFAULT 0,
  status     INTEGER NOT NULL DEFAULT 0      -- 0 公开 1 隐藏 2 待审核
);
CREATE INDEX IF NOT EXISTS idx_comments_path   ON comments (path, id DESC);
CREATE INDEX IF NOT EXISTS idx_comments_ip     ON comments (ip_hash);
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

-- ---------------------------------------------------------------- 管理后台
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor', disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, last_login INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, admin_id INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_fails (ip_hash TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, type TEXT NOT NULL,
  size INTEGER NOT NULL, created_at INTEGER NOT NULL, admin_id INTEGER
);
CREATE TABLE IF NOT EXISTS blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, value TEXT NOT NULL, note TEXT,
  created_at INTEGER NOT NULL, UNIQUE(kind, value)
);
CREATE TABLE IF NOT EXISTS post_index (
  name TEXT PRIMARY KEY, sha TEXT, title TEXT, date TEXT, category TEXT, tags TEXT, cover TEXT, updated_at INTEGER
);
-- 旧库升级（已有 comments 表时执行一次；重复执行会报 duplicate column，可忽略）：
-- ALTER TABLE comments ADD COLUMN status INTEGER NOT NULL DEFAULT 0;
