#!/usr/bin/env python3
"""
Reassemble the original quest maps from the prepackaged 256 px tiles (dev tool, Pillow only, no numpy;
--match-sockets also needs numpy + opencv).

The 1.7.4 client draws the quest map with ui.components.comp_scrollable_map from `tileData`, a list of
{x, y, img} rows that comes from the server metadata (`questRegion2[1].tiles`, see game.questmanager /
game.regionhelper) - the grid is NOT in the client, only the tiles are (assets/orig/prepackaged, the hashed
remote-asset cache). The arrangement is recovered here by edge matching:

  * every ordered pair of tiles gets a seam score per axis (mean absolute difference between A's last
    column / row and B's first one, plus a gradient-continuation term; computed in C through ImageChops and
    a BOX resize);
  * each map is anchored by its unique bottom-right corner tile (both sides < 256 px): the tiles of that
    width are its right column, the tiles of that height its bottom row, so the rectangle is known
    (e.g. 116x254 corner -> 21 x 7 cells for the main map). The maps are grown best-first from the corner:
    the (cell, tile) with the most placed neighbours and the lowest weighted seam score is placed next;
  * whatever is left (maps without partial tiles) goes through a generic jigsaw with multi-seam merges.

The quest nodes are painted on the map as sockets (a dark disc in a thin light rim, the same sprite on every
map: radius ~17 px, 0.75x on the ice map) joined by dark road strokes, one painted road per pair of
consecutive quests. Every map has exactly one socket per quest (main 100, each portal map 25) and its roads
form a single chain without branches. The node coordinates come from ROUTES below: the socket centres in
quest order, hand-checked against the painting (found by template matching, `--match-sockets`: 100 / 25 /
25 / 25 / 25 sockets at >= 0.77 correlation, then a clear gap to the next candidate at <= 0.6; the chain was
then traced road by road on zoomed crops). Quest 1 is the western end of each chain. The automatic
ring-minus-centre detector + path-link walk further down is only the fallback for a map without a ROUTES
entry (it misses ~10 % of the sockets on busy ground and takes clouds / buildings for sockets).

Outputs (in --out, default assets/orig/map)
  layout.json            maps: size, tile grid, strips, ordered node coordinates
  world-<i>-<n>.jpg      the stitched maps, cut into strips of at most 4096 px per side
  preview-<i>.jpg        quarter-size previews; nodes-<i>.jpg = half-size overlay of the node route

Usage: python tools/build-map.py [--out assets/orig/map] [--preview-only] [--preview-dir DIR]
       python tools/build-map.py --nodes-only     # re-apply ROUTES to an existing layout.json + strips
       python tools/build-map.py --match-sockets  # list the painted sockets of the stitched maps (numpy + opencv)
"""
import argparse
import json
import math
import os
import sys
import time

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageMath

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PREPACKAGED = os.path.join(ROOT, 'assets', 'orig', 'prepackaged')
TILE = 256
MAX_STRIP = 4096

# jigsaw thresholds (scores are mean absolute pixel differences, 0..255)
T_SINGLE = 14.0    # one seam alone: must be at most this good ...
MARGIN = 3.0       # ... and better than the runner-up by this margin, in both directions
ENERGY = 4.0       # ... on textured edges (mean neighbour difference along the edge)
T_MULTI = 26.0     # every seam of a multi-seam merge must be at most this
T_REJECT = 40.0    # any adjacent seam worse than this vetoes a merge

# The quest route of each stitched map (layout index -> socket centres in quest order, map px). Hand-checked:
# every point is a painted socket, every consecutive pair is joined by a painted road (on dark rock the road
# is often too faint to see - there the only remaining socket continues the chain), no socket is left over.
# Overlay: nodes-<i>.jpg (--preview-dir). Re-derive with --match-sockets if the stitching ever changes.
ROUTES = {
    0: [
        (500, 150), (570, 305), (460, 500), (620, 685), (660, 500), (885, 458), (1025, 215), (1080, 460), (1040,
        665), (827, 758), (793, 895), (635, 1110), (1010, 1085), (885, 1280), (705, 1375), (520, 1460), (292, 1445),
        (182, 1633), (522, 1685), (625, 1555), (865, 1560), (1055, 1613), (1050, 1360), (1175, 1165), (1300, 1345),
        (1222, 1483), (1310, 1635), (1505, 1545), (1723, 1520), (1650, 1365), (1605, 1223), (1557, 1030), (1717,
        825), (1498, 705), (1615, 580), (1587, 365), (1645, 170), (1923, 110), (2000, 260), (1835, 395), (1850,
        685), (2082, 583), (2247, 390), (2362, 513), (2432, 753), (2255, 925), (2155, 1060), (2165, 1270), (2400,
        1338), (2190, 1648), (2445, 1690), (2540, 1490), (2738, 1555), (2965, 1440), (2895, 1260), (2763, 1120),
        (3050, 1140), (3090, 945), (3335, 960), (3400, 765), (3243, 670), (3135, 530), (2970, 625), (2785, 518),
        (2800, 323), (3000, 220), (3255, 147), (3487, 130), (3612, 250), (3778, 350), (3575, 495), (3740, 630),
        (3672, 863), (3802, 1028), (3605, 1118), (3515, 1255), (3662, 1375), (3570, 1635), (3822, 1515), (3972,
        1670), (4295, 1653), (4150, 1490), (4050, 1358), (3958, 1190), (3935, 790), (3965, 568), (4065, 245), (4220,
        113), (4490, 143), (4380, 430), (4197, 338), (4120, 735), (4138, 1080), (4430, 1083), (4350, 770), (4620,
        570), (4787, 178), (4902, 440), (5037, 683), (4740, 980)
    ],
    1: [
        (576, 234), (279, 297), (400, 429), (765, 537), (768, 767), (1074, 698), (927, 914), (591, 878), (234, 845),
        (408, 1103), (645, 1259), (489, 1499), (264, 1709), (639, 1643), (870, 1484), (1089, 1354), (1152, 1148),
        (1416, 1031), (1695, 1223), (1440, 1493), (1497, 1694), (1740, 1909), (1788, 2194), (1527, 2122), (1314,
        2125)
    ],
    2: [
        (332, 2383), (422, 2655), (750, 2799), (1089, 2821), (1321, 2573), (1218, 2291), (1067, 2061), (1299, 1818),
        (1320, 1488), (1089, 1319), (775, 1384), (716, 1618), (418, 1532), (310, 1362), (341, 1169), (639, 1191),
        (694, 1004), (516, 945), (332, 853), (418, 705), (618, 661), (790, 661), (959, 661), (1067, 537), (894, 424)
    ],
    3: [
        (512, 1558), (247, 1445), (410, 1235), (612, 1070), (827, 1005), (987, 1178), (1113, 1355), (1145, 1625),
        (1435, 1678), (1457, 1370), (1442, 1088), (1405, 770), (1410, 473), (1180, 642), (950, 715), (852, 515),
        (747, 380), (575, 578), (345, 673), (100, 605), (127, 333), (357, 200), (570, 158), (790, 143), (1000, 180)
    ],
    4: [
        (253, 1062), (502, 949), (776, 922), (1041, 974), (1200, 855), (1400, 978), (1561, 867), (1790, 683), (1664,
        539), (1451, 577), (1225, 581), (1058, 616), (883, 616), (661, 683), (527, 581), (338, 497), (148, 379),
        (249, 202), (479, 185), (686, 124), (719, 285), (939, 297), (1118, 367), (1303, 384), (1386, 285)
    ],
}
# sockets on the ice map (layout index 4) are painted at 0.75x
SOCKET_SCALE = {4: 0.75}


def load_tiles():
    """All RGB JPEG images that can be a map tile: 256 wide or 256 high, or a corner of a partial column/row."""
    index = json.load(open(os.path.join(PREPACKAGED, '_index.json')))
    sizes = {}
    for h, v in index.items():
        fn = os.path.basename(v['filename'])
        p = os.path.join(PREPACKAGED, fn)
        if not os.path.exists(p):
            continue
        im = Image.open(p)
        if im.format != 'JPEG' or im.mode != 'RGB':
            continue
        sizes[h] = (im.size, fn)
    widths = {s[0][0] for s in sizes.values() if s[0][1] == TILE}
    heights = {s[0][1] for s in sizes.values() if s[0][0] == TILE}
    tiles = {}
    for h, ((w, hh), fn) in sizes.items():
        if (w == TILE or hh == TILE or (w in widths and hh in heights)) and w >= 2 and hh >= 2:
            tiles[h] = {'file': fn, 'w': w, 'h': hh, 'im': Image.open(os.path.join(PREPACKAGED, fn)).convert('RGB')}
    return tiles


def _mean(im):
    """Mean of an image over all pixels and channels (via a BOX resize to 1x1)."""
    px = im.resize((1, 1), Image.BOX).getpixel((0, 0))
    return sum(px) / 3.0


def edge_energy(tiles):
    """Texture of the four border lines of every tile: mean difference between neighbouring edge pixels."""
    out = {}
    for k, t in tiles.items():
        im, w, h = t['im'], t['w'], t['h']
        l = im.crop((0, 0, 1, h))
        r = im.crop((w - 1, 0, w, h))
        tp = im.crop((0, 0, w, 1))
        bt = im.crop((0, h - 1, w, h))
        out[k] = {
            'l': _mean(ImageChops.difference(l.crop((0, 0, 1, h - 1)), l.crop((0, 1, 1, h)))),
            'r': _mean(ImageChops.difference(r.crop((0, 0, 1, h - 1)), r.crop((0, 1, 1, h)))),
            't': _mean(ImageChops.difference(tp.crop((0, 0, w - 1, 1)), tp.crop((1, 0, w, 1)))),
            'b': _mean(ImageChops.difference(bt.crop((0, 0, w - 1, 1)), bt.crop((1, 0, w, 1)))),
        }
    return out


def edge_scores(tiles, axis):
    """
    Seam score for every ordered pair along one axis.
    axis 'h': A's right column vs B's left column (both must be the same height).
    axis 'v': A's bottom row vs B's top row (same width).
    Returns {A: {B: score}} with scores in 0..255 (lower is better).
    """
    groups = {}
    for key, t in tiles.items():
        dim = t['h'] if axis == 'h' else t['w']
        groups.setdefault(dim, []).append(key)
    scores = {k: {} for k in tiles}
    for dim, keys in groups.items():
        n = len(keys)
        if n < 2:
            continue
        if axis == 'h':
            stack = Image.new('RGB', (n, dim))
            for i, k in enumerate(keys):
                stack.paste(tiles[k]['im'].crop((0, 0, 1, dim)), (i, 0))
        else:
            stack = Image.new('RGB', (dim, n))
            for i, k in enumerate(keys):
                stack.paste(tiles[k]['im'].crop((0, 0, dim, 1)), (0, i))
        for a in keys:
            t = tiles[a]
            if axis == 'h':
                last = t['im'].crop((t['w'] - 1, 0, t['w'], dim))
                prev = t['im'].crop((t['w'] - 2, 0, t['w'] - 1, dim))
                size = (n, dim)
                small = (n, 1)
            else:
                last = t['im'].crop((0, t['h'] - 1, dim, t['h']))
                prev = t['im'].crop((0, t['h'] - 2, dim, t['h'] - 1))
                size = (dim, n)
                small = (1, n)
            pred = ImageChops.subtract(ImageChops.add(last, last), prev)
            d1 = ImageChops.difference(stack, last.resize(size, Image.NEAREST))
            d2 = ImageChops.difference(stack, pred.resize(size, Image.NEAREST))
            rows = [list(c.resize(small, Image.BOX).getdata()) for c in d1.split()] + \
                   [list(c.resize(small, Image.BOX).getdata()) for c in d2.split()]
            for i, b in enumerate(keys):
                if b == a:
                    continue
                s1 = (rows[0][i] + rows[1][i] + rows[2][i]) / 3.0
                s2 = (rows[3][i] + rows[4][i] + rows[5][i]) / 3.0
                scores[a][b] = 0.6 * s1 + 0.4 * s2
    return scores


def seam_weight(dim):
    """Confidence of a seam `dim` pixels long (a 2 px row says nothing)."""
    return min(1.0, dim / 64.0)


# ----------------------------------------------------------------------------------------- anchored maps

def anchored_maps(tiles):
    """
    Maps pinned by their partial tiles: a corner tile (w < 256, h < 256) is the bottom-right cell; the tiles
    of width w are its right column, the tiles of height h its bottom row.
    """
    maps = []
    for k, t in tiles.items():
        if t['w'] < TILE and t['h'] < TILE:
            right = [j for j, u in tiles.items() if u['w'] == t['w'] and u['h'] == TILE]
            bottom = [j for j, u in tiles.items() if u['h'] == t['h'] and u['w'] == TILE]
            if not right or not bottom:
                continue
            maps.append({'corner': k, 'w': t['w'], 'h': t['h'], 'cols': len(bottom) + 1, 'rows': len(right) + 1,
                         'right': right, 'bottom': bottom})
    maps.sort(key=lambda m: -(m['cols'] * m['rows']))
    return maps


def grow_anchored(tiles, sh, sv, maps, log=None):
    """
    Best-first growth of every anchored map from its corner. At each step the (cell, tile) with the most
    placed neighbours (capped at 2) and the lowest weighted seam score is placed. Right-column cells only
    take tiles of the map's partial width, bottom-row cells tiles of its partial height, the interior full
    tiles (shared between the maps). Returns ({map index: {(x, y): tile}}, placed tiles).
    """
    full = {k for k, t in tiles.items() if t['w'] == TILE and t['h'] == TILE}
    placed = set()
    grids = {}
    pools = {}
    for i, m in enumerate(maps):
        grids[i] = {(m['cols'] - 1, m['rows'] - 1): m['corner']}
        placed.add(m['corner'])
        pools[i] = {'right': set(m['right']), 'bottom': set(m['bottom'])}
    free_full = set(full)

    def seam(a, b, axis):
        if axis == 'h':
            return sh[a].get(b), seam_weight(tiles[a]['h'])
        return sv[a].get(b), seam_weight(tiles[a]['w'])

    total = sum(m['cols'] * m['rows'] for m in maps) - len(maps)
    steps = 0
    while True:
        best = None
        for i, m in enumerate(maps):
            grid = grids[i]
            if len(grid) == m['cols'] * m['rows']:
                continue
            frontier = set()
            for (x, y) in grid:
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    c = (x + dx, y + dy)
                    if 0 <= c[0] < m['cols'] and 0 <= c[1] < m['rows'] and c not in grid:
                        frontier.add(c)
            for (cx, cy) in frontier:
                if cx == m['cols'] - 1:
                    pool = pools[i]['right']
                elif cy == m['rows'] - 1:
                    pool = pools[i]['bottom']
                else:
                    pool = free_full
                if not pool:
                    continue
                neigh = []
                for ndx, ndy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    n = grid.get((cx + ndx, cy + ndy))
                    if n is not None:
                        neigh.append((n, ndx, ndy))
                for t in pool:
                    tot = 0.0
                    wsum = 0.0
                    ok = True
                    for n, ndx, ndy in neigh:
                        if ndx == 1:
                            s, w = seam(t, n, 'h')
                        elif ndx == -1:
                            s, w = seam(n, t, 'h')
                        elif ndy == 1:
                            s, w = seam(t, n, 'v')
                        else:
                            s, w = seam(n, t, 'v')
                        if s is None:
                            ok = False
                            break
                        tot += s * w
                        wsum += w
                    if not ok or wsum == 0:
                        continue
                    key = (-min(len(neigh), 2), tot / wsum)
                    if best is None or key < best[0]:
                        best = (key, i, (cx, cy), t)
        if best is None:
            break
        key, i, cell, t = best
        grids[i][cell] = t
        placed.add(t)
        m = maps[i]
        if cell[0] == m['cols'] - 1:
            pools[i]['right'].discard(t)
        elif cell[1] == m['rows'] - 1:
            pools[i]['bottom'].discard(t)
        else:
            free_full.discard(t)
        steps += 1
        if log and steps % 50 == 0:
            log(f'  placed {steps}/{total} (last: {-key[0]} seams, score {key[1]:.1f})')
    return grids, placed


# ------------------------------------------------------------------------------------------ generic jigsaw

def best_links(scores):
    """For every tile: (best partner, best score, runner-up score) as the source and as the target of a link."""
    out_best = {}
    for a, row in scores.items():
        if not row:
            continue
        srt = sorted(row.items(), key=lambda kv: kv[1])
        out_best[a] = (srt[0][0], srt[0][1], srt[1][1] if len(srt) > 1 else 255.0)
    incoming = {}
    for a, row in scores.items():
        for b, s in row.items():
            incoming.setdefault(b, []).append((s, a))
    in_best = {}
    for b, lst in incoming.items():
        lst.sort()
        in_best[b] = (lst[0][1], lst[0][0], lst[1][0] if len(lst) > 1 else 255.0)
    return out_best, in_best


class Jigsaw:
    """Rigid components of tiles with integer grid coordinates, merged seam by seam."""

    def __init__(self, tiles, sh, sv):
        self.tiles = tiles
        self.sh = sh
        self.sv = sv
        self.comp = {k: k for k in tiles}
        self.pos = {k: (0, 0) for k in tiles}
        self.members = {k: {k} for k in tiles}
        self.cells = {k: {(0, 0): k} for k in tiles}

    def seams(self, ca, cb, ox, oy):
        """
        Adjacent tile pairs between component a and component b placed at offset (ox, oy) in a's frame.
        Returns (list of (score, a_tile, b_tile, axis), ok); ok is False on overlap or inconsistent
        column widths / row heights (partial tiles are the map border: nothing may follow them).
        """
        cells_a = self.cells[ca]
        colw = {}
        rowh = {}
        for (x, y), k in cells_a.items():
            colw[x] = self.tiles[k]['w']
            rowh[y] = self.tiles[k]['h']
        seams = []
        for k in self.members[cb]:
            x, y = self.pos[k]
            x += ox
            y += oy
            t = self.tiles[k]
            if (x, y) in cells_a:
                return seams, False
            if colw.get(x, t['w']) != t['w'] or rowh.get(y, t['h']) != t['h']:
                return seams, False
            for dx, dy, axis in ((1, 0, 'h'), (-1, 0, 'h'), (0, 1, 'v'), (0, -1, 'v')):
                n = cells_a.get((x + dx, y + dy))
                if n is None:
                    continue
                if axis == 'h':
                    left, right = (k, n) if dx == 1 else (n, k)
                    if self.tiles[left]['w'] != TILE:
                        return seams, False
                    s = self.sh[left].get(right)
                else:
                    top, bottom = (k, n) if dy == 1 else (n, k)
                    if self.tiles[top]['h'] != TILE:
                        return seams, False
                    s = self.sv[top].get(bottom)
                if s is None:
                    return seams, False
                seams.append((s, k, n, axis))
        return seams, True

    def merge(self, ca, cb, ox, oy):
        cells_a = self.cells[ca]
        for k in self.members[cb]:
            x, y = self.pos[k]
            self.pos[k] = (x + ox, y + oy)
            self.comp[k] = ca
            cells_a[(x + ox, y + oy)] = k
        self.members[ca] |= self.members[cb]
        del self.members[cb]
        del self.cells[cb]

    def components(self):
        out = []
        for cid, members in self.members.items():
            xs = [self.pos[k][0] for k in members]
            ys = [self.pos[k][1] for k in members]
            x0, y0 = min(xs), min(ys)
            grid = {}
            for k in members:
                x, y = self.pos[k]
                grid[(x - x0, y - y0)] = k
            out.append({'cols': max(xs) - x0 + 1, 'rows': max(ys) - y0 + 1, 'grid': grid})
        out.sort(key=lambda c: -len(c['grid']))
        return out


def assemble(tiles, sh, sv, energy, log=None):
    """Rounds of candidate merges (multi-seam, or one mutual-best textured seam) until nothing is accepted."""
    jig = Jigsaw(tiles, sh, sv)
    links = []
    for a, row in sh.items():
        for b, s in row.items():
            if s <= T_MULTI:
                links.append((s, a, b, 1, 0))
    for a, row in sv.items():
        for b, s in row.items():
            if s <= T_MULTI:
                links.append((s, a, b, 0, 1))
    h_out, h_in = best_links(sh)
    v_out, v_in = best_links(sv)

    def single_ok(s, a, b, dx):
        out_b, in_b, en_a, en_b = (h_out, h_in, 'r', 'l') if dx else (v_out, v_in, 'b', 't')
        if s > T_SINGLE or energy[a][en_a] < ENERGY or energy[b][en_b] < ENERGY:
            return False
        ob = out_b.get(a)
        ib = in_b.get(b)
        if not ob or not ib or ob[0] != b or ib[0] != a:
            return False
        return ob[2] - s >= MARGIN and ib[2] - s >= MARGIN

    rounds = 0
    while True:
        rounds += 1
        cands = {}
        for s, a, b, dx, dy in links:
            ca, cb = jig.comp[a], jig.comp[b]
            if ca == cb:
                continue
            ax, ay = jig.pos[a]
            bx, by = jig.pos[b]
            ox, oy = ax + dx - bx, ay + dy - by
            key = (ca, cb, ox, oy) if ca < cb else (cb, ca, -ox, -oy)
            cands.setdefault(key, []).append((s, a, b, dx))
        scored = []
        for (ca, cb, ox, oy), lst in cands.items():
            seams, ok = jig.seams(ca, cb, ox, oy)
            if not ok or not seams:
                continue
            worst = max(s for s, _, _, _ in seams)
            if worst > T_REJECT:
                continue
            if len(seams) >= 2:
                if worst > T_MULTI:
                    continue
                textured = any(energy[k]['r' if axis == 'h' else 'b'] >= ENERGY or energy[n]['l' if axis == 'h' else 't'] >= ENERGY
                               for _, k, n, axis in seams)
                if not textured:
                    continue
                scored.append((0, sum(s for s, _, _, _ in seams) / len(seams), ca, cb, ox, oy))
            else:
                s, a, b, dx = lst[0]
                if single_ok(s, a, b, dx):
                    scored.append((1, s, ca, cb, ox, oy))
        scored.sort()
        accepted = 0
        touched = set()
        for rank, s, ca, cb, ox, oy in scored:
            if ca in touched or cb in touched:
                continue
            seams, ok = jig.seams(ca, cb, ox, oy)
            if not ok:
                continue
            jig.merge(ca, cb, ox, oy)
            touched.add(ca)
            touched.add(cb)
            accepted += 1
        if log:
            log(f'  jigsaw round {rounds}: {len(scored)} candidates, {accepted} merges, {len(jig.members)} components')
        if not accepted:
            break
    return jig


# ------------------------------------------------------------------------------------ node sockets / path

def detect_sockets(im):
    """
    The quest nodes painted on the map: a dark grey disc (radius 10-14 px, luminance ~40, low saturation)
    with a near-black outline and a light ring (radius 13-18 px) around it. Coarse pass at half scale: the
    best of four ring radii (mean of 12 samples) minus the centre mean; NMS; then every candidate is
    verified at full resolution on its radial profile (36 angles): dark unsaturated disc, a complete bright
    ring at some radius, and the dark outline just inside it. Returns [(x, y, contrast)] in map pixels.
    """
    s = 2
    half_rgb = im.resize((im.width // s, im.height // s), Image.BOX)
    half = half_rgb.convert('L')
    r_, g_, b_ = half_rgb.split()
    sat = ImageChops.subtract(ImageChops.lighter(ImageChops.lighter(r_, g_), b_), ImageChops.darker(ImageChops.darker(r_, g_), b_))
    inner = half.filter(ImageFilter.BoxBlur(2)).convert('F')
    inner_sat = sat.filter(ImageFilter.BoxBlur(2))
    best = None
    for rad in (6, 7, 8, 9, 10, 11):
        ring_sum = None
        for k in range(12):
            a = 2 * math.pi * k / 12
            sh_ = ImageChops.offset(half, -int(round(rad * math.cos(a))), -int(round(rad * math.sin(a)))).convert('F')
            ring_sum = sh_ if ring_sum is None else ImageMath.lambda_eval(lambda a: a['x'] + a['y'], x=ring_sum, y=sh_)
        # (ring mean - centre mean) mapped to L: v = 128 + diff / 2
        score = ImageMath.lambda_eval(lambda a: (a['x'] / 12.0 - a['i']) / 2 + 128, x=ring_sum, i=inner).convert('L')
        best = score if best is None else ImageChops.lighter(best, score)
    w = half.width
    sc = list(best.getdata())
    inn = list(inner.getdata())
    isat = list(inner_sat.getdata())
    cands = []
    for idx, v in enumerate(sc):
        if (v - 128) * 2 >= 45 and inn[idx] < 68 and isat[idx] < 34:
            cands.append((v, idx % w, idx // w))
    cands.sort(reverse=True)
    picked = []
    buckets = {}
    for v, x, y in cands:
        bx, by = x // 10, y // 10
        clash = False
        for ox in (-1, 0, 1):
            for oy in (-1, 0, 1):
                for px_, py_ in buckets.get((bx + ox, by + oy), ()):
                    if abs(x - px_) < 10 and abs(y - py_) < 10:
                        clash = True
                        break
                if clash:
                    break
            if clash:
                break
        if clash:
            continue
        picked.append((v, x, y))
        buckets.setdefault((bx, by), []).append((x, y))
    full = im.convert('L')
    px = full.load()
    rgb = im.load()
    W, H = full.size
    NA = 24
    angles = [(math.cos(2 * math.pi * k / NA), math.sin(2 * math.pi * k / NA)) for k in range(NA)]

    def disc_ok(cx, cy):
        """Cheap gate: a dark, unsaturated centre."""
        if cx < 28 or cy < 28 or cx >= W - 28 or cy >= H - 28:
            return False
        lum = 0
        satsum = 0
        n = 0
        for dy in (-5, 0, 5):
            for dx in (-5, 0, 5):
                p = rgb[cx + dx, cy + dy]
                lum += p[0] + p[1] + p[2]
                satsum += max(p) - min(p)
                n += 1
        return lum / (3 * n) < 78 and satsum / n < 34

    def verify(cx, cy):
        """(ring completeness, contrast, ring radius) or None."""
        if not disc_ok(cx, cy):
            return None
        prof = []
        for r in range(0, 25):
            prof.append(sorted(px[int(round(cx + r * c)), int(round(cy + r * sn))] for c, sn in angles))
        disc = [v for r in range(0, 8) for v in prof[r]]
        dmean = sum(disc) / len(disc)
        if dmean > 75:
            return None
        bestR = None
        for R in range(11, 24):
            vals = prof[R]
            mean = sum(vals) / float(NA)
            complete = sum(1 for v in vals if v >= dmean + 25)
            # the rim is painted light grey: not snow-white, not coloured ground, not dark rock
            if complete < 18 or mean - dmean < 40 or vals[NA // 2] > 175 or mean < 85:
                continue
            satsum = 0
            for c, sn in angles:
                p = rgb[int(round(cx + R * c)), int(round(cy + R * sn))]
                satsum += max(p) - min(p)
            if satsum / float(NA) > 45:
                continue
            key = complete + (mean - dmean) / 50.0
            if bestR is None or key > bestR[0]:
                bestR = (key, R, mean - dmean, complete)
        if not bestR:
            return None
        _, R, contrast, complete = bestR
        # the near-black outline between disc and rim
        outline = min(prof[r][1] for r in range(max(8, R - 4), R))
        if outline > min(dmean - 20, 22):
            return None
        return (complete, contrast, R)

    out = []
    for v, x, y in picked:
        cx, cy = x * s, y * s
        found = None
        for dy in (0, -2, 2):
            for dx in (0, -2, 2):
                m = verify(cx + dx, cy + dy)
                if m and (found is None or (m[0], m[1]) > (found[0][0], found[0][1])):
                    found = (m, cx + dx, cy + dy)
        if not found:
            continue
        # refine to the pixel
        (bm, bx, by) = found
        for dy in range(-1, 2):
            for dx in range(-1, 2):
                m = verify(bx + dx, by + dy)
                if m and (m[0], m[1]) > (bm[0], bm[1]):
                    bm, bx, by = m, bx + dx, by + dy
        out.append((bx, by, round(bm[1], 1), bm[0]))
    # merge double detections of one socket (keep the more complete ring)
    out.sort(key=lambda p: (-p[3], -p[2]))
    merged = []
    for cx, cy, contrast, complete in out:
        # painted sockets are never closer than ~100 px: nearby detections are doubles or rubble
        if any(abs(cx - mx) < 50 and abs(cy - my) < 50 for mx, my, _ in merged):
            continue
        merged.append((cx, cy, contrast))
    merged.sort(key=lambda p: (p[1], p[0]))
    return merged


def path_links(im, sockets, max_dist=620):
    """
    Pairs of sockets joined by a painted path: the segment between them (minus the socket discs) is sampled
    and must be dark and low-saturation on most samples, and darker than the ground beside it.
    Returns {i: {j: fraction}}.
    """
    rgb = im.load()
    W, H = im.size

    def lum(p):
        return (p[0] + p[1] + p[2]) / 3.0

    def is_path(x, y):
        if x < 0 or y < 0 or x >= W or y >= H:
            return False
        p = rgb[x, y]
        return lum(p) < 85 and (max(p) - min(p)) < 42

    links = {}
    n = len(sockets)
    for i in range(n):
        for j in range(i + 1, n):
            x1, y1 = sockets[i][0], sockets[i][1]
            x2, y2 = sockets[j][0], sockets[j][1]
            d = math.hypot(x2 - x1, y2 - y1)
            if d > max_dist or d < 40:
                continue
            ux, uy = (x2 - x1) / d, (y2 - y1) / d
            nx, ny = -uy, ux
            steps = max(12, int(d / 8))
            hits = 0
            total = 0
            dl = []
            ds = []
            for k in range(steps + 1):
                t = 24 + (d - 48) * k / steps
                x, y = x1 + ux * t, y1 + uy * t
                xi, yi = int(round(x)), int(round(y))
                if not (0 <= xi < W and 0 <= yi < H):
                    continue
                sides = []
                for off in (-14, 14, -20, 20):
                    sx, sy = int(round(x + nx * off)), int(round(y + ny * off))
                    if 0 <= sx < W and 0 <= sy < H:
                        sides.append(rgb[sx, sy])
                if not sides:
                    continue
                total += 1
                p = rgb[xi, yi]
                dl.append(sum(lum(q) for q in sides) / len(sides) - lum(p))
                ds.append(sum(max(q) - min(q) for q in sides) / len(sides) - (max(p) - min(p)))
                if is_path(xi, yi):
                    hits += 1
            if not total:
                continue
            dl.sort()
            ds.sort()
            frac = hits / total
            # a path stroke: dark and grey along the whole segment, and darker or greyer than the ground
            # beside it (on dark rock the paint gives no evidence; those gaps are closed by proximity later)
            if frac >= 0.75 and (dl[len(dl) // 2] >= 8 or ds[len(ds) // 2] >= 15):
                links.setdefault(i, {})[j] = frac
                links.setdefault(j, {})[i] = frac
    return links


def prune_shortcuts(sockets, links, tol=34):
    """
    Drop links that run over a third socket (the straight line from node i to node i+2 crosses node i+1,
    whose dark disc reads as path): keep only the direct neighbours.
    """
    out = {}
    for i, row in links.items():
        for j, frac in row.items():
            if j < i:
                continue
            x1, y1 = sockets[i][0], sockets[i][1]
            x2, y2 = sockets[j][0], sockets[j][1]
            dx, dy = x2 - x1, y2 - y1
            d2 = dx * dx + dy * dy
            shortcut = False
            for k, (kx, ky, *_rest) in enumerate(sockets):
                if k == i or k == j:
                    continue
                t = ((kx - x1) * dx + (ky - y1) * dy) / d2
                if t <= 0.05 or t >= 0.95:
                    continue
                px_, py_ = x1 + t * dx, y1 + t * dy
                if (kx - px_) ** 2 + (ky - py_) ** 2 <= tol * tol:
                    shortcut = True
                    break
            if not shortcut:
                out.setdefault(i, {})[j] = frac
                out.setdefault(j, {})[i] = frac
    return out


def order_chain(sockets, links, start=None, max_jump=900):
    """
    The quest route through every socket: start at the leftmost socket (quest 1 is at the left of every
    map) and walk; from each socket continue along an unvisited painted link (the nearest one, so that
    shortcuts across the map are not taken), and where the paint gives no evidence jump to the nearest
    unvisited socket. Returns the socket indices in route order; sockets farther than `max_jump` from
    the route's end are left out.
    """
    n = len(sockets)
    if n == 0:
        return []
    if start is None:
        start = min(range(n), key=lambda i: (sockets[i][0], sockets[i][1]))

    def dist(a, b):
        return math.hypot(sockets[a][0] - sockets[b][0], sockets[a][1] - sockets[b][1])

    order = [start]
    visited = {start}
    cur = start
    while len(visited) < n:
        linked = [j for j in links.get(cur, {}) if j not in visited]
        if linked:
            nxt = min(linked, key=lambda j: dist(cur, j))
        else:
            rest = [j for j in range(n) if j not in visited]
            nxt = min(rest, key=lambda j: dist(cur, j))
            if dist(cur, nxt) > max_jump:
                break
        order.append(nxt)
        visited.add(nxt)
        cur = nxt
    # sockets the walk skipped: cheapest insertion when the detour is small
    for j in sorted(set(range(n)) - visited, key=lambda j: (sockets[j][0], sockets[j][1])):
        best = None
        for k in range(len(order) - 1):
            a, b = order[k], order[k + 1]
            detour = dist(a, j) + dist(j, b) - dist(a, b)
            if best is None or detour < best[0]:
                best = (detour, k + 1)
        for end, pos in ((order[0], 0), (order[-1], len(order))):
            detour = dist(end, j)
            if detour < best[0]:
                best = (detour, pos)
        if best and best[0] <= max_jump:
            order.insert(best[1], j)
    # the last quest sits at the far end of the map: end the route at the rightmost socket, then untangle
    last = max(order, key=lambda i: (sockets[i][0], -sockets[i][1]))
    if last != order[0]:
        order.remove(last)
        order.append(last)
    return two_opt(sockets, order)


def two_opt(sockets, order, passes=6):
    """Untangle crossings of a route by segment reversal (endpoints stay fixed)."""
    def dist(a, b):
        return math.hypot(sockets[a][0] - sockets[b][0], sockets[a][1] - sockets[b][1])
    route = list(order)
    n = len(route)
    for _ in range(passes):
        improved = False
        for i in range(1, n - 2):
            for k in range(i + 1, n - 1):
                a, b, c, d = route[i - 1], route[i], route[k], route[k + 1]
                if dist(a, c) + dist(b, d) < dist(a, b) + dist(c, d) - 1e-6:
                    route[i:k + 1] = reversed(route[i:k + 1])
                    improved = True
        if not improved:
            break
    return route


# ------------------------------------------------------------------------------- hand-checked routes

# the socket used as the template of --match-sockets: layout index, centre (a clean one on plain forest)
TEMPLATE_SOCKET = (0, 1835, 395)


def socket_at(im, x, y, scale=1.0):
    """
    Is there a painted socket centred at (x, y)? The disc (r <= 10) is dark and unsaturated, the rim
    (r ~ 16-18) is clearly lighter than the disc. Returns (disc luminance, rim - disc contrast).
    """
    rgb = im.load()
    W, H = im.size

    def ring(r):
        out = []
        for k in range(24):
            a = 2 * math.pi * k / 24
            px_ = int(round(x + r * scale * math.cos(a)))
            py_ = int(round(y + r * scale * math.sin(a)))
            if 0 <= px_ < W and 0 <= py_ < H:
                p = rgb[px_, py_]
                out.append(sum(p) / 3.0)
        return out
    disc = [v for r in (0, 4, 8) for v in ring(r)]
    rim = max((sum(ring(r)) / 24.0 for r in (15, 16, 17, 18)), default=0)
    dl = sum(disc) / max(1, len(disc))
    return dl, rim - dl


def check_route(im, route, scale=1.0, min_gap=100):
    """Problems of a hand-made route: points without a socket, nodes closer than `min_gap`, crossing roads."""
    problems = []
    for k, (x, y) in enumerate(route):
        dl, contrast = socket_at(im, x, y, scale)
        if dl > 85 or contrast < 25:
            problems.append(f'node {k + 1} at {x},{y}: no socket (disc {dl:.0f}, rim contrast {contrast:.0f})')
    for a in range(len(route)):
        for b in range(a + 1, len(route)):
            if math.dist(route[a], route[b]) < min_gap:
                problems.append(f'nodes {a + 1} and {b + 1} only {math.dist(route[a], route[b]):.0f} px apart')

    def side(p, q, r):
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    segs = list(zip(route, route[1:]))
    for a in range(len(segs)):
        for b in range(a + 2, len(segs)):
            (p1, p2), (p3, p4) = segs[a], segs[b]
            if side(p1, p2, p3) * side(p1, p2, p4) < 0 and side(p3, p4, p1) * side(p3, p4, p2) < 0:
                problems.append(f'roads {a + 1}-{a + 2} and {b + 1}-{b + 2} cross')
    return problems


def match_sockets(images, threshold=0.7):
    """
    Template matching of the socket sprite (numpy + opencv, only for this check): the masked disc + rim of
    TEMPLATE_SOCKET, scaled per map (SOCKET_SCALE), normalised cross-correlation, 41 px non-maximum
    suppression. Returns {map index: [(score, x, y)]} best first.
    """
    import cv2
    import numpy as np
    ti, tx, ty = TEMPLATE_SOCKET
    gray = {i: cv2.cvtColor(np.asarray(im.convert('RGB')), cv2.COLOR_RGB2GRAY).astype(np.float32) for i, im in images.items()}
    r = 24
    base = gray[ti][ty - r:ty + r + 1, tx - r:tx + r + 1]
    out = {}
    for i, g in gray.items():
        s = SOCKET_SCALE.get(i, 1.0)
        tp = cv2.resize(base, None, fx=s, fy=s, interpolation=cv2.INTER_AREA) if s != 1 else base
        n = tp.shape[0]
        c = n // 2
        yy, xx = np.mgrid[:n, :n]
        mask = (((xx - c) ** 2 + (yy - c) ** 2) <= (17 * s) ** 2).astype(np.float32)
        res = np.nan_to_num(cv2.matchTemplate(g, tp, cv2.TM_CCOEFF_NORMED, mask=mask), nan=0, posinf=0, neginf=0)
        res[res > 1.01] = 0
        peak = (res >= cv2.dilate(res, np.ones((41, 41), np.uint8))) & (res > threshold)
        ys, xs = np.where(peak)
        out[i] = sorted(((float(res[y, x]), int(x) + c, int(y) + c) for y, x in zip(ys, xs)), reverse=True)
    return out


def load_stitched(out_dir, m):
    """The stitched map of a layout entry, rebuilt from its strips."""
    im = Image.new('RGB', (m['width'], m['height']))
    for s in m['strips']:
        im.paste(Image.open(os.path.join(out_dir, s['file'])).convert('RGB'), (s['x'], s['y']))
    return im


def route_nodes(i, im, say):
    """The hand-checked route of map i (checked against the image), or None."""
    route = ROUTES.get(i)
    if not route:
        return None
    for p in check_route(im, route, SOCKET_SCALE.get(i, 1.0)):
        say(f'  map {i}: {p}')
    return [{'x': x, 'y': y} for x, y in route]


def nodes_only(args, say):
    """Re-apply ROUTES to an existing layout.json (no re-stitching); also refresh the nodes-<i>.jpg overlays."""
    path = os.path.join(args.out, 'layout.json')
    with open(path) as f:
        layout = json.load(f)
    preview_dir = args.preview_dir or args.out
    for m in layout['maps']:
        i = m['index']
        im = load_stitched(args.out, m)
        nodes = route_nodes(i, im, say)
        if nodes is None:
            continue
        m['nodes'] = nodes
        m['extraSockets'] = []
        m['route'] = 'hand-checked'
        pts = [(n['x'], n['y'], 0) for n in nodes]
        debug_overlay(im, pts, list(range(len(pts))), os.path.join(preview_dir, f'nodes-{i}.jpg'))
        say(f'map {i}: {len(nodes)} nodes from ROUTES')
    write_layout(layout, path)
    say(f'wrote {path}')


def write_layout(layout, path):
    """layout.json with the map keys in a stable order (route data before the big tile table)."""
    order = ['index', 'name', 'cols', 'rows', 'width', 'height', 'anchored', 'strips', 'route', 'nodes', 'extraSockets', 'tiles']
    layout = dict(layout, maps=[{k: m[k] for k in sorted(m, key=lambda k: order.index(k) if k in order else len(order))} for m in layout['maps']])
    with open(path, 'w') as f:
        json.dump(layout, f, indent=1)


def print_matches(args, say):
    """--match-sockets: the sockets template matching finds on each stitched map, against ROUTES."""
    with open(os.path.join(args.out, 'layout.json')) as f:
        layout = json.load(f)
    images = {m['index']: load_stitched(args.out, m) for m in layout['maps']}
    for i, found in match_sockets(images, 0.5).items():
        strong = [p for p in found if p[0] >= 0.7]
        weak = [round(p[0], 2) for p in found if p[0] < 0.7][:3]
        say(f'map {i}: {len(strong)} sockets (scores {strong[-1][0] if strong else 0:.2f}..{strong[0][0] if strong else 0:.2f}; next candidates {weak})')
        route = ROUTES.get(i, [])
        for s, x, y in strong:
            if not any(math.dist((x, y), q) <= 6 for q in route):
                say(f'  socket {x},{y} ({s:.2f}) is not on the route')
        for k, q in enumerate(route):
            if not any(math.dist((x, y), q) <= 6 for s, x, y in strong):
                say(f'  route node {k + 1} at {q[0]},{q[1]} has no matched socket')


# ------------------------------------------------------------------------------------------------- output

def render(tiles, comp):
    """Stitch a component into one image. Returns (image, column x offsets, row y offsets)."""
    cols, rows, grid = comp['cols'], comp['rows'], comp['grid']
    col_w = [TILE] * cols
    row_h = [TILE] * rows
    for (x, y), k in grid.items():
        col_w[x] = min(col_w[x], tiles[k]['w'])
        row_h[y] = min(row_h[y], tiles[k]['h'])
    xs = [0]
    for w in col_w:
        xs.append(xs[-1] + w)
    ys = [0]
    for h in row_h:
        ys.append(ys[-1] + h)
    im = Image.new('RGB', (xs[-1], ys[-1]), (14, 16, 20))
    for (x, y), k in grid.items():
        im.paste(tiles[k]['im'], (xs[x], ys[y]))
    return im, xs, ys


def write_strips(im, out_dir, name, quality=86):
    """Cut a stitched map into JPEG strips of at most MAX_STRIP px per side. Returns the strip records."""
    strips = []
    nx = (im.width + MAX_STRIP - 1) // MAX_STRIP
    ny = (im.height + MAX_STRIP - 1) // MAX_STRIP
    sw = (im.width + nx - 1) // nx
    shh = (im.height + ny - 1) // ny
    k = 0
    for iy in range(ny):
        for ix in range(nx):
            x0, y0 = ix * sw, iy * shh
            x1, y1 = min(im.width, x0 + sw), min(im.height, y0 + shh)
            fn = f'{name}-{k}.jpg'
            im.crop((x0, y0, x1, y1)).save(os.path.join(out_dir, fn), quality=quality, optimize=True)
            strips.append({'file': fn, 'x': x0, 'y': y0, 'w': x1 - x0, 'h': y1 - y0})
            k += 1
    return strips


def debug_overlay(im, sockets, order, path, links=None):
    """Half-size preview with the detected sockets, every path link (green) and the chain (cyan) drawn on top."""
    pv = im.resize((im.width // 2, im.height // 2), Image.LANCZOS)
    d = ImageDraw.Draw(pv)
    pos = {i: k for k, i in enumerate(order)}
    for a, row in (links or {}).items():
        for b in row:
            if a < b:
                d.line((sockets[a][0] // 2, sockets[a][1] // 2, sockets[b][0] // 2, sockets[b][1] // 2), fill=(60, 255, 90), width=2)
    for a, b in zip(order, order[1:]):
        d.line((sockets[a][0] // 2, sockets[a][1] // 2, sockets[b][0] // 2, sockets[b][1] // 2), fill=(80, 220, 255), width=3)
    for i, (x, y, c) in enumerate(sockets):
        x, y = x // 2, y // 2
        col = (255, 230, 40) if i in pos else (255, 60, 60)
        d.ellipse((x - 9, y - 9, x + 9, y + 9), outline=col, width=2)
        d.text((x + 10, y - 6), str(pos[i] + 1) if i in pos else '?', fill=col)
    pv.save(path, quality=80)


def main():
    global T_SINGLE, MARGIN, ENERGY, T_MULTI, T_REJECT
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(ROOT, 'assets', 'orig', 'map'))
    ap.add_argument('--preview-dir', default=None)
    ap.add_argument('--preview-only', action='store_true')
    ap.add_argument('--min-tiles', type=int, default=6)
    ap.add_argument('--t-single', type=float, default=T_SINGLE)
    ap.add_argument('--margin', type=float, default=MARGIN)
    ap.add_argument('--energy', type=float, default=ENERGY)
    ap.add_argument('--t-multi', type=float, default=T_MULTI)
    ap.add_argument('--t-reject', type=float, default=T_REJECT)
    ap.add_argument('--quiet', action='store_true')
    ap.add_argument('--nodes-only', action='store_true', help='re-apply ROUTES to the existing layout.json')
    ap.add_argument('--match-sockets', action='store_true', help='list the sockets found by template matching')
    args = ap.parse_args()
    T_SINGLE, MARGIN, ENERGY, T_MULTI, T_REJECT = args.t_single, args.margin, args.energy, args.t_multi, args.t_reject
    log = (lambda m: None) if args.quiet else (lambda m: print(m, file=sys.stderr))
    say = lambda m: print(m, file=sys.stderr)
    if args.nodes_only:
        nodes_only(args, say)
        return
    if args.match_sockets:
        print_matches(args, say)
        return

    t0 = time.time()
    tiles = load_tiles()
    say(f'{len(tiles)} candidate tiles')
    sh = edge_scores(tiles, 'h')
    sv = edge_scores(tiles, 'v')
    energy = edge_energy(tiles)
    say(f'scores in {time.time() - t0:.1f}s')
    maps = anchored_maps(tiles)
    for m in maps:
        say(f'anchored map: corner {m["w"]}x{m["h"]} -> {m["cols"]}x{m["rows"]} cells ({m["cols"] * m["rows"]} tiles)')
    grids, placed = grow_anchored(tiles, sh, sv, maps, log)
    comps = [{'cols': m['cols'], 'rows': m['rows'], 'grid': grids[i], 'anchored': True} for i, m in enumerate(maps)]
    rest = {k: t for k, t in tiles.items() if k not in placed}
    say(f'{len(placed)} tiles in anchored maps, {len(rest)} left for the jigsaw')
    if rest:
        jig = assemble(rest, {k: {b: s for b, s in sh[k].items() if b in rest} for k in rest},
                       {k: {b: s for b, s in sv[k].items() if b in rest} for k in rest}, energy, log)
        comps += [c for c in jig.components() if len(c['grid']) >= args.min_tiles]
    say(f'{len(comps)} maps / components in {time.time() - t0:.1f}s')
    preview_dir = args.preview_dir or args.out
    os.makedirs(preview_dir, exist_ok=True)
    rendered = []
    for i, c in enumerate(comps):
        n = len(c['grid'])
        full = c['cols'] * c['rows']
        im, xs, ys = render(tiles, c)
        rendered.append(im)
        im.resize((max(1, im.width // 4), max(1, im.height // 4)), Image.LANCZOS).save(os.path.join(preview_dir, f'preview-{i}.jpg'), quality=82)
        say(f'map {i}: {c["cols"]}x{c["rows"]} cells, {n} tiles ({100 * n / full:.0f}% filled), {xs[-1]}x{ys[-1]} px' + (' [anchored]' if c.get('anchored') else ''))
    if args.preview_only:
        return
    os.makedirs(args.out, exist_ok=True)
    layout = {'tileSize': TILE, 'source': 'tools/build-map.py (edge-matched from assets/orig/prepackaged)', 'maps': []}
    for i, c in enumerate(comps):
        im = rendered[i]
        if im.width < 2 * TILE or im.height < 2 * TILE:
            continue
        sockets = detect_sockets(im)
        raw_links = path_links(im, sockets)
        links = prune_shortcuts(sockets, raw_links)
        order = order_chain(sockets, links)
        say(f'map {i}: {len(sockets)} sockets, {sum(len(v) for v in raw_links.values()) // 2} path links '
            f'({sum(len(v) for v in links.values()) // 2} after pruning shortcuts), chain of {len(order)}')
        name = f'world-{i}'
        strips = write_strips(im, args.out, name)
        routed = route_nodes(i, im, say)
        if routed:
            pts = [(n['x'], n['y'], 0) for n in routed]
            debug_overlay(im, pts, list(range(len(pts))), os.path.join(preview_dir, f'nodes-{i}.jpg'))
        else:
            debug_overlay(im, sockets, order, os.path.join(preview_dir, f'nodes-{i}.jpg'), links)
        if not args.quiet:
            sizes = {}
            seen = set()
            for a in range(len(sockets)):
                if a in seen:
                    continue
                stack = [a]
                seen.add(a)
                n = 0
                while stack:
                    k = stack.pop()
                    n += 1
                    for b in links.get(k, {}):
                        if b not in seen:
                            seen.add(b)
                            stack.append(b)
                sizes[n] = sizes.get(n, 0) + 1
            say(f'  component sizes: {sorted(sizes.items(), reverse=True)}')
        used = set(order)
        layout['maps'].append({
            'index': i, 'name': name, 'cols': c['cols'], 'rows': c['rows'], 'width': im.width, 'height': im.height,
            'anchored': bool(c.get('anchored')),
            'strips': strips,
            'route': 'hand-checked' if routed else 'detected',
            'nodes': routed or [{'x': sockets[k][0], 'y': sockets[k][1]} for k in order],
            'extraSockets': [] if routed else [{'x': x, 'y': y} for j, (x, y, _) in enumerate(sockets) if j not in used],
            'tiles': {f'{x},{y}': k for (x, y), k in c['grid'].items()},
        })
    write_layout(layout, os.path.join(args.out, 'layout.json'))
    say(f'wrote {os.path.join(args.out, "layout.json")}')


if __name__ == '__main__':
    main()
