'use strict';

/**
 * Integration: the real data (data/cards.json, quests.json, names.json) through the real modules
 * (cards-db → stats → battle-state → battle engine → game flows). No fixtures or stubs here.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { mulberry32 } from '../src/core/rng.js';
import * as stats from '../src/core/stats.js';
import { buildSide, toBattleCard, SLOT_COUNT } from '../src/engine/battle-state.js';
import { simulateBattle, DEFAULT_MAX_ROUNDS } from '../src/engine/battle.js';
import { newGame, deckMana } from '../src/game/state.js';
import { placeInDeck } from '../src/game/collection.js';
import { startQuest, tapMinion, prepareBoss, fightBoss, resolveBoss, questStatus, lineProgress } from '../src/game/quests.js';
import { ensureOffers, fightArena } from '../src/game/arena.js';
import { canFightPvp } from '../src/game/pvp.js';
import { openBooster, drawBoosterCard, boosterPrice, BOOSTER_CARDS } from '../src/game/shop.js';
import { getSim } from '../src/game/opponents.js';
import { T0, QUESTS, db, realDeps } from './fixtures/real.js';

/** Event types the engine may emit: architecture.md §4 plus the two documented extras. */
const KNOWN_EVENTS = new Set([
  'battleStart', 'roundStart', 'status', 'buff', 'attack', 'damage', 'heal', 'death', 'revive',
  'roundEnd', 'battleEnd', 'swap', 'gamble',
]);
const KNOWN_STATUS = new Set(['dazed', 'suspended', 'stunned', 'indestructible', 'dazedNextRound']);
const KNOWN_CAUSES = new Set(['attack', 'ability', 'reflect', 'death', 'poison', 'kill']);

/** Real dependency bundle for src/game. */
const deps = realDeps();

/** Random owned-card instance (never a trainer) with a random stage and level within its cap. */
function randomInstance(rng, uid) {
  const def = rng.pick(db.all().filter((d) => !d.trainer));
  const stage = rng.int(5);
  const level = 1 + rng.int(stats.capFor(def, stage));
  return { uid, cardId: def.id, stage, level, xp: 0, evolveQuality: 1 };
}

/** A FighterSide of 5 random cards built the contract way: buildSide(playerLike, deckInstances, cardsDb). */
function randomSide(rng, name) {
  const instances = [];
  for (let i = 0; i < SLOT_COUNT; i++) instances.push(randomInstance(rng, `${name}-${i}`));
  return buildSide({ name, hp: 1500 + rng.int(3000) }, instances, db);
}

function assertEventShape(ev) {
  assert.ok(KNOWN_EVENTS.has(ev.t), `unknown event type ${ev.t}`);
  switch (ev.t) {
    case 'status':
      assert.ok(KNOWN_STATUS.has(ev.status), `unknown status ${ev.status}`);
      assert.ok(['attacker', 'defender'].includes(ev.side));
      break;
    case 'damage':
      assert.ok(KNOWN_CAUSES.has(ev.cause), `unknown damage cause ${ev.cause}`);
      assert.ok(Number.isFinite(ev.amount) && Number.isFinite(ev.hp));
      break;
    case 'attack':
      assert.ok(Array.isArray(ev.targets));
      for (const tg of ev.targets) {
        assert.ok(['attacker', 'defender'].includes(tg.side));
        assert.ok(tg.slot === null || (Number.isInteger(tg.slot) && tg.slot >= 0 && tg.slot < SLOT_COUNT));
        assert.ok(Number.isFinite(tg.damage));
      }
      break;
    case 'roundEnd':
      assert.ok(Number.isFinite(ev.attackerHp) && Number.isFinite(ev.defenderHp));
      break;
    default:
      break;
  }
}

function assertResultShape(result) {
  assert.ok(['attacker', 'defender', 'draw'].includes(result.winner));
  assert.ok(Number.isInteger(result.rounds) && result.rounds >= 0 && result.rounds <= DEFAULT_MAX_ROUNDS);
  assert.ok(Number.isFinite(result.attackerHp) && Number.isFinite(result.defenderHp));
  assert.ok(Number.isInteger(result.deaths.attacker) && Number.isInteger(result.deaths.defender));
  assert.ok(['playerHp', 'maxRounds', 'noAttack'].includes(result.endedBy));
}

describe('real catalog through cards-db + stats', () => {
  test('cards.json loads with 195 cards and the known cards resolve', () => {
    assert.equal(db.size, 195);
    for (const id of ['dwarf-king', 'werewolf-dwarf', 'siren', 'gremlin', 'voodoo-witch']) assert.ok(db.get(id), id);
    assert.equal(db.get('dwarf-king').name, 'Dwarf King');
    assert.equal(db.get('will-o-the-wisp').name, "Will-o'-the-Wisp");
  });

  test('Dwarf King: 800/2400/1600 at L1, 1046 attack at L14, 3849 at ++++ L54', () => {
    const king = db.get('dwarf-king');
    assert.deepEqual(stats.statsAt(king, 0, 1), { attack: 800, hp: 2400, ability: 1600 });
    assert.equal(stats.statAt(king, 'attack', 0, 14), 1046);
    assert.equal(stats.statAt(king, 'attack', 4, 54), 3849);
    assert.equal(stats.statAt(king, 'hp', 4, 54), 11560);
    assert.equal(stats.statAt(king, 'ability', 4, 54), 7709);
  });

  test('Werewolf Dwarf: fusion reset 1600 → 1840 at + L1, 7451 at ++++ cap', () => {
    const ww = db.get('werewolf-dwarf');
    assert.equal(stats.statAt(ww, 'attack', 0, 1), 1600);
    assert.equal(stats.statAt(ww, 'attack', 1, 1), 1840);
    assert.equal(stats.statAt(ww, 'attack', 4, 54), 7451);
    assert.equal(stats.statAt(ww, 'ability', 0, 1), null);
  });

  test('Siren: no attack, hp 300 → 916 at L11 → 3593 at ++++ L27, caps 11/15/19/23/27', () => {
    const siren = db.get('siren');
    assert.deepEqual(siren.caps, [11, 15, 19, 23, 27]);
    assert.deepEqual(siren.dirs, []);
    assert.equal(stats.statAt(siren, 'attack', 0, 1), 0);
    assert.equal(stats.statAt(siren, 'attack', 4, 27), 0);
    assert.equal(stats.statAt(siren, 'hp', 0, 1), 300);
    assert.equal(stats.statAt(siren, 'hp', 0, 11), 916);
    assert.equal(stats.statAt(siren, 'hp', 4, 27), 3593);
    assert.equal(stats.statAt(siren, 'ability', 0, 1), null);
    assert.deepEqual(siren.ability.buffs.map((b) => b.type), ['no_buff', 'no_damage']);
  });

  test('Gremlin: 1 mana, no attack / ability, hp 400 → 749 at L9', () => {
    const gremlin = db.get('gremlin');
    assert.equal(gremlin.mana, 1);
    assert.deepEqual(stats.statsAt(gremlin, 0, 1), { attack: 0, hp: 400, ability: null });
    assert.equal(stats.statAt(gremlin, 'hp', 0, 9), 749);
    assert.equal(stats.statAt(gremlin, 'hp', 4, 13), 1674);
  });

  test('Voodoo Witch: ultimate, 2000/2000 → 2928 at L15, 14626 hp / 14625 ability at ++++ L63', () => {
    const witch = db.get('voodoo-witch');
    assert.equal(witch.rarity, 'ultimate');
    assert.deepEqual(stats.statsAt(witch, 0, 1), { attack: 0, hp: 2000, ability: 2000 });
    assert.equal(stats.statAt(witch, 'hp', 0, 15), 2928);
    assert.equal(stats.statAt(witch, 'ability', 0, 15), 2928);
    assert.equal(stats.statAt(witch, 'hp', 4, 63), 14626);
    assert.equal(stats.statAt(witch, 'ability', 4, 63), 14625);
    assert.ok(witch.ability.buffs.some((b) => b.type === 'deal_damage_to_opponent_player'));
    assert.ok(witch.ability.buffs.some((b) => b.type === 'heal_player'));
  });

  test('every catalog card yields finite stats at every stage cap', () => {
    for (const card of db.all()) {
      for (let stage = 0; stage < 5; stage++) {
        const s = stats.statsAt(card, stage, stats.capFor(card, stage));
        assert.ok(Number.isFinite(s.attack) && s.attack >= 0, `${card.id} attack @${stage}`);
        assert.ok(Number.isFinite(s.hp) && s.hp > 0, `${card.id} hp @${stage}`);
        assert.ok(s.ability === null || Number.isFinite(s.ability), `${card.id} ability @${stage}`);
      }
    }
  });
});

describe('real cards through battle-state + engine', () => {
  test('toBattleCard(instance, cardsDb) and buildSide(player, deck, cardsDb) use stats.js', () => {
    const inst = { uid: 'k1', cardId: 'dwarf-king', stage: 4, level: 54, evolveQuality: 1 };
    const bc = toBattleCard(inst, db);
    assert.equal(bc.attack, 3849);
    assert.equal(bc.maxHp, 11560);
    assert.equal(bc.abilityValue, 7709);
    assert.deepEqual(bc.dirs, ['direct']);
    assert.equal(bc.ability.buffs[0].type, 'raise_attack');
    const side = buildSide({ name: 'Dwarves', hp: 1500 }, [null, inst, { uid: 'g', cardId: 'gremlin', stage: 0, level: 1 }, null, null], db);
    assert.equal(side.cards.length, SLOT_COUNT);
    assert.equal(side.cards[0], null);
    assert.equal(side.cards[1].cardId, 'dwarf-king');
    assert.equal(side.cards[2].maxHp, 400);
    assert.equal(side.player.baseMaxHp, 1500);
    assert.equal(side.player.tribeBonus, false);
  });

  test('buildSide with the options form (cardsDb + computeStats = stats.statAt) gives the same side', () => {
    const inst = [{ uid: 'a', cardId: 'dwarf-king', stage: 2, level: 20 }, { uid: 'b', cardId: 'siren', stage: 1, level: 15 }];
    const computeStats = ({ cardDef, stage, level, evolveQuality }) => ({
      attack: stats.statAt(cardDef, 'attack', stage, level, evolveQuality) ?? 0,
      hp: stats.statAt(cardDef, 'hp', stage, level, evolveQuality) ?? 0,
      ability: stats.statAt(cardDef, 'ability', stage, level, evolveQuality),
    });
    const a = buildSide({ name: 'P', hp: 1500 }, inst, db);
    const b = buildSide({ name: 'P', hp: 1500 }, inst, { cardsDb: db, computeStats });
    assert.deepEqual(a, b);
  });

  test('Dwarf King at L1 gives +800 attack to each neighbour (wiki worked example)', () => {
    const deck = [
      { uid: 'l', cardId: 'pikeman', stage: 0, level: 1 },
      { uid: 'k', cardId: 'dwarf-king', stage: 0, level: 1 },
      { uid: 'r', cardId: 'bone-breaker', stage: 0, level: 1 },
      null, null,
    ];
    const attacker = buildSide({ name: 'A', hp: 1500 }, deck, db);
    const defender = buildSide({ name: 'D', hp: 1500 }, [{ uid: 'x', cardId: 'gremlin', stage: 0, level: 1 }], db);
    const { events } = simulateBattle({ attacker, defender, seed: 1 });
    const buffs = events.filter((e) => e.t === 'buff' && e.side === 'attacker' && e.stat === 'attack' && e.source && e.source.slot === 1);
    assert.deepEqual(buffs.slice(0, 2).map((b) => [b.slot, b.delta]).sort(), [[0, 800], [2, 800]]);
  });

  test('every catalog card can fight at stage 0 and ++++ without the engine throwing', () => {
    const rng = mulberry32(77);
    const filler = (name) => [
      { uid: `${name}-a`, cardId: 'pikeman', stage: 1, level: 5 },
      { uid: `${name}-b`, cardId: 'bone-breaker', stage: 1, level: 5 },
      null,
      { uid: `${name}-d`, cardId: 'scout', stage: 1, level: 5 },
      { uid: `${name}-e`, cardId: 'master-brewer', stage: 1, level: 5 },
    ];
    for (const card of db.all()) {
      for (const stage of [0, 4]) {
        const mine = filler('m');
        mine[2] = { uid: 'subject', cardId: card.id, stage, level: stats.capFor(card, stage) };
        const theirs = filler('t');
        theirs[2] = randomInstance(rng, 'foe');
        const attacker = buildSide({ name: 'A', hp: 2000 }, mine, db);
        const defender = buildSide({ name: 'D', hp: 2000 }, theirs, db);
        let out;
        assert.doesNotThrow(() => { out = simulateBattle({ attacker, defender, seed: 5 }); }, `${card.id} @${stage}`);
        for (const ev of out.events) assertEventShape(ev);
        assertResultShape(out.result);
      }
    }
  });

  test('10 seeded random match-ups: result shape, known event types, determinism, inputs untouched', () => {
    const rng = mulberry32(20261007);
    for (let i = 0; i < 10; i++) {
      const attacker = randomSide(rng, 'att');
      const defender = randomSide(rng, 'def');
      const frozenA = JSON.stringify(attacker);
      const frozenD = JSON.stringify(defender);
      const seed = rng.int(1e9);
      const out = simulateBattle({ attacker, defender, seed });
      assert.ok(Array.isArray(out.events) && out.events.length >= 2);
      assert.equal(out.events[0].t, 'battleStart');
      assert.equal(out.events[out.events.length - 1].t, 'battleEnd');
      for (const ev of out.events) assertEventShape(ev);
      assertResultShape(out.result);
      assert.equal(out.events.filter((e) => e.t === 'roundStart').length, out.result.rounds);
      assert.equal(JSON.stringify(attacker), frozenA, 'attacker side mutated');
      assert.equal(JSON.stringify(defender), frozenD, 'defender side mutated');
      const again = simulateBattle({ attacker, defender, seed });
      assert.deepEqual(again.events, out.events, `seed ${seed} not deterministic`);
    }
  });
});

describe('real game flows (src/game with the real db and engine)', () => {
  // DECISIONS D1: Envoy alone in the deck, Master Brewer dragged in by the tutorial before the winning fight.
  test('quest 1: new game → tap minions → boss line-up → simulateBattle → resolve', () => {
    let state = newGame('Tester', 4242, T0, deps);
    assert.equal(state.cards.length, 2);
    assert.deepEqual(state.deck.filter(Boolean).length, 1);
    state = placeInDeck(state, deps, state.cards[1].uid, 1).state;
    assert.equal(questStatus(state, 'main', 1), 'current');

    state = startQuest(state, deps, T0, { line: 'main', n: 1 }).state;
    const active = state.quests.active;
    assert.equal(active.figuresTotal, QUESTS.main.nodes[0].figures);
    assert.ok(active.waves.every((w) => w.every((id) => db.get(id))));

    let taps = 0;
    let r;
    do {
      r = tapMinion(state, deps, T0);
      assert.equal(r.needsPotion, null);
      state = r.state;
      taps++;
    } while (!r.bossReady && taps < 50);
    assert.equal(taps, active.figuresTotal);
    assert.equal(state.player.stamina, 50 - 2 * taps);
    assert.equal(state.player.gold, 200 + 6 * taps + 10, '6 gold per tap and +10 at the end (tutorial.md §1.4)');
    assert.equal(r.pct, 100);

    const pb = prepareBoss(state, deps, T0);
    state = pb.state;
    assert.equal(pb.lineup.cards[2].cardId, 'throat-cutter');
    assert.deepEqual(pb.lineup.cards.filter(Boolean).map((c) => c.cardId), ['throat-cutter', 'throat-cutter']);
    assert.equal(pb.lineup.player.maxHp, 250);
    assert.equal(pb.lineup.player.name, 'Worm Shaman');
    for (const c of pb.lineup.cards.filter(Boolean)) {
      assert.ok(db.get(c.cardId));
      assert.ok(c.level >= 1 && c.level <= stats.capFor(db.get(c.cardId), c.stage));
    }

    const fight = fightBoss(state, deps, T0);
    assert.equal(fight.battle.events[0].t, 'battleStart');
    assert.equal(fight.battle.events[0].defender.cards[2].cardId, 'throat-cutter');
    for (const ev of fight.battle.events) assertEventShape(ev);
    assertResultShape(fight.battle.result);
    assert.equal(fight.won, fight.battle.result.winner === 'attacker');
    assert.ok(fight.playerXp === 0 && fight.cardXp > 0, 'boss fights give card xp only');
    const deck = fight.state.cards.filter((c) => fight.state.deck.includes(c.uid));
    assert.ok(deck.every((c) => c.xp > 0 || c.level > 1), 'deck cards earned xp');
    if (fight.won) {
      assert.equal(fight.unlocked, 2);
      assert.equal(fight.firstWin, true);
      assert.equal(fight.state.quests.active, null);
      assert.equal(lineProgress(fight.state, 'main').unlocked, 2);
      assert.equal(questStatus(fight.state, 'main', 2), 'current');
      assert.ok(fight.reward && fight.reward.type);
      assert.equal(fight.state.player.questsDone, 1);
    } else {
      assert.equal(fight.unlocked, null);
      assert.equal(fight.state.quests.active.bossReady, false);
      assert.equal(fight.state.quests.active.figuresDone, 0);
    }

    // resolveBoss stand-alone with an explicit win unlocks quest 2 whatever the simulation did
    const forced = resolveBoss(state, deps, T0, { result: { winner: 'attacker' }, lineup: pb.lineup });
    assert.equal(forced.won, true);
    assert.equal(forced.unlocked, 2);
    assert.equal(forced.state.quests.active, null);
    assert.deepEqual([forced.reward.type, forced.reward.cardId], ['card', 'throat-cutter'], 'the soul card');
  });

  // tutorial.md §1.4: the first fight with the Envoy alone is lost, the replay with Master Brewer added is won.
  test('quest 1: the Envoy alone loses to the Worm Shaman, Envoy + Master Brewer win', () => {
    let alone = 0, both = 0;
    for (let seed = 1; seed <= 8; seed++) {
      for (const brewer of [false, true]) {
        let state = newGame('Tester', seed, T0, deps);
        if (brewer) state = placeInDeck(state, deps, state.cards[1].uid, 1).state;
        state = startQuest(state, deps, T0, { line: 'main', n: 1 }).state;
        let r;
        do { r = tapMinion(state, deps, T0); state = r.state; } while (!r.bossReady);
        if (fightBoss(state, deps, T0).won) { if (brewer) both++; else alone++; }
      }
    }
    assert.equal(alone, 0, 'the Envoy alone never wins');
    assert.equal(both, 8, 'Envoy + Master Brewer always win');
  });

  test('arena fight against a generated simulated player', () => {
    let state = newGame('Tester', 99, T0, deps);
    state = { ...state, player: { ...state.player, level: 10, mana: 200, manaMax: 200 } };
    const eo = ensureOffers(state, deps, T0);
    state = eo.state;
    assert.equal(eo.offers.length, 3);
    assert.ok(state.sim.players.length > 0);
    const cost = deckMana(state, deps);
    assert.deepEqual(canFightPvp(state, deps), { ok: true, reason: null, mana: cost, needsPotion: false });
    const sim = getSim(state, eo.offers[1].simId);
    const enemyMana = sim.deck.filter(Boolean).reduce((a, c) => a + db.get(c.cardId).mana, 0);
    assert.ok(sim.deck.filter(Boolean).every((c) => db.get(c.cardId)));

    const r = fightArena(state, deps, T0, { offerIndex: 1 });
    for (const ev of r.battle.events) assertEventShape(ev);
    assertResultShape(r.battle.result);
    assert.equal(r.won, r.battle.result.winner === 'attacker');
    assert.equal(r.rewards.gold, enemyMana * 6 * (r.won ? 2 : 1));
    assert.equal(r.rewards.tournamentPoints, r.won ? 10 : 0);
    assert.equal(r.state.player.mana, 200 - cost);
    assert.equal(r.state.player.gold, state.player.gold + r.rewards.gold);
    assert.equal(r.state.replays.length, 1);
    assert.equal(r.state.replays[0].defender.name, sim.name);
    assert.equal(r.state.replays[0].result.winner, r.battle.result.winner);
    assert.equal(r.battle.events[0].defender.player.name, sim.name);
  });

  test('booster grid: drawing a card with gems', () => {
    let state = newGame('Tester', 7, T0, deps);
    state = { ...state, player: { ...state.player, gems: 500 } };
    const b = openBooster(state, deps, T0, { booster: 'neophyte', open: true });
    assert.equal(b.booster.cards.length, BOOSTER_CARDS);
    assert.ok(b.booster.cards.every((id) => db.get(id) && !db.get(id).trainer));
    const pick = drawBoosterCard(b.state, deps, T0, { booster: 'neophyte', position: 2 });
    assert.equal(pick.cost, boosterPrice('neophyte'));
    assert.equal(pick.state.player.gems, 500 - pick.cost);
    assert.equal(pick.cardId, b.booster.cards[2]);
    assert.equal(pick.state.cards.length, state.cards.length + 1);
    const owned = pick.state.cards.find((c) => c.uid === pick.uid);
    assert.deepEqual([owned.cardId, owned.stage, owned.level], [b.booster.cards[2], 0, 1]);
    const poor = openBooster({ ...state, player: { ...state.player, gems: 10 } }, deps, T0, { booster: 'neophyte' });
    assert.throws(() => drawBoosterCard(poor.state, deps, T0, { booster: 'neophyte', position: 0 }), /gems/);
  });
});
