'use strict';

import { takeRng, utcDay, deckCards, deckMana } from './state.js';
import { capFor } from './collection.js';
import { ARENA, MAX_PLAYER_LEVEL, RARITY_ORDER } from '../core/constants.js';

/**
 * Simulated players: the pool (generated once, refreshed daily), AI deck builder, and the helpers that turn
 * a simulated player or the human player into an engine fighter side (game-design §5).
 *
 * @typedef {object} SimPlayer
 * @property {string} id            'sim-<n>'
 * @property {string} name
 * @property {number} avatar        0..11
 * @property {number} level
 * @property {number} hpMax
 * @property {number} staminaMax
 * @property {number} manaMax
 * @property {number} questsDone
 * @property {number} battlesWon
 * @property {Array<{cardId:string, stage:number, level:number, evolveQuality:number}|null>} deck
 * @property {string} bornDay
 */

/** Simulated players in the pool. */
export const POOL_SIZE = ARENA.simulatedPlayers;
export const DAILY_LEVEL_CHANCE = 0.3;
export const STALE_LEVEL_GAP = 5;

/**
 * Rarities a simulated player of a level fields.
 * @param {number} level
 * @returns {string[]}
 */
export function raritiesForLevel(level) {
  if (level < 4) return ['common', 'standard'];
  if (level < 8) return ['standard', 'uncommon'];
  if (level < 15) return ['uncommon'];
  if (level < 25) return ['uncommon', 'rare'];
  if (level < 40) return ['rare'];
  if (level < 60) return ['rare', 'heroic'];
  if (level < 90) return ['heroic'];
  if (level < 130) return ['heroic', 'legendary'];
  return ['legendary', 'ultimate'];
}

/**
 * Fusion stage a simulated player's cards have at an effective level.
 * @param {number} effLevel
 * @returns {number}
 */
export function stageForLevel(effLevel) {
  if (effLevel >= 150) return 4;
  if (effLevel >= 90) return 3;
  if (effLevel >= 50) return 2;
  if (effLevel >= 25) return 1;
  return 0;
}

/**
 * Deck slots a simulated player of a level can use (the pre-round-3 level table of the human deck slots).
 * @param {number} level
 * @returns {number[]}
 */
export function slotsForLevel(level) {
  if (level < 3) return [1, 2, 3];
  if (level < 5) return [1, 2, 3, 4];
  return [0, 1, 2, 3, 4];
}

/**
 * Card level of a simulated deck card.
 * @param {number} level  player level
 * @param {number} power  multiplier
 * @param {number} cap
 * @returns {number}
 */
export function simCardLevel(level, power, cap) {
  return Math.max(1, Math.min(cap, Math.round((1 + level * 0.5) * power)));
}

/**
 * Max stats of a simulated player (they spend ~4 points per level on each stat).
 * @param {number} level
 * @returns {{hpMax: number, staminaMax: number, manaMax: number}}
 */
export function simStats(level) {
  return { hpMax: 1500 + 120 * (level - 1), staminaMax: 50 + 4 * (level - 1), manaMax: 50 + 4 * (level - 1) };
}

/**
 * Build an AI deck for a level and power multiplier within the sim's mana budget.
 * @param {object} rng
 * @param {object} deps
 * @param {number} level
 * @param {number} [power]
 * @returns {Array<object|null>} 5 slots
 */
export function buildSimDeck(rng, deps, level, power = 1) {
  const db = deps.db;
  const effLevel = Math.round(level * power);
  const rarities = raritiesForLevel(effLevel);
  const budget = simStats(level).manaMax;
  const slots = slotsForLevel(level);
  const deck = [null, null, null, null, null];
  let manaLeft = budget;
  for (const slot of slots) {
    let chosen = null;
    for (let attempt = 0; attempt < 12 && !chosen; attempt++) {
      const r = attempt < 6 ? rng.pick(rarities) : RARITY_ORDER[Math.max(0, RARITY_ORDER.indexOf(rarities[0]) - 1 - Math.floor((attempt - 6) / 2))] || 'common';
      const pool = (db.byRarity(r) || []).filter((d) => !d.trainer && (Number(d.mana) || 0) <= manaLeft);
      if (pool.length) chosen = rng.pick(pool);
    }
    if (!chosen) continue;
    const stage = stageForLevel(effLevel);
    const lvl = simCardLevel(level, power, capFor(deps, chosen, stage));
    deck[slot] = { cardId: chosen.id, stage, level: lvl, evolveQuality: 1 };
    manaLeft -= Number(chosen.mana) || 0;
  }
  return deck;
}

/**
 * Create one simulated player.
 * @param {object} rng
 * @param {object} deps
 * @param {string} id
 * @param {number} level
 * @param {string} day
 * @param {string} name
 * @returns {SimPlayer}
 */
export function makeSim(rng, deps, id, level, day, name) {
  const lvl = Math.max(1, Math.min(MAX_PLAYER_LEVEL, level));
  const st = simStats(lvl);
  return {
    id, name, avatar: rng.int(12), level: lvl, ...st,
    questsDone: Math.min(300, lvl * 3 + rng.int(10)),
    battlesWon: lvl * 5 + rng.int(20),
    deck: buildSimDeck(rng, deps, lvl, 1),
    bornDay: day,
  };
}

/**
 * Generate the whole pool around the player's level (replaces any existing pool).
 * @param {object} state
 * @param {object} deps
 * @param {number} now
 * @returns {{state: object}}
 */
export function generatePool(state, deps, now) {
  const t = takeRng(state, deps);
  const rng = t.rng;
  const names = shuffle(rng, ((deps.names && deps.names.names) || []).slice());
  const day = utcDay(now);
  const base = state.player.level;
  const players = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    const offset = -3 + rng.int(9); // -3 .. +5
    const name = names[i % Math.max(1, names.length)] || 'Evoker ' + (i + 1);
    players.push(makeSim(rng, deps, 'sim-' + (i + 1), base + offset, day, name));
  }
  return { state: { ...t.state, sim: { ...t.state.sim, players, day, arena: { offers: [], rerollAt: 0 } } } };
}

/**
 * Make sure a pool exists and refresh it once per UTC day: simulated players gain levels slowly, players
 * that fell far behind are replaced, decks are rebuilt so the ladder keeps up with the human.
 * @param {object} state
 * @param {object} deps
 * @param {number} now
 * @returns {{state: object, refreshed: boolean}}
 */
export function ensurePool(state, deps, now) {
  const day = utcDay(now);
  if (state.sim.players.length === 0) return { state: generatePool(state, deps, now).state, refreshed: true };
  if (state.sim.day === day) return { state, refreshed: false };
  const t = takeRng(state, deps);
  const rng = t.rng;
  const names = (deps.names && deps.names.names) || [];
  const base = state.player.level;
  const players = state.sim.players.map((sim) => {
    if (sim.level < base - STALE_LEVEL_GAP) {
      const name = names.length ? rng.pick(names) : sim.name;
      return makeSim(rng, deps, sim.id, base - 1 + rng.int(5), day, name);
    }
    const level = Math.min(MAX_PLAYER_LEVEL, sim.level + (rng.chance(DAILY_LEVEL_CHANCE) ? 1 : 0));
    const st = simStats(level);
    return { ...sim, level, ...st, deck: buildSimDeck(rng, deps, level, 1), battlesWon: sim.battlesWon + rng.int(6), questsDone: Math.min(300, sim.questsDone + rng.int(3)) };
  });
  return { state: { ...t.state, sim: { ...t.state.sim, players, day, arena: { offers: [], rerollAt: 0 } } }, refreshed: true };
}

/**
 * The tutorial's "amateur mage" (tutorial-v2 §7.9–7.12): the scripted holder of the quest-6 card piece on a tutorial
 * save — "Baltasar", Level 2, Quests 2, Battles won 0, 1500 HP, three weak level-1 cards (hidden in the pre-battle:
 * two orc and one elf emblem in slots 2–4), beaten at once in the video. Not part of the pool (no level-ups, no
 * league, no arena offers); `getSim` resolves its id.
 * @type {SimPlayer}
 */
export const TUTORIAL_HOLDER = Object.freeze({
  id: 'sim-tutorial', name: 'Baltasar', avatar: 3, level: 2, hpMax: 1500, staminaMax: 50, manaMax: 50,
  questsDone: 2, battlesWon: 0, bornDay: '',
  deck: Object.freeze([
    null,
    Object.freeze({ cardId: 'pouch-tearer', stage: 0, level: 1, evolveQuality: 1 }),
    Object.freeze({ cardId: 'envoy', stage: 0, level: 1, evolveQuality: 1 }),
    Object.freeze({ cardId: 'pouch-tearer', stage: 0, level: 1, evolveQuality: 1 }),
    null,
  ]),
});

/**
 * @param {object} state
 * @param {string} simId
 * @returns {SimPlayer|undefined}
 */
export function getSim(state, simId) {
  if (simId === TUTORIAL_HOLDER.id) return TUTORIAL_HOLDER;
  return state.sim.players.find((s) => s.id === simId);
}

/**
 * Pick `count` distinct simulated players whose level lies in [min, max] (relative to the player), falling
 * back to the nearest levels when too few match.
 * @param {object} state
 * @param {object} rng
 * @param {{count: number, min: number, max: number, exclude?: string[]}} opts  min/max are level offsets
 * @returns {SimPlayer[]}
 */
export function pickSims(state, rng, opts) {
  const base = state.player.level;
  const exclude = new Set(opts.exclude || []);
  const all = state.sim.players.filter((s) => !exclude.has(s.id));
  let pool = all.filter((s) => s.level >= base + opts.min && s.level <= base + opts.max);
  if (pool.length < opts.count) {
    const target = base + (opts.min + opts.max) / 2;
    pool = all.slice().sort((a, b) => Math.abs(a.level - target) - Math.abs(b.level - target)).slice(0, Math.max(opts.count, 6));
  }
  const out = [];
  pool = pool.slice();
  while (out.length < opts.count && pool.length) out.push(pool.splice(rng.int(pool.length), 1)[0]);
  return out;
}

/**
 * Info popup data for a simulated player.
 * @param {SimPlayer} sim
 * @param {object} deps
 * @returns {object}
 */
export function simInfo(sim, deps) {
  const mana = (c) => (deps.db.get(c.cardId) || {}).mana || 0;
  const best = sim.deck.filter(Boolean).sort((a, b) => b.level - a.level || mana(b) - mana(a))[0] || null;
  return {
    id: sim.id, name: sim.name, avatar: sim.avatar, level: sim.level,
    stamina: sim.staminaMax, mana: sim.manaMax, hp: sim.hpMax,
    quests: sim.questsDone, battlesWon: sim.battlesWon,
    bestCard: best ? { ...best, name: (deps.db.get(best.cardId) || {}).name } : null,
    deckMana: simDeckMana(sim, deps),
  };
}

/**
 * Mana sum of a sim's deck.
 * @param {SimPlayer} sim
 * @param {object} deps
 * @returns {number}
 */
export function simDeckMana(sim, deps) {
  return sim.deck.filter(Boolean).reduce((s, c) => s + ((deps.db.get(c.cardId) || {}).mana || 0), 0);
}

/**
 * The `computeStats` callback battle-state.js expects, backed by stats.statAt.
 * @param {object} deps
 * @returns {(args: {cardDef: object, stage: number, level: number, evolveQuality: number}) => {attack: number, hp: number, ability: number|null}}
 */
export function statsAdapter(deps) {
  return ({ cardDef, stage, level, evolveQuality }) => ({
    attack: deps.stats.statAt(cardDef, 'attack', stage, level, evolveQuality) || 0,
    hp: deps.stats.statAt(cardDef, 'hp', stage, level, evolveQuality) || 1,
    ability: cardDef.base && cardDef.base.ability != null ? deps.stats.statAt(cardDef, 'ability', stage, level, evolveQuality) : null,
  });
}

/**
 * Options object for engine.buildSide.
 * @param {object} deps
 * @returns {object}
 */
export function sideOptions(deps) {
  return { cardsDb: deps.db, computeStats: statsAdapter(deps) };
}

/**
 * Build the human player's fighter side from the current deck.
 * @param {object} state
 * @param {object} deps
 * @returns {object} FighterSide
 */
export function buildPlayerSide(state, deps) {
  const p = state.player;
  return deps.engine.buildSide({ name: p.name, hp: p.hpMax, maxHp: p.hpMax, avatar: p.avatar }, deckCards(state), sideOptions(deps));
}

/**
 * Deck instances of a sim scaled by a power multiplier (levels scaled, clamped to caps).
 * @param {SimPlayer} sim
 * @param {object} deps
 * @param {number} power
 * @returns {Array<object|null>}
 */
export function scaledSimDeck(sim, deps, power) {
  return sim.deck.map((c, i) => {
    if (!c) return null;
    const def = deps.db.get(c.cardId);
    if (!def) return null;
    const level = Math.max(1, Math.min(capFor(deps, def, c.stage), Math.round(c.level * power)));
    return { ...c, uid: sim.id + '-' + i, level };
  });
}

/**
 * Build a simulated player's fighter side.
 * @param {SimPlayer} sim
 * @param {object} deps
 * @param {number} [power]
 * @returns {object} FighterSide
 */
export function buildSimSide(sim, deps, power = 1) {
  const hp = Math.round(sim.hpMax * power);
  return deps.engine.buildSide({ name: sim.name, hp, maxHp: hp, avatar: sim.avatar, level: sim.level }, scaledSimDeck(sim, deps, power), sideOptions(deps));
}

/**
 * Mana the player's current deck costs to field (the cost of any PvP fight).
 * @param {object} state
 * @param {object} deps
 * @returns {number}
 */
export function pvpManaCost(state, deps) {
  return deckMana(state, deps);
}

/**
 * Fisher–Yates with the seeded rng (in place, returns the array).
 * @param {object} rng
 * @param {any[]} arr
 * @returns {any[]}
 */
export function shuffle(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}
