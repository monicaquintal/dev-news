"""Gera os ícones PNG do app (Pillow). Uso: python3 scripts/make-icons.py"""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public")
C1, C2 = (99, 102, 241), (6, 182, 212)  # indigo -> ciano
SS = 1024  # supersampling


def background(rounded):
    img = Image.new("RGB", (SS, SS))
    px = [
        tuple(int(C1[k] + (C2[k] - C1[k]) * (x + y) / (2 * SS)) for k in range(3))
        for y in range(SS) for x in range(SS)
    ]
    img.putdata(px)
    img = img.convert("RGBA")
    if rounded:
        mask = Image.new("L", (SS, SS), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, SS - 1, SS - 1), radius=int(SS * 0.22), fill=255)
        img.putalpha(mask)
    return img


def stroke(d, pts, w, fill):
    for a, b in zip(pts, pts[1:]):
        d.line([a, b], fill=fill, width=w)
    r = w // 2
    for x, y in pts:
        d.ellipse((x - r, y - r, x + r, y + r), fill=fill)


def logo(rounded):
    img = background(rounded)
    d = ImageDraw.Draw(img)
    k = SS / 512
    s = lambda pts: [(x * k, y * k) for x, y in pts]
    w = int(38 * k)
    stroke(d, s([(205, 170), (125, 256), (205, 342)]), w, "white")
    stroke(d, s([(307, 170), (387, 256), (307, 342)]), w, "white")
    stroke(d, s([(282, 150), (230, 362)]), w, (254, 240, 138))  # barra em amarelo claro
    return img


def save(img, name, size):
    img.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, name), optimize=True)


rounded, square = logo(True), logo(False)
save(rounded, "icon-192.png", 192)
save(rounded, "icon-512.png", 512)
save(square, "icon-maskable-512.png", 512)
save(square, "apple-touch-icon.png", 180)
save(rounded, "favicon-32.png", 32)
print("ícones gerados em", OUT)
