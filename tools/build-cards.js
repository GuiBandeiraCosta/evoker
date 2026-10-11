#!/usr/bin/env node
/**
 * @file Data pipeline: exploration/research/wiki-card-catalog.json + data/card-overrides.json
 * (+ data/abilities.json when present) → data/cards.json in the shape of architecture §3.1.
 *
 *   node tools/build-cards.js            writes data/cards.json
 *   node tools/build-cards.js --check    exits 1 if data/cards.json is stale
 *   node tools/build-cards.js --quiet    no summary
 *
 * Idempotent and deterministic. Fails loudly when a card still lacks mana, attack or hp after
 * the overrides, or when an override is malformed.
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { slugify } from '../src/core/cards-db.js';
import { RARITIES, TRIBES, SETS, DIRECTIONS, MAX_STAGE } from '../src/core/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PATHS = Object.freeze({
  catalog: path.join(ROOT, 'exploration', 'research', 'wiki-card-catalog.json'),
  overrides: path.join(ROOT, 'data', 'card-overrides.json'),
  abilities: path.join(ROOT, 'data', 'abilities.json'),
  output: path.join(ROOT, 'data', 'cards.json'),
  artDir: path.join(ROOT, 'assets', 'cards'),
});

const STAGE_KEYS = ['-', '+', '++', '+++', '++++'];
const STATS = ['attack', 'hp', 'ability'];
const CATALOG_STAT_KEY = { attack: 'atk', hp: 'life', ability: 'abil' };
const OVERRIDE_FIELDS = new Set([
  'reason', 'mana', 'rarity', 'tribe', 'dirs', 'caps', 'base', 'growth', 'set', 'sets',
  'sourceText', 'evolving', 'trainer', 'abilityIsPercent', 'abilityFlat', 'flat', 'name',
]);

/* ----------------------------------------------------------------------------------------------
 * Normalisers (exported for tests)
 * -------------------------------------------------------------------------------------------- */

/**
 * Rarity id from the wiki label ("Very Common" → common, "Heroïc" → heroic).
 * @param {string|null} label
 * @returns {string|null}
 */
export function normalizeRarity(label) {
  const key = slugify(label || '');
  if (!key) return null;
  if (key === 'very-common') return 'common';
  const id = key.replace(/-/g, '');
  return RARITIES[id] ? id : null;
}

/**
 * Tribe id from the wiki race label.
 * @param {string|null} label
 * @returns {string|null}
 */
export function normalizeTribe(label) {
  const id = slugify(label || '');
  return TRIBES[id] ? id : null;
}

/**
 * Attack directions from the wiki free text. Unknown / placeholder text → no attack.
 * @param {string|null} text e.g. "3 directions (Left, Front, Right)", "direct, left neighbor"
 * @returns {string[]} canonical subset of DIRECTIONS
 */
export function parseDirs(text) {
  const found = new Set();
  const src = String(text || '').toLowerCase().trim();
  if (!src || src === 'none' || src === '-' || src === 'monster' || src === 'null') return [];
  // Drop the "N direction(s)" prefix and split on commas / parentheses / slashes / "and".
  const body = src.replace(/^(one|two|three|\d+)\s+directions?\s*/i, '');
  const tokens = body.split(/[,()/]|\band\b/).map((t) => t.trim()).filter(Boolean);
  for (const token of tokens) {
    if (/^(left|right)\s+neigh?bou?r$/.test(token)) found.add(token.startsWith('left') ? 'ownLeft' : 'ownRight');
    else if (/^(direct|front|middle|center|centre)$/.test(token)) found.add('direct');
    else if (token === 'left') found.add('left');
    else if (token === 'right') found.add('right');
    else if (token === 'none') { /* explicit no-attack */ }
    else throw new Error(`parseDirs: unrecognised direction token "${token}" in "${text}"`);
  }
  return DIRECTIONS.filter((d) => found.has(d));
}

/**
 * Set id(s) from the wiki portal field.
 * @param {string|null} portal
 * @returns {{set: string, sets?: string[]}}
 */
export function normalizeSet(portal) {
  const raw = String(portal || '').trim();
  if (!raw) return { set: 'main' };
  // the Dungeon Casino set was removed from the game (2026-10-10, card-overrides.json $removed): a card the casino
  // only re-ran (Army of Ghosts: "Dawn of Eternity and Dungeon Casinò") keeps its original set only
  const parts = raw.split(/\s+(?:and|&|\+)\s+/i).map((p) => slugify(p)).filter((id) => id !== 'casino-dungeon' && id !== 'dungeon-casino');
  if (!parts.length) return { set: 'main' };
  for (const id of parts) {
    if (!SETS.some((s) => s.id === id)) throw new Error(`normalizeSet: unknown portal "${portal}"`);
  }
  return parts.length > 1 ? { set: parts[0], sets: parts } : { set: parts[0] };
}

/**
 * Art file names per stage. By the wiki convention they are Name_With_Underscores.jpg, +.jpg … ++++.jpg.
 * When the list of files actually present in assets/cards is given, the map is built from those files
 * instead (matching case- and apostrophe-insensitively, .jpg/.png/.jpeg): stages without a file are
 * omitted, except stage 0, which falls back to the lowest stage that has art, or to the conventional
 * name (so the UI shows its placeholder).
 * @param {string} name
 * @param {string[]|null} [available] file names present in assets/cards
 * @returns {Record<string, string>}
 */
export function artNames(name, available = null) {
  const stem = String(name).trim().replace(/\s+/g, '_');
  const art = {};
  if (!available) {
    for (let s = 0; s <= MAX_STAGE; s += 1) art[String(s)] = `${stem}${'+'.repeat(s)}.jpg`;
    return art;
  }
  const norm = (f) => String(f).toLowerCase().replace(/['’]/g, '');
  const index = new Map();
  for (const f of available) index.set(norm(f), f);
  for (let s = 0; s <= MAX_STAGE; s += 1) {
    for (const ext of ['.jpg', '.png', '.jpeg']) {
      const hit = index.get(norm(`${stem}${'+'.repeat(s)}${ext}`));
      if (hit) { art[String(s)] = hit; break; }
    }
  }
  if (!art['0']) {
    const first = Object.keys(art).sort()[0];
    art['0'] = first ? art[first] : `${stem}.jpg`;
  }
  return art;
}

/**
 * A wiki stat cell → { value, percent } or null when unknown.
 * @param {number|string|null|undefined} cell
 * @returns {{value: number, percent: boolean}|null}
 */
export function parseStatCell(cell) {
  if (typeof cell === 'number' && Number.isFinite(cell)) return { value: cell, percent: false };
  if (typeof cell === 'string') {
    const m = cell.trim().match(/^(-?\d+(?:[.,]\d+)?)\s*%$/);
    if (m) return { value: Number(m[1].replace(',', '.')), percent: true };
    const n = Number(cell.trim());
    if (cell.trim() !== '' && Number.isFinite(n)) return { value: n, percent: false };
  }
  return null;
}

/**
 * Cleans the wiki ability text (quotes, whitespace).
 * @param {string|null} text
 * @returns {string}
 */
export function cleanText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().replace(/^["“”']+|["“”']+$/g, '').trim();
}

/* ----------------------------------------------------------------------------------------------
 * Build
 * -------------------------------------------------------------------------------------------- */

/**
 * Converts one catalog entry into the cards.json shape (before overrides).
 * @param {object} entry wiki-card-catalog.json entry
 * @param {string[]|null} [artFiles] file names present in assets/cards (null = convention only)
 * @returns {object}
 */
export function fromCatalog(entry, artFiles = null) {
  const name = String(entry.name).trim();
  const id = slugify(name);
  const levels = entry.levels || {};
  const l1 = levels['1'] || {};
  const dirs = parseDirs(entry.attack_dirs);
  const categories = Array.isArray(entry.categories) ? entry.categories.slice() : [];
  const evolving = categories.includes('Evolving Ability');
  const trainer = categories.includes('Trainer');
  const sourceText = cleanText(entry.ability_text);

  let abilityIsPercent = /_+\s*%/.test(sourceText);
  const growth = { attack: [], hp: [], ability: [] };
  for (const stat of STATS) {
    for (const key of STAGE_KEYS) {
      const cell = parseStatCell(levels[key] && levels[key][CATALOG_STAT_KEY[stat]]);
      if (cell && cell.percent && stat === 'ability') abilityIsPercent = true;
      growth[stat].push(cell ? cell.value : null);
    }
  }
  const baseCells = {
    attack: parseStatCell(l1.atk), hp: parseStatCell(l1.life), ability: parseStatCell(l1.abil),
  };
  if (baseCells.ability && baseCells.ability.percent) abilityIsPercent = true;
  const base = {
    attack: baseCells.attack ? baseCells.attack.value : (dirs.length === 0 ? 0 : null),
    hp: baseCells.hp ? baseCells.hp.value : null,
    ability: baseCells.ability ? baseCells.ability.value : null,
  };
  const rarity = normalizeRarity(entry.rarity);
  const card = {
    id,
    name,
    tribe: normalizeTribe(entry.race),
    rarity,
    mana: Number.isFinite(entry.mana) ? entry.mana : null,
    dirs,
    base,
    caps: rarity ? RARITIES[rarity].caps.slice() : null,
    growth,
    ability: null,
    ...normalizeSet(entry.portal),
    art: artNames(name, artFiles),
    categories,
    sourceText,
  };
  if (abilityIsPercent) card.abilityIsPercent = true;
  if (evolving) card.evolving = true;
  if (trainer) card.trainer = true;
  return card;
}

/**
 * Applies one override entry onto a card (in place).
 * @param {object} card
 * @param {object} patch
 * @param {string} id
 */
export function applyOverride(card, patch, id) {
  if (!patch || typeof patch !== 'object') throw new Error(`override "${id}" must be an object`);
  if (typeof patch.reason !== 'string' || !patch.reason.trim()) throw new Error(`override "${id}" needs a "reason"`);
  for (const key of Object.keys(patch)) {
    if (!OVERRIDE_FIELDS.has(key)) throw new Error(`override "${id}": unknown field "${key}"`);
  }
  if (patch.base) {
    for (const [stat, value] of Object.entries(patch.base)) {
      if (!STATS.includes(stat)) throw new Error(`override "${id}": base.${stat} is not a stat`);
      card.base[stat] = value;
    }
  }
  if (patch.growth) {
    for (const [stat, arr] of Object.entries(patch.growth)) {
      if (!STATS.includes(stat)) throw new Error(`override "${id}": growth.${stat} is not a stat`);
      if (!Array.isArray(arr) || arr.length !== MAX_STAGE + 1) throw new Error(`override "${id}": growth.${stat} needs 5 entries`);
      card.growth[stat] = arr.slice();
    }
  }
  if (patch.caps) {
    if (!Array.isArray(patch.caps) || patch.caps.length !== MAX_STAGE + 1) throw new Error(`override "${id}": caps needs 5 entries`);
    card.caps = patch.caps.slice();
  }
  if (patch.rarity !== undefined) {
    const r = normalizeRarity(patch.rarity);
    if (!r) throw new Error(`override "${id}": unknown rarity "${patch.rarity}"`);
    card.rarity = r;
    if (!patch.caps) card.caps = RARITIES[r].caps.slice();
  }
  if (patch.tribe !== undefined) {
    const t = normalizeTribe(patch.tribe);
    if (!t) throw new Error(`override "${id}": unknown tribe "${patch.tribe}"`);
    card.tribe = t;
  }
  if (patch.flat !== undefined) {
    if (!Array.isArray(patch.flat) || patch.flat.some((s) => !STATS.includes(s))) {
      throw new Error(`override "${id}": flat must be an array of stat names`);
    }
  }
  for (const key of ['mana', 'dirs', 'set', 'sets', 'sourceText', 'evolving', 'trainer', 'abilityIsPercent', 'abilityFlat', 'flat', 'name']) {
    if (patch[key] !== undefined) card[key] = Array.isArray(patch[key]) ? patch[key].slice() : patch[key];
  }
}

/**
 * Validates a finished card; returns a list of problems (empty = ok).
 * @param {object} card
 * @returns {string[]}
 */
export function validateCard(card) {
  const errs = [];
  const tag = card.id || card.name;
  if (!card.id || card.id !== slugify(card.name)) errs.push(`${tag}: id must be the slug of the name`);
  if (!TRIBES[card.tribe]) errs.push(`${tag}: unknown tribe "${card.tribe}"`);
  if (!RARITIES[card.rarity]) errs.push(`${tag}: unknown rarity "${card.rarity}"`);
  if (!Number.isInteger(card.mana) || card.mana <= 0) errs.push(`${tag}: mana missing (${card.mana})`);
  if (!Array.isArray(card.dirs) || card.dirs.some((d) => !DIRECTIONS.includes(d))) errs.push(`${tag}: invalid dirs ${JSON.stringify(card.dirs)}`);
  if (!Number.isInteger(card.base.attack) || card.base.attack < 0) errs.push(`${tag}: base attack missing (${card.base.attack})`);
  if (!Number.isInteger(card.base.hp) || card.base.hp <= 0) errs.push(`${tag}: base hp missing (${card.base.hp})`);
  // Bouncer and Cursed Stag genuinely start at 0 attack and grow it (stats.js grows a 0 base linearly).
  if (card.dirs.length > 0 && card.base.attack === 0 && !card.growth.attack.some((v) => v > 0)) {
    errs.push(`${tag}: has attack directions but never any attack`);
  }
  const hasBlank = /_+/.test(card.sourceText || '');
  if (hasBlank && !card.evolving && typeof card.base.ability !== 'number') errs.push(`${tag}: ability text has a value blank but base ability is missing`);
  if (card.base.ability != null && typeof card.base.ability !== 'number') errs.push(`${tag}: base ability must be a number or null`);
  if (!Array.isArray(card.caps) || card.caps.length !== MAX_STAGE + 1 || card.caps.some((c, i) => !Number.isInteger(c) || c < 1 || (i > 0 && c <= card.caps[i - 1]))) {
    errs.push(`${tag}: caps must be 5 ascending integers`);
  }
  for (const stat of STATS) {
    const arr = card.growth && card.growth[stat];
    if (!Array.isArray(arr) || arr.length !== MAX_STAGE + 1 || arr.some((v) => v !== null && typeof v !== 'number')) {
      errs.push(`${tag}: growth.${stat} must be 5 numbers or nulls`);
    }
  }
  if (card.flat !== undefined && (!Array.isArray(card.flat) || card.flat.some((s) => !STATS.includes(s)))) {
    errs.push(`${tag}: flat must be an array of stat names`);
  }
  if (!SETS.some((s) => s.id === card.set)) errs.push(`${tag}: unknown set "${card.set}"`);
  if (card.sets && card.sets.some((s) => !SETS.some((d) => d.id === s))) errs.push(`${tag}: unknown extra set`);
  return errs;
}

/**
 * Pure build: catalog entries + overrides + abilities → cards.json object.
 * @param {object} input
 * @param {object[]} input.catalog
 * @param {Record<string, object>} [input.overrides]
 * @param {Record<string, object>|null} [input.abilities]
 * @param {string[]|null} [input.artFiles] file names present in assets/cards (null = convention only)
 * @returns {{version: number, cards: object[], warnings: string[]}}
 */
export function buildCards({ catalog, overrides = {}, abilities = null, artFiles = null }) {
  if (!Array.isArray(catalog)) throw new TypeError('buildCards: catalog array expected');
  const warnings = [];
  // `$removed` in the overrides: cards taken out of the game (ids + reason), e.g. the Dungeon Casino set (2026-10-10)
  const removed = new Set((overrides.$removed && Array.isArray(overrides.$removed.ids)) ? overrides.$removed.ids : []);
  const cards = catalog.filter((entry) => !removed.has(slugify(entry.name))).map((entry) => fromCatalog(entry, artFiles));
  if (removed.size) warnings.push(`removed: ${[...removed].join(', ')} (${(overrides.$removed && overrides.$removed.reason) || 'no reason given'})`);
  const byId = new Map();
  for (const card of cards) {
    if (byId.has(card.id)) throw new Error(`duplicate card id "${card.id}"`);
    byId.set(card.id, card);
  }
  for (const [id, patch] of Object.entries(overrides)) {
    if (id.startsWith('$')) continue;
    const card = byId.get(id);
    if (!card) throw new Error(`override "${id}" matches no card`);
    applyOverride(card, patch, id);
  }
  let abilityHits = 0;
  for (const card of cards) {
    if (abilities && Object.prototype.hasOwnProperty.call(abilities, card.id)) {
      card.ability = abilities[card.id];
      abilityHits += 1;
    } else {
      card.ability = null;
      if (abilities && (card.sourceText || card.evolving) && !card.trainer) warnings.push(`no ability definition for ${card.id}`);
    }
  }
  if (!abilities) warnings.push('data/abilities.json not found: every card has ability: null');
  else warnings.push(`${abilityHits} ability definitions attached`);
  if (artFiles) {
    const present = new Set(artFiles);
    const withArt = cards.filter((c) => present.has(c.art['0'])).length;
    const stages = cards.reduce((n, c) => n + Object.keys(c.art).length, 0);
    warnings.push(`art: ${withArt}/${cards.length} cards have base art, ${stages} stage images mapped from assets/cards`);
    for (const c of cards) if (!present.has(c.art['0'])) warnings.push(`no art for ${c.id} (placeholder will be shown)`);
  } else {
    warnings.push('assets/cards not found: art names follow the wiki convention');
  }
  const errors = cards.flatMap(validateCard);
  if (errors.length) {
    throw new Error(`build-cards: ${errors.length} problem(s) after overrides:\n  ${errors.join('\n  ')}`);
  }
  cards.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { version: 1, cards, warnings };
}

/**
 * Serialises the output deterministically (2-space JSON, trailing newline).
 * @param {{version: number, cards: object[]}} data
 * @returns {string}
 */
export function serialize(data) {
  return `${JSON.stringify({ version: data.version, cards: data.cards }, null, 2)}\n`;
}

/**
 * @param {string} file
 * @returns {Promise<object|null>} parsed JSON or null when the file does not exist
 */
async function readJsonOptional(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * CLI entry.
 * @param {string[]} argv
 * @returns {Promise<number>} exit code
 */
export async function main(argv = process.argv.slice(2)) {
  const check = argv.includes('--check');
  const quiet = argv.includes('--quiet');
  const catalog = JSON.parse(await readFile(PATHS.catalog, 'utf8'));
  const overrides = (await readJsonOptional(PATHS.overrides)) || {};
  const abilities = await readJsonOptional(PATHS.abilities);
  let artFiles = null;
  try {
    artFiles = (await readdir(PATHS.artDir)).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort();
  } catch (err) {
    if (!err || err.code !== 'ENOENT') throw err;
  }
  const result = buildCards({ catalog, overrides, abilities, artFiles });
  const text = serialize(result);
  if (check) {
    const current = await readJsonOptional(PATHS.output);
    const same = current && serialize({ version: current.version, cards: current.cards }) === text;
    if (!quiet) console.log(same ? 'data/cards.json is up to date' : 'data/cards.json is STALE — run npm run build:data');
    return same ? 0 : 1;
  }
  await mkdir(path.dirname(PATHS.output), { recursive: true });
  await writeFile(PATHS.output, text, 'utf8');
  if (!quiet) {
    const byRarity = {};
    for (const c of result.cards) byRarity[c.rarity] = (byRarity[c.rarity] || 0) + 1;
    console.log(`wrote ${path.relative(ROOT, PATHS.output)}: ${result.cards.length} cards, ${(text.length / 1024).toFixed(0)} KB`);
    console.log(`  rarities: ${Object.entries(byRarity).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    for (const w of result.warnings) console.log(`  note: ${w}`);
  }
  return 0;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().then((code) => { process.exitCode = code; }).catch((err) => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exitCode = 1;
  });
}
