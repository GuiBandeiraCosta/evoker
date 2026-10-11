'use strict';
/**
 * Modal dialogs on the original popup sprites: popup_bg as the plate (border-image), popup_header_grey as
 * the title plate, the close button at the top-right corner (comp_default_popup_layout: cancelBtn topRight)
 * with close_icon. `open()` returns a Promise resolved with the pressed button's value (null when closed with
 * X / backdrop / Escape). Presets: confirm, alert, drinkPotion (potion_stamina1 / potion_mana1 sprites).
 */
import { h, sprite, fmt, getUiRoot } from '../dom.js';
import { button, iconButton } from './buttons.js';

/** @type {Set<HTMLElement>} */
const openDialogs = new Set();

/**
 * @typedef {object} DialogButton
 * @property {string} label
 * @property {any} value
 * @property {'steel'|'green'|'red'|'grey'} [variant]
 * @property {boolean} [autofocus]
 * @property {boolean} [disabled]
 */

/**
 * @typedef {object} DialogOptions
 * @property {string|Node} [title]
 * @property {string|Node|Node[]} [body]
 * @property {DialogButton[]} [buttons]
 * @property {boolean} [closable=true]  show the X button and close on backdrop / Escape
 * @property {string} [className]
 * @property {boolean} [titleOrange]
 */

/**
 * Open a dialog.
 * @param {DialogOptions} opts
 * @returns {Promise<any> & {close: (value?: any) => void, el: HTMLElement}}
 */
export function open(opts = {}) {
  const closable = opts.closable !== false;
  let resolveFn;
  const promise = /** @type {any} */ (new Promise((resolve) => { resolveFn = resolve; }));
  let settled = false;

  const backdrop = h('div.dialog-backdrop', { role: 'dialog', 'aria-modal': 'true' });
  const close = (value = null) => {
    if (settled) return;
    settled = true;
    openDialogs.delete(backdrop);
    backdrop.classList.add('closing');
    window.removeEventListener('keydown', onKey, true);
    setTimeout(() => backdrop.remove(), 230);
    resolveFn(value);
  };
  const onKey = (ev) => {
    if (openDialogs.size && Array.from(openDialogs).pop() !== backdrop) return;
    if (ev.key === 'Escape' && closable) { ev.preventDefault(); ev.stopPropagation(); close(null); }
    if (ev.key === 'Enter') {
      const primary = (opts.buttons || []).find((b) => b.autofocus) || (opts.buttons || [])[0];
      if (primary && !primary.disabled) { ev.preventDefault(); ev.stopPropagation(); close(primary.value); }
    }
  };

  const buttons = (opts.buttons || []).map((b) => button(b.label, {
    variant: b.variant, disabled: b.disabled, onClick: () => close(b.value),
  }));
  const box = h('div.dialog.panel', { class: opts.className },
    closable ? iconButton('close', { sprite: 'close_icon', className: 'dialog-close', ariaLabel: 'Close', onClick: () => close(null) }) : null,
    opts.title ? h('div.dialog-title.plate', { class: opts.titleOrange !== false && 'orange' }, opts.title) : null,
    opts.body ? h('div.dialog-body', null, opts.body) : null,
    buttons.length ? h('div.dialog-buttons', null, buttons) : null);
  backdrop.appendChild(box);
  backdrop.addEventListener('click', (ev) => { if (ev.target === backdrop && closable) close(null); });
  // closeAll(): drop the keyboard handler with the dialog (the promise stays pending)
  backdrop.addEventListener('forceclose', () => { settled = true; window.removeEventListener('keydown', onKey, true); }, { once: true });
  getUiRoot().appendChild(backdrop);
  openDialogs.add(backdrop);
  window.addEventListener('keydown', onKey, true);
  const focusTarget = buttons[(opts.buttons || []).findIndex((b) => b.autofocus)] || buttons[0];
  if (focusTarget) setTimeout(() => focusTarget.focus({ preventScroll: true }), 30);

  promise.close = close;
  promise.el = backdrop;
  return promise;
}

/**
 * Yes/No confirmation.
 * @param {{title?: string, message: string|Node, okLabel?: string, cancelLabel?: string, danger?: boolean}} opts
 * @returns {Promise<boolean>}
 */
export async function confirm(opts) {
  const value = await open({
    title: opts.title || 'Confirm',
    body: opts.message,
    buttons: [
      { label: opts.cancelLabel || 'Cancel', value: false, variant: 'grey' },
      { label: opts.okLabel || 'OK', value: true, variant: opts.danger ? 'red' : 'steel', autofocus: true },
    ],
  });
  return value === true;
}

/**
 * Simple message with one button.
 * @param {{title?: string, message: string|Node, okLabel?: string}} opts
 * @returns {Promise<void>}
 */
export async function alert(opts) {
  await open({ title: opts.title, body: opts.message, buttons: [{ label: opts.okLabel || 'OK', value: true, autofocus: true }] });
}

/**
 * The "Drink potion" dialog like the original (Evoker-drink-potion.jpg): left column with the potion sprite
 * (potion_stamina1 orange / potion_mana1 blue) and the "3 potions" plate, right column with the message and
 * "Use potion now" or, with no potions left, "Buy for N gems". Resolves 'use' | 'buy' | null.
 * @param {{kind: 'stamina'|'mana', count: number, gemPrice?: number, gems?: number}} opts
 * @returns {Promise<'use'|'buy'|null> & {close: (v?: any) => void, el: HTMLElement}}
 */
export function drinkPotion(opts) {
  const kind = opts.kind === 'mana' ? 'mana' : 'stamina';
  const label = kind === 'mana' ? 'Mana' : 'Stamina';
  const count = Math.max(0, opts.count | 0);
  const price = opts.gemPrice || 40;
  const canBuy = typeof opts.gems !== 'number' || opts.gems >= price;
  const dlg = open({
    title: 'Drink potion',
    className: 'dialog-potion',
    buttons: [],
  });
  const body = dlg.el.querySelector('.dialog');
  let actionBtn;
  if (count > 0) {
    actionBtn = button('Use potion now', { onClick: () => dlg.close('use'), size: 'md' });
  } else {
    actionBtn = button(h('span.gem-price', null, `Buy for ${fmt(price)}`, sprite('hud_gemiconsingle', { class: 'icon' })), { onClick: () => dlg.close('buy'), disabled: !canBuy, variant: 'green' });
  }
  body.appendChild(h('div.dialog-columns', null,
    h('div.dialog-col.panel-inset', null,
      sprite(kind === 'mana' ? 'potion_mana1' : 'potion_stamina1', { class: ['potion-img', kind === 'mana' && 'blue'] }),
      h('div.potion-count.plate', null, `${count} potion${count === 1 ? '' : 's'}`)),
    h('div.dialog-col.panel-inset', null,
      h('p.msg', null, count > 0
        ? `Your ${label} is too low. Would you like to use one of your ${label} potions?`
        : `Your ${label} is too low and you have no ${label} potions left. Buy one for ${fmt(price)} gems?`),
      actionBtn)));
  setTimeout(() => actionBtn.focus({ preventScroll: true }), 30);
  return dlg;
}

/** Remove every open dialog at once (navigation): no animation, their promises stay pending. */
export function closeAll() {
  for (const d of Array.from(openDialogs)) {
    d.dispatchEvent(new CustomEvent('forceclose'));
    d.remove();
    openDialogs.delete(d);
  }
}

/** @returns {boolean} whether a dialog is open */
export function isOpen() {
  return openDialogs.size > 0;
}

export const dialog = { open, confirm, alert, drinkPotion, closeAll, isOpen };
