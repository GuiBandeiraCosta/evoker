'use strict';

/**
 * Race ("tribe") bonus of the original simulator (docs/design/original-engine.md §6).
 *
 * Evaluated once per side at the start of round 1: count the neutral cards `n` and the cards per main
 * race. The bonus applies when exactly one main race is present and its count is `> n`. Any other mix
 * (two main races, only neutrals, neutrals >= race count) gives nothing. The player's hp is multiplied
 * by 1.2 (rounded).
 */

/** Max-hp multiplier granted by the race bonus (original client: `hp * 1.2`). */
export const TRIBE_BONUS_MULT = 1.2;

/**
 * Normalised tribe name of a card ('neutral' for missing/unknown values).
 * @param {{tribe?: string, race?: string}|null|undefined} card
 * @returns {string}
 */
export function tribeOf(card) {
  const t = card && (card.tribe || card.race);
  return t ? String(t).toLowerCase() : 'neutral';
}

/**
 * Original race-bonus rule: exactly one non-neutral race, and more cards of it than neutral cards.
 * 5 cards: 5/0, 4/1, 3/2 - 4 cards: 4/0, 3/1 - 3 cards: 3/0, 2/1 - 2 cards: 2/0 - 1 card: 1/0.
 *
 * @param {Array<{tribe?: string, race?: string}|null|undefined>} cards  slots, empty ones may be null
 * @returns {boolean}
 */
export function hasTribeBonus(cards) {
  const counts = new Map();
  let neutral = 0;
  for (const card of cards || []) {
    if (!card) continue;
    const t = tribeOf(card);
    if (t === 'neutral') neutral++;
    else counts.set(t, (counts.get(t) || 0) + 1);
  }
  if (counts.size !== 1) return false;
  const [count] = counts.values();
  return count > neutral;
}

/**
 * The tribe that earns the bonus, or null.
 * @param {Array<{tribe?: string, race?: string}|null|undefined>} cards
 * @returns {string|null}
 */
export function bonusTribe(cards) {
  if (!hasTribeBonus(cards)) return null;
  const c = (cards || []).find((x) => x && tribeOf(x) !== 'neutral');
  return c ? tribeOf(c) : null;
}
