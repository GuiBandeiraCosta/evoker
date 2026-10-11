#!/usr/bin/env python3
"""
Derive the card sprites the web client needs from the original 1.7.4 textures (dev-only, needs Pillow).

Writes into assets/orig/ui/:
  cardframe_<rarity>.png        the compact/battle card frame (cardframe.png, a teal bevel ring) tinted with the
                                rarity colour, interior cut out, upscaled 2x (180x256) so CSS can scale it down
  carddetail_rail_<rarity>.png  a 902x10 strip with the left/right side rails of the detail plates (cropped from
                                carddetail_bottom_<rarity>.png rows 10-19, where both rails are visible and the
                                middle is transparent); repeated vertically between the top and bottom plates
  cardstatsoverlay_small_top.png  cardstatsoverlay_small.png flipped vertically (stats band of the top-row
                                battle cards, whose band sits at the top edge with the bevel below it)

It also solves the position of every piece{2,4,6,10}_N sprite inside the 451x640 card canvas (the sheets carry
no offsets) by maximising coverage / minimising overlap, and prints the result as the PIECE_LAYOUTS table used
by src/ui/components/card.js.

Usage: python tools/make-card-frames.py [--no-pieces | --pieces-only]
"""
import os
import sys

from PIL import Image, ImageChops, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
UI = os.path.join(ROOT, 'assets', 'orig', 'ui')

# Frame tints (css/tokens.css --r-*), matching the rarity-coloured borders of the original album screenshot.
RARITY_TINT = {
    'common': (0x9a, 0x9a, 0x9a),
    'standard': (0xe6, 0xe6, 0xe6),
    'uncommon': (0x2e, 0xcc, 0x40),
    'rare': (0x2f, 0x7b, 0xff),
    'heroic': (0xa0, 0x4d, 0xdc),
    'legendary': (0xff, 0x9f, 0x1c),
    'ultimate': (0xff, 0x2d, 0x2d),
}
RARITIES = list(RARITY_TINT)
CANVAS = (451, 640)


def load(name):
    return Image.open(os.path.join(UI, name)).convert('RGBA')


def save(im, name):
    path = os.path.join(UI, name)
    im.save(path, optimize=True)
    print('wrote', os.path.relpath(path, ROOT), im.size)


def make_frames():
    """cardframe.png -> cardframe_<rarity>.png (tinted ring, transparent interior, 2x)."""
    src = load('cardframe.png')
    w, h = src.size
    ring = 5  # the bevel is 5 px wide on every side (rows/cols 0-4 and the mirrored ones)
    base = Image.new('RGBA', src.size, (0, 0, 0, 0))
    px = src.load()
    out = base.load()
    for y in range(h):
        for x in range(w):
            inside = ring <= x < w - ring and ring <= y < h - ring
            if inside:
                continue
            r, g, b, a = px[x, y]
            # luminance of the teal bevel (bright edge -> highlight, dark edge -> shadow)
            lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
            out[x, y] = (int(round(lum * 255)), int(round(lum * 255)), int(round(lum * 255)), a)
    for rarity, tint in RARITY_TINT.items():
        im = Image.new('RGBA', src.size, (0, 0, 0, 0))
        dst = im.load()
        for y in range(h):
            for x in range(w):
                l, _, _, a = out[x, y]
                if a == 0:
                    continue
                f = l / 255.0
                # keep some brightness in the highlight (bevel) rows so dark tints still read as a bevel
                hi = f * f
                dst[x, y] = (
                    min(255, int(tint[0] * f + 255 * hi * 0.35)),
                    min(255, int(tint[1] * f + 255 * hi * 0.35)),
                    min(255, int(tint[2] * f + 255 * hi * 0.35)),
                    a,
                )
        big = im.resize((w * 2, h * 2), Image.LANCZOS)
        save(big, f'cardframe_{rarity}.png')


def make_rails():
    """carddetail_bottom_<rarity>.png rows 10-19 -> carddetail_rail_<rarity>.png (902x10)."""
    for rarity in RARITIES:
        bottom = load(f'carddetail_bottom_{rarity}.png')
        strip = bottom.crop((0, 10, bottom.size[0], 20))
        save(strip, f'carddetail_rail_{rarity}.png')



def make_strips():
    flipped = load('cardstatsoverlay_small.png').transpose(Image.FLIP_TOP_BOTTOM)
    save(flipped, 'cardstatsoverlay_small_top.png')


def alpha_mask(im):
    """Opaque silhouette, eroded by 2 px so the dark outline stroke of neighbouring pieces does not count as overlap."""
    return im.getchannel('A').point(lambda a: 255 if a > 100 else 0).filter(ImageFilter.MinFilter(5))


def count(mask):
    return mask.histogram()[255]


def solve_pieces(n, guesses):
    """
    Place piece<n>_1..n on the 451x640 canvas. `guesses` gives for each piece (x, y, dx, dy): the search range
    around the guess (dx/dy = 0 pins that coordinate, e.g. a border piece flush with the card edge).
    Pinned pieces go first; the searched ones are then fitted against everything else and refined twice
    (coordinate descent), so a middle-row piece interlocks with both the row above and the row below.
    Returns the list of (x, y, w, h).
    """
    # the white piece<n>_<i>.png sprites are mostly-transparent outlines (drawn over owned pieces); the
    # filled silhouettes piece<n>_<i>b.png (missing pieces) share the geometry, so solve with those
    masks = [alpha_mask(load(f'piece{n}_{i + 1}b.png')) for i in range(n)]
    pos = [None] * n
    layers = [None] * n

    def layer_at(i, x, y):
        layer = Image.new('L', CANVAS, 0)
        layer.paste(masks[i], (x, y))
        return layer

    def others(i):
        acc = Image.new('L', CANVAS, 0)
        for j in range(n):
            if j != i and layers[j] is not None:
                acc = ImageChops.lighter(acc, layers[j])
        return acc

    def fit(i):
        gx, gy, dx, dy = guesses[i]
        pw, ph = masks[i].size
        acc = others(i)
        xs = range(max(0, gx - dx), min(CANVAS[0] - pw, gx + dx) + 1, 2) if dx else [gx]
        ys = range(max(0, gy - dy), min(CANVAS[1] - ph, gy + dy) + 1, 2) if dy else [gy]
        best = None
        for x in xs:
            for y in ys:
                layer = layer_at(i, x, y)
                overlap = count(ImageChops.multiply(layer, acc))
                score = count(layer) - 2 * overlap
                if best is None or score > best[0]:
                    best = (score, x, y)
        _, x, y = best
        pos[i] = (x, y, pw, ph)
        layers[i] = layer_at(i, x, y)

    pinned = [i for i, g in enumerate(guesses) if not g[2] and not g[3]]
    searched = [i for i in range(n) if i not in pinned]
    for i in pinned:
        fit(i)
    for _round in range(3):
        for i in searched:
            fit(i)
    acc = others(-1)
    covered = count(acc)
    print(f'  piece{n}: covered {covered}/{CANVAS[0] * CANVAS[1]} px ({100 * covered / (CANVAS[0] * CANVAS[1]):.1f}%)', file=sys.stderr)
    return pos


def make_pieces():
    W, H = CANVAS
    sizes = {n: [load(f'piece{n}_{i + 1}.png').size for i in range(n)] for n in (2, 4, 6, 10)}
    layouts = {}
    # piece2: top / bottom halves
    s = sizes[2]
    layouts[2] = solve_pieces(2, [(0, 0, 0, 0), (0, H - s[1][1], 0, 0)])
    # piece4: 2x2
    s = sizes[4]
    layouts[4] = solve_pieces(4, [
        (0, 0, 0, 0), (W - s[1][0], 0, 0, 0),
        (0, H - s[2][1], 0, 0), (W - s[3][0], H - s[3][1], 0, 0)])
    # piece6: 2 columns x 3 rows; the middle row's y is searched
    s = sizes[6]
    layouts[6] = solve_pieces(6, [
        (0, 0, 0, 0), (W - s[1][0], 0, 0, 0),
        (0, (H - s[2][1]) // 2, 0, 90), (W - s[3][0], (H - s[3][1]) // 2, 0, 90),
        (0, H - s[4][1], 0, 0), (W - s[5][0], H - s[5][1], 0, 0)])
    # piece10: rows of 3 / 4 / 3; the inner x and the middle row's y are searched
    s = sizes[10]
    layouts[10] = solve_pieces(10, [
        (0, 0, 0, 0), ((W - s[1][0]) // 2, 0, 70, 0), (W - s[2][0], 0, 0, 0),
        (0, (H - s[3][1]) // 2, 0, 90), (90, (H - s[4][1]) // 2, 90, 90), (220, (H - s[5][1]) // 2, 90, 90), (W - s[6][0], (H - s[6][1]) // 2, 0, 90),
        (0, H - s[7][1], 0, 0), ((W - s[8][0]) // 2, H - s[8][1], 70, 0), (W - s[9][0], H - s[9][1], 0, 0)])
    print('// generated by tools/make-card-frames.py: [x, y, w, h] of piece<n>_<i+1> on the 451x640 card canvas')
    print('export const PIECE_LAYOUTS = {')
    for n, lay in layouts.items():
        print(f'  {n}: [' + ', '.join(f'[{x}, {y}, {w}, {h}]' for x, y, w, h in lay) + '],')
    print('};')


if __name__ == '__main__':
    if '--pieces-only' not in sys.argv:
        make_frames()
        make_rails()
        make_strips()
    if '--no-pieces' not in sys.argv:
        make_pieces()
