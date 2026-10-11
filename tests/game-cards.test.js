'use strict';
/**
 * src/game: the collection (100-card inventory, selling, sorting, deck editing, card xp), training and
 * fusion.
 * Two kinds of tests: the "(fixture catalog)" groups run on the 21-card fixture catalog and a stub engine
 * (tests/fixtures-game); the "§" groups verify the rules of docs/design/game-design.md (and the brief §5 tables
 * it points to) against the real data through the real cards-db and stats modules, with the stub engine where a
 * fight needs a known outcome. Every state the "§" groups hand to a game function is deep-frozen first (`fz`),
 * so any mutation of an input throws.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deckMana } from '../src/game/state.js';
import {
  addCard, sellCard, sortCards, placeInDeck, addCardXp, validateDeck, COLLECTION_LIMIT, bestCard,
} from '../src/game/collection.js';
import { previewTraining, train, sacrificeValue } from '../src/game/training.js';
import { canFuse, fuse, fusionCandidates } from '../src/game/fusion.js';
import * as stats from '../src/core/stats.js';
import * as S from '../src/game/state.js';
import * as P from '../src/game/player.js';
import * as C from '../src/game/collection.js';
import * as T from '../src/game/training.js';
import * as Fu from '../src/game/fusion.js';
import * as L from '../src/game/league.js';
import { RARITY_IDS, db, deps, fz, fresh, rich, give, sample } from './fixtures/real.js';
import * as stub from './fixtures-game/game.js';

describe('collection, training and fusion (fixture catalog)', () => {
  const { fresh, give } = stub; // the fixture-catalog builders

  // ---------------------------------------------------------------- collection

  // "Your cards n/100" (lategame.md §3); quest rewards are sold automatically when full (client autosell).
  test('100-card inventory: extra reward cards are sold automatically at their sell value; force exceeds it', () => {
    let { state, deps } = fresh();
    while (state.cards.length < COLLECTION_LIMIT) state = addCard(state, deps, 'envoy').state;
    assert.equal(state.cards.length, 100);
    assert.equal(addCard(state, deps, 'envoy', { force: true }).state.cards.length, 101);
    const gold = state.player.gold;
    const r = addCard(state, deps, 'rat-eater', { level: 3 });
    assert.equal(r.converted, true);
    assert.equal(r.uid, null);
    assert.equal(r.state.cards.length, 100);
    assert.equal(r.gold, deps.stats.sellValue(deps.db.get('rat-eater'), 0, 3));
    assert.equal(r.state.player.gold, gold + r.gold);
  });

  test('selling: formula value, deck cards cannot be sold', () => {
    const { state, deps } = fresh();
    const deckUid = state.deck[1];
    assert.throws(() => sellCard(state, deps, deckUid), /deck/);
    const envoy = state.cards.find((c) => c.cardId === 'envoy');
    const r = sellCard(state, deps, envoy.uid);
    assert.equal(r.gold, 5 * 2 * (9 + 1 + 0));
    assert.equal(r.state.player.gold, 300 + r.gold);
    assert.equal(r.state.cards.length, 5);
  });

  test('sorting (level desc, mana desc, name)', () => {
    let { state, deps } = fresh();
    let u;
    [state, u] = give(state, deps, 'rat-eater', { level: 5 });
    [state] = give(state, deps, 'arch-angel', { level: 5 });
    const sorted = sortCards(state.cards, deps.db);
    assert.equal(sorted[0].uid, u);
    assert.equal(sorted[1].cardId, 'arch-angel');
    assert.equal(sorted[2].cardId, 'bone-breaker');
    assert.equal(sorted[3].cardId, 'scout');
    assert.equal(sorted[4].cardId, 'master-brewer');
    assert.equal(sorted[5].cardId, 'envoy');
    assert.equal(bestCard(state, deps).uid, u);
  });

  test('deck editing: locked slots, mana limit, swaps', () => {
    let { state, deps } = fresh();
    const envoy = state.cards.find((c) => c.cardId === 'envoy');
    assert.throws(() => placeInDeck(state, deps, envoy.uid, 0), /locked/i);
    const r = placeInDeck(state, deps, envoy.uid, 1);
    assert.equal(r.state.deck[1], envoy.uid);
    assert.ok(r.state.deck.includes(state.deck[1]) === false);
    let big;
    [state, big] = give(state, deps, 'imperial-dragon');
    [state, big] = give(state, deps, 'dwarf-king');
    const s2 = placeInDeck(state, deps, state.cards.find((c) => c.cardId === 'imperial-dragon').uid, 1).state;
    assert.throws(() => placeInDeck(s2, deps, big, 2), /mana/i);
    assert.equal(validateDeck(s2, deps).ok, true);
    assert.equal(deckMana(s2, deps), 25 + 4 + 3);
  });

  test('card xp levels up and stops at the stage cap', () => {
    const { state, deps } = fresh();
    const envoy = state.cards.find((c) => c.cardId === 'envoy');
    const def = deps.db.get('envoy');
    const r = addCardXp(state, deps, envoy.uid, deps.stats.cardXpToNext(def, 1) + deps.stats.cardXpToNext(def, 2));
    assert.deepEqual(r.levelUps, [{ uid: envoy.uid, from: 1, to: 3 }]);
    const r2 = addCardXp(r.state, deps, envoy.uid, 1e9);
    const c = r2.state.cards.find((x) => x.uid === envoy.uid);
    assert.equal(c.level, 9);
    assert.equal(c.xp, 0);
    assert.equal(r2.capped, true);
    assert.equal(addCardXp(r2.state, deps, envoy.uid, 100).levelUps.length, 0);
  });

  // ---------------------------------------------------------------- training

  // Training gold = the client's enhance price of the sacrifice stack (a level-1 2-mana Common costs 111,
  // playthroughs-2.md §1.7).
  test('training preview: xp formula, gold = enhance price of the sacrifices, rejected inputs', () => {
    let { state, deps } = fresh();
    state = { ...state, player: { ...state.player, gold: 10000 } };
    const target = state.cards.find((c) => c.cardId === 'envoy');
    const pike = state.cards.find((c) => c.cardId === 'pikeman');
    const pouch = state.cards.find((c) => c.cardId === 'pouch-tearer');
    const pv = previewTraining(state, deps, target.uid, [pike.uid, pouch.uid]);
    assert.equal(pv.ok, true);
    assert.equal(pv.xp, 2 * Math.round(25 * 2 * 3 * 0.6));
    assert.equal(pv.gold, 111 + 111);
    assert.ok(pv.levelTo >= pv.levelFrom);
    assert.equal(previewTraining(state, deps, target.uid, [state.deck[1]]).reason, 'Cards in the active deck cannot be sacrificed');
    assert.equal(previewTraining(state, deps, target.uid, [target.uid]).ok, false);
    assert.equal(previewTraining(state, deps, target.uid, new Array(10).fill(pike.uid)).ok, false);
    assert.equal(previewTraining({ ...state, player: { ...state.player, gold: 0 } }, deps, target.uid, [pike.uid]).reason, 'Not enough gold');
  });

  test('train applies xp, removes sacrifices, pays gold; trainer cards give fixed xp', () => {
    let { state, deps } = fresh();
    state = { ...state, player: { ...state.player, gold: 10000 } };
    let lich;
    [state, lich] = give(state, deps, 'lich-king');
    assert.equal(sacrificeValue(deps, state.cards.find((c) => c.uid === lich)), 4000);
    const target = state.cards.find((c) => c.cardId === 'envoy');
    const r = train(state, deps, target.uid, [lich]);
    assert.equal(r.xp, 4000);
    assert.equal(r.gold, 75);
    assert.equal(r.state.player.gold, 9925);
    assert.equal(r.state.cards.some((c) => c.uid === lich), false);
    assert.equal(r.state.cards.find((c) => c.uid === target.uid).level, 9);
    assert.equal(r.levelUps[0].to, 9);
  });

  // ---------------------------------------------------------------- fusion

  test('fusion rules: same card and stage, cost table, evolve quality, warnings', () => {
    let { state, deps } = fresh();
    state = { ...state, player: { ...state.player, gold: 5000 } };
    let a, b, c;
    [state, a] = give(state, deps, 'rat-eater', { level: 12 });
    [state, b] = give(state, deps, 'rat-eater', { level: 6 });
    [state, c] = give(state, deps, 'armorer', { level: 12 });
    const v = canFuse(state, deps, a, b);
    assert.equal(v.ok, true);
    assert.equal(v.cost, 1920);
    assert.equal(v.quality, 1, 'round 5: the input levels do not lower the result');
    assert.equal(v.warning, null);
    assert.equal(canFuse(state, deps, a, c).ok, false);
    assert.equal(canFuse(state, deps, a, a).ok, false);
    const [s2, d] = give(state, deps, 'rat-eater', { stage: 1, level: 1 });
    assert.match(canFuse(s2, deps, a, d).reason, /same fusion stage/);
    assert.equal(canFuse({ ...state, player: { ...state.player, gold: 10 } }, deps, a, b).reason, 'Not enough gold');
    const inDeck = placeInDeck(state, deps, a, 1).state;
    assert.match(canFuse(inDeck, deps, a, b).reason, /deck/);
    assert.equal(fusionCandidates(state, deps).length, 1);
  });

  test('fuse consumes both inputs and creates stage+1 level 1 with the evolve bonus', () => {
    let { state, deps } = fresh();
    state = { ...state, player: { ...state.player, gold: 5000 } };
    let a, b;
    [state, a] = give(state, deps, 'rat-eater', { level: 12 });
    [state, b] = give(state, deps, 'rat-eater', { level: 12 });
    const r = fuse(state, deps, a, b);
    const fused = r.state.cards.find((x) => x.uid === r.uid);
    assert.equal(fused.stage, 1);
    assert.equal(fused.level, 1);
    assert.equal(fused.evolveQuality, 1);
    assert.equal(r.state.player.gold, 5000 - 1920);
    assert.equal(r.state.cards.filter((x) => x.cardId === 'rat-eater').length, 1);
    const [s4, d] = give(r.state, deps, 'rat-eater', { stage: 4 });
    const [s5, e] = give(s4, deps, 'rat-eater', { stage: 4 });
    assert.match(canFuse(s5, deps, d, e).reason, /maximum fusion stage/);
  });
});

// ================================================================= §2 Cards

describe('§2 cards', () => {
  // "Your cards n/100", red when over; quest rewards are sold automatically when full (lategame.md §3, client autosell).
  test('§2.3 inventory of 100: extra reward cards are sold for their sell value; force (boosters, fusion, pieces) exceeds it', () => {
    assert.equal(C.COLLECTION_LIMIT, 100);
    const d = deps();
    let s = fresh();
    const def = sample('rare');
    while (s.cards.length < 100) s = give(s, d, def.id, { level: 3 })[0];
    assert.equal(s.cards.length, 100);
    const over = C.addCard(s, d, def.id, { stage: 1, level: 7 });
    assert.equal(over.converted, true);
    assert.equal(over.uid, null);
    assert.equal(over.gold, stats.sellValue(def, 1, 7));
    assert.equal(over.state.cards.length, 100);
    assert.equal(over.state.player.gold, s.player.gold + stats.sellValue(def, 1, 7));
    const forced = C.addCard(s, d, def.id, { force: true });
    assert.equal(forced.converted, false);
    assert.equal(forced.state.cards.length, 101);
  });

  test('§2.3 sort: level desc, mana desc, name asc', () => {
    const d = deps();
    let s = fresh();
    const hi = db.byRarity('heroic').filter((x) => !x.trainer).sort((a, b) => b.mana - a.mana)[0];
    const lo = db.byRarity('uncommon').filter((x) => !x.trainer).sort((a, b) => a.mana - b.mana)[0];
    s = give(s, d, hi.id, { level: 5 })[0];
    s = give(s, d, lo.id, { level: 5 })[0];
    s = give(s, d, lo.id, { level: 9 })[0];
    const sorted = C.sortCards(s.cards, db);
    assert.equal(sorted[0].cardId, lo.id); assert.equal(sorted[0].level, 9);
    assert.equal(sorted[1].cardId, hi.id, 'same level: higher mana first');
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1], b = sorted[i];
      const ma = db.get(a.cardId).mana, mb = db.get(b.cardId).mana;
      assert.ok(a.level > b.level || (a.level === b.level && (ma > mb || (ma === mb && db.get(a.cardId).name.localeCompare(db.get(b.cardId).name) <= 0))));
    }
    assert.equal(C.bestCard(s, d).cardId, lo.id);
  });

  test('§2.4 training xp = 25 × mana × (level + 2) × rarityFactor; trainers 4,000 / 9,000 / 20,000', () => {
    const factor = { common: 0.6, standard: 0.8, uncommon: 1, rare: 1.6, heroic: 2.4, legendary: 3.5, ultimate: 5 };
    const d = deps();
    for (const r of RARITY_IDS) {
      const def = sample(r);
      for (const level of [1, 3, 8]) {
        for (const stage of [0, 2]) {
          const expected = Math.round(25 * def.mana * (level + 2) * factor[r]);
          assert.equal(T.sacrificeValue(d, { cardId: def.id, stage, level }), expected, `${r} L${level} s${stage}`);
          assert.equal(stats.sacrificeXp(def, stage, level), expected);
        }
      }
    }
    assert.equal(T.sacrificeValue(d, { cardId: 'lich-king', stage: 0, level: 1 }), 4000);
    assert.equal(T.sacrificeValue(d, { cardId: 'crystal-ghost', stage: 0, level: 1 }), 9000);
    assert.equal(T.sacrificeValue(d, { cardId: 'blood-dragon', stage: 0, level: 1 }), 20000);
    assert.deepEqual(T.TRAINER_XP, { 'lich-king': 4000, 'crystal-ghost': 9000, 'blood-dragon': 20000 });
  });

  // Gold = the client's enhance price summed over the sacrifice stack (playthroughs-2.md §1.7 fit, stats.enhancePrice).
  test('§2.4 training session: gold = enhance price of the sacrifices, up to 9 sacrifices, deck cards protected, level-ups reported', () => {
    const d = deps();
    let s = rich(fresh());
    const target = sample('rare');
    const fodder = sample('uncommon');
    let tu; [s, tu] = give(s, d, target.id, { level: 1 });
    const sac = [];
    for (let i = 0; i < 10; i++) { let u; [s, u] = give(s, d, fodder.id, { level: 4 }); sac.push(u); }
    const nine = sac.slice(0, 9);
    const pv = T.previewTraining(s, d, tu, nine);
    assert.equal(pv.ok, true);
    const perCard = Math.round(25 * fodder.mana * 6 * 1);
    assert.equal(pv.xp, perCard * 9);
    assert.equal(pv.gold, 9 * stats.enhancePrice(fodder, 4));
    assert.equal(stats.enhancePrice(fodder, 4), Math.ceil((fodder.mana * 25 + 3 * 50) * 1.3 * 2));
    assert.equal(T.trainingCost(d, [{ cardId: 'envoy', level: 1 }, { cardId: 'master-brewer', level: 1 }]), 111 + 180);
    assert.equal(T.sacrificePrice(d, { cardId: 'envoy', level: 4 }), 441);
    assert.equal(T.MAX_SACRIFICES, 9);
    assert.equal(T.previewTraining(s, d, tu, sac).ok, false, '10 sacrifices refused');
    assert.match(T.previewTraining(s, d, tu, sac).reason, /9/);
    assert.equal(T.previewTraining(s, d, tu, [s.deck[1]]).ok, false, 'deck card cannot be sacrificed');
    assert.equal(T.previewTraining(s, d, tu, [tu]).ok, false);
    // apply: cards removed, gold paid, xp applied with level-ups
    const r = T.train(s, d, tu, nine);
    assert.equal(r.state.cards.length, s.cards.length - 9);
    assert.equal(r.state.player.gold, s.player.gold - pv.gold);
    assert.equal(r.xp, pv.xp);
    const after = S.getCard(r.state, tu);
    assert.ok(after.level > 1);
    assert.equal(r.levelUps.length, 1);
    assert.equal(r.levelUps[0].from, 1);
    assert.equal(r.levelUps[0].to, after.level);
    assert.equal(after.level, pv.levelTo);
    // xp accounting: the level reached matches the threshold sum
    let pool = pv.xp, lvl = 1;
    while (lvl < stats.capFor(target, 0) && pool >= stats.cardXpToNext(target, lvl)) { pool -= stats.cardXpToNext(target, lvl); lvl++; }
    assert.equal(after.level, lvl);
    assert.equal(after.xp, lvl >= stats.capFor(target, 0) ? 0 : pool);
    // not enough gold
    const poor = fz({ ...s, player: { ...s.player, gold: pv.gold - 1 } });
    assert.equal(T.previewTraining(poor, d, tu, nine).reason, 'Not enough gold');
    assert.throws(() => T.train(poor, d, tu, nine), /gold/);
    // capped card refuses training
    const capped = fz(S.updateCard(s, tu, { level: stats.capFor(target, 0) }));
    assert.equal(T.previewTraining(capped, d, tu, nine).ok, false);
  });

  test('§2.5 fusion gold costs per rarity and stage (brief §5.4 table)', () => {
    const table = {
      common: [200, 800, 1800, 3200], standard: [400, 1600, 3600, 6400], uncommon: [900, 3600, 8100, 14400],
      rare: [1920, 7680, 17280, 30720], heroic: [3750, 15000, 33750, 60000], legendary: [7200, 28800, 64800, 115200],
      ultimate: [10780, 43120, 97020, 172480],
    };
    for (const r of RARITY_IDS) for (let st = 0; st < 4; st++) assert.equal(stats.fusionCost(r, st), table[r][st], `${r} ${st}`);
    assert.throws(() => stats.fusionCost('rare', 4));
  });

  test('§2.5 fusion: same card + same stage < 4 → stage + 1, level 1, xp 0, q = 0.75 + 0.25 × avg(level/cap)', () => {
    const d = deps();
    const def = sample('uncommon');
    const cap0 = stats.capFor(def, 0);
    let s = rich(fresh());
    let a, b, c, e;
    [s, a] = give(s, d, def.id, { level: cap0 });
    [s, b] = give(s, d, def.id, { level: cap0 });
    [s, c] = give(s, d, def.id, { level: 1 });
    [s, e] = give(s, d, def.id, { stage: 1, level: 1 });
    const perfect = Fu.canFuse(s, d, a, b);
    assert.equal(perfect.ok, true);
    assert.equal(perfect.quality, 1);
    assert.equal(perfect.cost, 900);
    assert.equal(perfect.stage, 1);
    assert.equal(perfect.warning, null);
    const weak = Fu.canFuse(s, d, a, c);
    assert.equal(weak.ok, true);
    // round 5: the input levels do not lower the result (tutorial video: two level-1 cards fuse to base × 1.15)
    assert.equal(weak.quality, 1);
    assert.equal(weak.warning, null);
    assert.equal(stats.evolveQuality(1, 10, 1, 10), 1);
    assert.equal(stats.evolveQuality(10, 10, 10, 10), 1);
    assert.equal(Fu.canFuse(s, d, a, e).ok, false, 'different stages');
    assert.equal(Fu.canFuse(s, d, a, a).ok, false);
    assert.equal(Fu.canFuse(s, d, a, s.deck[1]).ok, false, 'different card');
    const r = Fu.fuse(s, d, a, c);
    const out = S.getCard(r.state, r.uid);
    assert.equal(out.stage, 1); assert.equal(out.level, 1); assert.equal(out.xp, 0);
    assert.equal(out.evolveQuality, weak.quality);
    assert.equal(r.state.player.gold, s.player.gold - 900);
    assert.equal(S.getCard(r.state, a), undefined); assert.equal(S.getCard(r.state, c), undefined);
    assert.equal(r.state.cards.length, s.cards.length - 1);
    // a stored evolve bonus (saves from before round 5) still scales attack / hp / ability
    const q = 0.8;
    assert.equal(stats.statAt(def, 'attack', 1, 1, q), Math.round(stats.statAt(def, 'attack', 1, 1, 1) * q));
    assert.equal(stats.statAt(def, 'hp', 1, 5, q), Math.round(stats.statAt(def, 'hp', 1, 5, 1) * q));
    // max stage
    let s4, x, y;
    [s4, x] = give(s, d, def.id, { stage: 4, level: 1 });
    [s4, y] = give(s4, d, def.id, { stage: 4, level: 1 });
    assert.equal(Fu.canFuse(s4, d, x, y).ok, false);
    assert.equal(Fu.MAX_STAGE, 4);
    // 16 base cards make a ++++: 2 → +, 4 → ++, 8 → +++, 16 → ++++
    let s16 = rich(fresh());
    let uids = [];
    for (let i = 0; i < 16; i++) { let u; [s16, u] = give(s16, d, def.id, { level: 1 }); uids.push(u); }
    for (let stage = 0; stage < 4; stage++) {
      const next = [];
      for (let i = 0; i < uids.length; i += 2) { const f = Fu.fuse(fz(s16), d, uids[i], uids[i + 1]); s16 = fz(f.state); next.push(f.uid); }
      uids = next;
    }
    assert.equal(uids.length, 1);
    assert.equal(S.getCard(s16, uids[0]).stage, 4);
    // not enough gold
    const poor = fz({ ...s, player: { ...s.player, gold: 899 } });
    assert.equal(Fu.canFuse(poor, d, a, b).reason, 'Not enough gold');
  });

  test('§2.6 selling formulas per rarity (brief §5.4), F = fusion stage; deck cards cannot be sold', () => {
    const formula = {
      common: (M, L, F) => 5 * M * (9 + L + F), standard: (M, L, F) => 6.5 * M * (10 + L + 2 * F),
      uncommon: (M, L, F) => 8.5 * M * (11 + L + 4 * F), rare: (M, L, F) => 20 * M * (12 + L + 6 * F),
      heroic: (M, L, F) => 30 * M * (13 + L + 8 * F), legendary: (M, L, F) => 50 * M * (14 + L + 10 * F),
      ultimate: (M, L, F) => 55 * M * (15 + L + 12 * F),
    };
    const d = deps();
    for (const r of RARITY_IDS) {
      for (const def of db.byRarity(r).slice(0, 4)) {
        for (const [stage, level] of [[0, 1], [1, 5], [3, 2], [4, 9]]) {
          assert.equal(stats.sellValue(def, stage, level), Math.round(formula[r](def.mana, level, stage)), `${def.id} s${stage} L${level}`);
        }
      }
    }
    let s = rich(fresh());
    const def = sample('heroic');
    let u; [s, u] = give(s, d, def.id, { stage: 2, level: 4 });
    const r = C.sellCard(s, d, u);
    assert.equal(r.gold, Math.round(30 * def.mana * (13 + 4 + 16)));
    assert.equal(r.state.player.gold, s.player.gold + r.gold);
    assert.equal(S.getCard(r.state, u), undefined);
    assert.throws(() => C.sellCard(s, d, s.deck[1]), /active deck/);
    assert.equal(C.sellValueOf(s, d, u), r.gold);
  });

  test('§2.7 card xp per fight = 10 + enemyDeckMana / 2 (×1.5 win, ×2 Infinite Wisdom); thresholds round(40 × mana × l^1.5 / 10) min 20, unfused Common / Standard at least 105 / 180', () => {
    assert.equal(P.cardFightXp(20, false), 20);
    assert.equal(P.cardFightXp(20, true), 30);
    assert.equal(P.cardFightXp(20, true, true), 60);
    assert.equal(P.cardFightXp(20, false, true), 40);
    assert.equal(P.cardFightXp(0, false), 10);
    assert.equal(P.cardFightXp(11, true), Math.round(15.5 * 1.5));
    for (const def of db.all().slice(0, 60)) {
      for (let l = 1; l <= 12; l++) {
        const curve = Math.max(20, Math.round(40 * def.mana * l ** 1.5 / 10));
        const floor = ['common', 'standard'].includes(def.rarity) ? (l === 1 ? 105 : 180) : 0;
        assert.equal(stats.cardXpToNext(def, l), Math.max(curve, floor), `${def.id} L${l}`);
        assert.equal(stats.cardXpToNext(def, l, 1), curve, `${def.id}+ L${l}: a fused card keeps the curve`);
      }
    }
    assert.equal(stats.cardXpToNext({ mana: 2 }, 1), 20);
    assert.equal(stats.cardXpToNext({ mana: 10 }, 4), 320);
  });

  test('§2.7 card xp is capped at the stage level cap; every deck card gains the fight xp', () => {
    const d = deps();
    let s = fresh();
    const def = sample('standard');
    const cap = stats.capFor(def, 0);
    let u; [s, u] = give(s, d, def.id, { level: 1 });
    const r = C.addCardXp(s, d, u, 1e7);
    assert.equal(S.getCard(r.state, u).level, cap);
    assert.equal(S.getCard(r.state, u).xp, 0);
    assert.equal(r.capped, true);
    assert.deepEqual(r.levelUps, [{ uid: u, from: 1, to: cap }]);
    const atCap = fz(r.state);
    const again = C.addCardXp(atCap, d, u, 50);
    assert.equal(again.state, atCap, 'a capped card gains nothing');
    assert.equal(again.capped, true);
    // exact threshold arithmetic
    const need1 = stats.cardXpToNext(def, 1);
    const r1 = C.addCardXp(s, d, u, need1 - 1);
    assert.equal(S.getCard(r1.state, u).level, 1);
    assert.equal(S.getCard(r1.state, u).xp, need1 - 1);
    const r2 = C.addCardXp(fz(r1.state), d, u, 1);
    assert.equal(S.getCard(r2.state, u).level, 2);
    assert.equal(S.getCard(r2.state, u).xp, 0);
    // deck xp
    const dx = C.addDeckXp(s, d, 25);
    for (const uid of s.deck.filter(Boolean)) {
      const c = S.getCard(dx.state, uid);
      assert.ok(c.level > 1 || c.xp === 25, 'deck card got the xp');
    }
    assert.equal(S.getCard(dx.state, u).xp, 0, 'cards outside the deck get nothing');
  });

  test('deck rules: no duplicates, mana sum ≤ max mana, at least one card; placing swaps', () => {
    const d = deps();
    let s = fresh();
    const big = db.all().filter((x) => !x.trainer).sort((a, b) => b.mana - a.mana)[0];
    let u; [s, u] = give(s, d, big.id, { level: 1 });
    s = fz({ ...s, player: { ...s.player, manaMax: 20 } });
    const deckMana = S.deckMana(s, d);
    assert.equal(deckMana, 4 + 4 + 3);
    assert.equal(C.validateDeck(s, d).ok, true);
    assert.equal(C.validateDeck(s, d).mana, 11);
    assert.throws(() => C.placeInDeck(s, d, u, 1), /Mana needed/);
    const roomy = fz({ ...s, player: { ...s.player, manaMax: 500 } });
    const placed = C.placeInDeck(roomy, d, u, 1);
    assert.equal(placed.mana, 11 - 4 + big.mana);
    assert.equal(placed.state.deck[1], u);
    assert.equal(placed.state.deck.includes(s.deck[1]), false, 'displaced card leaves the deck when the mover came from outside');
    const swap = C.placeInDeck(s, d, s.deck[1], 2);
    assert.equal(swap.state.deck[2], s.deck[1]);
    assert.equal(swap.state.deck[1], s.deck[2], 'cards swap places');
    assert.throws(() => C.setDeck(s, d, [null, u, u, null, null]), /Duplicate/);
    assert.throws(() => C.setDeck(s, d, [null, null, null, null, null]), /empty/);
    assert.equal(C.removeFromDeck(s, 1).deck[1], null);
  });
});
