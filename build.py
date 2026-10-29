#!/usr/bin/env python3
"""静态博客构建脚本

目录约定（均相对于本文件所在目录）：
    posts/        Markdown 文章，文件名以 _ 开头的视为草稿，不发布
    templates/    base / index / post / about / categories / contact / info .html
    static/       main.js、index.js、post.js、svg 等，原样复制到 dist/static
    static/css/   样式分模块存放，构建时按文件名顺序合并为 dist/static/style.css
    site.json     站点配置（名称、域名、邮箱、作者卡片等）
    categories.md 可选。存在则用它渲染分类页；不存在则根据文章分类自动生成
    dist/         输出目录

文章头部格式：
    0: # 页面标题
    1: cover: 封面图地址   （或 ![](地址)）
    2: 时间               （2025-01-01 / 2025年1月1日 / 2025/1/1）
    3: 分类
    4: 词云标签            （逗号分隔）
    5: # 正文标题
    6+: 正文（标题为“检查列表”的小节会显示在文章页右侧栏，没有则不显示）

可选依赖：pygments（代码高亮）。未安装时代码块按普通样式输出。
"""
import html
import json
import math
import os
import re
import shutil
from datetime import datetime, timezone
from email.utils import format_datetime
from urllib.parse import quote
from xml.sax.saxutils import escape as xml_escape

import mistune
from jinja2 import Environment, FileSystemLoader, TemplateNotFound, select_autoescape

try:
    from pygments import highlight
    from pygments.formatters import HtmlFormatter
    from pygments.lexers import get_lexer_by_name
    from pygments.util import ClassNotFound
    HAS_PYGMENTS = True
except ImportError:
    HAS_PYGMENTS = False

# ------------------------------------------------------------------ 站点配置
BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def load_site():
    """读取 site.json；缺省字段给出合理默认值，模板里统一用 SITE.xxx 访问。"""
    defaults = {
        "name": "我的个人博客", "domain": "", "url": "", "description": "", "logo": "/static/logo.svg",
        "avatar": "/static/avatar.svg", "email": "", "email_feedback": "", "email_help": "", "github": "",
        "start_date": "2023-01-01", "owner_name": "new", "owner_avatar": "/static/avatar.svg",
        "author": {"name": "new", "bio": "", "motto": ""},
    }
    with open(os.path.join(BASE_DIR, "site.json"), encoding="utf-8-sig") as f:
        data = json.load(f)
    site = {**defaults, **data}
    site["author"] = {**defaults["author"], **(data.get("author") or {})}
    return site


SITE = load_site()

POSTS_DIR = os.path.join(BASE_DIR, "posts")
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")
STATIC_DIR = os.path.join(BASE_DIR, "static")
CSS_DIR = os.path.join(STATIC_DIR, "css")
DIST_DIR = os.path.join(BASE_DIR, "dist")
CATEGORIES_MD = os.path.join(BASE_DIR, "categories.md")

PAGES = ["about", "categories", "info", "contact"]
UNCATEGORIZED = "未分类"
EXCERPT_LEN = 120


# ------------------------------------------------------------------ Markdown
class Renderer(mistune.HTMLRenderer):
    """代码块用 pygments 高亮（mistune 2.x / 3.x 通用签名）。"""

    def block_code(self, code, info=None):
        lang = (info or "").strip().split(None, 1)[0] if info else ""
        if HAS_PYGMENTS and lang:
            try:
                lexer = get_lexer_by_name(lang)
            except ClassNotFound:
                lexer = None
            if lexer:
                body = highlight(code, lexer, HtmlFormatter(nowrap=True))
                return f'<pre class="highlight"><code class="language-{html.escape(lang)}">{body}</code></pre>\n'
        return super().block_code(code, info)


markdown = mistune.create_markdown(renderer=Renderer(escape=False), plugins=["table", "task_lists"])


def pygments_css():
    """明/暗两套高亮配色，分别挂在 data-theme 下。"""
    if not HAS_PYGMENTS:
        return "/* 未安装 pygments：pip install pygments 后重新构建即可启用代码高亮 */\n"
    light = HtmlFormatter(style="default").get_style_defs('[data-theme="light"] .highlight')
    try:
        dark = HtmlFormatter(style="github-dark").get_style_defs('[data-theme="dark"] .highlight')
    except ClassNotFound:
        dark = HtmlFormatter(style="monokai").get_style_defs('[data-theme="dark"] .highlight')
    css = light + "\n" + dark + "\n"
    # 只保留带 .highlight 前缀的规则，避免 pygments 的全局 pre/td 规则影响其它元素
    return "\n".join(l for l in css.splitlines() if l.startswith("[data-theme")) + "\n"


# ------------------------------------------------------------------ 工具函数
def parse_date(s):
    """解析各种日期写法，失败返回 datetime.min（排在最后）。"""
    s = (s or "").strip()
    for fmt in ("%Y-%m-%d", "%Y年%m月%d日", "%Y/%m/%d",
                "%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    m = re.match(r"(\d{4})\D+(\d{1,2})\D+(\d{1,2})", s)       # 2025-1-5 / 2025.1.5 等
    if m:
        try:
            return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            pass
    return datetime.min


def post_out_name(filename):
    return re.sub(r"\.md$", ".html", filename)


def slugify(text):
    s = re.sub(r"[^\w\- ]+", "", text.lower(), flags=re.U).strip()
    return re.sub(r"[\s_]+", "-", s) or "section"


def strip_tags(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s)).strip()


HEADING_RE = re.compile(r"<h([1-6])(\s[^>]*)?>(.*?)</h\1>", re.S)


def add_heading_ids(content):
    """给标题生成稳定的 id（同名自动加 -2、-3…），并收集目录。"""
    toc, used = [], {}

    def repl(m):
        level, attrs, inner = int(m.group(1)), m.group(2) or "", m.group(3)
        text = strip_tags(inner)
        found = re.search(r'\bid="([^"]+)"', attrs)
        if found:
            hid = found.group(1)
        else:
            base = slugify(text)
            n = used.get(base, 0) + 1
            used[base] = n
            hid = base if n == 1 else f"{base}-{n}"
            attrs += f' id="{hid}"'
        toc.append({"id": hid, "text": text, "level": level})
        return f"<h{level}{attrs}>{inner}</h{level}>"

    return HEADING_RE.sub(repl, content), toc


HEAD_LINE_RE = re.compile(r"^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$")
FENCE_RE = re.compile(r"^\s*(```|~~~)")
CHECKLIST_TITLE = "检查列表"


def extract_checklist(lines):
    """取出正文中最后一个标题为“检查列表”的小节（到下一个同级或更高级标题为止，围栏代码块内的不算）。
    返回 (去掉该小节后的正文行, 小节内容 Markdown)；没有则原样返回并给空串。"""
    heads, in_fence = [], False
    for i, raw in enumerate(lines):
        if FENCE_RE.match(raw):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        m = HEAD_LINE_RE.match(raw)
        if m:
            heads.append((i, len(m.group(1)), m.group(2).strip().rstrip("：:").strip()))
    for k in range(len(heads) - 1, -1, -1):
        i, level, title = heads[k]
        if title != CHECKLIST_TITLE:
            continue
        end = next((j for j, lv, _ in heads[k + 1:] if lv <= level), len(lines))
        return lines[:i] + lines[end:], "\n".join(lines[i + 1:end]).strip()
    return lines, ""


def count_words(text):
    """中文按字、英文按词计数；阅读时间按 中文 400 字/分钟、英文 200 词/分钟 估算（至少 1 分钟）。"""
    cjk = len(re.findall(r"[\u3400-\u4dbf\u4e00-\u9fff]", text))
    en = len(re.findall(r"[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*", text))
    return cjk + en, max(1, math.ceil(cjk / 400 + en / 200))


def make_excerpt(content):
    text = re.sub(r"<pre.*?</pre>", " ", content, flags=re.S)
    text = re.sub(r"\s+", " ", strip_tags(text))
    return text[:EXCERPT_LEN] + ("…" if len(text) > EXCERPT_LEN else "")


# ------------------------------------------------------------------ 文章解析
def parse_post(filepath):
    with open(filepath, "r", encoding="utf-8-sig") as f:
        lines = f.read().splitlines()           # 兼容 \r\n

    def line(i, default=""):
        return lines[i].strip() if len(lines) > i else default

    filename = os.path.basename(filepath)

    title_line = line(0, filename)               # 0: 页面标题
    page_title = (title_line.lstrip("#").strip() if title_line.startswith("#") else title_line) or filename

    cover = re.sub(r"^cover\s*[:：]\s*", "", line(1), flags=re.I).strip()      # 1: 封面图
    if cover.startswith("!["):
        m = re.search(r"!\[.*?\]\((.*?)\)", cover)
        cover = m.group(1).strip() if m else ""

    modified_time = line(2)                       # 2: 时间
    category = line(3)                            # 3: 分类
    tags = list(dict.fromkeys(t.strip() for t in re.split(r"[,，]", line(4)) if t.strip()))   # 4: 标签

    article_title = (line(5).lstrip("#").strip() if len(lines) > 5 else page_title) or page_title   # 5

    body_lines, checklist_md = extract_checklist(lines[6:])      # 6+: 正文（检查列表单独取出，显示在右侧栏）
    body = markdown("\n".join(body_lines))
    body = re.sub(r"<img\b(?![^>]*\bloading=)", '<img loading="lazy" decoding="async"', body)   # 图片懒加载
    body, toc = add_heading_ids(body)
    word_count, read_minutes = count_words(strip_tags(body))

    return {
        "filename": filename,
        "url": "/post/" + quote(post_out_name(filename)),
        "title": page_title,
        "cover": cover or None,
        "modified_time": modified_time,
        "category": category,
        "tags": tags,
        "tags_str": ",".join(tags),
        "article_title": article_title,
        "content": body,
        "toc": toc,
        "excerpt": make_excerpt(body),
        "word_count": word_count,
        "read_minutes": read_minutes,
        "checklist": markdown(checklist_md) if checklist_md else "",
        "date": parse_date(modified_time),
    }


def get_posts():
    if not os.path.isdir(POSTS_DIR):
        print(f"⚠️  未找到文章目录：{POSTS_DIR}")
        return []
    posts = [parse_post(os.path.join(POSTS_DIR, f))
             for f in sorted(os.listdir(POSTS_DIR))
             if f.endswith(".md") and not f.startswith("_")]
    posts.sort(key=lambda p: p["date"], reverse=True)
    return posts


# ------------------------------------------------------------------ 分类页
def categories_from_posts(posts):
    groups = {}
    for p in posts:                               # posts 已按时间倒序
        groups.setdefault(p["category"] or UNCATEGORIZED, []).append({"name": p["title"], "href": p["url"]})
    return [{"name": k, "articles": v} for k, v in groups.items()]


def categories_from_md(text):
    """解析 categories.md：# 分类名 / ## [标题](链接)。"""
    cats, current = [], None
    for raw in text.splitlines():
        h1, h2 = re.match(r"^#\s+(.+)", raw), re.match(r"^##\s+(.+)", raw)
        if h1:
            current = {"name": h1.group(1).strip(), "articles": []}
            cats.append(current)
        elif h2 and current is not None:
            item = h2.group(1).strip()
            link = re.search(r"\[(.+?)\]\((.+?)\)", item)
            current["articles"].append({"name": link.group(1), "href": link.group(2)} if link
                                       else {"name": item, "href": "#"})
    return cats


def get_categories(posts):
    if os.path.exists(CATEGORIES_MD):
        with open(CATEGORIES_MD, encoding="utf-8-sig") as f:
            return categories_from_md(f.read())
    return categories_from_posts(posts)


# ------------------------------------------------------------------ SEO 文件
def build_sitemap(posts):
    base = SITE["url"].rstrip("/")
    urls = [("/", None)] + [(f"/{p}.html", None) for p in ("categories", "about", "contact")]
    urls += [(p["url"], p["date"]) for p in posts]
    items = []
    for path, d in urls:
        lastmod = f"<lastmod>{d:%Y-%m-%d}</lastmod>" if d and d != datetime.min else ""
        items.append(f"  <url><loc>{xml_escape(base + path)}</loc>{lastmod}</url>")
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "\n".join(items) + "\n</urlset>\n")


def build_rss(posts):
    base = SITE["url"].rstrip("/")
    items = []
    for p in posts[:20]:
        link = xml_escape(base + p["url"])
        pub = f"<pubDate>{format_datetime(p['date'].replace(tzinfo=timezone.utc))}</pubDate>" if p["date"] != datetime.min else ""
        items.append(f"    <item><title>{xml_escape(p['title'])}</title><link>{link}</link>"
                     f"<guid>{link}</guid>{pub}<description>{xml_escape(p['excerpt'])}</description></item>")
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>\n'
            f"  <title>{xml_escape(SITE['name'])}</title><link>{xml_escape(base)}/</link>"
            f"<description>{xml_escape(SITE['description'])}</description>\n" + "\n".join(items) + "\n  </channel></rss>\n")


# ------------------------------------------------------------------ 样式合并
def bundle_css():
    """static/css/*.css 按文件名排序合并；去掉注释与多余空白（保守压缩，不改选择器）。"""
    if not os.path.isdir(CSS_DIR):
        return ""
    parts = []
    for name in sorted(os.listdir(CSS_DIR)):
        if name.endswith(".css"):
            with open(os.path.join(CSS_DIR, name), encoding="utf-8-sig") as f:
                parts.append(f.read())
    css = "\n".join(parts)
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    css = re.sub(r"\s*\n\s*", "\n", css)
    return css.strip() + "\n"


# ------------------------------------------------------------------ 首页数据
def index_context(posts):
    """首页侧栏：分类计数 / 标签数 / 最近更新。"""
    counts = {}
    for p in posts:
        key = p["category"] or UNCATEGORIZED
        counts[key] = counts.get(key, 0) + 1
    cats = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    tags = {t for p in posts for t in p["tags"]}
    return {
        "index_categories": [{"name": k, "count": v} for k, v in cats],
        "tag_count": len(tags),
        "latest": posts[0]["modified_time"] if posts else "",
    }


# ------------------------------------------------------------------ 构建
def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def build():
    if os.path.exists(DIST_DIR):
        shutil.rmtree(DIST_DIR)
    os.makedirs(os.path.join(DIST_DIR, "post"), exist_ok=True)

    if os.path.isdir(STATIC_DIR):
        shutil.copytree(STATIC_DIR, os.path.join(DIST_DIR, "static"), ignore=shutil.ignore_patterns("css", "themes"))
    write(os.path.join(DIST_DIR, "static", "style.css"), bundle_css())
    write(os.path.join(DIST_DIR, "static", "pygments.css"), pygments_css())

    env = Environment(loader=FileSystemLoader(TEMPLATES_DIR),
                      autoescape=select_autoescape(["html", "xml"]))
    env.globals["SITE"] = SITE
    env.globals["now_year"] = datetime.now().year
    posts = get_posts()

    # 1. 首页
    write(os.path.join(DIST_DIR, "index.html"),
          env.get_template("index.html").render(page="index", posts=posts, **index_context(posts)))

    # 2. 文章页
    post_tpl = env.get_template("post.html")
    for p in posts:
        write(os.path.join(DIST_DIR, "post", post_out_name(p["filename"])),
              post_tpl.render(page="post", **p))

    # 3. 独立页面
    built = 0
    for page in PAGES:
        try:
            tpl = env.get_template(f"{page}.html")
        except TemplateNotFound:
            print(f"⚠️  跳过：缺少模板 {page}.html")
            continue
        ctx = {"page": page, "title": page.capitalize(), "posts": posts}
        if page == "categories":
            ctx["categories"] = get_categories(posts)
        write(os.path.join(DIST_DIR, f"{page}.html"), tpl.render(**ctx))
        built += 1

    # 4. 管理后台（单页应用，不进 sitemap，禁止收录）
    try:
        write(os.path.join(DIST_DIR, "admin.html"), env.get_template("admin.html").render(page="admin"))
    except TemplateNotFound:
        pass

    # 5. SEO 文件（需要在 SITE["url"] 里配置站点地址）
    robots = "User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n"
    if SITE["url"]:
        write(os.path.join(DIST_DIR, "sitemap.xml"), build_sitemap(posts))
        write(os.path.join(DIST_DIR, "rss.xml"), build_rss(posts))
        robots += f"Sitemap: {SITE['url'].rstrip('/')}/sitemap.xml\n"
    write(os.path.join(DIST_DIR, "robots.txt"), robots)

    print(f"✅ Build complete! {len(posts)} posts + {built} pages → {os.path.relpath(DIST_DIR)}/")
    if not HAS_PYGMENTS:
        print("ℹ️  未安装 pygments，代码块不会高亮（pip install pygments）")


if __name__ == "__main__":
    build()