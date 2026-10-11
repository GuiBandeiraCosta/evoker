'use strict';
/**
 * Builds the `cardView` objects that src/ui/components/card.js renders, from game data:
 *  - cardView(instance, cardDef, opts)   an owned card (collection, deck, training, fusion, detail)
 *  - defView(cardDef, stage, level, opts) a catalog card without an instance (boosters, collections, boss intro)
 *  - battleView(battleCard, cardDef)      a card inside a fight (engine BattleCard → view)
 *  - artUrlFor(cardDef, stage)            URL of the stage art, falling back to the base art
 *
 * All functions are pure and DOM-free so they can be unit-tested in Node.
 */
import { statsAt, capFor, cardXpToNext } from '../core/stats.js';
import { renderAbilityText, abilityForStage, hasAbility, effectDirs as abilityEffectDirs, toCatalogDirs } from '../core/abilities.js';
import { CARD_ART_BASE } from './dom.js';

/** Buff types drawn with the green heal arrow (card_arrow01); every other non-attack buff gets the blue arrow. */
const HEAL_BUFF_TYPES = Object.freeze(['heal', 'heal_boost_percent', 'wheel']);

/**
 * URL of a card's art for a fusion stage (stage art falls back to the base art, then null).
 * @param {object} cardDef  card definition from data/cards.json
 * @param {number} [stage=0]
 * @returns {string|null}
 */
export function artUrlFor(cardDef, stage = 0) {
  const art = (cardDef && cardDef.art) || {};
  const file = art[String(stage | 0)] || art['0'];
  return file ? CARD_ART_BASE + encodeURIComponent(file) : null;
}

/**
 * Directions in which the card's ability acts (catalog names: direct/left/right/ownLeft/ownRight), the union of
 * the directions of every non-attack buff at the stage (src/core/abilities.js effectDirs).
 * @param {object} cardDef
 * @param {number} stage
 * @returns {string[]}
 */
export function effectDirs(cardDef, stage = 0) {
  return abilityEffectDirs(cardDef && cardDef.ability, stage);
}

/**
 * Directions of the heal buffs at the stage (green arrows).
 * @param {object} cardDef
 * @param {number} stage
 * @returns {string[]}
 */
export function healDirsFor(cardDef, stage = 0) {
  const a = abilityForStage(cardDef && cardDef.ability, stage);
  if (!a || !Array.isArray(a.buffs)) return [];
  const dirs = [];
  for (const b of a.buffs) if (b && HEAL_BUFF_TYPES.includes(b.type) && Array.isArray(b.directions)) dirs.push(...b.directions);
  return toCatalogDirs(dirs);
}

/**
 * Directions of the other (non-heal, non-attack) buffs at the stage (blue arrows).
 * @param {object} cardDef
 * @param {number} stage
 * @returns {string[]}
 */
export function buffDirsFor(cardDef, stage = 0) {
  const heal = new Set(healDirsFor(cardDef, stage));
  return effectDirs(cardDef, stage).filter((d) => !heal.has(d));
}

/**
 * Ability text with the current value filled in ("" when the card has no ability at this stage).
 * @param {object} cardDef
 * @param {number} stage
 * @param {number|null} value
 * @returns {string}
 */
function abilityTextFor(cardDef, stage, value) {
  const ab = cardDef && cardDef.ability;
  if (!hasAbility(ab, stage)) return cardDef && cardDef.trainer ? renderAbilityText(ab, null, stage) : '';
  return renderAbilityText(ab, value, stage);
}

/**
 * View of a catalog card at a given stage/level (no owned instance).
 * @param {object} cardDef
 * @param {number} [stage=0]
 * @param {number} [level=1]
 * @param {object} [opts]  extra fields merged into the view (uid, locked, xp...)
 * @returns {object} cardView
 */
export function defView(cardDef, stage = 0, level = 1, opts = {}) {
  const s = Math.max(0, Math.min(4, stage | 0));
  const cap = capFor(cardDef, s);
  const lvl = Math.max(1, Math.min(cap, level | 0 || 1));
  const q = typeof opts.evolveQuality === 'number' ? opts.evolveQuality : 1;
  const st = statsAt(cardDef, s, lvl, q);
  const abilityValue = st.ability == null ? null : st.ability;
  return {
    cardId: cardDef.id,
    id: cardDef.id,
    name: cardDef.name,
    tribe: cardDef.tribe,
    rarity: cardDef.rarity,
    set: cardDef.set,
    stage: s,
    level: lvl,
    levelCap: cap,
    attack: st.attack,
    hp: st.hp,
    maxHp: st.hp,
    abilityValue,
    abilityText: abilityTextFor(cardDef, s, abilityValue),
    abilityIsPercent: Boolean(cardDef.abilityIsPercent),
    mana: cardDef.mana,
    dirs: cardDef.dirs.slice(),
    healDirs: healDirsFor(cardDef, s),
    buffDirs: buffDirsFor(cardDef, s),
    artUrl: artUrlFor(cardDef, s),
    artFallbackUrl: artUrlFor(cardDef, 0),
    pips: s + 1,
    xp: 0,
    xpToNext: cardXpToNext(cardDef, lvl, s),
    ...opts,
  };
}

/**
 * View of an owned card instance.
 * @param {{uid: string, cardId: string, stage: number, level: number, xp: number, evolveQuality?: number}} inst
 * @param {object} cardDef
 * @param {object} [opts]
 * @returns {object} cardView
 */
export function cardView(inst, cardDef, opts = {}) {
  return defView(cardDef, inst.stage, inst.level, {
    uid: inst.uid,
    xp: inst.xp || 0,
    evolveQuality: typeof inst.evolveQuality === 'number' ? inst.evolveQuality : 1,
    ...opts,
  });
}

/**
 * View of a card inside a fight (engine BattleCard). Current hp/attack come from the battle state.
 * @param {object} bc  BattleCard from src/engine/battle-state.js
 * @param {object} cardDef
 * @param {object} [opts]
 * @returns {object} cardView
 */
export function battleView(bc, cardDef, opts = {}) {
  const s = bc.stage | 0;
  const abilityValue = bc.abilityValue == null ? null : bc.abilityValue;
  return {
    cardId: bc.cardId,
    id: bc.cardId,
    uid: bc.instanceId || bc.uid,
    name: bc.name || cardDef.name,
    tribe: bc.tribe || cardDef.tribe,
    rarity: bc.rarity || cardDef.rarity,
    stage: s,
    level: bc.level,
    levelCap: capFor(cardDef, s),
    attack: bc.attack,
    hp: bc.hp,
    maxHp: bc.maxHp,
    abilityValue,
    abilityText: abilityTextFor(cardDef, s, abilityValue),
    mana: cardDef.mana,
    dirs: Array.isArray(bc.dirs) ? bc.dirs.slice() : [...(bc.dirs || [])],
    healDirs: healDirsFor(cardDef, s),
    buffDirs: buffDirsFor(cardDef, s),
    artUrl: artUrlFor(cardDef, s),
    artFallbackUrl: artUrlFor(cardDef, 0),
    pips: s + 1,
    ...opts,
  };
}
