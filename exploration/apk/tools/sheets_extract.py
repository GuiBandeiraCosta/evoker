"""Collects every sprite frame (name + textureRect + source size + trimmed/rotated flags) from the
assets.gfx.imagesheets.sheetN dumps into one JSON: { "sheetN": [ {name, x, y, w, h, sw, sh, trimmed, rotated} ] }
Usage: python -I sheets_extract.py <dumpdir> <out.json>
"""
import sys, os, re, json

dumpdir, out = sys.argv[1], sys.argv[2]
SET = re.compile(r'SETTABLE\s+R(\d+)\["(\w+)"\] := (.+)$')
result = {}
for fn in sorted(os.listdir(dumpdir)):
    m = re.match(r'assets\.gfx\.imagesheets\.(sheet\d+)\.txt$', fn)
    if not m:
        continue
    sheet = m.group(1)
    frames = []
    cur = None
    sub = {}
    for ln in open(os.path.join(dumpdir, fn), encoding='utf-8'):
        s = SET.search(ln)
        if not s:
            continue
        reg, key, val = int(s.group(1)), s.group(2), s.group(3).strip()
        if key == 'name' and val.startswith('"'):
            cur = {'name': val.strip('"')}
            frames.append(cur)
            sub = {}
            continue
        if cur is None:
            continue
        if key in ('x', 'y', 'width', 'height'):
            sub.setdefault(reg, {})[key] = float(val) if '.' in val else int(val)
        elif key in ('spriteColorRect', 'textureRect', 'spriteSourceSize') and val.startswith('R'):
            cur[key] = sub.pop(int(val[1:]), {})
        elif key in ('spriteTrimmed', 'textureRotated'):
            cur[key] = (val == 'True')
    result[sheet] = frames
total = sum(len(v) for v in result.values())
json.dump(result, open(out, 'w', encoding='utf-8'), indent=1)
print(len(result), 'sheets,', total, 'frames; sample:', result.get('sheet1', [None])[0])
rot = sum(1 for v in result.values() for f in v if f.get('textureRotated'))
trim = sum(1 for v in result.values() for f in v if f.get('spriteTrimmed'))
print('rotated frames:', rot, 'trimmed frames:', trim)
