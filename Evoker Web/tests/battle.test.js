'use strict';
/**
 * Battle engine tests against the ORIGINAL simulator rules (docs/design/original-engine.md) and the
 * extensions of docs/design/ability-encoding.md §3. Expected numbers are computed by hand from the
 * spec, never from the engine.
 *
 * The last two groups replay the ORIGINAL client's unit tests
 * (exploration/apk/lua/unittests.tests.testfightsimulatorsimplev2.txt, decoded into
 * tests/fixtures/original-tests.json; the named cards of the four "GD" cases come from
 * exploration/apk/lua/unittests.tests.testcards.txt, decoded into tests/fixtures/original-cards.json).
 * Each original test gives both decks (cards with their exact buffs), both player hp values, the
 * expected winner and, for EVERY round, the health of every slot and of both players. The original
 * runner lists player 2's cards in facing order (index i faces player 1's index i) and reverses them
 * for the simulator; our defender slots use the same facing order, so decks map 1:1.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mulberry32 } from '../src/core/rng.js';
import { loadCardsDbFromFile } from '../src/core/cards-db.js';
import { capFor } from '../src/core/stats.js';
import { hasTribeBonus, bonusTribe, TRIBE_BONUS_MULT } from '../src/engine/tribe-bonus.js';
import { abilityForStage } from '../src/core/abilities.js';
import {
  toBattleCard, buildSide, normaliseDirs, toOriginalDirs, resolveBuffs, normaliseBuff, SLOT_COUNT,
} from '../src/engine/battle-state.js';
import { simulateBattle, summariseBattle, DEFAULT_MAX_ROUNDS } from '../src/engine/battle.js';
import { PHASES, HANDLERS, ORIGINAL_TYPES, EXTENSION_TYPES } from '../src/engine/effects/index.js';
import { card, vanilla, wall, raw, side, fight, computeStats, cardsDb, CARD_DEFS, slug } from './fixtures/cards.js';

const EVENT_TYPES = ['battleStart', 'roundStart', 'status', 'buff', 'attack', 'damage', 'heal', 'death', 'revive', 'roundEnd', 'battleEnd', 'swap', 'gamble'];
const BIG = 1000000;
/** A card that attacks straight ahead and never dies. */
const hitter = (attack, dirs = ['direct']) => raw('Hitter', attack, BIG, dirs);
const dmgOf = (f, round, sideKey, slot) => f.damages(round).filter((d) => d.side === sideKey && d.slot === slot);
const attackOf = (f, round, sideKey, slot) => f.attacks(round).find((a) => a.side === sideKey && a.slot === slot);
const sum = (list, key = 'amount') => list.reduce((s, e) => s + e[key], 0);

/* ------------------------------------------------------------------ rng */

describe('core/rng', () => {
  test('mulberry32 is deterministic and in range', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const sa = Array.from({ length: 20 }, () => a.next());
    const sb = Array.from({ length: 20 }, () => b.next());
    assert.deepEqual(sa, sb);
    for (const x of sa) assert.ok(x >= 0 && x < 1);
    assert.notDeepEqual(sa, Array.from({ length: 20 }, () => mulberry32(43).next()));
  });
});

/* ------------------------------------------------------------ race bonus */

describe('race (tribe) bonus rule', () => {
  const t = (tribe) => ({ tribe });
  test('exactly one main race with more cards than neutrals; neutral-only and mixed races give nothing', () => {
    assert.equal(hasTribeBonus([t('orc'), t('orc'), t('orc'), t('orc'), t('orc')]), true);
    assert.equal(hasTribeBonus([t('orc'), t('orc'), t('orc'), t('orc'), t('neutral')]), true);
    assert.equal(hasTribeBonus([t('orc'), t('orc'), t('orc'), t('neutral'), t('neutral')]), true);
    assert.equal(hasTribeBonus([t('orc'), t('orc'), t('neutral'), t('neutral'), t('neutral')]), false);
    assert.equal(hasTribeBonus([t('orc'), t('orc'), t('orc'), t('orc'), t('elf')]), false);
    assert.equal(hasTribeBonus([t('neutral'), t('neutral'), t('neutral'), t('neutral'), t('neutral')]), false);
    assert.equal(hasTribeBonus([null, t('dwarf'), null, null, null]), true);
    assert.equal(hasTribeBonus([null, t('dwarf'), t('neutral'), null, null]), false);
    assert.equal(hasTribeBonus([]), false);
    assert.equal(bonusTribe([t('elf'), t('elf'), t('neutral')]), 'elf');
    assert.equal(TRIBE_BONUS_MULT, 1.2);
  });
  test('buildSide applies x1.2 to max hp when earned and flags it', () => {
    const s = buildSide({ name: 'x', hpMax: 2000 }, [card('Dwarf King'), card('Dwarf Judge'), card('Argonaut'), null, null]);
    assert.equal(s.player.tribeBonus, true);
    assert.equal(s.player.maxHp, 2400);
    assert.equal(s.player.hp, 2400);
    assert.equal(s.player.baseMaxHp, 2000);
    const n = buildSide({ name: 'x', hpMax: 2000 }, [card('Dwarf King'), card('Phoenix'), card('Siren'), null, null]);
    assert.equal(n.player.tribeBonus, false);
    assert.equal(n.player.maxHp, 2000);
  });
  test('the engine applies the bonus itself only for raw sides (no tribeBonus flag) or when forced', () => {
    const rawSide = (cards, hp) => ({ player: { name: 'r', hp, maxHp: hp }, cards });
    const orc = raw('Orc', 100, BIG, ['direct'], [], { tribe: 'orc' });
    const out = simulateBattle({ attacker: rawSide([orc], 1000), defender: rawSide([], 1000), seed: 1 });
    const bonus = out.events.filter((e) => e.t === 'buff' && e.slot === null);
    assert.deepEqual(bonus.map((b) => [b.side, b.stat, b.delta]), [['attacker', 'maxHp', 200]]);
    assert.equal(out.events.find((e) => e.t === 'roundEnd').attackerHp, 1200);
    assert.equal(out.result.rounds, 10); // 1000 / 100 per round until the defender is at 0
    assert.equal(out.result.winner, 'attacker');
    assert.equal(out.result.endedBy, 'playerHp');
    // mixed line-ups earn nothing
    const mixed = simulateBattle({ attacker: rawSide([orc, raw('N', 0, BIG, [], [], { tribe: 'neutral' })], 1000), defender: rawSide([], 1000), seed: 1 });
    assert.equal(mixed.events.filter((e) => e.t === 'buff' && e.slot === null).length, 0);
    const two = simulateBattle({ attacker: rawSide([orc, raw('E', 0, BIG, [], [], { tribe: 'elf' })], 1000), defender: rawSide([], 1000), seed: 1 });
    assert.equal(two.events.filter((e) => e.t === 'buff' && e.slot === null).length, 0);
    // buildSide already applied it: the engine does not double it
    const built = side([orc], { tribeBonus: true });
    assert.equal(built.player.maxHp, 1800);
    const out2 = simulateBattle({ attacker: built, defender: side([]), seed: 1 });
    assert.equal(out2.events.filter((e) => e.t === 'buff' && e.slot === null).length, 0);
    assert.equal(out2.events.find((e) => e.t === 'roundEnd').attackerHp, 1800);
    // forced off
    const off = simulateBattle({ attacker: rawSide([orc], 1000), defender: rawSide([], 1000), seed: 1, options: { raceBonus: false } });
    assert.equal(off.events.filter((e) => e.t === 'buff' && e.slot === null).length, 0);
  });
});

/* ----------------------------------------------------------- battle-state */

describe('battle-state', () => {
  test('toBattleCard uses injected computeStats and resolves the ability for the stage', () => {
    const calls = [];
    const cs = (args) => { calls.push(args); return computeStats(args); };
    const bc = toBattleCard({ uid: 'c9', cardId: 'dwarf-king', stage: 1, level: 3, evolveQuality: 0.9 }, CARD_DEFS['dwarf-king'], cs);
    assert.equal(calls.length, 1);
    assert.deepEqual([calls[0].stage, calls[0].level, calls[0].evolveQuality], [1, 3, 0.9]);
    assert.equal(bc.instanceId, 'c9');
    assert.equal(bc.attack, Math.round(800 * 1.2 * 1.15 * 0.9));
    assert.equal(bc.hp, bc.maxHp);
    assert.deepEqual(bc.dirs, ['direct']);
    assert.equal(bc.ability.buffs[0].type, 'raise_attack');
    assert.equal(bc.tribe, 'dwarf');
    assert.equal(bc.buffs, undefined);
  });

  test('evolving abilities resolve by stage; Sets and strings are accepted as dirs', () => {
    assert.deepEqual(abilityForStage(CARD_DEFS['bog-yeti'].ability, 0).buffs, []);
    assert.equal(abilityForStage(CARD_DEFS['bog-yeti'].ability, 1).buffs[0].type, 'invulnerable');
    assert.deepEqual(card('Bog Yeti', { stage: 0 }).ability.buffs, []);
    assert.equal(card('Bog Yeti', { stage: 3 }).ability.buffs.length, 2);
    assert.deepEqual(normaliseDirs(new Set(['left', 'direct'])), ['left', 'direct']);
    assert.deepEqual(normaliseDirs('left, direct, bogus'), ['left', 'direct']);
  });

  test('catalog directions map to the original names', () => {
    assert.deepEqual(toOriginalDirs(['left', 'direct', 'right', 'ownLeft', 'ownRight']), ['frontLeft', 'front', 'frontRight', 'left', 'right']);
    assert.deepEqual(toOriginalDirs(['front', 'self']), ['front', 'self']);
    assert.deepEqual(toOriginalDirs(['bogus']), []);
  });

  test('resolveBuffs: implicit attack from the card dirs, explicit attack overrides it, "value" strengths resolve', () => {
    assert.deepEqual(resolveBuffs(null, 0, 0, ['direct']), [{ type: 'attack', directions: ['front'], event: 'always', eventData: null }]);
    assert.deepEqual(resolveBuffs(null, 0, 0, []), []);
    const rat = resolveBuffs(CARD_DEFS['rat-eater'].ability, 0, 0, ['direct']);
    assert.equal(rat.filter((b) => b.type === 'attack').length, 1);
    assert.equal(rat[0].emptyReduction, -200);
    const king = resolveBuffs(CARD_DEFS['dwarf-king'].ability, 0, 1600, ['direct']);
    assert.deepEqual(king.map((b) => b.type), ['attack', 'raise_attack']);
    assert.equal(king[1].strength, 1600);
    assert.deepEqual(king[1].directions, ['left', 'right']);
    // perTarget: per-neighbour amount doubled so the handler's split gives it back
    const arg = resolveBuffs(CARD_DEFS.argonaut.ability, 0, 240, ['direct']);
    assert.equal(arg[1].strength, 480);
    assert.equal(arg[1].perTarget, undefined);
    // no round-mode attack buff is added when the card defines a death attack only
    const schemer = resolveBuffs(CARD_DEFS.schemer.ability, 0, 0, ['direct']);
    assert.deepEqual(schemer.map((b) => b.type), ['attack', 'bonus_attack']);
  });

  test('resolveBuffs / normaliseBuff: value placeholders, string numbers, direction names, perTarget', () => {
    const list = resolveBuffs({ buffs: [
      { type: 'heal', strength: 'value', directions: ['left', 'right'], event: 'always', perTarget: true },
      { type: 'raise_attack', strength: '-value', directions: ['self'], event: 'round_eq', eventData: '2' },
      { type: 'deal_damage_to_player', strength: '10' },
    ] }, 0, 50, ['direct', 'ownLeft']);
    assert.deepEqual(list[0], { type: 'attack', directions: ['front', 'left'], event: 'always', eventData: null });
    assert.equal(list[1].strength, 100);
    assert.equal(list[2].strength, -50);
    assert.equal(list[2].eventData, 2);
    assert.equal(list[3].strength, 10);
    assert.equal(list[3].event, 'always');
    assert.deepEqual(list[3].directions, []);
    assert.deepEqual(normaliseBuff({ type: 'attack' }, 0, ['front']).directions, ['front']);
    // buff directions are original names: `left` stays the own left neighbour
    assert.deepEqual(normaliseBuff({ type: 'heal', directions: ['left', 'bogus'] }).directions, ['left']);
  });

  test('buildSide converts instances via cardsDb, pads to 5 slots, keeps explicit buffs of BattleCards', () => {
    const s = buildSide({ name: 'me', hpMax: 1500 }, [null, { uid: 'a', cardId: 'pikeman', stage: 0, level: 2 }, raw('R', 1, 1, ['direct'])], { cardsDb, computeStats });
    assert.equal(s.cards.length, SLOT_COUNT);
    assert.equal(s.cards[0], null);
    assert.equal(s.cards[1].cardId, 'pikeman');
    assert.equal(s.cards[1].attack, 110);
    assert.equal(s.cards[2].buffs.length, 1);
    assert.equal(s.cards[4], null);
    assert.equal(slug("Will-o'-the-Wisp"), 'will-o-the-wisp');
  });

  test('effect registry: every original and extension type has a handler and a phase', () => {
    for (const type of [...ORIGINAL_TYPES, ...EXTENSION_TYPES]) {
      assert.ok(PHASES.some((p) => p.type === type), `${type} has no phase`);
      const entries = PHASES.filter((p) => p.type === type);
      for (const p of entries) assert.equal(typeof HANDLERS[p.handler || p.type], 'function', type);
    }
    const originals = PHASES.filter((p) => !p.ext).map((p) => p.type);
    assert.deepEqual(originals, ['no_buff', 'raise_attack', 'raise_hp', 'raise_player_hp', 'increment_attack', 'invulnerable', 'no_damage', 'attack',
      'reflect_damage', 'reflect_damage_to_player', 'deal_damage_to_all_opponent_cards', 'self_damage', 'heal', 'heal_player', 'die', 'resurrect',
      'deal_damage_to_opponent_player', 'deal_damage_to_player']);
  });
});

/* ------------------------------------------------------------ engine basics */

describe('engine basics', () => {
  test('deterministic for a seed, different seeds differ, inputs never mutated', () => {
    const deck = [card('Bouncer'), card('Wheel of Fortune'), card('Wizard Apprentice'), vanilla('A', 300, 900), card('Goblin Thieves')];
    const foes = [vanilla('B', 250, 800), card('Umbral Dragon'), vanilla('C', 400, 700), card('Phoenix'), vanilla('D', 100, 2000)];
    const a = fight(deck, foes, { seed: 11 });
    const frozen = JSON.stringify(a.cfg);
    const b = fight(deck, foes, { seed: 11 });
    assert.deepEqual(a.events, b.events);
    assert.deepEqual(a.result, b.result);
    assert.equal(JSON.stringify(a.cfg), frozen, 'cfg mutated');
    const c = fight(deck, foes, { seed: 12 });
    assert.notDeepEqual(a.events, c.events);
    for (const ev of a.events) assert.ok(EVENT_TYPES.includes(ev.t), ev.t);
  });

  test('event log frame: battleStart snapshot, roundStart/roundEnd per round with both players, battleEnd last', () => {
    const f = fight([vanilla('A', 100, 300), null, card('Pikeman')], [null, vanilla('B', 50, 200)], { seed: 3, maxRounds: 2 });
    const start = f.events[0];
    assert.equal(start.t, 'battleStart');
    assert.equal(start.seed, 3);
    assert.equal(start.attacker.player.name, 'A');
    assert.equal(start.attacker.player.hp, 1500);
    assert.equal(start.attacker.player.maxHp, 1500);
    assert.equal(start.attacker.cards.length, 5);
    assert.equal(start.attacker.cards[1], null);
    assert.deepEqual([start.attacker.cards[0].cardId, start.attacker.cards[0].hp, start.attacker.cards[0].maxHp, start.attacker.cards[0].attack], ['a', 300, 300, 100]);
    assert.deepEqual(start.attacker.cards[2].dirs, ['direct']);
    assert.equal(start.defender.cards[1].name, 'B');
    const starts = f.of('roundStart');
    const ends = f.of('roundEnd');
    assert.deepEqual(starts.map((e) => e.round), [1, 2]);
    assert.deepEqual(ends.map((e) => e.round), [1, 2]);
    for (const e of [...starts, ...ends]) assert.ok(Number.isFinite(e.attackerHp) && Number.isFinite(e.defenderHp));
    assert.equal(ends[0].cards.attacker.length, 5);
    assert.equal(ends[0].cards.defender.length, 5);
    assert.equal(f.events[f.events.length - 1].t, 'battleEnd');
    assert.equal(f.result.rounds, 2);
    assert.equal(f.result.endedBy, 'maxRounds');
  });

  test('empty decks: nobody can attack, 0 rounds, draw', () => {
    const f = fight([], []);
    assert.equal(f.result.rounds, 0);
    assert.equal(f.result.winner, 'draw');
    assert.equal(f.result.endedBy, 'noAttack');
    assert.deepEqual(f.events.map((e) => e.t), ['battleStart', 'battleEnd']);
  });

  test('20-round cap: equal health is a draw; maxRounds option; higher health wins', () => {
    const f = fight([hitter(1)], [hitter(1)]);
    assert.equal(f.result.rounds, DEFAULT_MAX_ROUNDS);
    assert.equal(f.result.winner, 'draw');
    assert.equal(f.result.endedBy, 'maxRounds');
    assert.equal(f.of('roundStart').length, 20);
    const g = fight([hitter(1)], [hitter(1)], { maxRounds: 3 });
    assert.equal(g.result.rounds, 3);
    const h = fight([hitter(10), hitter(1)], [hitter(10)]);
    assert.equal(h.result.winner, 'attacker');
    assert.equal(h.result.rounds, 20);
  });

  test('result hp is hp - takenDamage of the original (may be negative) and matches the last roundEnd', () => {
    const f = fight([hitter(1000)], [], { dHp: 1500 });
    assert.equal(f.result.rounds, 2);
    assert.equal(f.result.defenderHp, -500);
    assert.equal(f.roundEnd(2).defenderHp, -500);
    assert.equal(f.result.winner, 'attacker');
  });
});

/* ------------------------------------------------------ slots & directions */

describe('slots and directions (original 1-based mirrored indexing behind UI facing slots)', () => {
  test('attacker: direct hits the facing slot, left/right the facing slot -1/+1', () => {
    const f = fight([wall(), wall(), raw('Tri', 300, BIG, ['left', 'direct', 'right']), wall(), wall()], [wall(), wall(), wall(), wall(), wall()], { maxRounds: 1 });
    const a = attackOf(f, 1, 'attacker', 2);
    assert.deepEqual(a.targets.map((t) => [t.dir, t.side, t.slot, t.damage]), [['frontLeft', 'defender', 1, 100], ['front', 'defender', 2, 100], ['frontRight', 'defender', 3, 100]]);
    assert.deepEqual(f.damages(1).map((d) => [d.side, d.slot, d.amount, d.hp]), [['defender', 1, 100, BIG - 100], ['defender', 2, 100, BIG - 100], ['defender', 3, 100, BIG - 100]]);
  });

  test('off-board diagonals are "none": skipped, no player damage', () => {
    const f = fight([raw('Tri', 300, BIG, ['left', 'direct', 'right'])], [wall(), wall()], { maxRounds: 1 });
    const a = attackOf(f, 1, 'attacker', 0);
    assert.deepEqual(a.targets.map((t) => [t.dir, t.slot, t.damage]), [['front', 0, 100], ['frontRight', 1, 100]]);
    assert.deepEqual(f.playerDamage('defender', 1), []);
  });

  test('defender: its own left is our right (rows face each other): frontLeft hits facing slot +1', () => {
    const f = fight([wall(), wall(), wall(), wall(), wall()], [wall(), raw('Tri', 300, BIG, ['left', 'direct', 'right']), wall(), wall(), wall()], { maxRounds: 1 });
    const a = attackOf(f, 1, 'defender', 1);
    const byDir = Object.fromEntries(a.targets.map((t) => [t.dir, [t.side, t.slot, t.damage]]));
    assert.deepEqual(byDir, { frontLeft: ['attacker', 2, 100], front: ['attacker', 1, 100], frontRight: ['attacker', 0, 100] });
  });

  test('own-neighbour directions hit the own row (defender ownLeft = facing slot +1)', () => {
    const f = fight([wall(), wall(), raw('Own', 200, BIG, ['ownLeft', 'ownRight']), wall(), wall()], [wall(), wall(), raw('OwnL', 200, BIG, ['ownLeft']), wall(), wall()], { maxRounds: 1 });
    const a = attackOf(f, 1, 'attacker', 2);
    assert.deepEqual(a.targets.map((t) => [t.dir, t.side, t.slot, t.damage]), [['left', 'attacker', 1, 100], ['right', 'attacker', 3, 100]]);
    const d = attackOf(f, 1, 'defender', 2);
    assert.deepEqual(d.targets.map((t) => [t.dir, t.side, t.slot, t.damage]), [['left', 'defender', 3, 200]]);
  });

  test('an empty slot sends the share to the OPPOSING player, even for own-neighbour directions (original quirk)', () => {
    const f = fight([null, null, hitter(500), null, null], [], { maxRounds: 1 });
    assert.deepEqual(attackOf(f, 1, 'attacker', 2).targets, [{ side: 'defender', slot: null, damage: 500, blocked: false, dir: 'front' }]);
    assert.equal(sum(f.playerDamage('defender', 1)), 500);
    const g = fight([null, null, raw('OwnL', 200, BIG, ['ownLeft']), null, null], [wall(), wall(), wall(), wall(), wall()], { maxRounds: 1 });
    assert.equal(sum(g.playerDamage('defender', 1)), 200);
    assert.deepEqual(g.playerDamage('attacker', 1), []);
  });

  test('processing order: player 1 slots 1..5 then player 2 slots 1..5 = attacker 0->4, defender 4->0', () => {
    const f = fight([hitter(100), hitter(100), hitter(100)], [hitter(100), hitter(100), hitter(100)], { maxRounds: 1 });
    assert.deepEqual(f.attacks(1).map((a) => `${a.side[0]}${a.slot}`), ['a0', 'a1', 'a2', 'd2', 'd1', 'd0']);
  });

  test('damage split: round(attack / #directions) per direction', () => {
    const f = fight([wall(), wall(), raw('Tri', 1000, BIG, ['left', 'direct', 'right']), wall(), raw('Two', 1001, BIG, ['left', 'right'])], [wall(), wall(), wall(), wall(), wall()], { maxRounds: 1 });
    assert.deepEqual(attackOf(f, 1, 'attacker', 2).targets.map((t) => t.damage), [333, 333, 333]);
    assert.deepEqual(attackOf(f, 1, 'attacker', 4).targets.map((t) => [t.slot, t.damage]), [[3, 501]]);
  });
});

/* ------------------------------------------------------------- over() rule */

describe('over(): a player at 0, or nobody can attack any more', () => {
  test('a lone damaging ability does not count: the fight ends before round 1', () => {
    const witch = raw('Witch', 0, 1000, [], [{ type: 'deal_damage_to_opponent_player', strength: 50, directions: [], event: 'always' }]);
    const f = fight([witch], []);
    assert.equal(f.result.rounds, 0);
    assert.equal(f.result.endedBy, 'noAttack');
    assert.equal(f.result.winner, 'draw');
  });

  test('round-limited attacks: round_le N ends after N rounds, round_eq N after N, round_ge never', () => {
    const le = fight([raw('Cat', 100, BIG, [], [{ type: 'attack', directions: ['front'], event: 'round_le', eventData: 2 }])], [wall()]);
    assert.equal(le.result.rounds, 2);
    assert.equal(le.result.endedBy, 'noAttack');
    assert.equal(le.cardHp('defender', 0, 2), BIG - 200);
    const eq = fight([raw('Cat', 100, BIG, [], [{ type: 'attack', directions: ['front'], event: 'round_eq', eventData: 2 }])], [wall()]);
    assert.equal(eq.result.rounds, 2);
    assert.equal(eq.attacks(1).length, 0);
    assert.equal(eq.attacks(2).length, 1);
    const ge = fight([raw('Cat', 100, BIG, [], [{ type: 'attack', directions: ['front'], event: 'round_ge', eventData: 2 }])], [wall()]);
    assert.equal(ge.result.rounds, 20);
    assert.equal(ge.result.endedBy, 'maxRounds');
    assert.equal(ge.of('attack').length, 19);
  });

  test('the fight stops as soon as a player is at 0 or below', () => {
    const f = fight([hitter(400)], [], { dHp: 1000 });
    assert.equal(f.result.rounds, 3);
    assert.equal(f.result.defenderHp, -200);
    assert.equal(f.result.endedBy, 'playerHp');
  });
});

/* ------------------------------------------------------------ phase order */

describe('phase order and per-round resets', () => {
  test('heals come before the die phase: a card damaged past its hp but healed survives', () => {
    const healer = raw('Healer', 0, 100, [], [{ type: 'heal', strength: 50, directions: ['self'], event: 'always' }]);
    const f = fight([healer], [hitter(100)], { maxRounds: 3 });
    assert.equal(f.deaths(1).length, 0);
    assert.equal(f.cardHp('attacker', 0, 1), 50);
    assert.equal(f.deaths(2).length, 1);
    assert.equal(f.heals(1)[0].hp, 50);
  });

  test('no_buff suppresses abilities for the round but not the normal attack', () => {
    const supp = raw('Supp', 0, BIG, [], [{ type: 'no_buff', directions: ['front'], event: 'round_eq', eventData: 1 }]);
    const buffed = raw('Buffed', 100, BIG, ['direct'], [{ type: 'raise_attack', strength: 100, directions: ['self'], event: 'always' }]);
    const f = fight([supp], [buffed], { maxRounds: 2 });
    assert.deepEqual(f.statuses(1).map((s) => [s.side, s.slot, s.status, s.on]), [['defender', 0, 'suspended', true]]);
    assert.equal(attackOf(f, 1, 'defender', 0).targets[0].damage, 100);
    assert.equal(attackOf(f, 2, 'defender', 0).targets[0].damage, 200);
    assert.equal(f.buffs(1).length, 0);
    assert.equal(f.buffs(2).length, 1);
  });

  test('no_damage zeroes the attack (no attack event) but abilities still fire', () => {
    const daze = raw('Daze', 0, BIG, [], [{ type: 'no_damage', directions: ['front'], event: 'always' }]);
    const dmg = raw('Dmg', 100, BIG, ['direct'], [{ type: 'deal_damage_to_opponent_player', strength: 50, directions: [], event: 'always' }]);
    const f = fight([daze], [dmg], { maxRounds: 1 });
    assert.deepEqual(f.statuses(1).map((s) => [s.side, s.slot, s.status]), [['defender', 0, 'dazed']]);
    assert.equal(f.attacks(1).length, 0);
    assert.deepEqual(f.playerDamage('attacker', 1).map((d) => [d.amount, d.cause, d.hp]), [[50, 'ability', 1450]]);
  });

  test('suspend + daze from the same card is reported as stunned (Siren)', () => {
    const f = fight([card('Siren')], [hitter(100)], { maxRounds: 2 });
    assert.deepEqual(f.statuses(1).map((s) => [s.side, s.slot, s.status]), [['defender', 0, 'suspended'], ['defender', 0, 'stunned']]);
    assert.equal(f.attacks(1).length, 0);
    assert.equal(f.attacks(2).length, 1);
  });

  test('increment_attack is permanent and applied before the attack; raise_attack is reset every round', () => {
    const inc = raw('Inc', 100, BIG, ['direct'], [{ type: 'increment_attack', strength: 10, directions: ['self'], event: 'always' }]);
    const f = fight([inc], [wall()], { maxRounds: 3 });
    assert.deepEqual([1, 2, 3].map((r) => attackOf(f, r, 'attacker', 0).attack), [110, 120, 130]);
    assert.deepEqual(f.buffs(1).map((b) => [b.stat, b.delta, b.permanent]), [['attack', 10, true]]);
    const rs = raw('Rs', 100, BIG, ['direct'], [{ type: 'raise_attack', strength: 50, directions: ['self'], event: 'always' }]);
    const g = fight([rs], [wall()], { maxRounds: 3 });
    assert.deepEqual([1, 2, 3].map((r) => attackOf(g, r, 'attacker', 0).attack), [150, 150, 150]);
    assert.equal(g.buffs(1)[0].permanent, false);
  });

  test('raise_player_hp is re-applied each round while the card lives; the UI sees one +delta and one -delta', () => {
    const tree = raw('Tree', 0, 100, [], [{ type: 'raise_player_hp', strength: 500, directions: [], event: 'always' }]);
    const f = fight([tree], [hitter(100), hitter(100)], { aHp: 1000, maxRounds: 2 });
    assert.deepEqual(f.buffs(1).map((b) => [b.side, b.slot, b.stat, b.delta]), [['attacker', null, 'maxHp', 500]]);
    assert.equal(f.roundEnd(1).attackerHp, 1400);
    assert.equal(f.deaths(1).length, 1);
    assert.deepEqual(f.buffs(2).map((b) => [b.side, b.slot, b.stat, b.delta]), [['attacker', null, 'maxHp', -500]]);
    assert.equal(f.roundEnd(2).attackerHp, 700);
  });

  test('heal_player never exceeds the max (takenDamage clamped at 0) and comes after the attacks', () => {
    const healer = raw('Healer', 0, BIG, [], [{ type: 'heal_player', strength: 500, directions: [], event: 'always' }]);
    const f = fight([healer], [null, hitter(100)], { maxRounds: 1 });
    assert.deepEqual(f.playerDamage('attacker', 1).map((d) => [d.amount, d.hp]), [[100, 1400]]);
    const heals = f.heals(1).filter((h) => h.slot === null);
    assert.deepEqual(heals.map((h) => [h.side, h.amount, h.hp]), [['attacker', 100, 1500]]);
    assert.equal(f.roundEnd(1).attackerHp, 1500);
  });

  test('a card that died this round keeps its slot until clean-up: later attacks still hit it', () => {
    const f = fight([null, hitter(100)], [raw('Weak', 0, 50, []), null], { maxRounds: 1 });
    // attacker slot 1 faces defender slot 1 (empty): player damage; defender slot 0 card is untouched
    assert.equal(sum(f.playerDamage('defender', 1)), 100);
    const g = fight([hitter(100), raw('Diag', 100, BIG, ['left'])], [raw('Weak', 0, 50, [])], { maxRounds: 1 });
    // slot 0 kills Weak in the attack phase (not yet removed); slot 1's frontLeft still hits the card, not the player
    assert.deepEqual(attackOf(g, 1, 'attacker', 1).targets.map((t) => [t.side, t.slot, t.damage]), [['defender', 0, 100]]);
    assert.deepEqual(g.playerDamage('defender', 1), []);
    assert.equal(g.deaths(1).length, 1);
  });
});

/* ------------------------------------------------------------------ reflect */

describe('reflect', () => {
  test('reflect_damage sends the damage back to the attacking card', () => {
    const f = fight([raw('A', 300, 1000, ['direct'])], [card('Lookalike')], { maxRounds: 1 });
    assert.deepEqual(f.damages(1).map((d) => [d.side, d.slot, d.amount, d.cause, d.hp]), [['defender', 0, 300, 'attack', 780], ['attacker', 0, 300, 'reflect', 700]]);
    assert.equal(f.cardHp('attacker', 0, 1), 700);
  });

  test('an invulnerable attacker is not hurt by the reflect (logged as blocked); an invulnerable reflector takes nothing to reflect', () => {
    const inv = raw('Inv', 300, 1000, ['direct'], [{ type: 'invulnerable', directions: ['self'], event: 'always' }]);
    const f = fight([inv], [card('Lookalike')], { maxRounds: 1 });
    assert.deepEqual(f.damages(1).map((d) => [d.side, d.slot, d.amount, d.cause, d.blocked]), [['defender', 0, 300, 'attack', false], ['attacker', 0, 0, 'reflect', true]]);
    assert.equal(f.cardHp('attacker', 0, 1), 1000);
    const mirror = raw('Mirror', 0, 1000, [], [{ type: 'invulnerable', directions: ['self'], event: 'always' }, { type: 'reflect_damage', directions: ['self'], event: 'onDamage', eventData: 'self' }]);
    const g = fight([hitter(300)], [mirror], { maxRounds: 1 });
    assert.deepEqual(g.damages(1).map((d) => [d.side, d.slot, d.amount, d.blocked]), [['defender', 0, 0, true]]);
    assert.deepEqual(attackOf(g, 1, 'attacker', 0).targets.map((t) => [t.damage, t.blocked]), [[300, true]]);
  });

  test('reflect_damage_to_player hits the attacking player, capped per hit (Lava Toad 300)', () => {
    const f = fight([hitter(500)], [card('Lava Toad')], { maxRounds: 1 });
    assert.deepEqual(f.playerDamage('attacker', 1).map((d) => [d.amount, d.cause, d.hp]), [[300, 'reflect', 1200]]);
    const g = fight([hitter(100)], [card('Lava Toad')], { maxRounds: 1 });
    assert.equal(sum(g.playerDamage('attacker', 1)), 100);
  });

  test('a suspended reflector does not reflect that round', () => {
    const a = raw('A', 300, 1000, ['direct'], [{ type: 'no_buff', directions: ['front'], event: 'round_eq', eventData: 1 }]);
    const f = fight([a], [card('Lookalike')], { maxRounds: 2 });
    assert.equal(f.damages(1).filter((d) => d.cause === 'reflect').length, 0);
    assert.equal(f.damages(2).filter((d) => d.cause === 'reflect').length, 1);
  });
});

/* ---------------------------------------------------- deaths and the event loop */

describe('deaths, resurrect and the event loop', () => {
  test('resurrect works once per fight (Phoenix)', () => {
    const f = fight([card('Phoenix')], [hitter(2000)], { maxRounds: 3 });
    assert.deepEqual(f.deaths(1).map((d) => [d.side, d.slot, d.card.name]), [['attacker', 0, 'Phoenix']]);
    assert.deepEqual(f.revives(1).map((r) => [r.side, r.slot, r.hp, r.attack]), [['attacker', 0, 480, 720]]);
    assert.equal(f.deaths(2).length, 1);
    assert.equal(f.revives(2).length, 0);
    assert.equal(f.result.deaths.attacker, 2);
    assert.equal(f.of('revive').length, 1);
    assert.equal(f.cardHp('attacker', 0, 1), 480);
  });

  test('death effects chain through the event loop until no new events (Tribe Avenger bursts)', () => {
    const d1 = raw('D1', 0, 100, [], [{ type: 'deal_damage_to_all_opponent_cards', strength: 100, directions: [], event: 'onDeath', eventData: 'self' }]);
    const f = fight([card('Tribe Avenger'), raw('A2', 0, 150, [])], [hitter(1000), d1], { maxRounds: 1 });
    assert.deepEqual(f.deaths(1).map((d) => [d.side, d.slot]), [['attacker', 0], ['defender', 1]]);
    assert.equal(f.cardHp('attacker', 1, 1), 50);
    assert.equal(f.cardHp('defender', 0, 1), BIG - 300);
    // bursts walk the opponent's slots in the original order (its own left first = our right-to-left for the defender)
    const bursts = f.damages(1).filter((d) => d.cause === 'death');
    assert.deepEqual(bursts.map((d) => [d.side, d.slot, d.amount]), [['defender', 1, 100], ['defender', 0, 100], ['attacker', 0, 100], ['attacker', 1, 100]]);
  });

  test('deal_damage_to_all_opponent_cards is blocked by invulnerable for that round', () => {
    const spirit = raw('Spirit', 0, BIG, [], [{ type: 'deal_damage_to_all_opponent_cards', strength: 700, directions: [], event: 'always' }]);
    const f = fight([spirit], [card('Anvil Guard'), wall()], { maxRounds: 2 });
    // the opponent's slots are walked in the original order (defender ui slot 4 first); sort for readability
    const hits = (r) => f.damages(r).filter((d) => d.side === 'defender').map((d) => [d.slot, d.amount, d.blocked]).sort((a, b) => a[0] - b[0]);
    assert.deepEqual(hits(1), [[0, 0, true], [1, 700, false]]);
    assert.deepEqual(hits(2), [[0, 700, false], [1, 700, false]]);
  });

  test('a card killed in the die phase still fires its later-phase abilities that round (Dryad Oracle)', () => {
    const f = fight([card('Dryad Oracle')], [hitter(5000)], { maxRounds: 1 });
    assert.equal(f.deaths(1).length, 1);
    assert.deepEqual(f.playerDamage('defender', 1).map((d) => [d.amount, d.cause]), [[360, 'attack'], [600, 'death']]);
  });
});

/* -------------------------------------------------------------- nextRound queue */

describe('nextRound queue (extension)', () => {
  test('Sky Guardian: when the card in front dies, the dead card\'s neighbours are dazed next round only', () => {
    const d = () => hitter(100);
    const f = fight([null, null, card('Sky Guardian'), null, null], [wall(), d(), raw('Front', 0, 100, []), d(), wall()], { maxRounds: 3 });
    assert.deepEqual(f.deaths(1).map((x) => [x.side, x.slot]), [['defender', 2]]);
    assert.equal(f.statuses(1).length, 0);
    assert.deepEqual(f.statuses(2).map((s) => [s.side, s.slot, s.status]), [['defender', 1, 'dazed'], ['defender', 3, 'dazed']]);
    assert.deepEqual(f.attacks(1).filter((a) => a.side === 'defender').map((a) => a.slot), [3, 1]);
    assert.deepEqual(f.attacks(2).filter((a) => a.side === 'defender').map((a) => a.slot), []);
    assert.deepEqual(f.attacks(3).filter((a) => a.side === 'defender').map((a) => a.slot), [3, 1]);
    assert.equal(f.statuses(3).length, 0);
  });

  test('triggerDirection: a death elsewhere does not trigger the Sky Guardian', () => {
    const f = fight([null, hitter(500), card('Sky Guardian'), null, null], [wall(), raw('Weak', 100, 100, ['direct']), wall(), hitter(100), wall()], { maxRounds: 2 });
    assert.deepEqual(f.deaths(1).map((x) => [x.side, x.slot]), [['defender', 1]]);
    assert.equal(f.statuses(2).length, 0);
  });

  test('Bone Collector: +100 next round per enemy death, not permanent', () => {
    const f = fight([card('Bone Collector'), hitter(300)], [raw('W1', 0, 100, []), raw('W2', 0, 100, [])], { maxRounds: 3 });
    assert.equal(f.deaths(1).length, 2);
    assert.equal(attackOf(f, 1, 'attacker', 0).attack, 300);
    assert.deepEqual(f.buffs(2).map((b) => [b.side, b.slot, b.delta, b.permanent]), [['attacker', 0, 100, false], ['attacker', 0, 100, false]]);
    assert.equal(attackOf(f, 2, 'attacker', 0).attack, 500);
    assert.equal(attackOf(f, 3, 'attacker', 0).attack, 300);
  });

  test('Gladiator: the amount healed (onHeal) is added to next round\'s attack', () => {
    const healer = raw('H', 0, BIG, [], [{ type: 'heal', strength: 100, directions: ['left'], event: 'always' }]);
    const f = fight([null, card('Gladiator'), healer], [wall(), hitter(200), wall()], { maxRounds: 3 });
    assert.equal(attackOf(f, 1, 'attacker', 1).attack, 480);
    assert.deepEqual(f.heals(1).map((h) => [h.side, h.slot, h.amount, h.hp]), [['attacker', 1, 100, 980]]);
    assert.deepEqual(f.buffs(2).map((b) => [b.slot, b.delta]), [[1, 100]]);
    assert.equal(attackOf(f, 2, 'attacker', 1).attack, 580);
  });
});

/* ------------------------------------------------------------------- kill */

describe('kill (extension, end of the phase list of round N)', () => {
  const foes = () => [hitter(100), hitter(300), hitter(200)];
  test('Colossus kills the highest-attack opposing card at the end of round 2', () => {
    const f = fight([card('Colossus')], foes(), { maxRounds: 3 });
    assert.equal(f.deaths(1).length, 0);
    assert.deepEqual(f.deaths(2).map((d) => [d.side, d.slot]), [['defender', 1]]);
    const kill = f.damages(2).find((d) => d.cause === 'kill');
    assert.deepEqual([kill.side, kill.slot, kill.hp], ['defender', 1, 0]);
    assert.equal(f.attacks(3).filter((a) => a.side === 'defender').length, 2);
  });
  test('Dwarf Judge kills the lowest-attack card, invulnerable or not', () => {
    const inv = raw('Inv', 100, BIG, ['direct'], [{ type: 'invulnerable', directions: ['self'], event: 'always' }]);
    const f = fight([card('Dwarf Judge')], [inv, hitter(300), hitter(200)], { maxRounds: 3 });
    assert.deepEqual(f.deaths(2).map((d) => [d.side, d.slot]), [['defender', 0]]);
  });
  test('Umbral Dragon kills two random cards among both sides except itself; a suppressed killer does nothing', () => {
    const f = fight([card('Umbral Dragon'), wall()], [wall(), wall(), wall()], { maxRounds: 2, seed: 5 });
    const killed = f.deaths(2).map((d) => `${d.side}${d.slot}`);
    assert.equal(killed.length, 2);
    assert.ok(!killed.includes('attacker0'));
    assert.deepEqual(fight([card('Umbral Dragon'), wall()], [wall(), wall(), wall()], { maxRounds: 2, seed: 5 }).deaths(2).map((d) => `${d.side}${d.slot}`), killed);
    const supp = raw('Supp', 100, BIG, ['direct'], [{ type: 'no_buff', directions: ['front'], event: 'round_eq', eventData: 2 }]);
    const g = fight([card('Colossus')], [supp, hitter(300)], { maxRounds: 3 });
    assert.equal(g.of('death').length, 0);
  });
});

/* -------------------------------------------------------------- extensions */

describe('extensions', () => {
  test('bonus_attack on death: Schemer hits the front card for 200 % of its base attack', () => {
    const f = fight([card('Schemer')], [raw('K', 2000, 5000, ['direct'])], { maxRounds: 1 });
    const bonus = f.attacks(1).find((a) => a.bonus);
    assert.deepEqual(bonus.targets.map((t) => [t.side, t.slot, t.damage]), [['defender', 0, 720]]);
    assert.equal(f.cardHp('defender', 0, 1), 5000 - 360 - 720);
  });

  test('Warg Rider: 250 % of base split over five directions = base / 2 each, both rows', () => {
    const f = fight([wall(), wall(), card('Warg Rider'), wall(), wall()], [wall(), wall(), hitter(2000), wall(), wall()], { maxRounds: 1 });
    const bonus = f.attacks(1).find((a) => a.bonus);
    assert.deepEqual(bonus.targets.map((t) => [t.side, t.slot, t.damage]).sort(), [['attacker', 1, 900], ['attacker', 3, 900], ['defender', 1, 900], ['defender', 2, 900], ['defender', 3, 900]].sort());
  });

  test('emptyReduction: Rat Eater +200 and Treeman -200 on an empty slot only', () => {
    const f = fight([card('Rat Eater'), card('Treeman')], [], { maxRounds: 1 });
    assert.deepEqual(f.playerDamage('defender', 1).map((d) => d.amount), [920, 100]);
    const g = fight([card('Rat Eater'), card('Treeman')], [wall(), wall()], { maxRounds: 1 });
    assert.deepEqual(g.damages(1).map((d) => d.amount), [720, 300]);
  });

  test('strengthPercent: Gasher +75 % of the current attack in round 2; baseAttack: Goblin Mob +200 % of base in round 1', () => {
    const f = fight([card('Gasher'), card('Goblin Mob')], [wall(), wall()], { maxRounds: 3 });
    assert.deepEqual([1, 2, 3].map((r) => attackOf(f, r, 'attacker', 0).attack), [500, 875, 500]);
    assert.deepEqual([1, 2, 3].map((r) => attackOf(f, r, 'attacker', 1).attack), [900, 300, 300]);
  });

  test('round_even: Harpy takes no damage in even rounds', () => {
    const f = fight([card('Harpy')], [hitter(100)], { maxRounds: 3 });
    assert.deepEqual([1, 2, 3].map((r) => dmgOf(f, r, 'attacker', 0).map((d) => [d.amount, d.blocked])), [[[100, false]], [[0, true]], [[100, false]]]);
    assert.deepEqual(f.statuses(2).map((s) => [s.slot, s.status]), [[0, 'indestructible']]);
  });

  test('Catapult: attack round_le 3 - alone it ends the fight after round 3', () => {
    const f = fight([card('Catapult')], [wall(), wall()]);
    assert.equal(f.result.rounds, 3);
    assert.equal(f.result.endedBy, 'noAttack');
    assert.equal(f.of('attack').length, 3);
  });

  test('Thief of Time: +800 permanent each round; odd rounds stun front + own neighbours, even rounds the enemy diagonals', () => {
    const d = () => hitter(100);
    const f = fight([null, d(), card('Thief of Time'), d(), null], [wall(), d(), d(), d(), wall()], { maxRounds: 2 });
    const stunned = (r) => f.statuses(r).filter((s) => s.status === 'stunned').map((s) => `${s.side}${s.slot}`).sort();
    assert.deepEqual(stunned(1), ['attacker1', 'attacker3', 'defender2']);
    assert.deepEqual(stunned(2), ['defender1', 'defender3']);
    assert.equal(attackOf(f, 1, 'attacker', 2).attack, 800);
    assert.equal(attackOf(f, 2, 'attacker', 2).attack, 1600);
    assert.deepEqual(f.attacks(1).map((a) => `${a.side}${a.slot}`), ['attacker2', 'defender3', 'defender1']);
  });

  test('Moon Dragon revives every ally that died this round, itself included, once', () => {
    const f = fight([card('Moon Dragon'), raw('Ally', 0, 100, [])], [hitter(2000), hitter(2000)], { maxRounds: 2 });
    assert.deepEqual(f.revives(1).map((r) => [r.side, r.slot, r.hp]), [['attacker', 0, 900], ['attacker', 1, 100]]);
    assert.equal(f.deaths(2).length, 2);
    assert.equal(f.revives(2).length, 0);
    assert.equal(f.result.deaths.attacker, 4);
  });

  test('Bouncer: one random ally and one random foe stunned in rounds 1-2, same picks for no_buff and no_damage', () => {
    const d = () => hitter(100);
    const f = fight([card('Bouncer'), d(), d()], [d(), d(), d()], { maxRounds: 3, seed: 9 });
    for (const r of [1, 2]) {
      const st = f.statuses(r);
      assert.deepEqual(st.map((s) => s.status), ['suspended', 'suspended', 'stunned', 'stunned']);
      const pairs = (status) => st.filter((s) => s.status === status).map((s) => `${s.side}${s.slot}`).sort();
      assert.deepEqual(pairs('suspended'), pairs('stunned'));
      assert.equal(pairs('stunned').filter((p) => p.startsWith('attacker')).length, 1);
      assert.equal(pairs('stunned').filter((p) => p.startsWith('defender')).length, 1);
      assert.ok(!pairs('stunned').includes('attacker0'));
      for (const p of pairs('stunned')) assert.ok(!f.attacks(r).some((a) => `${a.side}${a.slot}` === p), `${p} attacked in round ${r}`);
    }
    assert.equal(f.statuses(3).length, 0);
  });

  test('scope + filter: Totem Carver gives +200 permanent to own offensive orcs (itself included) on any death', () => {
    const orc = raw('Orc', 400, BIG, ['direct'], [], { tribe: 'orc' });
    const elf = raw('Elf', 500, BIG, ['direct'], [], { tribe: 'elf' });
    const orcWall = raw('OrcWall', 0, BIG, [], [], { tribe: 'orc' });
    const f = fight([card('Totem Carver'), orc, elf, orcWall], [raw('D', 0, 100, [])], { maxRounds: 2 });
    assert.equal(f.deaths(1).length, 1);
    assert.deepEqual(f.buffs(1).map((b) => [b.slot, b.delta, b.permanent]), [[0, 200, true], [1, 200, true]]);
    assert.deepEqual([0, 1, 2].map((s) => attackOf(f, 2, 'attacker', s).attack), [500, 600, 500]);
  });

  test('filter on direction buffs: Bone Oracle protects only orc neighbours in round 2', () => {
    const orc = raw('Orc', 0, BIG, [], [], { tribe: 'orc' });
    const elf = raw('Elf', 0, BIG, [], [], { tribe: 'elf' });
    const f = fight([orc, card('Bone Oracle'), elf], [hitter(100), hitter(100), hitter(100)], { maxRounds: 2 });
    assert.equal(f.statuses(1).length, 0);
    assert.deepEqual(f.statuses(2).map((s) => [s.side, s.slot, s.status]), [['attacker', 0, 'indestructible']]);
    assert.deepEqual(dmgOf(f, 2, 'attacker', 0).map((d) => d.blocked), [true]);
    assert.deepEqual(dmgOf(f, 2, 'attacker', 2).map((d) => d.blocked), [false]);
  });

  test('unreflectable: Lightning Spirit is never reflected, a plain damager is', () => {
    // a second attacker keeps the fight going (a lone damager would end it before round 1); it hits an empty slot
    const cardHits = (f) => f.damages(1).filter((d) => d.slot !== null).map((d) => [d.side, d.slot, d.amount, d.cause]);
    const f = fight([card('Lightning Spirit'), hitter(1)], [card('Lookalike')], { maxRounds: 1 });
    assert.deepEqual(cardHits(f), [['defender', 0, 700, 'ability']]);
    const plain = raw('Plain', 0, BIG, [], [{ type: 'deal_damage_to_all_opponent_cards', strength: 700, directions: [], event: 'always' }]);
    const g = fight([plain, hitter(1)], [card('Lookalike')], { maxRounds: 1 });
    assert.deepEqual(cardHits(g), [['defender', 0, 700, 'ability'], ['attacker', 0, 700, 'reflect']]);
  });

  test('damagedBySelf: Battering Ram fires only for a front card it damaged; Crystal Golem whoever killed it', () => {
    const f = fight([card('Battering Ram')], [raw('D0', 0, 1000, [])], { maxRounds: 1 });
    assert.deepEqual(f.playerDamage('defender', 1).map((d) => [d.amount, d.cause]), [[300, 'death']]);
    const dazer = raw('D0', 0, 1000, [], [{ type: 'no_damage', directions: ['front'], event: 'round_eq', eventData: 1 }]);
    const sidekick = raw('Side', 2000, BIG, ['left']);
    const g = fight([card('Battering Ram'), sidekick], [dazer], { maxRounds: 1 });
    assert.equal(g.deaths(1).length, 1);
    assert.deepEqual(g.playerDamage('defender', 1), []);
    const h = fight([card('Crystal Golem'), sidekick], [dazer], { maxRounds: 1 });
    assert.deepEqual(h.playerDamage('defender', 1).map((d) => d.amount), [720]);
  });

  test('heal_boost_percent: Djinn adds 6 % to the side\'s card heals (240 -> 254)', () => {
    const f = fight([card('Argonaut'), card('Djinn')], [wall(), wall()], { maxRounds: 1 });
    assert.deepEqual(f.heals(1).map((h) => [h.side, h.slot, h.amount]), [['attacker', 1, 254]]);
    const g = fight([card('Argonaut'), wall()], [wall(), wall()], { maxRounds: 1 });
    assert.deepEqual(g.heals(1).map((h) => h.amount), [240]);
  });

  test('reduce_ability_attack_percent: Medusa takes 6 % from every ability card on both sides except herself, round 1 only', () => {
    const ab = raw('Ab', 1000, BIG, ['direct'], [{ type: 'heal', strength: 1, directions: ['self'], event: 'always' }]);
    const plain = raw('Plain', 1000, BIG, ['direct']);
    const dab = raw('DAb', 1000, BIG, ['direct'], [{ type: 'self_damage', strength: 1, directions: [], event: 'always' }]);
    const f = fight([card('Medusa'), ab, plain], [dab], { maxRounds: 2, dHp: 10000 });
    assert.deepEqual(f.buffs(1).map((b) => [b.side, b.slot, b.delta]), [['attacker', 1, -60], ['defender', 0, -60]]);
    assert.deepEqual([0, 1, 2].map((s) => attackOf(f, 1, 'attacker', s).attack), [1350, 940, 1000]);
    assert.equal(attackOf(f, 2, 'attacker', 1).attack, 1000);
  });

  test('gamble: one roll per round, +/-25 % on every own offensive card', () => {
    const f = fight([card('Wizard Apprentice'), hitter(1000), wall()], [wall(), wall(), wall()], { maxRounds: 1, seed: 4 });
    const g = f.of('gamble', 1);
    assert.equal(g.length, 1);
    const sign = g[0].failed ? -1 : 1;
    assert.deepEqual(f.buffs(1).map((b) => [b.slot, b.delta]), [[0, 375 * sign], [1, 250 * sign]]);
    assert.equal(attackOf(f, 1, 'attacker', 1).attack, 1000 + 250 * sign);
  });

  test('wheel: every other living card is healed or damaged by the value once per round, seeded', () => {
    const f = fight([card('Wheel of Fortune'), hitter(1)], [wall(), wall()], { maxRounds: 2, seed: 2 });
    for (const r of [1, 2]) {
      const touched = [...f.heals(r), ...f.damages(r).filter((d) => d.cause === 'ability')].map((e) => [`${e.side}${e.slot}`, e.amount]);
      assert.deepEqual(touched.map((t) => t[0]).sort(), ['attacker1', 'defender0', 'defender1']);
      assert.ok(touched.every((t) => t[1] === 900));
    }
  });

  test('swap_stats_random: in round 1 one random living card swaps attack and hp', () => {
    const f = fight([card('Goblin Thieves')], [raw('Big', 100, 5000, ['direct'])], { maxRounds: 2, seed: 1 });
    const swaps = f.of('swap');
    assert.equal(swaps.length, 1);
    const sw = swaps[0];
    const before = f.events[0][sw.side].cards[sw.slot];
    assert.equal(sw.attack, before.maxHp);
    assert.equal(sw.maxHp, before.attack);
    assert.equal(attackOf(f, 1, sw.side, sw.slot).attack, before.maxHp);
  });

  test('Hurricane Dancer dazes the three opposing cards and her own two neighbours in round 1', () => {
    const d = () => hitter(100);
    const f = fight([null, d(), card('Hurricane Dancer'), d(), null], [wall(), d(), d(), d(), wall()], { maxRounds: 2 });
    assert.deepEqual(f.statuses(1).map((s) => `${s.side}${s.slot}`).sort(), ['attacker1', 'attacker3', 'defender1', 'defender2', 'defender3']);
    assert.deepEqual(f.attacks(1).map((a) => `${a.side}${a.slot}`), ['attacker2']);
    assert.equal(f.attacks(2).length, 6);
  });

  test('Enormous Larva returns with 11 x its base attack; Bone Dragon adds its value', () => {
    const f = fight([card('Enormous Larva'), card('Bone dragon')], [hitter(5000), hitter(5000)], { maxRounds: 2 });
    assert.deepEqual(f.revives(1).map((r) => [r.slot, r.attack]), [[0, 1650], [1, 3200]]);
    assert.equal(attackOf(f, 2, 'attacker', 0).attack, 1650);
    assert.equal(attackOf(f, 2, 'attacker', 1).attack, 3200);
  });
});

/* ------------------------------------------------------------------ events */

describe('event log details for the UI', () => {
  test('status events carry on:true and their source; attack targets flag blocked hits', () => {
    const f = fight([hitter(300)], [card('Anvil Guard')], { maxRounds: 2 });
    assert.deepEqual(f.statuses(1), [{ t: 'status', side: 'defender', slot: 0, status: 'indestructible', on: true, source: { side: 'defender', slot: 0, effect: 'invulnerable' } }]);
    assert.deepEqual(attackOf(f, 1, 'attacker', 0).targets, [{ side: 'defender', slot: 0, damage: 300, blocked: true, dir: 'front' }]);
    assert.deepEqual(dmgOf(f, 1, 'defender', 0).map((d) => [d.amount, d.blocked, d.hp]), [[0, true, 720]]);
    assert.deepEqual(dmgOf(f, 2, 'defender', 0).map((d) => [d.amount, d.blocked, d.hp]), [[300, false, 420]]);
  });

  test('damage and heal events report the hp after the change, heals capped at the max for display', () => {
    const healer = raw('H', 0, 1000, [], [{ type: 'heal', strength: 400, directions: ['self'], event: 'always' }]);
    const f = fight([healer], [hitter(100)], { maxRounds: 2 });
    assert.deepEqual(dmgOf(f, 1, 'attacker', 0).map((d) => d.hp), [900]);
    assert.deepEqual(f.heals(1).map((h) => [h.amount, h.hp]), [[400, 1000]]);
    assert.equal(f.cardHp('attacker', 0, 1), 1000);
    assert.deepEqual(dmgOf(f, 2, 'attacker', 0).map((d) => d.hp), [900]);
  });

  test('max hp buffs: one +delta when applied, one -delta when the buffer is gone (Arch Angel)', () => {
    const f = fight([card('Arch Angel'), raw('N', 0, 1000, [])], [hitter(2000), wall()], { maxRounds: 3 });
    assert.deepEqual(f.buffs(1).map((b) => [b.side, b.slot, b.stat, b.delta, b.source && b.source.effect]), [['attacker', 1, 'maxHp', 200, 'raise_hp']]);
    assert.equal(f.deaths(1).length, 1);
    assert.deepEqual(f.buffs(2).map((b) => [b.side, b.slot, b.stat, b.delta]), [['attacker', 1, 'maxHp', -200]]);
    assert.equal(f.buffs(3).length, 0);
    const g = fight([card('Arch Angel'), raw('N', 0, 1000, [])], [wall(), wall()], { maxRounds: 3 });
    assert.equal(g.of('buff').length, 1);
  });

  test('death, revive and battleEnd events; summariseBattle agrees with the result', () => {
    const f = fight([card('Phoenix')], [hitter(2000)], { maxRounds: 2 });
    const death = f.deaths(1)[0];
    assert.equal(death.card.cardId, 'phoenix');
    assert.equal(death.card.name, 'Phoenix');
    const end = f.events[f.events.length - 1];
    assert.deepEqual([end.t, end.winner, end.rounds, end.endedBy], ['battleEnd', f.result.winner, 2, 'maxRounds']);
    const s = summariseBattle(f.events);
    assert.equal(s.winner, f.result.winner);
    assert.equal(s.rounds, 2);
    assert.deepEqual(s.deaths, f.result.deaths);
    assert.ok(s.lines[0].startsWith('battle start'));
    assert.ok(s.lines.some((l) => l.includes('revives')));
    assert.ok(s.lines[s.lines.length - 1].startsWith('battle end'));
  });

  test('a dazed card attacking an empty slot with a negative emptyReduction still hurts the player (original quirk)', () => {
    const daze = raw('Daze', 0, BIG, [], [{ type: 'no_damage', directions: ['frontRight'], event: 'always' }]);
    const f = fight([null, daze, null], [null, null, card('Rat Eater')], { maxRounds: 1 });
    // the dazed Rat Eater (defender slot 2) faces attacker slot 2 (empty): attack 0, empty-slot share round((0 + 200) / 1)
    assert.deepEqual(f.playerDamage('attacker', 1).map((d) => d.amount), [200]);
  });
});

/* -------------------------------------------------------------- real data */

describe('real catalog', () => {
  test('1000 random fights with data/cards.json run in under 3 s with well-formed events', async () => {
    const db = await loadCardsDbFromFile();
    const rng = mulberry32(20261008);
    const instance = (uid) => {
      const def = rng.pick(db.all().filter((d) => !d.trainer));
      const stage = rng.int(5);
      return { uid, cardId: def.id, stage, level: 1 + rng.int(capFor(def, stage)), xp: 0, evolveQuality: 1 };
    };
    const sideOf = (name) => {
      const list = [];
      for (let i = 0; i < SLOT_COUNT; i++) list.push(rng.chance(0.85) ? instance(`${name}${i}`) : null);
      return buildSide({ name, hp: 1500 + rng.int(3000) }, list, db);
    };
    const t0 = performance.now();
    const winners = { attacker: 0, defender: 0, draw: 0 };
    for (let i = 0; i < 1000; i++) {
      const out = simulateBattle({ attacker: sideOf('a'), defender: sideOf('d'), seed: rng.int(1e9) });
      winners[out.result.winner]++;
      assert.equal(out.events[0].t, 'battleStart');
      assert.equal(out.events[out.events.length - 1].t, 'battleEnd');
      assert.ok(out.result.rounds >= 0 && out.result.rounds <= 20);
      for (const ev of out.events) assert.ok(EVENT_TYPES.includes(ev.t), ev.t);
    }
    const ms = performance.now() - t0;
    assert.ok(ms < 3000, `1000 fights took ${Math.round(ms)} ms`);
    assert.ok(winners.attacker > 0 && winners.defender > 0);
  });
});

/* ================================================================= the original unit tests */

const TESTS = JSON.parse(readFileSync(new URL('./fixtures/original-tests.json', import.meta.url), 'utf8'));
const CARDS = JSON.parse(readFileSync(new URL('./fixtures/original-cards.json', import.meta.url), 'utf8'));
const RACE = { Orks: 'orc', Elfen: 'elf', Zwerge: 'dwarf', Neutral: 'neutral' };
const WON = { 1: 'attacker', 2: 'defender', 0: 'draw' };

/** Original card table entry -> BattleCard with explicit buffs (the stored `die` buff is implicit in our engine). */
function toCard(entry, i) {
  const c = typeof entry === 'string' ? CARDS[entry] : entry;
  if (!c) return null;
  const name = typeof entry === 'string' ? entry : `card${i}`;
  return {
    instanceId: `o${i}`, cardId: name, name, tribe: RACE[c.race] || 'neutral', rarity: 'common', mana: Number(c.mana) || 0,
    stage: 0, level: 1, attack: Number(c.attack), maxHp: Number(c.hp), hp: Number(c.hp), abilityValue: 0, dirs: [], ability: null,
    buffs: c.buffs.filter((b) => b.type !== 'die'),
  };
}

function sideOf(p, name) {
  return { player: { name, hp: p.hp, maxHp: p.hp }, cards: p.cards.map(toCard) };
}

/** Run one original test; the engine evaluates the race bonus itself (raw sides carry no tribeBonus flag). */
function runOriginal(t) {
  return simulateBattle({ attacker: sideOf(t.p1, 'p1'), defender: sideOf(t.p2, 'p2'), seed: 1, options: { raceBonus: true } });
}

describe('verify: the original unit tests (testfightsimulatorsimplev2) reproduce exactly', () => {
  assert.equal(TESTS.length, 64);
  TESTS.forEach((t, idx) => {
    test(`${t.name} [#${idx + 1}]`, () => {
      const out = runOriginal(t);
      const ends = out.events.filter((e) => e.t === 'roundEnd');
      const log = () => summariseBattle(out.events).lines.join('\n');
      assert.equal(out.result.winner, WON[t.won], `winner\n${log()}`);
      assert.equal(out.result.rounds, t.rounds.length, `round count\n${log()}`);
      assert.equal(ends.length, t.rounds.length);
      t.rounds.forEach((r, k) => {
        const e = ends[k];
        assert.equal(e.round, k + 1);
        assert.equal(e.attackerHp, r.p1.hp, `round ${k + 1} player 1 hp\n${log()}`);
        assert.equal(e.defenderHp, r.p2.hp, `round ${k + 1} player 2 hp\n${log()}`);
        assert.deepEqual(e.cards.attacker, r.p1.cards, `round ${k + 1} player 1 cards\n${log()}`);
        assert.deepEqual(e.cards.defender, r.p2.cards, `round ${k + 1} player 2 cards\n${log()}`);
      });
      // the result hp values are the final player health exactly as the original computes them
      const last = ends[ends.length - 1];
      if (last) {
        assert.equal(out.result.attackerHp, last.attackerHp);
        assert.equal(out.result.defenderHp, last.defenderHp);
      }
    });
  });
});

describe('verify: the decoded corpus itself', () => {
  test('covers every one of the 18 original handlers and the three event kinds', () => {
    const types = new Set();
    const events = new Set();
    const collect = (c) => { if (c && typeof c === 'object') for (const b of c.buffs) { types.add(b.type); events.add(b.event); } };
    for (const t of TESTS) for (const p of [t.p1, t.p2]) p.cards.forEach(collect);
    for (const c of Object.values(CARDS)) collect(c);
    for (const type of ['no_buff', 'heal', 'raise_attack', 'raise_hp', 'raise_player_hp', 'heal_player', 'increment_attack', 'invulnerable',
      'no_damage', 'attack', 'resurrect', 'die', 'reflect_damage', 'reflect_damage_to_player', 'deal_damage_to_opponent_player',
      'deal_damage_to_player', 'deal_damage_to_all_opponent_cards', 'self_damage']) assert.ok(types.has(type), type);
    for (const ev of ['always', 'round_eq', 'round_ge', 'round_le', 'onDamage', 'onDeath']) assert.ok(events.has(ev), ev);
  });

  test('the four GD cases use 20 named original cards with 8, 7, 11 and 6 rounds of snapshots', () => {
    const gd = TESTS.filter((t) => t.name.startsWith('testGDTestCase'));
    assert.equal(gd.length, 4);
    assert.deepEqual(gd.map((t) => t.rounds.length), [8, 7, 11, 6]);
    for (const t of gd) for (const p of [t.p1, t.p2]) for (const c of p.cards) if (c) assert.ok(CARDS[c], `unknown original card ${c}`);
    assert.equal(Object.keys(CARDS).length, 40);
    assert.equal(CARDS.rattenfresser.buffs.find((b) => b.type === 'attack').emptyReduction, -200);
    assert.equal(CARDS.baummensch.buffs.find((b) => b.type === 'attack').emptyReduction, 200);
    assert.equal(CARDS.katapult.buffs.find((b) => b.type === 'no_damage').event, 'round_ge');
  });

  test('mirroring: UpSideDown cases hit the facing-order slots our UI uses', () => {
    // player 2's frontLeft attacker at facing index 2 hits player 1's index 3 (its own left = our right)
    const t1 = TESTS.find((t) => t.name === 'testUpSideDown1');
    const out = runOriginal(t1);
    const hit = out.events.find((e) => e.t === 'attack');
    assert.deepEqual([hit.side, hit.slot], ['defender', 2]);
    assert.deepEqual(hit.targets.map((x) => [x.side, x.slot, x.damage]), [['attacker', 3, 50]]);
    // frontRight from facing index 2 hits index 1
    const t2 = TESTS.find((t) => t.name === 'testUpSideDown2');
    const out2 = runOriginal(t2);
    const hit2 = out2.events.find((e) => e.t === 'attack');
    assert.deepEqual(hit2.targets.map((x) => [x.side, x.slot, x.damage]), [['attacker', 1, 50]]);
  });

  test('race bonus cases: 1.2 x hp only for one main race outnumbering the neutrals', () => {
    const byName = Object.fromEntries(TESTS.map((t) => [t.name, t]));
    const p2hp = (name) => runOriginal(byName[name]).events.find((e) => e.t === 'roundEnd').defenderHp;
    assert.equal(p2hp('testRaceBonus1'), 120);
    assert.equal(p2hp('testRaceBonus3'), 120); // 4 orcs + 1 neutral
    assert.equal(p2hp('testRaceBonus4'), 120); // 3 orcs + 2 neutrals
    assert.equal(p2hp('testRaceBonus5'), 100); // 2 orcs + 3 neutrals
    assert.equal(p2hp('testRaceBonus6'), 100); // orcs + an elf
    assert.equal(p2hp('testRaceBonus8'), 100); // 2 orcs + 2 neutrals
    const bonus = runOriginal(byName.testRaceBonus1).events.find((e) => e.t === 'buff' && e.slot === null);
    assert.deepEqual([bonus.side, bonus.stat, bonus.delta], ['defender', 'maxHp', 20]);
  });
});

/* ------------------------------------------------------------ neighbour directions per row */

describe('neighbour directions on the two rows (reported 2026-10-12: "the Worm Shaman heals his left neighbour")', () => {
  // "right" is the card's own right: the top row faces the player, so its right is the screen's left - the
  // simulator indexes the opponent's row from the opponent's own left (original-engine.md §2) and the client
  // turned the arrow overlay of enemy cards by 180 degrees (comp_card_v3 enemyMode). The heal was right all
  // along; the arrows of the top row pointed the wrong way (css/cards.css, pinned in tests/ui.test.js).
  const healer = () => raw('Healer', 0, BIG, [], [{ type: 'heal', strength: 50, directions: ['right'], event: 'always' }]);
  const hurt = () => raw('Hurt', 0, 1000, []);
  const idle = () => raw('Idle', 0, BIG, []);

  test('bottom row: a right-neighbour heal lands on the card to the screen right', () => {
    const f = fight([hurt(), healer(), hurt()], [hitter(100), idle(), hitter(100)], { maxRounds: 1 });
    assert.deepEqual(f.heals(1).map((e) => [e.side, e.slot]), [['attacker', 2]]);
    assert.equal(f.cardHp('attacker', 2, 1), 950);
    assert.equal(f.cardHp('attacker', 0, 1), 900);
  });

  test('top row: the same heal lands on the card to the screen LEFT (the row faces the player)', () => {
    const f = fight([hitter(100), idle(), hitter(100)], [hurt(), healer(), hurt()], { maxRounds: 1 });
    assert.deepEqual(f.heals(1).map((e) => [e.side, e.slot]), [['defender', 0]]);
    assert.equal(f.cardHp('defender', 0, 1), 950);
    assert.equal(f.cardHp('defender', 2, 1), 900);
  });
});
