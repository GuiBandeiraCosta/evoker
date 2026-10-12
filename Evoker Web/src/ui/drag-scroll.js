'use strict';
/**
 * Phone-style scrolling with the mouse (user's request, 2026-10-12): every scrollable area of the stage is
 * dragged like on a phone - press, move, release, with the client's inertia (velocity x 0.95 per frame, the rule
 * of cards-slider.js) - and the scrollbars are hidden (css/main.css "#stage *"). Touch keeps the browser's native
 * panning; only mouse pointers are handled here. A drag of at least DRAG_THRESHOLD px swallows the click that
 * would follow on release, so the button under the pointer is not pressed by accident. The card drag-and-drop
 * (components/drag-drop.js) wins whenever it picks a card up: its ghost is on the stage before the first move is
 * judged here, and then the gesture is left to it.
 */

/** Pointer travel (client px) before a press becomes a scroll. */
export const DRAG_THRESHOLD = 6;
/** Inertia: the velocity keeps this much per 16 ms frame (the client's slider rule). */
export const FRICTION = 0.95;
/** Inertia stops below this speed (stage px per ms). */
export const MIN_VELOCITY = 0.02;
/** The flick velocity is measured over the last pointer samples inside this window (ms). */
export const FLICK_WINDOW_MS = 100;
/** Elements with their own pointer gestures: never scrolled from here. */
export const OWN_GESTURE_SELECTOR = '.card-slider, input, textarea, select, [contenteditable]';

/**
 * Pure: which axes an element with these metrics can scroll.
 * @param {{overflowX: string, overflowY: string, scrollWidth: number, clientWidth: number, scrollHeight: number, clientHeight: number}} m
 * @returns {{x: boolean, y: boolean}}
 */
export function scrollAxes(m) {
  const scrolls = (ov) => ov === 'auto' || ov === 'scroll';
  return {
    x: scrolls(m.overflowX) && m.scrollWidth > m.clientWidth + 1,
    y: scrolls(m.overflowY) && m.scrollHeight > m.clientHeight + 1,
  };
}

/**
 * Pure: the flick velocity (px per ms) from the recent pointer samples: the move from the first sample inside
 * the window to the last one.
 * @param {{t: number, x: number, y: number}[]} samples  in time order
 * @param {number} [windowMs]
 * @returns {{vx: number, vy: number}}
 */
export function flickVelocity(samples, windowMs = FLICK_WINDOW_MS) {
  if (!samples || samples.length < 2) return { vx: 0, vy: 0 };
  const last = samples[samples.length - 1];
  const first = samples.find((s) => last.t - s.t <= windowMs) || samples[0];
  const dt = last.t - first.t;
  if (dt <= 0) return { vx: 0, vy: 0 };
  return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
}

/**
 * Pure: one inertia step. The velocity decays by FRICTION per 16 ms frame; the distance is the sum over those
 * frames (so a flick at v px/ms travels v x 16 / (1 - FRICTION) = 320 v px in all).
 * @param {number} v  px per ms
 * @param {number} dt  ms since the last step
 * @param {number} [friction]
 * @returns {{v: number, dist: number}}
 */
export function inertiaStep(v, dt, friction = FRICTION) {
  const f = Math.pow(friction, dt / 16);
  const dist = friction >= 1 ? v * dt : v * 16 * (1 - f) / (1 - friction);
  return { v: v * f, dist };
}

/**
 * Install the mouse drag scrolling on the stage.
 * @param {HTMLElement} root  the stage element
 * @param {{getScale?: () => number}} [opts]  stage scale (client px per stage px)
 * @returns {{destroy: () => void, dragging: () => boolean}}
 */
export function installDragScroll(root, opts = {}) {
  const getScale = () => (opts.getScale && opts.getScale()) || 1;
  /** @type {null | {el: HTMLElement, axes: {x: boolean, y: boolean}, pointerId: number, startX: number, startY: number, left: number, top: number, dragging: boolean, samples: {t: number, x: number, y: number}[]}} */
  let state = null;
  /** @type {Map<HTMLElement, number>} running inertia animations (rAF ids) per element */
  const inertia = new Map();

  /** The nearest scrollable ancestor of `target` inside the root, with its axes. */
  function findScrollable(target) {
    let el = target instanceof Element ? target : null;
    while (el && el !== root) {
      const cs = getComputedStyle(el);
      const axes = scrollAxes({
        overflowX: cs.overflowX, overflowY: cs.overflowY,
        scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
      });
      if (axes.x || axes.y) return { el, axes };
      el = el.parentElement;
    }
    return null;
  }

  function stopInertia(el) {
    const id = inertia.get(el);
    if (id) { cancelAnimationFrame(id); inertia.delete(el); }
  }

  function glide(el, axes, vx, vy) {
    stopInertia(el);
    let v = { x: axes.x ? vx : 0, y: axes.y ? vy : 0 };
    if (Math.hypot(v.x, v.y) < MIN_VELOCITY) return;
    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min(64, Math.max(1, now - last));
      last = now;
      const sx = inertiaStep(v.x, dt);
      const sy = inertiaStep(v.y, dt);
      v = { x: sx.v, y: sy.v };
      const before = { l: el.scrollLeft, t: el.scrollTop };
      if (axes.x) el.scrollLeft = before.l - sx.dist;
      if (axes.y) el.scrollTop = before.t - sy.dist;
      const moved = el.scrollLeft !== before.l || el.scrollTop !== before.t;
      if (!moved || Math.hypot(v.x, v.y) < MIN_VELOCITY || !el.isConnected) { inertia.delete(el); return; }
      inertia.set(el, requestAnimationFrame(frame));
    };
    inertia.set(el, requestAnimationFrame(frame));
  }

  /** The click right after a drag is not a tap: swallow it (capture phase, one shot). */
  function swallowNextClick() {
    const swallow = (ev) => { ev.stopImmediatePropagation(); ev.preventDefault(); };
    root.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => root.removeEventListener('click', swallow, { capture: true }), 80);
  }

  function onPointerDown(ev) {
    if (state || ev.pointerType !== 'mouse' || ev.button !== 0) return;
    if (!(ev.target instanceof Element) || ev.target.closest(OWN_GESTURE_SELECTOR)) return;
    const found = findScrollable(ev.target);
    if (!found) return;
    stopInertia(found.el);
    state = {
      el: found.el, axes: found.axes, pointerId: ev.pointerId, startX: ev.clientX, startY: ev.clientY,
      left: found.el.scrollLeft, top: found.el.scrollTop, dragging: false, samples: [],
    };
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  function onPointerMove(ev) {
    if (!state || ev.pointerId !== state.pointerId) return;
    const dx = ev.clientX - state.startX;
    const dy = ev.clientY - state.startY;
    if (!state.dragging) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      // a card picked up by the drag-and-drop owns the gesture (its ghost is already on the stage)
      if (root.querySelector('.drag-ghost')) { release(); return; }
      state.dragging = true;
      state.el.classList.add('drag-scrolling');
    }
    ev.preventDefault();
    const s = getScale();
    if (state.axes.x) state.el.scrollLeft = state.left - dx / s;
    if (state.axes.y) state.el.scrollTop = state.top - dy / s;
    state.samples.push({ t: ev.timeStamp, x: ev.clientX / s, y: ev.clientY / s });
    if (state.samples.length > 12) state.samples.shift();
  }

  function release() {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    const st = state;
    state = null;
    if (st && st.dragging) st.el.classList.remove('drag-scrolling');
    return st;
  }

  function onPointerUp(ev) {
    if (!state || ev.pointerId !== state.pointerId) return;
    const st = release();
    if (!st || !st.dragging) return;
    swallowNextClick();
    if (ev.type === 'pointerup') {
      const { vx, vy } = flickVelocity(st.samples);
      glide(st.el, st.axes, vx, vy);
    }
  }

  root.addEventListener('pointerdown', onPointerDown);
  return {
    dragging: () => Boolean(state && state.dragging),
    destroy() {
      root.removeEventListener('pointerdown', onPointerDown);
      release();
      for (const el of Array.from(inertia.keys())) stopInertia(el);
    },
  };
}
