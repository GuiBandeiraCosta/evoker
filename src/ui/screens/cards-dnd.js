'use strict';
/**
 * Drag and drop of the Cards screen: which slot / zone accepts a card, what a drop does in each mode and the
 * client's messages for refused drops.
 */
import { placeInDeck, removeFromDeck } from '../../game/collection.js';
import { slotUnlocked } from '../../game/state.js';
import { SLIDER, manaAfterPlace, STACK_FULL_TEXT, sacrificeEligible, pushSacrifice, fitsFusionSlot } from './cards-helpers.js';
import { memory } from './cards-state.js';
import { warningPopup } from './cards-ops.js';

/** Client text when an incomplete card (piece hunt) is dragged into a slot. */
const INCOMPLETE_TEXT = 'You cannot use incomplete cards.';
/** Client text (comp_cardslot) when a card would push the deck over the maximum mana. */
const MANA_LOW_TEXT = 'Your maximum Mana is too low. You should increase your Mana next time you level up.';

/**
 * Whether the hovered slot / zone accepts the dragged card (false = red highlight).
 * @param {object} ctx
 * @param {object} info  DropInfo
 * @returns {boolean}
 */
export function canDrop(ctx, info) {
  if (info.el.dataset.piece || !info.uid) return false;
  const state = ctx.store.get();
  if (memory.mode === 'deck') {
    if (info.to == null || !slotUnlocked(state, info.to)) return false;
    return manaAfterPlace(state, ctx.deps, info.uid, info.to) <= state.player.manaMax;
  }
  if (memory.mode === 'training') {
    if (info.zone === 'train') return true;
    if (info.zone === 'stack') return info.fromZone === 'stack' || sacrificeEligible(state, info.uid, null, memory.sacrifices).ok;
    return false;
  }
  if (info.zone === 'fuse1' || info.zone === 'fuse2') {
    const other = memory.fuse[info.zone === 'fuse1' ? 1 : 0];
    return fitsFusionSlot(state, info.uid, other === info.uid ? null : other);
  }
  return false;
}

/**
 * A card was dropped on a slot / zone that accepts it.
 * @param {object} ctx
 * @param {object} info  DropInfo
 */
export function onDrop(ctx, info) {
  const { uid } = info;
  if (memory.mode === 'deck') {
    if (info.from === info.to || info.to == null) return;
    try {
      ctx.store.update((s, deps) => placeInDeck(s, deps, uid, info.to));
    } catch (err) {
      ctx.ui.toast(err.message || 'Cannot place that card', { icon: 'mana-drop' });
      return;
    }
    const state = ctx.store.get();
    const open = [0, 1, 2, 3, 4].filter((i) => slotUnlocked(state, i));
    ctx.sfx(open.every((i) => state.deck[i]) ? 'deckFinished' : 'cardPlace');
    return;
  }
  if (memory.mode === 'training') {
    if (info.zone === 'train') {
      if (info.fromZone === 'train') return;
      memory.sacrifices = memory.sacrifices.filter((u) => u !== uid);
      memory.trainUid = uid;
      // the client jumps the slider to its end (the weakest cards) once a card is in the training slot
      memory.offsets.training = null;
      memory.snapEnd = true;
    } else if (info.zone === 'stack' && info.fromZone !== 'stack') {
      if (memory.trainUid === uid) memory.trainUid = null;
      memory.sacrifices = pushSacrifice(memory.sacrifices, uid);
    }
    ctx.sfx('cardPlace');
    return;
  }
  const i = info.zone === 'fuse2' ? 1 : 0;
  const next = memory.fuse.slice();
  if (next[1 - i] === uid) next[1 - i] = null;
  next[i] = uid;
  memory.fuse = next;
  ctx.sfx('cardPlace');
  // the slider now lists the partners of the placed card (getFusableCardsFor), from its left end
  memory.offsets.fusion = SLIDER.START;
}

/**
 * A card was released on a slot / zone that refused it: the client's messages.
 * @param {object} ctx
 * @param {object} info  DropInfo
 */
export function onDropInvalid(ctx, info) {
  if (info.el.dataset.piece) { warningPopup(ctx, INCOMPLETE_TEXT, 'cardslot'); return; }
  const state = ctx.store.get();
  if (memory.mode === 'deck' && info.to != null && slotUnlocked(state, info.to)) {
    ctx.ui.toast(MANA_LOW_TEXT, { icon: 'mana-drop' });
  } else if (memory.mode === 'training' && info.zone === 'stack') {
    warningPopup(ctx, STACK_FULL_TEXT, 'cardslotskull');
  }
}

/**
 * A card was released outside any slot: a card taken out of a slot goes back to the slider.
 * @param {object} ctx
 * @param {object} info  DropInfo
 * @returns {boolean} whether something changed
 */
export function onDropOutside(ctx, info) {
  if (memory.mode === 'deck') {
    if (info.from === null || info.from === undefined) return false;
    ctx.store.update((s) => removeFromDeck(s, info.from));
  } else if (info.fromZone === 'train') {
    memory.trainUid = null;
  } else if (info.fromZone === 'stack') {
    memory.sacrifices = memory.sacrifices.filter((u) => u !== info.uid);
  } else if (info.fromZone === 'fuse1' || info.fromZone === 'fuse2') {
    const next = memory.fuse.slice();
    next[info.fromZone === 'fuse2' ? 1 : 0] = null;
    memory.fuse = next;
    memory.offsets.fusion = SLIDER.START;
  } else {
    return false;
  }
  ctx.sfx('cardRemove');
  return true;
}
