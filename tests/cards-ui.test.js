'use strict';
/**
 * Unit tests for the pure helpers behind the Cards screen (src/ui/screens/cards-helpers.js, the client's deck
 * screen with deck edit / training / fusion modes): mode ids, the card slider's arc and order, deck summary,
 * training stack rules and warnings, fusion slots and partners, set collection paging; plus the allowDeck
 * options of the training / fusion game logic. Uses the fixture catalog and game deps from tests/fixtures-game.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeDeps } from './fixtures-game/deps.js';
import { getCard } from '../src/game/state.js';
import { classicGame } from './fixtures-game/classic.js';
import { addCard } from '../src/game/collection.js';
import { sacrificeValue, trainingCost, train, previewTraining, MAX_SACRIFICES } from '../src/game/training.js';
import { fuse, canFuse } from '../src/game/fusion.js';
import {
  MODES, MODE_TITLES, normalizeMode, SLIDER, sliderPose, sliderLimits, offsetFor, compareSlider, sliderEntries,
  fusableUids, fuseCount, fusionPartners, deckSummary, manaAfterPlace, manaNeededText, poolCountText,
  STACK_FULL_TEXT, sacrificeEligible, pushSacrifice, sacrificeWarnings, sacrificeWarningText, trainingMissingText,
  trainingSummary, pruneTrainingSelection, FUSE_MISMATCH_TEXT, pruneFusionSlots, fitsFusionSlot, fusionCheck,
  collectionPageIndex, collectionProgressText, bestOwnedInstance, pieceHuntFor,
} from '../src/ui/screens/cards-helpers.js';
import { PIECE_LAYOUTS, PIECE_CANVAS, pieceSet, litPieces, rarityLabel, cardNameWithPlus } from '../src/ui/components/card.js';
import { spriteUrl } from '../src/ui/dom.js';
import { defView, healDirsFor, buffDirsFor, effectDirs } from '../src/ui/card-view.js';
import { T0 } from './fixtures/real.js';


function fresh() {
  const deps = makeDeps();
  const state = classicGame('Tester', 99, T0);
  return { deps, state };
}

/** Add a card and return [state, uid]. */
function give(state, deps, cardId, opts = {}) {
  const r = addCard(state, deps, cardId, { force: true, ...opts });
  return [r.state, r.uid];
}

function uidOf(state, cardId) {
  return state.cards.find((c) => c.cardId === cardId).uid;
}

test('modes and their client titles', () => {
  assert.deepEqual(MODES, ['training', 'deck', 'fusion']);
  assert.equal(normalizeMode('training'), 'training');
  assert.equal(normalizeMode('fusion'), 'fusion');
  assert.equal(normalizeMode('deck'), 'deck');
  assert.equal(normalizeMode('cards'), 'deck', 'the old collection tab is the deck mode');
  assert.equal(normalizeMode(undefined), 'deck');
  assert.deepEqual(MODE_TITLES, { deck: 'Your Deck', training: 'Card Training', fusion: 'Fuse cards' });
});

test('slider arc: the front card is largest, the row starts at its left end', () => {
  const front = sliderPose(0);
  assert.equal(front.x, 0);
  assert.ok(Math.abs(front.scale - 0.9 * 1.15 * SLIDER.CARD_SCALE) < 1e-9);
  assert.ok(Math.abs(front.y - ((-50 * (1 - 1.8) - 55) * 1.15 + 9) * 2.25) < 1e-9, 'client y formula');
  const right = sliderPose(SLIDER.STEP), left = sliderPose(-SLIDER.STEP);
  assert.ok(right.x > 0 && left.x < 0 && Math.abs(right.x + left.x) < 1e-9, 'symmetric');
  assert.ok(right.scale < front.scale && right.z < front.z, 'side cards smaller and behind');
  assert.ok(right.y < front.y, 'side cards sit higher (client arc)');
  assert.equal(sliderPose(80).visible, false, 'far cards are hidden');
  assert.equal(sliderPose(SLIDER.START).visible, true, 'the first card is visible at the start');
  assert.ok(sliderPose(SLIDER.START).x > 300, 'and stands at the right edge');
  const lim = sliderLimits(10);
  assert.equal(lim.max, SLIDER.START);
  assert.equal(lim.min, -SLIDER.START - 9 * SLIDER.STEP);
  assert.deepEqual(sliderLimits(0), { min: -SLIDER.START, max: SLIDER.START });
  assert.equal(offsetFor(3), -3 * SLIDER.STEP);
});

test('compareSlider sorts like cardmanager.sortCardList: mana, race (Zwerge > Orks > Neutral > Elfen), stage', () => {
  const c = (mana, tribe, stage = 0, level = 1, name = 'A') => ({ mana, tribe, stage, level, name });
  assert.ok(compareSlider(c(5, 'elf'), c(3, 'dwarf')) < 0, 'higher mana first');
  const races = ['elf', 'neutral', 'orc', 'dwarf'].map((t) => c(4, t)).sort(compareSlider).map((x) => x.tribe);
  assert.deepEqual(races, ['dwarf', 'orc', 'neutral', 'elf']);
  assert.ok(compareSlider(c(4, 'orc', 2), c(4, 'orc', 0)) < 0, 'fused first');
  assert.ok(compareSlider(c(4, 'orc', 0, 7), c(4, 'orc', 0, 2)) < 0, 'tie-break: level desc');
  assert.ok(compareSlider(c(4, 'orc', 0, 2, 'Axe'), c(4, 'orc', 0, 2, 'Bow')) < 0, 'tie-break: name asc');
});

test('sliderEntries per mode: deck = not in the deck + pieces, training = all, fusion = pairs / partners', () => {
  let { deps, state } = fresh();
  const name = (e) => (e.kind === 'piece' ? `piece:${e.cardId}` : e.inst.cardId);
  assert.deepEqual(sliderEntries(state, deps, 'deck').map(name), ['pikeman', 'pouch-tearer', 'envoy']);
  assert.deepEqual(sliderEntries(state, deps, 'training').map(name), ['bone-breaker', 'scout', 'master-brewer', 'pikeman', 'pouch-tearer', 'envoy']);
  const pikeman = uidOf(state, 'pikeman'), envoy = uidOf(state, 'envoy');
  assert.deepEqual(sliderEntries(state, deps, 'training', { trainUid: pikeman, sacrifices: [envoy] }).map(name),
    ['bone-breaker', 'scout', 'master-brewer', 'pouch-tearer'], 'slot and stack cards leave the slider');
  assert.deepEqual(sliderEntries(state, deps, 'fusion'), [], 'no pairs in the starter set');

  // a running piece hunt shows as an incomplete card (not in fusion)
  state = { ...state, pieces: [{ cardId: 'rat-eater', owned: 1, total: 4, holderId: null, raidDay: 0 }] };
  assert.equal(name(sliderEntries(state, deps, 'deck')[0]), 'piece:rat-eater', 'mana 11 sorts first');
  assert.ok(sliderEntries(state, deps, 'training').some((e) => e.kind === 'piece'));
  assert.ok(!sliderEntries(state, deps, 'fusion').some((e) => e.kind === 'piece'));

  let a1, a2, a3;
  [state, a1] = give(state, deps, 'arch-angel', { level: 3 });
  [state, a2] = give(state, deps, 'arch-angel', { level: 9 });
  [state, a3] = give(state, deps, 'arch-angel', { stage: 1 });
  let p1;
  [state, p1] = give(state, deps, 'pikeman');
  assert.deepEqual(sliderEntries(state, deps, 'fusion').map((e) => e.uid).sort(), [a1, a2, pikeman, p1].sort());
  assert.deepEqual(sliderEntries(state, deps, 'fusion', { fuse: [a2, null] }).map((e) => e.uid), [a1], 'partners only');
  assert.deepEqual(fusionPartners(state, [null, p1]), [pikeman]);
  assert.ok(!fusableUids(state, deps).includes(a3), 'a single fused copy has no partner');
});

test('fuseCount counts possible fusions like getFuseCount (deck cards included)', () => {
  let { deps, state } = fresh();
  assert.equal(fuseCount(state, deps), 0);
  [state] = give(state, deps, 'bone-breaker');
  assert.equal(fuseCount(state, deps), 1, 'the deck copy counts');
  [state] = give(state, deps, 'bone-breaker');
  assert.equal(fuseCount(state, deps), 1, 'three copies = one fusion');
  [state] = give(state, deps, 'bone-breaker');
  assert.equal(fuseCount(state, deps), 2);
  [state] = give(state, deps, 'scout', { stage: 4 });
  [state] = give(state, deps, 'scout', { stage: 4 });
  assert.equal(fuseCount(state, deps), 2, 'max stage cards cannot fuse');
});

test('deckSummary: mana needed vs max, current mana, pool count', () => {
  let { deps, state } = fresh();
  let sum = deckSummary(state, deps);
  assert.equal(sum.mana, 4 + 4 + 3);
  assert.equal(sum.manaMax, 50);
  assert.equal(sum.manaNow, 50);
  assert.equal(sum.manaShort, false);
  assert.equal(sum.count, 3);
  assert.deepEqual(sum.unlocked, [false, true, true, true, false]);
  assert.equal(sum.poolCount, 6);
  assert.equal(sum.poolLimit, 100);
  assert.equal(sum.poolFull, false);
  assert.equal(manaNeededText(sum.mana, sum.manaMax), 'Mana needed: 11 / 50');
  assert.equal(poolCountText(22, 80), '22/80');

  sum = deckSummary({ ...state, player: { ...state.player, mana: 10 } }, deps);
  assert.equal(sum.manaShort, true, 'red when the current mana is below the need');

  // slots open by quest progress (round 3), not by level
  sum = deckSummary({ ...state, player: { ...state.player, level: 1, deckSlots: 5 } }, deps);
  assert.deepEqual(sum.unlocked, [true, true, true, true, true]);
  sum = deckSummary({ ...state, player: { ...state.player, level: 30, deckSlots: 2 } }, deps);
  assert.deepEqual(sum.unlocked, [false, true, true, false, false], 'a high level alone opens nothing');

  // manaAfterPlace mirrors placeInDeck (swap, replace)
  let rat;
  [state, rat] = give(state, deps, 'rat-eater');
  assert.equal(manaAfterPlace(state, deps, rat, 0), 11 + 11);
  assert.equal(manaAfterPlace(state, deps, rat, 1), 11 - 4 + 11, 'replaces Bone Breaker');
  assert.equal(manaAfterPlace(state, deps, uidOf(state, 'scout'), 1), 11, 'a swap keeps the sum');
});

test('training stack rules: deck cards allowed, nine at most, not the training card', () => {
  let { deps, state } = fresh();
  const pikeman = uidOf(state, 'pikeman');
  const envoy = uidOf(state, 'envoy');
  const scout = uidOf(state, 'scout'); // in the starter deck
  assert.equal(sacrificeEligible(state, envoy, pikeman, []).ok, true);
  assert.equal(sacrificeEligible(state, pikeman, pikeman, []).ok, false);
  assert.equal(sacrificeEligible(state, scout, pikeman, []).ok, true, 'deck cards may be sacrificed (with a warning)');
  assert.equal(sacrificeEligible(state, 'nope', pikeman, []).ok, false);

  let stack = [];
  for (let i = 0; i < MAX_SACRIFICES; i++) {
    let uid;
    [state, uid] = give(state, deps, 'pouch-tearer');
    stack = pushSacrifice(stack, uid);
  }
  assert.equal(stack.length, MAX_SACRIFICES);
  const [s2, extra] = give(state, deps, 'pouch-tearer');
  state = s2;
  assert.equal(sacrificeEligible(state, extra, pikeman, stack).reason, STACK_FULL_TEXT);
  assert.equal(STACK_FULL_TEXT, 'You\'re not allowed to sacrifice more than 9 cards at once.');
  assert.equal(pushSacrifice(stack, extra).length, MAX_SACRIFICES, 'tenth card is refused');
  assert.equal(pushSacrifice(stack, stack[0]).length, MAX_SACRIFICES, 'no duplicates');
  assert.equal(sacrificeEligible(state, stack[1], pikeman, stack).ok, true, 'a card already on the stack stays eligible');
});

test('sacrifice warnings and the client messages', () => {
  let { deps, state } = fresh();
  const envoy = uidOf(state, 'envoy'), scout = uidOf(state, 'scout');
  assert.deepEqual(sacrificeWarnings(state, deps, [envoy]), []);
  assert.deepEqual(sacrificeWarnings(state, deps, [scout]), ['in your deck']);
  let rat, fused;
  [state, rat] = give(state, deps, 'rat-eater');
  [state, fused] = give(state, deps, 'pikeman', { stage: 1 });
  assert.deepEqual(sacrificeWarnings(state, deps, [rat, scout, fused]), ['valuable', 'in your deck', 'fused']);
  assert.equal(sacrificeWarningText(['valuable'], 1), 'Your sacrifice stack contains a card that is:\n-valuable');
  assert.equal(sacrificeWarningText(['valuable', 'fused'], 3), 'Your sacrifice stack contains cards that are:\n-valuable\n-fused');
  assert.equal(trainingMissingText(null, []), 'Add one card to the Training slot and at least one card to the Sacrifice slot.');
  assert.equal(trainingMissingText(null, [envoy]), 'Please add one card to the Training slot to do this.');
  assert.equal(trainingMissingText(scout, []), 'Add at least one card to the sacrifice stack to do this.');
  assert.equal(trainingMissingText(scout, [envoy]), null);
});

test('trainingSummary prices the stack and tolerates an incomplete selection', () => {
  const { deps, state } = fresh();
  const pikeman = uidOf(state, 'pikeman');
  const envoy = uidOf(state, 'envoy');
  const scout = uidOf(state, 'scout');
  const none = trainingSummary(state, deps, null, []);
  assert.equal(none.ok, false);
  assert.equal(none.xp, 0);
  assert.equal(none.gold, 0);
  assert.deepEqual(none.perCard, []);

  const partial = trainingSummary(state, deps, pikeman, []);
  assert.equal(partial.ok, false);
  assert.match(partial.reason, /sacrifice/i);

  const noTarget = trainingSummary(state, deps, null, [envoy]);
  assert.equal(noTarget.gold, trainingCost(deps, [getCard(state, envoy)]), 'the stack price shows before a card is in the slot');

  const full = trainingSummary(state, deps, pikeman, [envoy]);
  const xp = sacrificeValue(deps, getCard(state, envoy));
  assert.equal(full.ok, true);
  assert.equal(full.xp, xp);
  assert.equal(full.gold, trainingCost(deps, [getCard(state, envoy)]));
  assert.deepEqual(full.perCard, [{ uid: envoy, xp }]);
  assert.equal(full.canAffordAll, true);

  assert.equal(trainingSummary(state, deps, pikeman, [scout]).ok, true, 'a deck card on the stack is fine');

  const broke = trainingSummary({ ...state, player: { ...state.player, gold: 0 } }, deps, pikeman, [envoy]);
  assert.equal(broke.ok, false);
  assert.equal(broke.canAffordAll, false);
  assert.equal(broke.xp, xp, 'xp preview still shown when gold is short');

  const stale = trainingSummary(state, deps, pikeman, ['gone', envoy]);
  assert.equal(stale.ok, true);
  assert.equal(stale.perCard.length, 1);
});

test('pruneTrainingSelection drops gone cards and keeps the stack legal', () => {
  const { state } = fresh();
  const pikeman = uidOf(state, 'pikeman');
  const envoy = uidOf(state, 'envoy');
  const scout = uidOf(state, 'scout');
  const r = pruneTrainingSelection(state, pikeman, [envoy, 'gone', scout, pikeman, envoy]);
  assert.equal(r.trainUid, pikeman);
  assert.deepEqual(r.sacrifices, [envoy, scout]);
  const r2 = pruneTrainingSelection(state, 'gone', [envoy]);
  assert.equal(r2.trainUid, null);
  assert.deepEqual(r2.sacrifices, [envoy]);
});

test('training and fusion with deck cards (allowDeck, client behaviour)', () => {
  let { deps, state } = fresh();
  state = { ...state, player: { ...state.player, gold: 100000 } };
  const pikeman = uidOf(state, 'pikeman'), scout = uidOf(state, 'scout');
  assert.equal(previewTraining(state, deps, pikeman, [scout]).ok, false, 'default still refuses deck cards');
  const t = train(state, deps, pikeman, [scout], { allowDeck: true });
  assert.ok(!t.state.cards.some((c) => c.uid === scout));
  assert.equal(t.state.deck[2], null, 'the sacrificed deck card leaves its slot');

  let b2;
  [state, b2] = give(state, deps, 'bone-breaker');
  const b1 = uidOf(state, 'bone-breaker');
  assert.equal(canFuse(state, deps, b1, b2).ok, false, 'default still refuses deck cards');
  const f = fuse(state, deps, b2, b1, { allowDeck: true });
  assert.equal(f.slot, 1);
  assert.equal(f.state.deck[1], f.uid, 'the result takes the deck slot');
  assert.equal(f.state.cards.find((c) => c.uid === f.uid).stage, 1);
});

test('fusion slots: fit, prune, check and price', () => {
  let { deps, state } = fresh();
  state = { ...state, player: { ...state.player, gold: 100000 } };
  let a1, a2, c1;
  [state, a1] = give(state, deps, 'arch-angel', { level: 11 });
  [state, a2] = give(state, deps, 'arch-angel', { level: 3 });
  [state, c1] = give(state, deps, 'club-swinger');
  assert.equal(fitsFusionSlot(state, a1, null), true);
  assert.equal(fitsFusionSlot(state, a2, a1), true);
  assert.equal(fitsFusionSlot(state, c1, a1), false);
  assert.deepEqual(pruneFusionSlots(state, [a1, c1]), [a1, null]);
  assert.deepEqual(pruneFusionSlots(state, ['gone', a2]), [null, a2]);
  assert.deepEqual(pruneFusionSlots(state, [a1, a1]), [a1, null]);

  assert.deepEqual(fusionCheck(state, deps, [a1, null]), { ready: false, ok: false, reason: FUSE_MISMATCH_TEXT, cost: 0, stage: 0 });
  const ok = fusionCheck(state, deps, [a1, a2]);
  assert.equal(ok.ready, true);
  assert.equal(ok.ok, true);
  assert.equal(ok.cost, deps.stats.fusionCost('uncommon', 0));
  assert.equal(ok.stage, 1);
  const poor = fusionCheck({ ...state, player: { ...state.player, gold: 0 } }, deps, [a1, a2]);
  assert.equal(poor.ready, true, 'two equal cards light the OK button');
  assert.equal(poor.ok, false);
  assert.match(poor.reason, /gold/i);
  assert.equal(fusionCheck(state, deps, [a1, c1]).ready, false);
  assert.equal(FUSE_MISMATCH_TEXT, 'You need two equal cards of the same evolution state to do this.');
});

test('set collection paging helpers', () => {
  const sets = [{ id: 'main' }, { id: 'the-dark-beyond' }, { id: 'dragon-hunt' }];
  assert.equal(collectionPageIndex(sets, 'dragon-hunt'), 2);
  assert.equal(collectionPageIndex(sets, 'nope'), 0);
  assert.equal(collectionPageIndex(sets, undefined), 0);
  assert.equal(collectionPageIndex(sets, 3), 0, 'wraps forward');
  assert.equal(collectionPageIndex(sets, -1), 2, 'wraps backward');
  assert.equal(collectionPageIndex([], 'x'), 0);
  assert.equal(collectionProgressText({ ownedCount: 3, total: 8 }), '3/8');
});

test('bestOwnedInstance prefers the highest stage then level', () => {
  let { deps, state } = fresh();
  let low, high, fused;
  [state, low] = give(state, deps, 'arch-angel', { level: 2 });
  [state, high] = give(state, deps, 'arch-angel', { level: 9 });
  [state, fused] = give(state, deps, 'arch-angel', { stage: 1, level: 1 });
  assert.equal(bestOwnedInstance(state, 'arch-angel').uid, fused);
  assert.equal(bestOwnedInstance({ ...state, cards: state.cards.filter((c) => c.uid !== fused) }, 'arch-angel').uid, high);
  assert.equal(bestOwnedInstance(state, 'imperial-dragon'), null);
  assert.ok(low);
});

test('pieceHuntFor reads the hunt of a card', () => {
  const state = { pieces: [{ cardId: 'rat-eater', owned: 1, total: 4, holderId: null, raidDay: 0 }] };
  assert.deepEqual(pieceHuntFor(state, 'rat-eater'), { owned: 1, total: 4 });
  assert.equal(pieceHuntFor(state, 'arch-angel'), null);
  assert.equal(pieceHuntFor({}, 'rat-eater'), null);
});

test('piece sprite sets tile the 451x640 card canvas', () => {
  assert.deepEqual([...PIECE_CANVAS], [451, 640]);
  for (const n of [2, 4, 6, 10]) {
    const lay = PIECE_LAYOUTS[n];
    assert.equal(lay.length, n, `piece${n} has ${n} sprites`);
    for (const [x, y, w, h] of lay) {
      assert.ok(x >= 0 && y >= 0 && x + w <= 451 && y + h <= 640, `piece${n} sprite inside the canvas`);
    }
    // the first sprite starts at the top-left corner, the last ends at the bottom-right corner
    assert.deepEqual(lay[0].slice(0, 2), [0, 0]);
    assert.equal(lay[n - 1][0] + lay[n - 1][2], 451);
    assert.equal(lay[n - 1][1] + lay[n - 1][3], 640);
  }
  assert.equal(pieceSet(2), 2);
  assert.equal(pieceSet(4), 4);
  assert.equal(pieceSet(6), 6);
  assert.equal(pieceSet(10), 10);
  assert.equal(pieceSet(12), 10, 'ultimates use the 10-piece set');
  assert.equal(litPieces(3, 4), 3);
  assert.equal(litPieces(0, 6), 0);
  assert.equal(litPieces(6, 12), 5, 'proportional when the set is smaller');
  assert.equal(litPieces(12, 12), 10);
  assert.equal(litPieces(99, 4), 4, 'clamped');
});

test('sprite helpers point at the original textures', () => {
  assert.equal(spriteUrl('cardindeck'), '/assets/orig/ui/cardindeck.png');
  assert.equal(rarityLabel('uncommon'), 'Uncommon');
  assert.equal(cardNameWithPlus('Scout', 2), 'Scout++');
});

test('card views split heal (green) and buff (blue) arrow directions', () => {
  const { deps } = fresh();
  const angel = defView(deps.db.get('arch-angel'));
  assert.ok(Array.isArray(angel.healDirs) && Array.isArray(angel.buffDirs));
  const all = effectDirs(deps.db.get('arch-angel'), 0);
  assert.deepEqual([...angel.healDirs, ...angel.buffDirs].sort(), all.slice().sort(), 'heal + buff dirs = every ability dir');
  for (const d of angel.healDirs) assert.ok(!angel.buffDirs.includes(d), 'a direction is either heal or buff');
  // a card without an ability has no ability arrows
  const scout = defView(deps.db.get('scout'));
  assert.deepEqual(healDirsFor(deps.db.get('scout'), 0), []);
  assert.deepEqual(buffDirsFor(deps.db.get('scout'), 0), []);
  assert.deepEqual(scout.buffDirs, []);
});
