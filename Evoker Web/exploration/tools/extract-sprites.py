"""Dev-only: cuts every named frame out of the original sprite sheets (exploration/apk/assets/gfx/imagesheets)
into assets/orig/ui/<name>, using exploration/apk/data/sheets.json. Needs Pillow.
Usage: python tools/extract-sprites.py"""
import json, os, sys
from PIL import Image
root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sheets = json.load(open(os.path.join(root, 'exploration', 'apk', 'data', 'sheets.json')))
src = os.path.join(root, 'exploration', 'apk', 'assets', 'gfx', 'imagesheets')
out = os.path.join(root, 'assets', 'orig', 'ui')
os.makedirs(out, exist_ok=True)
n = 0; seen = {}
for sheet, frames in sheets.items():
    path = next((os.path.join(src, f) for f in os.listdir(src) if f.split('.')[0] == sheet), None)
    if not path: print('missing sheet', sheet); continue
    img = Image.open(path).convert('RGBA')
    for f in frames:
        r = f['textureRect']
        box = (int(r['x']), int(r['y']), int(r['x'] + r['width']), int(r['y'] + r['height']))
        crop = img.crop(box)
        name = f['name']
        if name in seen:  # same name on several sheets: keep the larger one
            if seen[name] >= crop.size[0] * crop.size[1]: continue
        seen[name] = crop.size[0] * crop.size[1]
        target = os.path.join(out, name if name.lower().endswith('.png') else os.path.splitext(name)[0] + '.png')
        crop.save(target)
        n += 1
print('wrote', n, 'sprites into', out)
