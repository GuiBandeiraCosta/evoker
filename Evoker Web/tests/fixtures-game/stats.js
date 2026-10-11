'use strict';

/**
 * Stub of src/core/stats.js with the formulas from game-design.md / the brief §5.4 (simplified growth).
 */

export const RARITY_FACTOR = { common: 0.6, standard: 0.8, uncommon: 1, rare: 1.6, heroic: 2.4, legendary: 3.5, ultimate: 5 };
export const FUSION_COST = {
  common: [200, 800, 1800, 3200],
  standard: [400, 1600, 3600, 6400],
  uncommon: [900, 3600, 8100, 14400],
  rare: [1920, 7680, 17280, 30720],
  heroic: [3750, 15000, 33750, 60000],
  legendary: [7200, 28800, 64800, 115200],
  ultimate: [10780, 43120, 97020, 172480],
};
const SELL = {
  common: (M, L, F) => 5 * M * (9 + L + F),
  standard: (M, L, F) => 6.5 * M * (10 + L + 2 * F),
  uncommon: (M, L, F) => 8.5 * M * (11 + L + 4 * F),
  rare: (M, L, F) => 20 * M * (12 + L + 6 * F),
  heroic: (M, L, F) => 30 * M * (13 + L + 8 * F),
  legendary: (M, L, F) => 50 * M * (14 + L + 10 * F),
  ultimate: (M, L, F) => 55 * M * (15 + L + 12 * F),
};

export function capFor(card, stage) {
  return card.caps[Math.max(0, Math.min(4, stage | 0))];
}

export function statAt(card, stat, stage, level, evolveQuality = 1) {
  const base = card.base ? card.base[stat] : null;
  if (base == null) return stat === 'ability' ? null : 0;
  return Math.round(base * Math.pow(1.15, stage) * (1 + 0.08 * (level - 1)) * evolveQuality);
}

export function cardXpToNext(card, level) {
  return Math.max(20, Math.round((40 * card.mana * Math.pow(level, 1.5)) / 10));
}

export function playerXpToNext(level) {
  return Math.round(50 * Math.pow(level, 0.875));
}

export function sellValue(card, stage, level) {
  return Math.round(SELL[card.rarity](card.mana, level, stage));
}

export function fusionCost(rarity, stage) {
  return FUSION_COST[rarity][Math.max(0, Math.min(3, stage))];
}

export function sacrificeXp(card, stage, level) {
  return Math.round(25 * card.mana * (level + 2) * RARITY_FACTOR[card.rarity]);
}

const SELL_FACTOR = { common: 1, standard: 2, uncommon: 3, rare: 4, heroic: 5, legendary: 6, ultimate: 7 };

/** Training price of one sacrificed card (client getEnhancePrice with the round-3 fit). */
export function enhancePrice(card, level) {
  return Math.ceil((card.mana * 25 + (Math.max(1, level) - 1) * 50) * (1 + SELL_FACTOR[card.rarity] / 10) * 2);
}

/** Round 5: like src/core/stats.js, the input levels do not lower the result. */
export function evolveQuality(l1, cap1, l2, cap2) { // eslint-disable-line no-unused-vars
  return 1;
}
