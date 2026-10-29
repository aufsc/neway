# new way 博客：配置、本地测试与部署指南

静态博客（Python 构建）+ Cloudflare Pages Functions + D1（评论 / 访客统计 / 联系留言）。
> **不想在本地运行任何程序？** 直接看 [`DEPLOY_NO_LOCAL.md`](DEPLOY_NO_LOCAL.md)：从注册账号到上线验证的逐步操作。

评论、留言支持**邮件**与**机器人**（Telegram / Server酱 / 企业微信 / 飞书 / 钉钉 / Discord）通知。

---

## 0. 项目结构

```
├── build.py               构建脚本：posts/*.md → dist/
├── site.json              站点配置（名称、域名、邮箱、作者卡片…）
├── requirements.txt       Python 依赖
├── schema.sql             D1 表结构（接口首次请求也会自动建表）
├── wrangler.toml          Cloudflare Pages / D1 / 变量配置
├── local_api.py           本地假后端（评论 / 统计 / 留言，不依赖 Cloudflare）
├── tools/local_admin.mjs  本地完整模拟（含管理后台、R2、GitHub），需 Node 22+
├── .dev.vars.example      wrangler 本地调试用的密钥模板
├── posts/                 Markdown 文章（文件名以 _ 开头 = 草稿）
├── templates/             Jinja2 模板
├── static/
│   ├── css/               样式分模块，构建时按文件名合并成 style.css
│   │   ├── 00-tokens.css  配色令牌 · 重置 · 全站背景
│   │   ├── 10-glass.css   液体玻璃（.glass / .glass-soft）
│   │   ├── 20-layout.css  导航 · 页脚 · 通用组件
│   │   ├── 30-index.css   首页（个人信息卡 / 分类 / 词云）
│   │   ├── 40-pages.css   关于 / 分类 / 联系
│   │   ├── 50-post.css    文章页（正文保持实心，不做玻璃）
│   │   └── 60-comments.css
│   ├── main.js index.js post.js comments.js contact.js admin.js
│   ├── themes/            背景 / 头像候选（make_variants.py 生成，不会进入 dist）
│   └── logo.svg avatar.svg bg-light.svg bg-dark.svg   new way 品牌素材
├── tools/make_assets.py   重新生成默认品牌 SVG
├── tools/make_variants.py 生成多款背景 / 头像候选与 gallery.html
├── functions/
│   ├── _lib/common.js     公共工具（校验、哈希、建表）
│   ├── _lib/notify.js     通知：邮件 + 机器人
│   ├── api/hit.js comment.js contact.js
│   ├── api/admin/[[path]].js   管理后台 API 路由
│   └── media/[[key]].js        公开读取 R2 图片（/media/…）
└── .github/workflows/deploy.yml   可选：GitHub Actions 部署
```

---

## 1. 需要修改的配置

### 1.1 `site.json`

| 字段 | 说明 |
| --- | --- |
| `name` / `description` | 站名、一句话简介 |
| `domain` / `url` | 域名、完整地址（`https://xxxx.org`，用于 RSS / sitemap，没有就留空） |
| `logo` / `avatar` | 导航栏 logo、首页个人卡头像 |
| `email` / `email_feedback` / `email_help` | 首页卡片、联系页、文章页显示的邮箱 |
| `github` | GitHub 主页，留空则不显示 |
| `start_date` | 建站日期，页脚“已运行 N 天” |
| `owner_name` / `owner_avatar` | 站主评论显示名与头像（须与环境变量 `OWNER_NAME` 一致） |
| `author.name / bio / motto` | 首页个人信息卡的名字、简介、格言 |

### 1.2 环境变量 / 密钥

Cloudflare 上配置；本地写进 `.dev.vars`。

| 名称 | 类型 | 必填 | 作用 |
| --- | --- | --- | --- |
| `DB` | D1 绑定 | 是 | 变量名必须叫 `DB` |
| `OWNER_SECRET` | Secret | 建议 | 站主口令，用于识别站主评论 |
| `OWNER_NAME` | 变量 | 否 | 站主显示名，默认 `new` |
| `IP_SALT` | Secret | 建议 | IP 哈希加盐，任意随机字符串 |
| `SITE_NAME` | 变量 | 否 | 通知邮件里的站名 |
| `RESEND_API_KEY` | Secret | 邮件必填 | Resend API Key |
| `MAIL_FROM` | **Secret** | 邮件必填 | 发件人，如 `new way <noreply@xxxx.org>` |
| `NOTIFY_EMAIL` | **Secret** | 邮件必填 | 收评论通知的邮箱 |
| `CONTACT_TO` | **Secret** | 否 | 联系页留言收件箱，缺省用 `NOTIFY_EMAIL` |
| `REPLY_NOTIFY` | 变量 | 否 | 设为 `0` 则不给被回复的访客发邮件 |
| `COMMENT_MODERATION` | 变量 | 否 | 设为 `1`：游客评论先进入“待审核”，后台通过后才公开 |
| `TG_BOT_TOKEN` / `TG_CHAT_ID` | Secret / 变量 | 否 | Telegram 机器人 |
| `SERVERCHAN_KEY` | Secret | 否 | Server酱 Turbo SendKey（推送到微信） |
| `WEBHOOK_URL` / `WEBHOOK_TYPE` | Secret / 变量 | 否 | 企业微信 / 飞书 / 钉钉 / Discord / 通用 JSON |

管理后台相关变量（`MEDIA`、`GITHUB_*`、`ADMIN_SETUP_TOKEN` 等）见 **第 10 章**。

> 邮件和各机器人**相互独立**，配了哪个就发哪个；全都不配，评论照常可用，只是没有通知。

---

## 2. 本地测试

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python build.py                    # 输出到 dist/
```

### 方式 A：`local_api.py`（最快，无需 Cloudflare 账号）

```bash
python local_api.py --owner-secret 随便一个口令 --owner-name new
# 打开 http://127.0.0.1:5000
```

- 评论、统计、留言写入本地 `local_api.sqlite3`；加 `--clean` 可清空。
- 站主评论：打开 `http://127.0.0.1:5000/post/xxx.html?owner=随便一个口令` 一次，之后该浏览器发的评论带“new”徽章与站主头像。
- “通知”只打印到控制台（`[notify] …`），不会真的发邮件。

### 方式 B：`wrangler pages dev`（跑真正的 Functions 代码，可测真实通知）

```bash
cp .dev.vars.example .dev.vars     # 填 OWNER_SECRET；要测通知就填 RESEND / TG 等
npx wrangler d1 execute blog-db --local --file=schema.sql
npx wrangler pages dev dist        # http://localhost:8788
```

本地 D1 数据存在 `.wrangler/`，与线上互不影响。

### 自测清单

- [ ] 首页：个人信息卡、分类、词云正常；点分类可筛选，再点一次取消
- [ ] 明 / 暗主题切换正常，背景与玻璃效果随之变化
- [ ] 文章页：目录高亮、图片放大、检查列表可勾选
- [ ] 评论：游客评论、回复、站主评论（带徽章）
- [ ] 联系页：提交后提示“已发送”

---

## 3. 上传到 GitHub

```bash
git init
git add .
git commit -m "init: new way blog"
git branch -M main
git remote add origin https://github.com/你的用户名/你的仓库.git
git push -u origin main
```

`.gitignore` 已排除 `dist/`、`.dev.vars`、`.wrangler/`、`local_api.sqlite3`。
**不要把任何密钥提交到仓库**，密钥只放 Cloudflare 的 Secret。

---

## 4. Cloudflare：创建 D1 数据库

1. Cloudflare 控制台 → **Storage & Databases → D1 SQL Database → Create database**，名称 `blog-db`。
2. 复制 **Database ID**，填入 `wrangler.toml` 的 `database_id`。
3. 建表（二选一，也可跳过，接口首次被请求时会自动建表）：
   - 数据库页面的 **Console** 粘贴 `schema.sql` 内容执行；
   - 或 `npx wrangler login` 后执行 `npx wrangler d1 execute blog-db --remote --file=schema.sql`。

---

## 5. Cloudflare Pages 部署

### 方案 A（推荐）：Pages 直接连接 GitHub，推送即部署

1. **Workers & Pages → Create → Pages → Connect to Git**，选择仓库。
2. 构建设置：

   | 项 | 值 |
   | --- | --- |
   | Framework preset | None |
   | Build command | `pip install -r requirements.txt && python build.py` |
   | Build output directory | `dist` |

3. 在 **Environment variables** 添加 `PYTHON_VERSION = 3.12`，点 **Save and Deploy**。
4. 确认 D1 已绑定为 `DB`（**Settings → Bindings**）：
   - 仓库里有 `wrangler.toml`（已提供）时，绑定与普通变量以该文件为准；
   - 不想用文件管理：删掉 `wrangler.toml` 中的 `[[d1_databases]]` 和 `[vars]`，改在面板 **Bindings** 添加 **D1 database**（Variable name 填 `DB`），变量在 **Variables and Secrets** 添加。
5. 在 **Settings → Variables and Secrets** 添加密钥（见第 6 步），然后到 **Deployments** 点 **Retry deployment** 使配置生效。
6. **Custom domains** 绑定你的域名。

### 方案 B：GitHub Actions 直传

1. Cloudflare 创建 API Token（权限：Account → Cloudflare Pages → Edit），记下 Account ID。
2. GitHub 仓库 **Settings → Secrets and variables → Actions** 添加 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`。
3. 修改 `.github/workflows/deploy.yml` 里的 `--project-name`。
4. 推送 `main` 即自动构建部署。

> A、B 二选一，别同时开，否则每次推送会部署两遍。

---

## 6. 密钥与变量

在 **Pages 项目 → Settings → Variables and Secrets** 添加；Secret 类型的值保存后不可再查看。命令行写法：

```bash
npx wrangler pages secret put OWNER_SECRET   --project-name my-blog
npx wrangler pages secret put RESEND_API_KEY --project-name my-blog
npx wrangler pages secret put TG_BOT_TOKEN   --project-name my-blog
```

生成随机口令：`openssl rand -base64 32`。

### 6.1 邮件通知（Resend）

1. 注册 [resend.com](https://resend.com)，**API Keys → Create API Key**，得到 `re_…`，存为 `RESEND_API_KEY`。
2. 发件人两种选择：
   - **不验证域名**：`MAIL_FROM` 填 `onboarding@resend.dev`，只能发到你注册 Resend 的邮箱，用来**收评论通知和联系页留言**足够；
   - **验证自己的域名（推荐）**：Resend → **Domains → Add Domain**，按提示在 Cloudflare DNS 添加 SPF / DKIM 记录，通过后 `MAIL_FROM` 可写 `new way <noreply@xxxx.org>`。**给访客发“你的评论有新回复”必须验证域名。**
3. `NOTIFY_EMAIL` 填你的收件邮箱。
4. Resend 免费额度约每天 100 封、每月 3000 封（以官网为准）。

邮件效果：

- 收到评论 → 主题 `[站名] 新评论：/post/xxx`，链接直达评论区；评论者留了邮箱则作为 Reply-To。
- 联系页留言 → Reply-To 为留言者邮箱，**在邮箱里直接回复即可**。
- 有人回复某位留了邮箱的访客（含站主回复）→ 自动给对方发提醒；不需要就设 `REPLY_NOTIFY=0`。

### 6.2 Telegram 机器人

1. 找 `@BotFather` → `/newbot` → 得到 token → `TG_BOT_TOKEN`。
2. 先给机器人发一条消息，再打开 `https://api.telegram.org/bot<TOKEN>/getUpdates`，在 JSON 里找 `chat.id` → `TG_CHAT_ID`。群通知：把机器人拉进群并发一条消息，同样方式取群 ID（负数）。

### 6.3 Server酱（推送到微信）

在 [sct.ftqq.com](https://sct.ftqq.com) 登录，取 SendKey（`SCT…`）→ `SERVERCHAN_KEY`。

### 6.4 企业微信 / 飞书 / 钉钉 / Discord

群里添加“自定义机器人”，复制 Webhook 地址 → `WEBHOOK_URL`；`WEBHOOK_TYPE` 填 `wecom` / `feishu` / `dingtalk` / `discord`（其他系统填 `json`，会 POST `{title, text, url}`）。

飞书 / 钉钉若启用“关键词”安全设置，关键词设为 **评论** 或 **留言**（通知标题均包含）。暂不支持“加签”模式。

### 6.5 站主评论口令

1. 设置 Secret `OWNER_SECRET`，以及变量 `OWNER_NAME`（与 `site.json` 的 `owner_name` 一致）。
2. 用自己的设备打开一次 `https://xxxx.org/post/任意文章.html?owner=你的口令`，口令存入该浏览器 localStorage，地址栏参数会自动清掉。
3. 之后在这台浏览器发评论 / 回复，昵称自动为站主名，带“new”徽章与站主头像，不受限速，也不会给你自己发通知。
4. 口令泄露了：换一个新的 `OWNER_SECRET` 并重新部署，旧口令立即失效。

---

## 7. 上线后验证

1. 页脚出现“访问量 / 访客”胶囊 → D1 绑定成功（没有则见排错表）。
2. 发一条游客评论 → 几秒内收到邮件 / 机器人消息。
3. 联系页发一条留言 → 收到邮件，Reply-To 是你填的邮箱。
4. 用 `?owner=` 口令发一条站主评论 → 带徽章。

查看 / 备份数据：

```bash
npx wrangler d1 execute blog-db --remote --command "SELECT id,path,name,body FROM comments ORDER BY id DESC LIMIT 20"
npx wrangler d1 execute blog-db --remote --command "SELECT id,name,email,subject,mailed FROM messages ORDER BY id DESC LIMIT 20"
npx wrangler d1 export blog-db --remote --output backup.sql
```

删除评论：`DELETE FROM comments WHERE id = 123;`（连同它的回复：`DELETE FROM comments WHERE parent_id = 123;`）。

---

## 8. 常见问题

| 现象 | 原因 / 处理 |
| --- | --- |
| 页脚没有访问量，评论提示“服务端未就绪” | D1 没绑定或变量名不是 `DB`；绑定后需**重新部署** |
| 评论返回 403 | 请求 Origin 与站点域名不一致，请直接用站点域名访问，不要经别的域名反代 |
| 评论返回 429 | 同一 IP 60 秒内只能发一条（站主不限） |
| 收不到通知邮件 | ① `RESEND_API_KEY` / `MAIL_FROM` / `NOTIFY_EMAIL` 是否齐全；② 未验证域名时 `MAIL_FROM` 必须是 `onboarding@resend.dev` 且只能发到注册邮箱；③ 查 Resend 后台 Logs；④ 看垃圾箱 |
| 联系页提示“站点还没有配置邮件服务” | 邮件与机器人都没配置或都失败。留言**已保存在 D1 的 `messages` 表**，没有丢 |
| Telegram 没消息 | 需先给机器人发过消息；`TG_CHAT_ID` 填对；群 ID 是负数 |
| 构建失败：找不到 mistune / jinja2 | Build command 必须带 `pip install -r requirements.txt`，并设 `PYTHON_VERSION=3.12` |
| 改了样式没变化 | 样式源码在 `static/css/*.css`，改完要重新 `python build.py`（线上则重新推送） |

---

## 9. 自定义

- **背景 / 头像候选**：运行 `python tools/make_variants.py`，打开 `tools/gallery.html` 挑选（6 款背景 × 明暗、6 款头像 / logo）。选定后一条命令套用：`python tools/make_variants.py --apply 背景名 头像名`（例如 `--apply waves orbit`），再 `python build.py`。
- **自己改字形 / 配色**：编辑 `tools/make_assets.py`，运行后重新生成默认的 4 个 SVG。
- **玻璃强度**：`static/css/00-tokens.css` 里的 `--glass-bg`、`--glass-blur`、`--glass-shadow`；想让某个容器变玻璃，加 `class="glass"` 即可。
- **正文不做玻璃**：`.post-article` 刻意保持实心卡片，长文阅读更稳。
- **版权声明**：统一由 `templates/_macros.html` 的 `license()` 宏输出（页脚 + 文章页“版权与联系”），改一处全站生效。

---

## 10. 管理后台（/admin）

在浏览器里管理**文章、媒体库、评论、留言、用户**。入口 `https://你的域名/admin`（已在 `robots.txt` 禁止收录）。

| 模块 | 说明 |
| --- | --- |
| 文章 | 表单 + Markdown 编辑器，可预览；保存 = 向 GitHub 提交一次 commit，Pages 自动重建，约 1 分钟上线。支持新建 / 编辑 / 删除 / 草稿（文件名以 `_` 开头）。Markdown 文件仍在仓库里，有完整版本历史，可随时回滚；也可以继续用本地编辑器写文章再 `git push`。 |
| 媒体库 | 图片存 Cloudflare R2。支持上传、拖拽、粘贴截图直接插入文章，复制链接 / Markdown，删除。图片通过 `/media/…` 访问，长期缓存。 |
| 评论 | 搜索、公开 / 隐藏 / 待审核、批量处理、以站主身份回复（会邮件通知对方）、删除、拉黑昵称 / 邮箱 / IP。 |
| 留言 | 联系页的留言列表，一键用邮箱回复，可删除。 |
| 用户 | ① 管理员账号（添加、改角色、停用、重置密码、删除）；② 评论者列表（按昵称 / 邮箱 / IP 哈希聚合）；③ 黑名单。 |

### 10.1 角色

| 角色 | 权限 |
| --- | --- |
| 管理员 `admin` | 全部功能，包含“用户”里的管理员账号管理 |
| 编辑 `editor` | 文章、媒体库、评论、留言、黑名单；不能管理管理员账号 |

系统始终保留至少一位可用的管理员；你不能停用 / 降级 / 删除自己。

### 10.2 配置步骤

**① 创建 R2 存储桶**

1. Cloudflare 控制台 → **R2 Object Storage → Create bucket**，名称 `blog-media`（需绑定付款方式才能开通 R2，免费额度内不收费）。
2. `wrangler.toml` 里已有 `[[r2_buckets]]`，把 `bucket_name` 改成你的桶名；若在面板里绑定：**Pages 项目 → Settings → Bindings → R2 bucket**，变量名填 `MEDIA`。
3. （可选）给桶绑定自定义域名，如 `img.xxxx.org`：R2 桶 → **Settings → Custom Domains**。这样文章里可直接写 `https://img.xxxx.org/…`；不绑定也行，默认走站点自己的 `/media/…`。

**② 创建 GitHub 细粒度 Token**（后台用它把文章提交到仓库）

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**。
2. **Repository access** 选 *Only select repositories*，只勾你的博客仓库。
3. **Permissions → Repository permissions → Contents：Read and write**（Metadata 会自动只读）。
4. 设置合适的过期时间，生成后复制 `github_pat_…`。

**③ 配置变量与密钥**（Pages → Settings → Variables and Secrets）

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `GITHUB_TOKEN` | Secret | 上一步的 Token |
| `GITHUB_REPO` | 变量 | `用户名/仓库名` |
| `GITHUB_BRANCH` | 变量 | 默认 `main`，必须是 Pages 用来部署的分支 |
| `POSTS_DIR` | 变量 | 文章目录，默认 `posts` |
| `ADMIN_SETUP_TOKEN` | Secret | **首次创建管理员用的一次性口令**，随便一串随机字符；创建完管理员后可以删掉 |
| `MEDIA_MAX_MB` | 变量 | 单张图片上限，默认 10 |
| `COMMENT_MODERATION` | 变量 | 设为 `1` 开启先审后发 |
| `CF_API_TOKEN` / `CF_ACCOUNT_ID` / `CF_PROJECT` | Secret / 变量 | 可选：让后台左侧显示“站点：构建中 / 已上线 / 构建失败”。Token 权限：Account → Cloudflare Pages → Read |
| `DEPLOY_HOOK_URL` | Secret | 可选：Pages → Settings → Builds → Deploy hooks 创建，用于手动触发重建 |

配置完 **Retry deployment**（或推送一次代码）使其生效。

**④ 创建第一个管理员**

1. 打开 `https://你的域名/admin`，此时页面显示“创建第一个管理员”。
2. 填 `ADMIN_SETUP_TOKEN`、用户名、密码（≥ 8 位），提交后自动登录。
3. 之后在“用户 → 管理员账号”里添加其他账号；确认没问题后，建议把 `ADMIN_SETUP_TOKEN` 删除。

### 10.3 写文章的文件格式

后台会把表单字段写成 `build.py` 约定的格式：前 6 行是头部，第 7 行起是正文。

```
# 页面标题
cover: /media/2026/10/xxxx-cover.jpg
2026-10-29
分类
标签1,标签2
# 文章标题

正文 Markdown…
```

保存后若文章没出现：检查 Pages 的 **Deployments** 是否在构建、构建日志是否报错（通常是 Markdown 头部格式问题）。

### 10.4 本地测试后台（无需 GitHub / Cloudflare）

```bash
python build.py
node --experimental-sqlite tools/local_admin.mjs      # Node 22+；加 --moderation 可测先审后发
# 打开 http://127.0.0.1:5002/admin ，初始化口令 dev-setup
```

它直接运行 `functions/` 里的真实代码：D1 → `.local/d1.sqlite`，R2 → `.local/r2/`，**“GitHub” → 本地 `posts/` 目录**（保存即写文件，再运行一次 `python build.py` 才会更新静态页）。`.local/` 已被 `.gitignore` 忽略。

> 用 `wrangler pages dev dist` 也可以跑后台，但文章保存会真实调用 GitHub API，请先配置好 `.dev.vars`。

### 10.5 安全说明

- 密码使用 PBKDF2-SHA256（10 万次迭代、随机盐）加密存储；登录失败同一 IP 15 分钟内超过 8 次会被限制。
- 会话是 7 天有效的 HttpOnly Cookie，`SameSite=Strict`；所有写操作要求同源并带自定义请求头，抵御 CSRF。
- 后台页面本身是静态文件、公开可访问，但没有登录就拿不到任何数据；`/api/admin/*` 全部需要登录。
- GitHub Token 只放在 Cloudflare Secret 中，只授予这一个仓库的 Contents 读写权限。
- 上传的 SVG 会以沙箱 CSP 输出，防止其中的脚本执行；其他图片类型输出 `nosniff`。
- 想再加一层保护，可以用 **Cloudflare Zero Trust → Access** 给 `/admin*` 路径加邮箱验证码，再叠加本后台的账号密码。

### 10.6 后台常见问题

| 现象 | 处理 |
| --- | --- |
| 打开 /admin 显示“无法连接后台接口” | Functions 没部署成功，或 D1 没绑定为 `DB` |
| 创建管理员提示“未配置 ADMIN_SETUP_TOKEN” | 添加该 Secret 后重新部署 |
| 文章列表 / 保存报“未配置 GITHUB_TOKEN / GITHUB_REPO” | 检查第 ③ 步变量；Token 过期也会报 `GitHub 401` |
| 保存报 `GitHub 403/404` | Token 没有该仓库的 Contents 读写权限，或 `GITHUB_REPO` / `GITHUB_BRANCH` 写错 |
| 保存报“文件已被别处修改” | 你在 GitHub / 本地也改了同一篇。重新打开该文章，合并后再保存 |
| 文章列表标题显示为文件名 | 这些文章还没建立索引，点“同步标题索引”（每次最多 30 篇，可多点几次） |
| 上传图片报“未绑定 R2 存储桶” | 确认绑定变量名为 `MEDIA` 并重新部署 |
| 文章里的图片 404 | 图片在媒体库被删除了，或链接写成了别的路径；媒体库中重新上传后替换链接 |
| 保存后很久没上线 | 看 Pages → Deployments 的构建日志；确认 `GITHUB_BRANCH` 是生产分支 |

---

## 11. 不做本地测试，直接上线：完整运行流程

### 11.1 你要做的事（按顺序，每步都有“确认点”）

| # | 操作 | 确认点 |
| --- | --- | --- |
| 1 | 改 `site.json`（站名、域名、邮箱、作者卡片）；删除示例文章 `posts/hello-new-way.md` 或保留用于验证 | — |
| 2 | 运行 `python tools/check_secrets.py`，通过后 `git push` 到 GitHub | 脚本输出“✅ 未发现问题” |
| 3 | Cloudflare 创建 **D1** `blog-db`，把 Database ID 填进 `wrangler.toml` 后提交 | D1 控制台能看到数据库 |
| 4 | Cloudflare 创建 **R2** 桶 `blog-media`（桶名要与 `wrangler.toml` 一致） | R2 控制台能看到桶 |
| 5 | **Pages → Connect to Git**，Build command：`pip install -r requirements.txt && python build.py`，输出目录 `dist`，环境变量 `PYTHON_VERSION=3.12` | **Deployments 里构建日志出现 “Build complete”** |
| 6 | 配置 Secrets / 变量（见第 1.2、6、10 章）；至少先配：`ADMIN_SETUP_TOKEN`、`GITHUB_TOKEN`、`GITHUB_REPO`、`IP_SALT` | Settings → Variables and Secrets 里能看到 |
| 7 | **Retry deployment**（让 Functions 读到绑定和密钥） | 部署状态 Success |
| 8 | 打开 `https://xxx.pages.dev/`：页脚出现“访问量 / 访客” | **出现 = D1 绑定成功**；没有 = 看 11.3 |
| 9 | 打开 `/admin`，用 `ADMIN_SETUP_TOKEN` 创建管理员并登录 | 进入概览页 |
| 10 | 后台新建一篇测试文章 | GitHub 仓库出现 commit → Pages 开始构建 → 约 1 分钟后首页出现该文章 |
| 11 | 媒体库传一张图、发一条评论、联系页发一条留言 | 收到邮件 / 机器人消息（需先配通知） |
| 12 | 删掉 `ADMIN_SETUP_TOKEN`；绑定自定义域名 | — |

### 11.2 系统是怎么跑起来的

```
【构建时】 git push / 后台保存文章
   GitHub ──webhook──▶ Cloudflare Pages 构建环境
        pip install → python build.py
        读 site.json + posts/*.md + templates/ + static/css/*  →  生成 dist/（纯静态页面）
        同时把 functions/ 打包成边缘函数，绑定 D1(DB) / R2(MEDIA) / 变量与密钥
   ──▶ 全球 CDN 分发

【访客打开页面】
   浏览器 ──▶ CDN 直接返回静态 HTML / CSS / JS / SVG（不经过函数，最快）
   main.js ──POST /api/hit──▶ 函数 ──▶ D1.stats（访问量 / 访客，匿名随机 ID）
   comments.js ──GET /api/comment──▶ 函数 ──▶ D1.comments（只返回 status=0 的公开评论）
   文章图片 ──GET /media/…──▶ 函数 ──▶ R2（长期缓存）

【访客发评论 / 留言】
   POST /api/comment ──▶ 同源校验 → 黑名单 → 60 秒限速 → （先审后发则 status=2）→ 写 D1
        └─ waitUntil 异步通知：邮件 (Resend) + 机器人 (Telegram / Server酱 / Webhook)
   POST /api/contact ──▶ 蜜罐 / 黑名单 / 限速 → 写 D1.messages → 邮件（Reply-To=访客）+ 机器人

【你在后台管理】
   /admin（静态页）──▶ /api/admin/*：校验 Cookie 会话 + 角色
        文章：函数 ──GitHub API──▶ 提交 commit ──▶（回到“构建时”，约 1 分钟上线）
        图片：函数 ──▶ R2 写入，D1.media 记录
        评论 / 留言 / 用户 / 黑名单：直接读写 D1，立即生效（不需要重建）
```

要点：**页面是构建出来的，所以改文章要等重建；评论、统计、图片、用户是实时读写数据库，立即生效。**

### 11.3 第一次上线最可能出问题的地方

没有做本地测试时，这些点只能靠线上验证（代码逻辑已用模拟的 D1 / R2 / GitHub 测过，但没有在真实 Cloudflare 上跑过）：

| 现象 | 原因 / 处理 |
| --- | --- |
| 构建失败 | 看 Deployments 的构建日志。常见：没设 `PYTHON_VERSION`；Build command 漏了 `pip install`；文章头部不是 6 行格式 |
| 页脚没有访问量 / 后台提示“未绑定 D1” | `wrangler.toml` 里 `database_id` 没替换；或面板里没绑定；绑定后必须 **Retry deployment** |
| 后台接口返回 `server error` | 打开 **Pages 项目 → Functions → Real-time Logs**（或本机 `npx wrangler pages deployment tail`），报错堆栈都会打印在那里 |
| 保存文章报 GitHub 401 / 403 / 404 | Token 过期、权限不是 Contents 读写、或仓库名 / 分支写错 |
| 评论发不出去，提示“来源校验失败” | 请求 Origin 与站点域名不一致，别用代理或别的域名访问 |
| 收不到邮件 | 见第 8 章；先看 Resend 后台 Logs |

---

## 12. 上传 GitHub 前的泄露检查

### 12.1 结论

本项目**仓库里不包含任何密钥**：口令、API Key、Token 全部只放在 Cloudflare 的 Secret 里；`.gitignore` 已排除 `.dev.vars`、`.local/`、`.wrangler/`、`dist/`、`local_api.sqlite3`。仓库里能看到的只有占位符。下表是需要你留意的地方：

| 内容 | 风险 | 建议 |
| --- | --- | --- |
| `.dev.vars`（本地密钥） | 🔴 一旦提交就等于泄露 | 已被 `.gitignore` 忽略；**不要 `git add -f`** |
| `local_api.sqlite3`、`.local/`（本地测试数据库） | 🔴 含测试评论、邮箱、IP 哈希 | 已忽略。如果你之前已经提交过，需要清理历史（见 12.3） |
| `wrangler.toml` 里的邮箱 | 🟠 公开仓库会被爬取，招来垃圾邮件 | 默认不再写 `MAIL_FROM` / `NOTIFY_EMAIL`，改放 Cloudflare Secret（第 1.2 章已标注） |
| `wrangler.toml` 里的 `database_id`、桶名、`GITHUB_REPO` | 🟡 不是凭证，无法单独访问你的数据，但属于基础设施标识 | 可公开；介意就用私有仓库 |
| `site.json` 里的邮箱 / GitHub | 🟢 本来就显示在网站上 | 无需处理 |
| `posts/*.md`、模板、样式、`functions/` 源码 | 🟢 公开内容 / 无密钥 | 后台安全不靠隐藏源码：所有接口都要登录，密码加盐哈希 |
| `.github/workflows/deploy.yml` | 🟢 只引用 `${{ secrets.* }}` | 不要把 Token 直接写进去 |

### 12.2 推送前自检（建议每次都跑）

```bash
python tools/check_secrets.py          # 检查敏感文件、密钥特征、wrangler.toml 里的真实邮箱
```

想自动化：`echo 'python tools/check_secrets.py' > .git/hooks/pre-push && chmod +x .git/hooks/pre-push`。
另外在 GitHub 仓库 **Settings → Code security** 里开启 **Secret scanning** 与 **Push protection**（公开仓库免费），它会在你误提交 Token 时直接拦截。

### 12.3 万一泄露了

1. **先作废再清理**：到对应服务立刻重置——GitHub Token（删除后重建）、Resend API Key、Telegram Bot Token（BotFather `/revoke`）、Server酱 SendKey、Webhook 地址；`OWNER_SECRET` / `IP_SALT` / `ADMIN_SETUP_TOKEN` 直接换新值并重新部署。
2. 把新值更新到 Cloudflare Secret。
3. 清理 Git 历史（只删除文件不够，旧 commit 里还在）：
   `pip install git-filter-repo`，然后 `git filter-repo --path 敏感文件 --invert-paths`，再 `git push --force`。公开仓库里已出现过的凭证，一律视为已泄露，必须作废。

### 12.4 额外的安全习惯

- **GitHub Token**：只授权这一个仓库的 Contents 读写，设置过期时间。它没有 Workflows 权限，所以不能改你的 Actions 文件。
- **`?owner=口令` 方式**：口令会出现在浏览器历史和 Cloudflare 访问日志里。有了管理后台，站主回复建议直接在后台“评论”里操作；若仍要用口令，请在浏览器控制台执行 `localStorage.setItem('commentOwnerToken','口令')`，不要把它拼进链接，或者干脆不设置 `OWNER_SECRET`。
- **`IP_SALT`**：务必设置。不设置时 IP 哈希是无盐 SHA-1，数据库一旦外泄，IPv4 很容易被穷举还原。
- **`ADMIN_SETUP_TOKEN`**：只在创建第一个管理员时需要，创建完就删掉。
- 管理员密码用密码管理器生成，≥ 12 位；离职 / 不再合作的编辑账号及时“停用”。
