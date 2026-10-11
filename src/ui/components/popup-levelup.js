'use strict';
/**
 * The player level-up dialog, a port of the 1.7.4 client's `ui.components.comp_levelup` +
 * `comp_levelup_attribute` (driven by `ui.screens.overlays.levelup`): the "Level Up" ribbon (hud_levelup)
 * flashes in, then a dark large-frame panel with "Level up!" / "Reached level N", a "Rewards" column on the
 * left (one special reward image above, the gold amount with a shop_coins pile below) and "Points: x/N" on
 * the right with one row per attribute (Health hud_healthicon02 +30 per point, Stamina hud_stamicon01 +1,
 * Mana hud_manaicon01 +1; value, minus and plus on hud_smallbutton) and "Proceed". N = every unspent stat
 * point (usermanager.getAttributePoints). Proceed spends them: points the player did not place are
 * distributed evenly by the client's rule (`autoDistribute`), counted up one per 250 ms, then the dialog
 * closes. The points are applied with player.spendStatPoints through the store.
 *
 * `showLevelUp(arg, opts)` takes a levelUpDetails entry ({level, rewards, statPoints, unlocked} from
 * player.addPlayerXp), an array of them or a bare level number and opens the dialog(s) in order; it returns a
 * Promise that resolves when the last one closed. (A card's level-up is drawn inside the battle-result overlay.)
 */
import { h, sprite, fmt, getUiRoot } from '../dom.js';
import { button } from './buttons.js';
import {
  levelUpRewards, spendStatPoints, HP_PER_POINT, STAMINA_PER_POINT, MANA_PER_POINT, STAT_POINTS_PER_LEVEL,
} from '../../game/player.js';
import { featuresUnlockedAt } from '../../game/state.js';

/** Delay between two automatically placed points (comp_levelup autoCount: 250 ms). */
export const AUTO_STEP_MS = 250;
/** How long the "Level Up" ribbon shows before the panel (white flash + emblem). */
export const RIBBON_MS = 900;

/**
 * Attribute rows in display order (comp_levelup_layout: hpComp y -10, staminaComp y 30, manaComp y 70).
 * `mult` = what one point adds (usermanager.getLevelupConfig).
 */
export const ATTRIBUTES = Object.freeze([
  Object.freeze({ id: 'hp', label: 'Health', sprite: 'hud_healthicon02', mult: HP_PER_POINT, field: 'hpMax' }),
  Object.freeze({ id: 'stamina', label: 'Stamina', sprite: 'hud_stamicon01', mult: STAMINA_PER_POINT, field: 'staminaMax' }),
  Object.freeze({ id: 'mana', label: 'Mana', sprite: 'hud_manaicon01', mult: MANA_PER_POINT, field: 'manaMax' }),
]);

/* ------------------------------------------------------------------ pure helpers */

/**
 * Distribute the points left over at Proceed, a port of ui.screens.overlays.levelup's autoLevelUp handler:
 * each point goes to the attribute with the fewest points placed so far (ties: mana, then stamina, then
 * health); without the mana feature it alternates stamina / health (ties: stamina).
 * @param {number} pointsLeft
 * @param {{hp?: number, stamina?: number, mana?: number}} placed  points placed by hand in this dialog
 * @param {boolean} [manaUnlocked=true]
 * @returns {{hp: number, stamina: number, mana: number}}  the final distribution (placed + automatic)
 */
export function autoDistribute(pointsLeft, placed = {}, manaUnlocked = true) {
  let mana = placed.mana | 0, stamina = placed.stamina | 0, hp = placed.hp | 0;
  for (let i = 0; i < Math.max(0, pointsLeft | 0); i++) {
    if (!manaUnlocked) {
      if (stamina <= hp) stamina++; else hp++;
    } else if (mana <= stamina && mana <= hp) mana++;
    else if (stamina < mana && stamina <= hp) stamina++;
    else hp++;
  }
  return { hp, stamina, mana };
}

/**
 * The order in which the automatic points are counted up (comp_levelup autoCount: health first, then
 * stamina, then mana), one attribute id per point.
 * @param {{hp: number, stamina: number, mana: number}} placed
 * @param {{hp: number, stamina: number, mana: number}} final
 * @returns {string[]}
 */
export function autoSteps(placed, final) {
  const out = [];
  for (const id of ['hp', 'stamina', 'mana']) {
    for (let i = (placed[id] | 0); i < (final[id] | 0); i++) out.push(id);
  }
  return out;
}

/**
 * Coin pile sprite for a gold amount (comp_levelup: < 500 shop_coins01, < 1000 shop_coins03, else shop_coins04).
 * @param {number} amount
 * @returns {string}
 */
export function coinSprite(amount) {
  if (amount < 500) return 'shop_coins01';
  if (amount < 1000) return 'shop_coins03';
  return 'shop_coins04';
}

/** Booster token sprites (shop). */
const TOKEN_SPRITES = { neophyte: 'token_small', summoner: 'token_medium', archmage: 'token_big' };
const TOKEN_NAMES = { neophyte: 'Neophyte token', summoner: 'Summoner token', archmage: 'Archmage token' };

/**
 * The "Rewards" column of a level: the gold sum (the client adds every "Money" reward) and the one special
 * reward drawn as an image (gems, a potion or a booster token; null when the level only pays gold).
 * @param {{gold?: number, gems?: number, potions?: string[], tokens?: string[]}|null} rewards
 * @returns {{gold: number, special: {kind: string, sprite: string, count: number, label: string}|null}}
 */
export function rewardColumn(rewards) {
  const r = rewards || {};
  const gold = Math.max(0, r.gold | 0);
  let special = null;
  if (r.gems > 0) special = { kind: 'gems', sprite: 'reward_gems', count: r.gems, label: `${fmt(r.gems)} gems` };
  else if (r.potions && r.potions.length) {
    const kind = r.potions[0] === 'mana' ? 'mana' : 'stamina';
    const n = r.potions.filter((p) => p === r.potions[0]).length;
    special = { kind: `potion-${kind}`, sprite: kind === 'mana' ? 'potion_mana1' : 'potion_stamina1', count: n, label: `${n} ${kind} potion${n === 1 ? '' : 's'}` };
  } else if (r.tokens && r.tokens.length) {
    const id = r.tokens[0];
    const n = r.tokens.filter((t) => t === id).length;
    special = { kind: `token-${id}`, sprite: TOKEN_SPRITES[id] || 'token_small', count: n, label: `${n} ${TOKEN_NAMES[id] || 'token'}${n === 1 ? '' : 's'}` };
  }
  return { gold, special };
}

/**
 * Normalise what callers pass: a levelUpDetails entry, a bare level, or an array of either.
 * @param {any} arg
 * @returns {{level: number, rewards: object, statPoints: number, unlocked: string[]}[]}
 */
export function toDetails(arg) {
  const list = Array.isArray(arg) ? arg : [arg];
  const out = [];
  for (const x of list) {
    if (typeof x === 'number' && x >= 2) out.push({ level: x, rewards: levelUpRewards(x), statPoints: STAT_POINTS_PER_LEVEL, unlocked: featuresUnlockedAt(x) });
    else if (x && typeof x === 'object' && x.level >= 2) {
      out.push({
        level: x.level | 0,
        rewards: x.rewards || levelUpRewards(x.level),
        statPoints: x.statPoints != null ? x.statPoints | 0 : STAT_POINTS_PER_LEVEL,
        unlocked: Array.isArray(x.unlocked) ? x.unlocked : featuresUnlockedAt(x.level),
      });
    }
  }
  return out;
}

/**
 * Points the dialog of detail `index` (of `count`) offers: every unspent point on the last dialog (the client
 * shows getAttributePoints), only that level's points on the earlier ones of a multi-level jump.
 * @param {number} unspent  state.player.statPoints when the dialog opens
 * @param {number} levelPoints  the detail's statPoints
 * @param {boolean} last
 * @returns {number}
 */
export function dialogBudget(unspent, levelPoints, last) {
  const u = Math.max(0, unspent | 0);
  return last ? u : Math.min(u, Math.max(0, levelPoints | 0));
}

/* ------------------------------------------------------------------ player dialog */

/**
 * @typedef {object} PlayerLevelUpOptions
 * @property {{get: () => object, update: (fn: Function) => any}} [store]  applies the points (spendStatPoints)
 * @property {object} [player]   player record to read the values from when there is no store
 * @property {boolean} [manaUnlocked=true]  hide the mana row when false (client isGameFeatureUnlocked('mana'))
 * @property {(name: string) => void} [sfx]  original sound names
 * @property {(features: string[], detail: object) => Promise<any>|any} [onUnlocked]  feature popups after the dialog
 * @property {boolean} [instant]  no ribbon and no count-up (tests, reduced motion)
 * @property {number} [index]    position in a multi-level sequence (budget rule)
 * @property {number} [count]
 */

/**
 * Build the dialog panel (no backdrop, no behaviour besides the +/- buttons). Exposed for the gallery.
 * @param {{level: number, rewards: object}} detail
 * @param {{values: Record<string, number>, budget: number, manaUnlocked?: boolean}} model
 * @returns {HTMLElement & {setPlaced: (placed: object, pointsLeft: number) => void, rows: Record<string, HTMLElement>, proceed: HTMLButtonElement}}
 */
export function renderPlayerLevelUp(detail, model) {
  const col = rewardColumn(detail.rewards);
  const rows = {};
  const attrRows = ATTRIBUTES.filter((a) => a.id !== 'mana' || model.manaUnlocked !== false).map((a) => {
    const minus = h('button.lvl-btn.minus', { type: 'button', 'aria-label': `${a.label} -1`, dataset: { attr: a.id, delta: '-1' } },
      sprite('minus_icon_active', { class: 'on' }), sprite('minus_icon_inactive', { class: 'off' }));
    const plus = h('button.lvl-btn.plus', { type: 'button', 'aria-label': `${a.label} +1`, dataset: { attr: a.id, delta: '1' } },
      sprite('plus_icon_active', { class: 'on' }), sprite('plus_icon_glow', { class: 'glow' }), sprite('plus_icon_inactive', { class: 'off' }));
    const value = h('span.lvl-attr-value', null, String(model.values[a.id]));
    const row = h('div.lvl-attr', { class: a.id, dataset: { attr: a.id } },
      sprite(a.sprite, { class: 'lvl-attr-icon', alt: a.label, title: `${a.label}: +${a.mult} per point` }), value, minus, plus);
    rows[a.id] = /** @type {any} */ (Object.assign(row, { value, minus, plus, attr: a }));
    return row;
  });
  const left = h('span.lvl-points-left', null, String(model.budget));
  const proceed = button('Proceed', { className: 'lvl-proceed' });
  const panel = /** @type {any} */ (h('div.dialog.panel.lvl-panel', null,
    h('div.lvl-head', null,
      h('div.lvl-title', null, 'Level up!'),
      h('div.lvl-reached', null, `Reached level ${detail.level}`)),
    h('div.lvl-sep'),
    h('div.lvl-cols', null,
      h('div.lvl-rewards', null,
        h('div.lvl-col-title', null, 'Rewards'),
        h('div.lvl-special', null, col.special ? [
          sprite(col.special.sprite, { class: ['lvl-special-img', col.special.kind], alt: col.special.label, title: col.special.label }),
          col.special.count > 1 || col.special.kind === 'gems' ? h('span.lvl-special-count', null, fmt(col.special.count)) : null,
        ] : null),
        h('div.lvl-coins', null, h('span.lvl-coins-amount', null, fmt(col.gold)), sprite(coinSprite(col.gold), { class: 'lvl-coins-img', alt: 'gold' }))),
      h('div.lvl-vsep'),
      h('div.lvl-points', null,
        h('div.lvl-col-title', null, 'Points: ', h('span.lvl-points-count', null, left, h('span.lvl-points-total', null, `/${model.budget}`))),
        h('div.lvl-attrs', null, attrRows),
        h('div.dialog-buttons.lvl-buttons', null, proceed)))));
  panel.rows = rows;
  panel.proceed = proceed;
  panel.setPlaced = (placed, pointsLeft) => {
    left.textContent = String(pointsLeft);
    for (const id of Object.keys(rows)) {
      const r = rows[id];
      r.value.textContent = String(model.values[id] + (placed[id] | 0) * r.attr.mult); // plain digits like the client (1620)
      r.minus.disabled = !((placed[id] | 0) > 0);
      r.plus.disabled = !(pointsLeft > 0);
      r.plus.classList.toggle('pulse', pointsLeft > 0);
    }
  };
  return panel;
}

/**
 * Show the player level-up dialog for one level and resolve when it closed (after Proceed and the unlock
 * popups of that level).
 * @param {object|number} detailOrLevel  a levelUpDetails entry or the level reached
 * @param {PlayerLevelUpOptions} [opts]
 * @returns {Promise<{level: number, spent: {hp: number, stamina: number, mana: number}}> & {el: HTMLElement}}
 */
export function showPlayerLevelUp(detailOrLevel, opts = {}) {
  const detail = toDetails(detailOrLevel)[0] || { level: 2, rewards: levelUpRewards(2), statPoints: STAT_POINTS_PER_LEVEL, unlocked: [] };
  const state = opts.store ? opts.store.get() : null;
  const player = (state && state.player) || opts.player || {};
  const last = opts.count == null || opts.index == null || opts.index >= opts.count - 1;
  const unspent = player.statPoints != null ? player.statPoints : detail.statPoints;
  const budget = dialogBudget(unspent, detail.statPoints, last);
  const manaUnlocked = opts.manaUnlocked !== false;
  const values = { hp: player.hpMax | 0, stamina: player.staminaMax | 0, mana: player.manaMax | 0 };
  const sfx = typeof opts.sfx === 'function' ? opts.sfx : () => {};

  const placed = { hp: 0, stamina: 0, mana: 0 };
  let pointsLeft = budget;
  let busy = false;
  const panel = renderPlayerLevelUp(detail, { values, budget, manaUnlocked });
  const ribbon = h('div.lvl-ribbon', { 'aria-hidden': 'true' }, h('div.lvl-flash'), sprite('hud_levelup', { class: 'lvl-ribbon-img' }));
  const backdrop = h('div.dialog-backdrop.lvl-backdrop', { role: 'dialog', 'aria-modal': 'true', 'aria-label': `Level up! Reached level ${detail.level}`, dataset: { level: String(detail.level) } },
    opts.instant ? null : ribbon, panel);
  if (!opts.instant) backdrop.classList.add('intro');
  panel.setPlaced(placed, pointsLeft);

  let resolveFn;
  const promise = /** @type {any} */ (new Promise((resolve) => { resolveFn = resolve; }));
  promise.el = backdrop;

  const change = (id, delta) => {
    if (busy) return;
    if (delta > 0 && pointsLeft <= 0) return;
    if (delta < 0 && !(placed[id] > 0)) return;
    placed[id] += delta;
    pointsLeft -= delta;
    sfx('ui_button_switch');
    panel.setPlaced(placed, pointsLeft);
  };
  for (const id of Object.keys(panel.rows)) {
    const r = panel.rows[id];
    r.minus.addEventListener('click', (ev) => { ev.stopPropagation(); change(id, -1); });
    r.plus.addEventListener('click', (ev) => { ev.stopPropagation(); change(id, 1); });
  }

  const finish = async (final) => {
    window.removeEventListener('keydown', onKey, true);
    backdrop.classList.add('closing');
    setTimeout(() => backdrop.remove(), 230);
    if (typeof opts.onUnlocked === 'function' && detail.unlocked && detail.unlocked.length) {
      try { await opts.onUnlocked(detail.unlocked, detail); } catch (err) { console.error(err); }
    }
    resolveFn({ level: detail.level, spent: final });
  };

  const proceed = () => {
    if (busy) return;
    busy = true;
    backdrop.classList.remove('intro');
    const final = autoDistribute(pointsLeft, placed, manaUnlocked);
    if (opts.store && (final.hp + final.stamina + final.mana) > 0) {
      try { opts.store.update((s) => spendStatPoints(s, final)); } catch (err) { console.error(err); }
    }
    for (const r of Object.values(panel.rows)) { r.minus.disabled = true; r.plus.disabled = true; r.plus.classList.remove('pulse'); }
    panel.proceed.disabled = true;
    const steps = autoSteps(placed, final);
    if (opts.instant || !steps.length) { finish(final); return; }
    steps.forEach((id, i) => setTimeout(() => {
      placed[id] += 1;
      pointsLeft -= 1;
      panel.setPlaced(placed, pointsLeft);
      for (const r of Object.values(panel.rows)) { r.minus.disabled = true; r.plus.disabled = true; r.plus.classList.remove('pulse'); }
      sfx('ui_button_switch');
    }, AUTO_STEP_MS * (i + 1)));
    setTimeout(() => finish(final), AUTO_STEP_MS * (steps.length + 1));
  };
  panel.proceed.addEventListener('click', (ev) => { ev.stopPropagation(); proceed(); });
  // A tap during the ribbon skips it.
  backdrop.addEventListener('click', () => { if (backdrop.classList.contains('intro')) backdrop.classList.remove('intro'); });
  const onKey = (ev) => {
    if (ev.key === 'Enter' || ev.key === 'Escape') {
      ev.preventDefault(); ev.stopPropagation();
      if (backdrop.classList.contains('intro')) backdrop.classList.remove('intro'); else proceed();
    }
  };
  window.addEventListener('keydown', onKey, true);
  getUiRoot().appendChild(backdrop);
  sfx('quest_reward_levelup');
  if (!opts.instant) setTimeout(() => backdrop.classList.remove('intro'), RIBBON_MS);
  setTimeout(() => panel.proceed.focus({ preventScroll: true }), opts.instant ? 30 : RIBBON_MS + 30);
  return promise;
}

/* ------------------------------------------------------------------ entry point */

/**
 * Show the player dialog for each levelUpDetails entry / level in order (the points of a multi-level jump are
 * offered per level, the last dialog takes every unspent point).
 * @param {object|object[]|number|number[]} arg
 * @param {PlayerLevelUpOptions} [opts]
 * @returns {Promise<any>}
 */
export function showLevelUp(arg, opts = {}) {
  const details = toDetails(arg);
  return (async () => {
    const out = [];
    for (let i = 0; i < details.length; i++) {
      // a single entry keeps the caller's position in its own sequence (battle-result calls once per level)
      const seq = details.length > 1 || opts.count == null ? { index: i, count: details.length } : { index: opts.index, count: opts.count };
      out.push(await showPlayerLevelUp(details[i], { ...opts, ...seq }));
    }
    return out;
  })();
}
