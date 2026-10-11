// Dev-only: copies card art downloaded from the Evoker fan wiki into assets/cards,
// named exactly as data/cards.json expects (the "art" map of each card).
// Usage: node tools/import-art.js <download-dir>
// Files that are not found are listed at the end; the UI falls back to a placeholder for them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const srcDir = process.argv[2];
if (!srcDir || !fs.existsSync(srcDir)) {
  console.error('usage: node tools/import-art.js <dir with downloaded wiki images>');
  process.exit(1);
}
const outDir = path.join(root, 'assets', 'cards');
fs.mkdirSync(outDir, { recursive: true });

const cards = JSON.parse(fs.readFileSync(path.join(root, 'data', 'cards.json'), 'utf8')).cards;

// Wiki files that do not follow the Name.jpg / Name+.jpg convention (later-era cards and galleries).
const EXCEPTIONS = {
  'army-of-ghosts': { 0: 'ArmyOfGhosts.jpg', 1: '2-1.png', 2: '3-0.png', 3: '4-0.png', 4: '5-0.png' },
  'bone-dragon': { 0: '07-_Bone_Dragon_(NeuTral).png' },
  'bouncer': { 0: 'Bouncer-full.png' },
  'dark-mage': { 0: '01-_Dark_Mage_(Elf).png' },
  'cursed-stag': { 0: '25_-_Cursed_Stag.png' },
  'goblin-thieves': { 0: 'Godlin_Thieves.png' },
  'raptorial-fungus': { 0: 'Raptorialfungusunevolvedsplash.png', 1: '22_-_Raptorial_Fungus.png' },
  'siamese-orc': { 0: 'Siameseorcsplash.png', 1: 'Siameseorc+splash.png', 2: 'Siameseorc++splash.png' },
  'tomb-colossus': { 0: '24_-_Tomb_Colossus.jpg' },
  'werewolf-dwarf': { 0: '22_-_Werewolf_Dwarf.png' },
  'umbral-dragon': { 0: 'Umbral_Dragon.png', 2: 'Umbral_Dragon++.jpg' },
  'sand-yeti': { 1: '2.png', 2: '3-3.png', 3: '4-3.png', 4: 'Screenshot_20170505-102214.png' },
  'wizard-apprentice': { 1: 'IMG_1840.png', 2: 'IMG_1839.PNG' },
  'wheel-of-fortune': { 0: 'IMG_1883.PNG' },
};

const available = new Map();
for (const f of fs.readdirSync(srcDir)) available.set(f.toLowerCase(), f);

function findFile(name) {
  if (!name) return null;
  const direct = available.get(name.toLowerCase());
  if (direct) return direct;
  const stem = name.replace(/\.[a-z]+$/i, '').toLowerCase();
  for (const ext of ['.jpg', '.jpeg', '.png']) {
    const hit = available.get(stem + ext);
    if (hit) return hit;
  }
  return null;
}

const stages = ['', '+', '++', '+++', '++++'];
let copied = 0;
const missing = [];
for (const card of cards) {
  const artMap = card.art || {};
  const exc = EXCEPTIONS[card.id] || {};
  for (let s = 0; s < 5; s++) {
    const expected = artMap[String(s)] || artMap[s];
    const wikiName = card.name.replace(/ /g, '_') + stages[s] + '.jpg';
    const candidates = [exc[s], expected, wikiName];
    let found = null;
    for (const c of candidates) { found = findFile(c); if (found) break; }
    if (!found) { if (s === 0) missing.push(card.id); continue; }
    const srcPath = path.join(srcDir, found);
    const ext = path.extname(found).toLowerCase() === '.png' ? '.png' : '.jpg';
    const target = expected ? expected.replace(/\.[a-z]+$/i, ext) : `${card.id}${stages[s]}${ext}`;
    fs.copyFileSync(srcPath, path.join(outDir, target));
    copied++;
  }
}
console.log(`copied ${copied} files into assets/cards`);
if (missing.length) console.log(`no base art for ${missing.length} cards: ${missing.join(', ')}`);
