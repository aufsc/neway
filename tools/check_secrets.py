#!/usr/bin/env python3
"""推送到 GitHub 之前运行：python tools/check_secrets.py
检查 ① 是否有应被忽略的敏感文件被 git 跟踪 ② 将被提交的文件里是否含密钥特征 ③ wrangler.toml 里是否写了真实邮箱。
有问题时退出码为 1（可挂到 .git/hooks/pre-push）。
"""
import os, re, subprocess, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
os.chdir(ROOT)


def tracked():
    try:
        out = subprocess.run(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], capture_output=True, check=True).stdout
    except Exception:
        print("请在 git 仓库里运行（先 git init）"); sys.exit(2)
    return [f for f in out.decode("utf-8", "replace").split("\0") if f]


FORBIDDEN = [r"(^|/)\.dev\.vars$", r"\.sqlite3?$", r"(^|/)\.local/", r"(^|/)\.wrangler/", r"(^|/)dist/", r"\.pem$", r"\.key$", r"(^|/)\.env($|\.)"]
SECRET = re.compile(r"(github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|\bre_[A-Za-z0-9]{20,}|\bSCT[0-9A-Za-z]{20,}|AKIA[0-9A-Z]{16}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|\d{8,}:AA[A-Za-z0-9_-]{30,}|hooks\.slack\.com/services/\S+|qyapi\.weixin\.qq\.com/cgi-bin/webhook/send\?key=\S+|open\.feishu\.cn/open-apis/bot/v2/hook/\S+|oapi\.dingtalk\.com/robot/send\?access_token=\S+)")
EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
PLACEHOLDER = re.compile(r"example\.com|xxxx\.org|yourname|你的|your@")

bad = 0
files = tracked()
for f in files:
    if any(re.search(p, f) for p in FORBIDDEN):
        print(f"❌ 敏感文件会被提交：{f}（请加入 .gitignore，若已提交过需从历史中清除）"); bad += 1
for f in files:
    if f.startswith("static/themes/"): continue
    try: lines = open(f, encoding="utf-8").read().split("\n")
    except Exception: continue
    for i, l in enumerate(lines, 1):
        if SECRET.search(l):
            print(f"❌ 疑似密钥 {f}:{i}: {l.strip()[:70]}…"); bad += 1
        if f in ("wrangler.toml", ".github/workflows/deploy.yml") and not l.lstrip().startswith("#"):
            for m in EMAIL.findall(l):
                if not PLACEHOLDER.search(m):
                    print(f"⚠️  {f}:{i} 含真实邮箱 {m}（公开仓库会被爬取，建议改用 Cloudflare Secret）"); bad += 1
print("✅ 未发现问题" if not bad else f"\n共 {bad} 处需要处理")
sys.exit(1 if bad else 0)
