"""Generate fusion-stage card art (+ .. ++++) from a base image, following the patterns measured on the
158 cards that have all five original images:

  +    mirrored, warm grade, soft glow
  ++   original orientation, stronger grade, sparkle field
  +++  mirrored, stronger grade, denser sparkles, more glow
  ++++ original orientation, strongest golden grade, golden magic circle, sparkles, glow
  The baked-in rarity frame is kept unchanged; there is no zoom or rotation of the art.

usage: python gen_fusion_art.py <project root> <template dir> <out dir> validate|generate
"""
import json, os, sys, hashlib
import numpy as np, cv2

root, tdir, out, mode = sys.argv[1:5]
cards = {c['id']: c for c in json.load(open(os.path.join(root, 'data', 'cards.json'), encoding='utf8'))['cards']}
art_dir = os.path.join(root, 'assets', 'cards')
FLIP = {1: True, 2: False, 3: True, 4: False}
GRADE = {1: (0.80, 3, 5, 1.30), 2: (0.70, 3, 7, 1.32), 3: (0.58, 3, 9, 1.40), 4: (0.55, 3, 12, 1.30)}  # gamma, Lab a, Lab b, saturation (fit_grade.py)
GLOW = {1: 0.22, 2: 0.30, 3: 0.40, 4: 0.50}
SPARK = {1: None, 2: ('hpt_s2_c1', 1.4), 3: ('hpt_s3_c1', 1.8), 4: ('hpt_s3_c2', 1.3)}
CIRCLE = np.load(os.path.join(tdir, 'sprite_circle.npy')).astype(np.float32)
GOLD = np.array([0.30, 0.78, 1.0], np.float32)          # BGR


def seed_of(card_id, s):
    return int(hashlib.md5(f'{card_id}:{s}'.encode()).hexdigest()[:8], 16)


def screen(a, b):
    return 1 - (1 - a) * (1 - b)


def load_base(card_id):
    f = cards[card_id]['art']['0']
    im = cv2.imread(os.path.join(art_dir, f), cv2.IMREAD_COLOR).astype(np.float32) / 255
    h, w = im.shape[:2]
    notes = []
    if h >= 2000:                                   # full-screen screenshot: crop the card by its coloured frame
        hsv = cv2.cvtColor((im * 255).astype(np.uint8), cv2.COLOR_BGR2HSV)
        m = ((hsv[..., 1] > 140) & (hsv[..., 2] > 140) & (hsv[..., 0] >= 8) & (hsv[..., 0] <= 30)).astype(np.uint8)
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
        cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        x, y, bw, bh = cv2.boundingRect(max(cnts, key=cv2.contourArea))
        im = im[y:y + bh, x:x + bw]
        notes.append(f'cropped card from {w}x{h} screenshot')
    h, w = im.shape[:2]
    has_frame = w >= 300 and w != 541               # wiki portal art has a baked rarity frame; main-set 541px art does not
    if w < 300:                                     # 100x100 icon: upscale, no frame
        im = cv2.resize(im, (541, int(541 * h / w)), interpolation=cv2.INTER_CUBIC)
        notes.append(f'LOW QUALITY: base is only {w}x{h}')
    return im, has_frame, notes


def frame_mask(h, w):
    m = np.zeros((h, w), np.float32)
    bx, by = round(w * 0.064), round(h * 0.047)
    m[:by] = 1; m[-by:] = 1; m[:, :bx] = 1; m[:, -bx:] = 1
    return cv2.GaussianBlur(m, (0, 0), 1.2)


def grade(im, s, k=0):
    g, da, db, sat = GRADE[s]
    if k:                                           # source is already stage k: apply only the difference
        gk, dak, dbk, satk = GRADE[k]
        g, da, db, sat = g / gk, da - dak, db - dbk, sat / satk
    x = np.power(np.clip(im, 0, 1), g).astype(np.float32)
    lab = cv2.cvtColor(x, cv2.COLOR_BGR2LAB)
    lab[..., 1] += da; lab[..., 2] += db
    x = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR).clip(0, 1)
    hsv = cv2.cvtColor(x, cv2.COLOR_BGR2HSV)
    hsv[..., 1] = np.clip(hsv[..., 1] * sat, 0, 1)
    return cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)


def glow(im, s, k=0):
    lum = im.mean(2)
    hl = np.clip((lum - 0.45) / 0.55, 0, 1)
    h, w = lum.shape
    b = cv2.GaussianBlur(hl, (0, 0), w * 0.035)
    warm = np.array([0.45, 0.75, 1.0], np.float32)
    return screen(im, b[..., None] * warm * max(0.06, GLOW[s] - (GLOW[k] if k else 0)))


def sparkles(im, s, rng):
    spec = SPARK[s]
    if not spec: return im
    name, k = spec
    t = np.load(os.path.join(tdir, name + '.npy')).astype(np.float32)
    L = t.mean(2)
    hp = np.clip(L - cv2.GaussianBlur(L, (0, 0), 4), 0, None)
    hp = np.clip(hp * 3.0, 0, 1)
    if rng.random() < 0.5: hp = hp[:, ::-1]
    hp = np.roll(hp, rng.integers(0, hp.shape[1]), 1)
    h, w = im.shape[:2]
    hp = cv2.resize(hp, (w, h), interpolation=cv2.INTER_LINEAR)
    halo = cv2.GaussianBlur(hp, (0, 0), 2.5)
    col = np.array([0.85, 0.95, 1.0], np.float32)
    return screen(im, np.clip((hp + halo * 0.6) * k, 0, 1)[..., None] * col)


def magic_circle(im, rng):
    h, w = im.shape[:2]
    d = int(w * rng.uniform(0.60, 0.72))
    c = cv2.resize(CIRCLE, (d, d), interpolation=cv2.INTER_AREA)
    M = cv2.getRotationMatrix2D((d / 2, d / 2), rng.uniform(0, 360), 1)
    c = cv2.warpAffine(c, M, (d, d))
    layer = np.zeros((h, w), np.float32)
    cx, cy = int(w * rng.choice([0.38, 0.5, 0.62])), int(h * rng.uniform(0.30, 0.55))
    x0, y0 = cx - d // 2, cy - d // 2
    xs, ys = max(0, x0), max(0, y0)
    xe, ye = min(w, x0 + d), min(h, y0 + d)
    layer[ys:ye, xs:xe] = c[ys - y0:ye - y0, xs - x0:xe - x0]
    halo = cv2.GaussianBlur(layer, (0, 0), w * 0.006)
    a = np.clip(layer * 0.75 + halo * 0.5, 0, 1)
    return screen(im, a[..., None] * GOLD)


def make_stage(base, has_frame, card_id, s, k=0):
    rng = np.random.default_rng(seed_of(card_id, s))
    im = base[:, ::-1].copy() if FLIP[s] else base.copy()
    im = grade(im, s, k)
    im = glow(im, s, k)
    im = sparkles(im, s, rng)
    if s == 4: im = magic_circle(im, rng)
    if has_frame:
        fm = frame_mask(*im.shape[:2])[..., None]
        im = im * (1 - fm) + base * fm
    return im.clip(0, 1)


def to8(im): return (im * 255 + 0.5).astype(np.uint8)


if mode == 'validate':
    rows = []
    for cid in sys.argv[5:]:
        c = cards[cid]
        base, fr, _ = load_base(cid)
        real = [cv2.imread(os.path.join(art_dir, c['art'][str(s)])) for s in range(5)]
        top = [cv2.resize(r, (180, 256)) for r in real]
        bot = [cv2.resize(to8(base), (180, 256))] + [cv2.resize(to8(make_stage(base, fr, cid, s)), (180, 256)) for s in range(1, 5)]
        rows += [np.hstack(top), np.hstack(bot)]
    cv2.imwrite(out, np.vstack(rows))
else:
    miss = [l.split('(')[1].split(')')[0] for l in open(os.path.join(root, 'docs/research/round4/missing-art.txt')) if l.strip()]
    found_dir = os.path.join(root, 'docs/research/round4/art-found')
    SOURCE_OVERRIDE = {'werewolf-dwarf': 1}         # base is a 100x100 icon; the wiki's + image is the full art
    names = {0: 'base', 1: 'p1', 2: 'p2', 3: 'p3', 4: 'p4'}
    report = []
    for cid in miss:
        c = cards[cid]
        found = {s for s in range(5) if os.path.exists(os.path.join(found_dir, cid, names[s] + '.png'))}
        have = {int(k) for k, f in c['art'].items()} | found
        if cid == 'wizard-apprentice': have = found
        if cid == 'raptorial-fungus': have.discard(1)          # our + is a 100x100 icon
        todo = [s for s in range(1, 5) if s not in have]
        if not todo:
            report.append((cid, '-', 'all stages found')); continue
        k = SOURCE_OVERRIDE.get(cid, 0)
        if k:
            src = cv2.imread(os.path.join(found_dir, cid, names[k] + '.png')).astype(np.float32) / 255
            base = src[:, ::-1].copy() if FLIP[k] else src
            fr, notes = False, [f'built from the found {names[k]} image']
        else:
            base, fr, notes = load_base(cid)
        d = os.path.join(out, cid); os.makedirs(d, exist_ok=True)
        if any('screenshot' in n for n in notes):
            cv2.imwrite(os.path.join(d, 'base_cropped.jpg'), to8(base), [cv2.IMWRITE_JPEG_QUALITY, 92])
        for s in todo:
            cv2.imwrite(os.path.join(d, names[s] + '.jpg'), to8(make_stage(base, fr, cid, s, k)), [cv2.IMWRITE_JPEG_QUALITY, 92])
        report.append((cid, ' '.join('+' * s for s in todo), '; '.join(notes)))
    with open(os.path.join(out, 'generated.txt'), 'w') as f:
        for r in report: f.write(' | '.join(r) + chr(10))
    print(chr(10).join(' | '.join(r) for r in report))
