'use strict';
/**
 * Screen router: a stack of screens rendered into a layer element with fade/slide transitions.
 * A screen is a module-like object `{ render(ctx) => Node|void, onLeave?(ctx) }`; `render` receives the
 * ctx built by `makeCtx` (app state, store, go/back...) plus `root` (the screen's own <div class="screen">).
 *
 * Transitions: 'fade' goes through black like the original client (round3/gameplay-feel.md §8: leaving a
 * screen is a ~0.7 s fade to black): a black curtain over the layer fades in (FADE_MS), the screens swap
 * under it, and it fades out again (FADE_MS). reset() drops the screens under a closed curtain, so the next
 * 'fade' (goTop's) only has to lift it; a curtain nobody lifts goes up by itself once the router is idle.
 * 'slide' / 'slide-back' slide (CSS), 'none' swaps at once.
 */
import { h, clear, wait } from './dom.js';

const TRANSITION_MS = 400;
/** Each half of a fade through black (ms): ~0.7 s per screen change. */
export const FADE_MS = 350;

/**
 * @typedef {object} Screen
 * @property {(ctx: object) => (Node|void|Promise<Node|void>)} render
 * @property {(ctx: object) => void} [onLeave]
 * @property {boolean} [noChrome]
 */

/**
 * @typedef {object} RouterOptions
 * @property {HTMLElement} layer  container that holds the screens (stage.layer)
 * @property {Record<string, Screen>} [screens]  initial registry
 * @property {(base: object) => object} [makeCtx]  decorate the ctx passed to render
 * @property {'fade'|'slide'|'none'} [transition='fade']
 * @property {number} [maxStack=20]
 */

/**
 * Create a router.
 * @param {RouterOptions} opts
 */
export function createRouter(opts) {
  const layer = opts.layer;
  const registry = { ...(opts.screens || {}) };
  const defaultTransition = opts.transition || 'fade';
  const maxStack = opts.maxStack || 20;
  /**
   * Screens on the stack. Only the top one keeps its root and ctx: a covered screen is left (onLeave) and
   * rebuilt from id/params by back().
   * @type {{id: string, params: object, root: HTMLElement|null, ctx: object|null, screen: Screen, left?: boolean}[]}
   */
  const stack = [];
  /** @type {Set<(entry: {id: string, params: object}) => void>} */
  const listeners = new Set();
  let busy = false;
  let seq = 0;
  /** @type {HTMLElement|null} black curtain of the fade transitions */
  let curtain = null;
  let curtainTimer = null;

  /** The curtain element, on top of the screens (z-index under the dialogs of the stage). */
  function getCurtain() {
    if (!curtain) {
      curtain = h('div.router-curtain', { 'aria-hidden': 'true', style: { position: 'absolute', inset: '0', background: '#000', zIndex: '95', opacity: '0', pointerEvents: 'none' } });
    }
    if (curtain.parentNode !== layer || layer.lastChild !== curtain) layer.appendChild(curtain);
    return curtain;
  }
  const curtainUp = () => Boolean(curtain && curtain.isConnected && curtain.style.opacity === '1');
  /**
   * Fade the curtain to an opacity (0 or 1) over `ms`; at 0 it leaves the layer.
   * @param {0|1} to
   * @param {number} ms
   */
  async function fadeCurtain(to, ms) {
    const c = getCurtain();
    c.style.transition = 'none';
    c.style.opacity = to ? '0' : '1';
    void c.offsetWidth;
    c.style.transition = `opacity ${ms}ms linear`;
    c.style.pointerEvents = to ? 'auto' : 'none';
    c.style.opacity = String(to);
    await wait(ms);
    if (!to && curtain === c && c.style.opacity === '0') c.remove();
  }
  /** Lift a curtain left closed by reset() once nothing navigates any more. */
  function liftWhenIdle() {
    clearTimeout(curtainTimer);
    curtainTimer = setTimeout(() => {
      if (busy) { liftWhenIdle(); return; }
      if (curtainUp()) fadeCurtain(0, FADE_MS);
    }, 120);
  }

  function notify() {
    const cur = current();
    for (const fn of listeners) fn(cur);
  }

  /**
   * Register a screen.
   * @param {string} id
   * @param {Screen} screen
   */
  function register(id, screen) {
    registry[id] = screen;
  }

  /** @returns {{id: string, params: object}|null} */
  function current() {
    const top = stack[stack.length - 1];
    return top ? { id: top.id, params: top.params } : null;
  }

  /**
   * Build the entry (root + ctx) for a screen and render it.
   * @param {string} id
   * @param {object} params
   */
  async function build(id, params) {
    const screen = registry[id];
    if (!screen) throw new Error(`Unknown screen "${id}"`);
    const root = h('div.screen', { dataset: { screen: id } });
    if (screen.noChrome) root.classList.add('no-hud', 'no-nav');
    const base = {
      root,
      screenId: id,
      params,
      go: (to, p, o) => go(to, p, o),
      back: (fallback) => back(fallback),
      replace: (to, p, o) => replace(to, p, o),
      rerender: () => rerender(),
      router: api,
    };
    const ctx = opts.makeCtx ? opts.makeCtx(base) : base;
    const out = await screen.render(ctx);
    if (out instanceof Node && out !== root) root.appendChild(out);
    return { id, params, root, ctx, screen };
  }

  /**
   * Animate from the outgoing entry to the incoming one.
   * @param {HTMLElement|null} outEl
   * @param {HTMLElement} inEl
   * @param {'fade'|'slide'|'slide-back'|'none'} transition
   */
  async function animate(outEl, inEl, transition) {
    if (transition === 'fade') {
      // through black: close the curtain (unless reset() left it closed), swap, open it
      if (outEl && !curtainUp()) await fadeCurtain(1, FADE_MS);
      else if (!curtainUp()) { const c = getCurtain(); c.style.transition = 'none'; c.style.opacity = '1'; }
      layer.insertBefore(inEl, getCurtain());
      if (outEl) outEl.remove();
      await fadeCurtain(0, FADE_MS);
      return;
    }
    if (curtain && curtain.isConnected) layer.insertBefore(inEl, curtain); else layer.appendChild(inEl);
    if (transition === 'none' || !outEl) {
      if (outEl) outEl.remove();
      if (transition !== 'none') {
        inEl.classList.add('screen-enter-fade');
        await wait(TRANSITION_MS);
        inEl.classList.remove('screen-enter-fade');
      }
      return;
    }
    const map = {
      fade: ['screen-exit-fade', 'screen-enter-fade'],
      slide: ['screen-exit-slide', 'screen-enter-slide'],
      'slide-back': ['screen-exit-slide-back', 'screen-enter-slide-back'],
    };
    const [exitCls, enterCls] = map[transition] || map.fade;
    if (transition === 'slide-back') layer.insertBefore(inEl, outEl);
    outEl.classList.add(exitCls);
    inEl.classList.add(enterCls);
    await wait(TRANSITION_MS);
    outEl.remove();
    inEl.classList.remove(enterCls);
  }

  /**
   * Leave a screen, once per entry: its onLeave, then a `screen:leave` event on its root (timers, store
   * subscriptions and overlays of the screen listen for it).
   */
  function leave(entry) {
    if (!entry || entry.left) return;
    entry.left = true;
    if (entry.screen.onLeave) {
      try { entry.screen.onLeave(entry.ctx); } catch (err) { console.error(err); }
    }
    if (entry.root) entry.root.dispatchEvent(new CustomEvent('screen:leave'));
  }

  /**
   * Push a screen.
   * @param {string} id
   * @param {object} [params]
   * @param {{transition?: 'fade'|'slide'|'none'}} [o]
   */
  async function go(id, params = {}, o = {}) {
    if (busy) return;
    busy = true;
    const token = ++seq;
    try {
      const prev = stack[stack.length - 1] || null;
      const entry = await build(id, params);
      if (token !== seq) return;
      stack.push(entry);
      if (stack.length > maxStack) stack.splice(0, stack.length - maxStack);
      if (prev) leave(prev);
      await animate(prev ? prev.root : null, entry.root, o.transition || defaultTransition);
      if (prev) { prev.root = null; prev.ctx = null; }
      notify();
    } finally {
      busy = false;
    }
  }

  /**
   * Replace the current screen.
   * @param {string} id
   * @param {object} [params]
   * @param {{transition?: 'fade'|'slide'|'none'}} [o]
   */
  async function replace(id, params = {}, o = {}) {
    if (busy) return;
    busy = true;
    const token = ++seq;
    try {
      const prev = stack.pop() || null;
      const entry = await build(id, params);
      if (token !== seq) return;
      stack.push(entry);
      if (prev) leave(prev);
      await animate(prev ? prev.root : null, entry.root, o.transition || defaultTransition);
      notify();
    } finally {
      busy = false;
    }
  }

  /**
   * Pop the current screen. With one screen on the stack, `fallback` (if given) replaces it.
   * @param {string} [fallback]
   * @returns {Promise<boolean>} whether navigation happened
   */
  async function back(fallback) {
    if (busy) return false;
    if (stack.length <= 1) {
      if (fallback && (!stack.length || stack[0].id !== fallback)) { await replace(fallback, {}, { transition: 'fade' }); return true; }
      return false;
    }
    busy = true;
    const token = ++seq;
    try {
      const prev = stack.pop();
      const target = stack.pop();
      const entry = await build(target.id, target.params);
      if (token !== seq) return false;
      stack.push(entry);
      leave(prev);
      await animate(prev.root, entry.root, defaultTransition === 'slide' ? 'slide-back' : defaultTransition);
      notify();
      return true;
    } finally {
      busy = false;
    }
  }

  /** Re-render the current screen in place (no transition). */
  async function rerender() {
    const top = stack[stack.length - 1];
    if (!top || busy) return;
    busy = true;
    const token = ++seq;
    try {
      const scrollTop = top.root.querySelector('.screen-body')?.scrollTop || 0;
      const entry = await build(top.id, top.params);
      if (token !== seq) return;
      leave(top);
      stack[stack.length - 1] = entry;
      layer.replaceChild(entry.root, top.root);
      const body = entry.root.querySelector('.screen-body');
      if (body) body.scrollTop = scrollTop;
      notify();
    } finally {
      busy = false;
    }
  }

  /** Remove every screen. */
  function reset() {
    const shown = stack.length > 0;
    for (const e of stack) leave(e);
    stack.length = 0;
    clear(layer);
    if (shown) {
      // cut to black: the next fade lifts the curtain (or it goes up by itself)
      const c = getCurtain();
      c.style.transition = 'none';
      c.style.opacity = '1';
      liftWhenIdle();
    }
    notify();
  }

  /**
   * Subscribe to navigation changes.
   * @param {(entry: {id: string, params: object}|null) => void} fn
   * @returns {() => void}
   */
  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  /**
   * Bind Escape to back() on a target (window by default). Dialogs stop propagation of their own Escape.
   * @param {EventTarget} [target=window]
   * @returns {() => void}
   */
  function bindKeyboard(target = window) {
    const onKey = (ev) => { if (ev.key === 'Escape' && !ev.defaultPrevented) back(); };
    target.addEventListener('keydown', onKey);
    return () => target.removeEventListener('keydown', onKey);
  }

  const api = {
    register, go, replace, back, rerender, reset, current, onChange, bindKeyboard,
    get stack() { return stack.map((e) => ({ id: e.id, params: e.params })); },
    get depth() { return stack.length; },
    get busy() { return busy; },
    has: (id) => Boolean(registry[id]),
  };
  return api;
}
