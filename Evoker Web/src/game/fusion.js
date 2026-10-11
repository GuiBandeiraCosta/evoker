'use strict';

import { getCard } from './state.js';
import { spendGold } from './player.js';
import { isInDeck, removeCard, addCard, capFor } from './collection.js';
import { MAX_STAGE } from '../core/constants.js';

/**
 * Fusion (game-design §2.5): two instances of the same card at the same stage (< 4) → stage + 1, level 1,
 * with the Evolve Bonus `q` (stats.evolveQuality, 1 since round 5) stored on the result.
 */

export { MAX_STAGE };

/**
 * Validate and price a fusion.
 * @param {object} state
 * @param {object} deps
 * @param {string} uidA
 * @param {string} uidB
 * @param {{allowDeck?: boolean}} [opts]  allowDeck: deck cards may be fused (client ctrl_evolve: the result takes
 *        the deck slot of the fused card)
 * @returns {{ok: boolean, reason: string|null, cost: number, quality: number, warning: string|null, stage: number}}
 */
export function canFuse(state, deps, uidA, uidB, opts = {}) {
  const bad = (reason) => ({ ok: false, reason, cost: 0, quality: 0, warning: null, stage: 0 });
  if (!uidA || !uidB || uidA === uidB) return bad('Pick two different cards');
  const a = getCard(state, uidA), b = getCard(state, uidB);
  if (!a || !b) return bad('No such card');
  if (a.cardId !== b.cardId) return bad('Only two identical cards can be fused');
  if (a.stage !== b.stage) return bad('Both cards must be at the same fusion stage');
  if (a.stage >= MAX_STAGE) return bad('This card is already at the maximum fusion stage');
  const def = deps.db.get(a.cardId);
  const cost = deps.stats.fusionCost(def.rarity, a.stage);
  const capA = capFor(deps, def, a.stage), capB = capFor(deps, def, b.stage);
  const quality = deps.stats.evolveQuality(a.level, capA, b.level, capB);
  // never set while EVOLVE_BONUS keeps q at 1 (round 5: the client shows no such warning); kept for a bonus with a span
  const warning = quality < 1 && (a.level < capA || b.level < capB) ? 'A card below its level cap gives a weaker result' : null;
  if (!opts.allowDeck && (isInDeck(state, uidA) || isInDeck(state, uidB))) return { ok: false, reason: 'Cards in the active deck cannot be fused', cost, quality, warning, stage: a.stage + 1 };
  if (state.player.gold < cost) return { ok: false, reason: 'Not enough gold', cost, quality, warning, stage: a.stage + 1 };
  return { ok: true, reason: null, cost, quality, warning, stage: a.stage + 1 };
}

/**
 * Fuse two cards. The two inputs are consumed and a new instance is created at stage + 1, level 1.
 * With `allowDeck`, a fused deck card hands its slot to the result (A's slot first, like the client's
 * getPositionOfCard loop).
 * @param {object} state
 * @param {object} deps
 * @param {string} uidA
 * @param {string} uidB
 * @param {{allowDeck?: boolean}} [opts]
 * @returns {{state: object, uid: string, quality: number, cost: number, stage: number, slot: number}}  slot = deck slot of the result (-1 = none)
 */
export function fuse(state, deps, uidA, uidB, opts = {}) {
  const v = canFuse(state, deps, uidA, uidB, opts);
  if (!v.ok) throw new Error(v.reason);
  const a = getCard(state, uidA);
  const slotA = state.deck.indexOf(uidA), slotB = state.deck.indexOf(uidB);
  const slot = slotA >= 0 ? slotA : slotB;
  let s = spendGold(state, v.cost);
  s = removeCard(removeCard(s, uidA), uidB);
  const r = addCard(s, deps, a.cardId, { stage: v.stage, level: 1, evolveQuality: v.quality, force: true });
  let next = r.state;
  if (slot >= 0) {
    const deck = next.deck.slice();
    deck[slot] = r.uid;
    next = { ...next, deck };
  }
  return { state: next, uid: r.uid, quality: v.quality, cost: v.cost, stage: v.stage, slot };
}

/**
 * Pairs of instances in the collection that could be fused (for the Fusion tab).
 * @param {object} state
 * @param {object} deps
 * @returns {Array<{cardId: string, stage: number, uids: string[]}>}
 */
export function fusionCandidates(state, deps) {
  const groups = new Map();
  for (const c of state.cards) {
    if (c.stage >= MAX_STAGE || isInDeck(state, c.uid)) continue;
    const key = c.cardId + '#' + c.stage;
    if (!groups.has(key)) groups.set(key, { cardId: c.cardId, stage: c.stage, uids: [] });
    groups.get(key).uids.push(c.uid);
  }
  return [...groups.values()].filter((g) => g.uids.length >= 2 && deps.db.get(g.cardId));
}
