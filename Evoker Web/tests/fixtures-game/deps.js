'use strict';

import { mulberry32 } from '../../src/core/rng.js';
import { makeDb } from './cards.js';
import * as stats from './stats.js';
import { makeEngine } from './engine.js';
import { FIXTURE_QUESTS } from './quests.js';

export const FIXTURE_NAMES = {
  names: ['Aelric', 'Morwen', 'Thrainor', 'Sylvara', 'Grukk', 'Elowen', 'Baldrik', 'Nyssa', 'Korgath', 'Isolde', 'Fenwick', 'Ravenna'],
  avatars: ['arch-angel', 'dwarf-king', 'imperial-dragon', 'guruk-the-destroyer', 'phoenix', 'armorer', 'basilisk', 'rat-eater', 'scout', 'envoy', 'pikeman', 'club-swinger'],
};

/**
 * Bundle every dependency the game modules need.
 * @param {{winner?: string|Function}} [opts]
 * @returns {object} deps
 */
export function makeDeps(opts = {}) {
  return { db: makeDb(), stats, engine: makeEngine({ winner: opts.winner }), rng: mulberry32, quests: FIXTURE_QUESTS, names: FIXTURE_NAMES };
}
