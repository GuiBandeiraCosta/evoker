'use strict';

import { defaultState, nextUid, updatePlayer } from '../../src/game/state.js';

/**
 * The pre-round-3 starting save (6 starter cards, Bone Breaker / Scout / Master Brewer in slots 1–3, 300 gold,
 * 2 stamina + 1 mana potions, 3 open deck slots). Mechanics tests start from it so they do not depend on the
 * tutorial start of `newGame` (Envoy + Master Brewer, 200 gold, no potions; DECISIONS D1), which has its own tests.
 * @param {string} name
 * @param {number} seed
 * @param {number} now
 * @returns {object} state
 */
export function classicGame(name, seed, now) {
  let state = defaultState(now, seed);
  state = updatePlayer(state, { name, gold: 300, staminaPotions: 2, manaPotions: 1, deckSlots: 3 });
  const ids = ['envoy', 'pikeman', 'pouch-tearer', 'bone-breaker', 'scout', 'master-brewer'];
  const cards = [];
  const uid = {};
  for (const cardId of ids) {
    const r = nextUid(state);
    state = r.state;
    cards.push({ uid: r.uid, cardId, stage: 0, level: 1, xp: 0, evolveQuality: 1 });
    uid[cardId] = r.uid;
  }
  return { ...state, cards, deck: [null, uid['bone-breaker'], uid.scout, uid['master-brewer'], null] };
}
