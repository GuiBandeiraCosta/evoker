import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCardsDbFromFile } from '../src/core/cards-db.js';
import {
  statAt, attackAt, hpAt, abilityAt, statsAt, capFor, cardXpToNext, playerXpToNext,
  sellValue, fusionCost, sacrificeXp, enhancePrice, evolveQuality,
} from '../src/core/stats.js';
import { playerFightXp, cardFightXp } from '../src/game/player.js';
import { trainingCost } from '../src/game/training.js';
import { RARITIES, RARITY_ORDER, MAX_PLAYER_LEVEL, TRAINER_XP } from '../src/core/constants.js';

const db = await loadCardsDbFromFile();
const STATS = ['attack', 'hp', 'ability'];

/** Minimal synthetic card for formula tests without wiki checkpoints. */
function fixture(overrides = {}) {
  return {
    id: 'fixture', name: 'Fixture', rarity: 'uncommon', tribe: 'elf', mana: 8, dirs: ['direct'],
    base: { attack: 300, hp: 500, ability: 200 },
    caps: RARITIES.uncommon.caps.slice(),
    growth: { attack: [null, null, null, null, null], hp: [null, null, null, null, null], ability: [null, null, null, null, null] },
    ...overrides,
  };
}

describe('wiki checkpoints', () => {
  test('Dwarf King attack: 3849 at stage 4 level 54 and 1046 at stage 0 level 14', () => {
    const king = db.get('dwarf-king');
    assert.equal(attackAt(king, 0, 1), 800);
    assert.ok(Math.abs(attackAt(king, 0, 14) - 1046) <= 1);
    assert.ok(Math.abs(attackAt(king, 4, 54) - 3849) <= 1);
    assert.ok(Math.abs(hpAt(king, 2, 34) - 6188) <= 1);
    assert.ok(Math.abs(abilityAt(king, 3, 44) - 5674) <= 1);
    assert.equal(abilityAt(king, 0, 1), 1600);
  });

  test('Werewolf Dwarf stage-1 level-1 attack is base × 1.15 ≈ 1840', () => {
    const ww = db.get('werewolf-dwarf');
    assert.ok(Math.abs(attackAt(ww, 1, 1) - 1840) <= 1);
    assert.ok(Math.abs(attackAt(ww, 4, 54) - 7451) <= 1);
    assert.ok(Math.abs(hpAt(ww, 1, 24) - 3727) <= 1);
  });

  test('every known wiki cap value is reproduced within ±1', () => {
    let checked = 0;
    const misses = [];
    for (const card of db.all()) {
      for (const stat of STATS) {
        card.growth[stat].forEach((wiki, stage) => {
          if (typeof wiki !== 'number') return;
          const got = statAt(card, stat, stage, capFor(card, stage));
          checked += 1;
          if (Math.abs(got - wiki) > 1) misses.push(`${card.id} ${stat} stage ${stage}: ${got} vs ${wiki}`);
        });
      }
    }
    assert.ok(checked > 1400, `only ${checked} checkpoints`);
    assert.deepEqual(misses, []);
  });

  test('percent abilities interpolate on the percentage with 1 decimal', () => {
    const djinn = db.get('djinn');
    assert.equal(djinn.abilityIsPercent, true);
    assert.equal(abilityAt(djinn, 0, 1), 6);
    assert.ok(Math.abs(abilityAt(djinn, 0, 13) - 18) <= 0.1);
    const mid = abilityAt(djinn, 0, 7);
    assert.equal(mid, Math.round(mid * 10) / 10);
    assert.ok(mid > 6 && mid < 18);
    const darkMage = db.get('dark-mage');
    assert.equal(abilityAt(darkMage, 1, 1), 15);
    assert.ok(Math.abs(abilityAt(darkMage, 4, 63) - 20) <= 0.1);
  });

  test('flat abilities never grow (Blood Spitter)', () => {
    const bs = db.get('blood-spitter');
    assert.equal(abilityAt(bs, 0, 1), 100);
    assert.equal(abilityAt(bs, 4, 27), 100);
    assert.equal(abilityAt(bs, 2, 10, 0.8), 100);
  });

  test('0-attack bases grow linearly from 0 (Cursed Stag, Bouncer)', () => {
    const stag = db.get('cursed-stag');
    assert.equal(attackAt(stag, 0, 1), 0);
    assert.equal(attackAt(stag, 0, 14), 0);
    assert.equal(attackAt(stag, 1, 1), 0);
    assert.equal(attackAt(stag, 1, 24), 200);
  });
});

describe('statAt formula', () => {
  test('unknown caps derive from the rarity multiplier table', () => {
    const card = fixture();
    for (let stage = 0; stage <= 4; stage += 1) {
      const expected = Math.round(300 * RARITIES.uncommon.growth[stage]);
      assert.ok(Math.abs(attackAt(card, stage, capFor(card, stage)) - expected) <= 1, `stage ${stage}`);
      assert.equal(attackAt(card, stage, 1), Math.round(300 * 1.15 ** stage));
    }
  });

  test('bad wiki caps below the stage start are replaced by start × 1.3', () => {
    const card = fixture({ growth: { attack: [null, 100, null, null, null], hp: [null, null, null, null, null], ability: [null, null, null, null, null] } });
    const start = Math.round(300 * 1.15);
    assert.equal(attackAt(card, 1, 1), start);
    assert.equal(attackAt(card, 1, 15), Math.round(start * 1.3));
    // the bad cap is not a representative checkpoint: the other stages stay on the plain rarity table
    assert.ok(Math.abs(attackAt(card, 2, capFor(card, 2)) - Math.round(300 * RARITIES.uncommon.growth[2])) <= 1);
  });

  test('unknown caps of a partly known card follow its own curve: rarity table × median ratio of its known caps', () => {
    const g = RARITIES.uncommon.growth;
    const card = fixture({ growth: {
      attack: [Math.round(300 * g[0] * 1.2), Math.round(300 * g[1] * 1.2), null, null, null],
      hp: [null, null, null, null, null], ability: [null, null, null, null, null],
    } });
    for (const stage of [2, 3, 4]) {
      assert.ok(Math.abs(attackAt(card, stage, capFor(card, stage)) - Math.round(300 * g[stage] * 1.2)) <= 1, `attack stage ${stage}`);
      // hp and ability have no checkpoints of their own: they borrow the card's attack ratio
      assert.ok(Math.abs(hpAt(card, stage, capFor(card, stage)) - Math.round(500 * g[stage] * 1.2)) <= 1, `hp stage ${stage}`);
      assert.ok(Math.abs(abilityAt(card, stage, capFor(card, stage)) - Math.round(200 * g[stage] * 1.2)) <= 1, `ability stage ${stage}`);
    }
    assert.equal(attackAt(card, 0, 1), 300, 'level-1 values are untouched');
  });

  test('a stat with checkpoints of its own uses its own ratio, not the card-wide one', () => {
    const g = RARITIES.uncommon.growth;
    const card = fixture({ growth: {
      attack: [Math.round(300 * g[0] * 1.2), null, null, null, null],
      hp: [Math.round(500 * g[0] * 0.9), null, null, null, null],
      ability: [null, null, null, null, null],
    } });
    assert.ok(Math.abs(hpAt(card, 4, capFor(card, 4)) - Math.round(500 * g[4] * 0.9)) <= 1);
    assert.ok(Math.abs(attackAt(card, 4, capFor(card, 4)) - Math.round(300 * g[4] * 1.2)) <= 1);
    // ability borrows the median of the card's other stats (1.2 and 0.9 → 1.05)
    assert.ok(Math.abs(abilityAt(card, 4, capFor(card, 4)) - Math.round(200 * g[4] * 1.05)) <= 1);
  });

  test('percent abilities never take a point-stat scale', () => {
    const g = RARITIES.uncommon.growth;
    const card = fixture({ abilityIsPercent: true, base: { attack: 300, hp: 500, ability: 6 }, growth: {
      attack: [Math.round(300 * g[0] * 1.5), null, null, null, null],
      hp: [null, null, null, null, null], ability: [null, null, null, null, null],
    } });
    assert.ok(Math.abs(abilityAt(card, 4, capFor(card, 4)) - Math.round(6 * g[4] * 10) / 10) <= 0.1);
  });

  test('values are monotonic within every stage and level is clamped to [1, cap]', () => {
    for (const card of db.all()) {
      for (const stat of STATS) {
        if (card.base[stat] == null) continue;
        for (let stage = 0; stage <= 4; stage += 1) {
          let prev = -Infinity;
          for (let level = 1; level <= capFor(card, stage); level += 1) {
            const v = statAt(card, stat, stage, level);
            assert.ok(v >= prev, `${card.id} ${stat} s${stage} L${level}: ${v} < ${prev}`);
            prev = v;
          }
        }
      }
    }
    const king = db.get('dwarf-king');
    assert.equal(attackAt(king, 0, 0), attackAt(king, 0, 1));
    assert.equal(attackAt(king, 0, 99), attackAt(king, 0, 14));
  });

  test('null stats stay null; wrappers default to 0', () => {
    const gremlin = db.get('gremlin');
    assert.equal(statAt(gremlin, 'ability', 0, 1), null);
    assert.equal(abilityAt(gremlin, 0, 1), null);
    assert.equal(attackAt(gremlin, 0, 5), 0);
    assert.deepEqual(statsAt(gremlin, 0, 1), { attack: 0, hp: 400, ability: null });
  });

  test('evolveQuality scales attack, hp and ability', () => {
    const king = db.get('dwarf-king');
    assert.equal(attackAt(king, 1, 1, 0.9), Math.round(attackAt(king, 1, 1) * 0.9));
    assert.equal(hpAt(king, 1, 24, 0.75), Math.round(hpAt(king, 1, 24) * 0.75));
    const djinn = db.get('djinn');
    assert.equal(abilityAt(djinn, 1, 1, 0.8), Math.round(6 * 0.8 * 10) / 10);
  });

  test('capFor uses the card caps, falls back to the rarity and rejects bad stages', () => {
    assert.equal(capFor(db.get('dwarf-king'), 4), 54);
    assert.equal(capFor(db.get('siren'), 4), 27);
    assert.equal(capFor({ rarity: 'rare', base: {} }, 2), 24);
    assert.throws(() => capFor(db.get('dwarf-king'), 5), RangeError);
    assert.throws(() => capFor(db.get('dwarf-king'), -1), RangeError);
    assert.throws(() => statAt(db.get('dwarf-king'), 'attack', 7, 1), RangeError);
  });
});

describe('xp curves', () => {
  test('cardXpToNext = max(20, round(40 × mana × l^1.5 / 10))', () => {
    assert.equal(cardXpToNext({ mana: 3 }, 1), 20);
    assert.equal(cardXpToNext({ mana: 24 }, 4), 768);
    assert.equal(cardXpToNext(db.get('dwarf-king'), 1), 96);
    assert.ok(cardXpToNext({ mana: 10 }, 10) > cardXpToNext({ mana: 10 }, 9));
  });

  // Round 3: XP comes 1 per stamina from minion taps; level 2 after ~50 stamina (tutorial.md §1.6), level 6 ≈ 240
  // and level 7 ≈ 1.15× level 6 measured on the XP bar (playthroughs-2.md §1.3).
  test('playerXpToNext = round(50 × L^0.875) (levels 1-4: 47, 47, 92, 94), Infinity at the cap', () => {
    assert.equal(playerXpToNext(1), 47);
    assert.equal(playerXpToNext(4), 94);
    assert.equal(playerXpToNext(5), 204);
    assert.equal(playerXpToNext(6), 240);
    assert.equal(playerXpToNext(7), 274);
    assert.equal(playerXpToNext(10), Math.round(50 * 10 ** 0.875));
    assert.equal(playerXpToNext(MAX_PLAYER_LEVEL), Infinity);
  });

  test('battle xp (PvP: a level-8 rival ~21 on a win, ~5 on a loss, playthroughs-2.md §1.3)', () => {
    assert.equal(playerFightXp(8, true), 22);
    assert.equal(playerFightXp(8, false), 6);
    assert.equal(playerFightXp(5, true), 16);
    assert.equal(cardFightXp(40, false), 30);
    assert.equal(cardFightXp(40, true), 45);
    assert.equal(cardFightXp(40, true, true), 90);
  });

  test('card fight xp from BATTLE_XP.card equals the former hard-coded 10 + mana / 2, ×1.5, ×2 bit for bit', () => {
    const old = (mana, won, wisdom) => {
      let xp = 10 + (Number(mana) || 0) / 2;
      if (won) xp *= 1.5;
      if (wisdom) xp *= 2;
      return Math.round(xp);
    };
    for (let mana = 0; mana <= 60; mana++) {
      for (const won of [false, true]) for (const wisdom of [false, true]) assert.equal(cardFightXp(mana, won, wisdom), old(mana, won, wisdom), `${mana} ${won} ${wisdom}`);
    }
    assert.equal(cardFightXp(undefined, false), old(undefined, false));
  });
});

describe('economy formulas', () => {
  test('sellValue follows the per-rarity coefficients', () => {
    assert.equal(sellValue({ rarity: 'common', mana: 1 }, 0, 1), 50);
    assert.equal(sellValue({ rarity: 'standard', mana: 4 }, 1, 3), Math.round(6.5 * 4 * (10 + 3 + 2)));
    assert.equal(sellValue({ rarity: 'uncommon', mana: 6 }, 0, 11), Math.round(8.5 * 6 * 22));
    assert.equal(sellValue({ rarity: 'rare', mana: 12 }, 2, 5), 6960);
    assert.equal(sellValue({ rarity: 'heroic', mana: 20 }, 4, 45), 30 * 20 * (13 + 45 + 32));
    assert.equal(sellValue({ rarity: 'legendary', mana: 24 }, 0, 1), 50 * 24 * 15);
    assert.equal(sellValue({ rarity: 'ultimate', mana: 30 }, 1, 1), 55 * 30 * (15 + 1 + 12));
    assert.throws(() => sellValue({ rarity: 'rare', mana: 12 }, 5, 1), RangeError);
  });

  test('fusionCost per rarity and stage', () => {
    assert.equal(fusionCost('common', 0), 200);
    assert.equal(fusionCost('common', 3), 3200);
    assert.equal(fusionCost('standard', 0), 400);
    assert.equal(fusionCost('uncommon', 1), 3600);
    assert.equal(fusionCost('rare', 2), 17280);
    assert.equal(fusionCost('heroic', 3), 60000);
    assert.equal(fusionCost('legendary', 0), 7200);
    assert.equal(fusionCost('ultimate', 3), 172480);
    assert.equal(fusionCost(db.get('dwarf-king'), 1), 28800);
    assert.throws(() => fusionCost('rare', 4), RangeError);
    assert.throws(() => fusionCost('mythic', 0), RangeError);
    for (const r of RARITY_ORDER) {
      const costs = RARITIES[r].fusionCosts;
      assert.ok(costs[0] < costs[1] && costs[1] < costs[2] && costs[2] < costs[3], r);
    }
  });

  test('sacrificeXp = 25 × mana × (level + 2) × rarity factor; trainers fixed', () => {
    assert.equal(sacrificeXp({ rarity: 'uncommon', mana: 6 }, 0, 1), 450);
    assert.equal(sacrificeXp({ rarity: 'common', mana: 1 }, 0, 1), Math.round(25 * 1 * 3 * 0.6));
    assert.equal(sacrificeXp({ rarity: 'legendary', mana: 24 }, 2, 10), Math.round(25 * 24 * 12 * 3.5));
    assert.equal(sacrificeXp(db.get('lich-king'), 0, 1), TRAINER_XP['lich-king']);
    assert.equal(sacrificeXp(db.get('crystal-ghost'), 0, 1), 9000);
    assert.equal(sacrificeXp(db.get('blood-dragon'), 0, 5), 20000);
  });

  // Every training price seen in the 1.7.0 videos (playthroughs-2.md §1.7, playthroughs.md §2 Training UI):
  // the client's getEnhancePrice with costManaFactor 25, costLevelFactor 50, sell factor / 10, enhance factor 2.
  test('enhancePrice reproduces the 8 observed training prices exactly', () => {
    const seen = [
      ['standard', 4, 1, 240], ['standard', 3, 4, 540], ['common', 2, 4, 441], ['standard', 3, 5, 660],
      ['standard', 3, 1, 180], ['common', 2, 1, 111], ['uncommon', 8, 1, 520], ['standard', 4, 1, 240],
    ];
    for (const [rarity, mana, level, gold] of seen) assert.equal(enhancePrice({ rarity, mana }, level), gold, `${rarity} ${mana} mana L${level}`);
    const deps = { db: { get: (id) => ({ brewer: { rarity: 'common', mana: 2 }, envoy: { rarity: 'standard', mana: 3 } })[id] }, stats: { enhancePrice } };
    assert.equal(trainingCost(deps, [{ cardId: 'brewer', level: 1 }, { cardId: 'envoy', level: 1 }]), 291);
    assert.equal(trainingCost(deps, []), 0);
    assert.ok(enhancePrice({ rarity: 'legendary', mana: 24 }, 1) > enhancePrice({ rarity: 'rare', mana: 24 }, 1));
    assert.throws(() => enhancePrice({ rarity: 'mythic', mana: 2 }, 1), RangeError);
  });

  test('evolveQuality is 1 whatever the input levels (round 5, the tutorial video level-1 fusion)', () => {
    assert.equal(evolveQuality(11, 11, 11, 11), 1);
    assert.equal(evolveQuality(1, 11, 1, 11), 1);
    assert.equal(evolveQuality(11, 11, 0, 11), 1);
    assert.ok(evolveQuality(99, 11, 99, 11) <= 1);
  });

  test('a fused level-1 Throat-Cutter shows 230 / 115 like the video (base × 1.15)', () => {
    const tc = { rarity: 'standard', mana: 3, base: { attack: 200, hp: 100, ability: null }, caps: [10, 12, 14, 16, 18],
      growth: { attack: [null, 678, null, null, null], hp: [null, 340, null, null, null], ability: [null, null, null, null, null] } };
    const q = evolveQuality(1, 10, 3, 10);
    assert.deepEqual([statAt(tc, 'attack', 1, 1, q), statAt(tc, 'hp', 1, 1, q)], [230, 115]);
  });
});
