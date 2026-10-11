'use strict';
/**
 * src/game: the save (new game, migration, deck slots, rng), the player (regen, level-ups, stat points,
 * potions, fight xp), persistence and purity.
 * Two kinds of tests: the "(fixture catalog)" groups run on the 21-card fixture catalog and a stub engine
 * (tests/fixtures-game); the "§" groups verify the rules of docs/design/game-design.md (and the brief §5 tables
 * it points to) against the real data through the real cards-db and stats modules, with the stub engine where a
 * fight needs a known outcome. Every state the "§" groups hand to a game function is deep-frozen first (`fz`),
 * so any mutation of an input throws.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../src/core/rng.js';
import { newGame, migrate, takeRng, isUnlocked, slotUnlocked, deckSlotCount } from '../src/game/state.js';
import {
  applyRegen, addPlayerXp, spendStatPoints, needsPotion, drinkPotion, buyAndDrinkPotion, playerFightXp, cardFightXp,
  levelUpRewards,
} from '../src/game/player.js';
import * as stats from '../src/core/stats.js';
import * as S from '../src/game/state.js';
import * as P from '../src/game/player.js';
import * as C from '../src/game/collection.js';
import * as T from '../src/game/training.js';
import * as Fu from '../src/game/fusion.js';
import * as Q from '../src/game/quests.js';
import * as A from '../src/game/arena.js';
import * as Pc from '../src/game/pieces.js';
import * as L from '../src/game/league.js';
import * as Sh from '../src/game/shop.js';
import { makeDeps } from './fixtures-game/deps.js';
import {
  T0, MIN, DAY, db, deps, realDeps, fz, fresh, tutorialStart, rich, give, sample, mainNode, openSlots,
} from './fixtures/real.js';
import * as stub from './fixtures-game/game.js';

describe('state and player (fixture catalog)', () => {
  const { fresh } = stub; // the fixture-catalog builders

  // ---------------------------------------------------------------- state

  // DECISIONS D1 / tutorial.md §3 items 2 and 11: Envoy in the deck, Master Brewer in the collection, 200 gold, 0 gems.
  test('newGame: Envoy in deck slot 3, Master Brewer in the collection, 200 gold, no gems or potions, 2 open slots', () => {
    const deps = makeDeps();
    const state = newGame('Tester', 4242, T0, deps);
    assert.deepEqual(state.cards.map((c) => c.cardId), ['envoy', 'master-brewer']);
    assert.equal(state.deck[2], state.cards[0].uid);
    assert.deepEqual(state.deck.filter(Boolean).length, 1);
    assert.equal(deckSlotCount(state), 2);
    assert.deepEqual(openSlots(state), [1, 2]);
    assert.equal(state.player.name, 'Tester');
    assert.equal(state.player.gold, 200);
    assert.equal(state.player.gems, 0);
    assert.equal(state.player.staminaPotions, 0);
    assert.equal(state.player.manaPotions, 0);
    assert.equal(state.player.hpMax, 1500);
    assert.equal(state.quests.main.unlocked, 1);
    assert.equal(state.createdAt, T0);
  });

  test('migrate fills defaults and keeps uids above the counter', () => {
    const s = migrate({ seed: 7, cards: [{ uid: 'c9', cardId: 'envoy' }], player: { name: 'Old', gold: 12 } }, T0);
    assert.equal(s.version, 1);
    assert.equal(s.player.name, 'Old');
    assert.equal(s.player.gold, 12);
    assert.equal(s.player.staminaMax, 50);
    assert.equal(s.cards[0].evolveQuality, 1);
    assert.equal(s.uidCounter, 9);
    assert.deepEqual(s.deck, [null, null, null, null, null]);
    assert.equal(s.sim.leagueScore, 0);
  });

  // DECISIONS D1/D2: fusion 2, arena 4, training 5, league 6; slot 3 after the quest-2 boss (tutorial.md §1.5).
  test('deck slots open by quest progress; features by level (fusion 2, arena 4, training 5, league 6)', () => {
    const state = newGame('Tester', 4242, T0, makeDeps());
    assert.equal(slotUnlocked(state, 2), true);
    assert.equal(slotUnlocked(state, 3), false);
    const q2 = { ...state, quests: { ...state.quests, main: { unlocked: 3, done: 2, firstWins: [1, 2] } } };
    assert.deepEqual(openSlots(q2), [1, 2, 3]);
    const q6 = { ...state, quests: { ...state.quests, main: { unlocked: 7, done: 6, firstWins: [1, 2, 3, 4, 5, 6] } } };
    assert.deepEqual(openSlots(q6), [1, 2, 3, 4]);
    const q7 = { ...state, quests: { ...state.quests, main: { unlocked: 8, done: 7, firstWins: [1, 2, 3, 4, 5, 6, 7] } } };
    assert.deepEqual(openSlots(q7), [0, 1, 2, 3, 4]);
    assert.equal(isUnlocked(q2, 'cardslot4'), true);
    assert.equal(isUnlocked(q2, 'cardslot1'), false);
    assert.deepEqual(openSlots(migrate({ seed: 1, player: { level: 1 } }, T0)), [1, 2, 3], 'an old level-1 save keeps the legacy table');
    const at = (level) => ({ ...state, player: { ...state.player, level } });
    assert.equal(isUnlocked(state, 'quests'), true);
    assert.equal(isUnlocked(state, 'fusion'), false);
    assert.equal(isUnlocked(at(2), 'evolve'), true);
    assert.equal(isUnlocked(at(3), 'arena'), false);
    assert.equal(isUnlocked(at(4), 'pvp'), true);
    assert.equal(isUnlocked(at(4), 'pieces'), true);
    assert.equal(isUnlocked(at(4), 'training'), false);
    assert.equal(isUnlocked(at(5), 'enhance'), true);
    assert.equal(isUnlocked(at(5), 'league'), false);
    assert.equal(isUnlocked(at(6), 'leagues'), true);
  });

  test('takeRng is reproducible from the save and advances the counter', () => {
    const { state, deps } = fresh();
    const a = takeRng(state, deps);
    const b = takeRng(state, deps);
    assert.equal(a.rng.next(), b.rng.next());
    assert.equal(a.state.rngStep, 1);
    const c = takeRng(a.state, deps);
    assert.notEqual(c.seed, a.seed);
  });

  // ---------------------------------------------------------------- player

  test('regen: 1 stamina and 1 mana per real minute up to the max', () => {
    const { state } = fresh();
    const low = { ...state, player: { ...state.player, stamina: 10, mana: 45, regenAt: T0 } };
    const s1 = applyRegen(low, T0 + 5 * 60 * 1000 + 30 * 1000);
    assert.equal(s1.player.stamina, 15);
    assert.equal(s1.player.mana, 50);
    assert.equal(s1.player.regenAt, T0 + 5 * 60 * 1000);
    const s2 = applyRegen(s1, T0 + 2 * 60 * 60 * 1000);
    assert.equal(s2.player.stamina, 50);
    assert.equal(applyRegen(low, T0 + 1000).player.stamina, 10);
  });

  // Level-up dialog (tutorial.md §1.6, playthroughs-2.md §1.4): L2 100 gold + 5 gems, L3 150 + stamina potion,
  // L5 250 + mana potion, L6 300 + token, L7 350 + 50 gems; 12 points; stamina and mana refilled.
  test('level-up grants 12 stat points, refills bars and the level rewards (gold 50 × level, gems, potions, token)', () => {
    const { state, deps } = fresh();
    const tired = { ...state, player: { ...state.player, stamina: 1, mana: 2, gold: 0, gems: 0 } };
    const r = addPlayerXp(tired, deps, deps.stats.playerXpToNext(1));
    assert.deepEqual(r.levelUps, [2]);
    assert.equal(r.state.player.level, 2);
    assert.equal(r.state.player.statPoints, 12);
    assert.equal(r.state.player.stamina, 50);
    assert.equal(r.state.player.mana, 50);
    assert.equal(r.gems, 5);
    assert.equal(r.gold, 100);
    assert.deepEqual(r.levelUpDetails, [{ level: 2, rewards: levelUpRewards(2), statPoints: 12, unlocked: ['fusion'] }]);
    assert.deepEqual([r.state.player.gold, r.state.player.gems], [100, 5]);
    let xp = 0;
    for (let l = 1; l < 7; l++) xp += deps.stats.playerXpToNext(l);
    const r2 = addPlayerXp(tired, deps, xp);
    assert.equal(r2.state.player.level, 7);
    assert.deepEqual(r2.levelUps, [2, 3, 4, 5, 6, 7]);
    assert.equal(r2.gold, 100 + 150 + 150 + 250 + 300 + 350); // level 4 pays 150 (tutorial video)
    assert.equal(r2.gems, 55);
    assert.equal(r2.state.player.staminaPotions, 2 + 2);
    assert.equal(r2.state.player.manaPotions, 1 + 1);
    assert.equal(r2.state.player.tokens.neophyte, 1);
    assert.equal(r2.state.player.statPoints, 72);
    assert.deepEqual(r2.levelUpDetails.map((d) => d.unlocked), [['fusion'], [], ['arena'], ['training'], ['league'], []]);
  });

  test('stat points: 1 pt = +1 stamina / +1 mana / +30 hp; over-spending throws', () => {
    const { state } = fresh();
    const s = { ...state, player: { ...state.player, statPoints: 12 } };
    const r = spendStatPoints(s, { stamina: 4, mana: 3, hp: 5 });
    assert.equal(r.player.staminaMax, 54);
    assert.equal(r.player.manaMax, 53);
    assert.equal(r.player.hpMax, 1650);
    assert.equal(r.player.statPoints, 0);
    assert.throws(() => spendStatPoints(s, { hp: 13 }), /stat points/);
  });

  test('potion dialog decision: use a potion, or buy one for 40 gems (20 on Drinking Contest)', () => {
    const { state } = fresh();
    const low = { ...state, player: { ...state.player, stamina: 2, gems: 50 } };
    const d = needsPotion(low, 'stamina', 3, null);
    assert.equal(d.needed, true);
    assert.equal(d.hasPotion, true);
    assert.equal(d.price, 40);
    assert.equal(d.canBuy, true);
    assert.equal(needsPotion(low, 'stamina', 2, null).needed, false);
    const drunk = drinkPotion(low, 'stamina');
    assert.equal(drunk.player.stamina, 50);
    assert.equal(drunk.player.staminaPotions, 1);
    const bought = buyAndDrinkPotion(low, 'mana', { id: 'drinking-contest' });
    assert.equal(bought.player.gems, 30);
    assert.equal(bought.player.mana, 50);
    assert.equal(needsPotion(low, 'mana', 99, 'drinking-contest').price, 20);
    assert.throws(() => buyAndDrinkPotion({ ...low, player: { ...low.player, gems: 5 } }, 'stamina'), /gems/);
  });

  // PvP player xp: a level-8 rival ~21 on a win, ~5 on a loss (playthroughs-2.md §1.3).
  test('fight xp formulas', () => {
    assert.equal(playerFightXp(8, true), 22);
    assert.equal(playerFightXp(8, false), 6);
    assert.equal(playerFightXp(10, true), 26);
    assert.equal(cardFightXp(20, false, false), 20);
    assert.equal(cardFightXp(20, true, false), 30);
    assert.equal(cardFightXp(20, true, true), 60);
  });
});

// ================================================================= §3 Character

describe('§3 character', () => {
  test('start: level 1, 50 stamina, 50 mana, 1500 HP, 0 xp, 0 unspent points, max level 200', () => {
    const s = fresh();
    assert.equal(s.player.level, 1);
    assert.equal(s.player.stamina, 50); assert.equal(s.player.staminaMax, 50);
    assert.equal(s.player.mana, 50); assert.equal(s.player.manaMax, 50);
    assert.equal(s.player.hpMax, 1500);
    assert.equal(s.player.xp, 0);
    assert.equal(s.player.statPoints, 0);
    assert.equal(P.MAX_LEVEL, 200);
  });

  // PvP xp on the level-6 bar: ~21 for a won fight against a level-8 rival, ~5 for a loss (playthroughs-2.md §1.3).
  test('PvP player xp per fight = 1.5 + 0.5 × opponentLevel, ×4 on a win; quest bosses give none', () => {
    assert.equal(P.playerFightXp(8, true), 22);
    assert.equal(P.playerFightXp(8, false), 6);
    assert.equal(P.playerFightXp(0, true), 6);
    for (let l = 0; l <= 200; l += 7) {
      assert.equal(P.playerFightXp(l, false), Math.round(1.5 + 0.5 * l));
      assert.equal(P.playerFightXp(l, true), Math.round((1.5 + 0.5 * l) * 4));
    }
    assert.equal(P.QUEST_BOSS_PLAYER_XP, 0);
  });

  // 1 xp per stamina from taps; level 2 after ~50 stamina (tutorial.md §1.6), level 6 ≈ 240, level 7 ≈ 274.
  test('xpToNext(L) = round(50 × L^0.875) from level 5, the round-5 low table below, Infinity at the cap', () => {
    for (let l = 5; l < 200; l++) assert.equal(stats.playerXpToNext(l), Math.round(50 * l ** 0.875), 'level ' + l);
    assert.deepEqual([1, 2, 3, 4].map((l) => stats.playerXpToNext(l)), [47, 47, 92, 94]);
    assert.equal(stats.playerXpToNext(6), 240);
    assert.equal(stats.playerXpToNext(7), 274);
    assert.equal(stats.playerXpToNext(200), Infinity);
  });

  // Level-up dialog rewards (tutorial.md §1.6, screens.md level-up, playthroughs-2.md §1.4): gold 50 × level;
  // L2 5 gems, L3 stamina potion, L5 mana potion, L6 Neophyte token, L7 50 gems.
  test('level-up: +12 stat points, bars refilled, level rewards, multiple level-ups in one grant', () => {
    const d = deps();
    const s0 = fz({ ...fresh(), player: { ...fresh().player, stamina: 3, mana: 4, gold: 0, gems: 0, staminaPotions: 0, manaPotions: 0 } });
    const r1 = P.addPlayerXp(s0, d, stats.playerXpToNext(1));
    assert.equal(r1.state.player.level, 2);
    assert.equal(r1.state.player.xp, 0);
    assert.equal(r1.state.player.statPoints, 12);
    assert.equal(r1.state.player.stamina, 50);
    assert.equal(r1.state.player.mana, 50);
    assert.deepEqual(r1.levelUps, [2]);
    assert.deepEqual([r1.gold, r1.gems, r1.state.player.gold, r1.state.player.gems], [100, 5, 100, 5]);
    const need15 = [1, 2, 3, 4].reduce((sum, l) => sum + stats.playerXpToNext(l), 0);
    assert.equal(need15, 47 + 47 + 92 + 94);
    const r5 = P.addPlayerXp(s0, d, need15 + 7);
    assert.equal(r5.state.player.level, 5);
    assert.equal(r5.state.player.xp, 7);
    assert.equal(r5.state.player.statPoints, 48);
    assert.deepEqual(r5.levelUps, [2, 3, 4, 5]);
    assert.equal(r5.gold, 100 + 150 + 150 + 250); // level 4 pays 150 (tutorial video)
    assert.equal(r5.gems, 5);
    assert.deepEqual([r5.state.player.staminaPotions, r5.state.player.manaPotions], [2, 1]);
    assert.deepEqual(r5.levelUpDetails.map((x) => [x.level, x.statPoints, x.unlocked]), [[2, 12, ['fusion']], [3, 12, []], [4, 12, ['arena']], [5, 12, ['training']]]);
    assert.deepEqual(P.levelUpRewards(6), { level: 6, gold: 300, gems: 0, potions: [], tokens: ['neophyte'] });
    assert.deepEqual(P.levelUpRewards(7), { level: 7, gold: 350, gems: 50, potions: [], tokens: [] });
    assert.deepEqual(P.levelUpRewards(1), { level: 1, gold: 0, gems: 0, potions: [], tokens: [] });
    for (let l = 2; l <= 200; l++) {
      const r = P.levelUpRewards(l);
      assert.equal(r.gold, l === 4 ? 150 : 50 * l);
      assert.equal((r.gems > 0) + r.potions.length + r.tokens.length, 1, 'one extra per level ' + l);
    }
    // cap
    const s199 = fz({ ...s0, player: { ...s0.player, level: 199 } });
    const r200 = P.addPlayerXp(s199, d, 1e9);
    assert.equal(r200.state.player.level, 200);
    assert.equal(r200.state.player.xp, 0);
    assert.equal(P.addPlayerXp(fz(r200.state), d, 500).xp, 0);
    assert.equal(P.addPlayerXp(fz(r200.state), d, 500).state.player.level, 200);
  });

  test('stat points: 1 pt = +1 stamina, +1 mana or +30 HP; cannot overspend; preview for the dialog', () => {
    const s = fz({ ...fresh(), player: { ...fresh().player, statPoints: 12 } });
    assert.deepEqual(P.previewStatPoints(s, { stamina: 1, mana: 1, hp: 10 }), { ok: true, spent: 12, pointsLeft: 0, hpMax: 1800, staminaMax: 51, manaMax: 51 });
    assert.equal(P.previewStatPoints(s, { hp: 13 }).ok, false);
    const r = P.spendStatPoints(s, { stamina: 1, mana: 1, hp: 10 });
    assert.equal(r.player.statPoints, 0);
    assert.equal(r.player.staminaMax, 51); assert.equal(r.player.stamina, 51);
    assert.equal(r.player.manaMax, 51); assert.equal(r.player.mana, 51);
    assert.equal(r.player.hpMax, 1500 + 300);
    assert.equal(P.HP_PER_POINT, 30);
    assert.equal(P.STAT_POINTS_PER_LEVEL, 12);
    assert.throws(() => P.spendStatPoints(s, { hp: 13 }), /stat points/);
    assert.equal(P.spendStatPoints(s, {}), s);
  });

  test('regeneration: 1 stamina and 1 mana per real minute up to the max', () => {
    const base = fresh();
    const s = fz({ ...base, player: { ...base.player, stamina: 10, mana: 45, regenAt: T0 } });
    assert.equal(P.applyRegen(s, T0 + 59 * 1000), s);
    const r1 = P.applyRegen(s, T0 + 90 * 1000);
    assert.equal(r1.player.stamina, 11);
    assert.equal(r1.player.mana, 46);
    assert.equal(r1.player.regenAt, T0 + MIN, 'only whole minutes are consumed');
    const r7 = P.applyRegen(s, T0 + 7 * MIN);
    assert.equal(r7.player.stamina, 17);
    assert.equal(r7.player.mana, 50, 'capped at max');
    const rLong = P.applyRegen(s, T0 + 2 * DAY);
    assert.equal(rLong.player.stamina, 50);
    assert.equal(rLong.player.mana, 50);
    assert.equal(rLong.player.regenAt, T0 + 2 * DAY);
  });

  test('potions: refill to max; 40 gems, 20 on Drinking Contest; the dialog data', () => {
    assert.equal(P.potionPrice(null), 40);
    assert.equal(P.potionPrice('drinking-contest'), 20);
    assert.equal(P.potionPrice({ id: 'drinking-contest' }), 20);
    assert.equal(P.potionPrice({ id: 'golden-day' }), 40);
    const base = fresh();
    const s = fz({ ...base, player: { ...base.player, stamina: 2, mana: 1, gems: 45, staminaMax: 70, manaMax: 60 } });
    const np = P.needsPotion(s, 'stamina', 3, null);
    assert.equal(np.needed, true); assert.equal(np.missing, 1); assert.equal(np.price, 40);
    assert.equal(np.hasPotion, true); assert.equal(np.potions, 2); assert.equal(np.canBuy, true);
    assert.equal(P.needsPotion(s, 'stamina', 2, null).needed, false);
    const drank = P.drinkPotion(s, 'stamina');
    assert.equal(drank.player.stamina, 70);
    assert.equal(drank.player.staminaPotions, 1);
    const drankM = P.drinkPotion(s, 'mana');
    assert.equal(drankM.player.mana, 60);
    assert.equal(drankM.player.manaPotions, 0);
    assert.throws(() => P.drinkPotion(fz(drankM), 'mana'), /No mana potion/);
    const bought = P.buyAndDrinkPotion(s, 'mana', null);
    assert.equal(bought.player.gems, 5);
    assert.equal(bought.player.mana, 60);
    assert.equal(bought.player.manaPotions, 1, 'a bought potion is consumed immediately');
    const boughtEvent = P.buyAndDrinkPotion(s, 'stamina', 'drinking-contest');
    assert.equal(boughtEvent.player.gems, 25);
    assert.throws(() => P.buyAndDrinkPotion(fz({ ...s, player: { ...s.player, gems: 39 } }), 'mana', null), /gems/);
  });

  test('deck slot unlocks: slots 2–4 at level 1, slot 5 at level 3, slot 1 at level 5', () => {
    // the legacy level table now only sizes saves written before round 3
    const atLevel = (level) => openSlots(S.migrate({ seed: 1, player: { level } }, T0));
    assert.deepEqual(atLevel(1), [1, 2, 3]);
    assert.deepEqual(atLevel(2), [1, 2, 3]);
    assert.deepEqual(atLevel(3), [1, 2, 3, 4]);
    assert.deepEqual(atLevel(4), [1, 2, 3, 4]);
    assert.deepEqual(atLevel(5), [0, 1, 2, 3, 4]);
    const s = fresh();
    assert.throws(() => C.placeInDeck(s, deps(), s.cards[0].uid, 0), /locked/);
    assert.throws(() => C.placeInDeck(s, deps(), s.cards[0].uid, 4), /locked/);
  });

  // DECISIONS D1/D2: fusion 2, arena 4, training 5, league 6 (client feature ids evolve / pvp / enhance / leagues).
  test('feature unlocks: Fusion 2, Arena 4, Training 5, League 6; map, Cards, Shop always open', () => {
    assert.deepEqual(S.FEATURE_LEVELS, { quests: 1, cards: 1, shop: 1, fusion: 2, arena: 4, pieces: 4, replays: 4, training: 5, league: 6 });
    const at = (level) => fz({ ...fresh(), player: { ...fresh().player, level } });
    for (const f of ['quests', 'cards', 'shop']) assert.equal(S.isUnlocked(at(1), f), true);
    for (const [f, lvl] of [['fusion', 2], ['evolve', 2], ['arena', 4], ['pvp', 4], ['pieces', 4], ['training', 5], ['enhance', 5], ['league', 6], ['leagues', 6]]) {
      assert.equal(S.isUnlocked(at(lvl - 1), f), false, f);
      assert.equal(S.isUnlocked(at(lvl), f), true, f);
    }
    assert.equal(S.isUnlocked(at(200), 'nonsense'), false);
    assert.deepEqual([2, 3, 4, 5, 6, 7].map(S.featuresUnlockedAt), [['fusion'], [], ['arena'], ['training'], ['league'], []]);
  });

  // Slots open by quest progress: 2 at the start (slots 2 and 3), slot 4 after Q2, slot 1 after Q4, slot 5 after
  // Q6 (tutorial.md §1.5 "Card Slot Unlocked! Your deck can now hold 3 cards.", §1.10; playthroughs.md §1.5).
  // 1.7.0 tutorial (exploration/research/round3/tutorial-v2.md §2.12, §4.5, §6.10): slots 2-3 open, Q2 opens slot 4, Q4 slot 5, Q7 slot 1
  test('deck slots: 2 open at the start, the 3rd after the quest-2 boss, 4th after Q4, 5th after Q7; old saves keep theirs', () => {
    const s = tutorialStart();
    assert.equal(S.deckSlotCount(s), 2);
    assert.deepEqual(openSlots(s), [1, 2]);
    assert.throws(() => C.placeInDeck(s, deps(), s.cards[1].uid, 3), /locked/);
    assert.equal(C.placeInDeck(s, deps(), s.cards[1].uid, 1).state.deck[1], s.cards[1].uid);
    const u2 = S.unlockSlotsForQuest(s, 'main', 2);
    assert.equal(u2.slots, 3);
    assert.deepEqual(openSlots(u2.state), [1, 2, 3]);
    assert.equal(S.unlockSlotsForQuest(u2.state, 'main', 2).slots, null, 'only once');
    assert.equal(S.unlockSlotsForQuest(u2.state, 'main', 3).slots, null);
    assert.equal(S.unlockSlotsForQuest(u2.state, 'dragon-hunt', 4).slots, null);
    const u4 = S.unlockSlotsForQuest(u2.state, 'main', 4);
    assert.deepEqual(openSlots(u4.state), [1, 2, 3, 4]);
    assert.equal(S.unlockSlotsForQuest(u4.state, 'main', 6).slots, null);
    assert.deepEqual(openSlots(S.unlockSlotsForQuest(u4.state, 'main', 7).state), [0, 1, 2, 3, 4]);
    // a pre-round-3 save keeps every slot it had (level table) and every slot that holds a card
    const old = S.migrate({ seed: 1, player: { level: 3 }, deck: [null, 'c1', null, null, 'c2'], cards: [{ uid: 'c1', cardId: 'envoy' }, { uid: 'c2', cardId: 'scout' }] }, T0);
    assert.equal(old.player.deckSlots, 4);
    assert.ok(openSlots(old).includes(4) && openSlots(old).includes(1));
    assert.equal(S.migrate({ seed: 1, player: { level: 1 } }, T0).player.deckSlots, 3);
    assert.equal(S.migrate({ seed: 1, player: { level: 7 } }, T0).player.deckSlots, 5);
    assert.equal(S.migrate(JSON.parse(JSON.stringify(s)), T0).player.deckSlots, 2, 'a round-3 save keeps its count');
  });

  test('profile: name editable (20 chars), avatar one of 12', () => {
    const s = fresh();
    assert.equal(P.editProfile(s, { name: '  Morden the Great and Terrible  ' }).player.name, 'Morden the Great and');
    assert.equal(P.editProfile(s, { avatar: 11 }).player.avatar, 11);
    assert.equal(P.editProfile(s, { avatar: 12 }).player.avatar, 0);
    assert.equal(P.editProfile(s, { name: '   ' }).player.name, 'Tester');
  });
});

// ================================================================= §10 Persistence and purity

describe('§10 persistence and purity', () => {
  /** A long, mixed scenario: every subsystem touched, everything frozen on the way in. */
  function scenario(d) {
    let s = fz({ ...rich(fresh(d), { gems: 3000 }), seed: 99 });
    s = fz(Sh.claimDaily(s, T0).state);
    s = fz(Q.startQuest(s, d, T0, { line: 'main', n: 1 }).state);
    while (!s.quests.active.bossReady) s = fz(Q.tapMinion(s, d, T0, {}).state);
    s = fz(Q.prepareBoss(s, d, T0).state);
    s = fz(Q.fightBoss(s, d, T0 + MIN, {}).state);
    s = fz(Q.startQuest(s, d, T0 + 2 * MIN, { line: 'the-dark-beyond', n: 1 }).state);
    s = fz(Q.tapMinion(s, d, T0 + 2 * MIN, {}).state);
    s = fz(A.ensureOffers(s, d, T0 + 3 * MIN).state);
    s = fz(A.fightArena(s, d, T0 + 3 * MIN, { offerIndex: 1 }).state);
    s = fz(A.rollOffers(s, d, T0 + 4 * MIN));
    s = fz(L.openLeague(s, d, T0 + 5 * MIN, {}).state);
    s = fz(L.fightLeague(s, d, T0 + 5 * MIN, { simId: s.sim.league.simIds[2] }).state);
    s = fz(Sh.openBooster(s, d, T0 + 6 * MIN, { booster: 'summoner', open: true }).state);
    s = fz(Sh.drawBoosterCard(s, d, T0 + 6 * MIN, { booster: 'summoner', position: 0 }).state);
    s = fz(Pc.buyFirstPiece(s, d, T0 + 7 * MIN, {}).state);
    s = fz(Pc.addPiece(s, d, T0 + 7 * MIN, sample('rare', 2).id).state);
    s = fz(Pc.fightHolder(s, d, T0 + 8 * MIN, { index: 1 }).state);
    const def = sample('uncommon', 1);
    let a, c;
    [s, a] = give(s, d, def.id, { level: stats.capFor(def, 0) });
    [s, c] = give(s, d, def.id, { level: 2 });
    s = fz(Fu.fuse(s, d, a, c).state);
    let tr, sac;
    [s, tr] = give(s, d, sample('rare', 1).id, {});
    [s, sac] = give(s, d, 'lich-king', {});
    s = fz(T.train(s, d, tr, [sac]).state);
    s = fz(C.sellCard(s, d, s.cards.at(-1).uid).state);
    s = fz(P.spendStatPoints(fz({ ...s, player: { ...s.player, statPoints: 12 } }), { stamina: 4, mana: 4, hp: 4 }));
    s = fz(P.applyRegen(s, T0 + 20 * MIN));
    s = fz(Pc.dailyRaids(fz({ ...s, pieces: s.pieces.map((h) => ({ ...h, raidDay: S.utcDay(T0 - DAY) })) }), d, T0 + 21 * MIN).state);
    s = fz(L.openLeague(s, d, T0 + DAY, {}).state);
    s = fz(Sh.claimDaily(s, T0 + DAY).state);
    s = fz(S.touch(s, T0 + DAY));
    return s;
  }

  test('no game function mutates its input (deep-frozen inputs through a full scenario, fixture engine)', () => {
    const d = deps('attacker');
    const s = scenario(d);
    assert.ok(s.cards.length > 6);
    assert.equal(s.quests.main.unlocked, 2);
    assert.equal(s.replays.length, 3);
    assert.ok(s.sim.leagueHistory.length === 1);
    assert.equal(s.daily.streak, 2);
    assert.ok(Object.isFrozen(s));
  });

  test('no mutation with the real battle engine either (quest, arena, pieces and league fights on frozen states)', () => {
    const d = realDeps();
    let s = fz({ ...rich(fresh(d)), seed: 7 });
    s = fz(Q.startQuest(s, d, T0, { line: 'main', n: 1 }).state);
    while (!s.quests.active.bossReady) s = fz(Q.tapMinion(s, d, T0, {}).state);
    const boss = Q.fightBoss(s, d, T0, {});
    assert.ok(['attacker', 'defender', 'draw'].includes(boss.battle.result.winner));
    s = fz(boss.state);
    s = fz(A.ensureOffers(s, d, T0).state);
    s = fz(A.fightArena(s, d, T0, { offerIndex: 2 }).state);
    s = fz(Pc.addPiece(s, d, T0, sample('heroic').id).state);
    s = fz(Pc.fightHolder(s, d, T0, { index: 0 }).state);
    s = fz(L.openLeague(s, d, T0, {}).state);
    s = fz(L.fightLeague(s, d, T0, { simId: s.sim.league.simIds[0] }).state);
    assert.equal(s.replays.length, 3);
    // the engine config the game hands over carries the player's real hp and deck instances
    const cfg = Q.bossBattleConfig(s, d, Q.bossLineup(mainNode(1), mulberry32(1), db, stats, 'main'), 5);
    assert.equal(cfg.attacker.player.maxHp, s.player.hpMax);
    assert.equal(cfg.attacker.cards.filter(Boolean).length, 3);
    assert.equal(cfg.seed, 5);
  });

  test('save round-trip: migrate(JSON.parse(JSON.stringify(state))) reproduces the state exactly', () => {
    const d = deps('attacker');
    const s = scenario(d);
    const rt = S.migrate(JSON.parse(JSON.stringify(s)), T0 + 9 * DAY);
    assert.deepEqual(rt, s);
    assert.equal(rt.version, S.SAVE_VERSION);
    assert.equal(S.SAVE_KEY, 'evoker.save.v1');
    // a second trip is stable and the trip of a fresh game too
    assert.deepEqual(S.migrate(JSON.parse(JSON.stringify(rt)), T0), rt);
    const f = fresh(d);
    assert.deepEqual(S.migrate(JSON.parse(JSON.stringify(f)), T0 + DAY), f);
    // a partial/old save gets every default without losing data, and uids never collide
    const old = S.migrate({ seed: 3, player: { name: 'Old', gold: 5 }, cards: [{ uid: 'c40', cardId: 'envoy' }], uidCounter: 2 }, T0);
    assert.equal(old.player.name, 'Old'); assert.equal(old.player.gold, 5); assert.equal(old.player.staminaMax, 50);
    assert.equal(old.uidCounter, 40);
    assert.deepEqual(old.cards[0], { uid: 'c40', cardId: 'envoy', xp: 0, evolveQuality: 1, stage: 0, level: 1 });
    assert.equal(S.nextUid(fz(old)).uid, 'c41');
    // saves written before the audio existed get sound on and the default volumes
    assert.deepEqual(old.settings, { sound: true, speed: 1, raids: true, reducedMotion: false, musicVolume: 0.7, fxVolume: 1 });
    assert.equal(S.migrate(null, T0).version, 1);
    // every seeded roll is reproducible from the save (same seed + step → same result)
    const r1 = Q.startQuest(fz(s), d, T0, { line: 'main', n: 2 });
    const r2 = Q.startQuest(fz(rt), d, T0, { line: 'main', n: 2 });
    assert.deepEqual(r1.active.waves, r2.active.waves);
    assert.equal(r1.state.rngStep, s.rngStep + 1);
  });
});
