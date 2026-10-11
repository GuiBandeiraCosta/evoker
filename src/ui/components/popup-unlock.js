'use strict';
/**
 * Feature unlock popups, a port of the 1.7.4 client's `game.gamefeaturehelper.showPopup` +
 * `ui.components.popups.view_unlocked_feature_popup` (queued as `unlock_feature_popup_overlay` after the
 * current overlay, so they follow the level-up dialog): a header, the unlock picture from
 * assets/gfx/hud/rewardanimation/unlocks, one line of text and "OK".
 *
 *   evolve   "Card Fusing Unlocked!"   "Combine two identical cards to power up."          unlock_fuse
 *   enhance  "Card Training Unlocked!" "Sacrifice weak cards to level strong cards up."   unlock_train
 *   pvp      "Arena Unlocked!"         "Duel against other players"                        unlock_pvp
 *   leagues  "Leagues Unlocked!"       "Get to the Top!"                                   unlock_pvp
 *   cardslot "Card Slot Unlocked!"     "Your deck can now hold #numCards# cards."          unlock_cardslot
 *
 * Which popups were shown is remembered in `state.tutorial.seen` (feature ids, and `cardslot3`..`cardslot5`),
 * so a popup shown after the level-up dialog is not repeated by the quest map's catch-up check.
 */
import { h, sprite } from '../dom.js';
import { dialog } from './dialog.js';
import { FEATURE_LEVELS, POPUP_FEATURES, START_DECK_SLOTS, DECK_SLOT_QUESTS, deckSlotCount, isUnlocked, unlocksByQuest } from '../../game/state.js';
import { FEATURE_UNLOCK_QUESTS } from '../../core/constants.js';

/** Popup content per feature id (loca_en.json strings; "Fight against other player" reads "Duel against other players"). */
export const UNLOCK_POPUPS = Object.freeze({
  fusion: Object.freeze({ title: 'Card Fusing Unlocked!', text: 'Combine two identical cards to power up.', sprite: 'unlock_fuse' }),
  training: Object.freeze({ title: 'Card Training Unlocked!', text: 'Sacrifice weak cards to level strong cards up.', sprite: 'unlock_train' }),
  arena: Object.freeze({ title: 'Arena Unlocked!', text: 'Duel against other players', sprite: 'unlock_pvp' }),
  league: Object.freeze({ title: 'Leagues Unlocked!', text: 'Get to the Top!', sprite: 'unlock_pvp' }),
  cardslot: Object.freeze({ title: 'Card Slot Unlocked!', text: 'Your deck can now hold #numCards# cards.', sprite: 'unlock_cardslot' }),
});

/**
 * Popup content for a feature ('cardslot' needs the open-slot count).
 * @param {string} feature  fusion | training | arena | league | cardslot (client ids evolve / enhance / pvp / leagues accepted)
 * @param {{slots?: number}} [opts]
 * @returns {{id: string, title: string, text: string, sprite: string}|null}
 */
export function unlockPopupFor(feature, opts = {}) {
  const alias = { evolve: 'fusion', enhance: 'training', pvp: 'arena', leagues: 'league' };
  const id = alias[feature] || feature;
  const def = UNLOCK_POPUPS[id];
  if (!def) return null;
  const text = def.text.replace('#numCards#', String(opts.slots != null ? opts.slots : 3));
  return { id: id === 'cardslot' ? `cardslot${opts.slots != null ? opts.slots : 3}` : id, title: def.title, text, sprite: def.sprite };
}

/**
 * Seen-ids of the save (tutorial.seen).
 * @param {object} state
 * @returns {string[]}
 */
export function seenIds(state) {
  return (state && state.tutorial && Array.isArray(state.tutorial.seen)) ? state.tutorial.seen : [];
}

/**
 * Remember popups as shown. Pure.
 * @param {object} state
 * @param {string[]} ids
 * @returns {object}
 */
export function markSeen(state, ids) {
  const seen = seenIds(state);
  const add = (ids || []).filter((id) => !seen.includes(id));
  if (!add.length) return state;
  return { ...state, tutorial: { ...(state.tutorial || {}), seen: [...seen, ...add] } };
}

/**
 * Unlock popups the save still owes (shown by the quest map when nothing else showed them): level features
 * reached but not seen, and the newest deck-slot count. Features or slots that opened long ago (more than one
 * level / two quests back, i.e. saves from before these popups existed) are returned in `silent` to be marked
 * seen without a popup.
 * @param {object} state
 * @returns {{show: {id: string, title: string, text: string, sprite: string}[], silent: string[]}}
 */
export function pendingUnlocks(state) {
  const seen = seenIds(state);
  const level = (state.player && state.player.level) || 1;
  const show = [];
  const silent = [];
  // a tutorial game opens its features with main-quest wins: the popup follows the boss win on the map
  const reached = (state.quests && state.quests.main && state.quests.main.unlocked) || 1;
  for (const f of POPUP_FEATURES) {
    if (unlocksByQuest(state)) {
      if (seen.includes(f) || !isUnlocked(state, f)) continue;
      if (reached > FEATURE_UNLOCK_QUESTS[f] + 3) silent.push(f); else show.push(unlockPopupFor(f));
      continue;
    }
    const need = FEATURE_LEVELS[f];
    if (need == null || level < need || seen.includes(f)) continue;
    if (level > need + 1) silent.push(f); else show.push(unlockPopupFor(f));
  }
  const slots = deckSlotCount(state);
  if (slots > START_DECK_SLOTS && !seen.includes(`cardslot${slots}`)) {
    const lower = [];
    for (let n = START_DECK_SLOTS + 1; n < slots; n++) if (!seen.includes(`cardslot${n}`)) lower.push(`cardslot${n}`);
    silent.push(...lower);
    const quest = DECK_SLOT_QUESTS[slots];
    if (quest != null && reached > quest + 2) silent.push(`cardslot${slots}`);
    else show.push(unlockPopupFor('cardslot', { slots }));
  }
  return { show, silent };
}

/**
 * Show one unlock popup; resolves when "OK" (or Escape / the backdrop) closed it.
 * @param {{title: string, text: string, sprite: string, id?: string}} popup  from unlockPopupFor
 * @param {{sfx?: (name: string) => void}} [opts]
 * @returns {Promise<any>}
 */
export function showUnlockPopup(popup, opts = {}) {
  if (!popup) return Promise.resolve(null);
  if (typeof opts.sfx === 'function') opts.sfx('ui_unlock');
  return dialog.open({
    title: popup.title,
    className: 'dialog-unlock',
    body: h('div.unlock-body', { dataset: { unlock: popup.id || '' } },
      h('div.unlock-art', null, sprite('reward_glow_yellow', { class: 'unlock-glow' }), sprite(popup.sprite, { class: 'unlock-img', alt: popup.title })),
      h('p.unlock-text', null, popup.text)),
    buttons: [{ label: 'OK', value: true, autofocus: true }],
  });
}

/**
 * Show several popups in order and remember them as seen through the store (when given).
 * @param {Array<{title: string, text: string, sprite: string, id?: string}|string>} list  popups or feature ids
 * @param {{store?: {update: Function}, sfx?: (name: string) => void, slots?: number, isAlive?: () => boolean}} [opts]
 * @returns {Promise<void>}
 */
export async function showUnlockPopups(list, opts = {}) {
  for (const item of list || []) {
    if (typeof opts.isAlive === 'function' && !opts.isAlive()) return;
    const popup = typeof item === 'string' ? unlockPopupFor(item, { slots: opts.slots }) : item;
    if (!popup) continue;
    if (opts.store) opts.store.update((s) => markSeen(s, [popup.id]));
    await showUnlockPopup(popup, opts);
  }
}
