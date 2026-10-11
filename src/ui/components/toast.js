'use strict';
/**
 * Toast notifications ("You received a Neophyte token!"). Stacked at the bottom of the stage.
 */
import { h, icon, getUiRoot } from '../dom.js';

let layer = null;

function getLayer() {
  const root = getUiRoot();
  if (!layer || !layer.isConnected || layer.parentNode !== root) {
    layer = h('div.toast-layer', { 'aria-live': 'polite' });
    root.appendChild(layer);
  }
  return layer;
}

/**
 * Show a toast.
 * @param {string|Node} message
 * @param {{icon?: string, duration?: number, className?: string}} [opts]
 * @returns {HTMLElement & {dismiss: () => void}}
 */
export function toast(message, opts = {}) {
  const el = /** @type {any} */ (h('div.toast', { class: opts.className, role: 'status' },
    opts.icon ? icon(opts.icon) : null, h('span', null, message)));
  el.dataset.shownAt = String(Date.now());
  getLayer().appendChild(el);
  let done = false;
  el.dismiss = () => {
    if (done) return;
    done = true;
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 250);
  };
  setTimeout(el.dismiss, opts.duration === undefined ? 2200 : opts.duration);
  return el;
}

/**
 * Remove visible toasts. With `olderThanMs`, toasts shown more recently are kept (a toast raised right before
 * a screen change, e.g. "Collection full" when leaving the booster screen, must survive that change).
 * @param {{olderThanMs?: number}} [opts]
 */
export function clearToasts(opts = {}) {
  if (!layer) return;
  const minAge = opts.olderThanMs || 0;
  const now = Date.now();
  for (const t of Array.from(layer.children)) {
    const age = now - Number(t.dataset.shownAt || 0);
    if (age >= minAge) t.remove();
  }
}
