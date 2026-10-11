'use strict';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  BUFF_TYPES, DIRECTIONS, EVENTS, DIR_MAP, DIR_MAP_BACK, SCOPES, PICKS, EXT_FIELDS,
  validateAbility, renderAbilityText, hasAbility, abilityForStage, effectTypesOf, formatValue, effectDirs, buffsForStage,
  toOriginalDirs, toCatalogDirs, isExtensionBuff,
} from '../src/core/abilities.js';
import { DIRECTIONS as CATALOG_DIRECTIONS } from '../src/core/constants.js';
import { slugify } from '../src/core/cards-db.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const abilities = JSON.parse(readFileSync(join(ROOT, 'data/abilities.json'), 'utf8'));
const catalog = JSON.parse(readFileSync(join(ROOT, 'exploration/research/wiki-card-catalog.json'), 'utf8'));
const cardsJson = JSON.parse(readFileSync(join(ROOT, 'data/cards.json'), 'utf8'));
const cardById = new Map(cardsJson.cards.map((c) => [c.id, c]));
const TRAINERS = ['lich-king', 'crystal-ghost', 'blood-dragon'];
/** Cards removed from the game (card-overrides.json $removed): still in the wiki catalog, no longer in the data. */
const REMOVED = new Set(((JSON.parse(readFileSync(join(ROOT, 'data/card-overrides.json'), 'utf8')).$removed || {}).ids) || []);
const CATALOG_COUNT = 200 - REMOVED.size;
/** Effect types the engine keeps although their only cards were removed with the Dungeon Casino. */
const UNUSED_TYPES = ['swap_stats_random', 'wheel', 'gamble'];

const b = (type, directions, event, extra = {}) => ({ type, directions, event, ...extra });

test('abilities.json has exactly the catalog slugs minus the removed cards', () => {
  const ids = Object.keys(abilities);
  assert.equal(ids.length, CATALOG_COUNT);
  const expected = new Set(catalog.map((c) => slugify(c.name)).filter((id) => !REMOVED.has(id)));
  assert.equal(expected.size, CATALOG_COUNT);
  for (const id of ids) assert.ok(expected.has(id), `unexpected id ${id}`);
  for (const id of expected) assert.ok(id in abilities, `missing id ${id}`);
  assert.ok('will-o-the-wisp' in abilities);
  assert.ok('guruk-the-destroyer' in abilities);
  assert.ok('bone-dragon' in abilities);
});

test('every entry validates with zero errors', () => {
  const all = [];
  for (const [id, a] of Object.entries(abilities)) for (const e of validateAbility(a)) all.push(`${id}: ${e}`);
  assert.deepEqual(all, []);
});

test('every card with ability text or ability categories in the catalog has buffs (trainers: text only)', () => {
  for (const c of catalog) {
    const id = slugify(c.name);
    if (REMOVED.has(id)) continue;
    const text = (c.ability_text || '').replace(/"/g, '').trim();
    const hasText = text && text !== 'null';
    const hasCat = (c.categories || []).some((k) => !['Legendary', 'Ultimate', 'Own Attacker', 'Trainer'].includes(k));
    if (TRAINERS.includes(id)) {
      assert.deepEqual(abilities[id].buffs, [], id);
      assert.ok(abilities[id].text.length > 10, id);
      assert.equal(hasAbility(abilities[id]), false, id);
    } else if (hasText || hasCat) {
      const a = abilities[id];
      assert.notEqual(a, null, `${id} should have an ability`);
      const stages = a.byStage ? a.byStage : [a];
      assert.ok(stages.some((s) => s && s.buffs.length > 0), `${id} has no buffs`);
    } else {
      assert.equal(abilities[id], null, `${id} should be null`);
    }
  }
});

test('declared types, directions, events and maps are consistent with the original engine', () => {
  for (const [t, meta] of Object.entries(BUFF_TYPES)) {
    assert.equal(typeof meta.phase, 'string', t);
    assert.ok(meta.description.length > 10, t);
  }
  assert.deepEqual([...DIRECTIONS], ['front', 'frontLeft', 'frontRight', 'left', 'right', 'self']);
  assert.deepEqual(Object.keys(EVENTS), ['always', 'round_eq', 'round_ge', 'round_le', 'round_odd', 'round_even', 'onDamage', 'onDeath', 'onHeal']);
  assert.deepEqual(DIR_MAP, { direct: 'front', left: 'frontLeft', right: 'frontRight', ownLeft: 'left', ownRight: 'right' });
  for (const [k, v] of Object.entries(DIR_MAP)) assert.equal(DIR_MAP_BACK[v], k);
  assert.deepEqual(Object.keys(DIR_MAP).sort(), [...CATALOG_DIRECTIONS].sort());
  assert.ok(Object.keys(SCOPES).includes('own_cards') && PICKS.includes('random') && EXT_FIELDS.includes('nextRound'));
  // Every declared type is used by at least one card (die is implicit).
  const used = new Set();
  for (const a of Object.values(abilities)) for (const t of effectTypesOf(a)) used.add(t);
  for (const t of used) assert.ok(BUFF_TYPES[t], `undeclared type ${t}`);
  for (const t of Object.keys(BUFF_TYPES)) if (t !== 'die' && !UNUSED_TYPES.includes(t)) assert.ok(used.has(t), `declared type ${t} is not used by any card`);
  assert.ok(!used.has('die'));
});

test('ext flag: exactly the buffs that use an extension type, event or field', () => {
  let ext = 0; let total = 0;
  for (const [id, a] of Object.entries(abilities)) {
    if (!a) continue;
    for (const st of a.byStage ? a.byStage : [a]) {
      if (!st) continue;
      for (const buff of st.buffs) {
        total += 1;
        assert.equal(buff.ext === true, isExtensionBuff(buff), `${id}: ${JSON.stringify(buff)}`);
        if (buff.ext) ext += 1;
      }
    }
  }
  assert.ok(total > 150 && ext > 30 && ext < total, `${ext}/${total}`);
});

test('validateAbility rejects bad shapes', () => {
  const ok = { text: 'Heals {v}.', buffs: [b('heal', ['self'], 'always', { strength: 'value' })] };
  assert.deepEqual(validateAbility(ok), []);
  assert.deepEqual(validateAbility(null), []);
  assert.ok(validateAbility({ text: 'x', buffs: [b('explode', ['self'], 'always')] }).some((e) => /unknown buff type/.test(e)));
  assert.ok(validateAbility({ text: 'x', buffs: [b('heal', ['moon'], 'always', { strength: 1 })] }).some((e) => /unknown direction/.test(e)));
  assert.ok(validateAbility({ text: 'x', buffs: [b('heal', ['self'], 'sometimes', { strength: 1 })] }).some((e) => /unknown event/.test(e)));
  assert.ok(validateAbility({ text: 'x', buffs: [b('no_damage', ['front'], 'round_eq')] }).some((e) => /eventData/.test(e)));
  assert.ok(validateAbility({ text: 'x', buffs: [b('no_damage', ['front'], 'always', { eventData: 1 })] }).some((e) => /no eventData/.test(e)));
  assert.ok(validateAbility({ text: 'x', buffs: [b('heal', ['self'], 'always')] }).some((e) => /needs a strength/.test(e)));
  assert.ok(validateAbility({ text: 'x', buffs: [b('heal', ['self'], 'always', { strength: 'banana' })] }).some((e) => /strength must be/.test(e)));
  assert.ok(validateAbility({ text: 'x', buffs: [b('invulnerable', ['self'], 'round_even')] }).some((e) => /ext: true/.test(e)));
  assert.ok(validateAbility({ text: 'x', buffs: [b('invulnerable', ['self'], 'always', { ext: true })] }).some((e) => /ext is only allowed/.test(e)));
  assert.ok(validateAbility({ text: 'x', buffs: [b('raise_attack', ['self'], 'always', { strengthPercent: 75 })] }).some((e) => /ext: true/.test(e)));
  assert.ok(validateAbility({ text: 'Heals {v}.', buffs: [b('heal', ['self'], 'always', { strength: 5 })] }).some((e) => /\{v\}/.test(e)));
  assert.ok(validateAbility({ text: 'Heals {pct}.', buffs: [b('heal', ['self'], 'always', { strength: 'value' })] }).some((e) => /\{pct\}/.test(e)));
  assert.ok(validateAbility({ text: 'Heals {x}.', buffs: [b('heal', ['self'], 'always', { strength: 'value' })] }).some((e) => /unknown placeholder/.test(e)));
  assert.ok(validateAbility({ text: 'Heals ____.', buffs: [b('heal', ['self'], 'always', { strength: 'value' })] }).some((e) => /blank/.test(e)));
  assert.ok(validateAbility({ buffs: [] }).some((e) => /missing text/.test(e)));
  assert.ok(validateAbility({ text: 'x' }).some((e) => /buffs must be an array/.test(e)));
  assert.ok(validateAbility({ text: 'x', buffs: [b('heal', ['self'], 'always', { strength: 1, bogus: 1 })] }).some((e) => /unknown buff field/.test(e)));
  assert.ok(validateAbility({ text: 'x', buffs: [b('heal', ['self'], 'always', { strength: 1, perTarget: true, directions: [] })] }).some((e) => /perTarget/.test(e)));
  assert.ok(validateAbility({ text: 'x', buffs: [b('heal_player', ['self'], 'always', { strength: 1 })] }).some((e) => /takes no directions/.test(e)));
  assert.ok(validateAbility({ text: 'x', buffs: [b('kill', [], 'round_eq', { eventData: 2, ext: true })] }).some((e) => /kill needs/.test(e)));
  assert.ok(validateAbility({ text: 'x', buffs: [b('heal', [], 'always', { strength: 1, scope: 'moon', ext: true })] }).some((e) => /unknown scope/.test(e)));
  assert.ok(validateAbility({ text: 'x', buffs: [b('heal', [], 'always', { strength: 1, scope: 'own_cards', filter: { tribe: 'goblin' }, ext: true })] }).some((e) => /filter\.tribe/.test(e)));
  assert.ok(validateAbility({ text: 'x', buffs: [b('attack', ['front'], 'always', { emptyReduction: 1.5 })] }).some((e) => /emptyReduction/.test(e)));
  assert.ok(validateAbility({ text: 'x', buffs: [b('heal', ['self'], 'always', { strength: 1, cap: 5, ext: true })] }).some((e) => /cap is only/.test(e)));
  assert.ok(validateAbility({ text: 'x', buffs: [b('die', ['self'], 'always')] }).some((e) => /implicit/.test(e)));
  assert.ok(validateAbility({ byStage: [null, null] }).some((e) => /exactly 5/.test(e)));
  assert.ok(validateAbility({ byStage: [null, null, null, null, { text: 'x', buffs: [] }] }).some((e) => /at least one stage/.test(e)));
  assert.ok(validateAbility({ text: 'x', buffs: [], extra: 1 }).some((e) => /unknown ability field/.test(e)));
});

test('exact encodings (representative cards)', () => {
  const A = abilities;
  assert.deepEqual(A['dwarf-king'].buffs, [b('raise_attack', ['left', 'right'], 'always', { strength: 'value' })]);
  assert.deepEqual(A['keeper'].buffs, [b('heal', ['left', 'right'], 'always', { strength: 'value', perTarget: true })]);
  assert.deepEqual(A['arch-angel'].buffs, [b('raise_hp', ['left', 'right'], 'always', { strength: 'value', perTarget: true })]);
  assert.deepEqual(A['armorer'].buffs, [b('raise_attack', ['right'], 'always', { strength: 'value' })]);
  assert.deepEqual(A['siren'].buffs, [b('no_buff', ['front'], 'round_eq', { eventData: 1 }), b('no_damage', ['front'], 'round_eq', { eventData: 1 })]);
  assert.deepEqual(A['basilisk'].buffs, [b('no_damage', ['front'], 'round_le', { eventData: 2 })]);
  assert.deepEqual(A['cursed-stag'].buffs, A['basilisk'].buffs);
  assert.deepEqual(A['tundugar-ironeye'].buffs, [b('no_buff', ['front'], 'round_eq', { eventData: 1 })]);
  assert.deepEqual(A['anvil-guard'].buffs, [b('invulnerable', ['self'], 'round_eq', { eventData: 1 })]);
  assert.deepEqual(A['phoenix'].buffs, [b('resurrect', ['self'], 'onDeath', { eventData: 'self' })]);
  assert.deepEqual(A['tribe-avenger'].buffs, [b('deal_damage_to_all_opponent_cards', [], 'onDeath', { strength: 'value', eventData: 'self' })]);
  assert.deepEqual(A['sun-dragon'].buffs, A['tribe-avenger'].buffs);
  assert.deepEqual(A['crystal-golem'].buffs, [b('deal_damage_to_opponent_player', ['front'], 'onDeath', { strength: 'value', eventData: 'opponent_cards' })]);
  assert.deepEqual(A['mammoth-citadel'].buffs, A['crystal-golem'].buffs);
  assert.deepEqual(A['battering-ram'].buffs, [b('deal_damage_to_opponent_player', ['front'], 'onDeath', { strength: 'value', eventData: 'opponent_cards', damagedBySelf: true, ext: true })]);
  assert.deepEqual(A['dryad-oracle'].buffs, [b('deal_damage_to_opponent_player', [], 'onDeath', { strength: 'value', eventData: 'self' })]);
  assert.deepEqual(A['catapult'].buffs, [b('attack', ['frontLeft', 'front', 'frontRight'], 'round_le', { eventData: 3 })]);
  assert.deepEqual(A['rat-eater'].buffs, [b('attack', ['front'], 'always', { emptyReduction: -200 })]);
  assert.deepEqual(A['succubus'].buffs, A['rat-eater'].buffs);
  assert.deepEqual(A['treeman'].buffs, [b('attack', ['front'], 'always', { emptyReduction: 200 })]);
  assert.deepEqual(A['carnivorous-toadstool'].buffs, [b('attack', ['frontLeft', 'front'], 'always', { unreflectable: true, ext: true })]);
  assert.deepEqual(A['lookalike'].buffs, [b('reflect_damage', ['self'], 'onDamage', { eventData: 'self' })]);
  assert.deepEqual(A['will-o-the-wisp'].buffs, A['lookalike'].buffs);
  assert.deepEqual(A['lava-toad'].buffs, [b('reflect_damage_to_player', ['self'], 'onDamage', { eventData: 'self', cap: 'value', ext: true })]);
  assert.deepEqual(A['loremaster'].buffs, A['lava-toad'].buffs);
  assert.deepEqual(A['star-seer'].buffs, A['lava-toad'].buffs);
  assert.deepEqual(A['scrapmaster'].buffs, [b('increment_attack', ['self'], 'always', { strength: 'value' })]);
  assert.deepEqual(A['war-tattooist'].buffs, [b('increment_attack', ['right'], 'always', { strength: 'value' })]);
  assert.deepEqual(A['voodoo-witch'].buffs, [
    b('deal_damage_to_opponent_player', [], 'always', { strength: 'value' }),
    b('heal_player', [], 'always', { strength: 'value' }),
  ]);
  assert.deepEqual(A['incubus'].buffs, [
    b('deal_damage_to_opponent_player', [], 'always', { strength: 'value' }),
    b('deal_damage_to_player', [], 'always', { strength: 'value' }),
  ]);
  assert.deepEqual(A['minor-demon'].buffs, [b('deal_damage_to_player', [], 'always', { strength: 100 })]);
  assert.equal(A['arch-demon'].buffs[0].strength, 240);
  assert.deepEqual(A['blood-spitter'].buffs, [b('self_damage', [], 'always', { strength: 'value' })]);
  assert.deepEqual(A['dwarven-sage'].buffs, [b('raise_player_hp', [], 'always', { strength: 'value' })]);
  assert.deepEqual(A['tree-of-life'].buffs, A['dwarven-sage'].buffs);
  assert.deepEqual(A['rune-smith'].buffs, [b('heal_player', [], 'always', { strength: 'value' })]);
  assert.deepEqual(A['harpy'].buffs, [b('invulnerable', ['self'], 'round_even', { ext: true })]);
  assert.deepEqual(A['werewolf-dwarf'].buffs, A['harpy'].buffs);
  assert.deepEqual(A['thief-of-time'].buffs, [
    b('increment_attack', ['self'], 'always', { strength: 'value' }),
    b('stun_pattern', [], 'always', { ext: true }),
  ]);
  assert.deepEqual(A['colossus'].buffs, [b('kill', [], 'round_eq', { scope: 'opponent_cards', pick: 'highest_attack', count: 1, eventData: 2, ext: true })]);
  assert.equal(A['dwarf-judge'].buffs[0].pick, 'lowest_attack');
  assert.deepEqual(A['moon-dragon'].buffs, [b('resurrect_allies', [], 'onDeath', { eventData: 'self', scope: 'own_cards', ext: true })]);
  assert.deepEqual(A['arrow-master'].buffs, [b('raise_attack', ['self'], 'round_eq', { strengthPercent: 75, eventData: 1, ext: true })]);
  assert.deepEqual(A['gasher'].buffs[0].eventData, 2);
  assert.deepEqual(A['goblin-mob'].buffs, [b('raise_attack', ['self'], 'round_eq', { strengthPercent: 200, eventData: 1, baseAttack: true, ext: true })]);
  assert.deepEqual(A['battle-boar'].buffs, [b('raise_attack', ['self'], 'round_eq', { strength: 'value', eventData: 1 })]);
  assert.deepEqual(A['blood-fairy'].buffs, [b('raise_attack', ['left', 'right'], 'round_eq', { strength: 'value', eventData: 1 })]);
  assert.deepEqual(A['bone-collector'].buffs, [b('raise_attack', ['self'], 'onDeath', { strength: 100, eventData: 'opponent_cards', nextRound: true, ext: true })]);
  assert.equal(A['guruk-the-destroyer'].buffs[0].strength, 120);
  assert.deepEqual(A['slaver'].buffs, [b('no_damage', ['frontLeft', 'frontRight'], 'onDeath', { eventData: 'opponent_cards', nextRound: true, triggerDirection: 'front', ext: true })]);
  assert.deepEqual(A['sky-guardian'].buffs, A['slaver'].buffs);
  assert.deepEqual(A['goblin-patriarch'].buffs, [
    b('no_damage', ['frontLeft', 'frontRight'], 'round_eq', { eventData: 1 }),
    b('bonus_attack', ['left', 'right'], 'onDeath', { strengthPercent: 200, eventData: 'self', baseAttack: true, ext: true }),
  ]);
  assert.deepEqual(A['warg-rider'].buffs, [b('bonus_attack', ['frontLeft', 'front', 'frontRight', 'left', 'right'], 'onDeath', { strengthPercent: 250, eventData: 'self', baseAttack: true, ext: true })]);
  assert.deepEqual(A['schemer'].buffs, [b('bonus_attack', ['front'], 'onDeath', { strengthPercent: 200, eventData: 'self', baseAttack: true, ext: true })]);
  assert.equal(A['flameling'].buffs[0].strengthPercent, 100);
  assert.deepEqual(A['hurricane-dancer'].buffs, [b('no_damage', ['frontLeft', 'front', 'frontRight', 'left', 'right'], 'round_eq', { eventData: 1 })]);
  assert.deepEqual(A['medusa'].buffs, [b('reduce_ability_attack_percent', [], 'round_eq', { strengthPercent: 'value', scope: 'all_cards', filter: { hasAbility: true, excludeSelf: true }, eventData: 1, ext: true })]);
  assert.deepEqual(A['dark-mage'].buffs, A['medusa'].buffs);
  assert.deepEqual(A['djinn'].buffs, [b('heal_boost_percent', [], 'always', { strengthPercent: 'value', scope: 'own_cards', ext: true })]);
  assert.deepEqual(A['guardian-of-time'].buffs, [b('raise_attack', [], 'always', { strength: 'value', scope: 'own_cards', filter: { offensive: true }, ext: true })]);
  assert.deepEqual(A['bloodsoaked-totem'].buffs, [b('increment_attack', [], 'always', { strength: 'value', scope: 'own_cards', filter: { offensive: true }, ext: true })]);
  assert.deepEqual(A['mendicant'].buffs, [b('raise_attack', [], 'always', { strength: 'value', scope: 'own_cards', filter: { tribe: 'elf', offensive: true, excludeSelf: true }, ext: true })]);
  assert.deepEqual(A['magma-thrower'].buffs, [b('raise_attack', [], 'round_eq', { strength: 'value', scope: 'own_cards', filter: { tribe: 'dwarf', offensive: true }, eventData: 1, ext: true })]);
  assert.deepEqual(A['herb-collector'].buffs, [b('heal', [], 'always', { strength: 'value', scope: 'own_cards', filter: { tribe: 'elf', excludeSelf: true }, ext: true })]);
  assert.deepEqual(A['sentinel'].buffs, [
    b('heal', [], 'always', { strength: 'value', scope: 'own_cards', filter: { excludeSelf: true }, ext: true }),
    b('invulnerable', ['self'], 'round_eq', { eventData: 1 }),
  ]);
  assert.deepEqual(A['totem-carver'].buffs, [b('increment_attack', [], 'onDeath', { strength: 'value', scope: 'own_cards', filter: { tribe: 'orc', offensive: true }, ext: true })]);
  assert.deepEqual(A['baby-dragon'].buffs, [b('increment_attack', [], 'onDeath', { strength: 'value', eventData: 'self', scope: 'own_cards', filter: { tribe: 'neutral', offensive: true, excludeSelf: true }, ext: true })]);
  assert.deepEqual(A['devourer'].buffs, [b('heal', ['self'], 'onDeath', { strength: 'value', eventData: 'opponent_cards' })]);
  assert.deepEqual(A['giant-spider'].buffs, A['devourer'].buffs);
  assert.deepEqual(A['gladiator'].buffs, [b('raise_attack', ['self'], 'onHeal', { eventData: 'self', nextRound: true, strengthFromEvent: true, ext: true })]);
  assert.deepEqual(A['leviathan'].buffs, A['gladiator'].buffs);
  assert.deepEqual(A['bone-oracle'].buffs, [b('invulnerable', ['left', 'right'], 'round_eq', { eventData: 2, filter: { tribe: 'orc' }, ext: true })]);
  assert.deepEqual(A['swarmkeeper'].buffs, [b('invulnerable', ['left'], 'round_eq', { eventData: 1, filter: { tribe: 'orc' }, ext: true })]);
  assert.deepEqual(A['enormous-larva'].buffs, [
    b('resurrect', ['self'], 'onDeath', { eventData: 'self' }),
    b('increment_attack', ['self'], 'onDeath', { strengthPercent: 1000, eventData: 'self', baseAttack: true, ext: true }),
  ]);
  assert.deepEqual(A['bone-dragon'].buffs, [
    b('resurrect', ['self'], 'onDeath', { eventData: 'self' }),
    b('increment_attack', ['self'], 'onDeath', { strength: 'value', eventData: 'self' }),
  ]);
  assert.deepEqual(A['astral-navigator'].buffs, [
    b('resurrect', ['self'], 'onDeath', { eventData: 'self' }),
    b('heal_player', [], 'always', { strength: 'value' }),
  ]);
  assert.deepEqual(A['goblin-cook'].buffs, [
    b('raise_player_hp', [], 'always', { strength: 'value' }),
    b('deal_damage_to_player', [], 'round_eq', { strength: 'value', eventData: 4 }),
  ]);
  assert.deepEqual(A['lightning-spirit'].buffs, [b('deal_damage_to_all_opponent_cards', [], 'always', { strength: 'value', unreflectable: true, ext: true })]);
  assert.deepEqual(A['sand-kraken'].buffs, [b('deal_damage_to_all_opponent_cards', [], 'always', { strength: 'value' })]);
  assert.deepEqual(A['raven-shaman'].buffs, [b('heal', ['left'], 'always', { strength: 'value' })]);
  assert.deepEqual(A['worm-shaman'].buffs, [b('heal', ['right'], 'always', { strength: 'value' })]);
  assert.deepEqual(A['cave-troll'].buffs, [b('heal', ['self'], 'always', { strength: 'value' })]);
});

test('cards without abilities are null', () => {
  for (const id of ['archer', 'gremlin', 'minotaur', 'chimera', 'imperial-dragon', 'tomb-colossus', 'keeper-of-the-treasure', 'envoy', 'adept', 'stone-golem']) {
    assert.equal(abilities[id], null, id);
    assert.equal(hasAbility(abilities[id]), false);
  }
  assert.equal(Object.values(abilities).filter((a) => a === null).length, 55);
  assert.equal(hasAbility(abilities['siren']), true);
});

test('evolving abilities have 5 stages with the wiki texts', () => {
  for (const id of ['bog-yeti', 'sand-yeti', 'mountain-yeti', 'magmamancer', 'army-of-ghosts']) {
    assert.equal(abilities[id].byStage.length, 5, id);
    assert.equal(abilities[id].text, undefined, id);
  }
  const inv = (n) => b('invulnerable', ['self'], 'round_eq', { eventData: n });
  const invGe2 = b('invulnerable', ['self'], 'round_ge', { eventData: 2 });
  // Yetis: stage 0 is text only, stage 4 is invulnerable from round 2.
  assert.equal(hasAbility(abilities['bog-yeti'], 0), false);
  assert.deepEqual(abilityForStage(abilities['bog-yeti'], 0), { text: 'Has no special abilities, as far as you can tell.', buffs: [] });
  assert.equal(hasAbility(abilities['bog-yeti'], 4), true);
  assert.deepEqual(abilityForStage(abilities['bog-yeti'], 1).buffs, [inv(2)]);
  assert.deepEqual(abilityForStage(abilities['bog-yeti'], 2).buffs, [inv(3)]);
  assert.deepEqual(abilityForStage(abilities['bog-yeti'], 3).buffs, [inv(2), inv(3)]);
  assert.deepEqual(abilityForStage(abilities['bog-yeti'], 4).buffs, [invGe2]);
  for (const id of ['mountain-yeti', 'army-of-ghosts']) {
    assert.equal(hasAbility(abilities[id], 0), false, id);
    assert.deepEqual(abilityForStage(abilities[id], 1).buffs, [inv(3)], id);
    assert.deepEqual(abilityForStage(abilities[id], 2).buffs, [inv(2)], id);
    assert.deepEqual(abilityForStage(abilities[id], 3).buffs, [inv(2), inv(3)], id);
    assert.deepEqual(abilityForStage(abilities[id], 4).buffs, [invGe2], id);
  }
  // Sand Yeti heals the player at every stage.
  const healP = b('heal_player', [], 'always', { strength: 'value' });
  assert.deepEqual(abilityForStage(abilities['sand-yeti'], 0).buffs, [healP]);
  assert.equal(abilityForStage(abilities['sand-yeti'], 0).text, "Heals {v} of your health points each round. That's it, as far as you can tell.");
  assert.deepEqual(abilityForStage(abilities['sand-yeti'], 1).buffs, [healP, inv(3)]);
  assert.deepEqual(abilityForStage(abilities['sand-yeti'], 2).buffs, [healP, inv(2)]);
  assert.deepEqual(abilityForStage(abilities['sand-yeti'], 3).buffs, [healP, inv(2), inv(3)]);
  assert.deepEqual(abilityForStage(abilities['sand-yeti'], 4).buffs, [healP, invGe2]);
  // Magmamancer: no_buff / no_damage on frontLeft in round 1, then front in round 2.
  const nb = (d, n) => b('no_buff', [d], 'round_eq', { eventData: n });
  const nd = (d, n) => b('no_damage', [d], 'round_eq', { eventData: n });
  assert.equal(abilityForStage(abilities['magmamancer'], 0).text, 'Her visions appear to have no practical value.');
  assert.equal(hasAbility(abilities['magmamancer'], 0), false);
  assert.deepEqual(abilityForStage(abilities['magmamancer'], 1).buffs, [nb('frontLeft', 1)]);
  assert.deepEqual(abilityForStage(abilities['magmamancer'], 2).buffs, [nb('frontLeft', 1), nd('frontLeft', 1)]);
  assert.deepEqual(abilityForStage(abilities['magmamancer'], 3).buffs, [nb('frontLeft', 1), nd('frontLeft', 1), nb('front', 2)]);
  assert.deepEqual(abilityForStage(abilities['magmamancer'], 4).buffs, [nb('frontLeft', 1), nd('frontLeft', 1), nb('front', 2), nd('front', 2)]);
  // Out-of-range stage clamps; non-evolving returns itself.
  assert.equal(abilityForStage(abilities['magmamancer'], 9), abilities['magmamancer'].byStage[4]);
  assert.equal(abilityForStage(abilities['siren'], 3), abilities['siren']);
  assert.equal(abilityForStage(null, 2), null);
});

test('renderAbilityText fills {v} and {pct}', () => {
  assert.equal(renderAbilityText(abilities['djinn'], 6), 'The healing power of each of your cards increases by 6%.');
  assert.equal(renderAbilityText(abilities['djinn'], 12.5), 'The healing power of each of your cards increases by 12.5%.');
  assert.equal(renderAbilityText(abilities['medusa'], 15), 'The attack power of all cards with special abilities is reduced by 15% in round 1.');
  assert.equal(renderAbilityText(abilities['dwarf-king'], 1600), 'Increases the damage dealt by his neighbors by 1,600.');
  assert.equal(renderAbilityText(abilities['dwarven-sage'], 12345), 'Raises your maximum health by 12,345.');
  assert.equal(renderAbilityText(abilities['sand-yeti'], 840, 2), 'Heals 840 of your health points each round. Receives no damage in round 2.');
  assert.equal(renderAbilityText(abilities['bog-yeti'], null, 0), 'Has no special abilities, as far as you can tell.');
  assert.equal(renderAbilityText(abilities['arrow-master'], null), 'Deals 75% more damage in the first round.');
  assert.equal(renderAbilityText(abilities['dwarf-king'], null), 'Increases the damage dealt by his neighbors by ?.');
  assert.equal(renderAbilityText(abilities['lich-king'], null).length > 10, true);
  assert.equal(renderAbilityText(null, 5), '');
  assert.equal(renderAbilityText(abilities['archer'], 5), '');
  assert.equal(formatValue(1000000), '1,000,000');
  assert.equal(formatValue(-200), '-200');
});

test('every rendered text has no leftover placeholders or blanks', () => {
  for (const [id, a] of Object.entries(abilities)) {
    for (let s = 0; s < 5; s++) {
      const t = renderAbilityText(a, 1234, s);
      assert.ok(!/[{}]|_{2,}/.test(t), `${id}@${s}: ${t}`);
    }
  }
});

test('effectDirs maps buff directions back to catalog names (self and scope buffs give no arrow)', () => {
  assert.deepEqual(effectDirs(abilities['dwarf-king']), ['ownLeft', 'ownRight']);
  assert.deepEqual(effectDirs(abilities['armorer']), ['ownRight']);
  assert.deepEqual(effectDirs(abilities['equipment-master']), ['ownLeft']);
  assert.deepEqual(effectDirs(abilities['siren']), ['direct']);
  assert.deepEqual(effectDirs(abilities['goblin-patriarch']), ['left', 'right', 'ownLeft', 'ownRight']);
  assert.deepEqual(effectDirs(abilities['hurricane-dancer']), ['left', 'direct', 'right', 'ownLeft', 'ownRight']);
  assert.deepEqual(effectDirs(abilities['warg-rider']), ['left', 'direct', 'right', 'ownLeft', 'ownRight']);
  assert.deepEqual(effectDirs(abilities['magmamancer'], 1), ['left']);
  assert.deepEqual(effectDirs(abilities['magmamancer'], 4), ['left', 'direct']);
  assert.deepEqual(effectDirs(abilities['anvil-guard']), []);
  assert.deepEqual(effectDirs(abilities['guardian-of-time']), []);
  assert.deepEqual(effectDirs(abilities['catapult']), [], 'attack overrides are not ability arrows');
  assert.deepEqual(effectDirs(abilities['crystal-golem']), ['direct']);
  assert.deepEqual(effectDirs(null), []);
  assert.deepEqual(effectDirs(abilities['bog-yeti'], 0), []);
  assert.deepEqual(toOriginalDirs(['left', 'direct', 'right', 'ownLeft', 'ownRight']), ['frontLeft', 'front', 'frontRight', 'left', 'right']);
  assert.deepEqual(toOriginalDirs(['direct', 'ownLeft', 'bogus']), ['front', 'left']);
  assert.deepEqual(toCatalogDirs(['right', 'self', 'front', 'frontLeft']), ['left', 'direct', 'ownRight']);
});

test('buffsForStage: implicit attack, resolved strengths, perTarget, overrides', () => {
  // Dwarf King: implicit attack from its dirs + the raise_attack with the value resolved (no perTarget: split by the engine).
  assert.deepEqual(buffsForStage(abilities['dwarf-king'], 0, 1600, ['direct']), [
    { type: 'attack', directions: ['front'], event: 'always' },
    b('raise_attack', ['left', 'right'], 'always', { strength: 1600 }),
  ]);
  // Keeper: no attack dirs → no implicit attack; perTarget doubles the stored per-neighbour amount.
  assert.deepEqual(buffsForStage(abilities['keeper'], 0, 100, []), [b('heal', ['left', 'right'], 'always', { strength: 200 })]);
  assert.deepEqual(buffsForStage(abilities['raven-shaman'], 0, 100, ['direct']), [
    { type: 'attack', directions: ['front'], event: 'always' },
    b('heal', ['left'], 'always', { strength: 100 }),
  ]);
  // Catapult: the explicit attack replaces the implicit one.
  assert.deepEqual(buffsForStage(abilities['catapult'], 0, null, ['left', 'direct', 'right']), [b('attack', ['frontLeft', 'front', 'frontRight'], 'round_le', { eventData: 3 })]);
  assert.deepEqual(buffsForStage(abilities['rat-eater'], 0, null, ['direct']), [b('attack', ['front'], 'always', { emptyReduction: -200 })]);
  // Reflect cap and percent strengths are resolved; ext flags survive.
  assert.deepEqual(buffsForStage(abilities['lava-toad'], 0, 2000, []), [b('reflect_damage_to_player', ['self'], 'onDamage', { eventData: 'self', cap: 2000, ext: true })]);
  assert.deepEqual(buffsForStage(abilities['djinn'], 0, 6, ['direct']), [
    { type: 'attack', directions: ['front'], event: 'always' },
    b('heal_boost_percent', [], 'always', { strengthPercent: 6, scope: 'own_cards', ext: true }),
  ]);
  assert.equal(buffsForStage(abilities['arrow-master'], 0, null, ['left', 'direct', 'right'])[1].strengthPercent, 75);
  // Flat strengths stay; own-neighbour attackers map to left/right.
  assert.deepEqual(buffsForStage(abilities['minor-demon'], 0, 999, ['direct'])[1].strength, 100);
  assert.deepEqual(buffsForStage(abilities['bloodsoaked-totem'], 0, 300, ['ownLeft', 'ownRight'])[0], { type: 'attack', directions: ['left', 'right'], event: 'always' });
  assert.deepEqual(buffsForStage(null, 0, 5, ['direct', 'ownLeft']), [{ type: 'attack', directions: ['front', 'left'], event: 'always' }]);
  assert.deepEqual(buffsForStage(null, 0, 5, []), []);
  assert.deepEqual(buffsForStage(abilities['lich-king'], 0, null, []), []);
  // Stages: Sand Yeti ++++ and Magmamancer +.
  assert.deepEqual(buffsForStage(abilities['sand-yeti'], 4, 840, []), [
    b('heal_player', [], 'always', { strength: 840 }),
    b('invulnerable', ['self'], 'round_ge', { eventData: 2 }),
  ]);
  assert.deepEqual(buffsForStage(abilities['magmamancer'], 1, null, []), [b('no_buff', ['frontLeft'], 'round_eq', { eventData: 1 })]);
  // Missing value → 0, never the string "value"; the source data is not mutated.
  const before = JSON.stringify(abilities['dwarf-king']);
  assert.equal(buffsForStage(abilities['dwarf-king'], 0, null, ['direct'])[1].strength, 0);
  assert.equal(JSON.stringify(abilities['dwarf-king']), before);
  for (const [id, a] of Object.entries(abilities)) {
    for (let s = 0; s < 5; s += 1) {
      for (const buff of buffsForStage(a, s, 10, cardById.get(id).dirs)) {
        assert.notEqual(buff.strength, 'value', `${id}@${s}`);
        assert.notEqual(buff.cap, 'value', `${id}@${s}`);
        assert.notEqual(buff.strengthPercent, 'value', `${id}@${s}`);
        assert.equal(buff.perTarget, undefined, `${id}@${s}`);
        for (const d of buff.directions) assert.ok(DIRECTIONS.includes(d), `${id}@${s} ${d}`);
      }
    }
  }
});

test('explicit attack overrides use exactly the card dirs of cards.json', () => {
  let overrides = 0;
  for (const [id, a] of Object.entries(abilities)) {
    if (!a) continue;
    for (const st of a.byStage ? a.byStage : [a]) {
      if (!st) continue;
      for (const buff of st.buffs) {
        if (buff.type !== 'attack') continue;
        overrides += 1;
        assert.deepEqual(buff.directions, toOriginalDirs(cardById.get(id).dirs), id);
      }
    }
  }
  assert.equal(overrides, 5, 'Catapult, Rat Eater, Succubus, Treeman, Carnivorous Toadstool');
  // Every card with buffs and attack dirs gets the implicit attack from buffsForStage.
  for (const c of cardsJson.cards) {
    const buffs = buffsForStage(c.ability, 0, 1, c.dirs);
    assert.equal(buffs.some((x) => x.type === 'attack'), c.dirs.length > 0, c.id);
  }
});
