'use strict';

/**
 * Battle-engine test fixtures: a hand-made subset of the card catalog (level-1 wiki values) with
 * abilities encoded as ORIGINAL-simulator buffs (docs/design/ability-encoding.md), a stub
 * `computeStats`, raw cards with explicit buffs, and helpers to build sides and run fights.
 *
 * Buff directions are original names (front, frontLeft, frontRight, left, right, self); card `dirs`
 * are catalog names (direct, left, right, ownLeft, ownRight).
 */

import { toBattleCard, buildSide, normaliseDirs, toOriginalDirs } from '../../src/engine/battle-state.js';
import { simulateBattle } from '../../src/engine/battle.js';
import { slugify } from '../../src/core/cards-db.js';

/** Card id slug rule (the project's `slugify`). */
export const slug = slugify;

function def(name, tribe, rarity, mana, dirs, base, buffs, extra = {}) {
  const id = slug(name);
  return {
    id, name, tribe, rarity, mana, dirs,
    base: { attack: base.attack || 0, hp: base.hp, ability: base.ability ?? null },
    ability: buffs ? { text: `${name} ability`, buffs } : null,
    ...extra,
  };
}

const r1 = { event: 'round_eq', eventData: 1 };
const r2 = { event: 'round_eq', eventData: 2 };
const always = { event: 'always' };
const onDeathSelf = { event: 'onDeath', eventData: 'self' };

/** @type {Record<string, object>} */
export const CARD_DEFS = Object.fromEntries([
  def('Scorpion Rider', 'elf', 'legendary', 23, ['direct'], { attack: 2000, hp: 1400 }, [{ type: 'no_buff', directions: ['front'], ...r1 }]),
  def('Siren', 'neutral', 'standard', 10, [], { hp: 300 }, [
    { type: 'no_buff', directions: ['front'], ...r1 },
    { type: 'no_damage', directions: ['front'], ...r1 },
  ]),
  def('Dwarven Sage', 'dwarf', 'legendary', 25, [], { hp: 2400, ability: 5000 }, [{ type: 'raise_player_hp', strength: 'value', directions: [], ...always }]),
  def('Dwarf King', 'dwarf', 'legendary', 24, ['direct'], { attack: 800, hp: 2400, ability: 1600 }, [{ type: 'raise_attack', strength: 'value', directions: ['left', 'right'], ...always }]),
  def('Moon Dragon', 'neutral', 'legendary', 22, ['left', 'direct', 'right'], { attack: 900, hp: 900 }, [{ type: 'resurrect_allies', directions: [], scope: 'own_cards', ...onDeathSelf, ext: true }]),
  def('Colossus', 'neutral', 'legendary', 22, ['direct'], { attack: 1800, hp: 1400 }, [{ type: 'kill', directions: [], scope: 'opponent_cards', pick: 'highest_attack', count: 1, ...r2, ext: true }]),
  def('Dwarf Judge', 'dwarf', 'heroic', 19, ['direct'], { attack: 600, hp: 1500 }, [{ type: 'kill', directions: [], scope: 'opponent_cards', pick: 'lowest_attack', count: 1, ...r2, ext: true }]),
  def('Umbral Dragon', 'neutral', 'ultimate', 30, ['direct'], { attack: 1500, hp: 1500 }, [{ type: 'kill', directions: [], scope: 'all_cards', filter: { excludeSelf: true }, pick: 'random', count: 2, ...r2, ext: true }]),
  def('Thief of Time', 'neutral', 'ultimate', 30, ['direct'], { attack: 0, hp: 4000, ability: 800 }, [
    { type: 'increment_attack', strength: 'value', directions: ['self'], ...always },
    { type: 'stun_pattern', directions: [], ...always, ext: true },
  ]),
  def('Goblin Patriarch', 'orc', 'legendary', 23, ['left', 'right'], { attack: 1600, hp: 1800 }, [
    { type: 'no_damage', directions: ['frontLeft', 'frontRight'], ...r1 },
    { type: 'bonus_attack', strengthPercent: 200, directions: ['left', 'right'], ...onDeathSelf, baseAttack: true, ext: true },
  ]),
  def('Warg Rider', 'orc', 'heroic', 20, ['left', 'right'], { attack: 1800, hp: 1200 }, [
    { type: 'bonus_attack', strengthPercent: 250, directions: ['frontLeft', 'front', 'frontRight', 'left', 'right'], ...onDeathSelf, baseAttack: true, ext: true },
  ]),
  def('Voodoo Witch', 'orc', 'ultimate', 30, [], { hp: 2000, ability: 2000 }, [
    { type: 'deal_damage_to_opponent_player', strength: 'value', directions: [], ...always },
    { type: 'heal_player', strength: 'value', directions: [], ...always },
  ]),
  def('Goblin Cook', 'orc', 'rare', 15, [], { hp: 960, ability: 2500 }, [
    { type: 'raise_player_hp', strength: 'value', directions: [], ...always },
    { type: 'deal_damage_to_player', strength: 'value', directions: [], event: 'round_eq', eventData: 4 },
  ]),
  def('Wheel of Fortune', 'elf', 'heroic', 20, [], { hp: 2000, ability: 900 }, [{ type: 'wheel', strength: 'value', directions: [], scope: 'all_cards', filter: { excludeSelf: true }, ...always, ext: true }]),
  def('Wizard Apprentice', 'dwarf', 'legendary', 25, ['left', 'direct', 'right'], { attack: 1500, hp: 1500, ability: 6 }, [{ type: 'gamble', strengthPercent: 'value', directions: [], scope: 'own_cards', filter: { offensive: true }, ...always, ext: true }]),
  def('Goblin Thieves', 'orc', 'uncommon', 10, ['direct'], { attack: 350, hp: 350 }, [{ type: 'swap_stats_random', directions: [], scope: 'all_cards', pick: 'random', count: 1, ...r1, ext: true }]),
  def('Phoenix', 'neutral', 'rare', 13, ['direct'], { attack: 720, hp: 480 }, [{ type: 'resurrect', directions: ['self'], ...onDeathSelf }]),
  def('Enormous Larva', 'orc', 'heroic', 19, ['direct'], { attack: 150, hp: 1200, ability: 1650 }, [
    { type: 'resurrect', directions: ['self'], ...onDeathSelf },
    { type: 'increment_attack', strengthPercent: 1000, directions: ['self'], ...onDeathSelf, baseAttack: true, ext: true },
  ]),
  def('Bone dragon', 'neutral', 'ultimate', 30, ['direct'], { attack: 100, hp: 200, ability: 3100 }, [
    { type: 'resurrect', directions: ['self'], ...onDeathSelf },
    { type: 'increment_attack', strength: 'value', directions: ['self'], ...onDeathSelf },
  ]),
  def('Bouncer', 'neutral', 'legendary', 25, ['direct'], { attack: 0, hp: 2000 }, [
    { type: 'no_buff', directions: [], scope: 'each_side', filter: { excludeSelf: true }, pick: 'random', count: 1, event: 'round_le', eventData: 2, ext: true },
    { type: 'no_damage', directions: [], scope: 'each_side', filter: { excludeSelf: true }, pick: 'random', count: 1, event: 'round_le', eventData: 2, ext: true },
  ]),
  def('Tribe Avenger', 'orc', 'uncommon', 6, ['direct'], { attack: 200, hp: 100, ability: 100 }, [{ type: 'deal_damage_to_all_opponent_cards', strength: 'value', directions: [], ...onDeathSelf }]),
  def('Sun Dragon', 'neutral', 'legendary', 22, ['left', 'direct', 'right'], { attack: 2400, hp: 800, ability: 400 }, [{ type: 'deal_damage_to_all_opponent_cards', strength: 'value', directions: [], ...onDeathSelf }]),
  def('Djinn', 'elf', 'heroic', 18, ['direct'], { attack: 750, hp: 1500, ability: 6 }, [{ type: 'heal_boost_percent', strengthPercent: 'value', directions: [], scope: 'own_cards', ...always, ext: true }]),
  def('Medusa', 'neutral', 'heroic', 19, ['direct'], { attack: 1350, hp: 1200, ability: 6 }, [{ type: 'reduce_ability_attack_percent', strengthPercent: 'value', directions: [], scope: 'all_cards', filter: { hasAbility: true, excludeSelf: true }, ...r1, ext: true }]),
  def('Battering Ram', 'dwarf', 'heroic', 18, ['direct'], { attack: 1500, hp: 1050, ability: 300 }, [{ type: 'deal_damage_to_opponent_player', strength: 'value', directions: ['front'], event: 'onDeath', eventData: 'opponent_cards', damagedBySelf: true, ext: true }]),
  def('Arch Angel', 'neutral', 'uncommon', 9, ['direct'], { attack: 200, hp: 500, ability: 400 }, [{ type: 'raise_hp', strength: 'value', directions: ['left', 'right'], ...always }]),
  def('Minotaur', 'elf', 'rare', 15, ['direct', 'ownLeft'], { attack: 1620, hp: 1200 }, null),
  def('Rat Eater', 'orc', 'rare', 11, ['direct'], { attack: 720, hp: 480 }, [{ type: 'attack', directions: ['front'], ...always, emptyReduction: -200 }]),
  def('Treeman', 'elf', 'uncommon', 8, ['direct'], { attack: 300, hp: 600 }, [{ type: 'attack', directions: ['front'], ...always, emptyReduction: 200 }]),
  def('Catapult', 'dwarf', 'uncommon', 10, ['left', 'direct', 'right'], { attack: 600, hp: 500 }, [{ type: 'attack', directions: ['frontLeft', 'front', 'frontRight'], event: 'round_le', eventData: 3 }]),
  def('Gasher', 'orc', 'uncommon', 10, ['direct'], { attack: 500, hp: 400 }, [{ type: 'raise_attack', strengthPercent: 75, directions: ['self'], ...r2, ext: true }]),
  def('Goblin Mob', 'orc', 'uncommon', 9, ['direct'], { attack: 300, hp: 450 }, [{ type: 'raise_attack', strengthPercent: 200, directions: ['self'], ...r1, baseAttack: true, ext: true }]),
  def('Sky Guardian', 'elf', 'uncommon', 7, ['direct'], { attack: 200, hp: 300 }, [{ type: 'no_damage', directions: ['frontLeft', 'frontRight'], event: 'onDeath', eventData: 'opponent_cards', nextRound: true, triggerDirection: 'front', ext: true }]),
  def('Lava Toad', 'dwarf', 'uncommon', 7, [], { hp: 500, ability: 300 }, [{ type: 'reflect_damage_to_player', cap: 'value', directions: ['self'], event: 'onDamage', eventData: 'self', ext: true }]),
  def('Lookalike', 'neutral', 'rare', 12, [], { hp: 1080 }, [{ type: 'reflect_damage', directions: ['self'], event: 'onDamage', eventData: 'self' }]),
  def('Anvil Guard', 'dwarf', 'rare', 12, ['direct'], { attack: 600, hp: 720 }, [{ type: 'invulnerable', directions: ['self'], ...r1 }]),
  def('Harpy', 'elf', 'rare', 12, ['direct', 'right'], { attack: 720, hp: 720 }, [{ type: 'invulnerable', directions: ['self'], event: 'round_even', ext: true }]),
  def('Dwarf Tinker', 'dwarf', 'uncommon', 7, ['direct'], { attack: 100, hp: 400 }, [{ type: 'no_damage', directions: ['front'], ...r1 }]),
  def('Basilisk', 'neutral', 'uncommon', 9, ['direct'], { attack: 100, hp: 500 }, [{ type: 'no_damage', directions: ['front'], event: 'round_le', eventData: 2 }]),
  def('War Tattooist', 'orc', 'rare', 12, ['direct'], { attack: 240, hp: 840, ability: 500 }, [{ type: 'increment_attack', strength: 'value', directions: ['right'], ...always }]),
  def('Argonaut', 'dwarf', 'rare', 11, ['direct'], { attack: 240, hp: 600, ability: 240 }, [{ type: 'heal', strength: 'value', directions: ['left', 'right'], ...always, perTarget: true }]),
  def('Gladiator', 'neutral', 'rare', 12, ['direct'], { attack: 480, hp: 1080 }, [{ type: 'raise_attack', directions: ['self'], event: 'onHeal', eventData: 'self', nextRound: true, strengthFromEvent: true, ext: true }]),
  def('Bone Collector', 'orc', 'uncommon', 9, ['direct'], { attack: 300, hp: 500 }, [{ type: 'raise_attack', strength: 100, directions: ['self'], event: 'onDeath', eventData: 'opponent_cards', nextRound: true, ext: true }]),
  def('Devourer', 'orc', 'legendary', 21, ['direct'], { attack: 2000, hp: 2000, ability: 400 }, [{ type: 'heal', strength: 'value', directions: ['self'], event: 'onDeath', eventData: 'opponent_cards' }]),
  def('Blood Spitter', 'orc', 'uncommon', 6, ['direct'], { attack: 500, hp: 300, ability: 100 }, [{ type: 'self_damage', strength: 'value', directions: [], ...always }]),
  def('Minor Demon', 'neutral', 'uncommon', 8, ['direct'], { attack: 500, hp: 500 }, [{ type: 'deal_damage_to_player', strength: 100, directions: [], ...always }]),
  def('Hurricane Dancer', 'elf', 'heroic', 20, ['left', 'direct', 'right'], { attack: 1650, hp: 900 }, [{ type: 'no_damage', directions: ['frontLeft', 'front', 'frontRight', 'left', 'right'], ...r1 }]),
  def('Crystal Golem', 'dwarf', 'rare', 15, ['direct'], { attack: 720, hp: 720, ability: 720 }, [{ type: 'deal_damage_to_opponent_player', strength: 'value', directions: ['front'], event: 'onDeath', eventData: 'opponent_cards' }]),
  def('Dryad Oracle', 'elf', 'rare', 14, ['left', 'right'], { attack: 720, hp: 600, ability: 600 }, [{ type: 'deal_damage_to_opponent_player', strength: 'value', directions: [], ...onDeathSelf }]),
  def('Bone Oracle', 'orc', 'rare', 11, [], { hp: 700 }, [{ type: 'invulnerable', directions: ['left', 'right'], filter: { tribe: 'orc' }, ...r2, ext: true }]),
  def('Baby Dragon', 'neutral', 'uncommon', 8, ['left', 'direct', 'right'], { attack: 300, hp: 100, ability: 300 }, [
    { type: 'increment_attack', strength: 'value', directions: [], scope: 'own_cards', filter: { tribe: 'neutral', offensive: true, excludeSelf: true }, ...onDeathSelf, ext: true },
  ]),
  def('Totem Carver', 'orc', 'rare', 15, ['direct'], { attack: 300, hp: 1000, ability: 200 }, [
    { type: 'increment_attack', strength: 'value', directions: [], scope: 'own_cards', filter: { tribe: 'orc', offensive: true }, event: 'onDeath', ext: true },
  ]),
  def('Guardian of Time', 'elf', 'heroic', 20, [], { hp: 1500, ability: 300 }, [{ type: 'raise_attack', strength: 'value', directions: [], scope: 'own_cards', filter: { offensive: true }, ...always, ext: true }]),
  def('Lightning Spirit', 'elf', 'legendary', 25, [], { hp: 1400, ability: 700 }, [{ type: 'deal_damage_to_all_opponent_cards', strength: 'value', directions: [], ...always, unreflectable: true, ext: true }]),
  def('Astral Navigator', 'elf', 'legendary', 25, [], { hp: 2000, ability: 2400 }, [
    { type: 'resurrect', directions: ['self'], ...onDeathSelf },
    { type: 'heal_player', strength: 'value', directions: [], ...always },
  ]),
  def('Schemer', 'orc', 'rare', 14, ['direct'], { attack: 360, hp: 960 }, [{ type: 'bonus_attack', strengthPercent: 200, directions: ['front'], ...onDeathSelf, baseAttack: true, ext: true }]),
  def('Pikeman', 'dwarf', 'common', 3, ['direct'], { attack: 100, hp: 200 }, null),
  def('Archer', 'elf', 'standard', 5, ['left', 'direct', 'right'], { attack: 300, hp: 200 }, null),
  def('Stone Wall', 'neutral', 'rare', 10, [], { hp: 100 }, [{ type: 'invulnerable', directions: ['self'], ...always }]),
  // evolving ability: stage 0 nothing, stage 1 indestructible in round 2
  def('Bog Yeti', 'neutral', 'rare', 14, ['direct'], { attack: 600, hp: 900 }, null, {
    ability: { byStage: [
      { text: 'Has no special abilities, as far as you can tell.', buffs: [] },
      { text: 'Receives no damage in round 2.', buffs: [{ type: 'invulnerable', directions: ['self'], ...r2 }] },
      { text: 'Receives no damage in round 3.', buffs: [{ type: 'invulnerable', directions: ['self'], event: 'round_eq', eventData: 3 }] },
      { text: 'Receives no damage in rounds 2 and 3.', buffs: [{ type: 'invulnerable', directions: ['self'], ...r2 }, { type: 'invulnerable', directions: ['self'], event: 'round_eq', eventData: 3 }] },
      { text: 'Receives no damage from round 2 on.', buffs: [{ type: 'invulnerable', directions: ['self'], event: 'round_ge', eventData: 2 }] },
    ] },
  }),
].map((d) => [d.id, d]));

/**
 * Stub for stats.js: level-1 values at stage 0; +10 % per level, x1.15 per stage, x evolveQuality.
 * @param {{cardDef: object, stage: number, level: number, evolveQuality: number}} args
 */
export function computeStats({ cardDef, stage, level, evolveQuality = 1 }) {
  const f = (1 + 0.1 * (level - 1)) * Math.pow(1.15, stage) * evolveQuality;
  const b = cardDef.base;
  return {
    attack: Math.round((b.attack || 0) * f),
    hp: Math.round(b.hp * f),
    ability: b.ability === null || b.ability === undefined ? null : Math.round(b.ability * f * 10) / 10,
  };
}

/** cardsDb lookup compatible with buildSide. */
export const cardsDb = { get: (id) => CARD_DEFS[id] };

let uidCounter = 0;

/**
 * A BattleCard for a fixture card.
 * @param {string} idOrName   slug or display name
 * @param {{level?: number, stage?: number, evolveQuality?: number, uid?: string}} [opts]
 */
export function card(idOrName, opts = {}) {
  const id = CARD_DEFS[idOrName] ? idOrName : slug(idOrName);
  const cardDef = CARD_DEFS[id];
  if (!cardDef) throw new Error(`fixture card not found: ${idOrName}`);
  const instance = { uid: opts.uid || `u${++uidCounter}`, cardId: id, stage: opts.stage || 0, level: opts.level || 1, xp: 0, evolveQuality: opts.evolveQuality ?? 1 };
  return toBattleCard(instance, cardDef, computeStats);
}

/**
 * A plain card with no ability (its normal attack comes from the catalog dirs).
 * @param {string} name @param {number} attack @param {number} hp @param {string[]} [dirs] @param {string} [tribe]
 */
export function vanilla(name, attack, hp, dirs = ['direct'], tribe = 'neutral') {
  return {
    instanceId: `v${++uidCounter}`, cardId: slug(name), name, tribe, rarity: 'common', mana: 1,
    stage: 0, level: 1, attack, maxHp: hp, hp, abilityValue: 0, dirs, ability: null,
  };
}

/**
 * A card with explicit ORIGINAL buffs (plus the implicit attack buff for the catalog `dirs` unless the
 * buffs already contain an `attack`).
 * @param {string} name @param {number} attack @param {number} hp
 * @param {string[]} [dirs]  catalog names
 * @param {object[]} [buffs]  original-shape buffs
 * @param {{tribe?: string, abilityValue?: number}} [opts]
 */
export function raw(name, attack, hp, dirs = [], buffs = [], opts = {}) {
  const list = [];
  const odirs = toOriginalDirs(dirs);
  if (odirs.length && !buffs.some((b) => b.type === 'attack')) list.push({ type: 'attack', directions: odirs, event: 'always' });
  return {
    instanceId: `r${++uidCounter}`, cardId: slug(name), name, tribe: opts.tribe || 'neutral', rarity: 'common', mana: 1,
    stage: 0, level: 1, attack, maxHp: hp, hp, abilityValue: opts.abilityValue || 0, dirs: normaliseDirs(dirs), ability: null,
    buffs: [...list, ...buffs],
  };
}

/** A 0-attack, high-hp card that keeps a slot occupied without affecting the fight. */
export function wall(hp = 1000000, tribe = 'neutral') {
  return vanilla('Wall', 0, hp, [], tribe);
}

/**
 * Build a side. Tribe bonus is off by default so player hp numbers in tests stay simple.
 * @param {Array<object|null>} cards
 * @param {{hp?: number, name?: string, tribeBonus?: boolean}} [opts]
 */
export function side(cards, opts = {}) {
  return buildSide({ name: opts.name || 'P', maxHp: opts.hp || 1500 }, cards, { tribeBonus: opts.tribeBonus === true });
}

/**
 * Run a fight.
 * @param {Array<object|null>} attackerCards
 * @param {Array<object|null>} defenderCards
 * @param {{seed?: number, aHp?: number, dHp?: number, maxRounds?: number, tribeBonus?: boolean}} [opts]
 */
export function fight(attackerCards, defenderCards, opts = {}) {
  const cfg = {
    attacker: side(attackerCards, { hp: opts.aHp, name: 'A', tribeBonus: opts.tribeBonus }),
    defender: side(defenderCards, { hp: opts.dHp, name: 'D', tribeBonus: opts.tribeBonus }),
    seed: opts.seed ?? 1,
  };
  if (opts.maxRounds !== undefined) cfg.options = { maxRounds: opts.maxRounds };
  const out = simulateBattle(cfg);
  return { cfg, ...out, ...eventHelpers(out.events) };
}

/** Query helpers over an event log. */
function eventHelpers(events) {
  const inRound = (round) => {
    const start = events.findIndex((e) => e.t === 'roundStart' && e.round === round);
    if (start < 0) return [];
    const end = events.findIndex((e, i) => i > start && e.t === 'roundEnd');
    return events.slice(start, end < 0 ? events.length : end + 1);
  };
  const of = (type, round) => (round ? inRound(round) : events).filter((e) => e.t === type);
  return {
    inRound,
    of,
    attacks: (round) => of('attack', round),
    damages: (round) => of('damage', round),
    heals: (round) => of('heal', round),
    deaths: (round) => of('death', round),
    statuses: (round) => of('status', round),
    buffs: (round) => of('buff', round),
    revives: (round) => of('revive', round),
    roundEnd: (round) => of('roundEnd', round)[0],
    playerDamage: (sideKey, round) => of('damage', round).filter((e) => e.side === sideKey && e.slot === null),
    cardHp: (sideKey, slot, round) => of('roundEnd', round)[0].cards[sideKey][slot],
  };
}
