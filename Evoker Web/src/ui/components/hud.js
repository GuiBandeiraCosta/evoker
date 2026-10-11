'use strict';
/**
 * Top HUD, ported from the 1.7.4 client's status bar (ui.components.hud.statusbar_def / statusbar_comp):
 *  - the "?" help button on the left. The Android client (the user's reference screenshots) has no back
 *    button (the hardware key goes back) and draws "?" on the big menubar plate (menubar_button_frame +
 *    fill, x -124); the iOS client shows the back.png arrow (x -140) next to a smaller "?" on the backbutton
 *    plate (x -108) whenever going back is possible. `showBack` selects the iOS variant (sub-screens),
 *  - the resource bar (resourcebar_frame + resourcebar_fill_active, x -14: "Lvl" + star + level, XP line,
 *    stamina / mana with their potion counts); the whole bar is the `playerinfoBtn` that opens the profile,
 *  - the money bar (moneybar_frame + moneybar_fill_active with the coin, gem and green plus, x 112: gold and
 *    gems); the whole bar is the shop button (the gem packs, premiumshop overlay).
 * Stable hooks: `.hud-help`, `.hud-back`, `.hud-center` (profile), `.hud-res.stamina .val`, `.hud-res.mana .val`,
 * `.hud-wallet .row.gold .num`, `.hud-wallet .row.gems .num`, `.hud-plus` (shop).
 * The element exposes update(patch) and data like before.
 */
import { h, sprite, fmt, keyActivate } from '../dom.js';
import { progressBar } from './bars.js';

/**
 * @typedef {object} HudData
 * @property {number} level
 * @property {number} xp
 * @property {number} xpToNext
 * @property {number} stamina
 * @property {number} staminaMax
 * @property {number} staminaPotions
 * @property {number} mana
 * @property {number} manaMax
 * @property {number} manaPotions
 * @property {number} gold
 * @property {number} gems
 */

/**
 * @typedef {object} HudHandlers
 * @property {() => void} [onBack]
 * @property {() => void} [onHelp]
 * @property {() => void} [onShop]
 * @property {() => void} [onProfile]  tap on the level / stamina / mana bar (opens the profile)
 * @property {boolean} [showBack]  draw the back arrow (iOS layout) instead of the big "?" plate
 * @property {boolean} [backDisabled]
 */

/**
 * Set a stamina / mana label; longer values ("93/200", "200/200") get a smaller size so they stay inside the bar.
 * @param {HTMLElement} el
 * @param {string} text
 */
function setVal(el, text) {
  el.textContent = text;
  el.classList.toggle('long', text.length === 6);
  el.classList.toggle('xlong', text.length >= 7);
}

/**
 * Render the HUD.
 * @param {HudData} data
 * @param {HudHandlers} [handlers]
 * @returns {HTMLElement & {update: (data: Partial<HudData>) => void, data: HudData}}
 */
export function renderHud(data, handlers = {}) {
  const state = { ...data };
  const xpBar = progressBar({ value: state.xp, max: state.xpToNext, kind: 'xp', label: null, fillBottom: true, className: 'hud-bar' });
  const lvlNum = h('span.lvl-num.num', null, String(state.level));
  const staminaPot = h('span.potions.num', null, String(state.staminaPotions));
  const staminaVal = h('span.val.num');
  const staminaBar = progressBar({ value: state.stamina, max: state.staminaMax, kind: 'stamina', label: null, fillBottom: true, className: 'hud-bar' });
  const manaPot = h('span.potions.num', null, String(state.manaPotions));
  const manaVal = h('span.val.num');
  const manaBar = progressBar({ value: state.mana, max: state.manaMax, kind: 'mana', label: null, fillBottom: true, className: 'hud-bar' });
  const goldVal = h('span.num');
  const gemsVal = h('span.num');
  const showBack = Boolean(handlers.showBack);

  const el = /** @type {any} */ (h('div.hud', { class: showBack ? 'with-back' : 'no-back' },
    h('button.hud-btn.hud-back', {
      type: 'button', 'aria-label': 'Back', title: 'Back', hidden: !showBack,
      disabled: Boolean(handlers.backDisabled), onClick: handlers.onBack,
    }, sprite('back', { class: 'hud-btn-icon' })),
    h('button.hud-btn.hud-help', { type: 'button', 'aria-label': 'Help', title: 'Help', onClick: handlers.onHelp },
      sprite('help_icon_active', { class: 'hud-btn-icon' })),
    h('div.hud-center', {
      role: 'button', tabIndex: 0, title: 'Profile', 'aria-label': 'Level, stamina and mana: open the profile',
      onClick: handlers.onProfile, onKeydown: keyActivate(handlers.onProfile),
    },
    h('div.hud-level', null,
      h('span.lvl-label', null, 'Lvl'),
      lvlNum,
      xpBar),
    h('div.hud-resources', null,
      h('div.hud-res.stamina', { title: 'Stamina' }, staminaPot, staminaVal, staminaBar),
      h('div.hud-res.mana', { title: 'Mana' }, manaPot, manaVal, manaBar))),
    h('div.hud-right', null,
      h('div.hud-wallet', null,
        h('div.row.gold', null, goldVal),
        h('div.row.gems', null, gemsVal)),
      h('button.hud-plus', { type: 'button', 'aria-label': 'Shop', title: 'Shop', onClick: handlers.onShop }))));

  el.data = state;
  el.update = (patch) => {
    Object.assign(state, patch);
    lvlNum.textContent = String(state.level);
    xpBar.update(state.xp, state.xpToNext, null);
    staminaPot.textContent = String(state.staminaPotions);
    setVal(staminaVal, `${fmt(state.stamina)}/${fmt(state.staminaMax)}`);
    staminaBar.update(state.stamina, state.staminaMax, null);
    manaPot.textContent = String(state.manaPotions);
    setVal(manaVal, `${fmt(state.mana)}/${fmt(state.manaMax)}`);
    manaBar.update(state.mana, state.manaMax, null);
    goldVal.textContent = fmt(state.gold);
    gemsVal.textContent = fmt(state.gems);
    el.classList.toggle('low-stamina', state.staminaMax > 0 && state.stamina / state.staminaMax < 0.1);
    el.classList.toggle('low-mana', state.manaMax > 0 && state.mana / state.manaMax < 0.1);
  };
  el.update({});
  return el;
}
