"""Extract per-stage overlay residuals: stage - colourfit(flipped/unflipped base). Check if they repeat across cards."""
import json, os, sys
import numpy as np, cv2

root, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
cards = json.load(open(os.path.join(root, 'data', 'cards.json'), encoding='utf8'))['cards']
art_dir = os.path.join(root, 'assets', 'cards')
W, H = 541, 768
FLIP = {1: True, 2: False, 3: True, 4: False}

def load(f):
    im = cv2.imread(os.path.join(art_dir, f), cv2.IMREAD_COLOR)
    return cv2.resize(im, (W, H), interpolation=cv2.INTER_AREA).astype(np.float32) / 255

def colour_fit(src, dst):
    """Robust affine colour map src->dst (3x3 + bias, plus squares), ignoring bright overlay pixels."""
    X = src.reshape(-1, 3); Y = dst.reshape(-1, 3)
    F = np.hstack([X, X ** 2, np.ones((len(X), 1), np.float32)])
    mask = np.ones(len(X), bool)
    for _ in range(3):
        coef, *_ = np.linalg.lstsq(F[mask][::7], Y[mask][::7], rcond=None)
        res = (Y - F @ coef).sum(1)
        mask = res < np.percentile(res, 75)
    return (F @ coef).reshape(dst.shape).clip(0, 1), coef

rows = {s: [] for s in range(1, 5)}
coefs = {s: [] for s in range(1, 5)}
ids = []
for c in cards:
    art = c.get('art') or {}
    files = [art.get(str(i)) for i in range(5)]
    if any(f is None for f in files) or len(set(files)) < 5: continue
    ims = [load(f) for f in files]
    ids.append(c['id'])
    for s in range(1, 5):
        base = cv2.flip(ims[0], 1) if FLIP[s] else ims[0]
        fit, coef = colour_fit(base, ims[s])
        rows[s].append((ims[s] - fit).astype(np.float16))
        coefs[s].append(coef)

np.save(os.path.join(out, 'ids.npy'), np.array(ids))
for s in range(1, 5):
    R = np.stack(rows[s]).astype(np.float32)          # N,H,W,3
    np.save(os.path.join(out, f'res{s}.npy'), R.astype(np.float16))
    np.save(os.path.join(out, f'coef{s}.npy'), np.stack(coefs[s]))
    med = np.median(R, 0)
    cv2.imwrite(os.path.join(out, f'median_res{s}.png'), ((med * 2 + 0.5).clip(0, 1) * 255).astype(np.uint8))
    # pairwise correlation of residual luminance, to see whether overlays repeat
    L = R.mean(3).reshape(len(R), -1)
    L = (L - L.mean(1, keepdims=True)) / (L.std(1, keepdims=True) + 1e-6)
    small = L[:, ::13]
    C = small @ small.T / small.shape[1]
    np.save(os.path.join(out, f'corr{s}.npy'), C)
    off = C[~np.eye(len(C), dtype=bool)]
    print(f'stage {s}: residual corr across cards median {np.median(off):.3f}, p90 {np.percentile(off,90):.3f}, max {off.max():.3f}')
