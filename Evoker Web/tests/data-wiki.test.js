/**
 * @file Adversarial verification of the data pipeline against the raw wiki dumps
 * (exploration/research/wiki/*.txt) and docs/design/game-design.md. Unlike tests/data.test.js, which
 * checks the build against its own catalog input, this file re-parses the wiki text independently:
 * infobox (mana, tribe, rarity, attack directions, portal), stat tables (template and hand-written),
 * level caps, and the portal / quest pages, and compares them with data/cards.json, statAt() outputs,
 * data/quests.json, src/core/constants.js and the values the game modules use at runtime.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCardsDbFromFile, slugify } from '../src/core/cards-db.js';
import { statAt, capFor, attackAt, abilityAt, hpAt, isFlatStat } from '../src/core/stats.js';
import {
  RARITIES, RARITY_ORDER, SETS, BOOSTER_PACKS, BOOSTER_GRID_CARDS, PIECE_PRICES, LEAGUE, POTION_PRICE_GEMS,
  POTION_PRICE_GEMS_EVENT, SLOT_UNLOCK_LEVELS, FEATURE_UNLOCK_LEVELS, PLAYER_START,
  STAT_POINTS_PER_LEVEL, STAT_POINT_VALUE, MAX_PLAYER_LEVEL, COLLECTION_LIMIT, ARENA,
  WAVE_REWARDS, BOSS_REWARDS, BOSS_GEMS_RANGE, QUEST_GOLD, BOSS_HP, QUEST_TOKEN_TIERS, PIECE_DROP_FROM_QUEST,
  PORTAL_PIECE_FROM_NODE, FIRST_PIECE_GEMS, FIRST_PIECE_GEMS_EVENT, PIECE_HUNT_SLOTS, STARTER_CARDS,
  STARTER_DECK_SLOTS, LEVEL_UP_REWARDS, TRAINER_XP, MAX_SACRIFICE_CARDS,
  MAIN_QUEST_COUNT, PORTAL_QUEST_COUNT, QUEST_BANDS, MAX_STAGE,
  QUEST_STAMINA_PER_TAP, QUEST_GOLD_PER_TAP, DECK_SLOTS,
} from '../src/core/constants.js';
import { TRIBE_BONUS_MULT } from '../src/engine/tribe-bonus.js';
import { boosterPrice, dailyRewardFor, EVENTS, POTION_DEAL_GEMS, POTION_DEAL_COUNT } from '../src/game/shop.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIKI = path.join(ROOT, 'exploration', 'research', 'wiki');
const db = await loadCardsDbFromFile();
const quests = JSON.parse(await readFile(path.join(ROOT, 'data', 'quests.json'), 'utf8'));
const overrides = JSON.parse(await readFile(path.join(ROOT, 'data', 'card-overrides.json'), 'utf8'));
const wikiFiles = await readdir(WIKI);

const STATS = ['attack', 'hp', 'ability'];
const STAGE_KEYS = ['-', '+', '++', '+++', '++++'];
const WIKI_STAT_KEY = { attack: 'attack', hp: 'life', ability: 'ability' };

/** The 25 cards the review covers, across every rarity and tribe. */
const SAMPLE = [
  'dwarf-king', 'werewolf-dwarf', 'grimnack', 'arrow-master', 'catapult', 'basilisk', 'gremlin', 'siren',
  'lightning-spirit', 'thief-of-time', 'voodoo-witch', 'mountain-yeti', 'djinn', 'medusa', 'lookalike',
  'tree-of-life', 'lich-king', 'scrapmaster', 'minotaur', 'bloodsoaked-totem',
  'envoy', 'master-brewer', 'loremaster', 'herb-collector',
];

/* ----------------------------------------------------------------------------------------------
 * Independent wiki parsers (deliberately not shared with tools/build-cards.js)
 * -------------------------------------------------------------------------------------------- */

/** @param {string} name card name → wiki dump text */
async function wikiText(name) {
  const stem = name.replace(/\s+/g, '_').replace(/'/g, '_').toLowerCase();
  const file = wikiFiles.find((f) => f.toLowerCase() === `${stem}.txt`);
  assert.ok(file, `no wiki page for ${name}`);
  return readFile(path.join(WIKI, file), 'utf8');
}

/** @param {string} txt → infobox fields (links and whitespace stripped) */
function parseInfobox(txt) {
  const m = txt.match(/\{\{Infobox cards([\s\S]*?)\}\}/);
  assert.ok(m, 'infobox missing');
  const out = {};
  for (const part of m[1].split('|')) {
    const mm = part.match(/^\s*(\w+)\s*=\s*([\s\S]*)$/);
    if (mm) out[mm[1]] = mm[2].replace(/\[\[|\]\]/g, '').replace(/\s+/g, ' ').trim();
  }
  return out;
}

/** @param {string} cell → {value, percent} or null */
function parseCell(cell) {
  const t = String(cell ?? '').replace(/'''|''/g, '').trim();
  const pm = t.match(/^(-?\d+(?:[.,]\d+)?)\s*%$/);
  if (pm) return { value: Number(pm[1].replace(',', '.')), percent: true };
  if (/^-?\d+(?:\.\d+)?$/.test(t)) return { value: Number(t), percent: false };
  return null;
}

/**
 * Stat checkpoints from either a {{… Table}} template or a hand-written article-table.
 * @param {string} txt
 * @returns {{base: Record<string, {value:number, percent:boolean}|null>, stages: Array<{level: number|null, attack, hp, ability}>}}
 */
function parseStatTable(txt) {
  const tpl = txt.match(/\{\{(?:Attack|Life|Ability)+\s*Table([\s\S]*?)\}\}/i);
  const base = { attack: null, hp: null, ability: null };
  const stages = STAGE_KEYS.map(() => ({ level: null, attack: null, hp: null, ability: null }));
  if (tpl) {
    const cells = {};
    for (const part of tpl[1].split('|')) {
      const mm = part.match(/^\s*([\w+-]+)\s*=\s*([^\n]*)/);
      if (mm) cells[mm[1]] = mm[2].trim();
    }
    for (const stat of STATS) base[stat] = parseCell(cells[`${WIKI_STAT_KEY[stat]}1`]);
    STAGE_KEYS.forEach((k, s) => {
      const lvl = parseCell(cells[`level${k}`]);
      stages[s].level = lvl ? lvl.value : null;
      for (const stat of STATS) stages[s][stat] = parseCell(cells[`${WIKI_STAT_KEY[stat]}${k}`]);
    });
    return { base, stages };
  }
  const html = txt.match(/\{\|[\s\S]*?\n\|\}/);
  assert.ok(html, 'no stats table');
  const headers = [...html[0].matchAll(/^!\s*(?:[^|\n]*\|)?\s*([A-Za-z]+)\s*$/gm)].map((m) => m[1].toLowerCase())
    .filter((h) => h !== 'level');
  const colStat = headers.map((h) => ({ attack: 'attack', life: 'hp', ability: 'ability' })[h]);
  for (const row of html[0].split(/\n\|-/)) {
    const lm = row.match(/\|\s*lvl\s*(\d+)\s*(?:\(\s*(\++)\s*\))?/i);
    if (!lm) continue;
    const level = Number(lm[1]);
    const stage = lm[2] ? lm[2].length : (level === 1 ? -1 : 0);
    // Value lines look like `| style="…" |'''600'''` or `|  |460`; the value is after the last pipe.
    const cells = row.split('\n').filter((l) => l.startsWith('|')).map((l) => l.slice(l.lastIndexOf('|') + 1).trim());
    cells.forEach((cell, i) => {
      const stat = colStat[i];
      if (!stat) return;
      if (stage === -1) base[stat] = parseCell(cell);
      else { stages[stage].level = level; stages[stage][stat] = parseCell(cell); }
    });
  }
  return { base, stages };
}

/** Attack directions from the infobox text, independently of the build's parser. */
function dirsFromText(text) {
  const t = String(text || '').toLowerCase();
  if (!t || /^(none|-|monster|undefined)$/.test(t.trim())) return [];
  const body = t.replace(/^\s*(?:\d+|one|two|three)\s+directions?\s*/, '');
  const out = new Set();
  for (const tok of body.split(/[,()/]|\band\b/).map((x) => x.trim()).filter(Boolean)) {
    if (/^left neigh/.test(tok)) out.add('ownLeft');
    else if (/^right neigh/.test(tok)) out.add('ownRight');
    else if (/^(direct|front|middle)$/.test(tok)) out.add('direct');
    else if (tok === 'left') out.add('left');
    else if (tok === 'right') out.add('right');
    else throw new Error(`unknown direction token "${tok}"`);
  }
  return ['left', 'direct', 'right', 'ownLeft', 'ownRight'].filter((d) => out.has(d));
}

/** Portal page → { cards, gemReward, quests: [{n, boss, hp, staminaPerFigure, goldPerFigure, stamina, figures}] } */
function parsePortalPage(txt) {
  const field = (name) => {
    const m = txt.match(new RegExp(`\\|\\s*${name}\\s*=\\s*([^|\\n]*)`));
    return m ? m[1].trim() : '';
  };
  const cards = [];
  for (let i = 1; i <= 8; i += 1) cards.push(slugify(field(`card${i}`).replace(/\[\[|\]\]/g, '')));
  const gm = txt.match(/earns a ([\d,]+) gem reward/);
  const nodes = [];
  for (let n = 1; n <= 25; n += 1) {
    const num = (s) => (/^\d+$/.test(s) ? Number(s) : null);
    nodes.push({
      n,
      boss: field(`Boss${n}`) ? slugify(field(`Boss${n}`)) : null,
      hp: num(field(`HP${n}`)),
      staminaPerFigure: num(field(`StaminaPerFigure${n}`)),
      goldPerFigure: num(field(`GoldPerFigure${n}`)),
      stamina: num(field(`Stamina${n}`)),
      figures: num(field(`Figures${n}`)),
      reward: field(`Reward${n}`),
    });
  }
  return { cards, gemReward: gm ? Number(gm[1].replace(/,/g, '')) : null, nodes };
}

/* ----------------------------------------------------------------------------------------------
 * Cards vs wiki pages
 * -------------------------------------------------------------------------------------------- */

describe('25 sample cards against their wiki pages', () => {
  for (const id of SAMPLE) {
    test(id, async () => {
      const card = db.get(id);
      assert.ok(card, `${id} missing from cards.json`);
      const txt = await wikiText(card.name);
      const box = parseInfobox(txt);
      const patch = overrides[id] || {};

      // Infobox: tribe, rarity, mana, portal/set, directions (overrides are the documented exceptions).
      assert.equal(box.race.toLowerCase(), card.tribe, 'tribe');
      const rarity = box.rarity.toLowerCase().replace('very common', 'common').replace('ï', 'i');
      if (patch.rarity === undefined) assert.equal(rarity, card.rarity, 'rarity');
      else assert.equal(card.rarity, patch.rarity, 'overridden rarity');
      if (patch.mana === undefined) assert.equal(Number(box.mana), card.mana, 'mana');
      else assert.equal(card.mana, patch.mana, 'overridden mana');
      if (patch.dirs === undefined) assert.deepEqual(card.dirs, dirsFromText(box.attack), `dirs from "${box.attack}"`);
      else assert.deepEqual(card.dirs, patch.dirs);
      const portal = (box.portal || '').trim();
      if (!portal) assert.equal(card.set, 'main', 'no portal → main set');
      else {
        const wanted = portal.split(/\s+and\s+/i).map((p) => slugify(p)).filter((id) => id !== 'casino-dungeon' && id !== 'dungeon-casino'); // the casino set was removed
        assert.deepEqual(card.sets || [card.set], wanted, 'portal → set');
      }
      assert.equal(card.caps.length, MAX_STAGE + 1);
      if (patch.caps) assert.deepEqual(card.caps, patch.caps);
      else assert.deepEqual(card.caps, RARITIES[card.rarity].caps, 'caps from rarity');
      assert.ok(Object.keys(card.art).length >= 1 && typeof card.art['0'] === 'string', 'art map');

      // Stat table: base values, growth checkpoints, levels, and statAt at every stage cap (±1).
      const { base, stages } = parseStatTable(txt);
      for (const stat of STATS) {
        const patched = patch.base && patch.base[stat] !== undefined;
        if (base[stat] && !patched) assert.equal(card.base[stat], base[stat].value, `base ${stat}`);
        if (patched) assert.equal(card.base[stat], patch.base[stat], `overridden base ${stat}`);
        if (base[stat] && base[stat].percent) assert.equal(card.abilityIsPercent, true, 'percent ability flagged');
      }
      stages.forEach((row, s) => {
        if (row.level != null && !patch.caps) {
          assert.ok(row.level === card.caps[s] || (card.rarity === 'uncommon' && s >= 3 && row.level === card.caps[s] + (s === 3 ? 1 : 2)),
            `stage ${s}: wiki table level ${row.level} vs cap ${card.caps[s]}`);
        }
        for (const stat of STATS) {
          const wiki = row[stat];
          const patchedGrowth = patch.growth && patch.growth[stat];
          if (!wiki) {
            if (!patchedGrowth) assert.equal(card.growth[stat][s], null, `growth.${stat}[${s}] should be unknown`);
            continue;
          }
          if (patchedGrowth) assert.equal(card.growth[stat][s], patchedGrowth[s], `overridden growth.${stat}[${s}]`);
          else assert.equal(card.growth[stat][s], wiki.value, `growth.${stat}[${s}]`);
          if (card.base[stat] == null) return;
          const expected = card.growth[stat][s];
          if (expected == null) return;
          const got = statAt(card, stat, s, capFor(card, s));
          const tol = card.abilityIsPercent && stat === 'ability' ? 0.1 : 1;
          assert.ok(Math.abs(got - expected) <= tol, `statAt(${stat}, stage ${s}, L${capFor(card, s)}) = ${got}, wiki ${expected}`);
        }
      });
      // Level 1 of stage 0 is the base; level 1 of later stages is base × 1.15^s for growing point stats.
      for (const stat of STATS) {
        if (card.base[stat] == null) continue;
        assert.equal(statAt(card, stat, 0, 1), card.base[stat], `${stat} at stage 0 level 1`);
        if (isFlatStat(card, stat) || card.abilityIsPercent && stat === 'ability' || card.base[stat] === 0) continue;
        for (let s = 1; s <= MAX_STAGE; s += 1) {
          assert.equal(statAt(card, stat, s, 1), Math.round(card.base[stat] * 1.15 ** s), `${stat} at stage ${s} level 1`);
        }
      }
    });
  }

  test('Dwarf King gives his wiki checkpoints at every cap and 1600 → +800 per neighbour text value', () => {
    const king = db.get('dwarf-king');
    assert.deepEqual(king.base, { attack: 800, hp: 2400, ability: 1600 });
    assert.deepEqual([0, 1, 2, 3, 4].map((s) => attackAt(king, s, capFor(king, s))), [1046, 1478, 2062, 2835, 3849]);
    assert.deepEqual([0, 1, 2, 3, 4].map((s) => hpAt(king, s, capFor(king, s))), [3139, 4437, 6188, 8511, 11560]);
    assert.deepEqual([0, 1, 2, 3, 4].map((s) => abilityAt(king, s, capFor(king, s))), [2091, 2956, 4124, 5674, 7709]);
  });

  test('Werewolf Dwarf: 1600 → 1840 at + level 1, 7451 / 11932 at ++++ cap', () => {
    const ww = db.get('werewolf-dwarf');
    assert.equal(ww.mana, 22);
    assert.equal(ww.set, 'dwarven-rage');
    assert.equal(attackAt(ww, 1, 1), 1840);
    assert.equal(attackAt(ww, 4, 54), 7451);
    assert.equal(hpAt(ww, 4, 54), 11932);
  });

  test('flat stats: Scrapmaster and Thief of Time attack for 1 at every level and stage; Bone Dragon per stage', () => {
    for (const id of ['scrapmaster', 'thief-of-time']) {
      const c = db.get(id);
      assert.deepEqual(c.dirs, ['direct'], id);
      for (let s = 0; s <= MAX_STAGE; s += 1) {
        for (let l = 1; l <= capFor(c, s); l += 1) assert.equal(attackAt(c, s, l, 0.75), 1, `${id} stage ${s} level ${l}`);
      }
    }
    assert.equal(abilityAt(db.get('scrapmaster'), 4, 36), 3541);
    assert.equal(abilityAt(db.get('thief-of-time'), 4, 63), 5109);
    const bone = db.get('bone-dragon');
    assert.deepEqual([0, 1, 2, 3, 4].map((s) => attackAt(bone, s, 1)), [100, 200, 300, 400, 500]);
    assert.deepEqual([0, 1, 2, 3, 4].map((s) => attackAt(bone, s, capFor(bone, s))), [100, 200, 300, 400, 500]);
    assert.equal(abilityAt(bone, 0, 15), 3464);
    assert.equal(abilityAt(db.get('blood-spitter'), 3, 23), 100);
  });

  test('percent abilities restart at the base percentage each stage and hit the wiki caps', () => {
    const djinn = db.get('djinn');
    const medusa = db.get('medusa');
    for (const c of [djinn, medusa]) {
      assert.deepEqual([0, 1, 2, 3, 4].map((s) => abilityAt(c, s, 1)), [6, 6, 6, 6, 6], c.id);
      assert.deepEqual([0, 1, 2, 3, 4].map((s) => abilityAt(c, s, capFor(c, s))), [18, 26, 34, 42, 50], c.id);
    }
    assert.equal(abilityAt(db.get('dark-mage'), 4, 63), 20);
  });

  test('trainer cards: Lich King / Crystal Ghost / Blood Dragon cost 1 mana, never attack, fixed sacrifice XP', () => {
    for (const [id, xp] of Object.entries(TRAINER_XP)) {
      const c = db.get(id);
      assert.equal(c.trainer, true, id);
      assert.equal(c.mana, 1, id);
      assert.deepEqual(c.dirs, [], id);
      assert.equal(c.set, 'unique-events', id);
      assert.ok(xp >= 4000, id);
    }
    assert.deepEqual(Object.keys(TRAINER_XP).sort(), ['blood-dragon', 'crystal-ghost', 'lich-king']);
    assert.equal(hpAt(db.get('lich-king'), 0, 13), 651);
  });
});

describe('whole catalog against every wiki page', () => {
  test('infobox mana / tribe / rarity / portal agree for all 200 cards except the documented overrides', async () => {
    const problems = [];
    for (const card of db.all()) {
      const box = parseInfobox(await wikiText(card.name));
      const patch = overrides[card.id] || {};
      if (box.race && box.race.toLowerCase() !== card.tribe) problems.push(`${card.id}: tribe ${box.race}`);
      const rarity = (box.rarity || '').toLowerCase().replace('very common', 'common').replace('ï', 'i');
      if (rarity && rarity !== card.rarity && patch.rarity === undefined) problems.push(`${card.id}: rarity ${box.rarity}`);
      const mana = Number(box.mana);
      if (Number.isFinite(mana) && mana > 0 && mana !== card.mana && patch.mana === undefined) problems.push(`${card.id}: mana ${box.mana}`);
      if (patch.dirs === undefined) {
        let dirs;
        try { dirs = dirsFromText(box.attack); } catch (err) { problems.push(`${card.id}: ${err.message}`); continue; }
        if (JSON.stringify(dirs) !== JSON.stringify(card.dirs)) problems.push(`${card.id}: dirs "${box.attack}" vs ${JSON.stringify(card.dirs)}`);
      }
    }
    assert.deepEqual(problems, []);
  });

  test('every wiki stat checkpoint is reproduced by statAt within ±1 (percent: ±0.1)', async () => {
    let checked = 0;
    const misses = [];
    for (const card of db.all()) {
      let table;
      try { table = parseStatTable(await wikiText(card.name)); } catch { continue; }
      const patch = overrides[card.id] || {};
      table.stages.forEach((row, s) => {
        for (const stat of STATS) {
          const wiki = row[stat];
          if (!wiki || card.base[stat] == null) continue;
          if (patch.growth && patch.growth[stat]) continue; // documented wiki typos
          if (row.level != null && row.level !== capFor(card, s)) continue; // value measured at another level
          const got = statAt(card, stat, s, capFor(card, s));
          const tol = card.abilityIsPercent && stat === 'ability' ? 0.1 : 1;
          checked += 1;
          if (Math.abs(got - wiki.value) > tol) misses.push(`${card.id} ${stat} stage ${s}: ${got} vs ${wiki.value}`);
        }
      });
    }
    assert.ok(checked > 1300, `only ${checked} checkpoints compared`);
    assert.deepEqual(misses, []);
  });

  test('the derived curve lands on partial wiki rows measured below the cap (Tamer L7: 855 / 428)', () => {
    const tamer = db.get('tamer');
    assert.ok(Math.abs(attackAt(tamer, 0, 7) - 855) <= 2);
    assert.ok(Math.abs(hpAt(tamer, 0, 7) - 428) <= 2);
  });

  test('every override still has a reason and only the known fields', () => {
    const allowed = new Set(['reason', 'mana', 'rarity', 'tribe', 'dirs', 'caps', 'base', 'growth', 'set', 'sets',
      'sourceText', 'evolving', 'trainer', 'abilityIsPercent', 'abilityFlat', 'flat', 'name']);
    for (const [id, patch] of Object.entries(overrides)) {
      if (id.startsWith('$')) continue;
      assert.ok(db.has(id), id);
      assert.ok(patch.reason.length > 20, id);
      for (const k of Object.keys(patch)) assert.ok(allowed.has(k), `${id}.${k}`);
      if (patch.flat) assert.ok(patch.flat.every((s) => STATS.includes(s)), `${id}.flat`);
    }
  });
});

/* ----------------------------------------------------------------------------------------------
 * quests.json vs cards.json and the portal / quest wiki pages
 * -------------------------------------------------------------------------------------------- */

describe('quests.json', () => {
  test('every card id in quests.json exists in cards.json', () => {
    const missing = [];
    const check = (id, where) => { if (id != null && !db.has(id)) missing.push(`${where}: ${id}`); };
    quests.main.cards.forEach((id) => check(id, 'main.cards'));
    quests.main.nodes.forEach((n) => check(n.boss, `main node ${n.n}`));
    for (const p of quests.portals) {
      p.cards.forEach((id) => check(id, `${p.id}.cards`));
      p.nodes.forEach((n) => check(n.boss, `${p.id} node ${n.n}`));
    }
    assert.deepEqual(missing, []);
    assert.equal(quests.main.nodes.length, MAIN_QUEST_COUNT);
    assert.deepEqual(quests.portals.map((p) => p.id), SETS.filter((s) => s.portal).map((s) => s.id), 'portals in rotation order');
    assert.equal(quests.portalRotationDays, 7, 'one portal open for 7 days (quests.portalSchedule)');
    for (const p of quests.portals) {
      assert.equal(p.nodes.length, PORTAL_QUEST_COUNT, p.id);
      assert.deepEqual(p.nodes.map((n) => n.n), p.nodes.map((_, i) => i + 1), `${p.id} node numbering`);
    }
    assert.deepEqual(quests.main.nodes.map((n) => n.n), quests.main.nodes.map((_, i) => i + 1));
  });

  test('portal set cards, gem rewards, bosses, boss hp, stamina and gold per figure match the wiki portal pages', async () => {
    const problems = [];
    for (const portal of quests.portals) {
      const page = parsePortalPage(await readFile(path.join(WIKI, portal.wiki.file), 'utf8'));
      if (JSON.stringify(page.cards) !== JSON.stringify(portal.cards)) problems.push(`${portal.id} cards ${page.cards} vs ${portal.cards}`);
      if (page.gemReward !== portal.gemReward) problems.push(`${portal.id} gem reward ${page.gemReward} vs ${portal.gemReward}`);
      const set = SETS.find((s) => s.id === portal.id);
      if (!set || set.setReward !== page.gemReward) problems.push(`${portal.id} constants setReward ${set && set.setReward}`);
      if (set && set.setSize !== portal.cards.length) problems.push(`${portal.id} setSize ${set.setSize} vs ${portal.cards.length}`);
      for (const w of page.nodes) {
        const node = portal.nodes[w.n - 1];
        if (w.boss && w.boss !== node.boss) problems.push(`${portal.id} node ${w.n} boss ${w.boss} vs ${node.boss}`);
        // Dawn of Eternity's first two rows are stale (hp 1300 / 1260 far below the curve, 8 stamina per
        // figure at node 2 but 7 at node 3): quests.json interpolates them.
        const stale = portal.id === 'dawn-of-eternity' && w.n <= 2;
        if (!stale && w.hp != null && w.hp !== node.bossHp) problems.push(`${portal.id} node ${w.n} hp ${w.hp} vs ${node.bossHp}`);
        if (!stale && w.staminaPerFigure != null && w.staminaPerFigure !== node.staminaPerTap) problems.push(`${portal.id} node ${w.n} stamina/figure ${w.staminaPerFigure} vs ${node.staminaPerTap}`);
        if (w.goldPerFigure != null && w.goldPerFigure !== node.goldPerFigure) problems.push(`${portal.id} node ${w.n} gold/figure ${w.goldPerFigure} vs ${node.goldPerFigure}`);
        if (w.stamina != null && w.stamina !== node.wikiStamina) problems.push(`${portal.id} node ${w.n} stamina ${w.stamina} vs ${node.wikiStamina}`);
        if (w.figures != null && w.figures !== node.figures) problems.push(`${portal.id} node ${w.n} figures ${w.figures} vs ${node.figures}`);
        if (/high token on 1st/i.test(w.reward) && !node.highTokenFirstWin) problems.push(`${portal.id} node ${w.n} should give a high token on the first win`);
      }
    }
    assert.deepEqual(problems, []);
    // Every portal card really belongs to that set in cards.json.
    for (const portal of quests.portals) {
      for (const id of portal.cards) assert.ok(db.bySet(portal.id).some((c) => c.id === id), `${id} is not in set ${portal.id}`);
    }
  });

  test('main quest bosses 33–100 (with fusion stage) match the wiki PvE table; Q1 is the tutorial boss', async () => {
    const txt = await readFile(path.join(WIKI, 'Quests__PvE_.txt'), 'utf8');
    const alias = {
      sucubus: 'succubus', orge: 'ogre', 'assultant-drummer': 'assault-drummer', lizard: 'giant-lizard',
      'moon-propethess': 'moon-prophetess', 'anril-guard': 'anvil-guard', gunnner: 'gunner',
    };
    const rows = txt.split(/\n\|-\s*\n/).map((r) => r.split('\n').filter((l) => l.startsWith('|')).map((l) => l.slice(1).trim()));
    const wiki = new Map();
    for (const r of rows) if (/^\d+$/.test(r[0])) wiki.set(Number(r[0]), r);
    assert.equal(wiki.size, MAIN_QUEST_COUNT);
    const problems = [];
    for (const node of quests.main.nodes) {
      const row = wiki.get(node.n);
      const m = (row[1] || '').replace(/\[\[|\]\]/g, '').trim().match(/^([^+]*?)\s*(\++)?$/);
      const name = m ? m[1].trim() : '';
      if (!name) continue;
      // Quests 1–5 carry the tutorial bosses seen in the 1.7.x videos (tutorial.md §1.4–1.10), not the wiki's.
      if (node.bossName) continue;
      const boss = alias[slugify(name)] || slugify(name);
      const stage = m[2] ? m[2].length : 0;
      if (boss !== node.boss) problems.push(`Q${node.n}: ${boss} vs ${node.boss}`);
      if (stage !== node.bossStage) problems.push(`Q${node.n}: stage ${stage} vs ${node.bossStage}`);
      const stamina = Number((row[2] || '').split('/')[0]);
      if (stamina && stamina !== node.wikiStamina) problems.push(`Q${node.n}: stamina ${stamina} vs ${node.wikiStamina}`);
    }
    assert.deepEqual(problems, []);
    // Quest 1 per the tutorial videos (tutorial.md §1.4, §4): Worm Shaman (250 HP, 300 with the tribe bonus)
    // with 2 Throat-Cutters, 5 minions at 2 stamina and 6 gold, +10 at the end, the Throat-Cutter soul card.
    const q1 = quests.main.nodes[0];
    assert.deepEqual([q1.boss, q1.bossCardIds, q1.bossName, q1.bossHp, q1.rewardCard], ['throat-cutter', ['throat-cutter'], 'Worm Shaman', 250, 'throat-cutter']);
    assert.deepEqual([q1.staminaPerTap, q1.figures, q1.goldPerFigure, q1.endGold], [2, 5, 6, 10]);
    assert.equal(quests.main.cards.length, SETS.find((s) => s.id === 'main').setSize);
    assert.equal(quests.main.gemReward, SETS.find((s) => s.id === 'main').setReward);
  });

  test('main quest nodes follow the game-design bands, gold, hp, token and piece rules', () => {
    for (const node of quests.main.nodes) {
      const band = QUEST_BANDS.find((b) => b.scope === 'main' && node.n >= b.from && node.n <= b.to);
      assert.deepEqual(node.band.rarities, band.rarities, `Q${node.n} band`);
      assert.deepEqual(node.band.levels, band.levels, `Q${node.n} levels`);
      const tapRow = (rows) => rows.find(([a, z]) => node.n >= a && node.n <= z)[2];
      assert.equal(node.goldPerFigure, tapRow(QUEST_GOLD_PER_TAP), `Q${node.n} gold per tap`);
      assert.equal(node.staminaPerTap, tapRow(QUEST_STAMINA_PER_TAP), `Q${node.n} stamina per tap`);
      if (!node.bossName) assert.equal(node.bossHp, BOSS_HP.main.base + BOSS_HP.main.perQuest * node.n, `Q${node.n} hp`);
      const tier = QUEST_TOKEN_TIERS.find((t) => node.n >= t.from && node.n <= t.to);
      assert.equal(node.token, tier.token, `Q${node.n} token`);
      const piece = node.n >= PIECE_DROP_FROM_QUEST.legendary ? 'legendary' : node.n >= PIECE_DROP_FROM_QUEST.heroic ? 'heroic' : null;
      assert.equal(node.pieceRarity, piece, `Q${node.n} piece`);
      assert.ok(node.staminaPerTap >= 2 && node.staminaPerTap <= 7, `Q${node.n} stamina/tap`);
      assert.ok(node.figures >= 4, `Q${node.n} figures`);
      assert.equal(node.stamina, node.figures * node.staminaPerTap, `Q${node.n} stamina`);
      if (node.boss) {
        const def = db.get(node.boss);
        assert.ok(!def.trainer, `Q${node.n} boss ${node.boss} is a trainer card`);
        assert.ok(node.bossStage >= 0 && node.bossStage <= MAX_STAGE, `Q${node.n} boss stage`);
        assert.ok(node.band.levels[1] <= capFor(def, node.bossStage) + 10, `Q${node.n} boss level band vs cap`);
      }
    }
    for (const portal of quests.portals) {
      for (const node of portal.nodes) {
        const band = QUEST_BANDS.find((b) => b.scope === 'portal' && node.n >= b.from && node.n <= b.to);
        assert.deepEqual(node.band.rarities, band.rarities, `${portal.id} ${node.n}`);
        // The wiki reward columns give Low tokens on the early nodes and High ones later (the switch
        // varies per portal: node 9 or 10, with a stray Low at Divine Peace 13).
        assert.ok(['low', 'high'].includes(node.token), `${portal.id} ${node.n} token`);
        if (node.n <= 8) assert.equal(node.token, 'low', `${portal.id} ${node.n} token`);
        if (node.n >= 14) assert.equal(node.token, 'high', `${portal.id} ${node.n} token`);
        assert.ok(node.n < PORTAL_PIECE_FROM_NODE || node.pieceRarity, `${portal.id} ${node.n} piece`);
        assert.equal(node.highTokenFirstWin, node.n === PORTAL_QUEST_COUNT, `${portal.id} ${node.n} first-win token`);
      }
      // tokens.low carries no gem price: the small portal pack costs boosterPrice('portalLow') = 250 gems per pick (below)
      assert.equal(portal.tokens.high.gems, boosterPrice('portalHigh'), portal.id);
    }
    assert.equal(boosterPrice('portalLow'), 250, 'small portal pack, gems per pick (Dark Beyond video)');
    assert.equal(boosterPrice('portalHigh'), 1000, 'big portal pack, gems per pick');
  });
});

/* ----------------------------------------------------------------------------------------------
 * constants.js vs game-design.md / the wiki economy pages
 * -------------------------------------------------------------------------------------------- */

describe('constants against game-design.md', () => {
  test('daily rewards are the 21-day wiki table', async () => {
    const txt = await readFile(path.join(WIKI, 'Daily_rewards.txt'), 'utf8');
    const rows = [...txt.matchAll(/\|\s*(\d+)\s*\n\|\s*([^\n]+)/g)].map((m) => [Number(m[1]), m[2].trim()]);
    assert.equal(rows.length, 21);
    assert.deepEqual(dailyRewardFor(22), dailyRewardFor(1), '21-day cycle');
    for (const [day, text] of rows) {
      const r = dailyRewardFor(day);
      const expected = {};
      let m;
      if ((m = text.match(/\{\{gems\|(\d+)\}\}/))) expected.gems = Number(m[1]);
      else if ((m = text.match(/^(\d+) \[\[main quest\|(\w+) tokens\]\]/))) expected.tokens = { [m[2].toLowerCase()]: Number(m[1]) };
      else if ((m = text.match(/^(\d+) mana and (\d+) stamina potions?/))) { expected.manaPotions = Number(m[1]); expected.staminaPotions = Number(m[2]); }
      else if ((m = text.match(/^(\d+) stamina potions/))) expected.staminaPotions = Number(m[1]);
      else assert.fail(`unparsed daily reward "${text}"`);
      assert.deepEqual({ gems: r.gems, tokens: r.tokens ? { [r.tokens]: r.count } : undefined, manaPotions: r.mana, staminaPotions: r.stamina }, {
        gems: expected.gems, tokens: expected.tokens, manaPotions: expected.manaPotions, staminaPotions: expected.staminaPotions,
      }, `day ${day}: ${text}`);
    }
  });

  test('boosters: gem price per pick and rarity make-up of the nine cards (1.7.4 client, game-design §7)', () => {
    const prices = Object.fromEntries(Object.keys(BOOSTER_PACKS).map((id) => [id, boosterPrice(id)]));
    assert.deepEqual(prices, { neophyte: 50, summoner: 350, archmage: 975, portalLow: 250, portalHigh: 1000 });
    assert.equal(boosterPrice('neophyte', 'get-the-best-cards'), 25, 'Get the Best Cards: −50 %');
    for (const b of Object.values(BOOSTER_PACKS)) {
      const cards = Object.values(b.slots).reduce((a, v) => a + v, 0);
      assert.equal(cards, BOOSTER_GRID_CARDS, `${b.id} has ${cards} cards`);
      for (const r of Object.keys(b.slots)) assert.ok(RARITIES[r], `${b.id} slot rarity ${r}`);
    }
    assert.equal(POTION_PRICE_GEMS, 40);
    assert.equal(POTION_PRICE_GEMS_EVENT, 20);
    assert.deepEqual({ potions: POTION_DEAL_COUNT, gems: POTION_DEAL_GEMS }, { potions: 3, gems: 60 });
  });

  test('fusion costs, level caps, sell and sacrifice coefficients per rarity (brief §3.1 / §5.4)', () => {
    const expected = {
      common: { caps: [9, 10, 11, 12, 13], fusion: [200, 800, 1800, 3200], sell: [5, 9, 1], sac: 0.6, mana: [1, 2] },
      standard: { caps: [10, 12, 14, 16, 18], fusion: [400, 1600, 3600, 6400], sell: [6.5, 10, 2], sac: 0.8, mana: [3, 5] },
      uncommon: { caps: [11, 15, 19, 23, 27], fusion: [900, 3600, 8100, 14400], sell: [8.5, 11, 4], sac: 1, mana: [6, 10] },
      rare: { caps: [12, 18, 24, 30, 36], fusion: [1920, 7680, 17280, 30720], sell: [20, 12, 6], sac: 1.6, mana: [11, 15] },
      heroic: { caps: [13, 21, 29, 37, 45], fusion: [3750, 15000, 33750, 60000], sell: [30, 13, 8], sac: 2.4, mana: [16, 20] },
      legendary: { caps: [14, 24, 34, 44, 54], fusion: [7200, 28800, 64800, 115200], sell: [50, 14, 10], sac: 3.5, mana: [21, 25] },
      ultimate: { caps: [15, 27, 39, 51, 63], fusion: [10780, 43120, 97020, 172480], sell: [55, 15, 12], sac: 5, mana: [30, 30] },
    };
    assert.deepEqual(RARITY_ORDER, Object.keys(expected));
    for (const [id, e] of Object.entries(expected)) {
      const r = RARITIES[id];
      assert.deepEqual(r.caps, e.caps, `${id} caps`);
      assert.deepEqual(r.fusionCosts, e.fusion, `${id} fusion`);
      assert.deepEqual([r.sell.k, r.sell.base, r.sell.perFusion], e.sell, `${id} sell`);
      assert.equal(r.sacrificeFactor, e.sac, `${id} sacrifice`);
      assert.deepEqual(r.manaRange, e.mana, `${id} mana`);
      assert.equal(r.growth.length, 5, `${id} growth table`);
      for (let s = 1; s < 5; s += 1) assert.ok(r.growth[s] > r.growth[s - 1], `${id} growth ascending`);
    }
    // Fusion costs scale 1 : 4 : 9 : 16 for every rarity above Common (brief §5.4 table).
    for (const id of RARITY_ORDER.slice(1)) {
      const [a, b, c, d] = RARITIES[id].fusionCosts;
      assert.deepEqual([b / a, c / a, d / a], [4, 9, 16], id);
    }
  });

  test('card-piece gem prices match the wiki Gems page; pieces per rarity', async () => {
    const txt = await readFile(path.join(WIKI, 'Gems.txt'), 'utf8');
    const section = txt.slice(txt.indexOf('== Completing a cardpiece =='), txt.indexOf('== Buying potions =='));
    for (const rarity of ['uncommon', 'rare', 'heroic', 'legendary']) {
      const row = section.match(new RegExp(`\\[\\[${rarity[0].toUpperCase() + rarity.slice(1)}\\]\\]([\\s\\S]*?)(?:\\|-|\\|\\})`));
      assert.ok(row, rarity);
      const prices = [...row[1].matchAll(/\{\{gems\|(\d+)\}\}/g)].map((m) => Number(m[1]));
      assert.deepEqual(PIECE_PRICES[rarity], prices, rarity);
      assert.equal(prices.length, RARITIES[rarity].pieces - 1, `${rarity}: pieces = max missing + 1`);
    }
    assert.equal(PIECE_PRICES.ultimate.length, RARITIES.ultimate.pieces - 1);
    assert.equal(FIRST_PIECE_GEMS, 100);
    assert.equal(FIRST_PIECE_GEMS_EVENT, 50);
    assert.equal(PIECE_HUNT_SLOTS, 8);
    const buying = txt.slice(txt.indexOf('== Buying a cardpiece =='), txt.indexOf('== Completing a cardpiece =='));
    assert.match(buying, /\{\{gems\|100\}\}/, 'first piece of an empty slot costs 100 gems');
    assert.match(buying, /\{\{gems\|50\}\}/, '50 gems during the card-piece event');
  });

  test('league tiers and prizes (game-design §6, round 3 D3)', () => {
    assert.equal(LEAGUE.durationHours, 24);
    assert.equal(LEAGUE.players, 50);
    assert.equal(LEAGUE.pointsPerWin, 150);
    assert.equal(LEAGUE.pointsPerWinDouble, 300);
    assert.equal(LEAGUE.maxFightsPerOpponent, 3);
    assert.equal(LEAGUE.promote, 3);
    assert.equal(LEAGUE.tournamentPointsDiv, 10);
    assert.deepEqual(LEAGUE.tiers.map((t) => [t.id, t.strength]), [['bronze', 0.9], ['silver', 1.05], ['gold', 1.2]]);
    assert.deepEqual(Object.keys(LEAGUE.prizes), ['gold', 'silver', 'bronze']);
    for (const bands of Object.values(LEAGUE.prizes)) {
      assert.deepEqual(bands.map((b) => [b.from, b.to]), [[1, 1], [2, 2], [3, 3], [4, 4], [5, 9], [10, 19], [20, 29]], 'prizes to rank 29');
    }
    assert.deepEqual(LEAGUE.prizes.bronze[0], { from: 1, to: 1, card: 'rare', mana: 5 });
    assert.deepEqual(LEAGUE.prizes.gold[3], { from: 4, to: 4, gems: 700 });
  });

  test('character, arena, quest and set numbers (game-design §3–§7)', () => {
    // Fresh account: 200 gold, 0 gems (DECISIONS D1, tutorial.md §0 / §3 item 11); the original gave no potions,
    // 5 + 5 since 2026-10-12 on the user's request.
    assert.deepEqual(PLAYER_START, {
      level: 1, xp: 0, statPoints: 0, stamina: 50, mana: 50, hpMax: 1500, gold: 200, gems: 0, staminaPotions: 5, manaPotions: 5,
    });
    assert.equal(MAX_PLAYER_LEVEL, 200);
    assert.equal(STAT_POINTS_PER_LEVEL, 12);
    assert.equal(STAT_POINT_VALUE.hp, 30);
    assert.equal(LEVEL_UP_REWARDS.goldPerLevel, 50, 'level-up gold = 50 × level (L2 100 … L7 350)');
    assert.deepEqual(SLOT_UNLOCK_LEVELS, [5, 1, 1, 1, 3], 'legacy table, sizes pre-round-3 saves');
    assert.deepEqual(DECK_SLOTS.quests, { 3: 2, 4: 4, 5: 7 }, 'slots after the quest 2 / 4 / 7 bosses (tutorial-v2.md §2.12, §4.5, §6.10)');
    assert.deepEqual(DECK_SLOTS.order, [2, 1, 3, 4, 0]);
    // DECISIONS D1/D2: fusion 2, arena 4, training 5, league 6.
    assert.deepEqual(FEATURE_UNLOCK_LEVELS, { quests: 1, cards: 1, shop: 1, fusion: 2, arena: 4, pieces: 4, replays: 4, training: 5, league: 6 });
    assert.equal(COLLECTION_LIMIT, 100, '"Your cards n/100" (lategame.md §3)');
    assert.equal(TRIBE_BONUS_MULT, 1.2, 'tribe bonus: player hp × 1.2 (original client)');
    assert.equal(MAX_SACRIFICE_CARDS, 9);
    assert.equal(ARENA.goldPerEnemyMana, 6);
    assert.equal(ARENA.winGoldMult, 2);
    assert.equal(ARENA.tournamentPointsPerWin, 10);
    assert.equal(ARENA.offerRotationMinutes, 30);
    assert.deepEqual(ARENA.difficulties.map((d) => [d.id, d.levelOffset, d.power]), [
      ['easy', [-2, 0], 0.7], ['normal', [-1, 1], 1.0], ['hard', [1, 3], 1.3],
    ]);
    assert.equal(ARENA.replaysKept, 10);
    assert.deepEqual(WAVE_REWARDS, { card: 0.2, nothing: 0.8 }, 'gold is paid per tap now (DECISIONS D2)');
    assert.deepEqual(BOSS_REWARDS, { gold: 0.45, token: 0.25, piece: 0.15, potion: 0.1, gems: 0.05 });
    assert.deepEqual(BOSS_GEMS_RANGE, [13, 82]);
    assert.deepEqual(QUEST_GOLD, { bossMult: 3 });
    assert.deepEqual(BOSS_HP.main, { base: 1500, perQuest: 90 });
    assert.equal(BOSS_HP.portal.base, 3965);
    assert.equal(BOSS_HP.portal.perNode, 260);
    // Envoy in the deck, Master Brewer in the collection (DECISIONS D1, tutorial.md §3 item 2).
    assert.deepEqual(STARTER_CARDS, ['envoy', 'master-brewer']);
    assert.deepEqual(STARTER_DECK_SLOTS, [2]);
    for (const id of STARTER_CARDS) assert.ok(['common', 'standard'].includes(db.get(id).rarity), id);
    assert.deepEqual(EVENTS.map((e) => e.id), [
      'infinite-wisdom', 'drinking-contest', 'card-piece-day', 'double-league-points', 'great-potion-deal', 'get-the-best-cards', 'golden-day',
    ]);
    const main = SETS.find((s) => s.id === 'main');
    assert.deepEqual([main.setReward, main.setSize], [31700, 17]);
    for (const s of SETS.filter((x) => x.portal)) {
      assert.ok(s.setReward >= 4000 && s.setReward <= 5600, `${s.id} reward ${s.setReward}`);
      assert.equal(s.setSize, db.bySet(s.id).filter((c) => quests.portals.find((p) => p.id === s.id).cards.includes(c.id)).length, `${s.id} size`);
    }
  });
});
