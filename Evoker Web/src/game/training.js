'use strict';

import { getCard } from './state.js';
import { spendGold } from './player.js';
import { isInDeck, removeCard, addCardXp, capFor } from './collection.js';
import { MAX_SACRIFICE_CARDS, TRAINER_XP } from '../core/constants.js';

/**
 * Card training by sacrifice (game-design §2.4). The trained card gains the sacrificed cards' xp (it levels up
 * only as far as the xp reaches); the gold price is the client's enhance price of the sacrifice stack.
 */

/** Most cards sacrificed in one training. */
export const MAX_SACRIFICES = MAX_SACRIFICE_CARDS;
/** Trainer cards give a fixed xp. */
export { TRAINER_XP };

/**
 * XP one sacrificed instance gives.
 * @param {object} deps
 * @param {{cardId: string, stage: number, level: number}} inst
 * @returns {number}
 */
export function sacrificeValue(deps, inst) {
  if (TRAINER_XP[inst.cardId]) return TRAINER_XP[inst.cardId];
  const def = deps.db.get(inst.cardId);
  if (!def) return 0;
  return Math.round(deps.stats.sacrificeXp(def, inst.stage, inst.level));
}

/**
 * Gold price of sacrificing one instance (client getEnhancePrice, see stats.enhancePrice): it depends on the
 * sacrificed card's mana, level and rarity, not on the trained card.
 * @param {object} deps
 * @param {{cardId: string, level: number}} inst
 * @returns {number}
 */
export function sacrificePrice(deps, inst) {
  const def = deps.db.get(inst.cardId);
  return def ? deps.stats.enhancePrice(def, inst.level) : 0;
}

/**
 * Gold cost of a training session: the sum of the sacrificed cards' prices.
 * @param {object} deps
 * @param {Array<{cardId: string, level: number}>} insts  the sacrifice stack
 * @returns {number}
 */
export function trainingCost(deps, insts) {
  return (insts || []).reduce((sum, inst) => sum + sacrificePrice(deps, inst), 0);
}

/**
 * Validate and price a training session without applying it.
 * @param {object} state
 * @param {object} deps
 * @param {string} trainUid
 * @param {string[]} sacrificeUids
 * @param {{allowDeck?: boolean}} [opts]  allowDeck: deck cards may be sacrificed (the client's training screen
 *        offers them with an "in your deck" warning; they leave the deck)
 * @returns {{ok: boolean, reason: string|null, xp: number, gold: number, levelFrom: number, levelTo: number, cap: number}}
 */
export function previewTraining(state, deps, trainUid, sacrificeUids, opts = {}) {
  const bad = (reason) => ({ ok: false, reason, xp: 0, gold: 0, levelFrom: 0, levelTo: 0, cap: 0 });
  const target = getCard(state, trainUid);
  if (!target) return bad('Pick a card to train');
  const def = deps.db.get(target.cardId);
  const cap = capFor(deps, def, target.stage);
  if (!sacrificeUids || sacrificeUids.length === 0) return bad('Pick cards to sacrifice');
  if (sacrificeUids.length > MAX_SACRIFICES) return bad('At most ' + MAX_SACRIFICES + ' cards can be sacrificed at once');
  if (new Set(sacrificeUids).size !== sacrificeUids.length) return bad('Duplicate sacrifice');
  if (target.level >= cap) return bad('This card is already at its level cap');
  let xp = 0;
  const stack = [];
  for (const uid of sacrificeUids) {
    if (uid === trainUid) return bad('A card cannot be sacrificed to itself');
    const c = getCard(state, uid);
    if (!c) return bad('No such card ' + uid);
    if (!opts.allowDeck && isInDeck(state, uid)) return bad('Cards in the active deck cannot be sacrificed');
    xp += sacrificeValue(deps, c);
    stack.push(c);
  }
  const gold = trainingCost(deps, stack);
  if (state.player.gold < gold) return { ok: false, reason: 'Not enough gold', xp, gold, levelFrom: target.level, levelTo: target.level, cap };
  const sim = addCardXp(state, deps, trainUid, xp);
  const after = getCard(sim.state, trainUid);
  return { ok: true, reason: null, xp, gold, levelFrom: target.level, levelTo: after.level, cap };
}

/**
 * Apply a training session: removes the sacrificed cards, pays gold, adds xp to the trained card.
 * @param {object} state
 * @param {object} deps
 * @param {string} trainUid
 * @param {string[]} sacrificeUids
 * @param {{allowDeck?: boolean}} [opts]  see previewTraining
 * @returns {{state: object, xp: number, gold: number, levelUps: Array<{uid: string, from: number, to: number}>}}
 */
export function train(state, deps, trainUid, sacrificeUids, opts = {}) {
  const pv = previewTraining(state, deps, trainUid, sacrificeUids, opts);
  if (!pv.ok) throw new Error(pv.reason);
  let s = spendGold(state, pv.gold);
  for (const uid of sacrificeUids) s = removeCard(s, uid);
  const r = addCardXp(s, deps, trainUid, pv.xp);
  return { state: r.state, xp: pv.xp, gold: pv.gold, levelUps: r.levelUps };
}
