'use strict';
/**
 * The shop (DECISIONS.md §D4): the 1.7.4 booster grid of game.boostermanager2 / openbooster_screen — nine
 * face-down cards with a fixed rarity make-up, 1 token or the pack's gem price per pick, reset to a fresh booster —
 * the shop banner list, the gem packs, the pure grid helpers of src/ui/screens/booster-view.js, daily rewards, set
 * collections, the potion deal and the daily event on the save clock (debug.addDays). Real data with every state
 * deep-frozen; the "(fixture catalog)" group runs on tests/fixtures-game.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mulberry32 } from '../src/core/rng.js';
import { BOOSTER_PACKS, BOOSTER_GRID_CARDS, GEM_PACKS } from '../src/core/constants.js';
import * as S from '../src/game/state.js';
import * as P from '../src/game/player.js';
import * as Sh from '../src/game/shop.js';
import { boosterGrid, boosterFinished, setProgressPercent, tokenSpriteFor } from '../src/ui/screens/booster-view.js';
import { PACK_THEMES, BANNER_ARTS, offersForEvent } from '../src/ui/screens/shop.js';
import { utcDay, DAY_MS } from '../src/game/state.js';
import { addTokens, tokenCount, eventClock } from '../src/game/player.js';
import {
  dailyEvent, boosterPrice, openBooster, drawBoosterCard, rollBoosterCards, claimDaily, dailyRewardFor,
  setCollections, claimCollection, buyPotionDeal, EVENTS, shopOffers, POTION_DEAL_GEMS,
} from '../src/game/shop.js';
import { addDays } from '../src/ui/store.js';
import { makeDeps } from './fixtures-game/deps.js';
import { T0, MIN, DAY, QUESTS, db, deps, fz, fresh, tutorialStart, rich, give, portal } from './fixtures/real.js';
import * as stub from './fixtures-game/game.js';

const withGems = (s, gems) => fz({ ...s, player: { ...s.player, gems } });

describe('booster packs (constants and catalog)', () => {
  test('nine cards per booster; per-pick gem prices 50 / 350 / 975 / 250 / 1000; fixed rarity make-up', () => {
    assert.equal(BOOSTER_GRID_CARDS, 9);
    assert.equal(Sh.BOOSTER_CARDS, 9);
    const price = Object.fromEntries(Object.values(BOOSTER_PACKS).map((b) => [b.id, b.pickGems]));
    assert.deepEqual(price, { neophyte: 50, summoner: 350, archmage: 975, portalLow: 250, portalHigh: 1000 });
    for (const b of Object.values(BOOSTER_PACKS)) {
      assert.equal(Object.values(b.slots).reduce((a, n) => a + n, 0), 9, b.id);
    }
    assert.deepEqual(BOOSTER_PACKS.portalHigh.slots, { rare: 5, heroic: 3, legendary: 1 });
    assert.deepEqual(BOOSTER_PACKS.portalLow.slots, { uncommon: 5, rare: 3, heroic: 1 });
    assert.equal(Sh.boosterPrice('archmage'), 975);
    assert.equal(Sh.boosterPrice('archmage', 'get-the-best-cards'), 488);
    assert.equal(Sh.boosterPrice('neophyte', { id: 'get-the-best-cards' }), 25);
    assert.throws(() => Sh.boosterPrice('nope'), /Unknown/);
    assert.deepEqual(Sh.BOOSTERS.neophyte.mayContain, ['uncommon', 'rare', 'heroic']);
    assert.deepEqual(Sh.BOOSTERS.portalHigh.mayContain, ['rare', 'heroic', 'legendary', 'ultimate']);
    assert.equal(tokenSpriteFor('archmage'), 'token_big');
    assert.equal(tokenSpriteFor('portalLow'), null);
  });

  test('gem packs: the five IAP tiers, 500 to 20,000 gems', () => {
    assert.deepEqual(GEM_PACKS.map((g) => g.gems), [500, 1000, 3500, 10000, 20000]);
    assert.deepEqual(GEM_PACKS.map((g) => g.price), ['$4.99', '$9.99', '$24.99', '$49.99', '$99.99']);
    assert.equal(GEM_PACKS[3].card, 'heroic');
  });
});

describe('rolling a booster', () => {
  test('the rarity make-up is exact for every pack, never trainers; main packs draw the main set', () => {
    const d = deps();
    for (const id of ['neophyte', 'summoner', 'archmage']) {
      for (let seed = 1; seed <= 40; seed++) {
        const cards = Sh.rollBoosterCards(mulberry32(seed), d, id);
        assert.equal(cards.length, 9);
        const tally = {};
        for (const c of cards) {
          const def = db.get(c);
          assert.ok(def && !def.trainer, c);
          assert.equal(def.set, 'main', `${id} ${c}`);
          tally[def.rarity] = (tally[def.rarity] || 0) + 1;
        }
        assert.deepEqual(tally, BOOSTER_PACKS[id].slots, `${id} seed ${seed}`);
      }
    }
  });

  test('portal packs mix the portal set with the main set; the big pack sometimes swaps its Legendary for the Ultimate', () => {
    const d = deps();
    const portal = QUESTS.portals.find((p) => p.id === 'the-dark-beyond');
    let fromPortal = 0;
    let ultimates = 0;
    const N = 600;
    for (let seed = 1; seed <= N; seed++) {
      const cards = Sh.rollBoosterCards(mulberry32(seed), d, 'portalHigh', portal.id);
      assert.equal(cards.length, 9);
      const r = cards.map((c) => db.get(c).rarity);
      assert.equal(r.filter((x) => x === 'rare').length, 5);
      assert.equal(r.filter((x) => x === 'heroic').length, 3);
      assert.equal(r.filter((x) => x === 'legendary' || x === 'ultimate').length, 1);
      ultimates += r.includes('ultimate') ? 1 : 0;
      fromPortal += cards.filter((c) => portal.cards.includes(c)).length;
    }
    assert.ok(Math.abs(ultimates / N - 0.1) < 0.04, `ultimates ${ultimates / N}`);
    assert.ok(fromPortal / (N * 9) > 0.3 && fromPortal / (N * 9) < 0.8, `portal share ${fromPortal / (N * 9)}`);
    // the Dark Beyond set has no Uncommon: the small pack's five Uncommons come from the main set
    const low = Sh.rollBoosterCards(mulberry32(5), d, 'portalLow', portal.id);
    assert.equal(low.filter((c) => db.get(c).rarity === 'uncommon').length, 5);
    assert.throws(() => Sh.rollBoosterCards(mulberry32(1), d, 'portalLow', 'nope'), /Unknown portal/);
    assert.throws(() => Sh.boosterKey('portalHigh'), /Unknown portal/);
  });
});

describe('the booster grid', () => {
  test('entering rolls a sealed booster once; opening is free and keeps the cards', () => {
    const d = deps();
    const s0 = tutorialStart(d);
    assert.equal(Sh.getBooster(s0, 'neophyte'), null);
    const a = Sh.openBooster(s0, d, T0, { booster: 'neophyte' });
    assert.equal(a.fresh, true);
    assert.equal(a.booster.cards.length, 9);
    assert.deepEqual(a.booster.drawn, []);
    assert.equal(a.booster.opened, false);
    assert.equal(a.state.player.gems, s0.player.gems);
    const b = Sh.openBooster(fz(a.state), d, T0, { booster: 'neophyte', open: true });
    assert.deepEqual(b.booster.cards, a.booster.cards);
    assert.equal(b.booster.opened, true);
    const c = Sh.openBooster(fz(b.state), d, T0, { booster: 'neophyte' });
    assert.equal(c.fresh, false);
    assert.deepEqual(c.booster, b.booster);
    const p = Sh.openBooster(s0, d, T0, { booster: 'portalHigh', portalId: 'dying-dreams' });
    assert.ok(p.state.boosters['portalHigh@dying-dreams']);
  });

  test('each pick costs 1 token while there are tokens, then the gem price per card; the card joins the collection', () => {
    const d = deps();
    let s = fz(P.addTokens(withGems(tutorialStart(d), 2000), 'archmage', 2));
    s = fz(Sh.openBooster(s, d, T0, { booster: 'archmage', open: true }).state);
    const cards = Sh.getBooster(s, 'archmage').cards;
    assert.deepEqual(Sh.pickPayment(s, 'archmage'), { type: 'token', amount: 1, canPay: true, tokens: 2, gems: 2000 });
    const r1 = Sh.drawBoosterCard(s, d, T0, { booster: 'archmage', position: 4 });
    assert.equal(r1.paidWith, 'token');
    assert.equal(r1.cardId, cards[4]);
    assert.equal(P.tokenCount(r1.state, 'archmage'), 1);
    assert.equal(r1.state.cards.length, s.cards.length + 1);
    assert.equal(r1.state.cards.find((c) => c.uid === r1.uid).cardId, cards[4]);
    assert.equal(r1.remaining, 8);
    assert.throws(() => Sh.drawBoosterCard(fz(r1.state), d, T0, { booster: 'archmage', position: 4 }), /already/);
    const r2 = Sh.drawBoosterCard(fz(r1.state), d, T0, { booster: 'archmage', position: 0 });
    assert.equal(r2.paidWith, 'token');
    const pay = Sh.pickPayment(r2.state, 'archmage', undefined, null);
    assert.deepEqual([pay.type, pay.amount, pay.canPay], ['gems', 975, true]);
    const r3 = Sh.drawBoosterCard(fz(r2.state), d, T0, { booster: 'archmage', position: 8, event: 'get-the-best-cards' });
    assert.deepEqual([r3.paidWith, r3.cost, r3.state.player.gems], ['gems', 488, 2000 - 488]);
    const r4 = Sh.drawBoosterCard(fz(r3.state), d, T0, { booster: 'archmage', position: 7 });
    assert.equal(r4.state.player.gems, 2000 - 488 - 975);
    assert.equal(Sh.pickPayment(r4.state, 'archmage').canPay, false);
    assert.throws(() => Sh.drawBoosterCard(fz(r4.state), d, T0, { booster: 'archmage', position: 1 }), /Not enough gems/);
    assert.throws(() => Sh.drawBoosterCard(fz(r4.state), d, T0, { booster: 'archmage', position: 9 }), /No such card/);
    assert.throws(() => Sh.drawBoosterCard(tutorialStart(d), d, T0, { booster: 'archmage', position: 1 }), /not open/);
  });

  test('portal tokens are per portal; a card new to its set reports "Card added to set" with n/8', () => {
    const d = deps();
    const portal = QUESTS.portals.find((p) => p.id === 'dying-dreams');
    let s = fz(P.addTokens(tutorialStart(d), 'portalHigh', 9, portal.id));
    s = fz(Sh.openBooster(s, d, T0, { booster: 'portalHigh', portalId: portal.id, open: true }).state);
    assert.equal(Sh.pickPayment(s, 'portalHigh', 'dread-empress').type, 'gems');
    let added = 0;
    for (let pos = 0; pos < 9; pos++) {
      const r = Sh.drawBoosterCard(s, d, T0, { booster: 'portalHigh', portalId: portal.id, position: pos });
      if (r.setAdded) {
        added++;
        if (portal.cards.includes(r.cardId)) {
          assert.equal(r.setAdded.name, portal.name);
          assert.equal(r.setAdded.total, 8);
        }
        assert.ok(r.setAdded.owned >= 1 && r.setAdded.owned <= r.setAdded.total);
      }
      s = fz(r.state);
    }
    assert.ok(added >= 1);
    assert.equal(P.tokenCount(s, 'portalHigh', portal.id), 0);
    assert.ok(boosterFinished(Sh.getBooster(s, 'portalHigh', portal.id)));
  });

  test('a new booster replaces the old one (free, sealed, new cards)', () => {
    const d = deps();
    let s = fz(Sh.openBooster(withGems(tutorialStart(d), 500), d, T0, { booster: 'neophyte', open: true }).state);
    s = fz(Sh.drawBoosterCard(s, d, T0, { booster: 'neophyte', position: 2 }).state);
    const old = Sh.getBooster(s, 'neophyte');
    const n = Sh.discardBooster(s, d, T0, { booster: 'neophyte' });
    assert.equal(n.booster.seq, old.seq + 1);
    assert.deepEqual(n.booster.drawn, []);
    assert.equal(n.booster.opened, false);
    assert.notDeepEqual(n.booster.cards, old.cards);
    assert.equal(n.state.player.gems, s.player.gems);
    assert.equal(n.state.cards.length, s.cards.length);
  });

  test('old saves without `boosters` load and open boosters; the field survives a save round-trip', () => {
    const d = deps();
    const s = structuredClone(tutorialStart(d));
    delete s.boosters;
    const migrated = fz(S.migrate(JSON.parse(JSON.stringify(s)), T0));
    assert.equal(Sh.getBooster(migrated, 'summoner'), null);
    const o = Sh.openBooster(migrated, d, T0, { booster: 'summoner' });
    const again = S.migrate(JSON.parse(JSON.stringify(o.state)), T0);
    assert.deepEqual(Sh.getBooster(again, 'summoner'), o.booster);
  });
});

describe('shop offers', () => {
  test("Neophyte, the running portal's two packs, the next portal's two coming soon, Summoner, Archmage", () => {
    const d = deps();
    let s = tutorialStart(d);
    const cur = Sh.shopOffers(s, d, T0);
    const keys = cur.boosters.map((b) => b.id);
    assert.deepEqual(keys, ['neophyte', 'portalLow', 'portalHigh', 'portalLow', 'portalHigh', 'summoner', 'archmage']);
    const order = QUESTS.portals.map((p) => p.id);
    const running = cur.boosters[1].portalId;
    assert.equal(running, order[0], 'a fresh save starts on the first portal of the rotation');
    assert.equal(cur.boosters[2].portalId, running);
    const next = cur.boosters[3].portalId;
    assert.equal(next, order[1]);
    assert.equal(cur.boosters[4].portalId, next);
    // the running portal's packs can be opened and end with the portal; the next portal's start with it
    const week = (QUESTS.portalRotationDays || 7) * 24 * 3600 * 1000;
    for (const b of cur.boosters.slice(1, 3)) assert.ok(!b.pre && b.endsInMs === week && b.startsInMs === 0);
    for (const b of cur.boosters.slice(3, 5)) assert.ok(b.pre && b.startsInMs === week && b.endsInMs === 0);
    for (const b of [cur.boosters[0], ...cur.boosters.slice(5)]) assert.ok(!b.pre && !b.portalId && b.endsInMs === 0);
    // portal packs carry their token's name (Dying Dreams: Dreamwalker / Oneiromancer), main packs their own
    const portalDef = QUESTS.portals[0];
    assert.equal(cur.boosters[1].name, portalDef.tokens.low.name.replace(/ token$/i, ''));
    assert.equal(cur.boosters[2].name, portalDef.tokens.high.name.replace(/ token$/i, ''));
    assert.equal(cur.boosters[1].setName, portalDef.name);
    assert.equal(cur.boosters[0].name, 'Neophyte Pack');
    assert.equal(cur.boosters[0].left, 9);
    assert.equal(cur.gemPacks.length, 5);
    // a week later the next portal runs and the one after it is announced
    const later = Sh.shopOffers(s, d, T0 + week + 1000);
    assert.deepEqual(later.boosters.slice(1, 5).map((b) => b.portalId), [next, next, order[2], order[2]]);
    // an ended portal's packs are not listed even with tokens left; the tokens stay in the save
    s = fz(P.addTokens(s, 'portalLow', 3, order[5]));
    const more = Sh.shopOffers(s, d, T0);
    assert.equal(more.boosters.filter((b) => b.portalId === order[5]).length, 0);
    assert.equal(P.tokenCount(s, 'portalLow', order[5]), 3);
    // ...and come back with their tokens when the rotation reaches that portal again
    const back = Sh.shopOffers(s, d, T0 + 5 * week + 1000);
    assert.equal(back.boosters.find((b) => b.id === 'portalLow' && !b.pre).tokens, 3);
    // the removed Portal archive: a manual portal in an old save does not change the list
    const manual = fz({ ...s, quests: { ...s.quests, manualPortal: order[6] } });
    assert.deepEqual(Sh.shopOffers(manual, d, T0).boosters.map((b) => b.portalId), cur.boosters.map((b) => b.portalId));
    // explicit portal: no countdowns; null: no portal packs at all
    const fixed = Sh.shopOffers(s, d, T0, order[3]);
    assert.deepEqual(fixed.boosters.slice(1, 5).map((b) => [b.portalId, b.pre, b.endsInMs, b.startsInMs]),
      [[order[3], false, 0, 0], [order[3], false, 0, 0], [order[4], true, 0, 0], [order[4], true, 0, 0]]);
    const none = Sh.shopOffers(s, d, T0, null);
    assert.deepEqual(none.boosters.map((b) => b.id), ['neophyte', 'summoner', 'archmage']);
  });
});

describe('shop banners', () => {
  test('every pack has its frame tint and title colour (2016 shop: steel / gold / violet frames)', () => {
    assert.deepEqual(Object.keys(PACK_THEMES).sort(), Object.keys(Sh.BOOSTERS).sort());
    assert.deepEqual(PACK_THEMES.neophyte, { frame: 'steel', title: 'light' });
    assert.deepEqual(PACK_THEMES.summoner, { frame: 'violet', title: 'pink' });
    assert.deepEqual(PACK_THEMES.archmage, { frame: 'gold', title: 'gold' });
    assert.deepEqual(PACK_THEMES.portalHigh, { frame: 'gold', title: 'pink' });
    assert.ok(BANNER_ARTS >= 3);
    const css = readFileSync(new URL('../css/screens/shop.css', import.meta.url), 'utf8');
    for (const cls of ['.pack-frame', '.pack-title', '.pack-look', '.pack-soon', '.pack-squares', '.pack-banner.portal', '.pack-banner.pre', '.theme-gold', '.theme-violet']) {
      assert.ok(css.includes(cls), cls);
    }
    assert.ok(readFileSync(new URL('../assets/ui/pack-frame.png', import.meta.url)).length > 1000, 'the cut-out banner frame');
  });
});

describe('grid helpers', () => {
  test('boosterGrid: 3 × 3 cells, cost on face-down cells, card ids only once drawn', () => {
    const b = { cards: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], drawn: [4, 8] };
    const g = boosterGrid(b, { type: 'gems', amount: 250 });
    assert.equal(g.length, 9);
    assert.deepEqual([g[5].row, g[5].col], [1, 2]);
    assert.deepEqual(g[0].cost, { type: 'gems', amount: 250 });
    assert.equal(g[0].cardId, null);
    assert.deepEqual([g[4].drawn, g[4].cardId, g[4].cost], [true, 'e', null]);
    assert.equal(boosterFinished(b), false);
    assert.equal(boosterFinished({ cards: b.cards, drawn: [0, 1, 2, 3, 4, 5, 6, 7, 8] }), true);
    assert.equal(boosterFinished(null), false);
    assert.equal(setProgressPercent(5, 8), 62.5);
    assert.equal(setProgressPercent(9, 8), 100);
    assert.equal(setProgressPercent(1, 0), 0);
  });
});

describe('shop (fixture catalog)', () => {
  const { fresh, rich, give } = stub; // the fixture-catalog builders

  // ---------------------------------------------------------------- shop

  test('daily event is deterministic per UTC date and one of the seven', () => {
    const ids = new Set(EVENTS.map((e) => e.id));
    const seen = new Set();
    for (let d = 0; d < 60; d++) {
      const e = dailyEvent(T0 + d * DAY_MS);
      assert.ok(ids.has(e.id));
      assert.equal(e.id, dailyEvent(T0 + d * DAY_MS + 11 * 3600 * 1000).id);
      seen.add(e.id);
    }
    assert.ok(seen.size >= 5);
    assert.equal(utcDay(T0), '2026-10-07');
  });

  test('boosters: nine cards per booster, each pick 1 token or the per-card gem price (halved on Get the Best Cards)', () => {
    let { state, deps } = fresh();
    state = rich(state);
    assert.equal(boosterPrice('neophyte'), 50);
    assert.equal(boosterPrice('summoner'), 350);
    assert.equal(boosterPrice('archmage'), 975);
    assert.equal(boosterPrice('archmage', 'get-the-best-cards'), 488);
    assert.equal(boosterPrice('portalHigh'), 1000);
    const t = openBooster(addTokens(state, 'neophyte', 1), deps, T0, { booster: 'neophyte', open: true });
    assert.equal(t.booster.cards.length, 9);
    const d1 = drawBoosterCard(t.state, deps, T0, { booster: 'neophyte', position: 3 });
    assert.deepEqual([d1.paidWith, d1.cost, tokenCount(d1.state, 'neophyte'), d1.state.player.gems], ['token', 0, 0, 5000]);
    assert.equal(d1.state.cards.find((c) => c.uid === d1.uid).cardId, t.booster.cards[3]);
    const d2 = drawBoosterCard(d1.state, deps, T0, { booster: 'neophyte', position: 0, event: 'get-the-best-cards' });
    assert.deepEqual([d2.paidWith, d2.cost, d2.state.player.gems], ['gems', 25, 4975]);
    const portal = openBooster(state, deps, T0, { booster: 'portalHigh', portalId: 'the-dark-beyond' });
    assert.equal(portal.booster.cards.length, 9);
  });

  test('booster rarity make-up is fixed per pack (seeded)', () => {
    const { deps } = fresh();
    const rng = mulberry32(777);
    for (let i = 0; i < 50; i++) {
      const c = {};
      for (const id of rollBoosterCards(rng, deps, 'archmage')) { const r = deps.db.get(id).rarity; c[r] = (c[r] || 0) + 1; }
      assert.deepEqual(c, { rare: 2, heroic: 5, legendary: 2 });
    }
  });

  test('daily rewards: 21-day table, consecutive streak, reset after a missed day, one claim per day', () => {
    assert.deepEqual(dailyRewardFor(3), { gems: 40 });
    assert.deepEqual(dailyRewardFor(7), { tokens: 'neophyte', count: 2 });
    assert.deepEqual(dailyRewardFor(21), { tokens: 'archmage', count: 2 });
    assert.deepEqual(dailyRewardFor(22), dailyRewardFor(1));
    let { state } = fresh();
    let r = claimDaily(state, T0);
    assert.equal(r.claimed, true);
    assert.equal(r.day, 1);
    assert.equal(r.state.player.staminaPotions, 4);
    assert.equal(claimDaily(r.state, T0 + 3600 * 1000).claimed, false);
    r = claimDaily(r.state, T0 + DAY_MS);
    assert.equal(r.day, 2);
    assert.equal(r.state.player.manaPotions, 2);
    r = claimDaily(r.state, T0 + 2 * DAY_MS);
    assert.equal(r.day, 3);
    assert.equal(r.state.player.gems, 40);
    r = claimDaily(r.state, T0 + 4 * DAY_MS);
    assert.equal(r.day, 1);
    let s = r.state;
    for (let d = 5; d <= 10; d++) { r = claimDaily(s, T0 + d * DAY_MS); s = r.state; }
    assert.equal(r.day, 7);
    assert.equal(tokenCount(s, 'neophyte'), 2);
  });

  test('set collections: progress per set, gem reward once', () => {
    let { state, deps } = fresh();
    let cols = setCollections(state, deps);
    assert.equal(cols.length, 7, 'main + 2 fixture portals + the album sets with cards in the fixture db (round 5)');
    assert.equal(cols[0].id, 'main');
    assert.equal(cols[0].reward, 31700);
    assert.equal(cols[0].ownedCount, 0);
    assert.throws(() => claimCollection(state, deps, 'the-dark-beyond'), /not complete/);
    [state] = give(state, deps, 'airborne-parasite');
    [state] = give(state, deps, 'wilderness-shaper', { stage: 2 });
    cols = setCollections(state, deps);
    const tdb = cols.find((c) => c.id === 'the-dark-beyond');
    assert.equal(tdb.complete, true);
    const r = claimCollection(state, deps, 'the-dark-beyond');
    assert.equal(r.gems, 4600);
    assert.equal(r.state.player.gems, 4600);
    assert.throws(() => claimCollection(r.state, deps, 'the-dark-beyond'), /Already/);
    assert.equal(setCollections(r.state, deps).find((c) => c.id === 'the-dark-beyond').claimed, true);
  });

  test('Great Potion Deal: only on the event day, once per day, 3 potions for 60 gems', () => {
    let { state } = fresh();
    state = rich(state);
    assert.throws(() => buyPotionDeal(state, T0, 'golden-day'), /not available/);
    const r = buyPotionDeal(state, T0, 'great-potion-deal');
    assert.equal(r.cost, 60);
    assert.equal(r.state.player.gems, 4940);
    assert.equal(r.state.player.staminaPotions + r.state.player.manaPotions, 6);
    assert.throws(() => buyPotionDeal(r.state, T0, 'great-potion-deal'), /not available/);
  });
});

// ================================================================= §7 Shop and economy

describe('§7 shop', () => {
  // The round-3 booster grid (nine cards, 1 token or gems per pick) is verified by the groups above.
  test('booster grid: a token or the per-card gem price (−50 % on Get the Best Cards); the card joins the collection', () => {
    const d = deps();
    let s = fz(P.addTokens(P.addTokens(rich(fresh()), 'neophyte', 1), 'portalHigh', 1, 'the-dark-beyond'));
    for (const id of Object.keys(Sh.BOOSTERS)) assert.equal(Sh.BOOSTERS[id].token, id);
    s = fz(Sh.openBooster(s, d, T0, { booster: 'neophyte', open: true }).state);
    const cards = Sh.getBooster(s, 'neophyte').cards;
    assert.equal(cards.length, 9);
    const tok = Sh.drawBoosterCard(s, d, T0, { booster: 'neophyte', position: 3 });
    assert.deepEqual([tok.cost, tok.paidWith, P.tokenCount(tok.state, 'neophyte'), tok.state.player.gems], [0, 'token', 0, s.player.gems]);
    assert.equal(S.getCard(tok.state, tok.uid).cardId, cards[3]);
    assert.equal(S.getCard(tok.state, tok.uid).level, 1);
    assert.equal(S.getCard(tok.state, tok.uid).stage, 0);
    const gems = Sh.drawBoosterCard(fz(tok.state), d, T0, { booster: 'neophyte', position: 4, event: 'get-the-best-cards' });
    assert.deepEqual([gems.cost, gems.paidWith], [25, 'gems']);
    assert.throws(() => Sh.drawBoosterCard(fz(tok.state), d, T0, { booster: 'neophyte', position: 9 }), /No such card/);
    assert.throws(() => Sh.drawBoosterCard(fz({ ...tok.state, player: { ...tok.state.player, gems: 49 } }), d, T0, { booster: 'neophyte', position: 0 }), /gems/);
    // Neophyte, the portal's two packs, the next portal's two (coming soon), Summoner, Archmage
    const offers = Sh.shopOffers(s, d, T0, 'the-dark-beyond');
    assert.equal(offers.boosters.length, 7);
    assert.equal(offers.boosters[2].tokens, 1);
    assert.equal(offers.boosters[1].name, 'Infinite Void');
    assert.equal(offers.boosters[2].name, 'Empyrean');
  });

  test('Great Potion Deal: 3 potions for 60 gems, only on the event day, once per day', () => {
    const d = deps();
    const s = rich(fresh(), { gems: 100 });
    assert.equal(Sh.POTION_DEAL_GEMS, 60); assert.equal(Sh.POTION_DEAL_COUNT, 3);
    assert.equal(Sh.potionDealAvailable(s, T0, 'golden-day'), false);
    assert.equal(Sh.potionDealAvailable(s, T0, 'great-potion-deal'), true);
    assert.throws(() => Sh.buyPotionDeal(s, T0, 'golden-day'), /not available/);
    const r = Sh.buyPotionDeal(s, T0, 'great-potion-deal');
    assert.equal(r.cost, 60);
    assert.equal(r.state.player.gems, 40);
    assert.equal(r.state.player.staminaPotions + r.state.player.manaPotions, s.player.staminaPotions + s.player.manaPotions + 3);
    assert.equal(Sh.potionDealAvailable(fz(r.state), T0 + 60 * MIN, 'great-potion-deal'), false, 'once per day');
    assert.throws(() => Sh.buyPotionDeal(fz(r.state), T0 + 60 * MIN, 'great-potion-deal'), /not available/);
    assert.equal(Sh.potionDealAvailable(fz(r.state), T0 + DAY, 'great-potion-deal'), true);
    assert.throws(() => Sh.buyPotionDeal(fz({ ...s, player: { ...s.player, gems: 59 } }), T0, 'great-potion-deal'), /gems/);
    assert.equal(Sh.shopOffers(s, d, T0).potionDeal, Sh.dailyEvent(T0).id === 'great-potion-deal' ? Sh.shopOffers(s, d, T0).potionDeal : null);
  });

  test('daily rewards: the 21-day table of the brief, consecutive-day streak, reset after a missed day, wrap after day 21', () => {
    const table = [
      { stamina: 2 }, { mana: 1, stamina: 1 }, { gems: 40 }, { stamina: 2 }, { mana: 1, stamina: 1 }, { gems: 80 }, { tokens: 'neophyte', count: 2 },
      { stamina: 3 }, { mana: 1, stamina: 2 }, { gems: 120 }, { stamina: 3 }, { mana: 1, stamina: 2 }, { gems: 160 }, { tokens: 'summoner', count: 2 },
      { stamina: 4 }, { mana: 2, stamina: 2 }, { gems: 200 }, { stamina: 4 }, { mana: 2, stamina: 2 }, { gems: 240 }, { tokens: 'archmage', count: 2 },
    ];
    assert.deepEqual(Sh.DAILY_REWARDS, table);
    table.forEach((r, i) => assert.deepEqual(Sh.dailyRewardFor(i + 1), r));
    assert.deepEqual(Sh.dailyRewardFor(22), table[0]);
    assert.deepEqual(Sh.dailyRewardFor(42), table[20]);
    const s0 = fz({ ...fresh(), player: { ...fresh().player, staminaPotions: 0, manaPotions: 0, gems: 0 } });
    const d1 = Sh.claimDaily(s0, T0);
    assert.equal(d1.claimed, true); assert.equal(d1.day, 1);
    assert.equal(d1.state.player.staminaPotions, 2);
    assert.equal(d1.state.daily.streak, 1); assert.equal(d1.state.daily.lastClaim, '2026-10-07');
    const claimed = fz(d1.state);
    const same = Sh.claimDaily(claimed, T0 + 5 * 60 * MIN);
    assert.equal(same.claimed, false); assert.equal(same.state, claimed);
    const d2 = Sh.claimDaily(fz(d1.state), T0 + DAY);
    assert.equal(d2.day, 2);
    assert.equal(d2.state.player.staminaPotions, 3); assert.equal(d2.state.player.manaPotions, 1);
    const d3 = Sh.claimDaily(fz(d2.state), T0 + 2 * DAY);
    assert.equal(d3.day, 3); assert.equal(d3.state.player.gems, 40);
    const missed = Sh.claimDaily(fz(d3.state), T0 + 4 * DAY);
    assert.equal(missed.day, 1, 'a missed day resets the streak');
    assert.equal(missed.state.player.staminaPotions, 5);
    // a full cycle: day 7 → 2 Neophyte, day 14 → 2 Summoner, day 21 → 2 Archmage, day 22 → day-1 reward again
    let s = s0;
    for (let i = 0; i < 22; i++) {
      const r = Sh.claimDaily(s, T0 + i * DAY);
      assert.equal(r.day, i + 1);
      s = fz(r.state);
    }
    assert.equal(P.tokenCount(s, 'neophyte'), 2);
    assert.equal(P.tokenCount(s, 'summoner'), 2);
    assert.equal(P.tokenCount(s, 'archmage'), 2);
    assert.equal(s.player.gems, 40 + 80 + 120 + 160 + 200 + 240);
    assert.equal(s.player.staminaPotions, 2 + 1 + 2 + 1 + 3 + 2 + 3 + 2 + 4 + 2 + 4 + 2 + 2);
    assert.equal(s.player.manaPotions, 1 + 1 + 1 + 1 + 2 + 2);
    assert.equal(s.daily.streak, 22);
  });

  test('daily events: one of the 7 per UTC day, deterministic, every event occurs over a year', () => {
    const ids = ['infinite-wisdom', 'drinking-contest', 'card-piece-day', 'double-league-points', 'great-potion-deal', 'get-the-best-cards', 'golden-day'];
    assert.deepEqual(Sh.EVENTS.map((e) => e.id), ids);
    const seen = new Set();
    for (let day = 0; day < 365; day++) {
      const e = Sh.dailyEvent(T0 + day * DAY);
      assert.ok(ids.includes(e.id));
      assert.equal(Sh.dailyEvent(S.utcDayStart(T0 + day * DAY)).id, e.id, 'same event all day');
      assert.equal(Sh.dailyEvent(S.utcDayStart(T0 + day * DAY) + DAY - 1).id, e.id);
      seen.add(e.id);
    }
    assert.equal(seen.size, 7);
  });

  test('set collections: owning every set card (any stage) grants the gem reward once', () => {
    const d = deps();
    let s = fresh();
    const cols = Sh.setCollections(s, d);
    assert.equal(cols.length, 13, 'main, 8 portals, 4 main-line album sets');
    assert.deepEqual(cols.slice(9).map((c) => [c.id, c.total, c.reward]), [['dwarven-apprentice', 8, 50], ['elven-novice', 8, 50], ['orc-grunt', 8, 50], ['arborearch', 7, 3500]]);
    assert.equal(cols[0].id, 'main'); assert.equal(cols[0].total, 17); assert.equal(cols[0].reward, 31700);
    assert.equal(cols[0].complete, false); assert.equal(cols[0].claimed, false);
    const tdb = cols.find((c) => c.id === 'the-dark-beyond');
    assert.equal(tdb.total, 8); assert.equal(tdb.reward, 4600);
    assert.throws(() => Sh.claimCollection(s, d, 'the-dark-beyond'), /not complete/);
    assert.throws(() => Sh.claimCollection(s, d, 'nope'), /Unknown/);
    portal(0).cards.forEach((id, i) => { s = give(s, d, id, { stage: i % 5, level: 1 })[0]; });
    const now = Sh.setCollections(s, d).find((c) => c.id === 'the-dark-beyond');
    assert.equal(now.ownedCount, 8); assert.equal(now.complete, true);
    const r = Sh.claimCollection(s, d, 'the-dark-beyond');
    assert.equal(r.gems, 4600);
    assert.equal(r.state.player.gems, s.player.gems + 4600);
    assert.deepEqual(r.state.collections.claimed, ['the-dark-beyond']);
    assert.equal(Sh.setCollections(fz(r.state), d).find((c) => c.id === 'the-dark-beyond').claimed, true);
    assert.throws(() => Sh.claimCollection(fz(r.state), d, 'the-dark-beyond'), /Already/);
    // selling a set card afterwards does not take the reward back, and the main set pays 31,700
    let m = fz(r.state);
    for (const id of QUESTS.main.cards) m = give(m, d, id, { stage: 2 })[0];
    assert.equal(Sh.claimCollection(m, d, 'main').gems, 31700);
    for (const p of QUESTS.portals) assert.equal(Sh.setCollections(m, d).find((c) => c.id === p.id).reward, p.gemReward);
  });

  test('gems are only earned in-game: level-ups, daily rewards, league, sets, boss drops; tokens stack per portal', () => {
    assert.equal(P.levelUpRewards(2).gems, 5);
    assert.equal(P.levelUpRewards(12).gems, 50);
    const s = fresh();
    assert.equal(s.player.gems, 0);
    const t = P.addTokens(P.addTokens(s, 'portalLow', 2, 'dragon-hunt'), 'portalLow', 1, 'dying-dreams');
    assert.equal(P.tokenCount(t, 'portalLow', 'dragon-hunt'), 2);
    assert.equal(P.tokenCount(t, 'portalLow', 'dying-dreams'), 1);
    assert.equal(P.tokenCount(t, 'portalLow', 'desert-twilight'), 0);
    assert.equal(P.addGold(s, -1e9).player.gold, 0, 'gold never negative');
    assert.throws(() => P.spendGold(s, 301), /gold/);
    assert.throws(() => P.spendGems(s, 1), /gems/);
  });
});

describe('daily event on the save clock (debug.addDays)', () => {
  test('eventClock adds daily.dayShift days; a normal save follows the real clock', () => {
    const s = S.newGame('T', 1, T0);
    assert.equal(eventClock(s, T0), T0);
    assert.equal(eventClock(null, T0), T0);
    assert.equal(eventClock({ ...s, daily: { ...s.daily, dayShift: 3 } }, T0), T0 + 3 * DAY);
  });

  test('the event changes when the save is shifted by days (dayShift kept through shiftClocks)', () => {
    const s = S.newGame('T', 1, T0);
    const shifted = addDays({ ...s, daily: { ...s.daily, dayShift: 0 } }, 1);
    assert.equal(shifted.daily.dayShift, 0, 'shiftClocks keeps the field');
    const seen = new Set();
    for (let d = 0; d < 14; d++) seen.add(dailyEvent(eventClock({ ...s, daily: { ...s.daily, dayShift: d } }, T0)).id);
    assert.ok(seen.size >= 3, `events over 14 shifted days: ${[...seen]}`);
  });

  test('shop: booster prices, the -50 % badge and the potion deal follow the given event', () => {
    const deps = makeDeps();
    const s = S.newGame('T', 1, T0);
    const base = shopOffers(s, deps, T0);
    const best = offersForEvent(base, s, T0, { id: 'get-the-best-cards' });
    const neo = (o) => o.boosters.find((b) => b.id === 'neophyte');
    assert.equal(neo(best).discounted, true);
    assert.equal(neo(best).price, Math.ceil(neo(offersForEvent(base, s, T0, { id: 'golden-day' })).price / 2));
    assert.equal(offersForEvent(base, s, T0, { id: 'golden-day' }).potionDeal, null);
    assert.equal(offersForEvent(base, s, T0, { id: 'great-potion-deal' }).potionDeal.gems, POTION_DEAL_GEMS);
    const bought = { ...s, daily: { ...s.daily, potionDealDay: S.utcDay(T0) } };
    assert.equal(offersForEvent(base, bought, T0, { id: 'great-potion-deal' }).potionDeal, null, 'once per day');
    assert.equal(offersForEvent(base, s, T0, undefined), base, 'no event given: shopOffers as is');
  });
});
