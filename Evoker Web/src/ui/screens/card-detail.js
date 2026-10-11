'use strict';
/**
 * Card detail screen (brief §4.6): name plate with "+" marks, tribe emblem, big art with direction arrows,
 * rarity label + 5 pips, level bar, stats panel (ATK / HP / mana, ability text in orange), magnifier (zoom)
 * and "$" (sell, owned cards only, never for cards in the deck).
 * params: { uid } for an owned card, or { cardId, stage?, level? } for a catalog card (collections, boosters).
 */
import { h, icon, fmt } from '../dom.js';
import { renderCard, cardNameWithPlus, sprite } from '../components/card.js';
import { button } from '../components/buttons.js';
import { sellCard, sellValueOf, isInDeck } from '../../game/collection.js';
import { getCard } from '../../game/state.js';
import { pieceHuntFor } from './cards-helpers.js';

/**
 * Render the detail screen.
 * @param {object} ctx  ScreenContext
 */
export function render(ctx) {
  const params = ctx.params || {};
  const state = ctx.store.get();
  const inst = params.uid ? getCard(state, params.uid) : null;
  const def = ctx.db.get(inst ? inst.cardId : params.cardId);

  // No bottom nav, like the original's full-screen card view: the HUD's back arrow returns.
  ctx.chrome.mount({ active: 'cards', back: true, help: 'card-detail', hideNav: true });
  const body = h('div.screen-body.card-detail-screen');
  ctx.root.appendChild(body);

  if (!def) {
    body.appendChild(h('div.panel.detail-missing', null,
      h('p', null, params.uid ? 'This card is no longer in your collection.' : 'Unknown card.'),
      button('Back', { onClick: () => ctx.back('cards') })));
    return;
  }

  const view = inst
    ? ctx.view.cardView(inst, def)
    : ctx.view.defView(def, params.stage || 0, params.level || 1);
  const inDeck = inst ? isInDeck(state, inst.uid) : false;
  const price = inst ? sellValueOf(state, ctx.deps, inst.uid) : 0;

  const actions = [{ icon: 'magnifier', label: 'Zoom', onClick: () => openZoom(ctx, view) }];
  if (inst) {
    actions.push({
      icon: 'dollar', label: inDeck ? 'Cards in your deck cannot be sold' : `Sell for ${fmt(price)} gold`,
      onClick: () => sell(ctx, inst, def, price, inDeck),
    });
  }
  // a catalog card with a running piece hunt shows its puzzle pieces over the art
  const pieces = inst ? null : pieceHuntFor(state, def.id);
  const card = renderCard(view, { size: 'detail', actions, pieces: pieces || undefined });
  if (inDeck) card.classList.add('in-deck');
  if (params.fused) card.classList.add('just-fused');

  const meta = h('div.detail-meta', null,
    inst ? h('span.meta-chip', { class: inDeck && 'deck' }, sprite(inDeck ? 'cardindeck' : 'hud_coinsicon01'), inDeck ? 'In your deck' : `Sells for ${fmt(price)}`) : h('span.meta-chip', null, icon('cards'), 'Catalog card'),
    view.abilityValue != null ? h('span.meta-chip.ability', null, sprite('hud_specialskill01'), h('span.num', null, fmt(view.abilityValue))) : null,
    h('span.meta-chip.set', null, setLabel(ctx, def)));

  body.append(h('div.detail-backdrop', { class: `tribe-${view.tribe}` }), h('div.detail-stack', null, card, meta));
}

/**
 * Human name of the card's set.
 * @param {object} ctx
 * @param {object} def
 * @returns {string}
 */
function setLabel(ctx, def) {
  const q = ctx.deps && ctx.deps.quests;
  if (q) {
    const lines = [q.main, ...(q.portals || [])];
    const line = lines.find((l) => l && l.id === def.set);
    if (line) return line.name;
  }
  return def.set ? String(def.set).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Main';
}

/**
 * Full-stage art zoom overlay; tap or Escape closes it.
 * @param {object} ctx
 * @param {object} view
 */
function openZoom(ctx, view) {
  const img = h('img', { src: view.artUrl || view.artFallbackUrl || '/assets/ui/card-placeholder.svg', alt: view.name, draggable: 'false' });
  const overlay = h('div.art-zoom', { role: 'dialog', 'aria-label': `${cardNameWithPlus(view.name, view.stage)} artwork`, tabIndex: 0 },
    img, h('div.art-zoom-name.plate', null, cardNameWithPlus(view.name, view.stage)), h('div.art-zoom-hint', null, 'Tap to close'));
  const close = () => { window.removeEventListener('keydown', onKey, true); overlay.classList.add('closing'); setTimeout(() => overlay.remove(), 200); };
  const onKey = (ev) => { if (ev.key === 'Escape' || ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); close(); } };
  overlay.addEventListener('click', close);
  window.addEventListener('keydown', onKey, true);
  ctx.root.addEventListener('screen:leave', () => window.removeEventListener('keydown', onKey, true), { once: true });
  ctx.root.appendChild(overlay);
  setTimeout(() => overlay.focus({ preventScroll: true }), 30);
}

/**
 * Sell flow: confirm dialog, store update, toast, back.
 * @param {object} ctx
 * @param {object} inst
 * @param {object} def
 * @param {number} price
 * @param {boolean} inDeck
 */
async function sell(ctx, inst, def, price, inDeck) {
  if (inDeck) { ctx.ui.toast('Cards in your deck cannot be sold', { icon: 'lock' }); return; }
  const ok = await ctx.ui.dialog.confirm({
    title: 'Sell card',
    message: h('span', null, `Sell ${cardNameWithPlus(def.name, inst.stage)} (Level ${inst.level}) for `, h('span.gold-text.num', null, fmt(price)), ' gold?'),
    okLabel: 'Sell', danger: true,
  });
  if (!ok) return;
  let info;
  try {
    info = ctx.store.update((s, deps) => sellCard(s, deps, inst.uid));
  } catch (err) {
    ctx.ui.toast(err.message || 'Cannot sell this card', { icon: 'lock' });
    return;
  }
  ctx.sfx('sell');
  ctx.ui.toast(`Sold for ${fmt(info ? info.gold : price)} gold`, { icon: 'coin' });
  ctx.back('cards');
}

/** Screen registry entry (src/ui/screens/index.js); the router's `screen:leave` closes the zoom's key listener. */
export const screen = { render };
