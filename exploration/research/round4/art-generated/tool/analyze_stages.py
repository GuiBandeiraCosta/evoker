"""Measure how fusion-stage art differs from the base art across all complete cards.

For each stage 1-4: is it mirrored? best similarity transform (scale/rotation/shift) vs base,
mean colour shift in Lab/HSV, brightness, saturation.
"""
import json, os, sys, glob
import numpy as np, cv2

root = sys.argv[1]
cards = json.load(open(os.path.join(root, 'data', 'cards.json'), encoding='utf8'))['cards']
art_dir = os.path.join(root, 'assets', 'cards')

def load(f, size=(270, 384)):
    im = cv2.imread(os.path.join(art_dir, f), cv2.IMREAD_COLOR)
    if im is None:
        return None
    return cv2.resize(im, size, interpolation=cv2.INTER_AREA)

def ncc(a, b):
    a = cv2.cvtColor(a, cv2.COLOR_BGR2GRAY).astype(np.float32); b = cv2.cvtColor(b, cv2.COLOR_BGR2GRAY).astype(np.float32)
    a = cv2.GaussianBlur(a, (0, 0), 3); b = cv2.GaussianBlur(b, (0, 0), 3)
    a = (a - a.mean()) / (a.std() + 1e-6); b = (b - b.mean()) / (b.std() + 1e-6)
    return float((a * b).mean())

orb = cv2.ORB_create(3000)
def similarity(base, st):
    g1 = cv2.cvtColor(base, cv2.COLOR_BGR2GRAY); g2 = cv2.cvtColor(st, cv2.COLOR_BGR2GRAY)
    k1, d1 = orb.detectAndCompute(g1, None); k2, d2 = orb.detectAndCompute(g2, None)
    if d1 is None or d2 is None: return None
    m = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True).match(d1, d2)
    if len(m) < 12: return None
    p1 = np.float32([k1[x.queryIdx].pt for x in m]); p2 = np.float32([k2[x.trainIdx].pt for x in m])
    M, inl = cv2.estimateAffinePartial2D(p1, p2, method=cv2.RANSAC, ransacReprojThreshold=4)
    if M is None or inl.sum() < 10: return None
    s = float(np.hypot(M[0, 0], M[1, 0])); r = float(np.degrees(np.arctan2(M[1, 0], M[0, 0])))
    return dict(scale=round(s, 3), rot=round(r, 2), tx=round(float(M[0, 2]), 1), ty=round(float(M[1, 2]), 1), inliers=int(inl.sum()))

def stats(im):
    hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV).astype(np.float32)
    lab = cv2.cvtColor(im, cv2.COLOR_BGR2LAB).astype(np.float32)
    b, g, r = [float(im[..., i].mean()) for i in range(3)]
    return dict(L=lab[..., 0].mean(), a=lab[..., 1].mean() - 128, bb=lab[..., 2].mean() - 128, S=hsv[..., 1].mean(), V=hsv[..., 2].mean(), r=r, g=g, b=b)

rows = []
for c in cards:
    art = c.get('art') or {}
    files = [art.get(str(i)) for i in range(5)]
    if any(f is None for f in files) or len(set(files)) < 5: continue
    ims = [load(f) for f in files]
    if any(i is None for i in ims): continue
    base = ims[0]
    row = dict(id=c['id'], rarity=c['rarity'], set=c['set'], size=cv2.imread(os.path.join(art_dir, files[0])).shape[:2], stages=[])
    sb = stats(base)
    for i in range(1, 5):
        st = ims[i]
        n_plain = ncc(base, st); n_flip = ncc(cv2.flip(base, 1), st)
        flipped = n_flip > n_plain
        ref = cv2.flip(base, 1) if flipped else base
        sim = similarity(ref, st)
        ss = stats(st)
        row['stages'].append(dict(stage=i, flipped=flipped, ncc=round(max(n_plain, n_flip), 3), sim=sim,
                                  dL=round(ss['L'] - sb['L'], 1), da=round(ss['a'] - sb['a'], 1), db=round(ss['bb'] - sb['bb'], 1),
                                  dS=round(ss['S'] - sb['S'], 1), dV=round(ss['V'] - sb['V'], 1)))
    rows.append(row)

json.dump(rows, open(sys.argv[2], 'w'), indent=1, default=str)
print('cards analysed', len(rows))
for i in range(1, 5):
    st = [r['stages'][i - 1] for r in rows]
    fl = sum(s['flipped'] for s in st)
    sims = [s['sim'] for s in st if s['sim']]
    print(f"stage {i}: flipped {fl}/{len(st)}  median scale {np.median([s['scale'] for s in sims]):.3f}  median |rot| {np.median([abs(s['rot']) for s in sims]):.2f}  "
          f"dL {np.median([s['dL'] for s in st]):.1f}  da {np.median([s['da'] for s in st]):.1f}  db {np.median([s['db'] for s in st]):.1f}  dS {np.median([s['dS'] for s in st]):.1f}  dV {np.median([s['dV'] for s in st]):.1f}  (sim n={len(sims)})")
# flip patterns
from collections import Counter
print(Counter(''.join('F' if s['flipped'] else '.' for s in r['stages']) for r in rows).most_common(10))
print(Counter(str(r['size']) for r in rows).most_common(5))
