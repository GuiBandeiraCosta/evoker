'use strict';
/**
 * Shared fixtures of the tests that run on the real data (data/cards.json, quests.json, names.json): the fixed
 * clock, the deep-freeze helpers, the real cards db and the dependency bundles, and the save builders of the
 * mechanics tests. The tests on the 21-card fixture catalog use tests/fixtures-game/ instead.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mulberry32 } from '../../src/core/rng.js';
import { loadCardsDbFromFile } from '../../src/core/cards-db.js';
import * as stats from '../../src/core/stats.js';
import { buildSide } from '../../src/engine/battle-state.js';
import { simulateBattle } from '../../src/engine/battle.js';
import { newGame, DAY_MS, slotUnlocked } from '../../src/game/state.js';
import { addCard } from '../../src/game/collection.js';
import { makeEngine } from '../fixtures-game/engine.js';
import { classicGame } from '../fixtures-game/classic.js';

/** Project root (file system path). */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** The tests' clock: 2026-10-07 12:00 UTC. */
export const T0 = Date.UTC(2026, 9, 7, 12, 0, 0);
export const MIN = 60 * 1000;
export const DAY = DAY_MS;
export const RARITY_IDS = ['common', 'standard', 'uncommon', 'rare', 'heroic', 'legendary', 'ultimate'];

/**
 * Parse a JSON file of the project.
 * @param {string} rel  path from the project root
 * @returns {any}
 */
export const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

/**
 * Freeze an object graph in place.
 * @template T
 * @param {T} o
 * @returns {T}
 */
export function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}
/** Deep-frozen clone: the input the purity-checking tests hand to every game function. */
export const fz = (s) => deepFreeze(structuredClone(s));

export const QUESTS = deepFreeze(readJson('data/quests.json'));
export const NAMES = deepFreeze(readJson('data/names.json'));
/** The real cards db (data/cards.json). */
export const db = await loadCardsDbFromFile();

/** Real db/stats/quests/names + the stub engine whose winner the test chooses. */
export function deps(winner = 'attacker') {
  return { db, stats, engine: makeEngine({ winner }), rng: mulberry32, quests: QUESTS, names: NAMES };
}
/** Everything real, including the battle engine. */
export function realDeps() {
  return { db, stats, engine: { simulateBattle, buildSide }, rng: mulberry32, quests: QUESTS, names: NAMES };
}

/** The classic 6-card save (mechanics tests), frozen; `tutorialStart` is the real round-3 `newGame`. */
export function fresh() {
  return fz(classicGame('Tester', 4242, T0));
}
export function tutorialStart(d = deps()) {
  return fz(newGame('Tester', 4242, T0, d));
}
/** A level-10 player with plenty of everything (frozen). */
export function rich(state, extra = {}) {
  return fz({ ...state, player: { ...state.player, level: 10, gold: 1e6, gems: 1e5, mana: 300, manaMax: 300, stamina: 5000, staminaMax: 5000, ...extra } });
}
/** Add a card to a frozen save: [state, uid]. */
export function give(state, d, cardId, opts) {
  const r = addCard(fz(state), d, cardId, opts);
  return [fz(r.state), r.uid];
}
/** First non-trainer card of a rarity. */
export function sample(rarity, n = 0) {
  return db.byRarity(rarity).filter((x) => !x.trainer)[n];
}
export function mainNode(n) { return QUESTS.main.nodes[n - 1]; }
export function portal(i = 0) { return QUESTS.portals[i]; }
export function within(x, target, tol) { return Math.abs(x - target) <= tol; }

/**
 * Open deck slot indices of a save.
 * @param {object} state
 * @returns {number[]}
 */
export function openSlots(state) {
  return [0, 1, 2, 3, 4].filter((i) => slotUnlocked(state, i));
}
