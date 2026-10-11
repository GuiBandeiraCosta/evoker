'use strict';

import { getCard, nextUid, updateCard, slotUnlocked } from './state.js';
import { addGold } from './player.js';
import { COLLECTION_LIMIT, RARITY_ORDER } from '../core/constants.js';

/**
 * Collection: add/remove/sell/sort, the 100-card inventory, deck editing, card xp (game-design §2).
 */

/** Card inventory size ("Your cards n/100"); quest and PvP card rewards are sold automatically at or above it. */
export { COLLECTION_LIMIT };

/**
 * Level cap of a card at a stage (stats.capFor).
 * @param {object} deps
 * @param {object} def   card definition
 * @param {number} stage
 * @returns {number}
 */
export function capFor(deps, def, stage) {
  return deps.stats.capFor(def, stage);
}

/**
 * Add a card instance. At or over the inventory size the card is sold automatically (its sell value is paid
 * out, client autosell) unless `force` is set: boosters, fusion and completed pieces always add the card, so
 * the inventory can exceed the limit (the count then shows red).
 * @param {object} state
 * @param {object} deps
 * @param {string} cardId
 * @param {{stage?: number, level?: number, evolveQuality?: number, force?: boolean}} [opts]  `force` ignores the limit
 * @returns {{state: object, uid: string|null, converted: boolean, gold: number}}
 */
export function addCard(state, deps, cardId, opts = {}) {
  const def = deps.db.get(cardId);
  if (!def) throw new Error('Unknown card ' + cardId);
  const stage = Math.max(0, Math.min(4, opts.stage | 0));
  const level = Math.max(1, Math.min(capFor(deps, def, stage), opts.level | 0 || 1));
  if (!opts.force && state.cards.length >= COLLECTION_LIMIT) {
    const gold = deps.stats.sellValue(def, stage, level);
    return { state: addGold(state, gold), uid: null, converted: true, gold };
  }
  const r = nextUid(state);
  const inst = { uid: r.uid, cardId, stage, level, xp: 0, evolveQuality: opts.evolveQuality == null ? 1 : opts.evolveQuality };
  return { state: { ...r.state, cards: [...r.state.cards, inst] }, uid: r.uid, converted: false, gold: 0 };
}

/**
 * Card definitions of a rarity, optionally restricted to a set.
 * @param {object} db
 * @param {string} rarity
 * @param {string[]|null} [setIds]  restrict to these card ids
 * @returns {object[]}
 */
export function cardsOfRarity(db, rarity, setIds) {
  const all = (db.byRarity(rarity) || []).filter((d) => !d.trainer);
  if (!setIds) return all;
  return all.filter((d) => setIds.includes(d.id));
}

/**
 * Remove an instance (and clear it from the deck).
 * @param {object} state
 * @param {string} uid
 * @returns {object}
 */
export function removeCard(state, uid) {
  return {
    ...state,
    cards: state.cards.filter((c) => c.uid !== uid),
    deck: state.deck.map((d) => (d === uid ? null : d)),
  };
}

/**
 * @param {object} state
 * @param {string} uid
 * @returns {boolean}
 */
export function isInDeck(state, uid) {
  return state.deck.includes(uid);
}

/**
 * Gold a card would sell for.
 * @param {object} state
 * @param {object} deps
 * @param {string} uid
 * @returns {number}
 */
export function sellValueOf(state, deps, uid) {
  const c = getCard(state, uid);
  if (!c) return 0;
  return deps.stats.sellValue(deps.db.get(c.cardId), c.stage, c.level);
}

/**
 * Sell a card for gold. Cards in the active deck cannot be sold.
 * @param {object} state
 * @param {object} deps
 * @param {string} uid
 * @returns {{state: object, gold: number}}
 */
export function sellCard(state, deps, uid) {
  const c = getCard(state, uid);
  if (!c) throw new Error('No such card');
  if (isInDeck(state, uid)) throw new Error('Cards in the active deck cannot be sold');
  const gold = sellValueOf(state, deps, uid);
  return { state: addGold(removeCard(state, uid), gold), gold };
}

/**
 * Sort instances: default order is level desc, mana desc, name asc (game-design §2.3).
 * @param {object[]} cards   instances
 * @param {object} db
 * @param {'default'|'level'|'mana'|'name'|'rarity'|'attack'} [order]
 * @param {object} [stats]   needed for 'attack'
 * @returns {object[]} new array
 */
export function sortCards(cards, db, order = 'default', stats) {
  const def = (c) => db.get(c.cardId) || {};
  const byName = (a, b) => String(def(a).name || '').localeCompare(String(def(b).name || ''));
  const byLevel = (a, b) => b.level - a.level;
  const byMana = (a, b) => (def(b).mana || 0) - (def(a).mana || 0);
  const byRarity = (a, b) => RARITY_ORDER.indexOf(def(b).rarity) - RARITY_ORDER.indexOf(def(a).rarity);
  const byStage = (a, b) => b.stage - a.stage;
  const chain = (...fns) => (a, b) => { for (const f of fns) { const r = f(a, b); if (r) return r; } return 0; };
  const cmp = {
    default: chain(byLevel, byMana, byName),
    level: chain(byLevel, byStage, byMana, byName),
    mana: chain(byMana, byLevel, byName),
    name: chain(byName, byLevel),
    rarity: chain(byRarity, byMana, byLevel, byName),
    attack: stats
      ? chain((a, b) => stats.statAt(def(b), 'attack', b.stage, b.level, b.evolveQuality) - stats.statAt(def(a), 'attack', a.stage, a.level, a.evolveQuality), byName)
      : chain(byLevel, byName),
  }[order] || chain(byLevel, byMana, byName);
  return cards.slice().sort(cmp);
}

/**
 * The player's "best card": highest level, then highest mana.
 * @param {object} state
 * @param {object} deps
 * @returns {object|null} instance
 */
export function bestCard(state, deps) {
  if (!state.cards.length) return null;
  return sortCards(state.cards, deps.db, 'default')[0];
}

/**
 * Put a card in a deck slot (swapping if it already sits elsewhere). Validates the slot unlock and the
 * max-mana rule (deck mana sum must not exceed the player's max mana).
 * @param {object} state
 * @param {object} deps
 * @param {string} uid
 * @param {number} slot
 * @returns {{state: object, mana: number}}
 */
export function placeInDeck(state, deps, uid, slot) {
  if (!getCard(state, uid)) throw new Error('No such card');
  if (!slotUnlocked(state, slot)) throw new Error('Slot locked');
  const deck = state.deck.slice();
  const prev = deck.indexOf(uid);
  const displaced = deck[slot];
  deck[slot] = uid;
  if (prev >= 0) deck[prev] = displaced && displaced !== uid ? displaced : null;
  const next = { ...state, deck };
  const v = validateDeck(next, deps);
  if (!v.ok) throw new Error(v.reason);
  return { state: next, mana: v.mana };
}

/**
 * Empty a deck slot.
 * @param {object} state
 * @param {number} slot
 * @returns {object}
 */
export function removeFromDeck(state, slot) {
  const deck = state.deck.slice();
  deck[slot] = null;
  return { ...state, deck };
}

/**
 * Replace the whole deck (uids by slot) after validation.
 * @param {object} state
 * @param {object} deps
 * @param {Array<string|null>} slots
 * @returns {{state: object, mana: number}}
 */
export function setDeck(state, deps, slots) {
  const deck = [0, 1, 2, 3, 4].map((i) => slots[i] || null);
  for (let i = 0; i < 5; i++) {
    if (deck[i] && !getCard(state, deck[i])) throw new Error('No such card ' + deck[i]);
    if (deck[i] && !slotUnlocked(state, i)) throw new Error('Slot locked');
  }
  const next = { ...state, deck };
  const v = validateDeck(next, deps);
  if (!v.ok) throw new Error(v.reason);
  return { state: next, mana: v.mana };
}

/**
 * Check deck rules: no duplicate uid, every uid exists, mana sum <= max mana, at least one card.
 * @param {object} state
 * @param {object} deps
 * @returns {{ok: boolean, reason: string|null, mana: number, count: number}}
 */
export function validateDeck(state, deps) {
  const uids = state.deck.filter(Boolean);
  if (new Set(uids).size !== uids.length) return { ok: false, reason: 'Duplicate card in deck', mana: 0, count: uids.length };
  let mana = 0;
  for (const uid of uids) {
    const c = getCard(state, uid);
    if (!c) return { ok: false, reason: 'Missing card ' + uid, mana: 0, count: uids.length };
    mana += (deps.db.get(c.cardId) || {}).mana || 0;
  }
  if (mana > state.player.manaMax) return { ok: false, reason: 'Mana needed exceeds your maximum mana', mana, count: uids.length };
  if (uids.length === 0) return { ok: false, reason: 'The deck is empty', mana, count: 0 };
  return { ok: true, reason: null, mana, count: uids.length };
}

/**
 * Add xp to a card instance; levels up while the threshold is met, capped at the stage's level cap.
 * @param {object} state
 * @param {object} deps
 * @param {string} uid
 * @param {number} xp
 * @returns {{state: object, levelUps: Array<{uid: string, from: number, to: number}>, capped: boolean}}
 */
export function addCardXp(state, deps, uid, xp) {
  const c = getCard(state, uid);
  if (!c) return { state, levelUps: [], capped: false };
  const def = deps.db.get(c.cardId);
  const cap = capFor(deps, def, c.stage);
  if (c.level >= cap) return { state, levelUps: [], capped: true };
  let level = c.level;
  let pool = c.xp + Math.max(0, Math.round(xp));
  const from = level;
  while (level < cap) {
    const need = deps.stats.cardXpToNext(def, level, c.stage | 0);
    if (pool < need) break;
    pool -= need;
    level += 1;
  }
  if (level >= cap) pool = 0;
  const next = updateCard(state, uid, { level, xp: pool });
  return { state: next, levelUps: level > from ? [{ uid, from, to: level }] : [], capped: level >= cap };
}

/**
 * Give fight xp to every card in the deck.
 * @param {object} state
 * @param {object} deps
 * @param {number} xp
 * @returns {{state: object, levelUps: Array<{uid: string, from: number, to: number}>}}
 */
export function addDeckXp(state, deps, xp) {
  let s = state;
  const levelUps = [];
  for (const uid of state.deck) {
    if (!uid) continue;
    const r = addCardXp(s, deps, uid, xp);
    s = r.state;
    levelUps.push(...r.levelUps);
  }
  return { state: s, levelUps };
}
