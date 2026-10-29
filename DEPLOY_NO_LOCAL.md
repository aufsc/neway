# 无需本地测试：从零上线完整指南

适用场景：**不在自己电脑上运行任何程序**，把项目上传到 GitHub，由 Cloudflare 自动构建并上线。
全程只需要：浏览器 + 一个文本编辑器（记事本 / VS Code 均可）。预计 40–60 分钟。

> Cloudflare、GitHub、Resend 的网页界面会不定期改版，下文给出的菜单名称可能与你看到的略有出入——认准**关键词**即可。
> 每一步都写了「你应该看到」和「看不到怎么办」，请逐步确认再往下走，不要连着做完再回头排错。

---

## 目录

0. 开始前：账号、费用、命名表
1. 在 Cloudflare 创建数据库（D1）和图片桶（R2）
2. 准备项目文件（改 4 处）
3. 上传到 GitHub
4. 在 Cloudflare Pages 连接仓库并首次部署
5. 创建 GitHub 访问令牌（让后台能写文章）
6. 配置通知（邮件 / Telegram，可选但推荐）
7. 在 Cloudflare 添加密钥与变量
8. 逐项验证
9. 收尾：绑定域名、删除一次性口令
10. 日常使用
11. 排错总表
12. 回滚与备份
13. 附录：必须保持一致的配置项速查

---

## 0. 开始前

### 0.1 需要的账号

| 账号 | 用途 | 必需 | 费用 |
| --- | --- | --- | --- |
| GitHub | 存放代码和文章 | 是 | 免费（私有仓库也免费） |
| Cloudflare | 托管网站、数据库、图片 | 是 | Pages / D1 免费额度足够个人博客 |
| Resend | 发邮件通知 | 推荐 | 免费：每月 3000 封，每天最多 100 封，1 个验证域名 |
| Telegram | 机器人通知 | 可选 | 免费 |
| 自己的域名 | 正式网址、邮件发件域名 | 可选 | 先用 `xxx.pages.dev` 也能跑 |

**关于 R2（图片桶）**：免费额度为每月 10 GB 存储、100 万次写入类请求、1000 万次读取类请求，出网流量免费。**首次开通 R2 时 Cloudflare 可能要求绑定付款方式**（用于超额计费，在免费额度内不扣费）。不想绑卡就无法使用后台的媒体库功能，其他功能不受影响，文章里的图片可以改用外链或直接放进仓库。

### 0.2 先想好 4 个名字（后面要反复用，**必须前后一致**）

填写下表并保存，后文用 `〔 〕` 引用：

| 名称 | 示例 | 你的取值 | 用在哪里 |
| --- | --- | --- | --- |
| 〔项目名〕 | `my-blog` | | Cloudflare Pages 项目名；`wrangler.toml` 的 `name` |
| 〔仓库〕 | `yourname/my-blog` | | GitHub 仓库（`用户名/仓库名`）；`wrangler.toml` 的 `GITHUB_REPO` |
| 〔库名〕 | `blog-db` | | D1 数据库名；`wrangler.toml` 的 `database_name` |
| 〔桶名〕 | `blog-media` | | R2 存储桶名；`wrangler.toml` 的 `bucket_name` |

另外准备一个**密码管理器**（Bitwarden / 1Password / 浏览器自带的强密码生成都行），后面要生成几个随机字符串，并保存好。

### 0.3 解压项目

解压 `new-way-blog.zip`，得到文件夹 `blog-project`。后文所说“项目根目录”就是里面直接包含 `build.py`、`site.json` 的那一层。

---

## 1. 在 Cloudflare 创建 D1 数据库和 R2 存储桶

> **顺序很重要**：必须先建好这两样、把 ID 写进配置，再连接 Pages。否则第一次部署会因为绑定的资源不存在而报错。

### 1.1 创建 D1

1. 登录 <https://dash.cloudflare.com>。
2. 左侧菜单找到 **Storage & Databases → D1 SQL Database**（旧版叫 **Workers & Pages → D1**）→ **Create database**。
3. 名称填〔库名〕（如 `blog-db`），位置保持自动 → **Create**。
4. 进入数据库详情页，复制 **Database ID**（形如 `a1b2c3d4-xxxx-xxxx-xxxx-xxxxxxxxxxxx`）。

**你应该看到**：数据库详情页顶部有 ID。**把它记下来**，下一步要用。

> 建表不用手动做：接口第一次被请求时会自动建表。想手动也可以：数据库页面 → **Console**，把项目里 `schema.sql` 的全部内容粘贴进去执行。

### 1.2 创建 R2 桶

1. 左侧菜单 **R2 Object Storage**（首次进入可能要求添加付款方式，按提示完成）。
2. **Create bucket**，名称填〔桶名〕（如 `blog-media`），位置保持自动 → **Create bucket**。
3. 不需要开启“公开访问”，图片通过站点自己的 `/media/…` 对外提供。

**你应该看到**：桶列表里有你的桶。

---

## 2. 准备项目文件（改 4 处）

用文本编辑器打开项目根目录里的文件。**保存时编码选 UTF-8。**

### 2.1 `site.json` — 站点信息

| 字段 | 改成 |
| --- | --- |
| `name` | 站名，如 `new way` |
| `description` | 一句话简介 |
| `domain` / `url` | 先写你**打算使用的最终域名**，如 `xxxx.org` / `https://xxxx.org`；暂时没有域名就把 `url` 留空 `""`（RSS 和 sitemap 将不生成，之后补上再重新部署即可） |
| `email` / `email_feedback` / `email_help` | **公开显示在网站上**的联系邮箱 |
| `github` | 你的 GitHub 主页，不想显示就留空 |
| `start_date` | 建站日期 |
| `owner_name` | 站主评论显示名，必须与后面的 `OWNER_NAME` 一致 |
| `author.name / bio / motto` | 首页个人卡片的名字、简介、格言 |

### 2.2 `wrangler.toml` — Cloudflare 配置

只改标了 ← 的地方：

```toml
name = "my-blog"                       # ← 改成〔项目名〕
pages_build_output_dir = "dist"
compatibility_date = "2025-01-01"

[[d1_databases]]
binding = "DB"                         # 不要改
database_name = "blog-db"              # ← 改成〔库名〕
database_id = "REPLACE_WITH_YOUR_D1_DATABASE_ID"   # ← 粘贴第 1.1 步复制的 Database ID

[[r2_buckets]]
binding = "MEDIA"                      # 不要改
bucket_name = "blog-media"             # ← 改成〔桶名〕

[vars]
SITE_NAME = "new way"                  # ← 站名（通知邮件里用）
OWNER_NAME = "new"                     # ← 与 site.json 的 owner_name 相同
GITHUB_REPO = "yourname/yourrepo"      # ← 改成〔仓库〕
GITHUB_BRANCH = "main"                 # 不要改（除非你的主分支不叫 main）
```

**注意**：
- **不要**在这个文件里写任何邮箱、密码、Token——这个文件会被提交到 GitHub。
- 文件里已经被注释掉的行（以 `#` 开头）保持不动。

### 2.3 选背景和头像（可选）

默认就能用。想换：用浏览器打开 `gallery.html`（在项目的 `tools/` 目录里），记下喜欢的背景名和头像名，然后**手动复制 4 个文件**（不需要装 Python）。假设选了背景 `waves`、头像 `orbit`，到 `static/themes/` 里：

| 复制这个文件 | 覆盖到（`static/` 下） |
| --- | --- |
| `bg-waves-light.svg` | `bg-light.svg` |
| `bg-waves-dark.svg` | `bg-dark.svg` |
| `avatar-orbit.svg` | `avatar.svg` |
| `logo-orbit.svg` | `logo.svg` |

做完后可以把整个 `static/themes/` 文件夹删掉（它不参与站点运行，删掉还能少传 24 个文件）。

### 2.4 处理示例文章

- `posts/hello-new-way.md` 是示例：想先用它验证整条链路，就先保留，验证完在后台或 GitHub 里删除。
- 你自己的文章放进 `posts/` 目录。**每篇文章的前 6 行是头部，第 7 行起是正文**：

```
# 页面标题
cover: /static/cover-placeholder.svg
2026-10-29
分类
标签1,标签2
# 文章标题

正文 Markdown…
```

文件名以 `_` 开头的是草稿，不会发布。

### 2.5 上传前自检（人工版，1 分钟）

- [ ] 没有任何文件里写了 Token / 密码 / API Key / 你的私人邮箱（`site.json` 里的**公开**邮箱除外）
- [ ] 项目根目录**没有** `.dev.vars`、`.local` 文件夹、`*.sqlite3` 文件、`dist` 文件夹（如果有，删掉）
- [ ] `wrangler.toml` 里的 `database_id` 已替换

> 装了 Python 的话，可以改为运行 `python tools/check_secrets.py`，它会自动做这些检查。没装也没关系，按上面清单看一遍即可。

---

## 3. 上传到 GitHub

建议建成**私有仓库**（Private）。Cloudflare Pages 同样可以连接私有仓库。

### 方式 A：网页上传（不用装 Git，最简单）

1. 登录 GitHub → 右上角 **+ → New repository**。
2. **Repository name** 填〔仓库〕里“/”后面的部分；选 **Private**；**不要**勾选 Add README / .gitignore / license → **Create repository**。
3. 在新仓库页面点 **uploading an existing file**。
4. 打开解压后的项目文件夹，**全选里面的所有内容**（不是拖整个 `blog-project` 文件夹本身）拖进浏览器。
   - 必须包含以 `.` 开头的隐藏项：`.gitignore`、`.python-version`、`.github/`、`.dev.vars.example`。macOS 在 Finder 按 **⌘ + Shift + .** 显示隐藏文件。
   - **网页单次最多上传 100 个文件**。如果已删除 `static/themes/`，总数在 100 以内可一次传完；否则分两批传（先传一半 → Commit，再传另一半）。
   - 拖拽上传**不保留空文件夹**，这没关系。
5. 页面底部填提交说明（如 `init`），选 **Commit directly to the main branch** → **Commit changes**。

### 方式 B：Git 命令（装了 Git 的话）

```bash
cd 项目根目录
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin https://github.com/用户名/仓库名.git
git push -u origin main
```

首次推送会要求登录：用户名是 GitHub 用户名，密码处**填 Personal Access Token**（不是登录密码），或者改用 GitHub Desktop / `gh auth login`。

### 3.1 确认上传正确

打开仓库首页，**你应该看到**根目录直接有这些：

```
.github  functions  posts  static  templates  tools  .gitignore  .python-version
DEPLOY.md  build.py  local_api.py  requirements.txt  schema.sql  site.json  wrangler.toml …
```

**常见错误**：只看到一个 `blog-project` 文件夹——说明把外层文件夹也拖进去了，路径多了一层，Cloudflare 找不到 `build.py`。解决：删除仓库重建，或在 GitHub 里逐个文件移动路径。

### 3.2 开启 GitHub 自带的泄露拦截（1 分钟，强烈建议）

仓库 → **Settings → Advanced Security（或 Code security）** → 开启 **Secret scanning** 和 **Push protection**。

---

## 4. 在 Cloudflare Pages 连接仓库并首次部署

1. Cloudflare 控制台 → **Workers & Pages → Create application → Pages → Connect to Git**。
2. 授权 GitHub（可选择只授权这一个仓库）→ 选中〔仓库〕→ **Begin setup**。
3. **Project name** 填〔项目名〕（必须与 `wrangler.toml` 的 `name` 一致）；**Production branch** 选 `main`。
4. 构建设置：

   | 项 | 填写 |
   | --- | --- |
   | Framework preset | **None** |
   | Build command | `pip install -r requirements.txt && python build.py` |
   | Build output directory | `dist` |
   | Root directory | 留空 |

5. 展开 **Environment variables (advanced)**，添加：`PYTHON_VERSION` = `3.12`（项目里已有 `.python-version` 文件，双保险）。
6. 点 **Save and Deploy**，等待构建（约 1–3 分钟）。

**你应该看到**：构建日志里依次出现 `Installing Python…`、`pip install …`、`✅ Build complete! … posts + … pages → dist/`，最后 **Success! Your site is live at https://〔项目名〕.pages.dev**。

**看不到怎么办**：

| 日志里的现象 | 原因 / 处理 |
| --- | --- |
| `python: command not found` / 找不到 `build.py` | 仓库根目录路径不对（见 3.1），或 Root directory 填错 |
| `No module named jinja2 / mistune` | Build command 没带 `pip install -r requirements.txt` |
| `FileNotFoundError: site.json` | `site.json` 没上传，或文件名大小写不对 |
| `JSONDecodeError` | `site.json` 里有多余的逗号或中文引号，用 <https://jsonlint.com> 检查 |
| 提到 `wrangler.toml` 的校验错误 | `wrangler.toml` 被改坏：检查引号是否成对、`[[d1_databases]]` 的方括号是否完整 |
| 提示 D1 / R2 binding 找不到资源 | 第 1 步的 ID / 桶名填错，或还没创建；改正后提交，会自动重新部署 |
| 构建成功但文章页 404 | 文章文件头部不是 6 行格式，看构建日志里的警告 |

> 此时网站已经能打开（静态页面正常），但评论、统计、后台还需要第 5–7 步的密钥才能完整工作。

---

## 5. 创建 GitHub 访问令牌（让后台能写文章）

1. GitHub 右上角头像 → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**。
2. 填写：

   | 项 | 填写 |
   | --- | --- |
   | Token name | `blog-admin` |
   | Expiration | 90 天或 1 年（到期前记得更新） |
   | Repository access | **Only select repositories** → 只勾选你的博客仓库 |
   | Permissions → Repository permissions → **Contents** | **Read and write** |

   （`Metadata: Read-only` 会自动勾上，保持即可。**不要**给 Workflows、Administration 等其它权限。）
3. **Generate token**，复制 `github_pat_…` 开头的字符串，**立刻存进密码管理器**（页面关闭后无法再次查看）。

这个令牌只能读写这一个仓库的文件，不能改 Actions 工作流，也不能访问你的其它仓库。

---

## 6. 配置通知（可选但推荐）

没配也能用，只是新评论和留言不会推送给你。

### 6.1 邮件（Resend）

1. 注册 <https://resend.com> → **API Keys → Create API Key**（权限选 *Sending access*），复制 `re_…` 存好。
2. 选择发件方式：

   | 方式 | `MAIL_FROM` 填 | 限制 |
   | --- | --- | --- |
   | **A. 不验证域名（最快）** | `onboarding@resend.dev` | 只能发到你注册 Resend 的那个邮箱。够用来**收评论通知和联系页留言**，但**不能**给访客发“你的评论有新回复” |
   | **B. 验证自己的域名（推荐）** | `new way <noreply@你的域名>` | 在 Resend → **Domains → Add Domain**，按提示到 Cloudflare DNS 添加 SPF / DKIM 记录，等状态变 **Verified**。免费版只能验证 1 个域名 |

3. `NOTIFY_EMAIL` 填你想收通知的邮箱（方式 A 时必须是 Resend 注册邮箱）。

### 6.2 Telegram 机器人

1. Telegram 搜索 `@BotFather` → 发送 `/newbot` → 按提示起名 → 得到 token（形如 `123456789:AAH…`）。
2. 给你的新机器人**先发一条任意消息**。
3. 浏览器打开 `https://api.telegram.org/bot<你的token>/getUpdates`，在返回内容里找 `"chat":{"id":123456789` → 这个数字就是 `TG_CHAT_ID`。

### 6.3 其他（Server酱 / 企业微信 / 飞书 / 钉钉 / Discord）

见 `DEPLOY.md` 第 6.3、6.4 节，原理相同：拿到密钥或 Webhook 地址，填到对应变量。

---

## 7. 在 Cloudflare 添加密钥与变量

### 7.1 入口

Cloudflare → **Workers & Pages** → 你的 Pages 项目 → **Settings → Variables and Secrets**（旧版叫 **Environment variables**）→ **Add**。

- **Type 选 Secret**（保存后无法再查看，最安全）。
- **Environment** 选 **Production**。
- 如果 `wrangler.toml` 已经声明了某些变量，面板会提示它们由配置文件管理——**同名变量不要在面板里重复添加**；密钥（Secret）不受影响，照常添加。

### 7.2 要添加的清单

**必加（后台和基础功能）**

| 名称 | 值 | 说明 |
| --- | --- | --- |
| `ADMIN_SETUP_TOKEN` | 密码管理器生成的 20+ 位随机串 | 创建第一个管理员时用的一次性口令，用完就删 |
| `GITHUB_TOKEN` | 第 5 步的 `github_pat_…` | 后台写文章 |
| `IP_SALT` | 密码管理器生成的 20+ 位随机串 | IP 哈希加盐，**不要省** |

**邮件通知（配了第 6.1 步才加）**

| 名称 | 值 |
| --- | --- |
| `RESEND_API_KEY` | `re_…` |
| `MAIL_FROM` | 见 6.1（如 `onboarding@resend.dev`） |
| `NOTIFY_EMAIL` | 你的收件邮箱 |

**Telegram（配了第 6.2 步才加）**

| 名称 | 值 |
| --- | --- |
| `TG_BOT_TOKEN` | 机器人 token |
| `TG_CHAT_ID` | 数字 ID |

**可选**

| 名称 | 值 | 作用 |
| --- | --- | --- |
| `COMMENT_MODERATION` | `1` | 游客评论先审后发 |
| `OWNER_SECRET` | 随机串 | 站主口令评论（有后台后一般不需要，不加更安全） |
| `CONTACT_TO` | 邮箱 | 联系页留言单独发到另一个邮箱 |
| `MEDIA_MAX_MB` | `10` | 图片大小上限 |
| `CF_API_TOKEN` + `CF_ACCOUNT_ID` + `CF_PROJECT` | 见 `DEPLOY.md` 第 10.2 节 | 后台显示“构建中 / 已上线” |

> 找不到面板入口时的备用办法（需要装 Node.js，一次性操作，不算“本地测试”）：
> `npx wrangler login`，然后对每个密钥执行 `npx wrangler pages secret put 名称 --project-name 〔项目名〕`，按提示粘贴值。

### 7.3 让配置生效

密钥添加完后必须重新部署一次：Pages 项目 → **Deployments** → 最新一条右侧 **⋯ → Retry deployment**（或者在 GitHub 里随便改一个文件提交）。

**你应该看到**：新的部署状态变为 **Success**。

---

## 8. 逐项验证

把 `https://〔项目名〕.pages.dev` 当作你的网址 `<站点>`。**按顺序做，每项通过再做下一项。**

### 8.1 静态页面

打开 `<站点>/`。**应该看到**：首页、个人信息卡、文章列表、右上角主题切换可用。

### 8.2 数据库（D1）

- 浏览器访问 `<站点>/api/hit?path=/`。
  - ✅ 返回 `{"pv":0,"uv":0,"page_pv":0}` 之类的 JSON → D1 绑定成功。
  - ❌ 返回 `{"error":"未绑定 D1 数据库（变量名需为 DB）"}` → 回第 1.1、2.2 步检查 `database_id`，改完提交并等待重新部署。
  - ❌ 返回 `{"error":"server error"}` → 看第 11 章“怎么查日志”。
- 刷新首页几次，页脚出现“访问量 / 访客”胶囊即可。

### 8.3 创建管理员

1. 访问 `<站点>/admin`。**应该看到**标题“创建第一个管理员”。
   - 看到的是“管理后台”登录框而不是“创建第一个管理员”：说明已经有管理员，跳到 8.4。
   - 页面一直“加载中…”或提示无法连接接口：Functions 没有部署成功，看第 11 章。
2. 填：初始化口令（= `ADMIN_SETUP_TOKEN`）、用户名（3–32 位字母 / 数字 / `_.-`）、密码（≥ 8 位，建议 12 位以上）→ **创建管理员**。
3. **应该看到**：自动进入后台，左侧有“概览 / 文章 / 媒体库 / 评论 / 留言 / 用户”。

提示“未配置 ADMIN_SETUP_TOKEN” → 第 7 步没加或没重新部署；提示“初始化口令不正确” → 复制时多了空格。

### 8.4 文章列表（GitHub 连通性）

点“文章”。**应该看到**示例文章（或你的文章）。

| 报错 | 原因 |
| --- | --- |
| 未配置 `GITHUB_TOKEN / GITHUB_REPO` | 第 7 步没加 `GITHUB_TOKEN`，或 `wrangler.toml` 里的 `GITHUB_REPO` 没改 |
| `GitHub 401` | Token 复制错了或已过期 |
| `GitHub 403` | Token 没有 Contents 读写权限 |
| 找不到仓库 / 仓库里没有分支 … | `GITHUB_REPO` 不是「用户名/仓库名」，Token 没授权该仓库，或 `GITHUB_BRANCH` 写错 |
| 列表为空但没有报错 | 仓库里还没有 `posts/` 目录或里面没有 `.md` 文件，属正常 |

### 8.5 图片（R2 连通性）

点“媒体库” → 上传一张图片。**应该看到**缩略图出现；点击缩略图能在新标签页打开 `/media/年/月/xxxx-名字.jpg`。

- 提示“未绑定 R2 存储桶” → 检查 `wrangler.toml` 里的 `bucket_name` 与 R2 桶名是否完全一致、桶是否已创建，修正后重新部署。

### 8.6 发布一篇测试文章（完整闭环）

1. “文章 → 新建文章”：标题 `测试`，文件名 `test-post`，分类 `随笔`，正文随便写，点“插入图片（媒体库）”选一张图。
2. **保存并发布**。**应该看到**提示“已提交到 GitHub，约 1 分钟后上线”。
3. 打开 GitHub 仓库 → **应该多了一条 commit**，说明形如 `create: test-post.md (by 你的用户名)`，文件 `posts/test-post.md` 出现。
4. Cloudflare → Deployments → **应该自动出现一次新的构建**。
5. 构建完成后刷新首页，**应该看到“测试”文章**；点进去能看到图片。
6. 回到后台把这篇测试文章删除（会再提交一次 commit）。

### 8.7 评论与通知

1. 打开一篇文章，用游客身份发一条评论。**应该看到**评论立即显示（若开了先审后发则提示“审核通过后显示”）。
2. 几秒内收到通知（邮件 / Telegram）。
3. 后台“评论”里能看到这条评论，试一下“回复”和“隐藏 / 恢复显示”。

收不到通知：看 Resend 后台 **Logs**（有没有发出、报什么错）；Telegram 确认已先给机器人发过消息；`MAIL_FROM` 在未验证域名时只能是 `onboarding@resend.dev`。

### 8.8 联系页

在 `<站点>/contact` 提交一条留言。**应该看到**“已发送，谢谢你的留言！”，邮箱收到邮件，且直接“回复”会发给留言者。

- 提示“站点还没有配置邮件服务”：邮件与机器人都没配置成功。留言仍保存在数据库，后台“留言”里能看到。

---

## 9. 收尾

### 9.1 删除一次性口令

Pages → Settings → Variables and Secrets → 删除 `ADMIN_SETUP_TOKEN` → 重新部署一次。

### 9.2 绑定自己的域名（可选）

1. Pages 项目 → **Custom domains → Set up a custom domain** → 输入域名（如 `xxxx.org` 或 `blog.xxxx.org`）。
2. 域名 DNS 如果托管在 Cloudflare，会自动添加记录；否则按提示到你的域名服务商处添加 CNAME。
3. 状态变为 **Active** 后，把 `site.json` 的 `url` / `domain` 改成该域名并提交，让 RSS、sitemap 使用正式地址。
4. 若使用 Resend 方式 B，`MAIL_FROM` 使用该域名的邮箱。

> 同源校验会让接口只接受来自**当前访问域名**的请求，`pages.dev` 和自定义域名都可以正常使用，无需额外配置。

### 9.3 安全收尾清单

- [ ] `ADMIN_SETUP_TOKEN` 已删除
- [ ] 管理员密码来自密码管理器，≥ 12 位
- [ ] GitHub Secret scanning / Push protection 已开启
- [ ] GitHub Token 设了过期时间，并在日历里记一个更新提醒
- [ ] 没有设置 `OWNER_SECRET`（或确认不会把口令拼进链接）

---

## 10. 日常使用

| 想做的事 | 怎么做 | 多久生效 |
| --- | --- | --- |
| 写 / 改 / 删文章 | 后台“文章” | 约 1 分钟（需要重新构建） |
| 上传图片 | 后台“媒体库”，或在编辑器里粘贴 / 拖入图片 | 立即 |
| 回复 / 隐藏 / 删除评论，拉黑 | 后台“评论” | 立即 |
| 看联系留言 | 后台“留言” | 立即 |
| 加编辑账号 | 后台“用户 → 管理员账号” | 立即 |
| 改站名 / 简介 / 邮箱 | 在 GitHub 里编辑 `site.json` 并提交 | 约 1 分钟 |
| 改样式 | 编辑 `static/css/*.css` 并提交 | 约 1 分钟 |

也可以继续在本地用编辑器写 Markdown，然后 `git push` / 在 GitHub 网页里直接上传文件到 `posts/`，效果相同。

---

## 11. 排错总表

### 11.1 去哪里看日志

| 问题类型 | 位置 |
| --- | --- |
| 构建失败 | Pages 项目 → **Deployments** → 点那次部署 → **View build log** |
| 接口返回 `server error`、后台功能异常 | Pages 项目 → **Functions → Real-time Logs → Begin log stream**，然后在网页上重复触发一次操作，错误堆栈会实时打印 |
| 邮件没发出 | Resend 后台 → **Logs** |
| 文章没提交上 GitHub | 后台页面右下角的红色提示；GitHub 仓库的 commit 列表 |

### 11.2 现象 → 原因

| 现象 | 最可能的原因 | 处理 |
| --- | --- | --- |
| 访问 `/admin` 显示 404 | 构建没成功，或 `admin.html` 没生成 | 看构建日志；确认 `templates/admin.html` 已上传 |
| `/api/…` 全部 404 | `functions/` 目录没上传到仓库根目录 | 检查仓库里是否有 `functions/api/…` |
| 后台提示“登录已失效” | 会话过期（7 天）或被管理员停用 | 重新登录 |
| 登录提示“尝试次数过多” | 同一 IP 15 分钟内失败超过 8 次 | 等 15 分钟 |
| 保存文章提示“文件已被别处修改” | 你在 GitHub / 本地也改了同一篇 | 重新打开该文章，合并后再保存 |
| 保存成功但网站没更新 | 构建失败或还在构建 | 看 Deployments；常见原因是文章头部格式错误 |
| 文章列表标题显示为文件名 | 还没建立标题索引 | 点“同步标题索引”（每次最多 30 篇） |
| 评论提示“来源校验失败” | 用了别的域名 / 代理访问 | 直接用站点域名访问 |
| 图片在文章里显示不出来 | 图片被删了，或链接路径写错 | 重新上传并替换链接 |
| 改了 `wrangler.toml` 后部署失败 | 配置语法错误 | 对照第 2.2 步逐行检查引号与方括号 |

---

## 12. 回滚与备份

- **回滚网站版本**：Pages → Deployments → 找到上一个正常的部署 → **⋯ → Rollback to this deployment**。
- **回滚文章**：文章都在 GitHub 里，到仓库 → 对应文件 → **History** → 找到旧版本，复制内容覆盖或直接 **Revert** 那次 commit。
- **备份评论等数据库内容**：D1 数据库页面可以导出；命令行用 `npx wrangler d1 export 〔库名〕 --remote --output backup.sql`。建议每季度导出一次。D1 还带有时间点恢复（Time Travel），保留时长随套餐而不同，详见官方文档。
- **备份图片**：R2 桶里的图片可以用 Cloudflare 控制台或 S3 兼容工具导出。

---

## 13. 附录：必须保持一致的配置项速查

| 事项 | 在哪里填 | 必须与…一致 |
| --- | --- | --- |
| 项目名 | `wrangler.toml` 的 `name` | Cloudflare Pages 项目名 |
| 仓库 | `wrangler.toml` 的 `GITHUB_REPO` | GitHub 上的 `用户名/仓库名` |
| 分支 | `wrangler.toml` 的 `GITHUB_BRANCH` | Pages 的 Production branch |
| D1 名 / ID | `database_name` / `database_id` | D1 控制台里的名称 / ID |
| D1 绑定名 | `binding = "DB"` | **固定为 `DB`**，代码里写死 |
| R2 桶名 | `bucket_name` | R2 控制台里的桶名 |
| R2 绑定名 | `binding = "MEDIA"` | **固定为 `MEDIA`**，代码里写死 |
| 站主名 | `site.json` 的 `owner_name` | `wrangler.toml` 的 `OWNER_NAME` |
| 发件人 | `MAIL_FROM`（Secret） | Resend 中已验证的域名（或 `onboarding@resend.dev`） |
| 构建命令 | Pages 构建设置 | `pip install -r requirements.txt && python build.py` |
| 输出目录 | Pages 构建设置 | `dist` |

**同一个变量名只在一个地方定义**：写在 `wrangler.toml` 的 `[vars]` 里的，就不要再到面板里添加；密钥一律放面板（Secret）。

---

出现文档里没覆盖的问题时：先看第 11.1 节的日志，把**报错原文**（不含任何密钥）整理出来再排查，通常 90% 的问题都是名称不一致（第 13 章）或忘记重新部署。
