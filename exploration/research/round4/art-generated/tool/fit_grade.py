"""Fit a parametric grade per stage (gamma, warm shift in Lab a/b, saturation gain) so the mean colour change
matches the real stage images, measured over all complete cards."""
import json, os, sys, itertools
import numpy as np, cv2

root = sys.argv[1]
cards = json.load(open(os.path.join(root, 'data', 'cards.json'), encoding='utf8'))['cards']
art_dir = os.path.join(root, 'assets', 'cards')
FLIP = {1: True, 2: False, 3: True, 4: False}
pairs = {s: [] for s in range(1, 5)}
for c in cards:
    a = c.get('art') or {}
    fs = [a.get(str(i)) for i in range(5)]
    if any(f is None for f in fs) or len(set(fs)) < 5: continue
    ims = [cv2.resize(cv2.imread(os.path.join(art_dir, f)), (135, 192), interpolation=cv2.INTER_AREA).astype(np.float32) / 255 for f in fs]
    for s in range(1, 5):
        pairs[s].append((ims[0][:, ::-1] if FLIP[s] else ims[0], ims[s]))

def grade(im, g, da, db, sat):
    x = np.power(im, g)
    lab = cv2.cvtColor(x, cv2.COLOR_BGR2LAB)
    lab[..., 1] += da; lab[..., 2] += db
    x = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR).clip(0, 1)
    hsv = cv2.cvtColor(x, cv2.COLOR_BGR2HSV)
    hsv[..., 1] = np.clip(hsv[..., 1] * sat, 0, 1)
    return cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)

def feats(im):
    lab = cv2.cvtColor(im, cv2.COLOR_BGR2LAB); hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)
    return np.array([lab[..., 0].mean(), lab[..., 1].mean(), lab[..., 2].mean(), hsv[..., 1].mean() * 100])

best = {}
for s in range(1, 5):
    P = pairs[s]
    target = np.median([feats(r) for _, r in P], 0)
    sample = P[::3]
    tgt = np.median([feats(r) for _, r in sample], 0)
    bestv = None
    for g, da, db, sat in itertools.product([0.55, 0.65, 0.75, 0.85, 0.95], [0, 3, 6, 9], [4, 8, 12, 16, 20], [1.0, 1.15, 1.3, 1.45]):
        got = np.median([feats(grade(b, g, da, db, sat)) for b, _ in sample], 0)
        err = np.abs((got - tgt) / np.array([3, 2, 2, 4])).sum()
        if bestv is None or err < bestv[0]: bestv = (err, (g, da, db, sat), got, tgt)
    best[s] = bestv[1]
    print(s, 'params', bestv[1], 'got', np.round(bestv[2], 1), 'target', np.round(bestv[3], 1))
json.dump(best, open(sys.argv[2], 'w'))
