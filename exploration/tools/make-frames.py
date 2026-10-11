#!/usr/bin/env python3
"""
Stitch the original client's nine-slice / three-slice sprites into single border-image PNGs.

Reads assets/orig/ui/<set>NN.png pieces and writes assets/orig/ui/frames/<set>.png laid out as a 3x3 grid
(top-left, top, top-right / left, centre, right / bottom-left, bottom, bottom-right), cropped to the frame
thickness so the CSS can use `border-image: url(...) <slice> / <slice>px`. Also composes frame+fill button
sprites (one image per variant) and the horizontal 3-slice progress bar tracks.

The piece order of every set is listed below (read off the sprites); the bright-pixel bounding box of each
piece is used to crop it relative to its bar and to cross-check the order (a note is printed on mismatch).
The slice widths are written to assets/orig/ui/frames/frames.json and printed.

Usage: python tools/make-frames.py            (dev-only; needs Pillow)
"""
import json
import os
import sys

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit('Pillow is required: pip install pillow')

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'assets', 'orig', 'ui')
OUT = os.path.join(ROOT, 'assets', 'orig', 'ui', 'frames')

# Piece order of each set (position of file 1, 2, 3... as read off the sprites):
#  hud_nineframe / glow*: 01 top-left, 02 top, 03 top-right, 04 left, 05 right, 06 bottom-left, 07 bottom, 08 bottom-right
#  ironframe: clockwise 01 top-left, 02 top, 03 top-right, 04 right, 05 bottom-right, 06 bottom, 07 bottom-left, 08 left, 09 centre
#  small_*: clockwise 1 top-left, 2 top (2x12), 3 top-right, 4 right (12x2), 5 bottom-right, 6 bottom, 7 bottom-left, 8 left
ORDER_8 = ['tl', 't', 'tr', 'l', 'r', 'bl', 'b', 'br']
ORDER_IRON = ['tl', 't', 'tr', 'r', 'br', 'b', 'bl', 'l', 'c']
ORDER_SMALL = ['tl', 't', 'tr', 'r', 'br', 'b', 'bl', 'l']

# set name -> (piece file names, positions, crop thickness px (None = whole tile), outer margin kept outside
# the bar when cropping, centre fill: 'sample' (colour baked into the pieces) | None)
NINE_SETS = {
    'hud_nineframe': ([f'hud_nineframe{i:02d}.png' for i in range(1, 9)], ORDER_8, 16, 2, None),
    'hud_nineframe_alpha': ([f'hud_nineframe{i:02d}_alpha.png' for i in range(1, 9)], ORDER_8, 16, 2, 'sample'),
    'ironframe': ([f'ironframe_{i:02d}.png' for i in range(1, 10)], ORDER_IRON, 10, 1, None),
    'glowgold': ([f'glowgold_nineframe{i:02d}.png' for i in range(1, 9)], ORDER_8, 26, 8, None),
    'glowblue': ([f'glowblue_nineframe{i:02d}.png' for i in range(1, 9)], ORDER_8, 26, 8, None),
    'glowred': ([f'glowred_nineframe{i:02d}.png' for i in range(1, 9)], ORDER_8, 26, 8, None),
    'small_white': ([f'small_white_{i}.png' for i in range(1, 9)], ORDER_SMALL, None, 0, None),
    'small_yellow': ([f'small_yellow_{i}.png' for i in range(1, 9)], ORDER_SMALL, None, 0, None),
}

# composite buttons: output name -> list of layers (bottom first), centred
COMPOSITES = {
    'button_default': ['button_default_fill.png', 'button_default_frame.png'],
    'button_green': ['button_default_green_fill.png', 'button_default_frame.png'],
    'button_danger': ['button_default_danger_fill.png', 'button_default_frame.png'],
    'button_inactive': ['button_default_fill_inactive.png', 'button_default_frame.png'],
    'quadbutton': ['hud_quadbutton_02_fill.png', 'hud_quadbutton_02_frame.png'],
    'quadbutton_inactive': ['hud_quadbutton_02_fill_inactive.png', 'hud_quadbutton_02_frame.png'],
    'quadbutton_shop': ['hud_quadbutton_02_fill_shop.png', 'hud_quadbutton_02_frame.png'],
    'bigbutton04': ['hud_bigbutton04_fill.png', 'hud_bigbutton04_frame.png'],
    'bigbutton04_inactive': ['hud_bigbutton04_fill_inactive.png', 'hud_bigbutton04_frame.png'],
    'bigbutton03': ['hud_bigbutton03_fill.png', 'hud_bigbutton03_frame.png'],
    'bigbutton03_inactive': ['hud_bigbutton03_fill_inactive.png', 'hud_bigbutton03_frame.png'],
    'bigbutton03_shop': ['hud_bigbutton03_shop.png', 'hud_bigbutton03_frame.png'],
    'smallbutton': ['hud_smallbutton_fill.png', 'hud_smallbutton_frame.png'],
    'backbutton': ['backbutton_fill.png', 'backbutton_frame.png'],
    'backbutton_inactive': ['backbutton_fill_inactive.png', 'backbutton_frame.png'],
    'infobutton': ['infobutton_fill.png', 'infobutton_frame.png'],
    'infobutton_inactive': ['infobutton_fill_inactive.png', 'infobutton_frame.png'],
    'menubar_button': ['menubar_button_fill_active.png', 'menubar_button_frame.png'],
    'menubar_button_inactive': ['menubar_button_fill_inactive.png', 'menubar_button_frame.png'],
    'resourcebar': ['resourcebar_fill_active.png', 'resourcebar_frame.png'],
    'resourcebar_inactive': ['resourcebar_fill_inactive.png', 'resourcebar_frame.png'],
    'moneybar': ['moneybar_fill_active.png', 'moneybar_frame.png'],
    'moneybar_inactive': ['moneybar_fill_inactive.png', 'moneybar_frame.png'],
}

# slice (px) for each composite, used by the CSS as border-image-slice
COMPOSITE_SLICE = {
    'button_default': 30, 'button_green': 30, 'button_danger': 30, 'button_inactive': 30,
    'quadbutton': 24, 'quadbutton_inactive': 24, 'quadbutton_shop': 24,
    'bigbutton04': 24, 'bigbutton04_inactive': 24,
    'bigbutton03': 24, 'bigbutton03_inactive': 24, 'bigbutton03_shop': 24,
    'smallbutton': 22, 'backbutton': 20, 'backbutton_inactive': 20, 'infobutton': 20, 'infobutton_inactive': 20,
    'menubar_button': 24, 'menubar_button_inactive': 24,
    'resourcebar': 20, 'resourcebar_inactive': 20, 'moneybar': 20, 'moneybar_inactive': 20,
}

# horizontal 3-slices: output -> (left, middle, right)
THREE_SLICES = {
    'progressbar': ('hud_progressbar_3sliceleft.png', 'hud_progressbar_3slice02.png', 'hud_progressbar_3sliceright.png'),
    'progressbar_knob': ('hud_progressbar_3slice01.png', 'hud_progressbar_3slice02.png', 'hud_progressbar_3slice03.png'),
}

POSITIONS = ['tl', 't', 'tr', 'l', 'c', 'r', 'bl', 'b', 'br']


def load(name):
    return Image.open(os.path.join(SRC, name)).convert('RGBA')


def bright_box(im, threshold=50):
    """Bounding box (x0, y0, x1, y1) of the pixels that are opaque and brighter than `threshold`, or None."""
    w, h = im.size
    px = im.load()
    minx, miny, maxx, maxy = w, h, -1, -1
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > 40 and max(r, g, b) > threshold:
                minx = min(minx, x); maxx = max(maxx, x)
                miny = min(miny, y); maxy = max(maxy, y)
    if maxx < 0:
        return None
    return (minx, miny, maxx + 1, maxy + 1)


def guess_position(im):
    """Rough position guess from the bright pixels (cross-check of the documented order only)."""
    w, h = im.size
    box = bright_box(im)
    if box is None:
        return 'c'
    # the bar sits on the side with the smaller margin (a corner's bars run to the far edges)
    left, right, top, bottom = box[0], w - box[2], box[1], h - box[3]
    if w != h:
        return ('t' if top < bottom else 'b') if w < h else ('l' if left < right else 'r')
    wide = (box[2] - box[0]) / w > 0.6
    tall = (box[3] - box[1]) / h > 0.6
    v = ('t' if top < bottom else 'b') if (wide or not tall) else ''
    hz = ('l' if left < right else 'r') if (tall or not wide) else ''
    return v + hz


def crop_rel(im, box):
    """Crop `box` (may exceed the image) onto a transparent canvas."""
    x0, y0, x1, y1 = box
    out = Image.new('RGBA', (x1 - x0, y1 - y0), (0, 0, 0, 0))
    sx0, sy0 = max(0, x0), max(0, y0)
    sx1, sy1 = min(im.size[0], x1), min(im.size[1], y1)
    if sx1 > sx0 and sy1 > sy0:
        out.alpha_composite(im.crop((sx0, sy0, sx1, sy1)), (sx0 - x0, sy0 - y0))
    return out


def crop_piece(im, pos, c, margin):
    """Crop a piece to thickness `c` measured from the bar's outer edge minus `margin` (keeps the glow halo)."""
    if c is None:
        return im
    w, h = im.size
    box = bright_box(im) or (0, 0, w, h)
    x0, y0, x1, y1 = 0, 0, w, h
    if 'l' in pos:
        x0 = box[0] - margin; x1 = x0 + c
    if 'r' in pos:
        x1 = box[2] + margin; x0 = x1 - c
    if 't' in pos:
        y0 = box[1] - margin; y1 = y0 + c
    if 'b' in pos:
        y1 = box[3] + margin; y0 = y1 - c
    return crop_rel(im, (x0, y0, x1, y1))


def stitch_nine(name, files, order, crop, margin, centre_mode):
    pieces = {}
    for f, pos in zip(files, order):
        im = load(f)
        guess = guess_position(im)
        if guess != pos:
            print(f'  note: {name}: {f} is used as {pos}, pixel guess says {guess}', file=sys.stderr)
        pieces[pos] = (f, im)
    missing = [p for p in POSITIONS if p != 'c' and p not in pieces]
    if missing:
        raise SystemExit(f'{name}: missing pieces for {missing}')
    tl = crop_piece(pieces['tl'][1], 'tl', crop, margin)
    t = crop_piece(pieces['t'][1], 't', crop, margin)
    tr = crop_piece(pieces['tr'][1], 'tr', crop, margin)
    l = crop_piece(pieces['l'][1], 'l', crop, margin)
    r = crop_piece(pieces['r'][1], 'r', crop, margin)
    bl = crop_piece(pieces['bl'][1], 'bl', crop, margin)
    b = crop_piece(pieces['b'][1], 'b', crop, margin)
    br = crop_piece(pieces['br'][1], 'br', crop, margin)
    cw = max(t.size[0], b.size[0])
    ch = max(l.size[1], r.size[1])
    left_w = max(tl.size[0], l.size[0], bl.size[0])
    right_w = max(tr.size[0], r.size[0], br.size[0])
    top_h = max(tl.size[1], t.size[1], tr.size[1])
    bot_h = max(bl.size[1], b.size[1], br.size[1])
    W = left_w + cw + right_w
    H = top_h + ch + bot_h
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    if centre_mode == 'sample':
        # inner corner of the top-left piece = the baked-in fill colour
        src = pieces['tl'][1]
        colour = src.getpixel((src.size[0] - 1, src.size[1] - 1))
        out.alpha_composite(Image.new('RGBA', (cw, ch), colour), (left_w, top_h))
    elif 'c' in pieces:
        out.alpha_composite(pieces['c'][1].resize((cw, ch)), (left_w, top_h))
    out.alpha_composite(tl, (0, 0))
    out.alpha_composite(t.resize((cw, t.size[1])), (left_w, 0))
    out.alpha_composite(tr, (left_w + cw, 0))
    out.alpha_composite(l.resize((l.size[0], ch)), (0, top_h))
    out.alpha_composite(r.resize((r.size[0], ch)), (left_w + cw, top_h))
    out.alpha_composite(bl, (0, top_h + ch))
    out.alpha_composite(b.resize((cw, b.size[1])), (left_w, top_h + ch))
    out.alpha_composite(br, (left_w + cw, top_h + ch))
    slice_px = {'top': top_h, 'right': right_w, 'bottom': bot_h, 'left': left_w}
    return out, slice_px, {pos: f for pos, (f, _) in pieces.items()}


def compose(layers):
    ims = [load(n) for n in layers]
    W = max(i.size[0] for i in ims)
    H = max(i.size[1] for i in ims)
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    for im in ims:
        out.alpha_composite(im, ((W - im.size[0]) // 2, (H - im.size[1]) // 2))
    return out


def stitch_three(left, mid, right):
    l, m, r = load(left), load(mid), load(right)
    H = max(l.size[1], m.size[1], r.size[1])
    out = Image.new('RGBA', (l.size[0] + m.size[0] + r.size[0], H), (0, 0, 0, 0))
    out.alpha_composite(l, (0, 0))
    out.alpha_composite(m, (l.size[0], 0))
    out.alpha_composite(r, (l.size[0] + m.size[0], 0))
    return out, {'left': l.size[0], 'right': r.size[0]}


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = {}
    for name, (files, order, crop, margin, centre) in NINE_SETS.items():
        im, slices, used = stitch_nine(name, files, order, crop, margin, centre)
        im.save(os.path.join(OUT, name + '.png'))
        manifest[name] = {'kind': 'nine', 'size': list(im.size), 'slice': slices, 'pieces': used}
        print(f'{name}.png {im.size[0]}x{im.size[1]} slice {slices["top"]} {slices["right"]} {slices["bottom"]} {slices["left"]}')
    for name, layers in COMPOSITES.items():
        im = compose(layers)
        im.save(os.path.join(OUT, name + '.png'))
        manifest[name] = {'kind': 'composite', 'size': list(im.size), 'slice': COMPOSITE_SLICE[name], 'layers': layers}
        print(f'{name}.png {im.size[0]}x{im.size[1]} slice {COMPOSITE_SLICE[name]}')
    for name, (l, m, r) in THREE_SLICES.items():
        im, slices = stitch_three(l, m, r)
        im.save(os.path.join(OUT, name + '.png'))
        manifest[name] = {'kind': 'three', 'size': list(im.size), 'slice': slices, 'pieces': [l, m, r]}
        print(f'{name}.png {im.size[0]}x{im.size[1]} slice left {slices["left"]} right {slices["right"]}')
    with open(os.path.join(OUT, 'frames.json'), 'w', encoding='utf-8') as fh:
        json.dump(manifest, fh, indent=1)
    print(f'wrote {len(manifest)} images to {OUT}')


if __name__ == '__main__':
    main()
