'use strict';
/**
 * Cards screen = the client's deck screen (exploration/apk/lua ui.screens.deck.deck_screen) with its three modes:
 *  - deck edit (ctrl_deckedit): "Your Deck" header, the framed box with the 5 deck slots (comp_carddeck), the
 *    "Your cards n/100" plate and the "Mana needed" bar (current mana / max, marker at the deck's need);
 *  - training (ctrl_enhance): "Card Training", Training slot + Sacrifice stack (skull), coin price and OK;
 *  - fusion (ctrl_evolve): "Fuse cards", Slot 1 + Slot 2, coin price and OK.
 * Below: the mode stripe (seperator_big) with three icon buttons (training ←, cards, fusion + with the "!"
 * badge when a fusion is possible; deckeditbutton_locked while a mode is locked) and the card slider
 * (comp_cardslider2): the cards on an arc, the middle one in front, starting scrolled to the left end.
 * Cards move only by drag and drop (pointer events, drag-drop.js): up out of the slider into a slot, out of a
 * slot to put them back; a horizontal swipe scrolls the slider; a tap opens the card detail.
 * `params.tab` picks the mode on entry ('training' | 'fusion', anything else = deck).
 * Stable hooks for the tutorial / QA: `.cards-screen[data-tab]`, `.mode-btn[data-tab]` (+ `.active`, `.locked`),
 * `.deck-row .deck-slot[data-slot]`, `.card-slider .card[data-draggable][data-uid]`, `.cards-zone[data-zone=
 * train|stack|fuse1|fuse2]`, `.training-ok`, `.fusion-ok`, `.cards-fx`; a `slider:reveal` CustomEvent
 * ({ detail: { uid } }) on `.card-slider` turns that card to the front.
 * The slider lives in cards-slider.js, the training / fusion boxes in cards-ops.js, the drop rules in
 * cards-dnd.js and the UI memory they share in cards-state.js.
 */
import { h } from '../dom.js';
import { renderCard, renderEmptySlot, sprite } from '../components/card.js';
import { isUnlocked } from '../../game/state.js';
import {
  MODES, MODE_TITLES, normalizeMode, SLIDER, sliderLimits, sliderEntries, fuseCount, deckSummary, manaNeededText,
  poolCountText, pruneTrainingSelection, pruneFusionSlots,
} from './cards-helpers.js';
import { memory, viewOf } from './cards-state.js';
import { createSlider, isSwipe } from './cards-slider.js';
import { trainingBox, fusionBox } from './cards-ops.js';
import { canDrop, onDrop, onDropInvalid, onDropOutside } from './cards-dnd.js';

/** Mode buttons: client icons (deckedit/enhance/fusion _off = icon, _on = glow) and help ids. */
const MODE_BUTTONS = Object.freeze({
  training: { icon: 'enhance_off', glow: 'enhance_on', label: 'Card Training', feature: 'training', help: 'training' },
  deck: { icon: 'deckedit_off', glow: 'deckedit_on', label: 'Your Deck', feature: null, help: 'cards' },
  fusion: { icon: 'fusion_off', glow: 'fusion_on', label: 'Fuse cards', feature: 'fusion', help: 'fusion' },
});

/**
 * Per-screen-root resources (drag controller, slider). The router renders an incoming screen before it
 * calls `onLeave` on the outgoing one, so they belong to their own root.
 * @type {WeakMap<HTMLElement, {dnd: {destroy: () => void}|null, slider: {destroy: () => void}|null}>}
 */
const live = new WeakMap();

/**
 * Release the drag controller and the slider of a screen root.
 * @param {HTMLElement} root
 */
function release(root) {
  const r = live.get(root);
  if (!r) return;
  if (r.dnd) r.dnd.destroy();
  if (r.slider) r.slider.destroy();
  live.delete(root);
}

/**
 * Render the Cards screen.
 * @param {object} ctx  ScreenContext (architecture §8.1)
 */
export function render(ctx) {
  if (ctx.params !== memory.params) {
    memory.params = ctx.params;
    memory.mode = normalizeMode(ctx.params && ctx.params.tab);
    memory.offsets = {};
  }
  const state = ctx.store.get();
  if (memory.mode !== 'deck' && !isUnlocked(state, MODE_BUTTONS[memory.mode].feature)) memory.mode = 'deck';
  // the help button reads `help` when tapped, so a mode switch only updates this object (no second mount)
  memory.chrome = { active: 'cards', back: true, help: MODE_BUTTONS[memory.mode].help };
  ctx.chrome.mount(memory.chrome);
  const body = h('div.screen-body.cards-screen', { dataset: { tab: memory.mode } });
  ctx.root.appendChild(body);
  paint(ctx, body);
}

/**
 * Destroy the drag controller and the slider when the screen goes away.
 * @param {object} ctx
 */
export function onLeave(ctx) {
  release(ctx.root);
}

/**
 * (Re)build the whole body for the current mode.
 * @param {object} ctx
 * @param {HTMLElement} body
 */
function paint(ctx, body) {
  release(ctx.root);
  const state = ctx.store.get();
  const mode = memory.mode;
  body.dataset.tab = mode;
  const repaint = () => { if (body.isConnected) paint(ctx, body); };

  const pruned = pruneTrainingSelection(state, memory.trainUid, memory.sacrifices);
  memory.trainUid = pruned.trainUid;
  memory.sacrifices = pruned.sacrifices;
  memory.fuse = pruneFusionSlots(state, memory.fuse);

  const box = mode === 'training' ? trainingBox(ctx, state, repaint) : mode === 'fusion' ? fusionBox(ctx, state, repaint) : deckBox(ctx, state);
  const title = h('div.cards-title', null, MODE_TITLES[mode]);
  const stripe = modeStripe(ctx, state, body);
  const sliderEl = h('div.card-slider', { 'aria-label': 'Your cards' });
  body.replaceChildren(sliderEl, title, box, stripe);

  // slider cards
  const entries = sliderEntries(state, ctx.deps, mode, { trainUid: memory.trainUid, sacrifices: memory.sacrifices, fuse: memory.fuse });
  const cards = entries.map((e) => {
    if (e.kind === 'piece') {
      const el = renderCard(ctx.view.defView(e.def, 0, 1), { size: 'compact', draggable: true, pieces: { owned: e.owned, total: e.total }, className: 'piece-card' });
      el.dataset.piece = e.cardId;
      return el;
    }
    return renderCard(viewOf(ctx, e.inst), { size: 'compact', draggable: true, className: state.deck.includes(e.uid) && 'in-deck' });
  });
  const limits = sliderLimits(cards.length);
  const start = memory.offsets[mode] != null ? memory.offsets[mode] : SLIDER.START;
  // a card just put into the training slot makes the slider glide to its end (onDrop sets snapEnd)
  const snapEnd = memory.snapEnd && mode === 'training';
  if (snapEnd) memory.snapEnd = false;
  const slider = createSlider(sliderEl, {
    cards,
    offset: Math.max(limits.min, Math.min(limits.max, start)),
    getScale: () => stageScale(ctx),
    onChange: (o) => { memory.offsets[mode] = o; },
    snapEnd,
  });

  const dnd = ctx.ui.createDragDrop({
    container: ctx.root,
    slotSelector: '.deck-slot[data-slot], .cards-zone[data-zone]',
    getScale: () => stageScale(ctx),
    // in the slider a horizontal swipe scrolls, anything steeper picks the card up (comp_cardslider2:
    // 20 px sideways scroll, 10 px up / down drag)
    shouldStart: (info, dx, dy) => !info.el.closest('.card-slider') || !isSwipe(dx, dy),
    onDragStart: () => ctx.sfx('cardTake'),
    canDrop: (info) => canDrop(ctx, info),
    onDrop: (info) => { onDrop(ctx, info); repaint(); },
    onDropInvalid: (info) => onDropInvalid(ctx, info),
    onDropOutside: (info) => { if (onDropOutside(ctx, info)) repaint(); },
    onTap: (_ev, el) => {
      if (el.dataset.piece) ctx.go('card-detail', { cardId: el.dataset.piece });
      else if (el.dataset.uid) ctx.go('card-detail', { uid: el.dataset.uid });
    },
  });
  live.set(ctx.root, { dnd, slider });
}

/**
 * Stage scale (client px per stage px).
 * @param {object} ctx
 * @returns {number}
 */
function stageScale(ctx) {
  return ctx.ui.stage.getScale() || 1;
}

/* ------------------------------------------------------------------------------------------------
 * Mode stripe
 * ---------------------------------------------------------------------------------------------- */

/**
 * seperator_big with the three mode buttons (training left, deck middle, fusion right).
 * @param {object} ctx
 * @param {object} state
 * @param {HTMLElement} body
 * @returns {HTMLElement}
 */
function modeStripe(ctx, state, body) {
  const stripe = h('div.mode-stripe', { role: 'tablist', 'aria-label': 'Card modes' });
  for (const mode of MODES) {
    const def = MODE_BUTTONS[mode];
    const locked = def.feature && !isUnlocked(state, def.feature);
    if (locked) {
      stripe.appendChild(h('div.mode-btn.locked', { class: `mode-${mode}`, dataset: { tab: mode }, 'aria-disabled': 'true', 'aria-label': `${def.label} (locked)` },
        sprite('deckeditbutton_locked', { class: 'mode-locked' })));
      continue;
    }
    const active = memory.mode === mode;
    const badge = mode === 'fusion' && fuseCount(state, ctx.deps) > 0;
    stripe.appendChild(h('button.mode-btn', {
      type: 'button', role: 'tab', class: [`mode-${mode}`, active && 'active'], dataset: { tab: mode },
      'aria-selected': String(active), 'aria-label': def.label, title: def.label,
      onClick: () => {
        if (memory.mode === mode) return;
        ctx.sfx('button');
        memory.mode = mode;
        memory.offsets[mode] = SLIDER.START;
        if (memory.chrome) memory.chrome.help = def.help;
        paint(ctx, body);
      },
    }, sprite(def.icon, { class: 'mode-icon' }), active ? sprite(def.glow, { class: 'mode-glow' }) : null,
    badge ? sprite('badge', { class: 'mode-badge', alt: '!' }) : null));
  }
  return stripe;
}

/* ------------------------------------------------------------------------------------------------
 * Deck edit
 * ---------------------------------------------------------------------------------------------- */

/**
 * Deck box: 5 slots, "Your cards n/100", "Mana needed" bar.
 * @param {object} ctx
 * @param {object} state
 * @returns {HTMLElement}
 */
function deckBox(ctx, state) {
  const sum = deckSummary(state, ctx.deps);
  const slots = [0, 1, 2, 3, 4].map((i) => {
    const slot = renderEmptySlot(i, { locked: !sum.unlocked[i] });
    const inst = sum.slots[i];
    if (inst && sum.unlocked[i]) slot.appendChild(renderCard(viewOf(ctx, inst), { size: 'compact', draggable: true, className: 'in-deck' }));
    return slot;
  });
  const pct = (v) => `${(Math.max(0, Math.min(1, sum.manaMax ? v / sum.manaMax : 0)) * 100).toFixed(2)}%`;
  const mana = h('div.cards-mana', { class: sum.manaShort && 'short', role: 'progressbar', 'aria-valuenow': String(sum.manaNow), 'aria-valuemax': String(sum.manaMax) },
    h('div.mana-fill', { style: { width: pct(sum.manaNow) } }),
    h('div.mana-label', null, manaNeededText(sum.mana, sum.manaMax)),
    sprite('hud_progressbar_pinocle01', { class: 'mana-marker', style: { left: pct(sum.mana) } }));
  return h('div.cards-box.deck-box', null,
    h('div.card-row.deck-row', null, slots),
    h('div.cards-pool', null,
      h('span.pool-label', null, 'Your cards'),
      h('span.pool-count.num', { class: sum.poolFull && 'full' }, poolCountText(sum.poolCount, sum.poolLimit))),
    sprite('hud_manaicon01', { class: 'cards-mana-icon' }),
    mana);
}

/** Screen registry entry (src/ui/screens/index.js). */
export const screen = { render, onLeave };
