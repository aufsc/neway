#!/usr/bin/env python3
"""生成 new way 品牌素材：bg-light.svg / bg-dark.svg / logo.svg / avatar.svg（纯路径，不依赖字体）。
改配色或字形后运行： python tools/make_assets.py
"""
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "static")

# 自绘几何字母：每个字母 70 宽 × 100 高，圆头圆角描边
GLYPH = {
    "N": "M0 100 L0 0 L70 100 L70 0",
    "E": "M70 0 H0 V100 H70 M0 50 H54",
    "W": "M0 0 L17 100 L35 24 L53 100 L70 0",
    "A": "M0 100 L35 0 L70 100 M13 68 H57",
    "Y": "M0 0 L35 50 L70 0 M35 50 V100",
}


def word(text, pitch=100):
    return "".join(f'<path transform="translate({i * pitch} 0)" d="{GLYPH[c]}"/>' for i, c in enumerate(text))


def bg(dark):
    if dark:
        base = "#0a0f1f"
        blobs = [("#3550d8", .55, 330, 190, 560), ("#7a3fd1", .38, 1360, 250, 520), ("#0f8f9c", .34, 980, 930, 620)]
        c1, c2, op, dot, route = "#8aa2ff", "#3dd6d0", .22, "#9fb2ff", "#7c96ff"
    else:
        base = "#edf1fb"
        blobs = [("#b4c8ff", .85, 330, 190, 560), ("#d8c8ff", .75, 1360, 250, 520), ("#b6ecef", .8, 980, 930, 620)]
        c1, c2, op, dot, route = "#5b7cff", "#1fb5c0", .17, "#5b7cff", "#5b7cff"
    defs = "".join(
        f'<radialGradient id="b{i}"><stop offset="0" stop-color="{c}" stop-opacity="{a}"/>'
        f'<stop offset="1" stop-color="{c}" stop-opacity="0"/></radialGradient>'
        for i, (c, a, *_r) in enumerate(blobs))
    circles = "".join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="url(#b{i})"/>'
                      for i, (_c, _a, x, y, r) in enumerate(blobs))
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
<defs>{defs}
<linearGradient id="ink" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/></linearGradient>
<pattern id="dots" width="36" height="36" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.4" fill="{dot}" opacity=".22"/></pattern></defs>
<rect width="1600" height="1000" fill="{base}"/>{circles}
<rect width="1600" height="1000" fill="url(#dots)"/>
<g fill="none" stroke="url(#ink)" stroke-linecap="round" stroke-linejoin="round">
  <g transform="translate(70 100) rotate(-6) scale(3.1)" stroke-width="9" opacity="{op}">{word("NEW")}</g>
  <g transform="translate(70 100) rotate(-6) scale(3.1) translate(7 7)" stroke-width="1.4" stroke-dasharray="2 7" opacity="{op * 1.6:.2f}">{word("NEW")}</g>
  <g transform="translate(700 560) rotate(-6) scale(3.1)" stroke-width="9" opacity="{op}">{word("WAY")}</g>
  <g transform="translate(700 560) rotate(-6) scale(3.1) translate(7 7)" stroke-width="1.4" stroke-dasharray="2 7" opacity="{op * 1.6:.2f}">{word("WAY")}</g>
  <path d="M-40 880 C 260 700, 420 960, 720 780 S 1180 420, 1380 560 S 1560 300, 1660 160" stroke="{route}" stroke-width="2" stroke-dasharray="3 10" opacity=".5"/>
</g>
<g fill="{route}" opacity=".55"><circle cx="720" cy="780" r="5"/><circle cx="1380" cy="560" r="5"/><circle cx="260" cy="760" r="3.5"/></g>
</svg>
'''


def mark(shape):
    """new way 标：N 字 + 一条通向圆点的路径。"""
    if shape == "square":
        back = '<rect width="64" height="64" rx="18" fill="url(#g)"/>'
    else:
        back = '<circle cx="32" cy="32" r="32" fill="url(#g)"/>'
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="new way">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f6bff"/><stop offset="1" stop-color="#1fb5c0"/></linearGradient></defs>
{back}
<g fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round">
<path d="M20 43 V20 L44 43 V20" stroke-width="6"/>
<path d="M13 52 C 25 58, 40 58, 51 49" stroke-width="3" opacity=".85"/></g>
<circle cx="52.5" cy="47.8" r="3.2" fill="#fff"/></svg>
'''


if __name__ == "__main__":
    files = {"bg-light.svg": bg(False), "bg-dark.svg": bg(True),
             "logo.svg": mark("square"), "avatar.svg": mark("circle")}
    for name, svg in files.items():
        with open(os.path.join(OUT, name), "w", encoding="utf-8", newline="\n") as f:
            f.write(svg)
        print("wrote", name)
