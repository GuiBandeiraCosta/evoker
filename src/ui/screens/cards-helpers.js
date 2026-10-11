'use strict';
/**
 * Pure helpers for the Cards screen (the client's deck screen with its three modes: deck edit, training =
 * "enhance", fusion = "evolve"; exploration/apk/lua ui.screens.deck.deck_screen, ui.controls.ctrl_deckedit /
 * ctrl_enhance / ctrl_evolve, ui.components.comp_cardslider2) and the set collections.
 * No DOM access, so the module loads in Node for the unit tests.
 * Every function takes the save `state` and the game `deps` (db, stats, quests...) and returns plain data
 * the screen modules turn into DOM.
 */
import { isInDeck } from '../../game/collection.js';
import { previewTraining, sacrificeValue, trainingCost, MAX_SACRIFICES } from '../../game/training.js';
import { canFuse, MAX_STAGE } from '../../game/fusion.js';
import { getCard, deckCards, slotUnlocked } from '../../game/state.js';
import { COLLECTION_LIMIT, ENHANCE_PRICE } from '../../core/constants.js';

/** Modes of the Cards screen in the order of the client's mode stripe (training left, deck middle, fusion right). */
export const MODES = ['training', 'deck', 'fusion'];

/** Header of each mode (client strings: "Your Deck", "Card Training", loca "Fusing cards" = "Fuse cards"). */
export const MODE_TITLES = Object.freeze({ deck: 'Your Deck', training: 'Card Training', fusion: 'Fuse cards' });

/**
 * Mode id for a `params.tab` value: 'training' and 'fusion' as given, everything else (incl. the old
 * 'cards' and 'deck' tabs) is the deck mode.
 * @param {any} id
 * @returns {'deck'|'training'|'fusion'}
 */
export function normalizeMode(id) {
  return id === 'training' || id === 'fusion' ? id : 'deck';
}

/* ------------------------------------------------------------------------------------------------
 * Card slider (comp_cardslider2): cards on an arc, the middle one in front
 * ---------------------------------------------------------------------------------------------- */

/**
 * Geometry of the slider in stage px (client units × 2.25). Card i sits at the angle p = offset + i × STEP
 * degrees: x = sin(p) × RADIUS, scale = cos(1.3 p) × 0.9 × 1.15 (container scale), y = (−50 (1 − 2 s) − 55) ×
 * 1.15 + 9 units from the slider's centre (comp_cardslider2 positioning, s = cos(1.3 p) × 0.9). CARD_SCALE turns
 * the client card width (≈ 86 units) into our 120 px compact card. The row starts scrolled to its left end:
 * the first card enters at START degrees, at the right edge (deck_screen setOffset), and can never be pulled
 * further right; the last card stops at −START on the left.
 */
export const SLIDER = Object.freeze({
  STEP: 20, RADIUS: 640, CARD_SCALE: 1.6125, START: 30, HIDE: 66, UNIT: 2.25,
});

/**
 * Pose of a slider card at angle p (degrees from the front).
 * @param {number} p
 * @returns {{x: number, y: number, scale: number, z: number, visible: boolean}}  x / y: px from the slider centre;
 *          scale: CSS scale of a 120 px card; z: stacking order (front card highest)
 */
export function sliderPose(p) {
  const rad = (deg) => deg * Math.PI / 180;
  const s = Math.cos(rad(p * 1.3)) * 0.9;
  const visible = Math.abs(p) <= SLIDER.HIDE && s > 0.05;
  const yUnits = (-50 * (1 - 2 * s) - 55) * 1.15 + 9;
  return {
    x: Math.sin(rad(p)) * SLIDER.RADIUS,
    y: yUnits * SLIDER.UNIT,
    scale: Math.max(0, s) * 1.15 * SLIDER.CARD_SCALE,
    z: Math.max(0, Math.round(s * 100)),
    visible,
  };
}

/**
 * Scroll range of a slider with n cards (offset = angle of the first card).
 * @param {number} n
 * @returns {{min: number, max: number}}
 */
export function sliderLimits(n) {
  const max = SLIDER.START;
  const min = Math.min(max, -SLIDER.START - Math.max(0, n - 1) * SLIDER.STEP);
  return { min, max };
}

/**
 * Offset that brings card `index` to the front.
 * @param {number} index
 * @returns {number}
 */
export function offsetFor(index) {
  return -index * SLIDER.STEP;
}

/** Client race names (German ids) the slider sorts by, descending: Zwerge > Orks > Neutral > Elfen. */
const RACE_SORT_KEYS = Object.freeze({ dwarf: 'Zwerge', orc: 'Orks', neutral: 'Neutral', elf: 'Elfen' });

/**
 * Slider order of game.cardmanager.sortCardList: mana desc, race desc, fusion stage desc. The client's
 * comparator stops there (a typo makes its level / name steps unreachable); level desc and name asc are added
 * here as stable tie-breakers.
 * @param {{mana: number, tribe: string, stage: number, level: number, name: string}} a
 * @param {{mana: number, tribe: string, stage: number, level: number, name: string}} b
 * @returns {number}
 */
export function compareSlider(a, b) {
  if ((b.mana || 0) !== (a.mana || 0)) return (b.mana || 0) - (a.mana || 0);
  const ra = RACE_SORT_KEYS[a.tribe] || '', rb = RACE_SORT_KEYS[b.tribe] || '';
  if (ra !== rb) return ra < rb ? 1 : -1;
  if ((b.stage | 0) !== (a.stage | 0)) return (b.stage | 0) - (a.stage | 0);
  if ((b.level | 0) !== (a.level | 0)) return (b.level | 0) - (a.level | 0);
  return String(a.name || '').localeCompare(String(b.name || ''));
}

/**
 * Card instances that can be fused: at least two copies of the same card at the same stage, stage below the
 * maximum (game.cardmanager.getFusableCards; deck cards included like in the client).
 * @param {object} state
 * @param {object} deps
 * @returns {string[]} uids
 */
export function fusableUids(state, deps) {
  const groups = new Map();
  for (const c of state.cards) {
    if (c.stage >= MAX_STAGE || !deps.db.get(c.cardId)) continue;
    const key = `${c.cardId}#${c.stage}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c.uid);
  }
  return [...groups.values()].filter((g) => g.length >= 2).flat();
}

/**
 * Number of possible fusions (game.cardmanager.getFuseCount: Σ floor(copies / 2)); drives the "!" badge on
 * the fusion mode button.
 * @param {object} state
 * @param {object} deps
 * @returns {number}
 */
export function fuseCount(state, deps) {
  const groups = new Map();
  for (const c of state.cards) {
    if (c.stage >= MAX_STAGE || !deps.db.get(c.cardId)) continue;
    const key = `${c.cardId}#${c.stage}`;
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  let n = 0;
  for (const v of groups.values()) n += Math.floor(v / 2);
  return n;
}

/**
 * Partners for the cards already in the fusion slots (getFusableCardsFor): same card and stage, not in a slot.
 * @param {object} state
 * @param {Array<string|null>} slots  [slot1, slot2]
 * @returns {string[]} uids
 */
export function fusionPartners(state, slots) {
  const placed = slots.map((u) => (u ? getCard(state, u) : null)).filter(Boolean);
  if (!placed.length) return [];
  const ref = placed[0];
  return state.cards
    .filter((c) => c.cardId === ref.cardId && c.stage === ref.stage && c.stage < MAX_STAGE && !slots.includes(c.uid))
    .map((c) => c.uid);
}

/**
 * Entries of the card slider for a mode, sorted like the client:
 *  - deck: the cards not in the deck plus the running card-piece hunts (incomplete cards, getRemainingCards)
 *  - training: every card not in the training slot / sacrifice stack, deck cards included, plus the pieces
 *  - fusion: the fusable cards, or the partners of the card(s) in the slots (no pieces)
 * @param {object} state
 * @param {object} deps
 * @param {'deck'|'training'|'fusion'} mode
 * @param {{trainUid?: string|null, sacrifices?: string[], fuse?: Array<string|null>}} [sel]
 * @returns {Array<{kind: 'card', uid: string, inst: object, def: object} | {kind: 'piece', cardId: string, def: object, owned: number, total: number}>}
 */
export function sliderEntries(state, deps, mode, sel = {}) {
  let uids;
  if (mode === 'training') {
    const used = new Set([sel.trainUid, ...(sel.sacrifices || [])].filter(Boolean));
    uids = state.cards.filter((c) => !used.has(c.uid)).map((c) => c.uid);
  } else if (mode === 'fusion') {
    const slots = sel.fuse || [null, null];
    uids = slots.some(Boolean) ? fusionPartners(state, slots) : fusableUids(state, deps);
  } else {
    uids = state.cards.filter((c) => !isInDeck(state, c.uid)).map((c) => c.uid);
  }
  const rows = [];
  for (const uid of uids) {
    const inst = getCard(state, uid);
    const def = inst && deps.db.get(inst.cardId);
    if (def) rows.push({ entry: { kind: 'card', uid, inst, def }, key: { mana: def.mana, tribe: def.tribe, stage: inst.stage, level: inst.level, name: def.name } });
  }
  if (mode !== 'fusion') {
    for (const hunt of state.pieces || []) {
      const def = hunt && deps.db.get(hunt.cardId);
      if (!def || (hunt.owned | 0) >= (hunt.total | 0)) continue;
      rows.push({ entry: { kind: 'piece', cardId: hunt.cardId, def, owned: hunt.owned | 0, total: hunt.total | 0 }, key: { mana: def.mana, tribe: def.tribe, stage: 0, level: 0, name: def.name } });
    }
  }
  return rows.sort((a, b) => compareSlider(a.key, b.key)).map((r) => r.entry);
}

/* ------------------------------------------------------------------------------------------------
 * Deck edit (ctrl_deckedit)
 * ---------------------------------------------------------------------------------------------- */

/**
 * Deck editor summary: slots, deck mana vs max, the player's current mana, the card pool count.
 * `manaShort` (current mana below the deck's need) turns "Mana needed" red; `poolFull` turns the count red
 * (client: count ≥ pool size).
 * @param {object} state
 * @param {object} deps
 * @returns {{slots: Array<object|null>, unlocked: boolean[], mana: number, manaMax: number, manaNow: number, manaShort: boolean, count: number, poolCount: number, poolLimit: number, poolFull: boolean}}
 */
export function deckSummary(state, deps) {
  const slots = deckCards(state);
  const mana = slots.reduce((sum, c) => {
    const d = c ? deps.db.get(c.cardId) : null;
    return sum + (d ? Number(d.mana) || 0 : 0);
  }, 0);
  const manaNow = Number(state.player.mana) || 0;
  const poolCount = state.cards.length;
  return {
    slots,
    unlocked: [0, 1, 2, 3, 4].map((i) => slotUnlocked(state, i)),
    mana,
    manaMax: state.player.manaMax,
    manaNow,
    manaShort: manaNow < mana,
    count: slots.filter(Boolean).length,
    poolCount,
    poolLimit: COLLECTION_LIMIT,
    poolFull: poolCount >= COLLECTION_LIMIT,
  };
}

/**
 * Deck mana if `uid` were dropped on `slot` (swapping like placeInDeck), for the red slot highlight.
 * @param {object} state
 * @param {object} deps
 * @param {string} uid
 * @param {number} slot
 * @returns {number}
 */
export function manaAfterPlace(state, deps, uid, slot) {
  const deck = state.deck.slice();
  const prev = deck.indexOf(uid);
  const displaced = deck[slot];
  deck[slot] = uid;
  if (prev >= 0) deck[prev] = displaced && displaced !== uid ? displaced : null;
  return deck.reduce((sum, u) => {
    const c = u ? getCard(state, u) : null;
    const d = c ? deps.db.get(c.cardId) : null;
    return sum + (d ? Number(d.mana) || 0 : 0);
  }, 0);
}

/** The "Mana needed" line (client string "Mana needed: #manaCosts# / #maxMana#"). */
export function manaNeededText(mana, manaMax) {
  return `Mana needed: ${mana} / ${manaMax}`;
}

/**
 * "n/100" of the "Your cards" plate (client: count .. "/" .. cardpoolSize).
 * @param {number} count
 * @param {number} limit
 * @returns {string}
 */
export function poolCountText(count, limit) {
  return `${count}/${limit}`;
}

/* ------------------------------------------------------------------------------------------------
 * Training (ctrl_enhance)
 * ---------------------------------------------------------------------------------------------- */

/** Client warning when the stack is full (comp_cardstackslot). */
export const STACK_FULL_TEXT = `You're not allowed to sacrifice more than ${MAX_SACRIFICES} cards at once.`;

/**
 * Whether an instance may go onto the sacrifice stack. Deck cards may (with the warning at OK), the card in
 * the training slot may not, and the stack holds at most 9 cards.
 * @param {object} state
 * @param {string} uid
 * @param {string|null} trainUid
 * @param {string[]} sacrifices
 * @returns {{ok: boolean, reason: string|null}}
 */
export function sacrificeEligible(state, uid, trainUid, sacrifices) {
  if (!getCard(state, uid)) return { ok: false, reason: 'No such card' };
  if (uid === trainUid) return { ok: false, reason: 'That is the card being trained' };
  if (!sacrifices.includes(uid) && sacrifices.length >= MAX_SACRIFICES) return { ok: false, reason: STACK_FULL_TEXT };
  return { ok: true, reason: null };
}

/**
 * Add a uid to the top of the stack (immutable; no-op when present or full).
 * @param {string[]} sacrifices
 * @param {string} uid
 * @returns {string[]}
 */
export function pushSacrifice(sacrifices, uid) {
  if (sacrifices.includes(uid) || sacrifices.length >= MAX_SACRIFICES) return sacrifices.slice();
  return [...sacrifices, uid];
}

/**
 * The warnings the client raises before sacrificing (ctrl_enhance): "valuable" (rarity sell factor ≥ 4, i.e.
 * Rare and up), "in your deck", "fused" (fusion stage ≥ 1). Order as in the client.
 * @param {object} state
 * @param {object} deps
 * @param {string[]} uids
 * @returns {string[]}
 */
export function sacrificeWarnings(state, deps, uids) {
  let valuable = false, inDeck = false, fused = false;
  for (const uid of uids) {
    const c = getCard(state, uid);
    const d = c ? deps.db.get(c.cardId) : null;
    if (!c || !d) continue;
    if ((ENHANCE_PRICE.raritySellFactor[d.rarity] || 0) >= 4) valuable = true;
    if (isInDeck(state, uid)) inDeck = true;
    if (c.stage >= 1) fused = true;
  }
  return [valuable && 'valuable', inDeck && 'in your deck', fused && 'fused'].filter(Boolean);
}

/**
 * Text of the sacrifice warning popup, built like the client: header line, then "-item" lines.
 * @param {string[]} warnings
 * @param {number} count  cards on the stack
 * @returns {string}
 */
export function sacrificeWarningText(warnings, count) {
  const lines = [count > 1 ? 'Your sacrifice stack contains cards that are:' : 'Your sacrifice stack contains a card that is:', ...warnings];
  return lines.map((l, i) => (i > 0 ? '-' : '') + l).join('\n');
}

/**
 * Message of the OK button when the training cannot start yet (client warning popups), or null.
 * @param {string|null} trainUid
 * @param {string[]} sacrifices
 * @returns {string|null}
 */
export function trainingMissingText(trainUid, sacrifices) {
  if (!trainUid && !sacrifices.length) return 'Add one card to the Training slot and at least one card to the Sacrifice slot.';
  if (!trainUid) return 'Please add one card to the Training slot to do this.';
  if (!sacrifices.length) return 'Add at least one card to the sacrifice stack to do this.';
  return null;
}

/**
 * Everything the training mode shows: the preview (xp, gold, levels; deck cards allowed) plus the xp of
 * each sacrificed card. Works with an incomplete selection (ok: false with a reason).
 * @param {object} state
 * @param {object} deps
 * @param {string|null} trainUid
 * @param {string[]} sacrifices
 * @returns {{ok: boolean, reason: string|null, xp: number, gold: number, levelFrom: number, levelTo: number, cap: number, perCard: Array<{uid: string, xp: number}>, canAffordAll: boolean}}
 */
export function trainingSummary(state, deps, trainUid, sacrifices) {
  const valid = sacrifices.filter((u) => getCard(state, u));
  const perCard = valid.map((uid) => ({ uid, xp: sacrificeValue(deps, getCard(state, uid)) }));
  const pv = previewTraining(state, deps, trainUid, valid, { allowDeck: true });
  const xp = pv.xp || perCard.reduce((s, c) => s + c.xp, 0);
  // the price of the stack shows even before a card sits in the training slot
  const gold = pv.gold || trainingCost(deps, valid.map((u) => getCard(state, u)));
  return { ...pv, xp, gold, perCard, canAffordAll: state.player.gold >= gold };
}

/**
 * Drop uids that no longer exist (after a training session, a sale or a fusion) and keep the stack legal.
 * @param {object} state
 * @param {string|null} trainUid
 * @param {string[]} sacrifices
 * @returns {{trainUid: string|null, sacrifices: string[]}}
 */
export function pruneTrainingSelection(state, trainUid, sacrifices) {
  const t = trainUid && getCard(state, trainUid) ? trainUid : null;
  const s = [];
  for (const u of sacrifices) if (u !== t && getCard(state, u) && !s.includes(u) && s.length < MAX_SACRIFICES) s.push(u);
  return { trainUid: t, sacrifices: s };
}

/* ------------------------------------------------------------------------------------------------
 * Fusion (ctrl_evolve)
 * ---------------------------------------------------------------------------------------------- */

/** Client warning when the two slots do not hold a fusable pair. */
export const FUSE_MISMATCH_TEXT = 'You need two equal cards of the same evolution state to do this.';

/**
 * Drop slot uids that no longer exist or no longer match the other slot.
 * @param {object} state
 * @param {Array<string|null>} slots
 * @returns {Array<string|null>}
 */
export function pruneFusionSlots(state, slots) {
  const out = (slots || [null, null]).slice(0, 2).map((u) => (u && getCard(state, u) ? u : null));
  while (out.length < 2) out.push(null);
  if (out[0] && out[0] === out[1]) out[1] = null;
  const a = out[0] && getCard(state, out[0]), b = out[1] && getCard(state, out[1]);
  if (a && b && (a.cardId !== b.cardId || a.stage !== b.stage)) out[1] = null;
  return out;
}

/**
 * Whether a card may go into a fusion slot next to what the other slot holds.
 * @param {object} state
 * @param {string} uid
 * @param {string|null} otherUid
 * @returns {boolean}
 */
export function fitsFusionSlot(state, uid, otherUid) {
  const c = getCard(state, uid);
  if (!c || c.stage >= MAX_STAGE) return false;
  if (!otherUid || otherUid === uid) return true;
  const o = getCard(state, otherUid);
  return Boolean(o) && o.cardId === c.cardId && o.stage === c.stage;
}

/**
 * Fusion check of the two slots (deck cards allowed): price shown between the slots, OK state.
 * @param {object} state
 * @param {object} deps
 * @param {Array<string|null>} slots
 * @returns {{ready: boolean, ok: boolean, reason: string|null, cost: number, stage: number}}
 *          ready = two equal cards placed (the client lights the OK button); ok = also affordable
 */
export function fusionCheck(state, deps, slots) {
  const [a, b] = slots || [];
  if (!a || !b) return { ready: false, ok: false, reason: FUSE_MISMATCH_TEXT, cost: 0, stage: 0 };
  const v = canFuse(state, deps, a, b, { allowDeck: true });
  const ready = v.cost > 0 || v.ok;
  return { ready, ok: v.ok, reason: v.ok ? null : (ready ? v.reason : FUSE_MISMATCH_TEXT), cost: ready ? v.cost : 0, stage: v.stage };
}

/* ------------------------------------------------------------------------------------------------
 * Set collections
 * ---------------------------------------------------------------------------------------------- */

/**
 * Pick the page of the set collections to show.
 * @param {Array<{id: string}>} sets  from src/game/shop.js setCollections
 * @param {string|number|null|undefined} setIdOrIndex
 * @returns {number} index (0 when unknown)
 */
export function collectionPageIndex(sets, setIdOrIndex) {
  if (!sets.length) return 0;
  if (typeof setIdOrIndex === 'number') return ((setIdOrIndex % sets.length) + sets.length) % sets.length;
  const i = sets.findIndex((s) => s.id === setIdOrIndex);
  return i < 0 ? 0 : i;
}

/**
 * "n/8" style progress text of a set page.
 * @param {{ownedCount: number, total: number}} set
 * @returns {string}
 */
export function collectionProgressText(set) {
  return `${set.ownedCount}/${set.total}`;
}

/**
 * The owned instance to open from a set tile (highest level, then stage), or null.
 * @param {object} state
 * @param {string} cardId
 * @returns {object|null}
 */
export function bestOwnedInstance(state, cardId) {
  const owned = state.cards.filter((c) => c.cardId === cardId);
  if (!owned.length) return null;
  return owned.slice().sort((a, b) => (b.stage - a.stage) || (b.level - a.level))[0];
}

/**
 * The card-piece hunt of a catalog card, for the puzzle overlay of the collections tiles.
 * @param {object} state
 * @param {string} cardId
 * @returns {{owned: number, total: number}|null}
 */
export function pieceHuntFor(state, cardId) {
  const hunt = ((state && state.pieces) || []).find((p) => p && p.cardId === cardId);
  return hunt ? { owned: hunt.owned | 0, total: hunt.total | 0 } : null;
}
