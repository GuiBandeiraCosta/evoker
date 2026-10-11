#!/usr/bin/env python3
"""Renders the 1024 x 1024 AppIcon of the iOS app (Pillow only).

    python Tools/make-icon.py

The Evoker figure of the original client (Evoker Web/assets/orig/ui/evoker.png, the caped figure of the title
intro) stands over a dark blue-slate background (tokens.css --darkblue #1f2f3c) blended with a crop of the title
key art (Evoker Web/assets/bg/title.jpg: the dragon's head and fire breath), darkened and vignetted so the figure
reads at small sizes. The result is written without an alpha channel, as iOS icons require, to
Evoker/Assets.xcassets/AppIcon.appiconset/AppIcon.png (its Contents.json already references the file).
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

HERE = Path(__file__).resolve().parent
IOS_ROOT = HERE.parent
WEB = IOS_ROOT.parent / "Evoker Web"
FIGURE = WEB / "assets" / "orig" / "ui" / "evoker.png"
KEY_ART = WEB / "assets" / "bg" / "title.jpg"
OUT = IOS_ROOT / "Evoker" / "Assets.xcassets" / "AppIcon.appiconset" / "AppIcon.png"

SIZE = 1024
DARK_BLUE = (31, 47, 60)      # --darkblue #1f2f3c
EDGE = (10, 16, 22)           # vignette colour (near --panel-inset)
PAINT_CROP = (420, 40, 1444, 1064)   # the dragon head + fire of title.jpg (1536 x 1760), a 1024 px square
FIGURE_WIDTH = 760            # the figure spans ~74 % of the icon
FIGURE_BOTTOM_MARGIN = 96


def radial_mask(size: int, inner: float, outer: float) -> Image.Image:
    """Grayscale mask: 0 inside `inner` (fraction of the half-diagonal), 255 beyond `outer`, smooth between."""
    mask = Image.new("L", (size, size), 0)
    px = mask.load()
    half = size / 2
    diag = math.hypot(half, half)
    for y in range(size):
        dy = (y + 0.5 - half)
        for x in range(size):
            d = math.hypot(x + 0.5 - half, dy) / diag
            t = (d - inner) / (outer - inner)
            t = 0.0 if t < 0 else 1.0 if t > 1 else t
            px[x, y] = int(255 * (t * t * (3 - 2 * t)))  # smoothstep
    return mask


def build_background() -> Image.Image:
    paint = Image.open(KEY_ART).convert("RGB").crop(PAINT_CROP).resize((SIZE, SIZE), Image.LANCZOS)
    slate = Image.new("RGB", (SIZE, SIZE), DARK_BLUE)
    bg = Image.blend(paint, slate, 0.5)
    bg = ImageEnhance.Brightness(bg).enhance(0.85)
    bg = ImageEnhance.Color(bg).enhance(0.9)
    # vignette: darken towards the corners
    edge = Image.new("RGB", (SIZE, SIZE), EDGE)
    bg = Image.composite(edge, bg, radial_mask(SIZE, 0.45, 1.05))
    # a dark ground band so the figure stands on something
    ground = Image.new("L", (SIZE, SIZE), 0)
    draw = ImageDraw.Draw(ground)
    for y in range(SIZE - 260, SIZE):
        a = int(255 * min(1.0, (y - (SIZE - 260)) / 260.0) * 0.75)
        draw.line([(0, y), (SIZE, y)], fill=a)
    bg = Image.composite(edge, bg, ground)
    return bg


def place_figure(bg: Image.Image) -> Image.Image:
    fig = Image.open(FIGURE).convert("RGBA")
    scale = FIGURE_WIDTH / fig.width
    fig = fig.resize((FIGURE_WIDTH, int(round(fig.height * scale))), Image.LANCZOS)
    x = (SIZE - fig.width) // 2
    y = SIZE - fig.height - FIGURE_BOTTOM_MARGIN
    canvas = bg.convert("RGBA")
    # soft shadow under the figure
    shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    alpha = fig.getchannel("A").point(lambda a: int(a * 0.7))
    shadow.paste((0, 0, 0, 255), (x + 10, y + 22), alpha)
    shadow = shadow.filter(ImageFilter.GaussianBlur(26))
    canvas = Image.alpha_composite(canvas, shadow)
    # a warm glow behind the figure (the title screen's lightning light)
    glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    gdraw.ellipse((SIZE // 2 - 330, y + 40, SIZE // 2 + 330, y + fig.height + 60), fill=(255, 170, 60, 70))
    glow = glow.filter(ImageFilter.GaussianBlur(90))
    canvas = Image.alpha_composite(canvas, glow)
    layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    layer.paste(fig, (x, y), fig)
    canvas = Image.alpha_composite(canvas, layer)
    return canvas.convert("RGB")


def main() -> int:
    for p in (FIGURE, KEY_ART):
        if not p.exists():
            print(f"FAIL missing {p}", file=sys.stderr)
            return 1
    icon = place_figure(build_background())
    if icon.size != (SIZE, SIZE) or icon.mode != "RGB":
        print("FAIL unexpected icon format", file=sys.stderr)
        return 1
    OUT.parent.mkdir(parents=True, exist_ok=True)
    icon.save(OUT, format="PNG", optimize=True)
    print(f"wrote {OUT.relative_to(IOS_ROOT)} ({SIZE}x{SIZE}, {OUT.stat().st_size // 1024} KB, no alpha)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
