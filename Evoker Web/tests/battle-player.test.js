'use strict';
/**
 * Tests for the pure part of the battle playback (src/ui/battle/*.js, no DOM): the timeline builder fromEvents(),
 * stepDuration() scaling, and finalState() (what "Skip fight" jumps to), using real
 * event logs produced by the battle engine with the fixture cards.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fromEvents, stepDuration, tribeBonuses, roundFactor, STEP_MS, orderDeathsAfterReflects } from '../src/ui/battle/timeline.js';
import { finalState, initialModel, reduceEvent } from '../src/ui/battle/model.js';
import { hpLabelColor } from '../src/ui/battle-player.js';
import { card, vanilla, wall, fight } from './fixtures/cards.js';

/** Sum of the step durations of a timeline (ms). */
const total = (steps) => steps.reduce((sum, s) => sum + s.dur, 0);

/** A fight with attacks, heals, statuses, buffs, deaths and a revive. */
function richFight() {
  return fight(
    [card('Argonaut'), card('Dwarf King'), card('Phoenix'), card('Siren'), vanilla('Brute', 400, 300)],
    [vanilla('Grunt', 250, 500), card('Anvil Guard'), vanilla('Slayer', 900, 400), card('Lava Toad'), null],
    { seed: 7, aHp: 1500, dHp: 1500 },
  );
}

describe('battle-player fromEvents', () => {
  test('keeps the event order: start, rounds in increasing order, roundEnd per round, end last', () => {
    const { events } = richFight();
    const steps = fromEvents(events, 1);
    assert.equal(steps[0].type, 'start');
    assert.equal(steps[steps.length - 1].type, 'end');
    const rounds = steps.filter((s) => s.type === 'round').map((s) => s.round);
    assert.deepEqual(rounds, rounds.map((_, i) => i + 1));
    const ends = steps.filter((s) => s.type === 'roundEnd').map((s) => s.round);
    assert.deepEqual(ends, rounds);
    // every step carries the raw events it covers, and the flattened steps reproduce the log exactly
    const flat = steps.flatMap((s) => s.events);
    assert.equal(flat.length, events.length);
    flat.forEach((ev, i) => assert.equal(ev, events[i]));
    // a round banner always precedes the first action of that round and the roundEnd follows it
    for (let i = 1; i < steps.length; i++) {
      if (steps[i].type === 'roundEnd') {
        const prevRound = steps.slice(0, i).reverse().find((s) => s.type === 'round');
        assert.equal(prevRound.round, steps[i].round);
      }
    }
  });

  test('folds attack damage into the attack step and groups heals, deaths and ability damage', () => {
    const { events } = richFight();
    const steps = fromEvents(events, 1);
    const attacks = steps.filter((s) => s.type === 'attack');
    assert.ok(attacks.length > 0);
    for (const a of attacks) {
      assert.ok(Array.isArray(a.targets));
      for (const hit of a.hits) assert.ok(['attack', 'reflect'].includes(hit.cause));
      // the damage dealt by the attack is the damage recorded on its targets
      const dealt = a.hits.filter((h) => h.cause === 'attack').reduce((s, h) => s + h.amount, 0);
      const expected = a.targets.reduce((s, t) => s + (t.blocked ? 0 : t.damage), 0);
      assert.equal(dealt, expected);
    }
    // no bare 'damage' step is an attack hit (those belong to attack steps)
    for (const d of steps.filter((s) => s.type === 'damage')) assert.notEqual(d.cause, 'attack');
    const heals = steps.filter((s) => s.type === 'heal');
    assert.ok(heals.length > 0, 'Argonaut heals its neighbours');
    for (const hl of heals) for (const e of hl.heals) assert.equal(e.t, 'heal');
    const statuses = steps.filter((s) => s.type === 'status');
    assert.ok(statuses.some((s) => s.status === 'stunned'), 'Siren stuns the card opposite');
    assert.ok(statuses.some((s) => s.status === 'indestructible'), 'Anvil Guard is indestructible in round 1');
    const buffs = steps.filter((s) => s.type === 'buff');
    assert.ok(buffs.some((b) => b.stat === 'attack'), 'Dwarf King strengthens its neighbours');
    const deaths = steps.filter((s) => s.type === 'death');
    assert.ok(deaths.length > 0);
    for (const d of deaths) assert.ok(d.deaths.length >= 1 && d.deaths.every((e) => e.t === 'death'));
  });

  test('revive produces a revive step after the Phoenix dies', () => {
    const { events } = fight([card('Phoenix')], [vanilla('Slayer', 2000, 5000)], { seed: 1 });
    const steps = fromEvents(events);
    const i = steps.findIndex((s) => s.type === 'revive');
    assert.ok(i > 0, 'has a revive step');
    assert.equal(steps[i].side, 'attacker');
    assert.equal(steps[i].slot, 0);
    assert.equal(steps[i].hp, 480);
    // the death that triggers the revive happens later (phoenix comes back at full hp, then dies for good)
    const deathAfter = steps.slice(i).find((s) => s.type === 'death');
    assert.ok(deathAfter);
  });

  test('empty or missing input yields no steps; unknown events become misc steps', () => {
    assert.deepEqual(fromEvents([]), []);
    assert.deepEqual(fromEvents(null), []);
    const steps = fromEvents([{ t: 'battleStart', attacker: { player: {}, cards: [] }, defender: { player: {}, cards: [] } }, { t: 'weird' }]);
    assert.equal(steps[1].type, 'misc');
    assert.equal(steps[1].dur, STEP_MS.misc);
  });
});

describe('battle-player reflect ordering (bug: the reflector dissolved before its bounced beam)', () => {
  const start = { t: 'battleStart', attacker: { player: {}, cards: [] }, defender: { player: {}, cards: [] } };
  const hit = { t: 'damage', cause: 'attack', side: 'defender', slot: 0, amount: 2000, hp: -920, source: { side: 'attacker', slot: 0 } };
  const death = { t: 'death', side: 'defender', slot: 0, card: { name: 'Lookalike' } };
  const bounce = { t: 'damage', cause: 'reflect', side: 'attacker', slot: 0, amount: 2000, hp: 3000, source: { side: 'defender', slot: 0 } };
  const attack = { t: 'attack', side: 'attacker', slot: 0, attack: 2000, targets: [{ side: 'defender', slot: 0 }] };

  test('a death logged before the reflect damage of the same card is moved after it', () => {
    const out = orderDeathsAfterReflects([start, attack, hit, death, bounce, { t: 'roundEnd', round: 1 }]);
    assert.deepEqual(out.map((e) => e.t + (e.cause ? ':' + e.cause : '')), ['battleStart', 'attack', 'damage:attack', 'damage:reflect', 'death', 'roundEnd']);
  });

  test('the bounce joins the attack step and the death step comes after it', () => {
    const steps = fromEvents([start, { t: 'roundStart', round: 1 }, attack, hit, death, bounce, { t: 'roundEnd', round: 1 }]);
    const types = steps.map((s) => s.type);
    assert.deepEqual(types, ['start', 'round', 'attack', 'death', 'roundEnd']);
    assert.deepEqual(steps[2].hits.map((h) => h.cause), ['attack', 'reflect']);
    assert.equal(steps[3].deaths[0].slot, 0);
  });

  test('deaths not followed by their own reflects, and reflects from another card, are left alone', () => {
    const other = { ...bounce, source: { side: 'defender', slot: 1 } };
    const list = [start, attack, hit, death, other];
    assert.deepEqual(orderDeathsAfterReflects(list), list);
    const plain = [start, attack, hit, death, { t: 'roundEnd', round: 1 }];
    assert.deepEqual(orderDeathsAfterReflects(plain), plain);
  });

  test('the real engine log of a hitter against Lookalike plays the bounce before the dissolve', () => {
    const events = fight([vanilla('Hitter', 2000, 5000)], [card('Lookalike')], { maxRounds: 1 }).events;
    const steps = fromEvents(events);
    const attackIdx = steps.findIndex((s) => s.type === 'attack' && s.hits.some((h) => h.cause === 'reflect'));
    const deathIdx = steps.findIndex((s) => s.type === 'death');
    assert.ok(attackIdx >= 0 && deathIdx > attackIdx, `attack step ${attackIdx} must come before the death step ${deathIdx}`);
  });
});

describe('battle-player durations', () => {
  test('every step has a positive duration taken from STEP_MS at 1x', () => {
    const { events } = richFight();
    for (const s of fromEvents(events, 1)) {
      assert.ok(s.dur > 0);
      const f = s.factor || 1;
      if (s.type === 'attack' && (s.targets.length || s.hits.length)) assert.equal(s.dur, Math.round(STEP_MS.attack * f));
      if (s.type === 'round') assert.equal(s.dur, Math.round(STEP_MS.round * f));
      if (s.type === 'heal') assert.equal(s.dur, Math.round(STEP_MS.heal * f));
    }
  });

  test('durations scale inversely with speed (2x halves the timeline)', () => {
    const { events } = richFight();
    const s1 = fromEvents(events, 1);
    const s2 = fromEvents(events, 2);
    assert.equal(s1.length, s2.length);
    s1.forEach((s, i) => {
      assert.equal(s2[i].type, s.type);
      assert.equal(s2[i].dur, Math.max(1, Math.round(s.dur / 2)));
      assert.ok(s2[i].dur <= s.dur);
    });
    const t1 = total(s1);
    const t2 = total(s2);
    assert.ok(t1 > 0);
    assert.ok(Math.abs(t2 - t1 / 2) <= s1.length, `2x total ${t2} ~ half of ${t1}`);
  });

  test('stepDuration tolerates bad speeds and honours a per-step base', () => {
    assert.equal(stepDuration({ type: 'heal' }, 0), STEP_MS.heal);
    assert.equal(stepDuration({ type: 'heal' }, -3), STEP_MS.heal);
    assert.equal(stepDuration({ type: 'heal' }, undefined), STEP_MS.heal);
    assert.equal(stepDuration({ type: 'attack', base: 200 }, 2), 100);
    assert.equal(stepDuration({ type: 'nope' }, 1), STEP_MS.misc);
    assert.equal(stepDuration({ type: 'round' }, 1000000), 1);
  });
});

describe('battle-player pacing at 1x = the original client (DECISIONS D5)', () => {
  test('round 1 follows the server sample: one attacker every 1.5 s; later rounds run 0.9x faster each', () => {
    assert.equal(STEP_MS.attack, 1500);
    assert.equal(roundFactor(1), 1);
    assert.equal(roundFactor(2), 0.9);
    assert.ok(Math.abs(roundFactor(3) - 0.81) < 1e-9);
    assert.equal(roundFactor(40), 0.3, 'floored');
    const { events } = fight([vanilla('Grunt', 100, 100000)], [null], { seed: 4, maxRounds: 12, aHp: 1500, dHp: 100000 });
    const steps = fromEvents(events, 1);
    const attacks = steps.filter((s) => s.type === 'attack');
    assert.equal(attacks[0].dur, 1500);
    assert.equal(attacks[1].dur, 1350);
    // rounds 3 -> 11 of a lone attacker take about 6-8 s (video: ~6 s)
    let t = 0;
    let inRange = false;
    for (const s of steps) {
      if (s.type === 'round' && s.round === 3) inRange = true;
      if (s.type === 'round' && s.round === 11) break;
      if (inRange) t += s.dur;
    }
    assert.ok(t >= 5500 && t <= 8000, `rounds 3-11 in ${t} ms`);
  });

  test('a 5v5 fight of two rounds lasts 25-35 s at 1x, half that at 2x', () => {
    const f = fight([1, 2, 3, 4, 5].map((i) => vanilla(`A${i}`, 500 + i * 10, 700)), [1, 2, 3, 4, 5].map((i) => vanilla(`D${i}`, 500 - i * 10, 750)), { seed: 11, aHp: 1500, dHp: 1500 });
    const t1 = total(fromEvents(f.events, 1));
    const rounds = f.result.rounds;
    assert.ok(rounds >= 2 && rounds <= 3 && t1 >= 25000 && t1 <= 35000, `5v5 fight ${t1} ms in ${rounds} rounds`);
    assert.ok(total(fromEvents(f.events, 2)) <= t1 / 2 + 50);
  });

  test('the HP number is grey above 2/3 and blends into red below (comp_progress_bar)', () => {
    assert.equal(hpLabelColor(1), 'rgb(229, 229, 229)');
    assert.equal(hpLabelColor(860 / 960), 'rgb(229, 229, 229)');
    assert.equal(hpLabelColor(0), 'rgb(255, 0, 20)');
    const mid = hpLabelColor(660 / 960).match(/\d+/g).map(Number);
    assert.ok(mid[1] < 200 && mid[0] > 229, `660/960 is reddish: ${mid}`);
  });
});

describe('battle-player tribe bonus moment', () => {
  test('a side with the bonus counts up from its base hp by exactly 20 %', () => {
    const start = { t: 'battleStart', attacker: { player: { hp: 1800, maxHp: 1800, baseMaxHp: 1500, tribeBonus: true }, cards: [{ tribe: 'orc' }, { tribe: 'orc' }, { tribe: 'neutral' }] }, defender: { player: { hp: 960, maxHp: 960, tribeBonus: true }, cards: [{ tribe: 'elf' }] } };
    const b = tribeBonuses(start);
    assert.deepEqual(b, [{ side: 'attacker', from: 1500, to: 1800, tribe: 'orc' }, { side: 'defender', from: 800, to: 960, tribe: 'elf' }]);
    const steps = fromEvents([start]);
    assert.equal(steps[0].type, 'start');
    assert.equal(steps[0].dur, STEP_MS.bonus);
    assert.deepEqual(tribeBonuses({ attacker: { player: { maxHp: 1500, tribeBonus: false } } }), []);
    assert.equal(fromEvents([{ ...start, attacker: { player: {}, cards: [] }, defender: { player: {}, cards: [] } }])[0].dur, STEP_MS.start);
  });

  test('a real fight built with buildSide reports the bonus of a single-tribe deck', () => {
    const { events } = fight([vanilla('O1', 100, 100, ['direct'], 'orc'), vanilla('O2', 100, 100, ['direct'], 'orc')], [vanilla('N', 100, 100)], { seed: 1, aHp: 1500, dHp: 1000, maxRounds: 1, tribeBonus: true });
    const b = tribeBonuses(events[0]);
    assert.deepEqual(b, [{ side: 'attacker', from: 1500, to: 1800, tribe: 'orc' }], 'the all-neutral defender gets nothing');
    assert.equal(events[0].attacker.player.maxHp, 1800);
  });
});

describe('battle-player finalState (skip summary)', () => {
  test('player hp and winner equal the battleEnd / last roundEnd events and the engine result', () => {
    const f = richFight();
    const final = finalState(f.events);
    const end = f.events[f.events.length - 1];
    assert.equal(end.t, 'battleEnd');
    assert.equal(final.winner, f.result.winner);
    assert.equal(final.rounds, f.result.rounds);
    assert.equal(final.attacker.player.hp, end.attackerHp);
    assert.equal(final.defender.player.hp, end.defenderHp);
    const lastRoundEnd = f.events.filter((e) => e.t === 'roundEnd').pop();
    assert.equal(final.attacker.player.hp, lastRoundEnd.attackerHp);
    assert.equal(final.defender.player.hp, lastRoundEnd.defenderHp);
    assert.equal(final.attacker.player.hp, f.result.attackerHp);
    assert.equal(final.defender.player.hp, f.result.defenderHp);
    assert.equal(final.ended, true);
  });

  test('card hp matches the last damage/heal event of every card and dead slots match deaths minus revives', () => {
    const f = richFight();
    const final = finalState(f.events);
    for (const side of ['attacker', 'defender']) {
      for (let slot = 0; slot < 5; slot++) {
        const m = final[side].cards[slot];
        const start = f.events[0][side].cards[slot];
        if (!start) { assert.equal(m, null); continue; }
        const last = f.events.filter((e) => (e.t === 'damage' || e.t === 'heal' || e.t === 'revive') && e.side === side && e.slot === slot).pop();
        if (last) assert.equal(m.hp, last.hp); else assert.equal(m.hp, start.hp);
        const died = f.events.filter((e) => e.t === 'death' && e.side === side && e.slot === slot).length;
        const revived = f.events.filter((e) => e.t === 'revive' && e.side === side && e.slot === slot).length;
        assert.equal(m.dead, died > revived);
      }
    }
    assert.equal(final.deaths.attacker, f.result.deaths.attacker);
    assert.equal(final.deaths.defender, f.result.deaths.defender);
  });

  test('a Phoenix that revived once is alive in the summary until it dies again', () => {
    const f = fight([card('Phoenix')], [vanilla('Weakling', 300, 100000)], { seed: 2, maxRounds: 3 });
    const revives = f.events.filter((e) => e.t === 'revive').length;
    const deaths = f.events.filter((e) => e.t === 'death' && e.side === 'attacker').length;
    assert.equal(revives, 1);
    const final = finalState(f.events);
    assert.equal(final.attacker.cards[0].dead, deaths > revives);
    assert.equal(final.attacker.cards[0].hp, f.events.filter((e) => ['damage', 'heal', 'revive'].includes(e.t) && e.side === 'attacker' && e.slot === 0).pop().hp);
  });

  test('maxHp buffs raise the model and permanent attack buffs stick', () => {
    const f = fight([card('Arch Angel'), card('War Tattooist'), card('Pikeman')], [wall(), wall(), wall()], { seed: 3, maxRounds: 2 });
    const final = finalState(f.events);
    const start = f.events[0].attacker.cards;
    // Arch Angel: +200 max hp to each neighbour (400 split)
    assert.equal(final.attacker.cards[1].maxHp, start[1].maxHp + 200);
    // War Tattooist: +500 attack per round to the card on its right, cumulative over 2 rounds
    assert.equal(final.attacker.cards[2].attack, start[2].attack + 1000);
    assert.equal(final.attacker.cards[0].dead, false);
  });

  test('reduceEvent folds step by step to the same result as finalState', () => {
    const f = richFight();
    const model = initialModel(f.events);
    for (const step of fromEvents(f.events)) for (const ev of step.events) reduceEvent(model, ev);
    assert.deepEqual(model, finalState(f.events));
  });
});

describe('battle-player sprites and sounds', () => {
  test('sprite URLs point at the original client assets and additive sprites are listed', async () => {
    const { spriteUrl } = await import('../src/ui/dom.js');
    const { ADDITIVE_SPRITES, isAdditive } = await import('../src/ui/battle/assets.js');
    assert.equal(spriteUrl('beam'), '/assets/orig/ui/beam.png');
    assert.ok(ADDITIVE_SPRITES.includes('white_glow') && ADDITIVE_SPRITES.includes('stun_effect08'));
    assert.ok(!ADDITIVE_SPRITES.includes('beam') && !ADDITIVE_SPRITES.includes('attack_explosion'));
    assert.ok(isAdditive('white_glow') && !isAdditive('beam'));
  });

  test('attack sounds follow the tribe (orc blood, elf arcane, dwarf stronghit, neutral sword/fire)', async () => {
    const { tribeSounds, TRIBE_SOUNDS, SOUNDS } = await import('../src/ui/battle/assets.js');
    assert.ok(tribeSounds('orc').windup.every((s) => s.startsWith('anim_attack_attacker_blood_')));
    assert.ok(tribeSounds('elf').windup.every((s) => s.startsWith('anim_attack_attacker_arcane_')));
    assert.deepEqual(tribeSounds('dwarf').windup, ['anim_attack_attacker_stronghit_01']);
    assert.ok(tribeSounds('neutral').windup.every((s) => s.startsWith('anim_attack_attacker_sword_')));
    assert.ok(tribeSounds('neutral').missile.every((s) => s.startsWith('anim_attack_missile_fire_')));
    assert.equal(tribeSounds('dragon'), TRIBE_SOUNDS.neutral, 'unknown tribes sound neutral');
    assert.equal(tribeSounds(undefined), TRIBE_SOUNDS.neutral);
    // the fixed names the task mandates
    assert.deepEqual(SOUNDS.playerHit, ['anim_attack_target_hpbar_01', 'anim_attack_target_hpbar_02', 'anim_attack_target_hpbar_03']);
    assert.deepEqual(SOUNDS.heal, ['fight_card_heal_1', 'fight_card_heal_2', 'fight_card_heal_3']);
    assert.deepEqual(SOUNDS.death, ['fight_card_death_1', 'fight_card_death_2', 'fight_card_death_5']);
    assert.deepEqual(SOUNDS.reflect, ['fight_shot_reflect1', 'fight_shot_reflect2', 'fight_shot_reflect3']);
    for (const [key, name] of [['invulnerable', 'fight_invulnerability'], ['revive', 'fight_resurrect'], ['raiseAttack', 'fight_raiseattack'], ['curse', 'fight_curse'], ['nextRound', 'fight_nextround'], ['victory', 'fight_victory_msx'], ['defeat', 'fight_defeat_msx'], ['bonus', 'fight_bonus']]) {
      assert.deepEqual(SOUNDS[key], [name]);
    }
  });

  test('the variant picker is seeded: same seed, same sequence; every variant comes up', async () => {
    const { createPicker } = await import('../src/ui/battle/assets.js');
    const list = ['a_01', 'a_02', 'a_03'];
    const a = createPicker(7);
    const b = createPicker(7);
    const seqA = Array.from({ length: 12 }, () => a(list));
    const seqB = Array.from({ length: 12 }, () => b(list));
    assert.deepEqual(seqA, seqB);
    assert.ok(seqA.every((s) => list.includes(s)));
    assert.equal(new Set(seqA).size, 3, 'all three variants are used over 12 picks');
    const c = createPicker(8);
    assert.notDeepEqual(Array.from({ length: 12 }, () => c(list)), seqA, 'another seed gives another sequence');
    assert.equal(a([]), null);
    assert.equal(a(null), null);
    assert.equal(createPicker(undefined)(['only']), 'only');
  });

  test('the model carries each card\'s tribe from the battleStart snapshot (for tribe-based sounds)', () => {
    const { events } = fight([vanilla('Grunt', 250, 500, ['direct'], 'orc'), card('Argonaut')], [vanilla('Slayer', 900, 400, ['direct'], 'elf')], { seed: 7, maxRounds: 1 });
    const model = initialModel(events);
    assert.equal(model.attacker.cards[0].tribe, 'orc');
    assert.equal(model.defender.cards[0].tribe, 'elf');
    assert.equal(model.attacker.cards[2], null);
    const bare = initialModel([{ t: 'battleStart', attacker: { player: {}, cards: [{ cardId: 'x', hp: 1, maxHp: 1, attack: 1 }] }, defender: { player: {}, cards: [] } }]);
    assert.equal(bare.attacker.cards[0].tribe, 'neutral');
  });
});

describe('battle model: per-round attack boosts and overkill', () => {
  const start = {
    t: 'battleStart',
    attacker: { player: { name: 'A', hp: 1000, maxHp: 1000 }, cards: [{ cardId: 'x', name: 'X', hp: 300, maxHp: 300, attack: 500 }, null, null, null, null] },
    defender: { player: { name: 'D', hp: 1000, maxHp: 1000 }, cards: [null, null, null, null, null] },
  };
  test('a per-round attack boost shows on the card for that round and drops back at the next round', () => {
    const m = initialModel([start]);
    reduceEvent(m, { t: 'roundStart', round: 1 });
    reduceEvent(m, { t: 'buff', side: 'attacker', slot: 0, stat: 'attack', delta: 200, permanent: false });
    assert.equal(m.attacker.cards[0].attack, 700);
    reduceEvent(m, { t: 'roundStart', round: 2 });
    assert.equal(m.attacker.cards[0].attack, 500);
    reduceEvent(m, { t: 'buff', side: 'attacker', slot: 0, stat: 'attack', delta: 100, permanent: true });
    reduceEvent(m, { t: 'roundStart', round: 3 });
    assert.equal(m.attacker.cards[0].attack, 600, 'permanent boosts stay');
  });
  test('card HP may go below zero (overkill), as in the original', () => {
    const m = initialModel([start]);
    reduceEvent(m, { t: 'damage', side: 'attacker', slot: 0, amount: 450, hp: -150, cause: 'attack' });
    assert.equal(m.attacker.cards[0].hp, -150);
  });
});
