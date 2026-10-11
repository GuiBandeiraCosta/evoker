'use strict';
/**
 * The game store: holds the single save object, applies pure game functions through `update(fn)`,
 * autosaves after every change and notifies subscribers. DOM-free so it can be unit-tested in Node.
 *
 * Also hosts small pure helpers (HUD data, clock shifting for the debug API, save parsing, nav-id → screen-id
 * mapping, seed derivation).
 */
import { migrate, utcDay, DAY_MS } from '../game/state.js';

/**
 * @typedef {object} StoreOptions
 * @property {object|null} [state]  initial save (null = no save yet)
 * @property {object} deps          what every src/game function takes as `deps`
 * @property {() => number} now     clock (ms epoch)
 * @property {(state: object) => void} [save]  autosave callback, called after every change
 * @property {(err: Error) => void} [onError]  called when `save` throws (default: console.error)
 */

/**
 * Create a store.
 * @param {StoreOptions} opts
 * @returns {{
 *   get: () => object|null,
 *   set: (state: object|null) => void,
 *   update: (fn: (state: object, deps: object, now: number) => object) => (object|undefined),
 *   subscribe: (fn: (state: object|null, info?: object) => void) => (() => void),
 *   hasSave: () => boolean,
 * }}
 */
export function createStore(opts) {
  let state = opts.state || null;
  const listeners = new Set();
  const onError = opts.onError || ((err) => { if (typeof console !== 'undefined') console.error(err); });

  function persist() {
    if (!opts.save || !state) return;
    try { opts.save(state); } catch (err) { onError(err); }
  }

  function notify(info) {
    for (const fn of Array.from(listeners)) {
      try { fn(state, info); } catch (err) { onError(err); }
    }
  }

  /** @returns {object|null} the save (never mutate it) */
  function get() { return state; }

  /**
   * Replace the save wholesale (new game, import, debug). Autosaves and notifies.
   * @param {object|null} next
   */
  function set(next) {
    state = next || null;
    persist();
    notify(undefined);
  }

  /**
   * Apply a pure game function. `fn(state, deps, now)` returns either the new state or
   * `{ state, ...info }`; the store keeps the state, autosaves, notifies and returns `info`.
   * @param {(state: object, deps: object, now: number) => object} fn
   * @returns {object|undefined} info (the result minus `state`) or undefined
   */
  function update(fn) {
    if (!state) throw new Error('store.update: no save loaded');
    const res = fn(state, opts.deps, opts.now());
    let info;
    if (res && typeof res === 'object' && Object.prototype.hasOwnProperty.call(res, 'state')) {
      const { state: next, ...rest } = res;
      if (next && typeof next === 'object') state = next;
      info = rest;
    } else if (res && typeof res === 'object') {
      state = res;
    }
    persist();
    notify(info);
    return info;
  }

  /**
   * Subscribe to changes. `fn(state, info)` runs after every set/update.
   * @param {(state: object|null, info?: object) => void} fn
   * @returns {() => void} unsubscribe
   */
  function subscribe(fn) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }

  return { get, set, update, subscribe, hasSave: () => Boolean(state) };
}

/**
 * HUD data from the save (architecture 8.2).
 * @param {object} state
 * @param {{playerXpToNext: (level: number) => number}} stats
 * @returns {import('./components/hud.js').HudData}
 */
export function hudData(state, stats) {
  const p = state.player;
  const toNext = stats.playerXpToNext(p.level);
  return {
    level: p.level,
    xp: p.xp,
    xpToNext: Number.isFinite(toNext) ? toNext : Math.max(1, p.xp),
    stamina: p.stamina, staminaMax: p.staminaMax, staminaPotions: p.staminaPotions,
    mana: p.mana, manaMax: p.manaMax, manaPotions: p.manaPotions,
    gold: p.gold, gems: p.gems,
  };
}

/** Nav button id → screen id. */
export const NAV_SCREENS = Object.freeze({
  league: 'league', arena: 'arena', quest: 'quest-map', cards: 'cards', shop: 'shop', character: 'character',
});

/**
 * Screen id for a nav id (screen ids pass through).
 * @param {string} id
 * @returns {string}
 */
export function navScreen(id) {
  return NAV_SCREENS[id] || id;
}

/**
 * Shift a 'YYYY-MM-DD' day string by a number of ms ('' stays '').
 * @param {string} day
 * @param {number} deltaMs
 * @returns {string}
 */
export function shiftDay(day, deltaMs) {
  if (!day || typeof day !== 'string') return day;
  const t = Date.parse(day + 'T00:00:00Z');
  if (!Number.isFinite(t)) return day;
  return utcDay(t + deltaMs);
}

/**
 * Shift every clock in the save by `deltaMs` (negative = the save looks older), so that daily features
 * (regen, portal rotation, league day, daily rewards, raids, the arena offers rotation) can be tested without waiting.
 * Pure: returns a new state.
 * @param {object} state
 * @param {number} deltaMs
 * @returns {object}
 */
export function shiftClocks(state, deltaMs) {
  const d = Number(deltaMs) || 0;
  const ts = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v + d : v);
  const sim = state.sim || {};
  const league = sim.league ? {
    ...sim.league,
    day: shiftDay(sim.league.day, d),
    startedAt: ts(sim.league.startedAt),
    endsAt: ts(sim.league.endsAt),
    joinedAt: ts(sim.league.joinedAt),
  } : sim.league;
  return {
    ...state,
    createdAt: ts(state.createdAt),
    lastSeen: ts(state.lastSeen),
    player: { ...state.player, regenAt: ts(state.player.regenAt) },
    daily: { ...(state.daily || {}), lastClaim: shiftDay((state.daily || {}).lastClaim, d), potionDealDay: shiftDay((state.daily || {}).potionDealDay, d) },
    pieces: (state.pieces || []).map((p) => ({ ...p, raidDay: shiftDay(p.raidDay, d) })),
    sim: {
      ...sim,
      day: shiftDay(sim.day, d),
      arena: sim.arena ? { ...sim.arena, rerollAt: ts(sim.arena.rerollAt) } : sim.arena,
      league,
      players: Array.isArray(sim.players) ? sim.players.map((s) => ({ ...s, day: shiftDay(s.day, d) })) : sim.players,
    },
    quests: state.quests && state.quests.active ? { ...state.quests, active: { ...state.quests.active, startedAt: ts(state.quests.active.startedAt) } } : state.quests,
  };
}

/**
 * Shift the save so that `days` real days appear to have passed.
 * @param {object} state
 * @param {number} days
 * @returns {object}
 */
export function addDays(state, days) {
  return shiftClocks(state, -(Number(days) || 0) * DAY_MS);
}

/**
 * Parse a raw localStorage value into a migrated save, or null when absent/corrupt.
 * @param {string|null|undefined} raw
 * @param {number} now
 * @returns {object|null}
 */
export function parseSave(raw, now) {
  if (!raw) return null;
  try {
    const json = JSON.parse(raw);
    if (!json || typeof json !== 'object' || !json.player) return null;
    return migrate(json, now);
  } catch (err) {
    return null;
  }
}

/**
 * Serialise a save for storage, touching `lastSeen`.
 * @param {object} state
 * @param {number} now
 * @returns {string}
 */
export function serializeSave(state, now) {
  return JSON.stringify({ ...state, lastSeen: now });
}

/**
 * Derive a 32-bit seed from the clock (no Math.random in game logic).
 * @param {number} now
 * @returns {number}
 */
export function seedFromNow(now) {
  let h = (Math.floor(Number(now) || 0) ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h || 1;
}
