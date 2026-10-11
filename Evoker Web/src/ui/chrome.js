'use strict';
/**
 * Screen chrome (architecture 8.2): the top HUD and the bottom nav every menu screen mounts, fed from
 * the store; the Drink-potion flow shared by the screens that spend stamina/mana.
 *
 * Like the 1.7.4 client (ui.components.hud.statusbar_comp / menubar_comp):
 *  - the main tabs (quest map, arena, league, cards, shop) have no back arrow (the Android client's layout:
 *    "?" alone on the big plate; Escape is the hardware back key); sub-screens pushed on top of them (quest,
 *    pre-battle, card detail, album, profile, options, help...) get the iOS layout with the back arrow,
 *  - the level / stamina / mana bar opens the profile (playerinfo_screen), the money bar the gem packs,
 *  - the middle nav button opens the quest map itself; the landing page (feed) is the Home button of the
 *    extended menu (and the login landing),
 *  - nav badges per menubar_comp (see nav.js navBadges).
 */
import { h } from './dom.js';
import { renderHud } from './components/hud.js';
import { renderNav, navBadges, NAV_ITEMS, lockedNavItems, navLockHint } from './components/nav.js';
import { dialog } from './components/dialog.js';
import { toast } from './components/toast.js';
import { hudData } from './store.js';
import { needsPotion, drinkPotion, buyAndDrinkPotion, potionPrice } from '../game/player.js';
import { fusionCandidates } from '../game/fusion.js';
import { albumNewCards } from '../game/shop.js';

/** How long a mounted HUD / nav that never reached the document is kept refreshed (ms). */
const ORPHAN_MS = 15000;

/** Screens the nav opens directly: no back arrow there (statusbar on Android, the user's reference). */
export const MAIN_SCREENS = Object.freeze(['quest-map', 'arena', 'league', 'cards', 'shop']);

/** quest-map params of the middle nav button (the main map) and of the extended menu's Home button (the feed). */
const QUEST_MAP_PARAMS = Object.freeze({});
const HOME_PARAMS = Object.freeze({ feed: true });
/** Nav buttons with the "!" badge of navBadges() (the cards button has its own: "!" or deck_full). */
const BADGE_KEYS = ['league', 'arena', 'extend', 'profile', 'album'];

/**
 * Whether a screen shows the back arrow: every screen but the main tabs; a main tab's sub-view (params.view,
 * e.g. the league info page) is a pushed screen too.
 * @param {string} screenId
 * @param {{back?: boolean|Function, hideNav?: boolean}} opts  chrome.mount options
 * @param {object} [params]  the screen's params
 * @returns {boolean}
 */
export function showsBackArrow(screenId, opts = {}, params = {}) {
  if (opts.back === false || opts.back === undefined) return false;
  if (opts.hideNav) return true;
  if (params && params.view) return true;
  return !MAIN_SCREENS.includes(screenId);
}

/**
 * Where a nav / extended-menu button goes: `{how: 'top'|'go', id, params}`.
 * @param {string} id  nav id (league, arena, quest, cards, shop, album, profile, options, home)
 * @returns {{how: 'top'|'go', id: string, params: object}}
 */
export function navTarget(id) {
  switch (id) {
    case 'quest': return { how: 'top', id: 'quest', params: { ...QUEST_MAP_PARAMS } };
    case 'home': return { how: 'top', id: 'quest', params: { ...HOME_PARAMS } };
    case 'album': return { how: 'go', id: 'collections', params: {} };
    case 'profile': return { how: 'go', id: 'character', params: { tab: 'profile' } };
    case 'options': return { how: 'go', id: 'character', params: { tab: 'settings' } };
    default: return { how: 'top', id, params: {} };
  }
}

/**
 * Offer a potion for a bar that is (or would be) too low. Opens the Drink-potion dialog and applies the
 * choice through the store. Resolves true when the bar was refilled.
 * @param {object} ctx  ScreenContext
 * @param {'stamina'|'mana'} kind
 * @param {number} [amount]  points the action needs (0 = just show the dialog)
 * @returns {Promise<boolean>}
 */
export async function offerPotion(ctx, kind, amount = 0) {
  const state = ctx.store.get();
  if (!state) return false;
  const event = ctx.event();
  const np = needsPotion(state, kind, amount, event);
  const choice = await dialog.drinkPotion({ kind, count: np.potions, gemPrice: np.price, gems: state.player.gems });
  if (choice === 'use') {
    ctx.store.update((s) => drinkPotion(s, kind));
    toast(`${kind === 'mana' ? 'Mana' : 'Stamina'} refilled!`, { icon: kind === 'mana' ? 'potion-blue' : 'potion-orange' });
    return true;
  }
  if (choice === 'buy') {
    const price = potionPrice(event);
    if (state.player.gems < price) { toast('Not enough gems', { icon: 'gem' }); return false; }
    ctx.store.update((s) => buyAndDrinkPotion(s, kind, event));
    toast(`Potion bought and used (-${price} gems)`, { icon: 'gem' });
    return true;
  }
  return false;
}

/**
 * Create the chrome controller. `mount(ctx, opts)` appends the HUD and nav to `ctx.root`; `refresh()`
 * re-reads the store into every mounted HUD/nav still in the document.
 * @param {{store: object, deps: object, goTop: (id: string, params?: object) => void}} app
 * @returns {{mount: (ctx: object, opts?: object) => {hud: HTMLElement, nav: HTMLElement}, refresh: () => void}}
 */
export function createChrome(app) {
  /** @type {Set<{hud: HTMLElement|null, nav: any}>} */
  const mounted = new Set();
  const badgesOf = (state) => navBadges(state, { fusionCandidates: (s) => fusionCandidates(s, app.deps), albumNew: (s) => albumNewCards(s, app.deps) });
  /** Show navBadges() on a nav. */
  const paintBadges = (nav, b) => {
    for (const k of BADGE_KEYS) nav.setBadge(k, b[k]);
    nav.setBadge('cards', b.cards === 'full' ? 'full' : b.cards === 'new');
  };

  /**
   * @param {object} ctx
   * @param {{active?: string, back?: boolean|Function, help?: string, hideNav?: boolean, hideHud?: boolean}} [opts]
   */
  function mount(ctx, opts = {}) {
    const state = app.store.get();
    const entry = { hud: null, nav: null, shown: false, born: Date.now() };
    const onBack = typeof opts.back === 'function' ? opts.back : () => ctx.back('quest-map');
    // Escape (src/app.js) closes the extended menu first, then follows the screen's back handler
    // (null = nothing to go back to).
    const escape = opts.back === false ? null : onBack;
    ctx.root._onBack = () => {
      if (entry.nav && entry.nav.extended && entry.nav.extended()) { entry.nav.setExtended(false); return; }
      if (escape) escape();
    };
    if (!opts.hideHud) {
      entry.hud = renderHud(state ? hudData(state, app.deps.stats) : emptyHud(), {
        onBack,
        showBack: showsBackArrow(ctx.screenId, opts, ctx.params),
        onHelp: () => ctx.go('help', { topic: opts.help || ctx.screenId }),
        onShop: () => app.goTop('shop', { gems: true }), // the money bar opens the gem packs (premiumshop)
        onProfile: () => openProfile(ctx),
      });
      ctx.root.appendChild(entry.hud);
    } else {
      ctx.root.classList.add('no-hud');
    }
    if (!opts.hideNav) {
      entry.nav = renderNav({
        active: opts.active === 'character' ? ((ctx.params && ctx.params.tab) === 'settings' ? 'options' : 'profile') : opts.active,
        locked: lockedNavItems(state),
        onSelect: (id) => select(ctx, id),
        onLocked: (id, item) => toast(navLockHint(app.store.get(), item), { icon: 'lock' }),
      });
      paintBadges(entry.nav, badgesOf(state));
      ctx.root.appendChild(entry.nav);
    } else {
      ctx.root.classList.add('no-nav');
    }
    mounted.add(entry);
    return { hud: entry.hud, nav: entry.nav };
  }

  /** The profile (playerinfo_screen), pushed over the current screen unless it is already showing. */
  function openProfile(ctx) {
    if (ctx.screenId === 'character' && (!ctx.params || !ctx.params.tab || ctx.params.tab === 'profile')) return;
    ctx.go('character', { tab: 'profile' });
  }

  /** A nav or extended-menu button. */
  function select(ctx, id) {
    const t = navTarget(id);
    if (t.how === 'go') {
      if (ctx.screenId === t.id && JSON.stringify(ctx.params || {}) === JSON.stringify(t.params)) return;
      if (ctx.screenId === t.id && ctx.replace) { ctx.replace(t.id, t.params); return; }
      ctx.go(t.id, t.params);
      return;
    }
    app.goTop(t.id, t.params);
  }

  function refresh() {
    const state = app.store.get();
    if (!state) return;
    const data = hudData(state, app.deps.stats);
    let b = null;
    let locked = null;
    for (const entry of Array.from(mounted)) {
      // A screen's chrome is mounted while the screen is built off-document (the fade transition inserts it
      // later): keep refreshing it until it has been shown, and drop it once it has left the document again
      // (or was never shown, e.g. a build superseded by another navigation).
      const alive = (entry.hud && entry.hud.isConnected) || (entry.nav && entry.nav.isConnected);
      if (alive) entry.shown = true;
      else if (entry.shown || Date.now() - entry.born > ORPHAN_MS) { mounted.delete(entry); continue; }
      if (entry.hud) entry.hud.update(data);
      if (entry.nav) {
        if (!b) b = badgesOf(state);
        paintBadges(entry.nav, b);
        if (!locked) locked = new Set(lockedNavItems(state));
        for (const item of NAV_ITEMS) entry.nav.setLocked(item.id, locked.has(item.id));
      }
    }
  }

  return { mount, refresh };
}

/** HUD data before any save exists. */
function emptyHud() {
  return { level: 1, xp: 0, xpToNext: 100, stamina: 0, staminaMax: 50, staminaPotions: 0, mana: 0, manaMax: 50, manaPotions: 0, gold: 0, gems: 0 };
}

/**
 * Standard scrollable body for a chrome screen (`.screen-body`), appended to the root.
 * @param {object} ctx
 * @param {string} [className]
 * @param {...any} children
 * @returns {HTMLElement}
 */
export function screenBody(ctx, className, ...children) {
  const body = h('div.screen-body', { class: className }, ...children);
  ctx.root.appendChild(body);
  return body;
}
