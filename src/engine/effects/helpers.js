'use strict';

/**
 * Engine-internal helpers shared by the handlers and the round loop: slot/direction geometry of the
 * original simulator, the UI-log emitters and the per-card view helpers.
 *
 * Slot numbering (original-engine.md §1-2): each player's cards are indexed 1..5 from the player's OWN
 * left; `front` of slot i is the opponent's slot 6 - i. Our public event log keeps the UI convention:
 * 0-based slots where defender slot k faces attacker slot k (the rows are drawn mirrored), so
 *   player 1 (attacker): ui slot = id - 1
 *   player 2 (defender): ui slot = 5 - id
 */

import { SLOT_COUNT } from '../battle-state.js';

/** Player id -> event log side key. */
export const SIDE_OF = [null, 'attacker', 'defender'];

/**
 * @param {number} playerId
 * @returns {number} the other player's id
 */
export function otherId(playerId) {
  return playerId === 1 ? 2 : 1;
}

/**
 * UI (0-based, facing) slot of an internal card.
 * @param {{playerId: number, id: number}} card
 * @returns {number}
 */
export function uiSlot(card) {
  return card.playerId === 1 ? card.id - 1 : SLOT_COUNT - card.id;
}

/**
 * Internal 1-based slot id of a UI slot for a player.
 * @param {number} playerId
 * @param {number} slot  0-based UI slot
 * @returns {number}
 */
export function internalSlot(playerId, slot) {
  return playerId === 1 ? slot + 1 : SLOT_COUNT - slot;
}

/**
 * Event-log reference of a card.
 * @param {{playerId: number, id: number}} card
 * @returns {{side: string, slot: number}}
 */
export function ref(card) {
  return { side: SIDE_OF[card.playerId], slot: uiSlot(card) };
}

/**
 * Event-log reference of a player.
 * @param {{id: number}} player
 * @returns {{side: string, slot: null}}
 */
export function playerRef(player) {
  return { side: SIDE_OF[player.id], slot: null };
}

/**
 * Source tag of an event (the card whose buff caused it).
 * @param {{playerId: number, id: number}} card
 * @param {string} effect
 * @returns {{side: string, slot: number, effect: string}}
 */
export function source(card, effect) {
  return { ...ref(card), effect };
}

/** Health shown to the UI: current health capped at the max. */
export function shownHp(card) {
  return Math.min(card.hp, card.hp - card.takenDamage);
}

/** Current health of a player (`hp - takenDamage`, may be negative). */
export function playerHp(player) {
  return player.hp - (player.takenDamage || 0);
}

/**
 * Is a handler target a card (vs. nil / a direction string for an empty slot)?
 * @param {any} t
 * @returns {boolean}
 */
export function isCard(t) {
  return t !== null && typeof t === 'object';
}

/**
 * `target(slot i, direction, own, opp)` of the original simulator (original-engine.md §2).
 * @param {number} i  1-based slot of the acting card
 * @param {string} direction  original name
 * @param {Array<object|null>} own  own cards, 1-based (index 0 unused)
 * @param {Array<object|null>} opp  opponent cards, 1-based
 * @returns {object|null|'none'}  the card, null for an empty slot, 'none' when off the board
 */
export function target(i, direction, own, opp) {
  switch (direction) {
    case 'left': return i - 1 < 1 ? 'none' : own[i - 1];
    case 'right': return i + 1 > SLOT_COUNT ? 'none' : own[i + 1];
    case 'front': return opp[SLOT_COUNT + 1 - i];
    case 'frontLeft': return i - 1 < 1 ? 'none' : opp[SLOT_COUNT + 1 - (i - 1)];
    case 'frontRight': return i + 1 > SLOT_COUNT ? 'none' : opp[SLOT_COUNT + 1 - (i + 1)];
    case 'self': return own[i];
    default: return 'none';
  }
}

/**
 * Append an event to the UI log.
 * @param {{events: object[]}} S
 * @param {object} ev
 * @returns {object} the event
 */
export function emit(S, ev) {
  S.events.push(ev);
  return ev;
}

/**
 * Public snapshot of an internal card (battleStart / death events).
 * @param {object} card
 * @returns {object}
 */
export function cardSnapshot(card) {
  return { ...card.pub, attack: card.attack, hp: shownHp(card), maxHp: card.hp };
}

/**
 * Emit a card status event (suspended / dazed / stunned / indestructible).
 * @param {object} S
 * @param {object} targetCard
 * @param {string} status
 * @param {object} fromCard
 * @param {string} effect
 */
export function emitStatus(S, targetCard, status, fromCard, effect) {
  emit(S, { t: 'status', ...ref(targetCard), status, on: true, source: source(fromCard, effect) });
}

/**
 * Emit a damage event for a card.
 * @param {object} S
 * @param {object} card
 * @param {number} amount
 * @param {string} cause
 * @param {object|null} fromCard
 * @param {string} effect
 * @param {boolean} [blocked=false]
 */
export function emitCardDamage(S, card, amount, cause, fromCard, effect, blocked = false) {
  emit(S, { t: 'damage', ...ref(card), amount, hp: shownHp(card), cause, blocked, source: fromCard ? source(fromCard, effect) : null });
}

/**
 * Emit a damage event for a player.
 * @param {object} S
 * @param {object} player
 * @param {number} amount
 * @param {string} cause
 * @param {object|null} fromCard
 * @param {string} effect
 */
export function emitPlayerDamage(S, player, amount, cause, fromCard, effect) {
  emit(S, { t: 'damage', ...playerRef(player), amount, hp: playerHp(player), cause, blocked: false, source: fromCard ? source(fromCard, effect) : null });
}

/**
 * Emit a heal event for a card or (slot null) a player.
 * @param {object} S
 * @param {{side: string, slot: number|null}} where
 * @param {number} amount
 * @param {number} hp
 * @param {object|null} fromCard
 * @param {string} effect
 */
export function emitHeal(S, where, amount, hp, fromCard, effect) {
  emit(S, { t: 'heal', ...where, amount, hp, source: fromCard ? source(fromCard, effect) : null });
}

/**
 * Emit a buff event.
 * @param {object} S
 * @param {{side: string, slot: number|null}} where
 * @param {'attack'|'maxHp'} stat
 * @param {number} delta
 * @param {boolean} permanent
 * @param {object|null} fromCard
 * @param {string} effect
 */
export function emitBuff(S, where, stat, delta, permanent, fromCard, effect) {
  emit(S, { t: 'buff', ...where, stat, delta, permanent, source: fromCard ? source(fromCard, effect) : null });
}

/**
 * Bring the UI's idea of a card's max hp in line with the engine (emits a maxHp buff for the difference).
 * The original re-applies `raise_hp` every round after resetting hp; the UI only sees the net changes.
 * @param {object} S
 * @param {object} card
 * @param {object|null} fromCard
 * @param {string} effect
 */
export function syncCardMaxHp(S, card, fromCard, effect) {
  const delta = card.hp - card.uiMaxHp;
  if (delta === 0) return;
  card.uiMaxHp = card.hp;
  emitBuff(S, ref(card), 'maxHp', delta, false, fromCard, effect);
}

/**
 * Same as syncCardMaxHp for a player's max hp.
 * @param {object} S
 * @param {object} player
 * @param {object|null} fromCard
 * @param {string} effect
 */
export function syncPlayerMaxHp(S, player, fromCard, effect) {
  const delta = player.hp - player.uiMaxHp;
  if (delta === 0) return;
  player.uiMaxHp = player.hp;
  emitBuff(S, playerRef(player), 'maxHp', delta, false, fromCard, effect);
}

/**
 * Mark a card dead (die phase / kill): sets `died`, pushes the `onDeath` event, logs the death.
 * @param {object} S
 * @param {object} card
 * @param {object[]} out  engine events out
 */
export function markDead(S, card, out) {
  card.died = true;
  out.push({ type: 'onDeath', from: card, to: card });
  S.deaths[SIDE_OF[card.playerId]]++;
  emit(S, { t: 'death', ...ref(card), card: cardSnapshot(card) });
}

/**
 * Living cards (not died) of a player in slot order.
 * @param {object} S
 * @param {number} playerId
 * @returns {object[]}
 */
export function livingCards(S, playerId) {
  const out = [];
  for (let i = 1; i <= SLOT_COUNT; i++) {
    const c = S.cards[playerId][i];
    if (c && !c.died) out.push(c);
  }
  return out;
}
