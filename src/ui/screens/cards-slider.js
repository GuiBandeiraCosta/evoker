'use strict';
/**
 * Card slider of the Cards screen (comp_cardslider2): the cards on an arc, the middle one in front, swiped
 * sideways with inertia.
 */
import { h } from '../dom.js';
import { SLIDER, sliderPose, sliderLimits, offsetFor } from './cards-helpers.js';

/** Stage px per degree when the slider is swiped (one card width per card step). */
const DEG_PER_PX = SLIDER.STEP / 219;

/**
 * Whether a pointer move is a sideways swipe of the slider rather than a card pick-up: the client scrolls after
 * 20 px sideways and drags after 10 px up or down, i.e. a move flatter than 1 : 2 scrolls.
 * @param {number} dx
 * @param {number} dy
 * @returns {boolean}
 */
export function isSwipe(dx, dy) {
  return Math.abs(dx) > 2 * Math.abs(dy);
}

/**
 * Card carousel: cards on an arc (SLIDER / sliderPose), swiped horizontally with inertia (velocity × 0.95
 * per frame like the client), mouse wheel, clamped at both ends. `snapEnd` glides to the last card on start.
 * @param {HTMLElement} el  the .card-slider element
 * @param {{cards: HTMLElement[], offset: number, getScale: () => number, onChange?: (offset: number) => void, snapEnd?: boolean}} opts
 * @returns {{destroy: () => void, scrollTo: (index: number) => void, scrollToEnd: () => void, offset: () => number}}
 */
export function createSlider(el, opts) {
  const layer = h('div.slider-cards');
  el.appendChild(layer);
  const cards = opts.cards;
  for (const c of cards) layer.appendChild(c);
  const limits = sliderLimits(cards.length);
  let offset = opts.offset;
  let vel = 0;
  let target = null;
  let raf = 0;
  let last = 0;
  let gesture = null;
  let destroyed = false;
  const clamp = (v) => Math.max(limits.min, Math.min(limits.max, v));

  function layout() {
    cards.forEach((card, i) => {
      const pose = sliderPose(offset + i * SLIDER.STEP);
      const st = card.style;
      if (!pose.visible) { st.visibility = 'hidden'; return; }
      st.visibility = '';
      st.transform = `translate(${pose.x.toFixed(1)}px, ${pose.y.toFixed(1)}px) scale(${pose.scale.toFixed(4)})`;
      st.zIndex = String(pose.z);
    });
    if (opts.onChange) opts.onChange(offset);
  }

  function schedule() {
    if (!raf && !destroyed && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(tick);
  }

  function tick(ts) {
    raf = 0;
    const dt = last ? Math.min(50, ts - last) : 16;
    last = ts;
    if (gesture && gesture.mode === 'scroll') return;
    if (target != null) {
      const d = target - offset;
      if (Math.abs(d) < 0.05) { offset = target; target = null; } else offset += d * Math.min(1, dt * 0.012);
    } else if (Math.abs(vel) > 0.0005) {
      offset += vel * dt;
      vel *= Math.pow(0.95, dt / 16.7);
      const c = clamp(offset);
      if (c !== offset) { offset = c; vel = 0; }
    } else {
      vel = 0;
    }
    layout();
    if (target != null || vel) schedule(); else last = 0;
  }

  function onMove(ev) {
    if (!gesture || ev.pointerId !== gesture.id) return;
    const dx = ev.clientX - gesture.x, dy = ev.clientY - gesture.y;
    if (!gesture.mode) {
      if (Math.hypot(dx, dy) < 6) return;
      gesture.mode = isSwipe(dx, dy) ? 'scroll' : 'none';
      if (gesture.mode === 'none') { end(); return; }
    }
    ev.preventDefault();
    const s = opts.getScale() || 1;
    offset = clamp(gesture.offset + (dx / s) * DEG_PER_PX);
    const t = performance.now();
    gesture.samples.push({ t, o: offset });
    while (gesture.samples.length > 2 && t - gesture.samples[0].t > 100) gesture.samples.shift();
    layout();
  }

  function onUp(ev) {
    if (!gesture || ev.pointerId !== gesture.id) return;
    if (gesture.mode === 'scroll' && gesture.samples.length > 1) {
      const a = gesture.samples[0], b = gesture.samples[gesture.samples.length - 1];
      vel = b.t > a.t ? (b.o - a.o) / (b.t - a.t) : 0;
      vel = Math.max(-0.4, Math.min(0.4, vel));
    }
    end();
    schedule();
  }

  function end() {
    gesture = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  }

  function onDown(ev) {
    if (ev.button > 0 || gesture) return;
    vel = 0;
    target = null;
    gesture = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, offset, mode: null, samples: [] };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function onWheel(ev) {
    ev.preventDefault();
    const d = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
    target = null;
    vel = 0;
    offset = clamp(offset - d * 0.06);
    layout();
  }

  // other modules (the tutorial's hand) can ask for a card: el.dispatchEvent(new CustomEvent('slider:reveal', { detail: { uid } }))
  function onReveal(ev) {
    const key = ev && ev.detail ? ev.detail.uid : null;
    const i = cards.findIndex((c) => c.dataset.uid === key || c.dataset.piece === key);
    if (i < 0) return;
    target = clamp(offsetFor(i));
    if (ev.detail.instant) { offset = target; target = null; layout(); } else schedule();
  }

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('slider:reveal', onReveal);
  layout();
  if (opts.snapEnd) {
    target = clamp(offsetFor(cards.length - 1));
    schedule();
  }

  return {
    destroy() {
      destroyed = true;
      end();
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('slider:reveal', onReveal);
    },
    /** Glide card `index` to the front. */
    scrollTo(index) { target = clamp(offsetFor(index)); schedule(); },
    /** Glide to the last card (client snapToEndFast). */
    scrollToEnd() { target = clamp(offsetFor(cards.length - 1)); schedule(); },
    offset: () => offset,
  };
}
