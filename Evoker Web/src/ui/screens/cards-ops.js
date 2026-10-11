'use strict';
/**
 * Training and fusion modes of the Cards screen (ctrl_enhance / ctrl_evolve): the boxes with their slots, price
 * and OK, the client's warning popups and the enhance / evolve animations.
 */
import { h, fmt } from '../dom.js';
import { renderCard, sprite } from '../components/card.js';
import { button } from '../components/buttons.js';
import { train } from '../../game/training.js';
import { fuse } from '../../game/fusion.js';
import { getCard } from '../../game/state.js';
import { loadAnim, playAnim } from '../anim-player.js';
import {
  sacrificeWarnings, sacrificeWarningText, trainingMissingText, trainingSummary, FUSE_MISMATCH_TEXT, fusionCheck,
} from './cards-helpers.js';
import { memory, viewOf } from './cards-state.js';

/** Centre of the training / fusion animations in the screen (the training slot ends where the client puts it). */
const FX_X = 360, FX_Y = 600;

/* ------------------------------------------------------------------------------------------------
 * Training
 * ---------------------------------------------------------------------------------------------- */

/**
 * Training box: Training slot, coin price + OK, Sacrifice stack.
 * @param {object} ctx
 * @param {object} state
 * @param {() => void} repaint
 * @returns {HTMLElement}
 */
export function trainingBox(ctx, state, repaint) {
  const trainInst = memory.trainUid ? getCard(state, memory.trainUid) : null;
  const sum = trainingSummary(state, ctx.deps, memory.trainUid, memory.sacrifices);
  const slot = h('div.cards-zone.training-slot', { dataset: { zone: 'train' }, 'aria-label': 'Training slot' },
    trainInst ? renderCard(viewOf(ctx, trainInst), { size: 'compact', draggable: true, className: 'is-training' }) : null);
  const stack = h('div.cards-zone.sacrifice-stack', { dataset: { zone: 'stack', count: String(memory.sacrifices.length) }, 'aria-label': `Sacrifice stack (${memory.sacrifices.length})` });
  memory.sacrifices.forEach((uid, i) => {
    const inst = getCard(state, uid);
    if (!inst) return;
    const top = i === memory.sacrifices.length - 1;
    const card = renderCard(viewOf(ctx, inst), { size: 'compact', draggable: top, className: [!top && 'under', state.deck.includes(uid) && 'in-deck'] });
    card.style.setProperty('--i', String(i));
    stack.appendChild(card);
  });
  const ready = Boolean(trainInst) && memory.sacrifices.length > 0;
  const ok = button('OK', { className: ['cards-ok', 'training-ok', ready && 'ready'].filter(Boolean).join(' '), onClick: () => doTrain(ctx, repaint) });
  return h('div.cards-box.op-box.training-box', null,
    slot, h('div.zone-label.left', null, 'Training slot'),
    stack, h('div.zone-label.right', null, 'Sacrifice stack'),
    h('div.cards-cost.training-cost', { class: !sum.canAffordAll && 'short' }, h('span.num', null, String(sum.gold || 0)), sprite('hud_coinsicon01')),
    ok);
}

/**
 * OK of the training box: the client's checks and warnings, then the training and its animation.
 * @param {object} ctx
 * @param {() => void} repaint
 */
async function doTrain(ctx, repaint) {
  const state = ctx.store.get();
  const missing = trainingMissingText(memory.trainUid, memory.sacrifices);
  if (missing) {
    await warningPopup(ctx, missing, memory.trainUid ? 'cardslotskull' : 'cardslot');
    return;
  }
  const sum = trainingSummary(state, ctx.deps, memory.trainUid, memory.sacrifices);
  if (!sum.canAffordAll) { await notEnoughGold(ctx, sum.gold - state.player.gold); return; }
  if (!sum.ok) { await warningPopup(ctx, sum.reason || 'Training failed', 'cardslot'); return; }
  const warnings = sacrificeWarnings(state, ctx.deps, memory.sacrifices);
  if (warnings.length) {
    const go = await warningPopup(ctx, sacrificeWarningText(warnings, memory.sacrifices.length), 'fx_alldieskull01', 'Sacrifice');
    if (!go) return;
  }
  const trainUid = memory.trainUid;
  const sacs = memory.sacrifices.slice();
  const before = viewOf(ctx, getCard(state, trainUid));
  const sacViews = sacs.map((u) => viewOf(ctx, getCard(state, u)));
  let info;
  try {
    info = ctx.store.update((s, deps) => train(s, deps, trainUid, sacs, { allowDeck: true }));
  } catch (err) {
    await warningPopup(ctx, err.message || 'Training failed', 'cardslot');
    return;
  }
  memory.sacrifices = [];
  ctx.sfx('trainStart');
  const afterInst = getCard(ctx.store.get(), trainUid);
  const after = afterInst ? viewOf(ctx, afterInst) : before;
  const levelled = Boolean(info && info.levelUps && info.levelUps.length);
  await playOpFx(ctx, 'enhance', {
    part1: { bigCard: fxCard(before), ...Object.fromEntries(sacViews.slice(0, 9).map((v, i) => [`smallCard${i + 1}`, fxCard(v)])) },
    big: 'bigCard', after: fxCard(after, levelled ? 'LEVEL UP' : null), sound: 'train',
  });
  repaint();
}

/* ------------------------------------------------------------------------------------------------
 * Fusion
 * ---------------------------------------------------------------------------------------------- */

/**
 * Fusion box: Slot 1, coin price + OK, Slot 2.
 * @param {object} ctx
 * @param {object} state
 * @param {() => void} repaint
 * @returns {HTMLElement}
 */
export function fusionBox(ctx, state, repaint) {
  const check = fusionCheck(state, ctx.deps, memory.fuse);
  const zone = (i) => {
    const uid = memory.fuse[i];
    const inst = uid ? getCard(state, uid) : null;
    return h('div.cards-zone.fusion-slot', { class: `slot-${i + 1}`, dataset: { zone: `fuse${i + 1}` }, 'aria-label': `Slot ${i + 1}` },
      inst ? renderCard(viewOf(ctx, inst), { size: 'compact', draggable: true, className: state.deck.includes(uid) && 'in-deck' }) : null);
  };
  const ok = button('OK', { className: ['cards-ok', 'fusion-ok', check.ready && 'ready'].filter(Boolean).join(' '), onClick: () => doFuse(ctx, repaint) });
  return h('div.cards-box.op-box.fusion-box', null,
    zone(0), h('div.zone-label.left', null, 'Slot 1'),
    zone(1), h('div.zone-label.right', null, 'Slot 2'),
    h('div.cards-cost.fusion-cost', { class: check.ready && !check.ok && 'short' }, h('span.num', null, String(check.cost || 0)), sprite('hud_coinsicon01')),
    ok);
}

/**
 * OK of the fusion box: checks, the fusion (a fused deck card hands its slot to the result) and the
 * evolve animation.
 * @param {object} ctx
 * @param {() => void} repaint
 */
async function doFuse(ctx, repaint) {
  const state = ctx.store.get();
  const check = fusionCheck(state, ctx.deps, memory.fuse);
  if (!check.ready) { await warningPopup(ctx, FUSE_MISMATCH_TEXT, 'cardslot'); return; }
  if (state.player.gold < check.cost) { await notEnoughGold(ctx, check.cost - state.player.gold); return; }
  if (!check.ok) { await warningPopup(ctx, check.reason || 'Fusion failed', 'cardslot'); return; }
  const [a, b] = memory.fuse;
  const viewA = viewOf(ctx, getCard(state, a)), viewB = viewOf(ctx, getCard(state, b));
  let info;
  try {
    info = ctx.store.update((s, deps) => fuse(s, deps, a, b, { allowDeck: true }));
  } catch (err) {
    await warningPopup(ctx, err.message || 'Fusion failed', 'cardslot');
    return;
  }
  memory.fuse = [null, null];
  ctx.sfx('trainStart');
  const inst = info && info.uid ? getCard(ctx.store.get(), info.uid) : null;
  const result = inst ? viewOf(ctx, inst) : viewA;
  await playOpFx(ctx, 'evolve', {
    part1: { card1: fxCard(viewB), card2: fxCard(viewA), resultCard: fxCard(result, 'FUSED') },
    big: 'resultCard', after: null, sound: 'fuse',
  });
  repaint();
}

/* ------------------------------------------------------------------------------------------------
 * Popups
 * ---------------------------------------------------------------------------------------------- */

/**
 * The client's warning popup (ui.screens.overlays.warning_popup): an image, the text and OK (or a named
 * action button plus Cancel). Resolves true when the action was confirmed.
 * @param {object} ctx
 * @param {string} text
 * @param {string} image  sprite name
 * @param {string} [action]  label of the confirm button (with Cancel); omitted = a single OK
 * @returns {Promise<boolean>}
 */
export async function warningPopup(ctx, text, image, action) {
  const body = h('div.cards-warning', null, sprite(image, { class: 'warning-img' }),
    h('p.warning-text', null, text.split('\n').map((line, i) => (i ? [h('br'), line] : line)).flat()));
  const buttons = action
    ? [{ label: 'Cancel', value: false, variant: 'grey' }, { label: action, value: true, variant: 'red', autofocus: true }]
    : [{ label: 'OK', value: true, autofocus: true }];
  const value = await ctx.ui.dialog.open({ body, buttons, className: 'cards-warning-dialog' });
  return value === true;
}

/**
 * The client's "not enough coins" popup (comp_not_enough_coins_popup: "You need more Sterling to do this!").
 * @param {object} ctx
 * @param {number} missing
 * @returns {Promise<void>}
 */
async function notEnoughGold(ctx, missing) {
  await ctx.ui.dialog.open({
    title: 'Not enough gold',
    body: h('div.cards-warning', null, sprite('hud_coinsicon01', { class: 'warning-img coin' }),
      h('p.warning-text', null, 'You need more gold to do this!', h('br'), `Short of ${fmt(missing)} gold`)),
    buttons: [{ label: 'OK', value: true, autofocus: true }],
    className: 'cards-warning-dialog',
  });
}

/* ------------------------------------------------------------------------------------------------
 * Training / fusion animation (enhanceanim2 / evolveanim: assets/orig/animations/*_part1|2.json)
 * ---------------------------------------------------------------------------------------------- */

/**
 * A card filling an animation template (451 × 640 client units), optionally with the large decoration
 * (comp_card_decoration: ornament_top plate + side ornaments) and its label.
 * @param {object} view
 * @param {string|null} [deco]
 * @returns {HTMLElement}
 */
function fxCard(view, deco = null) {
  return h('div.fx-card', null,
    renderCard(view, { size: 'compact' }),
    deco ? h('div.card-deco', null, sprite('ornament_left', { class: 'deco-left' }), sprite('ornament_right', { class: 'deco-right' }),
      h('div.deco-plate', null, h('span', null, deco))) : null);
}

/**
 * Play part 1, wait for a tap on the big card, play part 2 (or skip on tap); resolves when closed.
 * @param {object} ctx
 * @param {'enhance'|'evolve'} kind
 * @param {{part1: Record<string, HTMLElement>, big: string, after: HTMLElement|null, sound: string}} o
 * @returns {Promise<void>}
 */
async function playOpFx(ctx, kind, o) {
  const layer = h('div.cards-fx', { class: kind, role: 'dialog', 'aria-label': kind === 'enhance' ? 'Card trained' : 'Cards fused' });
  ctx.root.appendChild(layer);
  /** @type {Array<() => void>} */
  let waiters = [];
  layer.addEventListener('pointerup', () => { const w = waiters; waiters = []; w.forEach((f) => f()); });
  const nextTap = () => new Promise((r) => { waiters.push(r); });
  const [p1, p2] = await Promise.all([loadAnim(`${kind}_part1`), loadAnim(`${kind}_part2`)]);
  ctx.sfx(o.sound);
  if (p1) {
    const run = playAnim(layer, p1, { templates: o.part1, x: FX_X, y: FX_Y });
    let skipped = false;
    await Promise.race([run.done, nextTap().then(() => { skipped = true; })]);
    if (skipped) { ctx.sfx('trainSkip'); run.stop(); }
    run.el.remove();
  }
  const big = o.after || o.part1[o.big];
  if (p2) {
    // hold the big card (part 2's first frame) until a tap, then the outro
    const hold = playAnim(layer, { ...p2, tweens: [], duration: 0 }, { templates: { [o.big]: big }, x: FX_X, y: FX_Y });
    layer.classList.add('waiting');
    await Promise.race([nextTap(), new Promise((r) => setTimeout(r, 10000))]);
    hold.el.remove();
    layer.classList.remove('waiting');
    const out = playAnim(layer, p2, { templates: { [o.big]: big }, x: FX_X, y: FX_Y });
    await out.done;
  } else {
    await Promise.race([nextTap(), new Promise((r) => setTimeout(r, 1500))]);
  }
  layer.remove();
}
