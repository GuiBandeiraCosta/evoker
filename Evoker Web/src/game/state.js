'use strict';

/**
 * Save schema, new game, migration and small selectors shared by every game module.
 *
 * Conventions used by all of src/game:
 *  - every state-changing function is pure: `(state, deps, now, args) -> { state, ...info }` (or a plain new
 *    state when nothing else is returned); the input state is never mutated.
 *  - `deps = { db, stats, engine, rng, quests, names }` where `rng` is the `mulberry32(seed)` factory from
 *    src/core/rng.js, `quests` is data/quests.json and `names` is data/names.json (both loaded by app.js).
 *  - randomness is drawn with `takeRng(state, deps)`, which derives a fresh seeded generator from the save's
 *    seed and a counter stored in the save (`rngStep`), so every roll is reproducible.
 *  - `now` is an epoch in ms; nothing here reads the clock.
 *
 * @typedef {object} CardInstance
 * @property {string} uid
 * @property {string} cardId
 * @property {number} stage          0..4
 * @property {number} level
 * @property {number} xp
 * @property {number} evolveQuality  1 for an unfused card
 *
 * @typedef {object} Deps
 * @property {object} db       cards database (src/core/cards-db.js)
 * @property {object} stats    stat formulas (src/core/stats.js)
 * @property {object} engine   { simulateBattle, buildSide }
 * @property {(seed:number)=>object} rng  mulberry32 factory
 * @property {object} [quests] data/quests.json
 * @property {object} [names]  data/names.json
 */

import {
  PLAYER_START, STARTER_CARDS, STARTER_DECK_SLOTS, FEATURE_UNLOCK_LEVELS, DECK_SLOTS,
  SLOT_UNLOCK_LEVELS, FEATURE_UNLOCK_QUESTS,
} from '../core/constants.js';

export const SAVE_VERSION = 1;
export const SAVE_KEY = 'evoker.save.v1';

/** Starter deck by slot index (Envoy in slot 3; Master Brewer waits in the collection for the deck lesson). */
const STARTER_DECK = [null, null, null, null, null];
STARTER_CARDS.forEach((id, i) => { if (STARTER_DECK_SLOTS[i] != null) STARTER_DECK[STARTER_DECK_SLOTS[i]] = id; });

/** Slot indices in the order they open (slot 3, 2, 4, 5, 1). */
const DECK_SLOT_ORDER = DECK_SLOTS.order;
/** Open slots of a new game. */
export const START_DECK_SLOTS = DECK_SLOTS.start;
/** Open-slot count → main quest whose first win opens it (3 → Q2, 4 → Q4, 5 → Q7). */
export const DECK_SLOT_QUESTS = { ...DECK_SLOTS.quests };
/** Player level that unlocks each feature (fusion 2, arena/pieces/replays 4, training 5, league 6). */
export const FEATURE_LEVELS = { ...FEATURE_UNLOCK_LEVELS };
/** Client feature ids and other names accepted by `isUnlocked`. */
const FEATURE_ALIASES = {
  evolve: 'fusion', fuse: 'fusion', pvp: 'arena', enhance: 'training', leagues: 'league', quest: 'quests',
};

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * UTC calendar day of a timestamp, as 'YYYY-MM-DD'.
 * @param {number} now
 * @returns {string}
 */
export function utcDay(now) {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Start of the UTC day containing `now`.
 * @param {number} now
 * @returns {number}
 */
export function utcDayStart(now) {
  return Math.floor(now / DAY_MS) * DAY_MS;
}

/**
 * The empty save with every default filled in.
 * @param {number} now
 * @param {number} seed
 * @returns {object}
 */
export function defaultState(now, seed) {
  return {
    version: SAVE_VERSION,
    createdAt: now,
    lastSeen: now,
    seed: (Number(seed) || 0) >>> 0,
    rngStep: 0,
    uidCounter: 0,
    player: {
      name: '', avatar: 0, level: PLAYER_START.level, xp: PLAYER_START.xp, statPoints: PLAYER_START.statPoints,
      stamina: PLAYER_START.stamina, staminaMax: PLAYER_START.stamina, mana: PLAYER_START.mana,
      manaMax: PLAYER_START.mana, hpMax: PLAYER_START.hpMax,
      staminaPotions: PLAYER_START.staminaPotions, manaPotions: PLAYER_START.manaPotions,
      gold: PLAYER_START.gold, gems: PLAYER_START.gems,
      tokens: { neophyte: 0, summoner: 0, archmage: 0, portalLow: {}, portalHigh: {} },
      regenAt: now, questsDone: 0, battlesWon: 0, tournamentPoints: 0,
      deckSlots: START_DECK_SLOTS,
    },
    cards: [],
    deck: [null, null, null, null, null],
    pieces: [],
    quests: { main: { unlocked: 1, done: 0, firstWins: [] }, portals: {}, active: null, manualPortal: null },
    sim: {
      players: [], day: '', arena: { offers: [], rerollAt: 0 }, league: null, leagueScore: 0, leagueHistory: [],
      leagueTier: 'bronze', leagueJoined: false, leaguePending: null,
    },
    daily: { streak: 0, lastClaim: '', potionDealDay: '' },
    // seen: card ids the album has shown (its "!" badge = an owned set card not seen yet, shop.albumNewCards)
    collections: { claimed: [], seen: [] },
    boosters: {},
    replays: [],
    settings: { sound: true, musicVolume: 0.7, fxVolume: 1, speed: 1, raids: true, reducedMotion: false },
    tutorial: { step: 0, seen: [] },
    notices: [],
  };
}

/**
 * Create a brand-new save with the starter collection and deck.
 * @param {string} name
 * @param {number} seed
 * @param {number} now
 * @param {Deps} [deps]   only `deps.db` is consulted (to validate starter ids); optional
 * @returns {object} state
 */
export function newGame(name, seed, now, deps) {
  let state = defaultState(now, seed);
  state = { ...state, player: { ...state.player, name: String(name || 'Evoker').slice(0, 20) } };
  const cards = [];
  const uidByCard = {};
  for (const cardId of STARTER_CARDS) {
    if (deps && deps.db && typeof deps.db.get === 'function' && !deps.db.get(cardId)) continue;
    const r = nextUid(state);
    state = r.state;
    cards.push({ uid: r.uid, cardId, stage: 0, level: 1, xp: 0, evolveQuality: 1 });
    uidByCard[cardId] = r.uid;
  }
  const deck = STARTER_DECK.map((cardId) => (cardId && uidByCard[cardId]) || null);
  // the first day pays no daily reward (1.7.0 tutorial video: 0 gems, no potions, no popup); day 1 of the
  // calendar is claimed on the next day's first open (shop.claimDaily: lastClaim = yesterday → streak 1)
  const daily = { ...state.daily, streak: 0, lastClaim: utcDay(now) };
  return { ...state, cards, deck, daily };
}

/**
 * Open-slot count a save written before round 3 gets: never fewer than the legacy level table gave it, than
 * its quest progress earns, or than needed to keep every card it has in the deck on an open slot.
 * @param {object} save  the raw save (before defaults)
 * @returns {number}
 */
export function legacyDeckSlots(save) {
  const level = (save.player && Number(save.player.level)) || 1;
  const legacy = SLOT_UNLOCK_LEVELS.filter((need) => level >= need).length;
  let cover = 0;
  (Array.isArray(save.deck) ? save.deck : []).forEach((uid, i) => {
    if (uid) cover = Math.max(cover, DECK_SLOT_ORDER.indexOf(i) + 1);
  });
  const wins = (save.quests && save.quests.main && save.quests.main.firstWins) || [];
  return Math.min(5, Math.max(START_DECK_SLOTS, legacy, cover, slotsForQuestWins(wins)));
}

/**
 * Open-slot count earned by main-quest first wins.
 * @param {number[]} firstWins
 * @returns {number}
 */
export function slotsForQuestWins(firstWins) {
  let n = START_DECK_SLOTS;
  for (const [count, quest] of Object.entries(DECK_SLOT_QUESTS)) {
    if ((firstWins || []).includes(quest)) n = Math.max(n, Number(count));
  }
  return n;
}

/**
 * Bring an older or partial save up to the current schema (fills missing fields, never drops data).
 * @param {object} save
 * @param {number} now
 * @returns {object}
 */
export function migrate(save, now) {
  const base = defaultState(now, save && save.seed != null ? save.seed : 1);
  if (!save || typeof save !== 'object') return base;
  const merged = deepDefaults(save, base);
  merged.version = SAVE_VERSION;
  // Saves written before the audio module existed carry sound:false from the old 'no audio ships' default;
  // it was never a player choice, so a save without the volume fields gets audio on with the default volumes.
  if (!save.settings || typeof save.settings !== 'object' || save.settings.musicVolume === undefined) {
    merged.settings = { ...merged.settings, sound: true, musicVolume: base.settings.musicVolume, fxVolume: base.settings.fxVolume };
  }
  if (!Array.isArray(merged.deck) || merged.deck.length !== 5) merged.deck = [null, null, null, null, null];
  // League fields of saves from before round 3 stay unknown (null) so that src/game/league.js can read the old
  // league instead: hasJoined() counts an old league as joined and leagueTierOf() keeps its tier.
  const rawSim = save.sim && typeof save.sim === 'object' ? save.sim : {};
  if (!('leagueJoined' in rawSim)) merged.sim = { ...merged.sim, leagueJoined: null };
  if (!('leagueTier' in rawSim)) merged.sim = { ...merged.sim, leagueTier: null };
  // Saves from before round 3 used level-based deck slots: size the new quest-based slot count so that no
  // slot that was open (or holds a card) gets locked.
  const rawSlots = save.player && typeof save.player === 'object' ? Number(save.player.deckSlots) : NaN;
  merged.player = { ...merged.player, deckSlots: Number.isFinite(rawSlots) ? Math.max(1, Math.min(5, rawSlots)) : legacyDeckSlots(save) };
  merged.cards = merged.cards.map((c) => ({ xp: 0, evolveQuality: 1, stage: 0, level: 1, ...c }));
  // Saves from before the album badge (round 5): every card they own counts as seen, so no old card raises it.
  const rawCol = save.collections && typeof save.collections === 'object' ? save.collections : {};
  if (!Array.isArray(rawCol.seen)) merged.collections = { ...merged.collections, seen: [...new Set(merged.cards.map((c) => c.cardId))] };
  // uidCounter must be above every uid in the save
  let maxUid = merged.uidCounter || 0;
  for (const c of merged.cards) {
    const m = /^c(\d+)$/.exec(c.uid || '');
    if (m) maxUid = Math.max(maxUid, Number(m[1]));
  }
  merged.uidCounter = maxUid;
  return merged;
}

function deepDefaults(value, def) {
  if (Array.isArray(def)) return Array.isArray(value) ? value.slice() : def.slice();
  if (def && typeof def === 'object') {
    const out = {};
    const src = value && typeof value === 'object' ? value : {};
    for (const k of Object.keys(def)) out[k] = deepDefaults(src[k], def[k]);
    for (const k of Object.keys(src)) if (!(k in out)) out[k] = src[k];
    return out;
  }
  return value === undefined ? def : value;
}

/**
 * Drop what a save refers to that the game no longer has (cards and portals removed from the data, e.g. the
 * Dungeon Casino set, 2026-10-10): unknown cards leave the collection and the deck, unknown portal records, an
 * active quest on an unknown line, a manual portal choice and claimed/seen entries of unknown sets or cards go.
 * Pure; returns the same object when nothing had to go.
 * @param {object} state
 * @param {{db: object, quests: object}} deps
 * @returns {object}
 */
export function pruneRemoved(state, deps) {
  if (!state || !deps || !deps.db) return state;
  const db = deps.db;
  const lines = new Set(['main', ...(((deps.quests && deps.quests.portals) || []).map((p) => p.id))]);
  let changed = false;
  const cards = state.cards.filter((c) => db.get(c.cardId));
  if (cards.length !== state.cards.length) changed = true;
  const uids = new Set(cards.map((c) => c.uid));
  const deck = state.deck.map((uid) => (uid && uids.has(uid) ? uid : null));
  if (deck.some((u, i) => u !== state.deck[i])) changed = true;
  const q = state.quests || {};
  const portals = {};
  for (const [id, rec] of Object.entries(q.portals || {})) { if (lines.has(id)) portals[id] = rec; else changed = true; }
  const active = q.active && q.active.line && !lines.has(q.active.line) ? null : q.active;
  if (active !== q.active) changed = true;
  const manualPortal = q.manualPortal && !lines.has(q.manualPortal) ? null : q.manualPortal;
  if (manualPortal !== q.manualPortal) changed = true;
  const col = state.collections || { claimed: [], seen: [] };
  const claimed = (col.claimed || []).filter((id) => lines.has(id));
  const seen = (col.seen || []).filter((id) => db.get(id));
  if (claimed.length !== (col.claimed || []).length || seen.length !== (col.seen || []).length) changed = true;
  if (!changed) return state;
  return { ...state, cards, deck, quests: { ...q, portals, active, manualPortal }, collections: { ...col, claimed, seen } };
}

/**
 * Allocate the next card uid.
 * @param {object} state
 * @returns {{state: object, uid: string}}
 */
export function nextUid(state) {
  const n = (state.uidCounter || 0) + 1;
  return { state: { ...state, uidCounter: n }, uid: 'c' + n };
}

/**
 * Mix a seed and a step counter into a 32-bit seed.
 * @param {number} seed
 * @param {number} step
 * @returns {number}
 */
export function mixSeed(seed, step) {
  let h = ((Number(seed) || 0) ^ Math.imul(step | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Draw a fresh seeded generator from the save and advance the save's counter.
 * @param {object} state
 * @param {Deps} deps
 * @returns {{state: object, rng: object, seed: number}}
 */
export function takeRng(state, deps) {
  const step = (state.rngStep || 0) + 1;
  const seed = mixSeed(state.seed, step);
  return { state: { ...state, rngStep: step }, rng: deps.rng(seed), seed };
}

/**
 * @param {object} state
 * @param {string} uid
 * @returns {CardInstance|undefined}
 */
export function getCard(state, uid) {
  return state.cards.find((c) => c.uid === uid);
}

/**
 * Card instances in deck order (null for empty slots).
 * @param {object} state
 * @returns {Array<CardInstance|null>}
 */
export function deckCards(state) {
  return state.deck.map((uid) => (uid ? getCard(state, uid) || null : null));
}

/**
 * Sum of mana costs of the cards in the deck.
 * @param {object} state
 * @param {Deps} deps
 * @returns {number}
 */
export function deckMana(state, deps) {
  return deckCards(state).reduce((sum, c) => {
    if (!c) return sum;
    const def = deps.db.get(c.cardId);
    return sum + (def ? Number(def.mana) || 0 : 0);
  }, 0);
}

/**
 * Number of open deck slots (1..5): the stored count, never below what the main-quest first wins earn.
 * @param {object} state
 * @returns {number}
 */
export function deckSlotCount(state) {
  const stored = Number(state.player && state.player.deckSlots);
  const base = Number.isFinite(stored) ? stored : START_DECK_SLOTS;
  return Math.max(1, Math.min(5, Math.max(base, slotsForQuestWins(state.quests.main.firstWins))));
}

/**
 * Is a deck slot open? Slots open by quest progress (`deckSlotCount`, in DECK_SLOTS.order); saves from before
 * round 3 are sized by `legacyDeckSlots`.
 * @param {object} state
 * @param {number} slot  0..4
 * @returns {boolean}
 */
export function slotUnlocked(state, slot) {
  if (!(slot >= 0 && slot < 5)) return false;
  return DECK_SLOT_ORDER.indexOf(slot) < deckSlotCount(state);
}

/**
 * Open deck slots after a quest win: the first win of main Q2 / Q4 / Q7 opens the 3rd / 4th / 5th slot
 * ("Card Slot Unlocked! / Your deck can now hold #numCards# cards.").
 * @param {object} state
 * @param {string} lineId
 * @param {number} n
 * @returns {{state: object, slots: number|null}}  `slots` = the new open-slot count when one opened
 */
export function unlockSlotsForQuest(state, lineId, n) {
  if (lineId !== 'main') return { state, slots: null };
  const stored = Number(state.player && state.player.deckSlots);
  const before = Number.isFinite(stored) ? stored : START_DECK_SLOTS;
  let target = before;
  for (const [count, quest] of Object.entries(DECK_SLOT_QUESTS)) if (quest === n) target = Math.max(target, Number(count));
  if (target <= before) return { state, slots: null };
  return { state: updatePlayer(state, { deckSlots: target }), slots: target };
}

/**
 * Canonical feature id (accepts the client ids evolve / pvp / enhance / leagues).
 * @param {string} feature
 * @returns {string}
 */
export function featureId(feature) {
  return FEATURE_ALIASES[feature] || feature;
}

/**
 * Is a feature available? Features: quests, cards, shop, fusion, arena, pieces, replays, training, league (or the
 * client ids), plus 'cardslot1'..'cardslot5' for the deck slots (1-based like the client).
 * @param {object} state
 * @param {string} feature
 * @returns {boolean}
 */
export function isUnlocked(state, feature) {
  const m = /^cardslot([1-5])$/.exec(String(feature));
  if (m) return slotUnlocked(state, Number(m[1]) - 1);
  const id = featureId(feature);
  const need = FEATURE_LEVELS[id];
  if (need == null) return false;
  const quest = FEATURE_UNLOCK_QUESTS[id];
  if (quest != null && unlocksByQuest(state)) {
    return state.quests.main.firstWins.includes(quest);
  }
  return state.player.level >= need;
}

/**
 * Does this save open its features by main-quest wins (FEATURE_UNLOCK_QUESTS) instead of by level? True for a game
 * started with the round-3 tutorial (it carries `state.tutorial.r3`); older saves keep the level table.
 * @param {object} state
 * @returns {boolean}
 */
export function unlocksByQuest(state) {
  const r3 = state && state.tutorial && state.tutorial.r3;
  return Boolean(r3 && typeof r3 === 'object');
}

/**
 * Is the first-session tutorial still running on this save (a round-3 tutorial record that is not `done`)? Saves
 * without a record (from before round 3) never are. The tutorial game has no daily event (shop.dailyEvent) and
 * a scripted, beatable holder for its card piece (pieces.js / opponents.TUTORIAL_HOLDER).
 * @param {object|null} state
 * @returns {boolean}
 */
export function inTutorial(state) {
  const r3 = state && state.tutorial && state.tutorial.r3;
  return Boolean(r3 && typeof r3 === 'object' && !r3.done);
}

/** Features that get a view_unlocked_feature_popup (Pieces and Replays open with the Arena). */
export const POPUP_FEATURES = ['fusion', 'arena', 'training', 'league'];

/**
 * Features that open exactly at a player level, for the "… Unlocked!" popups after a level-up
 * (fusion → "Card Fusing Unlocked!", arena → "Arena Unlocked!", training → "Card Training Unlocked!",
 * league → "Leagues Unlocked!"). A quest-unlock save (`unlocksByQuest`) gets none: its popups follow the boss wins.
 * @param {number} level
 * @param {object} [state]
 * @returns {string[]}
 */
export function featuresUnlockedAt(level, state) {
  if (state && unlocksByQuest(state)) return [];
  return POPUP_FEATURES.filter((f) => FEATURE_LEVELS[f] === level);
}

/**
 * Shallow-merge changes into `state.player`.
 * @param {object} state
 * @param {object} changes
 * @returns {object}
 */
export function updatePlayer(state, changes) {
  return { ...state, player: { ...state.player, ...changes } };
}

/**
 * Replace fields of one card instance.
 * @param {object} state
 * @param {string} uid
 * @param {object} changes
 * @returns {object}
 */
export function updateCard(state, uid, changes) {
  return { ...state, cards: state.cards.map((c) => (c.uid === uid ? { ...c, ...changes } : c)) };
}

/**
 * Append a login notice (shown by the UI on next open).
 * @param {object} state
 * @param {object} notice  { type, ...data }
 * @returns {object}
 */
export function addNotice(state, notice) {
  return { ...state, notices: [...state.notices, notice] };
}

/**
 * Touch `lastSeen`.
 * @param {object} state
 * @param {number} now
 * @returns {object}
 */
export function touch(state, now) {
  return { ...state, lastSeen: now };
}
