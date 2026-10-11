'use strict';
/**
 * State the Cards screen modules share (cards.js, cards-ops.js, cards-dnd.js): the UI memory that survives
 * re-renders and the card view of an instance.
 */

/** UI memory that survives re-renders: mode, slider offset per mode, training and fusion selections. */
export const memory = { params: null, mode: 'deck', offsets: {}, trainUid: null, sacrifices: [], fuse: [null, null], snapEnd: false, chrome: null };

/**
 * Card view of an instance.
 * @param {object} ctx
 * @param {object} inst
 * @returns {object}
 */
export function viewOf(ctx, inst) {
  return ctx.view.cardView(inst, ctx.db.get(inst.cardId));
}
