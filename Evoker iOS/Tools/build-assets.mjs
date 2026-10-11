#!/usr/bin/env node
// Builds GameAssets/ (the app's single swappable art / sound / font catalog) from the web game's assets and writes
// GameAssets/manifest.json in the format documented by Evoker/Assets/AssetCatalog.swift.
//
//   node Tools/build-assets.mjs            full build (copies, rasterises the SVG icons, writes the manifest, checks)
//   node Tools/build-assets.mjs --no-svg   skip the SVG rasterisation (keeps the PNGs of a previous run)
//   node Tools/build-assets.mjs --verbose  list every copied file
//
// Zero dependencies (Node 18+). Idempotent: unchanged files are skipped (same size and mtime), files that the
// source no longer has are removed from GameAssets, duplicate stems inside a group fail the build. The SVG icons
// of Evoker Web/assets/ui cannot be decoded by UIImage, so they are rasterised at 3x their viewBox through the web
// repo's zero-dependency headless-browser driver (Evoker Web/tools/cdp.js, Edge or Chrome, temp profile with an
// absolute --user-data-dir) into GameAssets/ui/<stem>.png.
//
// Sources (never modified):                         Destination (manifest group, keyed by stem):
//   Evoker Web/assets/cards                  ->  GameAssets/cards        "cards" keyed by card id -> stage -> path
//   Evoker Web/assets/orig/ui (+ frames/)    ->  GameAssets/ui           "ui" (frames/<stem> for the stitched 9-slices)
//   Evoker Web/assets/ui *.png|*.jpg|*.svg   ->  GameAssets/ui           "ui" fallbacks (an orig stem wins)
//   Evoker Web/assets/orig/sfx               ->  GameAssets/sfx          "sfx"
//   Evoker Web/assets/orig/fonts             ->  GameAssets/fonts        "fonts" keyed by role (+ fontAlternates, fontNames)
//   Evoker Web/assets/orig/map               ->  GameAssets/map          "map" (strips + layout.json)
//   Evoker Web/assets/orig/minions           ->  GameAssets/minions      "minions"
//   Evoker Web/assets/orig/portraits         ->  GameAssets/portraits    "portraits"
//   Evoker Web/assets/orig/animations        ->  GameAssets/animations   "animations" keyed by name
//   Evoker Web/assets/orig/prepackaged       ->  GameAssets/prepackaged  "prepackaged" keyed by hash (keeps _index.json)
//   Evoker Web/assets/bg (images only)       ->  GameAssets/bg           "bg"
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, rmdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const iosRoot = resolve(here, '..');
const web = resolve(iosRoot, '..', 'Evoker Web');
const webAssets = join(web, 'assets');
const out = join(iosRoot, 'GameAssets');
const args = new Set(process.argv.slice(2));
const verbose = args.has('--verbose');
const doSvg = !args.has('--no-svg');

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp'];
const SVG_SCALE = 3;
/** Font files per client style (css/fonts.css, docs/design/apk-assets.md); alternates are tried when the first fails. */
const FONT_ROLES = {
  standard: ['proximanova-light.ttf'],
  bold: ['proximanova-sbold.ttf'],
  thin: ['07713_CGTimesBold.ttf', '07713_CGTimesBold.fixed.ttf'],
  googleBold: ['Roboto-Bold.ttf'],
};
/** Sprites the app-side contracts name explicitly (CONTRACTS.md 4.3, AssetCatalog.swift); the build fails without them. */
const REQUIRED_UI = ['hud_coinsicon01', 'arena', 'village_normal_bg', 'cardslot', 'hud_victory', 'hud_defeat', 'topbar_bg', 'hud_bottombg01', 'evoker'];

if (!existsSync(webAssets)) {
  console.error(`FAIL web assets not found at ${webAssets}`);
  process.exit(1);
}

const errors = [];
const fail = (m) => { errors.push(m); console.error('FAIL ' + m); };
/** Destination files written or kept by this run (absolute paths); everything else under GameAssets is stale. */
const produced = new Set();
const stats = {};
let copied = 0;
let skipped = 0;

/** @param {string} p */
const posix = (p) => p.split(sep).join('/');
/** Key of a file inside its group: the relative path without the extension ("frames/button_default"). */
const keyOf = (rel) => posix(rel).replace(/\.[^./]+$/, '');

/** List files of a folder (recursively when asked), relative to it, sorted for stable output. */
function listFiles(dir, { recursive = false } = {}) {
  if (!existsSync(dir)) return [];
  const result = [];
  const walk = (d, prefix) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { if (recursive) walk(join(d, entry.name), rel); continue; }
      if (entry.isFile()) result.push(rel);
    }
  };
  walk(dir, '');
  return result.sort();
}

/** Copy unless the destination already has the same size and mtime; keeps the source mtime on the copy. */
function copyIfChanged(src, dst) {
  const s = statSync(src);
  let same = false;
  if (existsSync(dst)) {
    const d = statSync(dst);
    same = d.size === s.size && Math.abs(d.mtimeMs - s.mtimeMs) < 1000;
  }
  if (!same) {
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    utimesSync(dst, s.atime, s.mtime);
    copied++;
    if (verbose) console.log(`copy ${posix(relative(iosRoot, dst))}`);
  } else {
    skipped++;
  }
  produced.add(resolve(dst));
  return s.size;
}

/**
 * Copy one group folder and return {key -> manifest path}. Fails on duplicate keys (case-insensitive, so a
 * case-insensitive macOS checkout cannot silently merge two files).
 * @param {string} group  manifest group / destination folder
 * @param {string} srcDir  absolute source folder
 * @param {string[]} exts  accepted extensions (lower case, with the dot)
 * @param {{recursive?: boolean, keyFn?: (rel: string) => string, keep?: (rel: string) => boolean}} [opts]
 */
function copyGroup(group, srcDir, exts, opts = {}) {
  const entries = {};
  const seen = new Map();
  let bytes = 0;
  let count = 0;
  for (const rel of listFiles(srcDir, { recursive: Boolean(opts.recursive) })) {
    const ext = extname(rel).toLowerCase();
    if (!exts.includes(ext)) continue;
    if (opts.keep && !opts.keep(rel)) continue;
    const key = opts.keyFn ? opts.keyFn(rel) : keyOf(rel);
    const lower = key.toLowerCase();
    if (seen.has(lower)) { fail(`duplicate stem "${key}" in ${group}: ${seen.get(lower)} and ${rel}`); continue; }
    seen.set(lower, rel);
    bytes += copyIfChanged(join(srcDir, rel), join(out, group, rel));
    entries[key] = `${group}/${posix(rel)}`;
    count++;
  }
  stats[group] = { files: (stats[group]?.files || 0) + count, bytes: (stats[group]?.bytes || 0) + bytes };
  return entries;
}

/** Sorted copy of an object (stable manifest diffs). */
const sorted = (obj) => Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));

// ---------------------------------------------------------------------------------------------------------------
// 1. The plain groups
// ---------------------------------------------------------------------------------------------------------------
console.log(`Building ${posix(relative(iosRoot, out))} from ${web}`);
const cardFiles = copyGroup('cards', join(webAssets, 'cards'), IMAGE_EXTS);
const ui = copyGroup('ui', join(webAssets, 'orig', 'ui'), IMAGE_EXTS, { recursive: true });
const sfx = copyGroup('sfx', join(webAssets, 'orig', 'sfx'), ['.mp3']);
const fontFiles = copyGroup('fonts', join(webAssets, 'orig', 'fonts'), ['.ttf', '.otf']);
const map = copyGroup('map', join(webAssets, 'orig', 'map'), [...IMAGE_EXTS, '.json']);
const minions = copyGroup('minions', join(webAssets, 'orig', 'minions'), IMAGE_EXTS);
const portraits = copyGroup('portraits', join(webAssets, 'orig', 'portraits'), IMAGE_EXTS);
const animations = copyGroup('animations', join(webAssets, 'orig', 'animations'), ['.json']);
const prepackaged = copyGroup('prepackaged', join(webAssets, 'orig', 'prepackaged'), [...IMAGE_EXTS, '.json'], {
  // "00f0cd…@2.png" -> "00f0cd…" (the hash the client's _index.json uses); the index itself keeps its name
  keyFn: (rel) => keyOf(rel).replace(/@\d+$/, ''),
});
const bg = copyGroup('bg', join(webAssets, 'bg'), IMAGE_EXTS);

// The stitched 9-slice / 3-slice frames of orig/ui/frames (frames.json: size, slice insets, pieces) -> "frames"
const framesJsonSrc = join(webAssets, 'orig', 'ui', 'frames', 'frames.json');
const frames = {};
if (existsSync(framesJsonSrc)) {
  copyIfChanged(framesJsonSrc, join(out, 'ui', 'frames', 'frames.json'));
  const spec = JSON.parse(readFileSync(framesJsonSrc, 'utf8'));
  for (const stem of Object.keys(spec).sort()) {
    const f = spec[stem];
    const key = `frames/${stem}`;
    if (!ui[key]) { fail(`frames.json names ${stem} but ui/frames/${stem}.png is missing`); continue; }
    const slice = f.slice;
    const insets = typeof slice === 'number'
      ? { top: slice, right: slice, bottom: slice, left: slice }
      : { top: slice?.top ?? 0, right: slice?.right ?? 0, bottom: slice?.bottom ?? 0, left: slice?.left ?? 0 };
    frames[stem] = { path: ui[key], kind: f.kind || 'nine', size: Array.isArray(f.size) ? f.size : [0, 0], insets };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 2. assets/ui fallbacks (PNG / JPG, recursive) into the ui group: an original stem wins
// ---------------------------------------------------------------------------------------------------------------
const fallbackDir = join(webAssets, 'ui');
let fallbackCount = 0;
for (const rel of listFiles(fallbackDir, { recursive: true })) {
  const ext = extname(rel).toLowerCase();
  if (!IMAGE_EXTS.includes(ext)) continue;
  const key = keyOf(rel);
  if (ui[key]) { console.log(`note: assets/ui/${rel} shadowed by orig/ui (${ui[key]})`); continue; }
  const dup = Object.keys(ui).find((k) => k.toLowerCase() === key.toLowerCase());
  if (dup) { fail(`duplicate stem "${key}" in ui: orig ${dup} and assets/ui/${rel}`); continue; }
  const bytes = copyIfChanged(join(fallbackDir, rel), join(out, 'ui', rel));
  ui[key] = `ui/${posix(rel)}`;
  stats.ui.files++; stats.ui.bytes += bytes;
  fallbackCount++;
}

// ---------------------------------------------------------------------------------------------------------------
// 3. SVG icons of assets/ui -> GameAssets/ui/<stem>.png at 3x (headless Edge / Chrome through the web driver)
// ---------------------------------------------------------------------------------------------------------------
const svgFiles = listFiles(fallbackDir).filter((f) => extname(f).toLowerCase() === '.svg');
const referencedSvgs = findReferencedSvgs();
const svgTargets = [];
for (const rel of svgFiles) {
  const stem = keyOf(rel);
  // an original sprite of the same stem wins (never render over the copied original: back.png, info.png)
  if (ui[stem]) { console.log(`note: assets/ui/${rel} shadowed by orig/ui (${ui[stem]})`); continue; }
  svgTargets.push({ rel, stem, dst: join(out, 'ui', `${stem}.png`) });
}
let rasterised = 0;
if (doSvg && svgTargets.length) {
  try {
    rasterised = await rasteriseSvgs(svgTargets);
  } catch (err) {
    console.warn(`warn: SVG rasterisation skipped: ${err.message}`);
  }
}
const iconStems = [];
for (const t of svgTargets) {
  if (!existsSync(t.dst)) {
    if (referencedSvgs.has(t.stem)) fail(`icon ${t.stem}.svg is used by the web UI but no PNG could be rasterised`);
    else console.warn(`warn: ${t.stem}.svg not rasterised (not referenced by the web UI)`);
    continue;
  }
  produced.add(resolve(t.dst));
  ui[t.stem] = `ui/${t.stem}.png`;
  iconStems.push(t.stem);
  stats.ui.files++; stats.ui.bytes += statSync(t.dst).size;
}

/** Stems of the assets/ui SVGs the web UI still references (icon('name'), iconUrl, icon: 'name', direct URLs). */
function findReferencedSvgs() {
  const names = new Set();
  const scan = (dir) => {
    for (const rel of listFiles(dir, { recursive: true })) {
      if (!/\.(js|css|html)$/.test(rel)) continue;
      const text = readFileSync(join(dir, rel), 'utf8');
      for (const m of text.matchAll(/\bicon(?:Url)?\(\s*['"]([a-z0-9-]+)['"]/g)) names.add(m[1]);
      for (const m of text.matchAll(/\bicon:\s*['"]([a-z0-9-]+)['"]/g)) names.add(m[1]);
      for (const m of text.matchAll(/assets\/ui\/([a-z0-9-]+)\.svg/g)) names.add(m[1]);
      for (const m of text.matchAll(/['"]emblem-([a-z]+)['"]/g)) names.add(`emblem-${m[1]}`);
    }
  };
  scan(join(web, 'src'));
  scan(join(web, 'css'));
  // dynamic names: tribe emblems (constants.js emblem field), status icons, reward icons, token icons
  for (const t of ['dwarf', 'elf', 'orc', 'neutral']) names.add(`emblem-${t}`);
  for (const t of ['bronze', 'silver', 'gold']) names.add(`token-${t}`);
  return names;
}

/**
 * Rasterise the SVG files at SVG_SCALE x their viewBox on a transparent canvas inside headless Edge / Chrome
 * (Evoker Web/tools/cdp.js). Each PNG is produced by drawing the SVG on a <canvas> and reading it back as PNG,
 * which keeps the alpha channel exact (a screenshot would depend on the page background).
 * @param {{rel: string, stem: string, dst: string}[]} targets
 * @returns {Promise<number>} files written
 */
async function rasteriseSvgs(targets) {
  const driverPath = join(web, 'tools', 'cdp.js');
  if (!existsSync(driverPath)) throw new Error(`driver not found: ${driverPath}`);
  const { launch, findBrowser } = await import(pathToFileURL(driverPath).href);
  if (!findBrowser()) throw new Error('no Edge / Chrome installed (set EVOKER_BROWSER)');
  const browser = await launch({ headless: true, width: 512, height: 512 });
  let n = 0;
  try {
    await browser.navigate('data:text/html,<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:transparent"></body></html>');
    for (const t of targets) {
      const svgText = readFileSync(join(fallbackDir, t.rel), 'utf8');
      const box = viewBoxOf(svgText);
      const w = Math.round(box.w * SVG_SCALE);
      const h = Math.round(box.h * SVG_SCALE);
      const sized = svgText.replace(/<svg\b([^>]*)>/, (m, attrs) => {
        const a = attrs.replace(/\s(width|height)="[^"]*"/g, '');
        return `<svg${a} width="${w}" height="${h}">`;
      });
      const b64 = await browser.evaluate(async (text, width, height) => {
        const img = new Image();
        const url = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(text)));
        await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('svg failed to load')); img.src = url; });
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        return canvas.toDataURL('image/png').split(',')[1];
      }, sized, w, h);
      const png = Buffer.from(b64, 'base64');
      if (png.length < 100 || png.readUInt32BE(0) !== 0x89504e47) throw new Error(`bad PNG for ${t.rel}`);
      mkdirSync(dirname(t.dst), { recursive: true });
      if (!existsSync(t.dst) || !readFileSync(t.dst).equals(png)) writeFileSync(t.dst, png);
      n++;
      if (verbose) console.log(`raster ${t.rel} -> ui/${t.stem}.png (${w}x${h})`);
    }
  } finally {
    await browser.close();
  }
  return n;
}

/** The viewBox (or width/height) of an SVG document. */
function viewBoxOf(svgText) {
  const vb = /viewBox="([^"]+)"/.exec(svgText);
  if (vb) {
    const p = vb[1].trim().split(/[\s,]+/).map(Number);
    if (p.length === 4 && p[2] > 0 && p[3] > 0) return { w: p[2], h: p[3] };
  }
  const w = Number((/\swidth="([\d.]+)/.exec(svgText) || [])[1]) || 64;
  const h = Number((/\sheight="([\d.]+)/.exec(svgText) || [])[1]) || 64;
  return { w, h };
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Cards: id -> stage -> path, from data/cards.json (art fields are file names in assets/cards)
// ---------------------------------------------------------------------------------------------------------------
const cardsJson = JSON.parse(readFileSync(join(web, 'data', 'cards.json'), 'utf8'));
const cards = {};
const missingCards = [];
const missingStages = {};
for (const card of cardsJson.cards) {
  const art = card.art || {};
  const entry = {};
  for (const stage of Object.keys(art).sort()) {
    const file = art[stage];
    const key = keyOf(file);
    if (cardFiles[key] && basename(cardFiles[key]) === file) entry[stage] = cardFiles[key];
    else (missingStages[card.id] = missingStages[card.id] || []).push(stage);
  }
  if (!entry['0']) missingCards.push(card.id);
  cards[card.id] = entry;
}

// ---------------------------------------------------------------------------------------------------------------
// 5. Fonts: role -> path (+ alternates) and the PostScript names read from the files
// ---------------------------------------------------------------------------------------------------------------
const fonts = {};
const fontAlternates = {};
const fontNames = {};
for (const role of Object.keys(FONT_ROLES)) {
  const candidates = FONT_ROLES[role].filter((f) => fontFiles[keyOf(f)]);
  if (!candidates.length) { fail(`font for role ${role} missing (${FONT_ROLES[role].join(' / ')})`); continue; }
  fonts[role] = fontFiles[keyOf(candidates[0])];
  if (candidates.length > 1) fontAlternates[role] = candidates.slice(1).map((f) => fontFiles[keyOf(f)]);
  for (const f of candidates) {
    const names = readFontNames(join(webAssets, 'orig', 'fonts', f));
    if (!names.postScriptName) console.warn(`warn: could not read the PostScript name of ${f}`);
    if (f === candidates[0]) fontNames[role] = names.postScriptName || null;
  }
}

/** The family / full / PostScript names of a TrueType font (name table, ids 1, 4, 6). */
function readFontNames(file) {
  const result = { family: null, fullName: null, postScriptName: null };
  try {
    const buf = readFileSync(file);
    const numTables = buf.readUInt16BE(4);
    for (let i = 0, off = 12; i < numTables; i++, off += 16) {
      if (buf.toString('ascii', off, off + 4) !== 'name') continue;
      const tOff = buf.readUInt32BE(off + 8);
      const count = buf.readUInt16BE(tOff + 2);
      const strOff = buf.readUInt16BE(tOff + 4);
      const found = {};
      for (let r = 0; r < count; r++) {
        const rec = tOff + 6 + r * 12;
        const platform = buf.readUInt16BE(rec);
        const nameId = buf.readUInt16BE(rec + 6);
        const len = buf.readUInt16BE(rec + 8);
        const so = buf.readUInt16BE(rec + 10);
        const start = tOff + strOff + so;
        if (start + len > buf.length) continue;
        const raw = buf.subarray(start, start + len);
        const text = platform === 1 ? raw.toString('latin1') : utf16be(raw);
        const rank = platform === 3 ? 2 : platform === 1 ? 1 : 0;
        if (!found[nameId] || found[nameId].rank < rank) found[nameId] = { text, rank };
      }
      result.family = found[1]?.text || null;
      result.fullName = found[4]?.text || null;
      result.postScriptName = found[6]?.text || null;
      break;
    }
  } catch (err) {
    console.warn(`warn: ${basename(file)}: ${err.message}`);
  }
  return result;
}

function utf16be(buf) {
  let s = '';
  for (let i = 0; i + 1 < buf.length; i += 2) s += String.fromCharCode(buf.readUInt16BE(i));
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// 6. Prune stale files, write the manifest
// ---------------------------------------------------------------------------------------------------------------
let removed = 0;
const manifestPath = join(out, 'manifest.json');
produced.add(resolve(manifestPath));
const prune = (dir) => {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      prune(p);
      if (readdirSync(p).length === 0) rmdirSync(p);
    } else if (!produced.has(resolve(p))) {
      rmSync(p);
      removed++;
      if (verbose) console.log(`remove ${posix(relative(iosRoot, p))}`);
    }
  }
};
prune(out);

const manifest = {
  version: 1,
  generatedAt: new Date().toISOString(),
  source: 'Evoker Web/assets (Tools/build-assets.mjs)',
  cards: sorted(cards),
  ui: sorted(ui),
  bg: sorted(bg),
  sfx: sorted(sfx),
  fonts,
  fontAlternates,
  fontNames,
  map: sorted(map),
  minions: sorted(minions),
  portraits: sorted(portraits),
  animations: sorted(animations),
  prepackaged: sorted(prepackaged),
  frames,
  missing: { cards: missingCards, cardStages: missingStages },
};
const manifestText = JSON.stringify(manifest, null, 1) + '\n';
if (!existsSync(manifestPath) || readFileSync(manifestPath, 'utf8').replace(/"generatedAt": "[^"]+"/, '') !== manifestText.replace(/"generatedAt": "[^"]+"/, '')) {
  mkdirSync(out, { recursive: true });
  writeFileSync(manifestPath, manifestText);
}

// ---------------------------------------------------------------------------------------------------------------
// 7. Checks: every manifest path exists, every card has stage-0 art or is listed as missing, required stems
// ---------------------------------------------------------------------------------------------------------------
let checkedPaths = 0;
const checkPath = (p, what) => {
  checkedPaths++;
  if (typeof p !== 'string' || !existsSync(join(out, p))) fail(`${what}: manifest path does not exist: ${p}`);
};
for (const [id, stages] of Object.entries(manifest.cards)) for (const [s, p] of Object.entries(stages)) checkPath(p, `card ${id} stage ${s}`);
for (const group of ['ui', 'bg', 'sfx', 'map', 'minions', 'portraits', 'animations', 'prepackaged']) {
  for (const [k, p] of Object.entries(manifest[group])) checkPath(p, `${group}/${k}`);
}
for (const [role, p] of Object.entries(manifest.fonts)) checkPath(p, `font ${role}`);
for (const [role, list] of Object.entries(manifest.fontAlternates)) for (const p of list) checkPath(p, `font alternate ${role}`);
for (const [stem, f] of Object.entries(manifest.frames)) checkPath(f.path, `frame ${stem}`);
for (const card of cardsJson.cards) {
  if (!manifest.cards[card.id]?.['0'] && !missingCards.includes(card.id)) fail(`card ${card.id} has no stage-0 art and is not listed as missing`);
}
for (const role of Object.keys(FONT_ROLES)) if (!manifest.fonts[role]) fail(`font role ${role} missing from the manifest`);
for (const stem of REQUIRED_UI) if (!manifest.ui[stem]) fail(`required sprite missing: ui/${stem}`);
for (const stem of referencedSvgs) if (!manifest.ui[stem]) fail(`icon referenced by the web UI missing: ui/${stem}`);
if (!manifest.map.layout) fail('map/layout.json missing');
if (!manifest.prepackaged._index) fail('prepackaged/_index.json missing');

// ---------------------------------------------------------------------------------------------------------------
// 8. Summary
// ---------------------------------------------------------------------------------------------------------------
const mb = (b) => (b / 1048576).toFixed(1).padStart(6) + ' MB';
let totalFiles = 0;
let totalBytes = 0;
console.log('');
console.log('group        files      size');
for (const g of ['cards', 'ui', 'sfx', 'fonts', 'map', 'minions', 'portraits', 'animations', 'prepackaged', 'bg']) {
  const s = stats[g] || { files: 0, bytes: 0 };
  totalFiles += s.files; totalBytes += s.bytes;
  console.log(`${g.padEnd(12)} ${String(s.files).padStart(5)} ${mb(s.bytes)}`);
}
console.log(`${'total'.padEnd(12)} ${String(totalFiles).padStart(5)} ${mb(totalBytes)}`);
console.log('');
console.log(`cards: ${Object.keys(manifest.cards).length} ids, ${Object.values(manifest.cards).reduce((n, s) => n + Object.keys(s).length, 0)} stage files, ` +
  `${missingCards.length} without stage-0 art${missingCards.length ? ` (${missingCards.join(', ')})` : ''}, ` +
  `${Object.keys(missingStages).length} with missing stages${Object.keys(missingStages).length ? ` (${Object.keys(missingStages).join(', ')})` : ''}`);
console.log(`ui: ${Object.keys(manifest.ui).length} stems (${Object.keys(frames).length} frames, ${fallbackCount} assets/ui fallbacks, ` +
  `${iconStems.length} rasterised icons of ${svgFiles.length} SVGs (${svgFiles.length - svgTargets.length} shadowed by originals), ` +
  `${referencedSvgs.size} referenced by the web UI${doSvg ? `, ${rasterised} rendered this run` : ', rasterisation skipped'})`);
console.log(`fonts: ${Object.entries(manifest.fonts).map(([r, p]) => `${r}=${basename(p)} [${manifest.fontNames[r] || '?'}]`).join(', ')}`);
console.log(`sfx ${Object.keys(manifest.sfx).length}, bg ${Object.keys(manifest.bg).length}, map ${Object.keys(manifest.map).length}, ` +
  `minions ${Object.keys(manifest.minions).length}, portraits ${Object.keys(manifest.portraits).length}, ` +
  `animations ${Object.keys(manifest.animations).length}, prepackaged ${Object.keys(manifest.prepackaged).length}`);
console.log(`copied ${copied}, unchanged ${skipped}, removed ${removed}, manifest paths checked ${checkedPaths}`);
if (errors.length) {
  console.error(`\n${errors.length} error(s)`);
  process.exit(1);
}
console.log('OK');
