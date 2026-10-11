'use strict';
/**
 * Countdown rendered as d:hh:mm:ss like the original ("8:20:01:39").
 * `formatCountdown` is pure; the component needs a `getNow` function (the app passes Date.now).
 */
import { h, pad } from '../dom.js';

/**
 * Format a duration in ms as d:hh:mm:ss (floored at 0, days unpadded).
 * @param {number} ms
 * @returns {string}
 */
export function formatCountdown(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${days}:${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/**
 * @typedef {object} CountdownOptions
 * @property {number} endsAt  ms epoch when the countdown ends
 * @property {() => number} [getNow]  clock; when omitted the component only updates via update(now)
 * @property {() => void} [onEnd]
 * @property {number} [interval=1000]
 * @property {string} [className]
 */

/**
 * Countdown element with start/stop/update.
 * @param {CountdownOptions} opts
 * @returns {HTMLElement & {update: (now: number) => void, start: () => void, stop: () => void, setEndsAt: (t: number) => void}}
 */
export function createCountdown(opts) {
  const el = /** @type {any} */ (h('span.countdown', { class: opts.className }));
  let timer = null;
  let ended = false;
  let endsAt = opts.endsAt;

  el.update = (now) => {
    const left = endsAt - now;
    el.textContent = formatCountdown(left);
    if (left <= 0 && !ended) {
      ended = true;
      el.stop();
      if (opts.onEnd) opts.onEnd();
    }
  };
  el.start = () => {
    el.stop();
    if (!opts.getNow) return;
    el.update(opts.getNow());
    timer = setInterval(() => {
      if (!el.isConnected) { el.stop(); return; }
      el.update(opts.getNow());
    }, opts.interval || 1000);
  };
  el.stop = () => { if (timer) { clearInterval(timer); timer = null; } };
  el.setEndsAt = (t) => { endsAt = t; ended = false; if (opts.getNow) el.update(opts.getNow()); };

  if (opts.getNow) el.start(); else el.textContent = formatCountdown(endsAt);
  return el;
}
