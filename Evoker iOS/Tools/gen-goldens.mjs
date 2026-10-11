#!/usr/bin/env node
// Records golden fixtures from the web implementation for EvokerCoreTests (never edit the outputs by hand).
//   node Tools/gen-goldens.mjs            # writes EvokerCore/Tests/EvokerCoreTests/Golden/*.json
//
// Sections (each is a separate file):
//   rng.json              mulberry32 sequences for a few seeds
//   seeds.json            mixSeed / seedFromNow / daily-event hash samples
//   stats.json            every card × stage × 3 levels, xp / sell / sacrifice / enhance tables
//   battles-original.json the original client's simulator unit tests through the web engine (full event logs)
//   battles-cards.json    one fight per catalog card: the card in the middle slot vs a fixed row (like the Card Lab)
//   battles-random.json   40 seeded random real-card fights
//   game-*.json           sequences of game functions (added by the game-logic port; see appendGameGoldens)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..', '..', 'Evoker Web');
const out = join(here, '..', 'EvokerCore', 'Tests', 'EvokerCoreTests', 'Golden');
mkdirSync(out, { recursive: true });

const mod = (p) => import(pathToFileURL(join(web, p)).href);
const { mulberry32 } = await mod('src/core/rng.js');
const { mixSeed } = await mod('src/game/state.js');
const { seedFromNow } = await mod('src/ui/store.js');
const { createCardsDb } = await mod('src/core/cards-db.js');
const stats = await mod('src/core/stats.js');
const { simulateBattle } = await mod('src/engine/battle.js');
const { buildSide } = await mod('src/engine/battle-state.js');
const { RARITY_ORDER, RARITIES } = await mod('src/core/constants.js');
const { statsAdapter, sideOptions } = await mod('src/game/opponents.js');

const db = createCardsDb(JSON.parse(readFileSync(join(web, 'data', 'cards.json'), 'utf8')));
const quests = JSON.parse(readFileSync(join(web, 'data', 'quests.json'), 'utf8'));
const names = JSON.parse(readFileSync(join(web, 'data', 'names.json'), 'utf8'));
const deps = { db, stats, engine: { simulateBattle, buildSide }, rng: mulberry32, quests, names };

const write = (name, data) => {
  const text = JSON.stringify(data, null, 1);
  writeFileSync(join(out, name), text + '\n');
  console.log(`${name}: ${(text.length / 1024).toFixed(0)} KB`);
};

/* ------------------------------------------------------------ rng / seeds */
{
  const cases = [1, 42, 123456789, 2147483648, 4294967295, 0].map((seed) => {
    const a = mulberry32(seed), b = mulberry32(seed), c = mulberry32(seed);
    return {
      seed: seed >>> 0,
      next: Array.from({ length: 24 }, () => a.next()),
      ints: Array.from({ length: 24 }, () => b.int(100)),
      chance: Array.from({ length: 24 }, () => c.chance(0.3)),
    };
  });
  write('rng.json', cases);
  const dayMs = 86400000;
  write('seeds.json', {
    mixSeed: [[1, 1], [1, 2], [123, 7], [4294967295, 3], [2147483648, 1000], [99, 0]].map(([s, step]) => [s >>> 0, step, mixSeed(s, step)]),
    seedFromNow: [0, 1, 1759881600000, 1791417600123, 4102444800000].map((n) => [n, seedFromNow(n)]),
    dailyEventIndex: [0, 1, 20000, 20733, 20734, 20740, 21000].map((day) => {
      let h = Math.imul(day ^ 0x5bd1e995, 0x9e3779b1) >>> 0;
      h = (h ^ (h >>> 15)) >>> 0;
      return [day, h % 7];
    }),
    dayMs,
  });
}

/* ------------------------------------------------------------------ stats */
{
  const cards = db.all().map((def) => {
    const stages = [], sell = [], sacrifice = [], cardXp = [];
    let enhance = [];
    for (let stage = 0; stage <= 4; stage++) {
      const cap = stats.capFor(def, stage);
      const levels = [1, Math.max(1, Math.round(cap / 2)), cap];
      stages.push(levels.map((level) => ({
        level,
        attack: stats.statAt(def, 'attack', stage, level),
        hp: stats.statAt(def, 'hp', stage, level),
        ability: stats.statAt(def, 'ability', stage, level),
      })));
      sell.push(levels.map((level) => stats.sellValue(def, stage, level)));
      sacrifice.push(levels.map((level) => stats.sacrificeXp(def, stage, level)));
      cardXp.push(levels.map((level) => stats.cardXpToNext(def, level, stage)));
      if (stage === 0) enhance = levels.map((level) => stats.enhancePrice(def, level));
    }
    return { id: def.id, caps: [0, 1, 2, 3, 4].map((s) => stats.capFor(def, s)), stages, sell, sacrifice, enhance, cardXp };
  });
  const playerXp = Array.from({ length: 205 }, (_, i) => { const v = stats.playerXpToNext(i + 1); return Number.isFinite(v) ? v : null; });
  const fusionCosts = Object.fromEntries(RARITY_ORDER.map((r) => [r, [0, 1, 2, 3].map((s) => stats.fusionCost(r, s))]));
  write('stats.json', { cards, playerXp, fusionCosts, rarityCaps: Object.fromEntries(RARITY_ORDER.map((r) => [r, RARITIES[r].caps])) });
}

/* ---------------------------------------------------------------- battles */
/** Projection of the event log the Swift tests apply too (GoldenSupport.swift EventProjection). */
function projectCard(c) {
  if (!c) return null;
  const o = {};
  for (const k of ['cardId', 'name', 'tribe', 'attack', 'hp', 'maxHp']) if (c[k] !== undefined && c[k] !== null) o[k] = c[k];
  return o;
}
function projectEvents(events) {
  return events.map((ev) => {
    if (ev.t === 'battleStart') {
      const side = (s) => ({
        player: Object.fromEntries(Object.entries(s.player).filter(([k, v]) => ['name', 'hp', 'maxHp', 'baseMaxHp', 'tribeBonus'].includes(k) && v !== undefined && v !== null)),
        cards: s.cards.map(projectCard),
      });
      return { ...ev, attacker: side(ev.attacker), defender: side(ev.defender) };
    }
    if (ev.t === 'death') return { ...ev, card: projectCard(ev.card) };
    return ev;
  });
}
/** A built side as the Swift decoder sees it (drop the ability object, keep numbers). */
function cleanSide(side) {
  return {
    player: side.player,
    cards: side.cards.map((c) => (c ? { ...c, buffs: c.buffs } : null)),
  };
}
function record(name, cfg, inputs) {
  const { events, result } = simulateBattle(cfg);
  return {
    name, seed: cfg.seed >>> 0, attacker: cleanSide(cfg.attacker), defender: cleanSide(cfg.defender), options: cfg.options || null,
    attackerInput: inputs ? inputs.attacker : null, defenderInput: inputs ? inputs.defender : null,
    expected: { result, events: projectEvents(events) },
  };
}

// (a) the original client's unit tests, as tests/battle.test.js replays them: player 2's cards reversed for the
// simulator (the fixture lists them in facing order = our defender slots), explicit buffs, raw hp values.
{
  const original = JSON.parse(readFileSync(join(web, 'tests', 'fixtures', 'original-tests.json'), 'utf8'));
  const rawSide = (p) => ({
    player: { name: 'p', hp: p.hp, maxHp: p.hp },
    cards: p.cards.map((c, i) => (c ? { instanceId: `o${i}`, cardId: c.name || `card${i}`, name: c.name || `card${i}`, tribe: c.race || 'neutral', attack: c.attack, hp: c.hp, maxHp: c.hp, abilityValue: 0, dirs: [], buffs: c.buffs } : null)),
  });
  const cases = original.map((t, i) => record(t.name || `original-${i}`, { attacker: rawSide(t.p1), defender: rawSide(t.p2), seed: 1000 + i, options: { raceBonus: false } }));
  write('battles-original.json', cases);
}

// (b) one fight per card: the card in the middle slot with two plain allies against five plain attackers, like
// the Card Lab's default scenario; the opposing row alternates weak / strong so deaths, reflects and revives show.
{
  const plainAlly = db.get('pikeman') || db.all()[0];
  const weak = ['throat-cutter', 'pouch-tearer', 'lurking-goblin', 'bone-breaker', 'flinger'].map((id) => db.get(id)).filter(Boolean);
  const strong = ['dwarf-king', 'ogre', 'giant', 'phoenix', 'griffin'].map((id) => db.get(id)).filter(Boolean);
  const opts = sideOptions(deps);
  const cases = [];
  db.all().forEach((def, i) => {
    const stage = i % 5;
    const level = Math.max(1, Math.min(stats.capFor(def, stage), 1 + (i * 7) % 20));
    const row = i % 2 ? strong : weak;
    const attackerInput = {
      player: { name: 'You', hp: 1500, maxHp: 1500, avatar: 0 },
      cards: [null, { uid: 'a1', cardId: plainAlly.id, stage: 0, level: 3, evolveQuality: 1 }, { uid: 'a2', cardId: def.id, stage, level, evolveQuality: 1 }, { uid: 'a3', cardId: plainAlly.id, stage: 0, level: 3, evolveQuality: 1 }, null],
    };
    const defenderInput = {
      player: { name: 'Foe', hp: 2000 + 100 * (i % 7), maxHp: 2000 + 100 * (i % 7), avatar: 1 },
      cards: row.map((d, k) => ({ uid: `d${k}`, cardId: d.id, stage: 0, level: 2 + (k + i) % 4, evolveQuality: 1 })),
    };
    const attacker = buildSide(attackerInput.player, attackerInput.cards, opts);
    const defender = buildSide(defenderInput.player, defenderInput.cards, opts);
    cases.push(record(`card:${def.id}`, { attacker, defender, seed: 5000 + i }, { attacker: attackerInput, defender: defenderInput }));
  });
  write('battles-cards.json', cases);
}

// (c) random real line-ups
{
  const opts = sideOptions(deps);
  const all = db.all().filter((d) => !d.trainer);
  const cases = [];
  for (let n = 0; n < 40; n++) {
    const rng = mulberry32(777 + n);
    const side = (name, avatar) => {
      const cards = [0, 1, 2, 3, 4].map((k) => {
        if (rng.chance(0.15)) return null;
        const def = rng.pick(all);
        const stage = rng.int(5);
        const level = 1 + rng.int(stats.capFor(def, stage));
        return { uid: `${name}${k}`, cardId: def.id, stage, level, evolveQuality: 1 };
      });
      const hp = 1500 + 100 * rng.int(40);
      return { player: { name, hp, maxHp: hp, avatar }, cards };
    };
    const attackerInput = side('A', 0), defenderInput = side('B', 1);
    const attacker = buildSide(attackerInput.player, attackerInput.cards, opts);
    const defender = buildSide(defenderInput.player, defenderInput.cards, opts);
    cases.push(record(`random-${n}`, { attacker, defender, seed: 9000 + n }, { attacker: attackerInput, defender: defenderInput }));
  }
  write('battles-random.json', cases);
}

/* ------------------------------------------------------------------- game */
// The game-logic port appends its own sections here (game-*.json): sequences of game function calls recorded
// with the state after every step. Keep each sequence deterministic (fixed `now`, fixed seed, no Date.now()).
const gameGoldens = join(here, 'gen-goldens-game.mjs');
try {
  const { appendGameGoldens } = await import(pathToFileURL(gameGoldens).href);
  await appendGameGoldens({ deps, mod, write, mulberry32, statsAdapter });
} catch (err) {
  if (err && err.code === 'ERR_MODULE_NOT_FOUND') console.log('gen-goldens-game.mjs not present yet (game goldens skipped)');
  else throw err;
}
