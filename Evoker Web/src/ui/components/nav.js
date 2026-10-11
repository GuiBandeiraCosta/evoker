'use strict';
/**
 * Bottom navigation, ported from the 1.7.4 client's menubar (ui.components.hud.menubar_def / menubar_comp):
 *  - the hud_bottombg01 strip with five icon buttons (menubar_button_frame over menubar_button_fill_active,
 *    the shop on menubar_button_shop, the icon_*_active sprite, icon_*_glow on the current screen, the
 *    menubar_button_locked padlock plate while a feature is locked) at the client's x positions
 *    (League -128, Arena -75, Quest map -21, Cards 33, Shop 88 units from the centre),
 *  - the orange extendmenu_arrow_up button (x 136) that slides the extended menu (bottombg_extended) up over
 *    the five buttons: Album (icon_album, -95), Profile (icon_profile, -32), Options (icon_options, 32) and
 *    Home (icon_home, 95, the landing page); the arrow turns into extendmenu_arrow_down while it is open and a
 *    grey click catcher over the screen closes it,
 *  - the badges of comp_button_badge (badge.png "!", deck_full.png on the cards button when the collection is
 *    full), see navBadges().
 * Stable hooks: `.nav-btn[data-nav="league|arena|quest|cards|shop"]`, `.nav-btn.nav-extend[data-nav="extend"]`,
 * `.nav-extend-panel .nav-btn[data-nav="album|profile|options|home"]`, `.badge`, `.badge-full`.
 */
import { h, sprite, spriteUrl } from '../dom.js';
import { FEATURE_UNLOCK_LEVELS, FEATURE_UNLOCK_QUESTS, COLLECTION_LIMIT } from '../../core/constants.js';
import { isUnlocked, unlocksByQuest } from '../../game/state.js';

/**
 * Nav buttons; `feature` = the isUnlocked() feature that opens them (a tutorial game: Arena after quest 8, League
 * after quest 10; an older save: FEATURE_UNLOCK_LEVELS, Arena level 4, League level 6), `unlockLevel` = that level.
 */
/** @type {{id: string, icon: string, sprite: string, label: string, feature: string, unlockLevel: number}[]} */
export const NAV_ITEMS = [
  { id: 'league', icon: 'trophy', sprite: 'icon_liga', label: 'League', feature: 'league', unlockLevel: FEATURE_UNLOCK_LEVELS.league },
  { id: 'arena', icon: 'swords', sprite: 'icon_pvp', label: 'Arena', feature: 'arena', unlockLevel: FEATURE_UNLOCK_LEVELS.arena },
  { id: 'quest', icon: 'compass', sprite: 'icon_map', label: 'Quest map', feature: 'quests', unlockLevel: 1 },
  { id: 'cards', icon: 'cards', sprite: 'icon_deckedit', label: 'Cards', feature: 'cards', unlockLevel: 1 },
  { id: 'shop', icon: 'shop', sprite: 'icon_shop', label: 'Shop', feature: 'shop', unlockLevel: 1 },
];

/**
 * Ids of the nav buttons still locked in a save (isUnlocked per NAV_ITEMS.feature). No save: Arena and League.
 * @param {object|null} state
 * @returns {string[]}
 */
export function lockedNavItems(state) {
  if (!state || !state.player) return NAV_ITEMS.filter((i) => i.unlockLevel > 1).map((i) => i.id);
  return NAV_ITEMS.filter((i) => !isUnlocked(state, i.feature)).map((i) => i.id);
}

/**
 * Hint for a tap on a locked nav button: "Unlocks after quest 8" on a tutorial game, "Unlocks at level 4" otherwise.
 * @param {object|null} state
 * @param {{feature: string, unlockLevel: number}} item
 * @returns {string}
 */
export function navLockHint(state, item) {
  const quest = FEATURE_UNLOCK_QUESTS[item.feature];
  if (state && quest != null && unlocksByQuest(state)) return `Unlocks after quest ${quest}`;
  return `Unlocks at level ${item.unlockLevel}`;
}

/** Buttons of the extended menu (menubar_def slideBg), left to right. */
/** @type {{id: string, sprite: string, label: string}[]} */
export const EXTEND_ITEMS = [
  { id: 'album', sprite: 'icon_album', label: 'Album' },
  { id: 'profile', sprite: 'icon_profile', label: 'Profile' },
  { id: 'options', sprite: 'icon_options', label: 'Options' },
  { id: 'home', sprite: 'icon_home', label: 'Home' },
];

/**
 * Sprite name of a nav icon in a state.
 * @param {{sprite: string}} item
 * @param {'active'|'glow'|'grey'} state
 * @returns {string}
 */
export function navIconSprite(item, state) {
  return `${item.sprite}_${state}`;
}

/**
 * Badges of the menubar (menubar_comp): the cards button shows deck_full when the collection is at its cap,
 * otherwise "!" when a fusion is possible (fusion unlocked and two copies of a card outside the deck); the
 * league button shows "!" while the league is unlocked but not joined (the client: league not active); the
 * extend arrow and the profile button show "!" for unspent stat points (old saves); the album button (and the
 * extend arrow) show "!" while an owned set card has not been shown by the album yet (shop.albumNewCards, the
 * client's setsmanager new-card animations).
 * @param {object|null} state
 * @param {{fusionCandidates?: (state: object) => any[], albumNew?: (state: object) => any[]}} [helpers]
 * @returns {{cards: 'full'|'new'|null, league: boolean, arena: boolean, extend: boolean, profile: boolean, album: boolean}}
 */
export function navBadges(state, helpers = {}) {
  const out = { cards: null, league: false, arena: false, extend: false, profile: false, album: false };
  if (!state || !state.player) return out;
  const cards = Array.isArray(state.cards) ? state.cards.length : 0;
  if (cards >= COLLECTION_LIMIT) out.cards = 'full';
  else if (isUnlocked(state, 'fusion') && helpers.fusionCandidates) {
    try { if (helpers.fusionCandidates(state).length > 0) out.cards = 'new'; } catch { /* no badge */ }
  }
  const joined = state.sim && state.sim.leagueJoined;
  out.league = isUnlocked(state, 'league') && !joined;
  out.profile = (state.player.statPoints | 0) > 0;
  if (helpers.albumNew) {
    try { out.album = helpers.albumNew(state).length > 0; } catch { /* no badge */ }
  }
  out.extend = out.profile || out.album;
  return out;
}

/**
 * Normalise a list or map of ids into a Set.
 * @param {string[]|Record<string, boolean>|undefined} v
 * @returns {Set<string>}
 */
function toSet(v) {
  if (!v) return new Set();
  if (Array.isArray(v)) return new Set(v);
  return new Set(Object.keys(v).filter((k) => v[k]));
}

/**
 * @typedef {object} NavOptions
 * @property {string} [active]
 * @property {string[]|Record<string, boolean>} [locked]
 * @property {string[]|Record<string, boolean>} [badges]  ids with the "!" badge
 * @property {boolean} [cardsFull]  deck_full badge on the cards button
 * @property {number} [level]  when given, locks are derived from NAV_ITEMS.unlockLevel
 * @property {(id: string, item: object) => void} [onSelect]  a main button or an extended-menu button
 * @property {(id: string, item: object) => void} [onLocked]  tap on a locked button
 * @property {(open: boolean) => void} [onExtend]  the extended menu opened / closed
 */

/**
 * One icon button on the menubar plate.
 * @param {{id: string, sprite: string, label: string}} item
 * @param {boolean} active
 * @param {object} props
 * @returns {HTMLButtonElement}
 */
function iconBtn(item, active, props) {
  return /** @type {HTMLButtonElement} */ (h('button.nav-btn', {
    type: 'button',
    dataset: { nav: item.id },
    'aria-label': item.label,
    ...props,
    class: [item.id, active && 'active', props.class],
  }, sprite(navIconSprite(item, active ? 'glow' : 'active'), { class: 'icon nav-icon' })));
}

/**
 * Render the nav bar.
 * @param {NavOptions} [opts]
 * @returns {HTMLElement & {setActive: (id: string) => void, setLocked: (id: string, locked: boolean) => void,
 *   setBadge: (id: string, on: boolean|'full') => void, setExtended: (open: boolean) => void, extended: () => boolean}}
 */
export function renderNav(opts = {}) {
  const locked = toSet(opts.locked);
  if (typeof opts.level === 'number') for (const item of NAV_ITEMS) if (opts.level < item.unlockLevel) locked.add(item.id);
  const badges = toSet(opts.badges);
  /** @type {Map<string, HTMLButtonElement>} */
  const buttons = new Map();
  let open = false;

  const el = /** @type {any} */ (h('nav.nav', { role: 'navigation', 'aria-label': 'Main' }));
  const paintIcon = (item, b) => {
    const img = b.querySelector('.nav-icon');
    if (img) img.src = spriteUrl(navIconSprite(item, b.classList.contains('active') ? 'glow' : 'active'));
  };
  for (const item of NAV_ITEMS) {
    const isActive = opts.active === item.id;
    const b = iconBtn(item, isActive, {
      class: locked.has(item.id) && 'locked',
      'aria-current': isActive ? 'page' : undefined,
      title: item.label,
      onClick: () => {
        if (b.classList.contains('locked')) { if (opts.onLocked) opts.onLocked(item.id, item); return; }
        if (opts.onSelect) opts.onSelect(item.id, item);
      },
    });
    buttons.set(item.id, b);
    el.appendChild(b);
  }

  // extended menu (slideBg) and its click catcher
  const catcher = h('div.nav-catcher', { 'aria-hidden': 'true', onClick: () => el.setExtended(false) });
  const panel = h('div.nav-extend-panel', { role: 'menu', 'aria-label': 'More', 'aria-hidden': 'true' });
  for (const item of EXTEND_ITEMS) {
    const b = iconBtn(item, opts.active === item.id, {
      role: 'menuitem', title: item.label, tabIndex: -1,
      onClick: () => { el.setExtended(false); if (opts.onSelect) opts.onSelect(item.id, item); },
    });
    buttons.set(item.id, b);
    panel.appendChild(b);
  }
  const arrow = sprite('extendmenu_arrow_up', { class: 'nav-arrow' });
  const extendBtn = h('button.nav-btn.nav-extend', {
    type: 'button', dataset: { nav: 'extend' }, 'aria-label': 'More', title: 'More', 'aria-expanded': 'false',
    onClick: () => el.setExtended(!open),
  }, arrow);
  buttons.set('extend', /** @type {HTMLButtonElement} */ (extendBtn));
  el.append(catcher, panel, extendBtn);

  el.setExtended = (on) => {
    on = Boolean(on);
    if (on === open) return;
    open = on;
    el.classList.toggle('extended', open);
    extendBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    for (const b of panel.querySelectorAll('.nav-btn')) b.tabIndex = open ? 0 : -1;
    arrow.src = spriteUrl(open ? 'extendmenu_arrow_down' : 'extendmenu_arrow_up');
    if (opts.onExtend) opts.onExtend(open);
  };
  el.extended = () => open;

  el.setActive = (id) => {
    for (const item of [...NAV_ITEMS, ...EXTEND_ITEMS]) {
      const b = buttons.get(item.id);
      b.classList.toggle('active', item.id === id);
      if (item.id === id) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      paintIcon(item, b);
    }
  };
  el.setLocked = (id, on) => { const b = buttons.get(id); if (b) b.classList.toggle('locked', on); };
  el.setBadge = (id, on) => {
    const b = buttons.get(id);
    if (!b) return;
    const existing = b.querySelector('.badge');
    const want = on === 'full' ? 'full' : (on ? 'new' : null);
    const have = existing ? (existing.classList.contains('badge-full') ? 'full' : 'new') : null;
    if (want === have) return;
    if (existing) existing.remove();
    if (want) b.appendChild(h('span.badge', { class: want === 'full' && 'badge-full', 'aria-label': want === 'full' ? 'Collection full' : 'Attention' }, want === 'full' ? '' : '!'));
  };
  for (const id of badges) el.setBadge(id, true);
  if (opts.cardsFull) el.setBadge('cards', 'full');
  return el;
}
