'use strict';
/**
 * Widgets shared by the Arena (arena.js, arena-pieces.js) and League screens, after the 1.7.4 client: the avatar
 * portrait, the card thumbnail (getThumbImageOfCard), today's event banner (comp_promotion_banner smallBanner), the
 * opponent info popup (comp_enemyinfo_popup) and the list buttons (attack, info).
 */
import { h, icon, fmt, sprite } from '../dom.js';
import { renderCard } from '../components/card.js';
import { button } from '../components/buttons.js';
import { utcDayStart, DAY_MS } from '../../game/state.js';
import { avatarUrl } from './pvp-view.js';
import { eventBannerInfo, formatHms } from './pvp-events.js';

/**
 * Avatar portrait element (card art of the avatar, falling back to the generic avatar icon).
 * @param {number} index
 * @param {object} ctx
 * @param {{small?: boolean, className?: string}} [opts]
 * @returns {HTMLElement}
 */
export function portrait(index, ctx, opts = {}) {
  const url = avatarUrl(index, ctx.deps, ctx.view.artUrlFor);
  const img = url ? h('img', { src: url, alt: '', draggable: 'false', loading: 'lazy' }) : icon('avatar');
  if (url) img.addEventListener('error', () => { img.replaceWith(icon('avatar')); });
  return h('div.portrait', { class: [opts.small !== false && 'small', opts.className] }, img);
}

/**
 * Thumbnail of a card (the client's getThumbImageOfCard): the art in a thin rarity-coloured frame.
 * @param {{cardId: string, stage?: number}|null} card
 * @param {object} ctx
 * @param {string} [className]
 * @returns {HTMLElement}
 */
export function cardThumb(card, ctx, className) {
  const def = card && ctx.deps.db.get(card.cardId);
  const url = def ? ctx.view.artUrlFor(def, card.stage | 0) : null;
  return h('div.card-thumb', { class: [def ? `rarity-${def.rarity}` : 'unknown', className], title: def ? def.name : '' },
    url ? h('img', { src: url, alt: '', draggable: 'false', loading: 'lazy' }) : sprite('cardslot_question01_thumb'));
}

/**
 * Today's event banner (comp_promotion_banner smallBanner) with its timer, or null.
 * @param {object} ctx
 * @param {(t: {stop: () => void}) => void} [track]  receives the timer so the screen can stop it
 * @returns {HTMLElement|null}
 */
export function eventBanner(ctx, track) {
  const ev = ctx.event();
  const info = eventBannerInfo(ev);
  if (!info) return null;
  const def = info.artCardId && ctx.deps.db.get(info.artCardId);
  const art = def ? ctx.view.artUrlFor(def, 0) : null;
  const endsAt = utcDayStart(ctx.now()) + DAY_MS;
  const timer = h('span.event-timer.num');
  const tick = () => { timer.textContent = formatHms(endsAt - ctx.now()); };
  tick();
  const id = setInterval(() => { if (!timer.isConnected && id) { clearInterval(id); return; } tick(); }, 1000);
  if (track) track({ stop: () => clearInterval(id) });
  return h('div.event-banner', { dataset: { event: info.id }, title: ev.desc || '' },
    art ? h('div.event-art', { style: { backgroundImage: `url("${art}")` } }) : null,
    h('div.event-title', null, info.title),
    h('div.event-headline', null, info.headline),
    info.double ? h('div.event-x2', null, 'x2') : null,
    h('div.event-time', null, timer));
}

/**
 * Opponent info popup body (comp_enemyinfo_popup on pvp_playerinfo_bg): name and portrait, best card, level,
 * stamina, mana and HP bars, Quests and Fights Won.
 * @param {object} info  simInfo() result
 * @param {object} ctx
 * @param {{onAttack?: () => void, attackLabel?: string, onReroll?: () => void, rerollGems?: number}} [opts]
 * @returns {HTMLElement}
 */
function renderSimInfo(info, ctx, opts = {}) {
  const db = ctx.deps.db;
  let best = null;
  if (info.bestCard && db.get(info.bestCard.cardId)) {
    const def = db.get(info.bestCard.cardId);
    const view = ctx.view.defView(def, info.bestCard.stage, info.bestCard.level);
    best = h('div.sim-best', null, renderCard(view, { size: 'compact' }), h('div.sim-best-name', null, def.name));
  } else {
    best = h('div.sim-best', null, h('div.sim-best-empty.panel-inset', null, icon('card-placeholder')), h('div.sim-best-name', null, 'No cards'));
  }
  const statRow = (iconName, text, kind) => h('div.sim-stat', { class: kind },
    icon(iconName), h('div.sim-stat-bar', null, h('span.sim-stat-text', null, text), h('div.bar', { class: kind }, h('div.bar-fill.bottom', { style: { width: '100%' } }))));
  return h('div.sim-info', null,
    h('div.sim-head', null, portrait(info.avatar, ctx), h('div.sim-name', null, info.name)),
    h('div.sim-body.panel-inset', null,
      best,
      h('div.sim-right', null,
        h('div.sim-stats.panel', null,
          statRow('star', `Level ${fmt(info.level)}`, 'xp'),
          statRow('stamina-crystal', `${fmt(info.stamina)}/${fmt(info.stamina)}`, 'stamina'),
          statRow('mana-drop', `${fmt(info.mana)}/${fmt(info.mana)}`, 'mana'),
          statRow('heart', fmt(info.hp), 'hp')),
        h('div.sim-facts', null,
          h('div.sim-fact', null, h('span', null, 'Quests'), h('span.num', null, fmt(info.quests))),
          h('div.sim-fact', null, h('span', null, 'Fights Won'), h('span.num', null, fmt(info.battlesWon)))))),
    opts.onAttack || opts.onReroll ? h('div.sim-actions', null,
      // comp_enemyinfo_popup: the nextEnemyBtn with its price and the rerollLabel stacked (fits the button box)
      opts.onReroll ? button(h('span.sim-reroll-content', null,
        h('span.sim-reroll-label', null, 'Reroll opponent'),
        h('span.gem-price', null, h('span.num', null, String(opts.rerollGems || 0)), sprite('hud_gemicon01'))), { size: 'sm', className: 'sim-reroll', onClick: opts.onReroll }) : null,
      opts.onAttack ? attackButton(opts.attackLabel || `Attack ${info.name}`, opts.onAttack, 'sim-attack') : null) : null);
}

/**
 * Open the opponent info dialog. Resolves with 'attack' (fight button) or 'reroll' ("Reroll opponent").
 * @param {object} info
 * @param {object} ctx
 * @param {{canAttack?: boolean, rerollGems?: number}} [opts]
 * @returns {Promise<'attack'|'reroll'|null>}
 */
export function showSimInfo(info, ctx, opts = {}) {
  const dlg = ctx.ui.dialog.open({ body: null, buttons: [], className: 'dialog-sim-info' });
  const body = renderSimInfo(info, ctx, {
    onAttack: opts.canAttack === false ? null : () => dlg.close('attack'),
    onReroll: opts.rerollGems ? () => dlg.close('reroll') : null,
    rerollGems: opts.rerollGems,
  });
  dlg.el.querySelector('.dialog').appendChild(h('div.dialog-body.sim-dialog-body', null, body));
  return dlg;
}

/**
 * The blue attack button of the lists (button_default plate with the icon_pvp swords).
 * @param {string} label  aria-label
 * @param {() => void} onClick
 * @param {string} [className]
 * @returns {HTMLButtonElement}
 */
export function attackButton(label, onClick, className) {
  return /** @type {HTMLButtonElement} */ (h('button.pvp-attack', { type: 'button', class: className, 'aria-label': label, title: label, onClick },
    sprite('icon_pvp_active', { class: 'pvp-attack-icon' })));
}

/**
 * The small info button (hud_smallbutton_frame + fill with info_icon).
 * @param {string} label
 * @param {() => void} onClick
 * @param {string} [className]
 * @returns {HTMLButtonElement}
 */
export function infoButton(label, onClick, className) {
  return /** @type {HTMLButtonElement} */ (h('button.pvp-info', { type: 'button', class: className, 'aria-label': label, title: label, onClick },
    sprite('info_icon', { class: 'pvp-info-icon' })));
}
