'use strict';
/**
 * Daily rewards model (the 21-day calendar of the character screen's daily view and the reward texts / icons
 * the quest map's daily strip and the app's daily toast use). Pure and DOM-free (tests/economy-ui.test.js).
 */
import { utcDay } from '../../game/state.js';
import { dailyRewardFor, previousDay, DAILY_REWARDS } from '../../game/shop.js';
import { capitalize } from './booster-view.js';

export const DAILY_CYCLE = DAILY_REWARDS.length;

/**
 * @typedef {object} DailyCell
 * @property {number} index     1..21 position in the calendar
 * @property {number} day       absolute streak day this cell stands for
 * @property {object} reward    entry of DAILY_REWARDS
 * @property {'claimed'|'today'|'claimed-today'|'future'} status
 */

/**
 * Build the 21-day calendar model for the Daily tab.
 * - `claimable`: the player can claim today's reward now.
 * - `nextDay`: the streak day that is (or was) claimed today.
 * - a missed day resets the streak, so the calendar shows a fresh cycle with day 1 claimable.
 * - a brand-new game (state.newGame: lastClaim = its first day, streak 0) has nothing to claim on its first day; the
 *   calendar shows day 1 as tomorrow's reward.
 * @param {{streak?: number, lastClaim?: string}|null|undefined} daily  state.daily
 * @param {number} now  ms epoch
 * @returns {{cells: DailyCell[], claimable: boolean, claimedToday: boolean, streak: number, nextDay: number, position: number, today: string, reward: object, startsTomorrow: boolean}}
 */
export function dailyCalendar(daily, now) {
  const today = utcDay(now);
  const yesterday = previousDay(today);
  const d = daily || { streak: 0, lastClaim: '' };
  const streak = Math.max(0, d.streak | 0);
  const claimedToday = d.lastClaim === today && streak > 0;
  const startsTomorrow = d.lastClaim === today && streak === 0;
  let nextDay;
  let claimable;
  let shownStreak;
  if (startsTomorrow) {
    nextDay = 1;
    claimable = false;
    shownStreak = 0;
  } else if (claimedToday) {
    nextDay = Math.max(1, streak);
    claimable = false;
    shownStreak = streak;
  } else if (d.lastClaim === yesterday && streak > 0) {
    nextDay = streak + 1;
    claimable = true;
    shownStreak = streak;
  } else {
    nextDay = 1;
    claimable = true;
    shownStreak = 0;
  }
  const cycle = Math.floor((nextDay - 1) / DAILY_CYCLE);
  const position = ((nextDay - 1) % DAILY_CYCLE) + 1;
  const cells = [];
  for (let i = 1; i <= DAILY_CYCLE; i++) {
    const day = cycle * DAILY_CYCLE + i;
    let status = 'future';
    if (i < position) status = 'claimed';
    else if (i === position) status = claimedToday ? 'claimed-today' : 'today';
    cells.push({ index: i, day, reward: dailyRewardFor(day), status });
  }
  return {
    cells, claimable, claimedToday, streak: shownStreak, nextDay, position, today,
    reward: dailyRewardFor(nextDay),
    nextReward: dailyRewardFor(claimedToday ? nextDay + 1 : nextDay),
    startsTomorrow,
  };
}

/**
 * Short human text for a daily reward entry ("2 Stamina potions", "1 Mana + 1 Stamina potion", "40 Gems",
 * "2 Neophyte tokens").
 * @param {object} reward
 * @returns {string}
 */
export function describeDailyReward(reward) {
  if (!reward) return '';
  if (reward.gems) return `${reward.gems} Gems`;
  if (reward.tokens) {
    const n = reward.count || 1;
    return `${n} ${capitalize(reward.tokens)} token${n === 1 ? '' : 's'}`;
  }
  const parts = [];
  if (reward.mana) parts.push(`${reward.mana} Mana`);
  if (reward.stamina) parts.push(`${reward.stamina} Stamina`);
  if (!parts.length) return '';
  const total = (reward.mana || 0) + (reward.stamina || 0);
  return `${parts.join(' + ')} potion${total === 1 ? '' : 's'}`;
}

/**
 * Icons (with counts) that picture a daily reward.
 * @param {object} reward
 * @returns {{icon: string, count: number}[]}
 */
export function dailyRewardIcons(reward) {
  if (!reward) return [];
  if (reward.gems) return [{ icon: 'gem', count: reward.gems }];
  if (reward.tokens) return [{ icon: tokenIconFor(reward.tokens), count: reward.count || 1 }];
  const out = [];
  if (reward.stamina) out.push({ icon: 'potion-orange', count: reward.stamina });
  if (reward.mana) out.push({ icon: 'potion-blue', count: reward.mana });
  return out;
}

/**
 * Token icon (assets/ui) for a booster or token kind.
 * @param {string} kind  neophyte | summoner | archmage | portalLow | portalHigh
 * @returns {string}
 */
export function tokenIconFor(kind) {
  return { neophyte: 'token-bronze', summoner: 'token-silver', archmage: 'token-gold', portalLow: 'token-silver', portalHigh: 'token-gold' }[kind] || 'token-bronze';
}
