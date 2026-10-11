'use strict';
/**
 * DOM pieces of the tutorial overlay, after the client's tutorial views:
 *  - text box (ui.components.tutorialv3.view_tutorialv3_text): the alpha nine-slice frame with popup_fill,
 *    290 x 95 client units, yellow "tutorialBold" text typed in (util.typeanimatedtext), the speaker standing at
 *    its left ("characterGoodBottom" ranger, the Worm Shaman's portrait for the bad side), positions top / center /
 *    bottom / bottom_menu (above the nav); it zooms in from 0.8 (inOutExpo), fades out in 350 ms, a tap closes it;
 *  - pointing hand (ui.components.comp_click_tutorial, view_shp_highlights "hand"): hud_tapindicator01 with the
 *    hud_tapfeedback01 ring pulsing under the fingertip;
 *  - button sparkle (view_shp_highlights "sparkle" = ui.components.small.view_button_sparkle): the highlight
 *    animation (assets/gfx/hud/highlight/glow_07 … glow_01, 433 ms, added light) over the button every 1.5 s.
 *    The client drew the black-backed frames with additive blending; the overlay layer is its own stacking
 *    context, so a CSS blend mode would only see the transparent layer and leave the black opaque. The frames are
 *    therefore pre-converted to alpha (assets/ui/tutorial/glow_0n.png: alpha = max(r, g, b), colour un-premultiplied),
 *    which composites the same light with ordinary alpha blending;
 *  - drag arrow (ui.effects.fx_tutorial_arrow): tutorial_arrowline01 stretched from the source to the target with
 *    tutorial_arrowhead01 at the end, grown in 600 ms, then pulsing; the hand travels along it.
 * Everything lives in one `.tut-layer` above the screens (below dialogs) and never takes pointer events except
 * the text box.
 */
import { h } from '../dom.js';
import { SPEAKERS } from './lines.js';

/** Typewriter speed (ms per character) and fade-out time. */
export const TYPE_MS = 24;
export const FADE_OUT_MS = 350;

/**
 * Create the overlay layer inside the stage.
 * @param {HTMLElement} stageEl
 * @returns {HTMLElement}
 */
export function createLayer(stageEl) {
  const existing = stageEl.querySelector(':scope > .tut-layer');
  if (existing) return /** @type {HTMLElement} */ (existing);
  const layer = h('div.tut-layer', { 'aria-live': 'polite' });
  stageEl.appendChild(layer);
  return layer;
}

/**
 * A tutorial text box.
 * @param {{speaker: string, text: string}} line
 * @param {{position?: string, onTap?: () => void, typeMs?: number}} [opts]
 * @returns {HTMLElement & {close: () => void, finish: () => void, lineText: string}}
 */
export function renderText(line, opts = {}) {
  const who = SPEAKERS[line.speaker] || SPEAKERS.ranger;
  const msg = h('div.tut-text-msg');
  const el = /** @type {any} */ (h('div.tut-text', {
    class: [`pos-${opts.position || 'bottom_menu'}`, `side-${who.side}`, `speaker-${line.speaker}`],
    role: 'status', dataset: { speaker: line.speaker },
  },
  h('div.tut-text-frame', null, msg),
  who.portrait ? h('img.tut-text-portrait', { src: who.portrait, alt: who.name, draggable: 'false' }) : null));
  el.lineText = line.text;
  const typeMs = opts.typeMs == null ? TYPE_MS : opts.typeMs;
  let n = 0;
  let timer = null;
  const finish = () => {
    if (timer) { clearInterval(timer); timer = null; }
    msg.textContent = line.text;
    el.classList.add('typed');
  };
  if (typeMs > 0 && typeof setInterval === 'function') {
    timer = setInterval(() => {
      n += 1;
      msg.textContent = line.text.slice(0, n);
      if (n >= line.text.length) finish();
    }, typeMs);
  } else finish();
  el.finish = finish;
  el.close = () => {
    if (el.classList.contains('closing')) return;
    finish();
    el.classList.add('closing');
    setTimeout(() => el.remove(), FADE_OUT_MS);
  };
  el.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (!el.classList.contains('typed')) { finish(); return; }
    if (opts.onTap) opts.onTap();
  });
  return el;
}

/**
 * The pointing hand with its pulsing ring; `place(x, y)` puts the fingertip on a stage point.
 * @returns {HTMLElement & {place: (x: number, y: number) => void}}
 */
export function renderHand() {
  const el = /** @type {any} */ (h('div.tut-hand', { 'aria-hidden': 'true' },
    h('img.tut-hand-ring', { src: '/assets/orig/ui/hud_tapfeedback01.png', alt: '', draggable: 'false' }),
    h('img.tut-hand-img', { src: '/assets/orig/ui/hud_tapindicator01.png', alt: '', draggable: 'false' })));
  el.place = (x, y) => {
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
  };
  return el;
}

/** Alpha versions of the highlight frames (assets/orig/ui/glow_0n.png converted, see the header). */
export const SPARKLE_BASE = '/assets/ui/tutorial/';
/** Frames of the highlight animation (view_button_sparkle), played last to first. */
export const SPARKLE_FRAMES = Object.freeze(['glow_07', 'glow_06', 'glow_05', 'glow_04', 'glow_03', 'glow_02', 'glow_01']);
/** view_button_sparkle: one 433 ms flash every 1500 ms. */
export const SPARKLE_PERIOD_MS = 1500;

/**
 * The button sparkle; `place(rect)` covers a stage rectangle {x, y, w, h} (the glow is wider than the button).
 * @returns {HTMLElement & {place: (r: {x: number, y: number, w: number, h: number}) => void}}
 */
export function renderSparkle() {
  const el = /** @type {any} */ (h('div.tut-sparkle', { 'aria-hidden': 'true', style: { '--period': `${SPARKLE_PERIOD_MS}ms` } },
    SPARKLE_FRAMES.map((name, i) => h('img.tut-sparkle-frame', { src: `${SPARKLE_BASE}${name}.png`, alt: '', draggable: 'false', style: { animationDelay: `${i * 55}ms` } }))));
  el.place = (r) => {
    const w = Math.max(80, r.w * 1.5);
    const hgt = Math.max(60, r.h * 1.5);
    el.style.left = `${Math.round(r.x + r.w / 2 - w / 2)}px`;
    el.style.top = `${Math.round(r.y + r.h / 2 - hgt / 2)}px`;
    el.style.width = `${Math.round(w)}px`;
    el.style.height = `${Math.round(hgt)}px`;
  };
  return el;
}

/**
 * Geometry of a drag arrow from a to b: the arrow container hangs from `a` (line, then the head at its end) and
 * is rotated so that its "down" axis points at b.
 * @param {{x: number, y: number}} a
 * @param {{x: number, y: number}} b
 * @returns {{length: number, angle: number}}  CSS rotation in degrees (clockwise), 0 = b straight below a
 */
export function arrowGeometry(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const angle = (Math.atan2(-dx, dy) * 180) / Math.PI;
  return { length: Math.hypot(dx, dy), angle: angle === 0 ? 0 : angle };
}

/**
 * The drag arrow plus a hand travelling along it.
 * @returns {HTMLElement & {place: (a: {x: number, y: number}, b: {x: number, y: number}) => void}}
 */
export function renderDrag() {
  const line = h('div.tut-arrow-line');
  const head = h('img.tut-arrow-head', { src: '/assets/orig/ui/tutorial_arrowhead01.png', alt: '', draggable: 'false' });
  const arrow = h('div.tut-arrow', null, line, head);
  const hand = h('img.tut-drag-hand', { src: '/assets/orig/ui/hud_tapindicator01.png', alt: '', draggable: 'false' });
  const el = /** @type {any} */ (h('div.tut-drag', { 'aria-hidden': 'true' }, arrow, hand));
  el.place = (a, b) => {
    const g = arrowGeometry(a, b);
    arrow.style.left = `${Math.round(a.x)}px`;
    arrow.style.top = `${Math.round(a.y)}px`;
    arrow.style.height = `${Math.round(g.length)}px`;
    arrow.style.transform = `rotate(${g.angle.toFixed(1)}deg)`;
    el.style.setProperty('--ax', `${Math.round(a.x)}px`);
    el.style.setProperty('--ay', `${Math.round(a.y)}px`);
    el.style.setProperty('--bx', `${Math.round(b.x)}px`);
    el.style.setProperty('--by', `${Math.round(b.y)}px`);
  };
  return el;
}
