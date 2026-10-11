'use strict';
/**
 * Pure helpers of the Shop and Booster-opening screens: the original token sprites of the packs, the 3×3 grid
 * model of a booster (ui.screens.booster.openbooster_def), the set progress plate and the rarity glow.
 * DOM-free (tests/shop.test.js, tests/economy-ui.test.js).
 */

/**
 * Original token sprite (assets/orig/ui) of a booster pack: bronze disc, silver square, gold hexagon; the portal
 * packs have no client sprite (their tokens were server images) and draw a CSS triangle instead (null here).
 * @param {string} kind
 * @returns {string|null}
 */
export function tokenSpriteFor(kind) {
  return { neophyte: 'token_small', summoner: 'token_medium', archmage: 'token_big' }[kind] || null;
}

/**
 * Model of the nine grid cells: face-down cells carry the price of the next pick (token "1" or gem price,
 * openbooster_screen getCostsFromBoosterData), drawn cells their card id.
 * @param {{cards: string[], drawn: number[]}} booster
 * @param {{type: 'token'|'gems', amount: number}} payment  from pickPayment
 * @returns {Array<{position: number, row: number, col: number, drawn: boolean, cardId: string|null, cost: {type: string, amount: number}|null}>}
 */
export function boosterGrid(booster, payment) {
  const cards = (booster && booster.cards) || [];
  const drawn = new Set((booster && booster.drawn) || []);
  return cards.map((cardId, position) => {
    const isDrawn = drawn.has(position);
    return {
      position, row: Math.floor(position / 3), col: position % 3, drawn: isDrawn,
      cardId: isDrawn ? cardId : null,
      cost: isDrawn ? null : { type: payment.type, amount: payment.amount },
    };
  });
}

/**
 * Whether every card of the booster has been drawn (then "Do you want to open a new booster?").
 * @param {{cards: string[], drawn: number[]}|null} booster
 * @returns {boolean}
 */
export function boosterFinished(booster) {
  return Boolean(booster && booster.cards.length && booster.drawn.length >= booster.cards.length);
}

/**
 * Width of the "Card added to set" progress bar (0..100 %).
 * @param {number} owned
 * @param {number} total
 * @returns {number}
 */
export function setProgressPercent(owned, total) {
  if (!(total > 0)) return 0;
  return Math.round(Math.max(0, Math.min(1, owned / total)) * 1000) / 10;
}

/**
 * Glow colour variable name for a rarity (used by the reveal animation).
 * @param {string} rarity
 * @returns {string}
 */
export function rarityGlowVar(rarity) {
  const known = ['common', 'standard', 'uncommon', 'rare', 'heroic', 'legendary', 'ultimate'];
  return `var(--r-${known.includes(rarity) ? rarity : 'common'})`;
}

/**
 * @param {string} s
 * @returns {string}
 */
export function capitalize(s) {
  const str = String(s || '');
  return str.charAt(0).toUpperCase() + str.slice(1);
}
