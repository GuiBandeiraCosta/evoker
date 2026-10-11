/**
 * @file Stat formulas: stat growth per stage/level (architecture §3.2), XP curves, sell value,
 * fusion cost, sacrifice XP and the evolve bonus (game-design §2–3). Pure functions, memoised.
 */
import {
  RARITIES, MAX_STAGE, FUSION_RESET_FACTOR, BAD_CAP_FACTOR, GROWTH_EXPONENT, EVOLVE_BONUS,
  PLAYER_XP_CURVE, CARD_XP_CURVE, SACRIFICE, TRAINER_XP, MAX_PLAYER_LEVEL, ENHANCE_PRICE,
} from './constants.js';

/**
 * @typedef {object} CardDef   a card from data/cards.json (see architecture §3.1)
 * @property {string} id
 * @property {string} rarity
 * @property {number} mana
 * @property {{attack: number, hp: number, ability: number|null}} base
 * @property {number[]} caps
 * @property {{attack: (number|null)[], hp: (number|null)[], ability: (number|null)[]}} growth
 * @property {boolean} [abilityIsPercent]
 * @property {boolean} [abilityFlat]   legacy alias of flat: ['ability']
 * @property {string[]} [flat]         stats that never grow with level: the value is growth[stat][stage]
 *                                     when the wiki lists one for the stage, else the base value
 * @property {boolean} [trainer]
 */

/**
 * True when `stat` is a flat (non-growing) stat of the card (Scrapmaster's attack 1, Blood Spitter's
 * self-damage 100, Bone Dragon's per-stage attack).
 * @param {CardDef} card
 * @param {'attack'|'hp'|'ability'} stat
 * @returns {boolean}
 */
export function isFlatStat(card, stat) {
  if (stat === 'ability' && card.abilityFlat) return true;
  return Array.isArray(card.flat) && card.flat.includes(stat);
}

const STAT_KEYS = /** @type {const} */ (['attack', 'hp', 'ability']);

/** @type {WeakMap<object, Map<string, number>>} per-card memo of unscaled stat values and fallback scales */
const memo = new WeakMap();

/**
 * @param {string} rarity
 * @returns {import('./constants.js').RarityDef}
 */
function rarityDef(rarity) {
  const def = RARITIES[rarity];
  if (!def) throw new RangeError(`Unknown rarity "${rarity}"`);
  return def;
}

/**
 * @param {number} stage
 */
function assertStage(stage) {
  if (!Number.isInteger(stage) || stage < 0 || stage > MAX_STAGE) {
    throw new RangeError(`Invalid fusion stage ${stage}`);
  }
}

/**
 * Ratios of a stat's known cap values to the rarity's median multiplier table, growth[stat][s] / (base × M[rarity][s]).
 * Flat, percent and base-0 stats have no such ratio; a wiki cap below the stage's level-1 value is bad data (see
 * BAD_CAP_FACTOR) and is skipped.
 * @param {CardDef} card
 * @param {'attack'|'hp'|'ability'} stat
 * @returns {number[]}
 */
function knownRatios(card, stat) {
  const base = card.base[stat];
  if (!(base > 0) || isFlatStat(card, stat) || (stat === 'ability' && card.abilityIsPercent)) return [];
  const growth = card.growth && card.growth[stat];
  if (!Array.isArray(growth)) return [];
  const table = rarityDef(card.rarity).growth;
  const out = [];
  growth.forEach((v, s) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < base * FUSION_RESET_FACTOR ** s) return;
    out.push(v / (base * table[s]));
  });
  return out;
}

/**
 * Scale applied to the rarity multiplier when a cap value is unknown: the median of the stat's own known ratios
 * (knownRatios), else of the card's other growing stats (attack, hp and ability grow by the same factor on nearly
 * every card), else 1. A partly known card is thus filled along its own curve rather than the rarity average
 * (round 4: median error of filled caps 5 % → 2 %). Memoised in the card's map under "scale|<stat>".
 * @param {CardDef} card
 * @param {'attack'|'hp'|'ability'} stat
 * @param {Map<string, number>} perCard
 * @returns {number}
 */
function fallbackScale(card, stat, perCard) {
  const key = `scale|${stat}`;
  let scale = perCard.get(key);
  if (scale !== undefined) return scale;
  let ratios = knownRatios(card, stat);
  if (!ratios.length) ratios = STAT_KEYS.filter((s) => s !== stat).flatMap((s) => knownRatios(card, s));
  if (ratios.length) {
    const sorted = ratios.slice().sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    scale = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  } else {
    scale = 1;
  }
  perCard.set(key, scale);
  return scale;
}

/**
 * Level cap of a card at a fusion stage (card.caps wins over the rarity table).
 * @param {CardDef} card
 * @param {number} stage 0..4
 * @returns {number}
 */
export function capFor(card, stage) {
  assertStage(stage);
  const own = card.caps && card.caps[stage];
  return Number.isFinite(own) ? own : rarityDef(card.rarity).caps[stage];
}

/**
 * Unscaled stat value (before the evolve bonus), computed per architecture §3.2.
 * @param {CardDef} card
 * @param {'attack'|'hp'|'ability'} stat
 * @param {number} stage
 * @param {number} level
 * @param {Map<string, number>} perCard  the card's memo map (fallbackScale)
 * @returns {number}
 */
function computeRaw(card, stat, stage, level, perCard) {
  const base = card.base[stat];
  const isAbility = stat === 'ability';
  const growth = card.growth && card.growth[stat];
  // Flat stats (Blood Spitter's self-damage, Scrapmaster's attack 1) never grow with the level;
  // they may still change per fusion stage when the wiki lists a stage value (Bone Dragon's attack).
  if (isFlatStat(card, stat)) {
    const stageValue = growth ? growth[stage] : null;
    return typeof stageValue === 'number' && Number.isFinite(stageValue) ? stageValue : base;
  }
  const isPercent = isAbility && card.abilityIsPercent;
  const cap = capFor(card, stage);
  const lvl = Math.min(Math.max(1, Math.floor(level)), cap);
  const t = cap > 1 ? (lvl - 1) / (cap - 1) : 0;
  let capValue = growth ? growth[stage] : null;
  if (typeof capValue !== 'number' || !Number.isFinite(capValue)) {
    // Unknown cap: the rarity's median multiplier, scaled to the card's own known checkpoints (percentages are
    // unscaled: a point-stat ratio says nothing about them).
    capValue = base * rarityDef(card.rarity).growth[stage] * (isPercent ? 1 : fallbackScale(card, stat, perCard));
  }
  // Base 0 (Cursed Stag, Bouncer attack): grow from 0 to the stage's cap value when the wiki lists one.
  if (base === 0) return capValue > 0 ? Math.round(capValue * t ** GROWTH_EXPONENT) : 0;
  // Percentages (Djinn, Medusa, Dark Mage, Wizard Apprentice) restart each stage at the base
  // percentage: the ×1.15 fusion reset only applies to point values.
  const start = isPercent ? base : base * FUSION_RESET_FACTOR ** stage;
  if (start > capValue) capValue = start * BAD_CAP_FACTOR;
  const raw = start + (capValue - start) * t ** GROWTH_EXPONENT;
  return isPercent ? Math.round(raw * 10) / 10 : Math.round(raw);
}

/**
 * Value of a stat for a card at a fusion stage and level.
 * @param {CardDef} card
 * @param {'attack'|'hp'|'ability'} stat
 * @param {number} stage 0..4
 * @param {number} level 1..cap (clamped)
 * @param {number} [evolveQuality=1] the instance's evolve bonus (1 since round 5; older fusions stored 0.75..1)
 * @returns {number|null} null when the card has no such stat (ability null)
 */
export function statAt(card, stat, stage, level, evolveQuality = 1) {
  if (!card || !card.base) throw new TypeError('statAt: card with base stats required');
  const base = card.base[stat];
  if (base == null) return null;
  assertStage(stage);
  let perCard = memo.get(card);
  if (!perCard) {
    perCard = new Map();
    memo.set(card, perCard);
  }
  const key = `${stat}|${stage}|${level}`;
  let raw = perCard.get(key);
  if (raw === undefined) {
    raw = computeRaw(card, stat, stage, level, perCard);
    perCard.set(key, raw);
  }
  if (evolveQuality === 1 || isFlatStat(card, stat)) return raw;
  const scaled = raw * evolveQuality;
  return stat === 'ability' && card.abilityIsPercent ? Math.round(scaled * 10) / 10 : Math.round(scaled);
}

/** @param {CardDef} card @param {number} stage @param {number} level @param {number} [q] */
export function attackAt(card, stage, level, q = 1) {
  return statAt(card, 'attack', stage, level, q) ?? 0;
}

/** @param {CardDef} card @param {number} stage @param {number} level @param {number} [q] */
export function hpAt(card, stage, level, q = 1) {
  return statAt(card, 'hp', stage, level, q) ?? 0;
}

/** @param {CardDef} card @param {number} stage @param {number} level @param {number} [q] */
export function abilityAt(card, stage, level, q = 1) {
  return statAt(card, 'ability', stage, level, q);
}

/**
 * All three stats at once.
 * @param {CardDef} card @param {number} stage @param {number} level @param {number} [q]
 * @returns {{attack:number, hp:number, ability:number|null}}
 */
export function statsAt(card, stage, level, q = 1) {
  return { attack: attackAt(card, stage, level, q), hp: hpAt(card, stage, level, q), ability: abilityAt(card, stage, level, q) };
}

/**
 * Card XP needed to go from `level` to `level + 1`: max(20, round(40 × mana × level^1.5 / 10)), and for an unfused
 * Common or Standard card at least CARD_XP_CURVE.low (105 for level 1, 180 from level 2: the tutorial video's card
 * levels; its fused Throat-Cutter+ reached level 2 after two fights, so fused cards keep the plain curve).
 * @param {CardDef} card
 * @param {number} level
 * @param {number} [stage]  fusion stage of the instance (0 = unfused)
 * @returns {number}
 */
export function cardXpToNext(card, level, stage = 0) {
  const { k, exp, div, min, low, lowRarities } = CARD_XP_CURVE;
  const l = Math.max(1, level);
  const curve = Math.max(min, Math.round((k * card.mana * l ** exp) / div));
  if (!lowRarities.includes(card.rarity) || stage > 0) return curve;
  return Math.max(curve, low[Math.min(Math.floor(l), low.length) - 1]);
}

/**
 * Player XP needed to go from `level` to `level + 1`: round(50 × level^0.875), levels 1–4 from PLAYER_XP_CURVE.low
 * (47, 47, 92, 94: the tutorial video's level-ups).
 * Returns Infinity at the level cap.
 * @param {number} level
 * @returns {number}
 */
export function playerXpToNext(level) {
  if (level >= MAX_PLAYER_LEVEL) return Infinity;
  const { k, exp, low } = PLAYER_XP_CURVE;
  const lv = Math.max(1, Math.floor(level));
  if (low && lv <= low.length) return low[lv - 1];
  return Math.round(k * Math.max(1, level) ** exp);
}

/**
 * Gold obtained by selling a card: k × mana × (base + level + perFusion × stage) by rarity.
 * @param {CardDef} card
 * @param {number} stage
 * @param {number} level
 * @returns {number}
 */
export function sellValue(card, stage, level) {
  assertStage(stage);
  const { k, base, perFusion } = rarityDef(card.rarity).sell;
  return Math.round(k * card.mana * (base + Math.max(1, level) + perFusion * stage));
}

/**
 * Gold cost of fusing two cards of `rarity` at `stage` into stage + 1.
 * @param {string|CardDef} rarity rarity id or a card
 * @param {number} stage 0..3
 * @returns {number}
 */
export function fusionCost(rarity, stage) {
  const id = typeof rarity === 'string' ? rarity : rarity.rarity;
  if (!Number.isInteger(stage) || stage < 0 || stage >= MAX_STAGE) {
    throw new RangeError(`Cannot fuse from stage ${stage}`);
  }
  return rarityDef(id).fusionCosts[stage];
}

/**
 * XP granted by sacrificing a card: 25 × mana × (level + 2) × rarityFactor; trainer cards give
 * their fixed XP. (The fusion stage does not change the yield, per game-design §2.4.)
 * @param {CardDef} card
 * @param {number} stage
 * @param {number} level
 * @returns {number}
 */
export function sacrificeXp(card, stage, level) {
  assertStage(stage);
  if (TRAINER_XP[card.id] != null) return TRAINER_XP[card.id];
  const { k, levelOffset } = SACRIFICE;
  return Math.round(k * card.mana * (Math.max(1, level) + levelOffset) * rarityDef(card.rarity).sacrificeFactor);
}

/**
 * Gold price of sacrificing one card in a training session, ported from the client's
 * game.cardmanager.getEnhancePrice with the fitted server config (constants ENHANCE_PRICE):
 * ceil((mana × 25 + (level − 1) × 50) × (1 + raritySellFactor / 10) × 2). The operation order follows the
 * client, so float rounding matches it (a level-1 2-mana Common costs 111, not 110). Fusion stage is ignored.
 * @param {CardDef} card  the sacrificed card
 * @param {number} level  its level
 * @returns {number}
 */
export function enhancePrice(card, level) {
  const c = ENHANCE_PRICE;
  const sellFactor = c.raritySellFactor[card.rarity];
  if (sellFactor == null) throw new RangeError(`Unknown rarity "${card.rarity}"`);
  let price = (Number(card.mana) || 0) * c.costManaFactor;
  price = price + (Math.max(1, level || 1) - 1) * c.costLevelFactor;
  price = price * (1 + sellFactor / c.costRarityDivisor);
  price = price * c.rarityEnhanceFactor;
  return Math.ceil(price);
}

/**
 * Evolve bonus of a fusion: EVOLVE_BONUS.base + EVOLVE_BONUS.span × avg(level / cap) of the two inputs, at most 1
 * (round 5: base 1, span 0, i.e. always 1 — the tutorial video's level-1 fusion shows the full stage-1 stats).
 * @param {number} l1 level of the first card
 * @param {number} cap1 its level cap
 * @param {number} l2
 * @param {number} cap2
 * @returns {number}
 */
export function evolveQuality(l1, cap1, l2, cap2) {
  const r1 = Math.min(1, Math.max(0, l1 / cap1));
  const r2 = Math.min(1, Math.max(0, l2 / cap2));
  const q = EVOLVE_BONUS.base + EVOLVE_BONUS.span * ((r1 + r2) / 2);
  return Math.round(q * 10000) / 10000;
}
