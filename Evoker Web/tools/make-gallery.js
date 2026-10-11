#!/usr/bin/env node
/**
 * Contact sheet of every screenshot the browser tests produce.
 *
 * Reads tests/screenshots/*.png (the smoke tour) and tests/screenshots/<qa-folder>/*.png (the QA
 * scripts), plus the original game's reference screenshots in exploration/research/reference/screenshots,
 * and writes tests/screenshots/gallery.html: one section per folder, one figure per image with a caption
 * derived from the file name ("12-prebattle-quest.png" -> "12 · Prebattle quest"). No dependencies.
 *
 * Usage: node tools/make-gallery.js [--out=tests/screenshots/gallery.html]
 * Open the result through the dev server (http://localhost:8080/tests/screenshots/gallery.html) or directly
 * from the file system; image paths are relative to the docs folder.
 */
import { readdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = resolve(ROOT, String(arg('out', join('tests', 'screenshots', 'gallery.html'))));
const SHOTS = join(ROOT, 'tests', 'screenshots');
const REFERENCE = join(ROOT, 'exploration', 'research', 'reference', 'screenshots');

/** Sections in display order: [title, folder, description]. QA folders are discovered automatically. */
const KNOWN = [
  ['Smoke tour', SHOTS, 'tools/smoke.js: new game, quest 1, boss fight, then every screen and tab.'],
  ['QA: core loop', join(SHOTS, 'qa-core-loop'), 'tools/qa-core-loop.js: title, quest map, quests, potions, boss, pre-battle drags, battle, results, level-ups, portals, help, reload.'],
  ['QA: cards and economy', join(SHOTS, 'qa-cards-economy'), 'tools/qa-cards-economy.js: collection grid, card detail, deck editor, training, fusion, collections, shop, boosters, character, daily rewards, settings.'],
  ['QA: PvP', join(SHOTS, 'qa-pvp'), 'tools/qa-pvp.js: arena offers and fights, potions, pieces hunts, replays, league standings and prizes.'],
  ['E2E regression suite', join(SHOTS, 'e2e'), 'tests/e2e/*.e2e.js: one screenshot per guarded bug (battle visuals, lethal finale, league fight, card lab, cards modes, pre-battle intro).'],
];

/**
 * @param {string} name
 * @param {string} fallback
 * @returns {string}
 */
function arg(name, fallback) {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

/** @param {string} s */
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * "12-prebattle-quest.png" -> { index: "12", caption: "Prebattle quest" };
 * "Evoker-drink-potion.jpg" -> { index: "", caption: "Evoker drink potion" }.
 * @param {string} file
 */
function captionFor(file) {
  const stem = file.replace(/\.(png|jpe?g|webp|gif)$/i, '');
  const m = /^(\d+)-(.*)$/.exec(stem);
  const words = (m ? m[2] : stem).replace(/^evoker-overview__/i, '').replace(/[-_]+/g, ' ').trim();
  const caption = words.charAt(0).toUpperCase() + words.slice(1);
  return { index: m ? m[1] : '', caption };
}

/**
 * @param {string} dir
 * @returns {Promise<string[]>} image file names, sorted
 */
async function imagesIn(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && /\.(png|jpe?g|webp|gif)$/i.test(e.name)).map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

/** Extra QA folders that are not in KNOWN (future scripts) are appended automatically. */
async function discoverSections() {
  const sections = [...KNOWN];
  const known = new Set(KNOWN.map(([, dir]) => dir));
  let entries = [];
  try { entries = await readdir(SHOTS, { withFileTypes: true }); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  for (const e of entries) {
    const dir = join(SHOTS, e.name);
    if (e.isDirectory() && !known.has(dir)) sections.push([`QA: ${e.name.replace(/^qa-/, '').replace(/-/g, ' ')}`, dir, `tools/${e.name}.js`]);
  }
  sections.push(['Reference: the original game', REFERENCE, 'Screenshots of the original Evoker (2013-2018) used as the visual target; see exploration/research/evoker-research-brief.md section 4.']);
  return sections;
}

/** Relative URL from the output file to an image. */
function urlTo(file) {
  return relative(dirname(OUT), file).split('\\').join('/');
}

async function main() {
  const sections = await discoverSections();
  const parts = [];
  let total = 0;
  const toc = [];
  for (const [title, dir, blurb] of sections) {
    const files = await imagesIn(dir);
    if (!files.length) continue;
    const id = basename(dir).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    toc.push(`<a href="#${id}">${escapeHtml(title)} <span class="count">${files.length}</span></a>`);
    total += files.length;
    const figures = files.map((f) => {
      const { index, caption } = captionFor(f);
      const src = urlTo(join(dir, f));
      const label = index ? `<span class="idx">${escapeHtml(index)}</span> ${escapeHtml(caption)}` : escapeHtml(caption);
      return `      <figure>
        <a href="${escapeHtml(src)}" target="_blank" rel="noopener"><img loading="lazy" src="${escapeHtml(src)}" alt="${escapeHtml(caption)}"></a>
        <figcaption>${label}<small>${escapeHtml(f)}</small></figcaption>
      </figure>`;
    });
    parts.push(`    <section id="${id}">
      <h2>${escapeHtml(title)} <span class="count">${files.length}</span></h2>
      <p class="blurb">${escapeHtml(blurb)} <code>${escapeHtml(relative(ROOT, dir).split('\\').join('/'))}/</code></p>
      <div class="grid">
${figures.join('\n')}
      </div>
    </section>`);
  }

  const generated = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Evoker Web screenshots</title>
<style>
  :root { color-scheme: dark; --bg: #16181b; --panel: #22262b; --edge: #3a4149; --text: #e8e6e0; --muted: #9aa3ad; --gold: #f3c54a; --blue: #58a7d8; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px 16px 64px; background: var(--bg); color: var(--text); font: 15px/1.45 "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  h1 { margin: 0 0 6px; font-size: 28px; color: var(--gold); }
  h2 { margin: 0 0 6px; font-size: 22px; color: var(--gold); }
  .count { display: inline-block; min-width: 28px; padding: 0 8px; margin-left: 6px; border-radius: 12px; background: var(--edge); color: var(--text); font-size: 13px; text-align: center; vertical-align: middle; }
  .intro { color: var(--muted); margin: 0 0 18px; }
  nav { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 32px; }
  nav a { color: var(--blue); text-decoration: none; padding: 6px 12px; border: 1px solid var(--edge); border-radius: 8px; background: var(--panel); }
  nav a:hover { border-color: var(--blue); }
  section { margin: 0 0 48px; }
  .blurb { color: var(--muted); margin: 0 0 14px; }
  code { color: var(--text); background: var(--panel); padding: 1px 6px; border-radius: 4px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 14px; }
  figure { margin: 0; background: var(--panel); border: 1px solid var(--edge); border-radius: 8px; overflow: hidden; }
  figure img { display: block; width: 100%; aspect-ratio: 9 / 16; object-fit: cover; background: #000; }
  figcaption { padding: 8px 10px 10px; font-size: 13px; }
  figcaption small { display: block; color: var(--muted); font-size: 11px; word-break: break-all; margin-top: 2px; }
  .idx { color: var(--gold); font-weight: 600; }
  footer { color: var(--muted); font-size: 12px; margin-top: 24px; }
</style>
</head>
<body>
  <h1>Evoker Web screenshots</h1>
  <p class="intro">${total} images from the browser tests (720 x 1280 stage) and the original game's reference shots. Regenerate with <code>node tools/make-gallery.js</code> after running <code>npm run smoke</code> and the <code>tools/qa-*.js</code> scripts. Click an image to open it at full size.</p>
  <nav>
    ${toc.join('\n    ')}
  </nav>
${parts.join('\n')}
  <footer>Generated ${generated}. Card art and the original screenshots belong to their respective owners; see README.md credits.</footer>
</body>
</html>
`;
  await writeFile(OUT, html, 'utf8');
  console.log(`wrote ${relative(ROOT, OUT)}: ${total} images in ${parts.length} sections`);
}

main().catch((err) => { console.error(err); process.exit(1); });
