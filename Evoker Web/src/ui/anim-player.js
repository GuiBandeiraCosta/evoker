'use strict';
/**
 * Player for the original client's keyframe animations (assets/orig/animations/*.json, the comp_anim_player
 * format): `images[]` (sprites, or `type: "template"` slots the caller fills, e.g. the reward card) with their
 * start state (x, y, xScale, yScale, rotation, alpha, width, height in the client's 320-wide content units,
 * centred on the animation's origin), `startVisibility` / `endVisibility` (ms), `blendMode` ("add" for sprites
 * painted on black) and `tweens[]` (`{id, timestamp, params: {time, x, y, xScale, yScale, rotation, alpha}}`,
 * id = 1-based image index, linear like Corona's default easing).
 *
 *  - sampleAnim(anim, t)              pure: every image's state at time t (ms of animation time)
 *  - loadAnim(name)                   fetches and caches assets/orig/animations/<name>.json
 *  - playAnim(parent, anim, opts)     DOM: draws the images centred in `parent` and runs them with rAF;
 *                                     `opts.speed` like the client's anim speed (reward_comp plays at 1.2)
 *
 * Sprite sources (assets/gfx/.../<stem>.jpg|png) map to assets/orig/ui/<stem>.png.
 */
import { h } from './dom.js';

/** Stage px per client content unit (720 / 320). */
export const UNIT = 2.25;
/** Base URL of the animation files. */
export const ANIM_BASE = '/assets/orig/animations/';

const PROPS = ['x', 'y', 'xScale', 'yScale', 'rotation', 'alpha'];
const cache = new Map();

/**
 * Sprite URL for an animation image source path.
 * @param {string} src  e.g. "assets/gfx/hud/rewardanimation/goldrain.jpg"
 * @returns {string}
 */
export function animSpriteUrl(src) {
  const stem = String(src || '').split('/').pop().replace(/\.(png|jpg|jpeg)$/i, '');
  return `/assets/orig/ui/${stem}.png`;
}

/**
 * Tween segments per image and property, sorted by start time.
 * @param {object} anim
 * @returns {Array<Record<string, {ts: number, time: number, to: number}[]>>}
 */
function segmentsOf(anim) {
  if (anim._segments) return anim._segments;
  const segs = (anim.images || []).map(() => ({}));
  for (const tw of anim.tweens || []) {
    const i = (tw.id | 0) - 1;
    if (!segs[i]) continue;
    const prm = tw.params || {};
    for (const k of PROPS) {
      if (typeof prm[k] !== 'number') continue;
      (segs[i][k] = segs[i][k] || []).push({ ts: Number(tw.timestamp) || 0, time: Math.max(0, Number(prm.time) || 0), to: prm[k] });
    }
  }
  for (const s of segs) for (const k of Object.keys(s)) s[k].sort((a, b) => a.ts - b.ts);
  Object.defineProperty(anim, '_segments', { value: segs, enumerable: false });
  return segs;
}

/**
 * State of every image at time t.
 * @param {object} anim  parsed animation json
 * @param {number} t     ms
 * @returns {{x: number, y: number, xScale: number, yScale: number, rotation: number, alpha: number, visible: boolean}[]}
 */
export function sampleAnim(anim, t) {
  const segs = segmentsOf(anim);
  return (anim.images || []).map((img, i) => {
    const out = { visible: t >= (Number(img.startVisibility) || 0) && t <= (img.endVisibility == null ? Infinity : Number(img.endVisibility)) };
    for (const k of PROPS) {
      let v = typeof img[k] === 'number' ? img[k] : (k === 'alpha' || k === 'xScale' || k === 'yScale' ? 1 : 0);
      for (const s of segs[i][k] || []) {
        if (t < s.ts) break;
        if (s.time <= 0 || t >= s.ts + s.time) { v = s.to; continue; }
        v += (s.to - v) * ((t - s.ts) / s.time);
        break;
      }
      out[k] = v;
    }
    return out;
  });
}

/**
 * Fetch an animation by name (cached).
 * @param {string} name  file stem, e.g. "goldreward"
 * @returns {Promise<object|null>} null when it cannot be loaded
 */
export function loadAnim(name) {
  if (!cache.has(name)) {
    cache.set(name, fetch(`${ANIM_BASE}${name}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  }
  return cache.get(name);
}

/**
 * Play an animation centred in `parent`.
 * @param {HTMLElement} parent  positioned container
 * @param {object} anim
 * @param {{speed?: number, unit?: number, x?: number, y?: number, templates?: Record<string, HTMLElement>, className?: string}} [opts]
 *        x / y: centre in parent px (default: the middle); templates: element per template name (anim.templates
 *        maps a name to its 1-based image id)
 * @returns {{el: HTMLElement, done: Promise<void>, stop: () => void, duration: number}}
 */
export function playAnim(parent, anim, opts = {}) {
  const unit = opts.unit || UNIT;
  const speed = Number(opts.speed) > 0 ? Number(opts.speed) : 1;
  const duration = Number(anim.duration) || 0;
  const byId = {};
  for (const [name, id] of Object.entries(anim.templates || {})) byId[id] = (opts.templates || {})[name] || null;
  const root = h('div.anim-root', { class: opts.className, style: { left: opts.x != null ? `${opts.x}px` : '50%', top: opts.y != null ? `${opts.y}px` : '50%' } });
  const count = (anim.images || []).length;
  const nodes = (anim.images || []).map((img, i) => {
    const w = (Number(img.width) || 0) * unit;
    const hgt = (Number(img.height) || 0) * unit;
    // the files list their images top layer first (the client brings them to the front from last to first,
    // ui.components.comp_anim_player), so the first image gets the highest z-index
    const style = { width: `${w}px`, height: `${hgt}px`, marginLeft: `${-w / 2}px`, marginTop: `${-hgt / 2}px`, zIndex: String(count - i) };
    let el;
    if (img.type === 'template') {
      el = h('div.anim-item.template', { style }, byId[i + 1] || null);
    } else {
      const url = `url("${animSpriteUrl(img.src)}")`;
      // additive sprites were painted on black: drawn through their own luminance (css .anim-item.add)
      el = h('div.anim-item', { class: img.blendMode === 'add' && 'add', style: { ...style, backgroundImage: url, '--img': url } });
    }
    root.appendChild(el);
    return el;
  });
  parent.appendChild(root);

  let stopped = false;
  let raf = 0;
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  const draw = (t) => {
    const states = sampleAnim(anim, t);
    states.forEach((s, i) => {
      const el = nodes[i];
      el.style.opacity = s.visible ? String(Math.max(0, Math.min(1, s.alpha))) : '0';
      el.style.transform = `translate(${(s.x * unit).toFixed(1)}px, ${(s.y * unit).toFixed(1)}px) rotate(${s.rotation.toFixed(2)}deg) scale(${s.xScale.toFixed(4)}, ${s.yScale.toFixed(4)})`;
    });
  };
  const finish = () => {
    if (stopped) return;
    stopped = true;
    if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
    resolveDone();
  };
  draw(0);
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const tick = () => {
    if (stopped) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const t = (now - t0) * speed;
    draw(Math.min(t, duration));
    if (t >= duration) { finish(); return; }
    raf = requestAnimationFrame(tick);
  };
  if (typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(tick);
  else finish();
  return {
    el: root,
    done,
    duration: duration / speed,
    /** Jump to the last frame and resolve. */
    stop() { if (!stopped) { draw(duration); finish(); } },
  };
}
