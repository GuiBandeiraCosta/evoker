'use strict';

/**
 * Battle-state builders: BattleCard / FighterSide construction (architecture.md §4) and the
 * translation of card abilities into the ORIGINAL simulator's buff shape
 * (docs/design/original-engine.md §1, §3, §8).
 *
 * Direction naming:
 *   catalog (cards.json `dirs`)   direct | left | right | ownLeft | ownRight
 *   original (buff `directions`)  front  | frontLeft | frontRight | left | right | self
 */

import { hasTribeBonus, TRIBE_BONUS_MULT } from './tribe-bonus.js';
import { statAt } from '../core/stats.js';
import { abilityForStage, buffsForStage, DIR_MAP, DIRECTIONS as ORIGINAL_DIRS } from '../core/abilities.js';
import { DIRECTIONS } from '../core/constants.js';

export const SLOT_COUNT = 5;
/** Round-mode buff events (everything else is an event-mode trigger: onDamage / onDeath). */
export const ROUND_EVENTS = ['always', 'round_eq', 'round_ge', 'round_le', 'round_odd', 'round_even'];
/** Buff fields that may carry the card's ability value ("value" / "-value") instead of a number. */
const VALUE_FIELDS = ['strength', 'strengthPercent', 'cap', 'emptyReduction', 'count'];

/**
 * Default stat computation (architecture.md §4: attack/hp/abilityValue come from stats.js).
 * Callers may inject their own `computeStats` (tests, AI deck builders) through the options.
 * @type {ComputeStats}
 */
export function defaultComputeStats({ cardDef, stage, level, evolveQuality }) {
  return {
    attack: statAt(cardDef, 'attack', stage, level, evolveQuality) ?? 0,
    hp: statAt(cardDef, 'hp', stage, level, evolveQuality) ?? 0,
    ability: cardDef.base && cardDef.base.ability != null ? statAt(cardDef, 'ability', stage, level, evolveQuality) : null,
  };
}

/**
 * Does this value look like a card catalog (anything with `get(id)`: cards-db, Map) rather than a single card
 * definition or an options object?
 * @param {any} v
 * @returns {boolean}
 */
const looksLikeCardsDb = (v) => !!v && typeof v.get === 'function';

/**
 * @typedef {object} CardDef   static card definition (data/cards.json shape, see architecture.md §3.1)
 * @typedef {object} CardInstance  owned card { uid, cardId, stage, level, xp, evolveQuality }
 *
 * @typedef {object} Buff   a buff in the original simulator's naming (original-engine.md §1 / §8)
 * @property {string} type
 * @property {number} [strength]
 * @property {string[]} directions   original names (front, frontLeft, frontRight, left, right, self)
 * @property {string} event          always | round_eq | round_ge | round_le | round_odd | round_even | onDamage | onDeath
 * @property {number|string|null} [eventData]
 * @property {number} [emptyReduction]
 * @property {number} [strengthPercent]
 * @property {number} [cap]
 * @property {boolean} [nextRound]
 * @property {string} [pick]
 * @property {number} [count]
 * @property {boolean} [ext]
 *
 * @typedef {object} BattleCard
 * @property {string} instanceId
 * @property {string} cardId
 * @property {string} name
 * @property {string} tribe        dwarf | elf | orc | neutral
 * @property {string} rarity
 * @property {number} mana
 * @property {number} stage
 * @property {number} level
 * @property {number} attack       effective base attack at this stage/level (0 when the card does not attack)
 * @property {number} maxHp
 * @property {number} hp
 * @property {number} abilityValue the numeric ability value (0 when none)
 * @property {string[]} dirs       subset of direct,left,right,ownLeft,ownRight
 * @property {object|null} ability ability entry resolved for the stage ({text, buffs} or null)
 * @property {Buff[]} [buffs]      optional pre-resolved buffs (tests / tooling); when present they replace
 *                                 the buffs derived from `ability` + `dirs`
 *
 * @typedef {object} FighterPlayer
 * @property {string} name
 * @property {number} hp
 * @property {number} maxHp
 * @property {number} baseMaxHp   max hp before the tribe bonus
 * @property {boolean} tribeBonus
 * @property {number|string} [portrait]
 *
 * @typedef {object} FighterSide
 * @property {FighterPlayer} player
 * @property {Array<BattleCard|null>} cards  exactly 5 slots
 *
 * @callback ComputeStats
 * @param {{cardDef: CardDef, stage: number, level: number, evolveQuality: number}} args
 * @returns {{attack: number, hp: number, ability: number|null}}
 */

/**
 * Distinct direction names of a Set, array or comma/space-separated string, each mapped by `f` (falsy results
 * are dropped), in order.
 * @param {Iterable<string>|string|undefined|null} dirs
 * @param {(key: string) => string|null|undefined} f
 * @returns {string[]}
 */
function mapDirs(dirs, f) {
  if (!dirs) return [];
  const out = [];
  for (const d of typeof dirs === 'string' ? dirs.split(/[,\s]+/) : Array.from(dirs)) {
    const o = f(String(d).trim());
    if (o && !out.includes(o)) out.push(o);
  }
  return out;
}

/**
 * Normalise a catalog directions value (Set, array, or legacy string) to a clean array of catalog names.
 * @param {Iterable<string>|string|undefined|null} dirs
 * @returns {string[]}
 */
export function normaliseDirs(dirs) {
  return mapDirs(dirs, (key) => (DIRECTIONS.includes(key) ? key : null));
}

/**
 * Catalog direction names -> original simulator names (unknown / already-original names pass through
 * when they are valid original names, everything else is dropped).
 * @param {Iterable<string>|string|undefined|null} dirs
 * @returns {string[]}
 */
export function toOriginalDirs(dirs) {
  return mapDirs(dirs, (key) => DIR_MAP[key] || (ORIGINAL_DIRS.includes(key) ? key : null));
}

/**
 * Replace "value" / "-value" placeholders by the card's ability value.
 * @param {any} v
 * @param {number} abilityValue
 * @returns {any}
 */
function concrete(v, abilityValue) {
  if (v === 'value') return abilityValue;
  if (v === '-value') return -abilityValue;
  return v;
}

/**
 * Keep only valid original direction names (buff directions are never catalog names: `left` means the
 * own left neighbour, so no mapping may be applied here).
 * @param {Iterable<string>|string|undefined|null} dirs
 * @returns {string[]}
 */
export function originalDirs(dirs) {
  return mapDirs(dirs, (key) => (ORIGINAL_DIRS.includes(key) ? key : null));
}

/**
 * Normalise one buff to the engine's internal shape: numeric fields coerced, directions as original
 * names, event defaulting to `always`, value placeholders resolved.
 * @param {object} buff
 * @param {number} [abilityValue=0]
 * @param {string[]} [cardDirs=[]]   original-name directions of the card (for an `attack` buff without directions)
 * @returns {Buff}
 */
export function normaliseBuff(buff, abilityValue = 0, cardDirs = []) {
  const b = { ...buff };
  b.type = String(b.type);
  for (const k of VALUE_FIELDS) {
    if (b[k] === undefined || b[k] === null) continue;
    const v = concrete(b[k], abilityValue);
    b[k] = Number(v);
    if (!Number.isFinite(b[k])) b[k] = 0;
  }
  const dirs = b.directions;
  b.directions = originalDirs(dirs);
  if (b.type === 'attack' && dirs == null) b.directions = cardDirs.slice();
  if (b.perTarget) {
    // data flag: the stored strength is per target; the handler splits by #directions, so multiply back
    if (b.directions.length > 1 && typeof b.strength === 'number') b.strength *= b.directions.length;
    delete b.perTarget;
  }
  b.event = b.event ? String(b.event) : 'always';
  if (b.eventData !== undefined && b.eventData !== null && ROUND_EVENTS.includes(b.event)) b.eventData = Number(b.eventData);
  if (b.eventData === undefined) b.eventData = null;
  return b;
}

/**
 * Concrete buffs (original naming) of a card: `core/abilities.buffsForStage` (implicit attack, "value" strengths,
 * perTarget), each buff normalised (`normaliseBuff`); `none` buffs are dropped.
 * @param {object|null|undefined} ability  ability entry (raw or resolved for the stage)
 * @param {number} stage
 * @param {number} abilityValue
 * @param {string[]} cardDirs   catalog names
 * @returns {Buff[]}
 */
export function resolveBuffs(ability, stage, abilityValue, cardDirs) {
  const dirs = normaliseDirs(cardDirs);
  const value = Number(abilityValue) || 0;
  const odirs = toOriginalDirs(dirs);
  return buffsForStage(ability, stage | 0, value, dirs).filter((b) => b && b.type && b.type !== 'none').map((b) => normaliseBuff(b, value, odirs));
}

/**
 * Build a BattleCard from an owned card instance and its definition.
 * Stats come from stats.js by default (architecture.md §4); an injected `computeStats` overrides it.
 *
 * @param {CardInstance} cardInstance   { uid, cardId, stage, level, evolveQuality }
 * @param {CardDef|{get: Function}} cardDefOrDb  the card definition, or a cards catalog (`toBattleCard(instance, cardsDb)`)
 * @param {ComputeStats} [computeStats]
 * @returns {BattleCard}
 */
export function toBattleCard(cardInstance, cardDefOrDb, computeStats = defaultComputeStats) {
  const cardDef = looksLikeCardsDb(cardDefOrDb) ? cardDefOrDb.get(cardInstance && cardInstance.cardId) : cardDefOrDb;
  if (!cardDef) throw new Error(`toBattleCard: missing card definition for ${cardInstance && cardInstance.cardId}`);
  if (typeof computeStats !== 'function') throw new Error('toBattleCard: computeStats function required');
  const stage = Math.max(0, cardInstance.stage | 0);
  const level = Math.max(1, cardInstance.level | 0 || 1);
  const evolveQuality = Number.isFinite(cardInstance.evolveQuality) ? cardInstance.evolveQuality : 1;
  const stats = computeStats({ cardDef, stage, level, evolveQuality }) || {};
  const attack = Math.max(0, Math.round(Number(stats.attack) || 0));
  const hp = Math.max(1, Math.round(Number(stats.hp) || 0));
  const abilityValue = Number(stats.ability) || 0;
  return {
    instanceId: String(cardInstance.uid || cardInstance.instanceId || `${cardDef.id}#${stage}/${level}`),
    cardId: cardDef.id,
    name: cardDef.name,
    tribe: String(cardDef.tribe || 'neutral').toLowerCase(),
    rarity: cardDef.rarity || 'common',
    mana: Number(cardDef.mana) || 0,
    stage,
    level,
    attack,
    maxHp: hp,
    hp,
    abilityValue,
    dirs: normaliseDirs(cardDef.dirs),
    ability: abilityForStage(cardDef.ability, stage),
  };
}

/**
 * Is this slot entry already a BattleCard (vs. an owned instance that still needs conversion)?
 * @param {any} entry
 * @returns {boolean}
 */
function isBattleCard(entry) {
  return !!entry && Number.isFinite(entry.hp) && Number.isFinite(entry.maxHp) && (Array.isArray(entry.dirs) || Array.isArray(entry.buffs));
}

/**
 * Build a fighter side from a player-like object and 5 slots. The race bonus (×1.2, original rule) is
 * applied to `maxHp` here and recorded in `player.tribeBonus`, so the engine does not apply it again.
 *
 * @param {{name?: string, hp?: number, maxHp?: number, hpMax?: number, portrait?: any, avatar?: any}} playerLike
 * @param {Array<BattleCard|CardInstance|null|undefined>} cardsBySlot  up to 5 entries; instances are
 *        converted with the cards catalog + `computeStats` (stats.js unless injected)
 * @param {object|{computeStats?: ComputeStats, cardsDb?: any, tribeBonus?: boolean}} [cardsDbOrOptions]
 *        either the cards catalog itself (contract form `buildSide(player, deck, cardsDb)`) or an options object
 * @returns {FighterSide}
 */
export function buildSide(playerLike, cardsBySlot, cardsDbOrOptions = {}) {
  const options = looksLikeCardsDb(cardsDbOrOptions) ? { cardsDb: cardsDbOrOptions } : (cardsDbOrOptions || {});
  const computeStats = typeof options.computeStats === 'function' ? options.computeStats : defaultComputeStats;
  const p = playerLike || {};
  const cards = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const entry = (cardsBySlot || [])[i];
    if (!entry) {
      cards.push(null);
    } else if (isBattleCard(entry)) {
      cards.push({ ...entry, dirs: normaliseDirs(entry.dirs) });
    } else {
      cards.push(toBattleCard(entry, options.cardsDb && options.cardsDb.get(entry.cardId), computeStats));
    }
  }
  const baseMaxHp = Math.max(1, Math.round(Number(p.maxHp ?? p.hpMax ?? p.hp) || 1500));
  const bonus = options.tribeBonus === false ? false : hasTribeBonus(cards);
  const maxHp = bonus ? Math.round(baseMaxHp * TRIBE_BONUS_MULT) : baseMaxHp;
  return {
    player: {
      name: String(p.name || 'Player'),
      portrait: p.portrait ?? p.avatar ?? 0,
      hp: maxHp,
      maxHp,
      baseMaxHp,
      tribeBonus: bonus,
    },
    cards,
  };
}
