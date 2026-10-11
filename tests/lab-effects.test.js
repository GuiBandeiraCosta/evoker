'use strict';
/**
 * The Card Lab's pure part (src/ui/screens/lab-model.js): the auto scenario, the fight runner and the effect
 * showcase - every effect type in data/abilities.json has an entry whose card, rows and seed really show it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { realDeps, db, ROOT } from './fixtures/real.js';
import { fillerCards, autoScenario, runLabFight, SHOWCASE, showcaseScenario, effectFires, requiredTribe } from '../src/ui/screens/lab-model.js';
import { hasAbility, abilityForStage } from '../src/core/abilities.js';
import { capFor } from '../src/core/stats.js';
import { join } from 'node:path';

const deps = realDeps();
const abilities = JSON.parse(readFileSync(join(ROOT, 'data', 'abilities.json'), 'utf8'));
const typesInUse = new Set();
for (const c of db.all()) {
  const a = abilities[c.id];
  if (!a) continue;
  for (const b of a.buffs || (a.byStage || []).flatMap((s) => (s && s.buffs) || [])) if (b && b.type !== 'attack') typesInUse.add(b.type);
}

describe('card lab: fillers and the auto scenario', () => {
  test('fillers have no ability: the weak one hits softly, the strong one hard, the ally lasts', () => {
    const f = fillerCards(db);
    for (const d of [f.weak, f.strong, f.ally]) assert.ok(![0, 4].some((s) => hasAbility(d.ability, s)), `${d.id} has no ability`);
    assert.ok(f.weak.base.attack <= f.strong.base.attack);
    assert.ok(f.ally.base.hp >= f.weak.base.hp);
    assert.equal(fillerCards(db, 'orc').ally.tribe, 'orc');
  });

  test('the tested card sits in the middle with two allies of the required tribe', () => {
    const s = autoScenario(db, 'bone-oracle', 0, 1, false);
    assert.equal(s.own[2].cardId, 'bone-oracle');
    assert.equal(requiredTribe(db.get('bone-oracle').ability, 0), 'orc');
    for (const i of [0, 1, 3, 4]) assert.equal(db.get(s.own[i].cardId).tribe, 'orc', `ally ${i} is an orc`);
    assert.equal(s.opp.filter(Boolean).length, 5);
  });

  test('every card fights without error at base and ++++ against weak and strong opponents', () => {
    let fights = 0;
    for (const d of db.all()) {
      if (d.trainer) continue;
      for (const stage of [0, 4]) for (const strong of [false, true]) {
        const s = autoScenario(db, d.id, stage, capFor(d, stage), strong);
        const r = runLabFight(deps, { own: s.own, opp: s.opp, hp: 10000, seed: 7 });
        assert.ok(r.battle.events.some((e) => e.t === 'battleEnd'), `${d.id} ${stage} ${strong}`);
        fights += 1;
      }
    }
    assert.ok(fights >= 760, `${fights} fights`);
  });
});

describe('card lab: effect showcase', () => {
  test('one entry per effect type in use, no duplicates, cards that really carry the type', () => {
    const types = SHOWCASE.map((e) => e.type);
    assert.deepEqual(new Set(types), typesInUse, 'showcase types = types used by data/abilities.json');
    assert.equal(new Set(types).size, types.length, 'no duplicate types');
    for (const e of SHOWCASE) {
      const d = db.get(e.cardId);
      assert.ok(d, `${e.type}: card ${e.cardId} exists`);
      const buffs = (abilityForStage(d.ability, e.stage) || {}).buffs || [];
      assert.ok(buffs.some((b) => b.type === e.type), `${e.type}: ${e.cardId} at stage ${e.stage} has that effect`);
      assert.ok(e.label && e.what && e.look, `${e.type} is described`);
    }
  });

  test('each showcase fight shows its effect with the given seed, early', () => {
    for (const e of SHOWCASE) {
      const rows = showcaseScenario(db, e);
      assert.equal(rows.own[2].cardId, e.cardId, `${e.type}: the card is in the middle`);
      const r = runLabFight(deps, { own: rows.own, opp: rows.opp, hp: 10000, seed: e.seed });
      const round = effectFires(r.battle.events, e.type);
      assert.ok(round != null, `${e.type} (${e.cardId}) never fires with seed ${e.seed}`);
      assert.ok(round <= 2, `${e.type} fires in round ${round}, should be early`);
      assert.ok(r.summary.rounds <= 6, `${e.type}: ${r.summary.rounds} rounds, should be a short fight`);
    }
  });

  test('the heal boost showcase really boosts: the Alchemists heal more with the Djinn than without', () => {
    const e = SHOWCASE.find((x) => x.type === 'heal_boost_percent');
    const rows = showcaseScenario(db, e);
    const withDjinn = runLabFight(deps, { own: rows.own, opp: rows.opp, hp: 10000, seed: e.seed });
    const { ally } = fillerCards(db);
    const without = { own: rows.own.map((s, i) => (i === 2 ? { cardId: ally.id, stage: 4, level: capFor(ally, 4) } : s)), opp: rows.opp };
    const plain = runLabFight(deps, { ...without, hp: 10000, seed: e.seed });
    const firstHeal = (r) => r.battle.events.find((x) => x.t === 'heal' && x.side === 'attacker');
    assert.ok(firstHeal(withDjinn) && firstHeal(plain), 'both fights heal');
    assert.ok(firstHeal(withDjinn).amount > firstHeal(plain).amount, `${firstHeal(withDjinn).amount} > ${firstHeal(plain).amount}`);
  });
});
