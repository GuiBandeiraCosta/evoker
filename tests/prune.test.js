'use strict';
/** state.js pruneRemoved: saves that still hold cards or portals removed from the data (the Dungeon Casino, 2026-10-10). */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pruneRemoved } from '../src/game/state.js';
import { realDeps, fresh, give } from './fixtures/real.js';

const deps = realDeps();

describe('pruneRemoved', () => {
  test('a save without unknown references is returned as is', () => {
    const [s] = give(fresh(), deps, 'envoy');
    assert.equal(pruneRemoved(s, deps), s);
  });

  test('unknown cards leave the collection and the deck; unknown portal state and set claims go', () => {
    let [s, envoy] = give(fresh(), deps, 'envoy');
    s = { ...s, cards: [...s.cards, { uid: 'c999', cardId: 'wheel-of-fortune', stage: 0, level: 1, xp: 0, evolveQuality: 1 }],
      deck: ['c999', envoy, null, null, null],
      quests: { ...s.quests, portals: { ...s.quests.portals, 'dungeon-casino': { unlocked: 3, done: 2, firstWins: [] }, 'the-dark-beyond': { unlocked: 1, done: 0, firstWins: [] } }, active: { line: 'dungeon-casino', n: 3 }, manualPortal: 'dungeon-casino' },
      collections: { claimed: ['dungeon-casino', 'the-dark-beyond'], seen: ['wheel-of-fortune', 'envoy'] } };
    const out = pruneRemoved(s, deps);
    assert.notEqual(out, s);
    assert.ok(out.cards.every((c) => c.cardId !== 'wheel-of-fortune'));
    assert.deepEqual(out.deck, [null, envoy, null, null, null]);
    assert.deepEqual(Object.keys(out.quests.portals), ['the-dark-beyond']);
    assert.equal(out.quests.active, null);
    assert.equal(out.quests.manualPortal, null);
    assert.deepEqual(out.collections, { claimed: ['the-dark-beyond'], seen: ['envoy'] });
  });
});
