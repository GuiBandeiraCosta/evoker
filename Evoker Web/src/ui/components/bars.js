'use strict';
/**
 * Bars on the original sprites: the generic bar is a dark inset with the coloured hud_progressbar* line
 * (xp yellow, stamina orange, mana blue, hp green, quest violet); tall bars use the hud_progressbar_3slice
 * track (optionally with the round knob of 3slice01, like the quest bar); the HP bar carries
 * hud_healthicon01, the "Mana needed" bar hud_manaicon01 and the hud_progressbar_pinocle01 marker; the card
 * level bar hud_experienceicon01. Every factory returns an element with an `update()` method.
 */
import { h, sprite, fmt } from '../dom.js';

/**
 * Clamp a ratio to 0..1.
 * @param {number} value
 * @param {number} max
 * @returns {number}
 */
export function ratio(value, max) {
  if (!max || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(1, value / max));
}

/**
 * @typedef {object} ProgressBarOptions
 * @property {number} value
 * @property {number} max
 * @property {string|null} [label]  text drawn over the bar; `null` hides it
 * @property {'xp'|'hp'|'mana'|'stamina'|'quest'|'gold'} [kind='hp']
 * @property {boolean} [thin]
 * @property {boolean} [tall]   the 3-slice track (32 px)
 * @property {boolean} [knob]   round knob at the left end of the track (hud_progressbar_3slice01)
 * @property {boolean} [fillBottom]  draw the fill as a thin line at the bottom (HUD style)
 * @property {string} [className]
 */

/**
 * Generic progress bar.
 * @param {ProgressBarOptions} opts
 * @returns {HTMLElement & {update: (value: number, max?: number, label?: string|null) => void}}
 */
export function progressBar(opts) {
  // (an empty class string would replace the element's class attribute, hiding the fill: pass false instead)
  const fill = h('div.bar-fill', { class: opts.fillBottom && 'bottom' });
  const label = h('div.bar-label');
  const el = /** @type {any} */ (h('div.bar', {
    class: [opts.kind || 'hp', opts.thin && 'thin', opts.tall && 'tall', opts.knob && 'knob', opts.className],
    role: 'progressbar',
  }, fill, label));
  el.update = (value, max = opts.max, text = opts.label) => {
    opts.value = value; opts.max = max; opts.label = text;
    const r = ratio(value, max);
    fill.style.width = (r * 100).toFixed(2) + '%';
    el.style.setProperty('--pct', r.toFixed(4));
    label.textContent = text === null || text === undefined ? '' : text;
    el.setAttribute('aria-valuenow', String(Math.round(value)));
    el.setAttribute('aria-valuemax', String(Math.round(max)));
  };
  el.update(opts.value, opts.max, opts.label === undefined ? `${fmt(opts.value)} / ${fmt(opts.max)}` : opts.label);
  return el;
}

/**
 * Player HP bar with the green heart (battle screen).
 * @param {{cur: number, max: number, className?: string}} opts
 * @returns {HTMLElement & {update: (cur: number, max?: number) => void}}
 */
export function hpBar(opts) {
  const bar = progressBar({ value: opts.cur, max: opts.max, kind: 'hp', tall: true, fillBottom: true });
  const el = /** @type {any} */ (h('div.hp-bar-wrap.bar-with-icon', { class: opts.className }, sprite('hud_healthicon01', { class: 'icon' }), bar));
  el.update = (cur, max = opts.max) => {
    opts.cur = cur; opts.max = max;
    // the number may go below 0 (overkill), as in the original; only the fill stops at empty
    bar.update(Math.max(0, cur), max, `${fmt(cur)} / ${fmt(max)}`);
  };
  el.update(opts.cur, opts.max);
  return el;
}

/**
 * "Mana needed: 22 / 61" bar under the player's row on the pre-battle screen.
 * The arrow marker sits at the needed/available ratio; the label turns red when over budget.
 * @param {{needed: number, available: number}} opts
 * @returns {HTMLElement & {update: (needed: number, available?: number) => void}}
 */
export function manaNeededBar(opts) {
  const bar = progressBar({ value: opts.needed, max: opts.available, kind: 'mana', tall: true, fillBottom: true });
  const marker = h('div.marker');
  const el = /** @type {any} */ (h('div.mana-needed.bar-with-icon', null, sprite('hud_manaicon01', { class: 'icon' }), bar, marker));
  el.update = (needed, available = opts.available) => {
    opts.needed = needed; opts.available = available;
    bar.update(needed, available, `Mana needed: ${fmt(needed)} / ${fmt(available)}`);
    el.classList.toggle('over', needed > available);
    // marker position relative to the bar: icon (48px) + gap (6px) + padding (18px)
    const pct = ratio(needed, available);
    marker.style.left = `calc(72px + (100% - 90px) * ${pct.toFixed(4)})`;
  };
  el.update(opts.needed, opts.available);
  return el;
}

/**
 * Card level bar: star + "Level n / max" (fill = xp progress towards the next level when given).
 * @param {{level: number, levelCap: number, xp?: number, xpToNext?: number}} opts
 * @returns {HTMLElement & {update: (level: number, levelCap?: number, xp?: number, xpToNext?: number) => void}}
 */
export function levelBar(opts) {
  const bar = progressBar({ value: 0, max: 1, kind: 'xp', label: '' });
  const el = /** @type {any} */ (h('div.card-levelbar', null, sprite('hud_experienceicon01', { class: 'icon' }), bar));
  el.update = (level, levelCap = opts.levelCap, xp = opts.xp, xpToNext = opts.xpToNext) => {
    Object.assign(opts, { level, levelCap, xp, xpToNext });
    const atCap = levelCap && level >= levelCap;
    const value = atCap ? 1 : (xpToNext ? ratio(xp || 0, xpToNext) : 0);
    bar.update(value, 1, levelCap ? `Level ${level} / ${levelCap}` : `Level ${level}`);
  };
  el.update(opts.level, opts.levelCap, opts.xp, opts.xpToNext);
  return el;
}

/**
 * Quest progress bar ("50 %", purple) on the knobbed 3-slice track like the original quest screen.
 * @param {{percent: number}} opts
 * @returns {HTMLElement & {update: (percent: number) => void}}
 */
export function questBar(opts) {
  const bar = progressBar({ value: opts.percent, max: 100, kind: 'quest', tall: true, knob: true, fillBottom: true, label: `${Math.round(opts.percent)}%` });
  const el = /** @type {any} */ (h('div.hp-bar-wrap', null, bar));
  el.update = (percent) => { opts.percent = percent; bar.update(percent, 100, `${Math.round(percent)}%`); };
  return el;
}
