'use strict';
/**
 * The small event banner of the Arena and League lists (comp_promotion_banner smallBanner): title, headline,
 * "x2" badge and the h:mm:ss timer. Pure and DOM-free (tests/pvp-ui.test.js); the banner element itself is
 * built by pvp-widgets.js eventBanner.
 */

/**
 * Banner timer text "h:mm:ss" (the client's promotion timeout label, e.g. "1:06:08"); days roll into hours.
 * @param {number} ms
 * @returns {string}
 */
export function formatHms(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/** Daily events shown with the orange "x2" badge (the client's double-XP / double-PvP-points banners); shared
 * with the quest feed (quest-feed.js). */
export const DOUBLE_EVENTS = Object.freeze(['infinite-wisdom', 'double-league-points']);
/** Banner headline per daily event (1.7 banners: "INFINITE WISDOM ... DOUBLE XP FOR YOUR CARDS"); also used by the
 * quest feed's event banner. */
export const EVENT_HEADLINES = Object.freeze({
  'infinite-wisdom': 'Double XP for your cards',
  'double-league-points': 'Double PvP points',
  'drinking-contest': 'Cheap potions all day',
  'card-piece-day': 'Card pieces at half price',
  'great-potion-deal': '3 potions for 60 gems',
  'get-the-best-cards': 'Boosters 50 % off',
  'golden-day': '+50 % gold',
});
/** Card art painted behind each event banner (the server banners were painted artwork). */
export const EVENT_ART = Object.freeze({
  'infinite-wisdom': 'dwarven-sage',
  'double-league-points': 'gladiator',
  'drinking-contest': 'master-brewer',
  'card-piece-day': 'keeper-of-the-treasure',
  'great-potion-deal': 'alchemist',
  'get-the-best-cards': 'dark-mage',
  'golden-day': 'keeper-of-the-treasure',
});

/**
 * What the small event banner above the arena list shows (comp_promotion_banner smallBanner: title, headline,
 * "x2" badge, the time left until the event ends at the next UTC midnight).
 * @param {{id: string, name: string, desc?: string}|null} event
 * @returns {{id: string, title: string, headline: string, double: boolean, artCardId: string|null}|null}
 */
export function eventBannerInfo(event) {
  if (!event || !event.id) return null;
  return {
    id: event.id,
    title: String(event.name || '').toUpperCase(),
    headline: String(EVENT_HEADLINES[event.id] || event.desc || '').toUpperCase(),
    double: DOUBLE_EVENTS.includes(event.id),
    artCardId: EVENT_ART[event.id] || null,
  };
}
