'use strict';
/**
 * Buttons on the original sprites: `.btn` is button_default_frame + fill (green / danger / inactive fills as
 * variants, stitched by exploration/tools/make-frames.py into assets/orig/ui/frames/button_*.png and drawn with
 * border-image), icon buttons are the same plate, the "Attack!" bar is attackbutton01 over
 * attackbuttonornament01 (the flames), tabs are hud_bigbutton04 plates on tab_background.
 */
import { h, icon, sprite } from '../dom.js';

/**
 * @typedef {object} ButtonOptions
 * @property {(ev: MouseEvent) => void} [onClick]
 * @property {'steel'|'green'|'red'|'grey'} [variant='steel']
 * @property {'sm'|'md'|'lg'} [size='md']
 * @property {boolean} [block]
 * @property {boolean} [disabled]
 * @property {string} [icon]  icon name (assets/ui svg) drawn before the label
 * @property {string} [sprite]  original sprite name (assets/orig/ui) drawn instead of `icon`
 * @property {string} [className]
 * @property {string} [title]
 * @property {string} [type='button']
 */

/**
 * Steel button.
 * @param {string|Node} label
 * @param {ButtonOptions} [opts]
 * @returns {HTMLButtonElement}
 */
export function button(label, opts = {}) {
  const variant = opts.variant && opts.variant !== 'steel' ? `btn-${opts.variant}` : '';
  const size = opts.size && opts.size !== 'md' ? `btn-${opts.size}` : '';
  const glyph = opts.sprite ? sprite(opts.sprite, { class: 'btn-glyph' }) : (opts.icon ? icon(opts.icon, { class: 'btn-glyph' }) : null);
  return /** @type {HTMLButtonElement} */ (h('button.btn', {
    class: [variant, size, opts.block && 'btn-block', opts.className],
    type: opts.type || 'button',
    disabled: Boolean(opts.disabled),
    title: opts.title,
    onClick: opts.onClick,
  }, glyph, label));
}

/**
 * Square icon button (back, help, close, magnifier, $...). `opts.sprite` draws an original sprite instead of
 * the svg icon named by `iconName` (the class list still carries the icon name).
 * @param {string} iconName
 * @param {ButtonOptions & {label?: string, ariaLabel?: string}} [opts]
 * @returns {HTMLButtonElement}
 */
export function iconButton(iconName, opts = {}) {
  const variant = opts.variant && opts.variant !== 'steel' ? `btn-${opts.variant}` : '';
  const size = opts.size && opts.size !== 'md' ? `btn-${opts.size}` : '';
  return /** @type {HTMLButtonElement} */ (h('button.btn.btn-icon', {
    class: [variant, size, `btn-${iconName}`, opts.className],
    type: 'button',
    disabled: Boolean(opts.disabled),
    title: opts.title || opts.ariaLabel || opts.label,
    'aria-label': opts.ariaLabel || opts.label || iconName,
    onClick: opts.onClick,
  }, opts.sprite ? sprite(opts.sprite, { class: 'icon' }) : icon(iconName), opts.label ? h('span.btn-label', null, opts.label) : null));
}

/**
 * The flaming "Attack!" bar (full width): attackbuttonornament01 behind the attackbutton01 plate.
 * @param {{label?: string, onClick?: (ev: MouseEvent) => void, disabled?: boolean}} [opts]
 * @returns {HTMLElement & {button: HTMLButtonElement, setDisabled: (d: boolean) => void}}
 */
export function attackBar(opts = {}) {
  const btn = button(opts.label || 'Attack!', { onClick: opts.onClick, disabled: opts.disabled, className: 'attack-btn' });
  const el = /** @type {any} */ (h('div.attack-bar', null,
    sprite('attackbuttonornament01', { class: 'attack-ornament', 'aria-hidden': 'true' }),
    btn));
  el.button = btn;
  el.setDisabled = (d) => { btn.disabled = d; };
  return el;
}

/**
 * Tab bar (Arena / Pieces / Replays).
 * @param {{id: string, label: string}[]} tabs
 * @param {{active?: string, onSelect?: (id: string) => void}} [opts]
 * @returns {HTMLElement & {setActive: (id: string) => void, active: string}}
 */
export function tabBar(tabs, opts = {}) {
  const el = /** @type {any} */ (h('div.tabbar', { role: 'tablist' }));
  const buttons = new Map();
  el.active = opts.active || (tabs[0] && tabs[0].id);
  el.setActive = (id) => {
    el.active = id;
    for (const [tid, b] of buttons) {
      b.classList.toggle('active', tid === id);
      b.setAttribute('aria-selected', tid === id ? 'true' : 'false');
    }
  };
  for (const tab of tabs) {
    const b = h('button.tab', {
      type: 'button', role: 'tab', dataset: { tab: tab.id },
      onClick: () => { el.setActive(tab.id); if (opts.onSelect) opts.onSelect(tab.id); },
    }, tab.label);
    buttons.set(tab.id, b);
    el.appendChild(b);
  }
  el.setActive(el.active);
  return el;
}

/**
 * Paging arrows (left / right) used by list headers: the original back_icon_active arrow, mirrored for right.
 * @param {'left'|'right'} dir
 * @param {ButtonOptions} [opts]
 * @returns {HTMLButtonElement}
 */
export function arrowButton(dir, opts = {}) {
  const b = iconButton('back', { ...opts, sprite: 'back_icon_active', ariaLabel: dir === 'left' ? 'Previous' : 'Next' });
  b.classList.add(dir === 'left' ? 'arrow-left' : 'arrow-right');
  if (dir === 'right') b.querySelector('img').style.transform = 'scaleX(-1)';
  return b;
}
