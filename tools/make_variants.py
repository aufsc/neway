#!/usr/bin/env python3
"""生成多款 new way 背景 / 头像候选，输出到 static/themes/，并生成可直接打开的 gallery.html。
挑好后，把选中的文件复制为 static/bg-light.svg、static/bg-dark.svg、static/avatar.svg、static/logo.svg 即可
（或运行：python tools/make_variants.py --apply 背景名 头像名）。
"""
import base64
import os
import shutil
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "static", "themes")
os.makedirs(OUT, exist_ok=True)

UP = {  # 大写字母，70 宽 × 100 高
    "N": "M0 100 L0 0 L70 100 L70 0", "E": "M70 0 H0 V100 H70 M0 50 H54",
    "W": "M0 0 L17 100 L35 24 L53 100 L70 0", "A": "M0 100 L35 0 L70 100 M13 68 H57",
    "Y": "M0 0 L35 50 L70 0 M35 50 V100",
}
LO = {  # 小写字母，x-height 70（y 30~100），带下伸的 y 到 125
    "n": "M5 100 V30 M5 55 Q5 30 30 30 Q55 30 55 55 V100",
    "e": "M5 65 H55 C55 40 42 30 30 30 C12 30 5 46 5 65 C5 85 14 100 32 100 C44 100 52 94 56 86",
    "w": "M0 30 L15 100 L30 50 L45 100 L60 30",
    "a": "M50 65 A24 35 0 1 0 2 65 A24 35 0 1 0 50 65 M50 30 V100",
    "y": "M2 30 L28 100 M54 30 L28 100 L16 125",
}


def word(text, table, pitch):
    out, x = [], 0
    for c in text:
        if c == " ":
            x += pitch * 0.55
            continue
        out.append(f'<path transform="translate({x:.0f} 0)" d="{table[c]}"/>')
        x += pitch
    return "".join(out)


# ============================================================ 背景
PAL = {
    "light": dict(base="#edf1fb", c1="#5b7cff", c2="#1fb5c0", dot="#5b7cff", glass="255,255,255", op=.17,
                  blobs=[("#b4c8ff", .85), ("#d8c8ff", .75), ("#b6ecef", .8)]),
    "dark": dict(base="#0a0f1f", c1="#8aa2ff", c2="#3dd6d0", dot="#9fb2ff", glass="30,40,78", op=.22,
                 blobs=[("#3550d8", .55), ("#7a3fd1", .38), ("#0f8f9c", .34)]),
}


def head(p, extra=""):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">'
            f'<defs><linearGradient id="ink" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{p["c1"]}"/>'
            f'<stop offset="1" stop-color="{p["c2"]}"/></linearGradient>{extra}</defs>'
            f'<rect width="1600" height="1000" fill="{p["base"]}"/>')


def blobs(p, pts=((330, 190, 560), (1360, 250, 520), (980, 930, 620))):
    d = "".join(f'<radialGradient id="b{i}"><stop offset="0" stop-color="{c}" stop-opacity="{a}"/>'
                f'<stop offset="1" stop-color="{c}" stop-opacity="0"/></radialGradient>' for i, (c, a) in enumerate(p["blobs"]))
    c = "".join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="url(#b{i})"/>' for i, (x, y, r) in enumerate(pts))
    return d, c


def bg_letters(p):
    d, c = blobs(p)
    return head(p, d + f'<pattern id="dots" width="36" height="36" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.4" fill="{p["dot"]}" opacity=".22"/></pattern>') + c + f'''
<rect width="1600" height="1000" fill="url(#dots)"/>
<g fill="none" stroke="url(#ink)" stroke-linecap="round" stroke-linejoin="round">
<g transform="translate(70 100) rotate(-6) scale(3.1)" stroke-width="9" opacity="{p["op"]}">{word("NEW", UP, 100)}</g>
<g transform="translate(700 560) rotate(-6) scale(3.1)" stroke-width="9" opacity="{p["op"]}">{word("WAY", UP, 100)}</g>
<path d="M-40 880 C 260 700, 420 960, 720 780 S 1180 420, 1380 560 S 1560 300, 1660 160" stroke="{p["c1"]}" stroke-width="2" stroke-dasharray="3 10" opacity=".5"/></g></svg>'''


def bg_waves(p):
    d, c = blobs(p, ((250, 150, 520), (1400, 120, 480), (900, 900, 600)))
    gr = "".join(f'<linearGradient id="w{i}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="{p["c1"]}" stop-opacity="{.10 + i * .03:.2f}"/>'
                 f'<stop offset="1" stop-color="{p["c2"]}" stop-opacity="{.14 + i * .03:.2f}"/></linearGradient>' for i in range(5))
    waves = "".join(
        f'<path d="M0 {470 + i * 100} C 380 {390 + i * 100}, 760 {560 + i * 100}, 1160 {460 + i * 100} S 1500 {420 + i * 100}, 1600 {470 + i * 100} V1000 H0 Z" fill="url(#w{i})"/>'
        for i in range(5))
    return head(p, d + gr) + c + waves + f'''
<g fill="none" stroke="url(#ink)" stroke-linecap="round" stroke-linejoin="round" opacity="{p["op"] * .9:.2f}" transform="translate(90 150) rotate(-4) scale(3.3)" stroke-width="8">{word("new way", LO, 80)}</g></svg>'''


def bg_map(p):
    d, c = blobs(p, ((300, 800, 560), (1000, 300, 560), (1450, 800, 480)))
    nodes = [("N", 160, 780), ("E", 420, 640), ("W", 700, 720), ("W", 960, 480), ("A", 1240, 560), ("Y", 1480, 300)]
    route = "M160 780 C 300 700, 300 660, 420 640 S 600 740, 700 720 S 880 500, 960 480 S 1160 600, 1240 560 S 1400 340, 1480 300"
    circles = "".join(
        f'<g transform="translate({x} {y})"><circle r="40" fill="rgba({p["glass"]},.55)" stroke="{p["c1"]}" stroke-opacity=".5" stroke-width="2"/>'
        f'<g transform="translate(-14 -20) scale(.4)" fill="none" stroke="url(#ink)" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"><path d="{UP[l]}"/></g></g>'
        for l, x, y in nodes)
    return head(p, d + f'<pattern id="dots" width="36" height="36" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.4" fill="{p["dot"]}" opacity=".25"/></pattern>') + c + f'''
<rect width="1600" height="1000" fill="url(#dots)"/>
<path d="{route}" fill="none" stroke="{p["c1"]}" stroke-width="3" stroke-dasharray="2 12" stroke-linecap="round" opacity=".6"/>{circles}</svg>'''


def bg_tile(p):
    d, c = blobs(p)
    tile = (f'<pattern id="t" width="340" height="170" patternUnits="userSpaceOnUse" patternTransform="rotate(-16)">'
            f'<g fill="none" stroke="url(#ink)" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" opacity="{p["op"] * 1.9:.2f}">'
            f'<g transform="translate(10 40) scale(.21)">{word("new way", LO, 80)}</g>'
            f'<g transform="translate(150 115) scale(.21)">{word("new way", LO, 80)}</g></g></pattern>')
    return head(p, d + tile) + c + '<rect width="1600" height="1000" fill="url(#t)"/></svg>'


def bg_sunrise(p, mode):
    if mode == "light":
        top, bot, sun, ring, op = "#e4dcff", "#ffe4d4", "#ffb48a", "#ff9f7a", .35
    else:
        top, bot, sun, ring, op = "#140f2a", "#2a1740", "#ff7a59", "#ff9f7a", .30
    rings = "".join(f'<circle cx="800" cy="1060" r="{r}" fill="none" stroke="{ring}" stroke-opacity="{op - i * .04:.2f}" stroke-width="2"/>'
                    for i, r in enumerate(range(260, 1200, 150)))
    stroke = "#ffffff" if mode == "light" else "#ffd9c4"
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice"><defs>'
            f'<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{top}"/><stop offset="1" stop-color="{bot}"/></linearGradient>'
            f'<radialGradient id="sun"><stop offset="0" stop-color="{sun}" stop-opacity=".95"/><stop offset="1" stop-color="{sun}" stop-opacity="0"/></radialGradient></defs>'
            f'<rect width="1600" height="1000" fill="url(#sky)"/><circle cx="800" cy="1000" r="560" fill="url(#sun)"/>{rings}'
            f'<g fill="none" stroke="{stroke}" stroke-linecap="round" stroke-linejoin="round" opacity=".55" transform="translate(120 130) scale(2.2)" stroke-width="9">{word("new day", LO, 80) if False else word("new way", LO, 80)}</g></svg>')


def bg_minimal(p):
    return head(p, f'<pattern id="ln" width="40" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0 V40" stroke="{p["dot"]}" stroke-opacity=".10" stroke-width="1"/></pattern>') + f'''
<rect width="1600" height="1000" fill="url(#ln)"/>
<g fill="none" stroke="url(#ink)" stroke-linecap="round" stroke-linejoin="round" opacity="{p["op"] * .8:.2f}" transform="translate(1040 90) scale(6 7)" stroke-width="20"><path d="{UP["N"]}"/></g>
<circle cx="260" cy="760" r="6" fill="{p["c1"]}" opacity=".6"/><path d="M260 760 C 420 640, 560 880, 760 700" fill="none" stroke="{p["c1"]}" stroke-width="2" stroke-dasharray="3 10" opacity=".5"/></svg>'''


BGS = {
    "letters": ("字标极光（当前）", lambda p, m: bg_letters(p)),
    "waves": ("层叠波浪", lambda p, m: bg_waves(p)),
    "map": ("路线节点图", lambda p, m: bg_map(p)),
    "tile": ("斜铺小字平铺", lambda p, m: bg_tile(p)),
    "sunrise": ("日出（暖色）", bg_sunrise),
    "minimal": ("极简大 N", lambda p, m: bg_minimal(p)),
}


# ============================================================ 头像 / logo
def shape(kind, fill):
    return (f'<rect width="64" height="64" rx="18" {fill}/>' if kind == "square" else f'<circle cx="32" cy="32" r="32" {fill}/>')


def svg64(defs, body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="new way"><defs>{defs}</defs>{body}</svg>\n'


def grad(i, a, b, vertical=False):
    xy = 'x1="0" y1="0" x2="0" y2="1"' if vertical else 'x1="0" y1="0" x2="1" y2="1"'
    return f'<linearGradient id="{i}" {xy}><stop offset="0" stop-color="{a}"/><stop offset="1" stop-color="{b}"/></linearGradient>'


def av_way(k):
    return svg64(grad("g", "#4f6bff", "#1fb5c0"), shape(k, 'fill="url(#g)"') + '<g fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round"><path d="M20 43 V20 L44 43 V20" stroke-width="6"/><path d="M13 52 C 25 58, 40 58, 51 49" stroke-width="3" opacity=".85"/></g><circle cx="52.5" cy="47.8" r="3.2" fill="#fff"/>')


def av_mono(k):
    s = .22
    letters = "".join(f'<path transform="translate({8 + i * 17.2:.1f} 0)" d="{LO[c]}"/>' for i, c in enumerate("new"))
    return svg64(grad("g", "#101a3a", "#1a2a5c", True) + grad("s", "#8aa2ff", "#3dd6d0"),
                 shape(k, 'fill="url(#g)"') + f'<g transform="translate(0 15) scale(1) "><g transform="scale({s}) translate(36 0)" fill="none" stroke="url(#s)" stroke-width="13" stroke-linecap="round" stroke-linejoin="round">'
                 + "".join(f'<path transform="translate({i * 80} 0)" d="{LO[c]}"/>' for i, c in enumerate("new")) + '</g></g>'
                 '<path d="M14 49 C 26 54, 40 54, 50 47" fill="none" stroke="url(#s)" stroke-width="2.6" stroke-linecap="round"/>')


def av_sunrise(k):
    return svg64(grad("g", "#6a5cff", "#ff9d6c", True) + '<clipPath id="c"><rect x="0" y="0" width="64" height="44"/></clipPath>',
                 shape(k, 'fill="url(#g)"') + '<g clip-path="url(#c)"><circle cx="32" cy="44" r="13" fill="#fff" opacity=".95"/>'
                 '<g stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".8"><path d="M32 22 V16"/><path d="M15 29 L11 25"/><path d="M49 29 L53 25"/></g></g>'
                 '<path d="M10 47 C 20 41, 28 53, 38 47 S 54 43, 56 47" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>'
                 '<path d="M16 55 H48" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".6"/>')


def av_dots(k):
    cells = {(0, r) for r in range(5)} | {(4, r) for r in range(5)} | {(1, 1), (2, 2), (3, 3)}
    dots = "".join(f'<circle cx="{16 + c * 8}" cy="{16 + r * 8}" r="{3 if (c, r) in {(1, 1), (2, 2), (3, 3)} else 2.6}" fill="{"url(#s)" if (c, r) in {(1, 1), (2, 2), (3, 3)} else "#dbe4ff"}"/>'
                   for c, r in sorted(cells))
    return svg64(grad("g", "#0d1430", "#1b2552", True) + grad("s", "#3dd6d0", "#8aa2ff"), shape(k, 'fill="url(#g)"') + dots)


def av_path(k):
    return svg64(grad("g", "#f3f6ff", "#dfe8ff", True) + grad("s", "#4f6bff", "#1fb5c0"),
                 shape(k, 'fill="url(#g)"') + '<g transform="translate(18 8) scale(.46)" fill="none" stroke="url(#s)" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"><path d="' + LO["n"] + '"/></g>'
                 '<path d="M14 54 C 26 50, 40 56, 50 46" fill="none" stroke="url(#s)" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="1 5"/><circle cx="51.5" cy="44.8" r="3.4" fill="#1fb5c0"/>')


def av_orbit(k):
    return svg64(grad("g", "#0b1126", "#15204a", True) + grad("s", "#8aa2ff", "#3dd6d0"),
                 shape(k, 'fill="url(#g)"') + '<g fill="none" stroke="#8aa2ff" opacity=".35"><circle cx="32" cy="32" r="22"/><circle cx="32" cy="32" r="14" stroke-dasharray="2 4"/></g>'
                 '<path d="M24 41 V23 L40 41 V23" fill="none" stroke="url(#s)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="51" cy="22" r="3.6" fill="#3dd6d0"/>')


AVS = {"way": ("路径 N（当前）", av_way), "mono": ("小写 new 字标", av_mono), "sunrise": ("日出", av_sunrise),
       "dots": ("点阵 N", av_dots), "path": ("浅色 n 与路径", av_path), "orbit": ("轨道 N", av_orbit)}


def b64(svg):
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()


def write(name, text):
    with open(os.path.join(OUT, name), "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def build():
    cards_bg, cards_av = [], []
    for key, (label, fn) in BGS.items():
        l, d = fn(PAL["light"], "light"), fn(PAL["dark"], "dark")
        write(f"bg-{key}-light.svg", l)
        write(f"bg-{key}-dark.svg", d)
        cards_bg.append(f'<figure class="bg"><div class="pair"><img src="{b64(l)}" alt=""><img src="{b64(d)}" alt=""></div>'
                        f'<figcaption><b>{key}</b> · {label}</figcaption></figure>')
    for key, (label, fn) in AVS.items():
        a, lg = fn("circle"), fn("square")
        write(f"avatar-{key}.svg", a)
        write(f"logo-{key}.svg", lg)
        cards_av.append(f'<figure class="av"><div class="row"><img class="l" src="{b64(a)}" alt=""><img class="m" src="{b64(a)}" alt="">'
                        f'<img class="s" src="{b64(lg)}" alt=""></div><figcaption><b>{key}</b> · {label}</figcaption></figure>')
    html = f'''<!doctype html><meta charset="utf-8"><title>new way 背景与头像候选</title>
<style>body{{font:15px/1.6 system-ui,"PingFang SC","Microsoft YaHei",sans-serif;margin:0;padding:32px;background:#f4f6fb;color:#1b2340}}
h1{{margin:0 0 6px}}p.sub{{color:#5d6786;margin:0 0 28px}}h2{{margin:36px 0 14px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(520px,1fr));gap:22px}}
.pair{{display:grid;grid-template-columns:1fr 1fr;gap:0;border-radius:16px;overflow:hidden;box-shadow:0 8px 28px rgba(40,60,130,.15)}}
.pair img{{width:100%;aspect-ratio:16/10;object-fit:cover;display:block}}
figcaption{{margin-top:8px}}figure{{margin:0}}
.avs{{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:18px}}
.av .row{{display:flex;align-items:center;gap:18px;padding:18px;border-radius:16px;background:#fff;box-shadow:0 6px 20px rgba(40,60,130,.1)}}
.l{{width:96px;height:96px}}.m{{width:56px;height:56px}}.s{{width:40px;height:40px}}</style>
<h1>new way 背景与头像候选</h1><p class="sub">背景左为明色、右为暗色；头像依次为 96px / 56px 圆形与 40px 圆角方形 logo。告诉我编号即可套用。</p>
<h2>背景</h2><div class="grid">{"".join(cards_bg)}</div>
<h2>头像 + logo</h2><div class="avs">{"".join(cards_av)}</div>'''
    with open(os.path.join(ROOT, "tools", "gallery.html"), "w", encoding="utf-8") as f:
        f.write(html)
    print("候选已生成：static/themes/ 与 tools/gallery.html")


def apply(bg, av):
    for src, dst in ((f"bg-{bg}-light.svg", "bg-light.svg"), (f"bg-{bg}-dark.svg", "bg-dark.svg"),
                     (f"avatar-{av}.svg", "avatar.svg"), (f"logo-{av}.svg", "logo.svg")):
        shutil.copy(os.path.join(OUT, src), os.path.join(ROOT, "static", dst))
    print(f"已套用：背景 {bg} / 头像 {av}")


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "--apply":
        apply(sys.argv[2], sys.argv[3])
    else:
        build()
