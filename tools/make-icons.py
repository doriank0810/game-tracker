#!/usr/bin/env python3
"""Draw the app icons into icons/ (needs Pillow: pip install pillow).

Run from anywhere:  python3 tools/make-icons.py
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"
TOP = (20, 26, 38)
BOTTOM = (9, 12, 18)
TRACK = (38, 47, 64)
ACCENT = (90, 209, 192)
INK = (232, 235, 241)
SS = 4  # supersampling for smooth edges


def draw(size, glyph=1.0):
    s = size * SS
    im = Image.new("RGB", (s, s), BOTTOM)
    d = ImageDraw.Draw(im)
    for y in range(s):  # soft vertical gradient
        t = y / (s - 1)
        d.line([(0, y), (s, y)], fill=tuple(round(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3)))

    cx = cy = s / 2
    r = s * 0.30 * glyph  # outer radius of the ring
    w = s * 0.075 * glyph  # ring thickness
    box = [cx - r, cy - r, cx + r, cy + r]
    d.arc(box, 0, 360, fill=TRACK, width=round(w))
    d.arc(box, -90, 180, fill=ACCENT, width=round(w))  # 3/4 progress ring
    mid = r - w / 2
    for ang in (-90, 180):  # round caps
        x = cx + mid * math.cos(math.radians(ang))
        y = cy + mid * math.sin(math.radians(ang))
        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=ACCENT)

    pts = [(cx - r * 0.40, cy + r * 0.02), (cx - r * 0.10, cy + r * 0.32), (cx + r * 0.42, cy - r * 0.28)]
    lw = w * 0.9
    d.line(pts, fill=INK, width=round(lw), joint="curve")
    for x, y in (pts[0], pts[-1]):
        d.ellipse([x - lw / 2, y - lw / 2, x + lw / 2, y + lw / 2], fill=INK)
    return im.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(exist_ok=True)
    draw(192).save(OUT / "icon-192.png", optimize=True)
    draw(512).save(OUT / "icon-512.png", optimize=True)
    draw(512, glyph=0.82).save(OUT / "icon-maskable-512.png", optimize=True)
    draw(180).save(OUT / "apple-touch-icon.png", optimize=True)
    draw(32, glyph=1.35).save(OUT / "favicon-32.png", optimize=True)
    print("Icons written to", OUT)


if __name__ == "__main__":
    main()
