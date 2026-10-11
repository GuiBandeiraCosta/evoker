'use strict';

import { addCard } from '../../src/game/collection.js';
import { makeDeps } from './deps.js';
import { classicGame } from './classic.js';
import { T0 } from '../fixtures/real.js';

/**
 * Save builders of the mechanics tests on the fixture catalog (the `(fixture catalog)` sections of the game-*,
 * league, shop and data tests). Unlike tests/fixtures/real.js nothing here is frozen.
 */

/** Mechanics tests start from the classic 6-card save; `newGame` (the tutorial start) is tested on its own. */
export function fresh(opts = {}) {
  const deps = makeDeps(opts);
  const state = classicGame('Tester', 4242, T0);
  return { deps, state };
}

/** Give the player resources and a level so PvP / portals can be tested. */
export function rich(state, extra = {}) {
  return { ...state, player: { ...state.player, level: 10, gold: 100000, gems: 5000, mana: 200, manaMax: 200, stamina: 500, staminaMax: 500, ...extra } };
}

/** Add a card and return [state, uid]. */
export function give(state, deps, cardId, opts) {
  const r = addCard(state, deps, cardId, opts);
  return [r.state, r.uid];
}
