'use strict';
/**
 * Set collections screen (the client's album, collection-1_v174): one page per set (Main + every portal),
 * arrows to switch, a thin "n/8" progress bar, a compact "Reward: / 4600 Gems" row with the gem tile under a
 * padlock until the set is complete (then Claim, then Claimed), and the set's cards as art-only tiles in their
 * rarity frames (no names, no stats), greyed with a padlock when not owned. params: { set?: setId }.
 */
import { h, fmt, mount, keyActivate } from '../dom.js';
import { renderPieces, sprite } from '../components/card.js';
import { button, arrowButton } from '../components/buttons.js';
import { progressBar } from '../components/bars.js';
import { setCollections, claimCollection, markAlbumSeen } from '../../game/shop.js';
import { collectionPageIndex, collectionProgressText, bestOwnedInstance, pieceHuntFor } from './cards-helpers.js';

/** Page memory so a store update does not jump back to the first set. */
const memory = { params: null, index: 0 };

/**
 * Render the collections screen.
 * @param {object} ctx  ScreenContext
 */
export function render(ctx) {
  ctx.chrome.mount({ active: 'cards', back: true, help: 'collections' });
  const body = h('div.screen-body.collections-screen');
  ctx.root.appendChild(body);
  const sets = setCollections(ctx.store.get(), ctx.deps);
  if (ctx.params !== memory.params) {
    memory.params = ctx.params;
    memory.index = collectionPageIndex(sets, ctx.params && ctx.params.set);
  }
  if (!sets.length) {
    body.appendChild(h('div.panel.empty-panel', null, h('p.empty-note', null, 'No card sets are available.')));
    return;
  }
  paint(ctx, body);
}

/**
 * Paint the current page.
 * @param {object} ctx
 * @param {HTMLElement} body
 */
function paint(ctx, body) {
  const state = ctx.store.get();
  const sets = setCollections(state, ctx.deps);
  memory.index = collectionPageIndex(sets, memory.index);
  const set = sets[memory.index];
  const turn = (delta) => { memory.index = collectionPageIndex(sets, memory.index + delta); paint(ctx, body); };

  const header = h('div.set-header', null,
    arrowButton('left', { onClick: () => turn(-1), className: 'set-arrow' }),
    h('div.set-title.plate', null, h('span.set-name', null, set.name), h('span.set-index', null, `(${memory.index + 1}/${sets.length})`)),
    arrowButton('right', { onClick: () => turn(1), className: 'set-arrow' }));

  const progress = progressBar({ value: set.ownedCount, max: set.total, kind: 'hp', label: collectionProgressText(set), className: 'set-progress', fillBottom: true });
  progress.classList.toggle('complete', set.complete);

  // gem reward on albumreward_bg: hud_gemicon01 under lock_small until the set is complete, albumglow_00 behind Claim
  let rewardAction;
  if (set.claimed) rewardAction = h('div.reward-box.claimed', null, sprite('hud_gemicon01'), h('span', null, 'Claimed'));
  else if (set.complete) {
    rewardAction = h('div.claim-wrap', null, sprite('albumglow_00', { class: 'claim-glow' }),
      button(h('span.row', null, 'Claim', sprite('hud_gemicon01')), { variant: 'green', className: 'claim-btn', onClick: () => claim(ctx, body, set) }));
  } else rewardAction = h('div.reward-box.locked', { title: 'Collect every card of the set' }, sprite('hud_gemicon01'), sprite('lock_small', { class: 'lock' }));
  const reward = h('div.set-reward.panel', { class: set.complete && 'complete' },
    h('div.reward-text', null, h('div.reward-label', null, 'Reward:'), h('div.reward-value', null, `${set.reward} Gems`)),
    rewardAction);

  const grid = h('div.set-grid.panel');
  // owned cards this album has not shown yet glow once (the client's new-card animation) and clear the "!" badge
  const seen = new Set((state.collections && state.collections.seen) || []);
  const fresh = set.cards.filter((c) => c.owned && !seen.has(c.cardId)).map((c) => c.cardId);
  for (const entry of set.cards) {
    const def = ctx.db.get(entry.cardId);
    if (!def) continue;
    const owned = entry.owned ? bestOwnedInstance(state, entry.cardId) : null;
    const view = owned ? ctx.view.cardView(owned, def) : ctx.view.defView(def, 0, 1);
    grid.appendChild(h('div.set-tile', { class: [entry.owned && 'owned', fresh.includes(entry.cardId) && 'new'] }, albumCard(view, {
      locked: !entry.owned,
      pieces: entry.owned ? null : pieceHuntFor(state, entry.cardId),
      onClick: () => ctx.go('card-detail', owned ? { uid: owned.uid } : { cardId: entry.cardId }),
    })));
  }
  mount(body, header, h('div.set-progress-wrap', null, progress), reward, grid);
  if (fresh.length) ctx.store.update((s) => markAlbumSeen(s, fresh));
}

/**
 * Art-only album card: the art in its rarity frame, greyed with the padlock while not owned, the puzzle
 * pieces of a running hunt over it.
 * @param {object} view  cardView
 * @param {{locked: boolean, pieces: {owned: number, total: number}|null, onClick: () => void}} o
 * @returns {HTMLElement}
 */
function albumCard(view, o) {
  const img = h('img', { src: view.artUrl || view.artFallbackUrl || '/assets/ui/card-placeholder.svg', alt: '', draggable: 'false', loading: 'lazy' });
  if (view.artFallbackUrl) img.addEventListener('error', () => { if (img.src.indexOf(view.artFallbackUrl) < 0) img.src = view.artFallbackUrl; }, { once: true });
  return h('div.card.album-card', {
    class: [`rarity-${view.rarity}`, o.locked && 'locked', o.pieces && 'has-pieces'],
    role: 'button', tabIndex: 0, 'aria-label': view.name, title: view.name,
    dataset: { cardId: view.cardId || view.id, rarity: view.rarity },
    onClick: o.onClick, onKeydown: keyActivate(o.onClick),
  }, h('div.album-art', null, img), o.pieces ? renderPieces(o.pieces.owned, o.pieces.total) : null);
}

/**
 * Claim the gem reward of the shown set.
 * @param {object} ctx
 * @param {HTMLElement} body
 * @param {object} set
 */
function claim(ctx, body, set) {
  let info;
  try {
    info = ctx.store.update((s, deps) => claimCollection(s, deps, set.id));
  } catch (err) {
    ctx.ui.toast(err.message || 'Cannot claim', { icon: 'lock' });
    return;
  }
  ctx.sfx('gems');
  ctx.ui.toast(`+${fmt(info ? info.gems : set.reward)} gems`, { icon: 'gem' });
  if (body.isConnected) paint(ctx, body);
}

/** Screen registry entry (src/ui/screens/index.js). */
export const screen = { render };
