#!/usr/bin/env python3
"""
Classify the 719 hashed images of assets/orig/prepackaged (the 1.7.4 client's remote-asset cache).

Groups every image by pixel size (`kind`: tile | minion | portrait | card | misc) and labels the 17 quest
minion cut-outs (245x383 PNG) and the 15 boss / character portraits (274x404 PNG) with a tribe and a short
label. The labels were assigned by looking at every image (contact sheets); they live in the tables below so
the script is reproducible without a model in the loop.

Writes
  exploration/apk/data/prepackaged-map.json      { "<hash>": { file, kind, tribe?, label? } }
  assets/orig/minions/<tribe>-<n>.png the minion cut-outs, numbered per tribe (sorted by hash)
  assets/orig/portraits/<label>.png   the portraits, named by label (spaces -> dashes)

Usage: python tools/classify-prepackaged.py [--dry-run]
"""
import argparse
import json
import os
import shutil

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PREPACKAGED = os.path.join(ROOT, 'assets', 'orig', 'prepackaged')
MAP_OUT = os.path.join(ROOT, 'exploration', 'apk', 'data', 'prepackaged-map.json')
MINIONS_OUT = os.path.join(ROOT, 'assets', 'orig', 'minions')
PORTRAITS_OUT = os.path.join(ROOT, 'assets', 'orig', 'portraits')

TILE = 256

# 245x383 transparent PNGs: the enemies that walk in on the quest screen. hash prefix -> (tribe, label)
MINIONS = {
    '03daf8a9': ('neutral', 'blood demon'),
    '04d568e2': ('dwarf', 'armoured dwarf warrior'),
    '15ab79d1': ('orc', 'goblin trickster'),
    '1cacd041': ('dwarf', 'dwarf mechanic'),
    '2177159f': ('dwarf', 'dwarf lantern tinker'),
    '2667be12': ('orc', 'goblin beast rider'),
    '33b02ac9': ('orc', 'orc mask bearer'),
    '3cbe8a5d': ('neutral', 'tentacle leech'),
    '519f29f5': ('elf', 'green druid'),
    '53fd05d2': ('neutral', 'iron knight'),
    '55ed31ef': ('neutral', 'owl beast'),
    '5e4b5565': ('neutral', 'succubus'),
    '8241bc2d': ('orc', 'horned shaman'),
    '873e6bb4': ('elf', 'elf noble'),
    'cd249153': ('neutral', 'bone hunter'),
    'd1a6c1de': ('neutral', 'fortune teller'),
    'dbcb49ec': ('elf', 'crystal archmage'),
}

# 274x404 transparent PNGs: boss / character portraits (boss intro, event banners). hash prefix -> (tribe, label)
PORTRAITS = {
    '1c154bf2': ('neutral', 'black dragon'),
    '24ae4a53': ('neutral', 'ice dragon'),
    '2c2c9415': ('neutral', 'ghost light'),
    '2caaf67d': ('orc', 'orc brute'),
    '4713f020': ('elf', 'red ranger'),
    '49d90dbb': ('dwarf', 'fire knight'),
    '4e9c7322': ('neutral', 'skull dancer'),
    '57bf4135': ('elf', 'antlered treant'),
    '89ce6db9': ('neutral', 'raven beast'),
    'a0f8adf6': ('neutral', 'parasite'),
    'b9b5e098': ('elf', 'feather priestess'),
    'bc667877': ('neutral', 'fire spirit'),
    'c41d590b': ('orc', 'minotaur'),
    'd0e39751': ('neutral', 'masked assassin'),
    'e1c76ed1': ('neutral', 'pink sorceress'),
}


def kind_of(size, fmt, mode, widths, heights):
    w, h = size
    if size == (245, 383) and fmt == 'PNG':
        return 'minion'
    if size == (274, 404) and fmt == 'PNG':
        return 'portrait'
    if size == (217, 307):
        return 'card'
    if fmt == 'JPEG' and mode == 'RGB' and w >= 2 and h >= 2 and (w == TILE or h == TILE or (w in widths and h in heights)):
        return 'tile'
    return 'misc'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()
    index = json.load(open(os.path.join(PREPACKAGED, '_index.json')))
    info = {}
    for h, v in index.items():
        fn = os.path.basename(v['filename'])
        p = os.path.join(PREPACKAGED, fn)
        if not os.path.exists(p):
            continue
        im = Image.open(p)
        info[h] = (fn, im.size, im.format, im.mode)
    widths = {s[1][0] for s in info.values() if s[1][1] == TILE and s[2] == 'JPEG'}
    heights = {s[1][1] for s in info.values() if s[1][0] == TILE and s[2] == 'JPEG'}
    out = {}
    counts = {}
    per_tribe = {}
    copies = []
    for h in sorted(info):
        fn, size, fmt, mode = info[h]
        kind = kind_of(size, fmt, mode, widths, heights)
        entry = {'file': fn, 'kind': kind, 'width': size[0], 'height': size[1]}
        table = MINIONS if kind == 'minion' else PORTRAITS if kind == 'portrait' else None
        if table is not None:
            tribe, label = table.get(h[:8], ('neutral', 'unknown'))
            entry['tribe'] = tribe
            entry['label'] = label
            if kind == 'minion':
                n = per_tribe.get(tribe, 0) + 1
                per_tribe[tribe] = n
                entry['sprite'] = f'{tribe}-{n}.png'
                copies.append((fn, os.path.join(MINIONS_OUT, entry['sprite'])))
            else:
                entry['sprite'] = label.replace(' ', '-') + '.png'
                copies.append((fn, os.path.join(PORTRAITS_OUT, entry['sprite'])))
        out[h] = entry
        counts[kind] = counts.get(kind, 0) + 1
    print('kinds:', ', '.join(f'{k}={v}' for k, v in sorted(counts.items())))
    print('minions per tribe:', per_tribe)
    if args.dry_run:
        return
    os.makedirs(os.path.dirname(MAP_OUT), exist_ok=True)
    with open(MAP_OUT, 'w') as f:
        json.dump(out, f, indent=1, sort_keys=True)
    os.makedirs(MINIONS_OUT, exist_ok=True)
    os.makedirs(PORTRAITS_OUT, exist_ok=True)
    for src, dst in copies:
        shutil.copyfile(os.path.join(PREPACKAGED, src), dst)
    print(f'wrote {MAP_OUT}, {len(copies)} sprites copied')
    for h, e in sorted(out.items(), key=lambda kv: (kv[1]['kind'], kv[1].get('tribe', ''), kv[0])):
        if e['kind'] in ('minion', 'portrait'):
            print(f"{e['kind']:8} {h[:8]} {e['tribe']:8} {e['label']:24} -> {e['sprite']}")


if __name__ == '__main__':
    main()
