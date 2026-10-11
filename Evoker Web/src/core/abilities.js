'use strict';
/**
 * Ability data helpers for the original buff model (docs/design/original-engine.md, docs/design/ability-encoding.md).
 *
 * An ability entry in data/abilities.json is one of:
 *   null                                       – the card has no ability
 *   { text, buffs: Buff[], notes? }            – a normal ability (buffs may be [] for flavour-only text: trainers)
 *   { byStage: [e0, e1, e2, e3, e4], notes? }  – evolving ability, one entry (or null) per fusion stage
 *
 * `text` is the original card text with the ability value replaced by `{v}` (number) or `{pct}` (percent).
 * A buff is `{ type, strength?, strengthPercent?, cap?, directions, scope?, filter?, pick?, count?, event, eventData?,
 * nextRound?, emptyReduction?, perTarget?, baseAttack?, unreflectable?, triggerDirection?, damagedBySelf?,
 * strengthFromEvent?, ext? }` — see BUFF_TYPES / EVENTS below and the encoding doc for the semantics.
 *
 * The card's normal attack is NOT stored: the engine (and buffsForStage) adds
 * `{ type: 'attack', directions: <card dirs>, event: 'always' }` unless the entry carries an explicit `attack` buff.
 *
 * Pure module: no DOM, no randomness, no time.
 */

import { DIRECTIONS as CATALOG_DIRECTIONS, TRIBE_ORDER } from './constants.js';

/**
 * Buff types: the 18 original handlers plus the extensions of original-engine.md §8.
 * `phase` is the original phase slot the type runs in (extensions name the slot they attach to).
 * @type {Record<string, {phase: string, ext: boolean, description: string}>}
 */
export const BUFF_TYPES = Object.freeze({
  no_buff: { phase: 'no_buff', ext: false, description: 'Target card loses its abilities this round (noBuffsAllowed). Not blocked by the source being suppressed.' },
  raise_attack: { phase: 'raise_attack', ext: false, description: 'Target card attack += round(strength / #directions) this round (negative lowers). Ext: strengthPercent of the card attack, baseAttack for origAttack.' },
  raise_hp: { phase: 'raise_hp', ext: false, description: 'Target card hp += round(strength / #directions) this round.' },
  raise_player_hp: { phase: 'raise_player_hp', ext: false, description: 'Own player hp += strength this round (re-applied every round while the card lives, so effectively permanent).' },
  increment_attack: { phase: 'increment_attack', ext: false, description: 'Target card origAttack and attack += strength, permanently (not split). Ext: strengthPercent + baseAttack = percent of origAttack.' },
  invulnerable: { phase: 'invulnerable', ext: false, description: 'Target card takes no damage this round (attacks are logged as blocked).' },
  no_damage: { phase: 'no_damage', ext: false, description: 'Target card attack = 0 this round (daze).' },
  attack: { phase: 'attack', ext: false, description: 'The normal attack: round(attack / #directions) per direction; empty slot: (attack - emptyReduction) / #directions to the opposing player. Stored only to override the implicit attack.' },
  reflect_damage: { phase: 'reflect_damage', ext: false, description: 'onDamage/self: the attacking card takes the same damage (blocked if it is invulnerable). Ext: cap.' },
  reflect_damage_to_player: { phase: 'reflect_damage_to_player', ext: false, description: 'onDamage/self: the attacking player takes the same damage. Ext: cap = maximum per hit.' },
  deal_damage_to_all_opponent_cards: { phase: 'deal_damage_to_all_opponent_cards', ext: false, description: 'Every opposing card takes strength (blocked by invulnerable; pushes onDamage events unless unreflectable).' },
  self_damage: { phase: 'self_damage', ext: false, description: 'This card takes strength.' },
  heal: { phase: 'heal', ext: false, description: 'Target card (not dead) takenDamage -= round(strength / #directions). Data: perTarget marks a per-target amount that the pipeline multiplies by #directions.' },
  heal_player: { phase: 'heal_player', ext: false, description: 'Own player takenDamage -= strength (min 0).' },
  die: { phase: 'die', ext: false, description: 'Implicit for every card (self/always): marks the card dead when takenDamage >= hp and pushes onDeath. Never stored.' },
  resurrect: { phase: 'resurrect', ext: false, description: 'onDeath/self: once per fight, takenDamage = 0, died = false.' },
  deal_damage_to_opponent_player: { phase: 'deal_damage_to_opponent_player', ext: false, description: 'Opposing player takenDamage += strength. With onDeath/opponent_cards and directions, only when the dying card is at one of the directions.' },
  deal_damage_to_player: { phase: 'deal_damage_to_player', ext: false, description: 'Own player takenDamage += strength.' },
  // Extensions (original-engine.md §8).
  bonus_attack: { phase: 'attack', ext: true, description: '[ext] Extra attack in the event loop: strengthPercent of the card attack (origAttack with baseAttack) split over the directions; empty slots hit the opposing player.' },
  kill: { phase: 'end_of_round', ext: true, description: '[ext] After the phase list of round eventData: marks `count` cards of `scope` picked by `pick` dead (ignores invulnerable) and pushes onDeath.' },
  resurrect_allies: { phase: 'resurrect', ext: true, description: '[ext] onDeath/self, once per fight: every own card that died this round (itself included) is resurrected; revived cards fire no death triggers.' },
  swap_stats_random: { phase: 'raise_attack', ext: true, description: '[ext] Before the raise_attack buffs of round eventData: one random living card of `scope` swaps attack and hp (orig values too).' },
  wheel: { phase: 'heal', ext: true, description: '[ext] Heal slot: every card of `scope` is healed by strength (50 %) or damaged by strength (50 %), one roll per card.' },
  gamble: { phase: 'raise_attack', ext: true, description: '[ext] After the raise_attack buffs: one roll per round; with probability (100 - strengthPercent) % every card of `scope` gets +25 % attack this round, otherwise -25 %.' },
  heal_boost_percent: { phase: 'heal', ext: true, description: '[ext] While the card lives: heal buffs of own cards heal round(strength x (1 + pct / 100)); several sources add their percents. Not heal_player.' },
  reduce_ability_attack_percent: { phase: 'raise_attack', ext: true, description: '[ext] After every raise_attack/gamble of the round: every card of `scope` matching `filter` (cards with an ability, not itself) loses strengthPercent % of its attack; several sources multiply.' },
  stun_pattern: { phase: 'no_buff', ext: true, description: '[ext] Thief of Time: odd rounds no_buff + no_damage on [front, left, right]; even rounds on [frontLeft, frontRight].' },
});

/** Original direction names (original-engine.md §2). */
export const DIRECTIONS = Object.freeze(['front', 'frontLeft', 'frontRight', 'left', 'right', 'self']);

/**
 * Buff events. `round_odd`, `round_even` and `onHeal` are extensions.
 * @type {Record<string, {ext: boolean, mode: 'round'|'event', description: string}>}
 */
export const EVENTS = Object.freeze({
  always: { ext: false, mode: 'round', description: 'Every round.' },
  round_eq: { ext: false, mode: 'round', description: 'Round == eventData.' },
  round_ge: { ext: false, mode: 'round', description: 'Round >= eventData.' },
  round_le: { ext: false, mode: 'round', description: 'Round <= eventData.' },
  round_odd: { ext: true, mode: 'round', description: '[ext] Odd rounds.' },
  round_even: { ext: true, mode: 'round', description: '[ext] Even rounds.' },
  onDamage: { ext: false, mode: 'event', description: 'A card took damage; eventData: nil (any), "self", "opponent_cards".' },
  onDeath: { ext: false, mode: 'event', description: 'A card died; eventData: nil (any), "self", "opponent_cards".' },
  onHeal: { ext: true, mode: 'event', description: '[ext] A card was healed by a heal buff; eventData "self".' },
});

/** Catalog direction name → original direction name (cards.json dirs → buff directions). */
export const DIR_MAP = Object.freeze({ direct: 'front', left: 'frontLeft', right: 'frontRight', ownLeft: 'left', ownRight: 'right' });
/** Original direction name → catalog direction name (`self` has no catalog name). */
export const DIR_MAP_BACK = Object.freeze({ front: 'direct', frontLeft: 'left', frontRight: 'right', left: 'ownLeft', right: 'ownRight' });

/** [ext] Target scopes for buffs that act on a set of cards instead of directions. */
export const SCOPES = Object.freeze({
  own_cards: 'every living own card',
  opponent_cards: 'every living opposing card',
  all_cards: 'every living card on both sides',
  each_side: 'the pick is made once on the own side and once on the opponent side (Bouncer)',
});
/** [ext] Pick rules for scope buffs. */
export const PICKS = Object.freeze(['highest_attack', 'lowest_attack', 'random']);
/** [ext] filter keys. */
export const FILTER_KEYS = Object.freeze(['tribe', 'offensive', 'excludeSelf', 'hasAbility']);
/** Fields that make a buff an extension (must carry `ext: true`). */
export const EXT_FIELDS = Object.freeze(['strengthPercent', 'cap', 'nextRound', 'pick', 'count', 'scope', 'filter', 'baseAttack',
  'unreflectable', 'triggerDirection', 'damagedBySelf', 'strengthFromEvent']);
const BUFF_KEYS = ['type', 'strength', 'strengthPercent', 'cap', 'directions', 'scope', 'filter', 'pick', 'count', 'event', 'eventData',
  'nextRound', 'emptyReduction', 'perTarget', 'baseAttack', 'unreflectable', 'triggerDirection', 'damagedBySelf', 'strengthFromEvent', 'ext'];

const NEEDS_STRENGTH = ['raise_attack', 'raise_hp', 'raise_player_hp', 'increment_attack', 'heal', 'heal_player', 'self_damage',
  'deal_damage_to_all_opponent_cards', 'deal_damage_to_opponent_player', 'deal_damage_to_player', 'wheel'];
const NEEDS_PERCENT = ['bonus_attack', 'heal_boost_percent', 'reduce_ability_attack_percent', 'gamble'];
const NO_STRENGTH = ['no_buff', 'invulnerable', 'no_damage', 'attack', 'reflect_damage', 'reflect_damage_to_player', 'die', 'resurrect',
  'kill', 'resurrect_allies', 'swap_stats_random', 'stun_pattern'];
const CARD_TARGET = ['no_buff', 'raise_attack', 'raise_hp', 'increment_attack', 'invulnerable', 'no_damage', 'heal', 'attack', 'bonus_attack',
  'reflect_damage', 'reflect_damage_to_player', 'resurrect', 'die'];
const NO_DIRECTIONS = ['raise_player_hp', 'heal_player', 'self_damage', 'deal_damage_to_all_opponent_cards', 'deal_damage_to_player', 'kill',
  'resurrect_allies', 'swap_stats_random', 'wheel', 'gamble', 'heal_boost_percent', 'reduce_ability_attack_percent', 'stun_pattern'];
const EVENT_MODE = ['onDamage', 'onDeath', 'onHeal'];

const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const isPosInt = (n) => Number.isInteger(n) && n > 0;

/**
 * True when a buff uses an extension type, event or field.
 * @param {object} b
 * @returns {boolean}
 */
export function isExtensionBuff(b) {
  if (!isObj(b)) return false;
  if (BUFF_TYPES[b.type] && BUFF_TYPES[b.type].ext) return true;
  if (EVENTS[b.event] && EVENTS[b.event].ext) return true;
  return EXT_FIELDS.some((k) => b[k] !== undefined);
}

/**
 * Validate one buff.
 * @param {unknown} b
 * @param {string} where prefix for error messages
 * @returns {string[]}
 */
function validateBuff(b, where) {
  const errors = [];
  const err = (m) => errors.push(`${where}: ${m}`);
  if (!isObj(b)) return [`${where}: buff must be an object`];
  for (const k of Object.keys(b)) if (!BUFF_KEYS.includes(k)) err(`unknown buff field "${k}"`);
  if (typeof b.type !== 'string' || !BUFF_TYPES[b.type]) { err(`unknown buff type "${b.type}"`); return errors; }
  if (b.type === 'die') err('die is implicit and must not be stored');
  // directions
  if (!Array.isArray(b.directions)) err('directions must be an array');
  else {
    for (const d of b.directions) if (!DIRECTIONS.includes(d)) err(`unknown direction "${d}"`);
    if (new Set(b.directions).size !== b.directions.length) err('duplicate directions');
  }
  const dirs = Array.isArray(b.directions) ? b.directions : [];
  // event / eventData
  if (typeof b.event !== 'string' || !EVENTS[b.event]) err(`unknown event "${b.event}"`);
  else if (['round_eq', 'round_ge', 'round_le'].includes(b.event)) {
    if (!isPosInt(b.eventData)) err(`${b.event} needs a positive integer eventData`);
  } else if (EVENT_MODE.includes(b.event)) {
    if (b.eventData !== undefined && b.eventData !== 'self' && b.eventData !== 'opponent_cards') err(`${b.event} eventData must be "self", "opponent_cards" or absent`);
    if (b.event === 'onHeal' && b.eventData !== 'self') err('onHeal needs eventData "self"');
  } else if (b.eventData !== undefined) err(`${b.event} takes no eventData`);
  const isEvent = EVENT_MODE.includes(b.event);
  // strengths
  if (b.strength !== undefined && b.strength !== 'value' && !isNum(b.strength)) err('strength must be "value" or a number');
  if (b.strengthPercent !== undefined && b.strengthPercent !== 'value' && !isNum(b.strengthPercent)) err('strengthPercent must be "value" or a number');
  if (b.strength !== undefined && b.strengthPercent !== undefined) err('strength and strengthPercent are exclusive');
  if (b.strengthFromEvent !== undefined) {
    if (b.strengthFromEvent !== true) err('strengthFromEvent must be true');
    if (!['onHeal', 'onDamage'].includes(b.event)) err('strengthFromEvent needs an onHeal/onDamage event');
    if (b.strength !== undefined || b.strengthPercent !== undefined) err('strengthFromEvent excludes strength');
  }
  const hasStrength = b.strength !== undefined || b.strengthPercent !== undefined || b.strengthFromEvent === true;
  if (NEEDS_STRENGTH.includes(b.type) && !hasStrength) err(`${b.type} needs a strength`);
  if (NEEDS_PERCENT.includes(b.type) && b.strengthPercent === undefined) err(`${b.type} needs strengthPercent`);
  if (NO_STRENGTH.includes(b.type) && hasStrength) err(`${b.type} takes no strength`);
  if (b.strengthPercent !== undefined && !['raise_attack', 'increment_attack', ...NEEDS_PERCENT].includes(b.type)) err(`strengthPercent is not allowed on ${b.type}`);
  // cap / emptyReduction / unreflectable / baseAttack
  if (b.cap !== undefined) {
    if (b.cap !== 'value' && !(isNum(b.cap) && b.cap > 0)) err('cap must be "value" or a positive number');
    if (!['reflect_damage', 'reflect_damage_to_player'].includes(b.type)) err('cap is only allowed on reflect buffs');
  }
  if (b.emptyReduction !== undefined && (!Number.isInteger(b.emptyReduction) || b.type !== 'attack')) err('emptyReduction must be an integer on an attack buff');
  if (b.unreflectable !== undefined && (b.unreflectable !== true || !['attack', 'deal_damage_to_all_opponent_cards'].includes(b.type))) err('unreflectable must be true on attack / deal_damage_to_all_opponent_cards');
  if (b.baseAttack !== undefined && (b.baseAttack !== true || b.strengthPercent === undefined)) err('baseAttack must be true and needs strengthPercent');
  // scope / filter / pick / count
  if (b.scope !== undefined) {
    if (!SCOPES[b.scope]) err(`unknown scope "${b.scope}"`);
    if (dirs.length) err('a scope buff has no directions');
  }
  if (b.filter !== undefined) {
    if (!isObj(b.filter) || Object.keys(b.filter).length === 0) err('filter must be a non-empty object');
    else {
      for (const [k, v] of Object.entries(b.filter)) {
        if (!FILTER_KEYS.includes(k)) err(`unknown filter "${k}"`);
        else if (k === 'tribe' ? !TRIBE_ORDER.includes(v) : v !== true) err(`filter.${k} is invalid`);
      }
    }
    if (b.scope === undefined && dirs.length === 0) err('filter needs a scope or directions');
  }
  if (b.pick !== undefined) {
    if (!PICKS.includes(b.pick)) err(`unknown pick "${b.pick}"`);
    if (b.scope === undefined) err('pick needs a scope');
    if (!isPosInt(b.count)) err('pick needs a positive integer count');
  } else if (b.count !== undefined) err('count needs a pick');
  if (b.type === 'kill' && (b.pick === undefined || b.event !== 'round_eq')) err('kill needs pick/count/scope and a round_eq event');
  if (b.type === 'swap_stats_random' && b.pick !== 'random') err('swap_stats_random needs pick "random"');
  // directions by type
  if (CARD_TARGET.includes(b.type) && b.scope === undefined && dirs.length === 0) err(`${b.type} needs directions`);
  if (NO_DIRECTIONS.includes(b.type) && dirs.length) err(`${b.type} takes no directions`);
  if (b.type === 'deal_damage_to_opponent_player' && dirs.length && !isEvent) err('directions on deal_damage_to_opponent_player are only a target check for event buffs');
  if (['reflect_damage', 'reflect_damage_to_player'].includes(b.type) && (b.event !== 'onDamage' || dirs.join() !== 'self')) err(`${b.type} must be onDamage with directions [self]`);
  if (b.type === 'resurrect' && (b.event !== 'onDeath' || b.eventData !== 'self' || dirs.join() !== 'self')) err('resurrect must be onDeath/self with directions [self]');
  if (b.type === 'resurrect_allies' && (b.event !== 'onDeath' || b.eventData !== 'self')) err('resurrect_allies must be onDeath/self');
  if (b.type === 'bonus_attack' && !isEvent) err('bonus_attack needs an event');
  // event-only fields
  for (const k of ['nextRound', 'damagedBySelf']) {
    if (b[k] !== undefined && (b[k] !== true || !isEvent)) err(`${k} must be true on an event buff`);
  }
  if (b.damagedBySelf !== undefined && b.event !== 'onDeath') err('damagedBySelf needs onDeath');
  if (b.triggerDirection !== undefined && (!DIRECTIONS.includes(b.triggerDirection) || b.triggerDirection === 'self' || !isEvent)) err('triggerDirection must be a non-self direction on an event buff');
  // perTarget
  if (b.perTarget !== undefined) {
    if (b.perTarget !== true) err('perTarget must be true');
    if (!['heal', 'raise_hp', 'raise_attack'].includes(b.type)) err('perTarget is only for heal / raise_hp / raise_attack');
    if (dirs.length === 0 || b.strength === undefined) err('perTarget needs directions and a strength');
  }
  // ext flag consistency
  const ext = isExtensionBuff(b);
  if (ext && b.ext !== true) err('extension buff must carry ext: true');
  if (!ext && b.ext !== undefined) err('ext is only allowed on extension buffs');
  return errors;
}

/**
 * Validate one (non-byStage) ability entry.
 * @param {unknown} a
 * @param {string} where
 * @returns {string[]}
 */
function validateEntry(a, where) {
  const errors = [];
  if (!isObj(a)) return [`${where}: ability must be an object or null`];
  for (const k of Object.keys(a)) if (!['text', 'buffs', 'notes'].includes(k)) errors.push(`${where}: unknown ability field "${k}"`);
  if (!Array.isArray(a.buffs)) errors.push(`${where}: buffs must be an array`);
  else a.buffs.forEach((b, i) => errors.push(...validateBuff(b, `${where}.buffs[${i}]`)));
  if (typeof a.text !== 'string' || a.text.trim() === '') errors.push(`${where}: missing text`);
  else {
    const bad = (a.text.match(/\{[^}]*\}/g) || []).filter((p) => p !== '{v}' && p !== '{pct}');
    if (bad.length) errors.push(`${where}: unknown placeholder(s) ${bad.join(', ')}`);
    if (/_{2,}/.test(a.text)) errors.push(`${where}: text still contains a blank "____"`);
    const buffs = Array.isArray(a.buffs) ? a.buffs.filter(isObj) : [];
    const usesValue = buffs.some((b) => b.strength === 'value' || b.cap === 'value');
    const usesPct = buffs.some((b) => b.strengthPercent === 'value');
    if (a.text.includes('{v}') && !usesValue) errors.push(`${where}: text has {v} but no buff uses strength/cap "value"`);
    if (a.text.includes('{pct}') && !usesPct) errors.push(`${where}: text has {pct} but no buff uses strengthPercent "value"`);
  }
  if (a.notes !== undefined && typeof a.notes !== 'string') errors.push(`${where}: notes must be a string`);
  return errors;
}

/**
 * Validate an ability entry (null, ability object, or {byStage:[...]}).
 * @param {unknown} ability
 * @returns {string[]} list of error strings; empty when valid
 */
export function validateAbility(ability) {
  if (ability === null || ability === undefined) return [];
  if (!isObj(ability)) return ['ability must be an object or null'];
  if (ability.byStage !== undefined) {
    const errors = [];
    for (const k of Object.keys(ability)) if (!['byStage', 'notes'].includes(k)) errors.push(`unknown ability field "${k}" next to byStage`);
    if (!Array.isArray(ability.byStage) || ability.byStage.length !== 5) return [...errors, 'byStage must be an array of exactly 5 entries'];
    ability.byStage.forEach((st, i) => { if (st !== null) errors.push(...validateEntry(st, `byStage[${i}]`)); });
    if (!ability.byStage.some((st) => st && Array.isArray(st.buffs) && st.buffs.length > 0)) errors.push('byStage must contain at least one stage with buffs');
    if (ability.notes !== undefined && typeof ability.notes !== 'string') errors.push('notes must be a string');
    return errors;
  }
  return validateEntry(ability, 'ability');
}

/**
 * Return the entry that applies at a fusion stage (0–4). Non-evolving abilities are returned unchanged.
 * @param {object|null|undefined} ability
 * @param {number} [stage=0]
 * @returns {object|null}
 */
export function abilityForStage(ability, stage = 0) {
  if (!ability) return null;
  if (Array.isArray(ability.byStage)) {
    const s = Math.min(Math.max(Number(stage) || 0, 0), ability.byStage.length - 1);
    return ability.byStage[s] || null;
  }
  return ability;
}

/**
 * True when the ability (at the given stage) has at least one buff (trainers and flavour-only stages have none).
 * @param {object|null|undefined} ability
 * @param {number} [stage=0]
 * @returns {boolean}
 */
export function hasAbility(ability, stage = 0) {
  const a = abilityForStage(ability, stage);
  return !!(a && Array.isArray(a.buffs) && a.buffs.length > 0);
}

/**
 * Format an integer with thousands separators ("12,345"). Non-finite → "?".
 * @param {number} n
 * @returns {string}
 */
export function formatValue(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '?';
  const neg = n < 0;
  const abs = Math.abs(n);
  const [int, frac] = String(Number.isInteger(abs) ? abs : Math.round(abs * 10) / 10).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + grouped + (frac ? '.' + frac : '');
}

/**
 * Render the display text of an ability with `{v}` replaced by the formatted value and `{pct}` by the percent.
 * @param {object|null|undefined} ability entry from abilities.json (plain or byStage)
 * @param {number|null|undefined} value the card's ability value at its level (a percent for percent cards)
 * @param {number} [stage=0] fusion stage for evolving abilities
 * @returns {string} empty string when there is no ability
 */
export function renderAbilityText(ability, value, stage = 0) {
  const a = abilityForStage(ability, stage);
  if (!a || typeof a.text !== 'string') return '';
  const v = (typeof value === 'number' && Number.isFinite(value)) ? value : null;
  return a.text
    .replace(/\{v\}/g, v === null ? '?' : formatValue(v))
    .replace(/\{pct\}/g, v === null ? '?%' : `${formatValue(v)}%`);
}

/**
 * Every distinct buff type used by an ability entry (all stages; the implicit attack is not included).
 * @param {object|null|undefined} ability
 * @returns {string[]}
 */
export function effectTypesOf(ability) {
  if (!ability) return [];
  const list = Array.isArray(ability.byStage) ? ability.byStage : [ability];
  const types = new Set();
  for (const a of list) if (a && Array.isArray(a.buffs)) for (const b of a.buffs) if (b && b.type) types.add(b.type);
  return [...types];
}

/**
 * Catalog direction names → original buff directions (unknown names are dropped, order kept).
 * @param {string[]} catalogDirs e.g. ['left', 'direct', 'ownLeft']
 * @returns {string[]} e.g. ['frontLeft', 'front', 'left']
 */
export function toOriginalDirs(catalogDirs) {
  return (Array.isArray(catalogDirs) ? catalogDirs : []).map((d) => DIR_MAP[d]).filter(Boolean);
}

/**
 * Original buff directions → catalog direction names in canonical order (`self` is dropped).
 * @param {string[]} originalDirs
 * @returns {string[]}
 */
export function toCatalogDirs(originalDirs) {
  const set = new Set((Array.isArray(originalDirs) ? originalDirs : []).map((d) => DIR_MAP_BACK[d]).filter(Boolean));
  return CATALOG_DIRECTIONS.filter((d) => set.has(d));
}

/**
 * Catalog-named directions in which the ability acts at a stage (blue arrows): the union of the directions of every
 * non-attack buff (`self` and scope buffs contribute nothing).
 * @param {object|null|undefined} ability
 * @param {number} [stage=0]
 * @returns {string[]} subset of left, direct, right, ownLeft, ownRight in canonical order
 */
export function effectDirs(ability, stage = 0) {
  const a = abilityForStage(ability, stage);
  if (!a || !Array.isArray(a.buffs)) return [];
  const dirs = [];
  for (const b of a.buffs) if (b && b.type !== 'attack' && Array.isArray(b.directions)) dirs.push(...b.directions);
  return toCatalogDirs(dirs);
}

const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * Concrete buff list of a card at a stage, ready for the engine:
 * deep copies with every "value" strength / cap / strengthPercent replaced by `abilityValue` (the percent itself for
 * percent cards), perTarget strengths multiplied by the number of directions (and the flag removed), and the implicit
 * attack buff `{ type: 'attack', directions: <card dirs in original names>, event: 'always' }` prepended unless the
 * entry has an explicit attack buff or the card has no attack direction.
 * @param {object|null|undefined} ability entry from abilities.json (plain or byStage)
 * @param {number} [stage=0]
 * @param {number|null} [abilityValue] the card's ability value at its level (null/undefined → 0)
 * @param {string[]} [cardDirs] catalog direction names of the card (cards.json `dirs`)
 * @returns {object[]}
 */
export function buffsForStage(ability, stage = 0, abilityValue = null, cardDirs = []) {
  const a = abilityForStage(ability, stage);
  const value = (typeof abilityValue === 'number' && Number.isFinite(abilityValue)) ? abilityValue : 0;
  const out = [];
  let overridesAttack = false;
  for (const src of (a && Array.isArray(a.buffs)) ? a.buffs : []) {
    if (!isObj(src)) continue;
    const b = clone(src);
    if (b.strength === 'value') b.strength = value;
    if (b.cap === 'value') b.cap = value;
    if (b.strengthPercent === 'value') b.strengthPercent = value;
    if (b.perTarget) {
      if (typeof b.strength === 'number' && Array.isArray(b.directions)) b.strength *= b.directions.length;
      delete b.perTarget;
    }
    if (b.type === 'attack') overridesAttack = true;
    out.push(b);
  }
  const dirs = toOriginalDirs(cardDirs);
  if (!overridesAttack && dirs.length) out.unshift({ type: 'attack', directions: dirs, event: 'always' });
  return out;
}
