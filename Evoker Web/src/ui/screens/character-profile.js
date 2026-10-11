'use strict';
/**
 * Profile view of the character screen (ui.screens.playerinfo, the user's screenshot profile-top-tap.png): avatar +
 * name, Best card, Stats bars with the Bonus column, Quest, Battles won, Your cards n/100, Support (the help pages).
 * Tapping the avatar picks one of 12 card portraits, tapping the name renames. Points left over from older saves
 * (normally spent in the level-up dialog, popup-levelup.js) get the stat-point panel under the profile.
 */
import { h, icon, sprite, spriteUrl, fmt } from '../dom.js';
import { button } from '../components/buttons.js';
import { spendStatPoints, editProfile, STAT_POINTS_PER_LEVEL } from '../../game/player.js';
import { ATTRIBUTES } from '../components/popup-levelup.js';
import { bestCard, COLLECTION_LIMIT } from '../../game/collection.js';
import { emptyAllocation, adjustAllocation, allocationPreview, hasUnspentPoints, cleanName, avatarIds } from './profile-view.js';

/** Same rows, order and sprites as the level-up dialog (comp_levelup: Health, Stamina, Mana). */
const STAT_ROWS = ATTRIBUTES.map((a) => ({ key: a.id, label: a.label, sprite: a.sprite, per: a.mult, cls: a.id }));

/**
 * Art URL of an avatar index.
 * @param {object} ctx
 * @param {number} index
 * @returns {string|null}
 */
function avatarUrl(ctx, index) {
  const ids = avatarIds(ctx.deps.names);
  const def = ctx.db.get(ids[index] || ids[0]);
  return def ? ctx.view.artUrlFor(def, 0) : null;
}

/**
 * Avatar picker dialog (12 card portraits).
 * @param {object} ctx
 */
async function pickAvatar(ctx) {
  const ids = avatarIds(ctx.deps.names);
  const current = ctx.store.get().player.avatar | 0;
  const dlg = ctx.ui.dialog.open({ title: 'Choose your avatar', className: 'dialog-avatars', buttons: [] });
  const grid = h('div.avatar-grid', null, ids.map((id, i) => {
    const def = ctx.db.get(id);
    return h('button.portrait.avatar-choice', {
      type: 'button', class: i === current && 'current', 'aria-label': def ? def.name : id, title: def ? def.name : id,
      onClick: () => dlg.close(i),
    }, def ? h('img', { src: ctx.view.artUrlFor(def, 0), alt: '', loading: 'lazy' }) : icon('avatar'));
  }));
  dlg.el.querySelector('.dialog').appendChild(grid);
  const choice = await dlg;
  if (choice === null || choice === undefined || choice === current) return;
  ctx.store.update((s) => editProfile(s, { avatar: choice }));
  ctx.rerender();
}

/**
 * Change-name dialog.
 * @param {object} ctx
 */
async function changeName(ctx) {
  const input = h('input.name-input', { type: 'text', maxLength: 20, value: ctx.store.get().player.name, placeholder: 'Your name', autocomplete: 'off', spellcheck: 'false' });
  const promise = ctx.ui.dialog.open({
    title: 'Change name',
    body: h('div.name-form', null, h('p', null, 'How shall the realm know you?'), input),
    buttons: [{ label: 'Cancel', value: false, variant: 'grey' }, { label: 'OK', value: true, autofocus: true }],
  });
  setTimeout(() => { input.focus(); input.select(); }, 60);
  const ok = await promise;
  if (!ok) return;
  const cleaned = cleanName(input.value);
  if (!cleaned.ok) { ctx.ui.toast('Please enter a name.'); return; }
  ctx.store.update((s) => editProfile(s, { name: cleaned.name }));
  ctx.ui.toast(`Welcome, ${cleaned.name}!`);
  ctx.rerender();
}

/**
 * The stat-point allocation panel with +/- spinners and Confirm.
 * @param {object} ctx
 * @returns {HTMLElement}
 */
function statPointsPanel(ctx) {
  let alloc = emptyAllocation();
  const player = () => ctx.store.get().player;
  const header = h('div.stat-points-head', null,
    h('span', null, 'Stat points'),
    h('span.stat-points-left.num'),
    hasUnspentPoints(player()) ? h('span.badge.stat-badge', { 'aria-label': 'Unspent points' }, '!') : null);
  const rowsEl = h('div.stat-rows');
  const confirm = button('Confirm', { variant: 'green', onClick: () => doConfirm() });
  const rows = {};
  for (const r of STAT_ROWS) {
    const dec = button('−', { size: 'sm', title: `Less ${r.label}`, className: 'spin dec', onClick: () => bump(r.key, -1) });
    const inc = button('+', { size: 'sm', title: `More ${r.label}`, className: 'spin inc', onClick: () => bump(r.key, +1) });
    dec.setAttribute('aria-label', `Less ${r.label}`);
    inc.setAttribute('aria-label', `More ${r.label}`);
    const cur = h('span.stat-cur.num');
    const add = h('span.stat-add.num');
    const next = h('span.stat-next.num');
    rows[r.key] = { dec, inc, cur, add, next };
    rowsEl.appendChild(h('div.stat-row', { class: r.cls, dataset: { stat: r.key } },
      h('span.stat-label', null, sprite(r.sprite, { class: 'icon' }), r.label),
      cur,
      h('span.stat-spinner', null, dec, add, inc),
      next,
      h('span.stat-per.muted', null, `+${r.per} / pt`)));
  }
  function refresh() {
    const p = player();
    const pv = allocationPreview(p, alloc);
    header.querySelector('.stat-points-left').textContent = `${pv.remaining} left`;
    for (const r of STAT_ROWS) {
      const el = rows[r.key];
      const base = r.key === 'hp' ? p.hpMax : (r.key === 'mana' ? p.manaMax : p.staminaMax);
      el.cur.textContent = fmt(base);
      el.add.textContent = String(alloc[r.key] | 0);
      el.add.classList.toggle('on', (alloc[r.key] | 0) > 0);
      el.next.textContent = fmt(r.key === 'hp' ? pv.preview.hpMax : (r.key === 'mana' ? pv.preview.manaMax : pv.preview.staminaMax));
      el.next.classList.toggle('on', (alloc[r.key] | 0) > 0);
      el.dec.disabled = !pv.canDec[r.key];
      el.inc.disabled = !pv.canInc[r.key];
    }
    confirm.disabled = !pv.canConfirm;
  }
  function bump(key, delta) {
    alloc = adjustAllocation(alloc, key, delta, player().statPoints);
    ctx.sfx('ui_button_switch');
    refresh();
  }
  function doConfirm() {
    const pv = allocationPreview(player(), alloc);
    if (!pv.canConfirm) return;
    try {
      ctx.store.update((s) => spendStatPoints(s, alloc));
      ctx.sfx('ui_button_circular');
      ctx.ui.toast(`${pv.total} stat point${pv.total === 1 ? '' : 's'} spent!`, { icon: 'star' });
      ctx.rerender();
    } catch (err) {
      ctx.ui.toast(err.message);
    }
  }
  refresh();
  const unspent = hasUnspentPoints(player());
  return h('div.stat-points.panel', { class: unspent && 'has-points' },
    header,
    h('p.stat-points-hint.muted', null, unspent
      ? 'Unspent points: 1 point = +30 health, +1 stamina or +1 mana.'
      : `Every level-up gives ${STAT_POINTS_PER_LEVEL} points, spent in the level-up dialog.`),
    h('div.stat-cols.muted', null, h('span'), h('span', null, 'Now'), h('span', null, 'Add'), h('span', null, 'After'), h('span')),
    rowsEl,
    h('div.stat-points-actions', null, confirm));
}

/**
 * One bar of the profile's stats box (resourcebg_big: star / stamina / mana / heart rows): the text over the dark
 * track and the coloured line at its bottom (progressbar, txtTemplate "Level #level#", "#value#/#max#", "#max#").
 * @param {'xp'|'stamina'|'mana'|'hp'} kind
 * @param {number} value
 * @param {number} max
 * @param {string} text
 * @returns {HTMLElement}
 */
function infoBar(kind, value, max, text) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return h('div.pi-bar.profile-bar', { class: kind, dataset: { stat: kind } },
    h('span.pi-bar-text.bar-label', null, text),
    h('span.pi-bar-line', { style: { width: `${Math.round(pct * 1000) / 10}%` } }));
}

/**
 * Profile (ui.screens.playerinfo: playername / bestcard / stats / buttonbar components, the user's screenshot
 * profile-top-tap.png): avatar and name, "Best card" with its art, "Stats" (level, stamina, mana, health bars on
 * resourcebg_big) with the "Bonus" column, Quest, Battles won, Your cards n/100, and the Support button.
 * The avatar opens the portrait picker and the name the change-name dialog (the client's Change name button
 * only showed for renamable accounts). Points left over from older saves get the stat-point panel below.
 * @param {object} ctx
 * @returns {HTMLElement}
 */
export function profileView(ctx) {
  const state = ctx.store.get();
  const p = state.player;
  const deps = ctx.deps;
  const xpNext = deps.stats.playerXpToNext(p.level);
  const best = bestCard(state, deps);
  const bestDef = best ? ctx.db.get(best.cardId) : null;
  const bestUrl = bestDef ? ctx.view.artUrlFor(bestDef, best.stage | 0) : null;
  const url = avatarUrl(ctx, p.avatar | 0);
  const bonus = (kind) => h('div.pi-bonus', { class: kind }, '-');

  const panel = h('div.pi-panel.profile-card', null,
    h('div.pi-player', null,
      h('button.pi-avatar.profile-avatar', { type: 'button', 'aria-label': 'Change avatar', title: 'Change avatar', onClick: () => pickAvatar(ctx) },
        h('img', { src: url || spriteUrl('default_player'), alt: '' })),
      h('button.pi-name.profile-name', { type: 'button', title: 'Change name', onClick: () => changeName(ctx) }, p.name || 'Evoker')),
    h('div.pi-best.profile-best', { role: best ? 'button' : undefined, tabIndex: best ? 0 : undefined, onClick: best ? () => ctx.go('card-detail', { uid: best.uid }) : undefined },
      h('div.pi-best-label', null, 'Best card'),
      h('div.pi-best-name', null, bestDef ? bestDef.name : ''),
      h('div.pi-best-card.card-thumb', { class: bestDef ? `rarity-${bestDef.rarity}` : 'empty' },
        bestUrl ? h('img', { src: bestUrl, alt: bestDef.name }) : sprite('cardslot_question01_thumb'))),
    h('div.pi-stats', null,
      h('div.pi-stats-label', null, 'Stats'),
      h('div.pi-bonus-label', null, 'Bonus'),
      h('div.pi-stats-bg', null,
        infoBar('xp', p.xp, xpNext, `Level ${p.level}`),
        infoBar('stamina', p.stamina, p.staminaMax, `${fmt(p.stamina)}/${fmt(p.staminaMax)}`),
        infoBar('mana', p.mana, p.manaMax, `${fmt(p.mana)}/${fmt(p.manaMax)}`),
        infoBar('hp', p.hpMax, p.hpMax, fmt(p.hpMax))),
      h('div.pi-bonuses', null, bonus('xp'), bonus('stamina'), bonus('mana'), bonus('hp'))),
    h('div.pi-facts', null,
      h('div.pi-fact.profile-stat', { dataset: { fact: 'quests' } }, h('span', null, 'Quest'), h('span.num', null, fmt(p.questsDone || 0))),
      h('div.pi-fact.profile-stat', { dataset: { fact: 'battles' } }, h('span', null, 'Battles won'), h('span.num', null, fmt(p.battlesWon || 0))),
      h('div.pi-fact.profile-stat', { dataset: { fact: 'cards' } }, h('span', null, 'Your cards'), h('span.num', null, `${state.cards.length}/${COLLECTION_LIMIT}`))),
    h('div.pi-buttons', null,
      h('div.pi-support-label', null, 'Support'),
      h('button.pi-support', { type: 'button', 'aria-label': 'Support', title: 'Support', onClick: () => ctx.go('help', { topic: 'character' }) },
        sprite('help_icon_active', { class: 'pi-support-icon' }))));

  return h('div.tab-profile', null, panel, hasUnspentPoints(p) ? statPointsPanel(ctx) : null);
}
