'use strict';
/**
 * Tiny DOM helpers used by every UI component. No framework, no innerHTML with user data.
 * Pure helpers (fmt, pad, classes, URL builders) do not touch the DOM so they can be unit-tested in Node.
 */

/** Base URL of the UI assets (SVG icons, frames, placeholders). */
export const ASSET_BASE = '/assets/ui/';
/** Base URL of the card art. */
export const CARD_ART_BASE = '/assets/cards/';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Apply props to an element. Handles class/className (string | string[] | {name: bool}),
 * style (string | object), dataset, on<Event> listeners, ref callbacks, boolean attributes and
 * a few true properties (value, checked, selected, disabled, textContent).
 * @param {Element} el
 * @param {object|null|undefined} props
 */
function applyProps(el, props) {
  if (!props) return;
  for (const key of Object.keys(props)) {
    const val = props[key];
    if (val === undefined || val === null || val === false) continue;
    if (key === 'class' || key === 'className') {
      el.setAttribute('class', classes(val));
    } else if (key === 'style') {
      if (typeof val === 'string') el.setAttribute('style', val);
      else for (const k of Object.keys(val)) {
        if (k.startsWith('--')) el.style.setProperty(k, val[k]);
        else el.style[k] = val[k];
      }
    } else if (key === 'dataset') {
      for (const k of Object.keys(val)) if (val[k] !== undefined && val[k] !== null) el.dataset[k] = String(val[k]);
    } else if (key === 'ref') {
      if (typeof val === 'function') val(el);
    } else if (key.startsWith('on') && typeof val === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), val);
    } else if (key === 'text') {
      el.textContent = String(val);
    } else if (key === 'value' || key === 'checked' || key === 'selected' || key === 'disabled' || key === 'readOnly' || key === 'tabIndex') {
      el[key] = val;
      if (key === 'disabled' && val === true) el.setAttribute('disabled', '');
    } else if (val === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(val));
    }
  }
}

/**
 * Append children: strings/numbers become text nodes, arrays are flattened, null/undefined/booleans skipped.
 * @param {Node} parent
 * @param {any[]} children
 */
function appendChildren(parent, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false || child === true) continue;
    if (Array.isArray(child)) { appendChildren(parent, child); continue; }
    if (child instanceof Node) { parent.appendChild(child); continue; }
    parent.appendChild(document.createTextNode(String(child)));
  }
}

/**
 * Create an HTML element.
 * @param {string} tag  tag name, optionally with .class shorthand ("div.panel.pad")
 * @param {object|null} [props]
 * @param {...any} children
 * @returns {HTMLElement}
 */
export function h(tag, props, ...children) {
  const parts = tag.split('.');
  const el = document.createElement(parts[0] || 'div');
  if (parts.length > 1) el.className = parts.slice(1).join(' ');
  if (props && (props instanceof Node || typeof props !== 'object' || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  if (props && parts.length > 1 && (props.class || props.className)) {
    props = { ...props, class: parts.slice(1).join(' ') + ' ' + classes(props.class || props.className) };
    delete props.className;
  }
  applyProps(el, props);
  appendChildren(el, children);
  return el;
}

/**
 * Create an SVG element (namespaced).
 * @param {string} tag
 * @param {object|null} [props]
 * @param {...any} children
 * @returns {SVGElement}
 */
export function svg(tag, props, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  if (props) for (const key of Object.keys(props)) {
    const val = props[key];
    if (val === undefined || val === null || val === false) continue;
    if (key.startsWith('on') && typeof val === 'function') el.addEventListener(key.slice(2).toLowerCase(), val);
    else if (key === 'class') el.setAttribute('class', classes(val));
    else el.setAttribute(key, String(val));
  }
  appendChildren(el, children);
  return el;
}

/**
 * Normalise a class value into a space-separated string.
 * @param {string|string[]|Record<string, boolean>} val
 * @returns {string}
 */
export function classes(val) {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) return val.filter(Boolean).map(classes).join(' ');
  return Object.keys(val).filter((k) => val[k]).join(' ');
}

/**
 * Remove every child of a node.
 * @param {Node} node
 * @returns {Node}
 */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/**
 * Replace the content of `parent` with the given nodes.
 * @param {Element} parent
 * @param {...any} nodes
 * @returns {Element} parent
 */
export function mount(parent, ...nodes) {
  clear(parent);
  appendChildren(parent, nodes);
  return parent;
}

/**
 * Format an integer with thousands separators ("12,345"). Non-finite values render as "-".
 * @param {number} n
 * @returns {string}
 */
export function fmt(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '-';
  const neg = n < 0;
  const abs = Math.abs(Math.round(n));
  const s = String(abs).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return neg ? '-' + s : s;
}

/**
 * Zero-pad an integer.
 * @param {number} n
 * @param {number} [width=2]
 * @returns {string}
 */
export function pad(n, width = 2) {
  return String(Math.max(0, Math.floor(n))).padStart(width, '0');
}

/**
 * URL of a UI icon by name ("sword" -> "/assets/ui/sword.svg").
 * @param {string} name
 * @returns {string}
 */
export function iconUrl(name) {
  return ASSET_BASE + name + '.svg';
}

/**
 * <img> element for a UI icon.
 * @param {string} name  icon file name without extension
 * @param {object} [props]  extra props (class, style, alt...)
 * @returns {HTMLImageElement}
 */
export function icon(name, props = {}) {
  return /** @type {HTMLImageElement} */ (h('img', { alt: '', draggable: 'false', ...props, src: iconUrl(name), class: classes(['icon', props.class]) }));
}

/** Base URL of the original client's UI sprites (assets/orig/ui, names as in docs/design/apk-assets.md). */
export const ORIG_UI_BASE = '/assets/orig/ui/';

/**
 * URL of an original UI sprite by name ("hud_coinsicon01" -> "/assets/orig/ui/hud_coinsicon01.png").
 * Names may carry their own extension ("frames/button_default.png").
 * @param {string} name
 * @returns {string}
 */
export function spriteUrl(name) {
  return ORIG_UI_BASE + (/\.(png|jpg|jpeg|webp|svg)$/i.test(name) ? name : name + '.png');
}

/**
 * <img> element for an original UI sprite (class "sprite" plus any given class).
 * @param {string} name  sprite file name without extension
 * @param {object} [props]  extra props (class, style, alt...)
 * @returns {HTMLImageElement}
 */
export function sprite(name, props = {}) {
  return /** @type {HTMLImageElement} */ (h('img', { alt: '', draggable: 'false', ...props, src: spriteUrl(name), class: classes(['sprite', props.class]) }));
}

let uiRootEl = null;

/**
 * Set the element overlays (dialogs, toasts, popups) attach to - normally the #stage element.
 * @param {HTMLElement|null} el
 */
export function setUiRoot(el) {
  uiRootEl = el;
}

/**
 * Element overlays attach to: the one set with setUiRoot(), else #stage, else document.body.
 * @returns {HTMLElement}
 */
export function getUiRoot() {
  return uiRootEl || document.getElementById('stage') || document.body;
}

/**
 * Wait for `ms` milliseconds (UI only).
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Keyboard activation (Enter / Space) for role=button elements: an `onKeydown` handler, or undefined without `fn`.
 * @param {(() => void)|undefined} fn
 * @returns {((ev: KeyboardEvent) => void)|undefined}
 */
export function keyActivate(fn) {
  if (!fn) return undefined;
  return (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); fn(); } };
}

