'use strict';

import {
  RARITIES, PIECE_PRICES, PIECE_HUNT_SLOTS, FIRST_PIECE_GEMS, FIRST_PIECE_GEMS_EVENT, PIECE_RAID_CHANCE,
} from '../core/constants.js';
import { takeRng, utcDay, updatePlayer, addNotice, inTutorial } from './state.js';
import { spendGems, eventId } from './player.js';
import { addCard } from './collection.js';
import { ensurePool, getSim, pickSims, simInfo, TUTORIAL_HOLDER } from './opponents.js';
import { runPvpFight, TP_PER_WIN } from './pvp.js';
import { addLeaguePoints } from './league.js';

/**
 * Card-piece hunts (game-design §5 "Pieces tab", brief §5.3).
 *
 * A hunt: { cardId, owned, total, holderId, raidDay }   (stored in state.pieces, max 8)
 */

export const MAX_HUNTS = PIECE_HUNT_SLOTS;
/** Gems to buy the missing pieces (index = missing count − 1), from the wiki Gems page; first piece of an empty slot. */
export { PIECE_PRICES, FIRST_PIECE_GEMS, FIRST_PIECE_GEMS_EVENT };
/** Gems to get another holder. */
export const SKIP_GEMS = 10;
/** The card piece of the tutorial (quest 6's first-win reward, completed in the Arena lesson after quest 8). */
export const TUTORIAL_PIECE = 'club-swinger';

/**
 * Is this hunt the tutorial's card piece on a save still in the tutorial? Its holder is the scripted, beatable
 * TUTORIAL_HOLDER and raids leave it alone (tutorial-v2 §7.9–7.13).
 * @param {object} state
 * @param {{cardId: string}|null|undefined} hunt
 * @returns {boolean}
 */
export function isTutorialHunt(state, hunt) {
  return Boolean(hunt) && hunt.cardId === TUTORIAL_PIECE && inTutorial(state);
}

/**
 * Pieces needed to complete a card (RARITIES[r].pieces: Uncommon 2, Rare 4, Heroic 6, Legendary 10, Ultimate 12).
 * @param {object} deps
 * @param {string} cardId
 * @returns {number}
 */
export function piecesTotal(deps, cardId) {
  const def = deps.db.get(cardId);
  return (def && RARITIES[def.rarity] && RARITIES[def.rarity].pieces) || 4;
}

/**
 * Gem price to buy `missing` pieces of a rarity (halved on Card-piece Day). Beyond the wiki table the
 * last price is extrapolated by +800 per extra piece.
 * @param {string} rarity
 * @param {number} missing
 * @param {object|string|null} [event]
 * @returns {number}
 */
export function missingPrice(rarity, missing, event) {
  const table = PIECE_PRICES[rarity] || PIECE_PRICES.rare;
  if (missing <= 0) return 0;
  let price = missing <= table.length ? table[missing - 1] : table[table.length - 1] + 800 * (missing - table.length);
  if (eventId(event) === 'card-piece-day') price = Math.ceil(price / 2);
  return price;
}

/**
 * Index of the hunt for a card, or -1.
 * @param {object} state
 * @param {string} cardId
 * @returns {number}
 */
export function huntIndex(state, cardId) {
  return state.pieces.findIndex((h) => h.cardId === cardId);
}

function replaceHunt(state, index, hunt) {
  const pieces = state.pieces.slice();
  if (hunt) pieces[index] = hunt; else pieces.splice(index, 1);
  return { ...state, pieces };
}

/**
 * Complete a hunt: the card is created (ignoring the collection limit) and the slot freed.
 * @param {object} state
 * @param {object} deps
 * @param {number} index
 * @returns {{state: object, uid: string, cardId: string}}
 */
export function completeHunt(state, deps, index) {
  const hunt = state.pieces[index];
  if (!hunt) throw new Error('No such hunt');
  const r = addCard(state, deps, hunt.cardId, { stage: 0, level: 1, force: true });
  return { state: replaceHunt(r.state, index, null), uid: r.uid, cardId: hunt.cardId };
}

/**
 * Receive one piece of a card (from a boss drop or a won piece fight). Starts a hunt when needed, picks a
 * holder, and completes the card when all pieces are owned.
 * @param {object} state
 * @param {object} deps
 * @param {number} now
 * @param {string} cardId
 * @returns {{state: object, index: number, completed: boolean, uid: string|null, full: boolean}}
 */
export function addPiece(state, deps, now, cardId) {
  let s = state;
  let index = huntIndex(s, cardId);
  if (index < 0) {
    if (s.pieces.length >= MAX_HUNTS) return { state: s, index: -1, completed: false, uid: null, full: true };
    const hunt = { cardId, owned: 0, total: piecesTotal(deps, cardId), holderId: null, raidDay: utcDay(now) };
    s = { ...s, pieces: [...s.pieces, hunt] };
    index = s.pieces.length - 1;
  }
  const hunt = { ...s.pieces[index], owned: s.pieces[index].owned + 1 };
  s = replaceHunt(s, index, hunt);
  if (hunt.owned >= hunt.total) {
    const c = completeHunt(s, deps, index);
    return { state: c.state, index, completed: true, uid: c.uid, full: false };
  }
  s = assignHolder(s, deps, now, index);
  return { state: s, index, completed: false, uid: null, full: false };
}

/**
 * Pick a simulated player who "holds" a piece of the hunt's card (the scripted TUTORIAL_HOLDER for the tutorial's piece).
 * @param {object} state
 * @param {object} deps
 * @param {number} now
 * @param {number} index
 * @returns {object}
 */
export function assignHolder(state, deps, now, index) {
  if (isTutorialHunt(state, state.pieces[index])) return replaceHunt(state, index, { ...state.pieces[index], holderId: TUTORIAL_HOLDER.id });
  let s = ensurePool(state, deps, now).state;
  const t = takeRng(s, deps);
  s = t.state;
  const hunt = s.pieces[index];
  if (!hunt) return s;
  const sim = pickSims(s, t.rng, { count: 1, min: -2, max: 3, exclude: hunt.holderId ? [hunt.holderId] : [] })[0];
  return replaceHunt(s, index, { ...hunt, holderId: sim ? sim.id : null });
}

/**
 * Pay 10 gems to get another holder.
 * @param {object} state
 * @param {object} deps
 * @param {number} now
 * @param {number} index
 * @returns {object}
 */
export function skipHolder(state, deps, now, index) {
  if (!state.pieces[index]) throw new Error('No such hunt');
  return assignHolder(spendGems(state, SKIP_GEMS), deps, now, index);
}

/**
 * The holder of a hunt (with info popup data), ensuring one is assigned.
 * @param {object} state
 * @param {object} deps
 * @param {number} now
 * @param {number} index
 * @returns {{state: object, holder: object|null}}
 */
export function huntHolder(state, deps, now, index) {
  let s = state;
  let hunt = s.pieces[index];
  if (!hunt) return { state: s, holder: null };
  if (!hunt.holderId || !getSim(s, hunt.holderId)) { s = assignHolder(s, deps, now, index); hunt = s.pieces[index]; }
  const sim = getSim(s, hunt.holderId);
  return { state: s, holder: sim ? simInfo(sim, deps) : null };
}

/**
 * Attack the holder: costs deck mana; a win steals one piece (completing the card when it was the last
 * one) and gives 10 Tournament Points (and league points, `addLeaguePoints` source 'pieces'); a loss costs only
 * the mana. The holder is rerolled afterwards.
 * @param {object} state
 * @param {object} deps
 * @param {number} now
 * @param {{index: number, event?: object|string|null}} args
 * @returns {{state: object, battle: object, won: boolean, completed: boolean, uid: string|null, hunt: object|null, levelUps: number[], cardLevelUps: object[], tournamentPoints: number, leaguePoints: number}}
 */
export function fightHolder(state, deps, now, args) {
  const hh = huntHolder(state, deps, now, args.index);
  let s = hh.state;
  const hunt = s.pieces[args.index];
  if (!hunt) throw new Error('No such hunt');
  const sim = getSim(s, hunt.holderId);
  if (!sim) throw new Error('No holder');
  const fight = runPvpFight(s, deps, now, { sim, power: 1, event: args.event, mode: 'pieces' });
  s = fight.state;
  let completed = false, uid = null, tp = 0;
  if (fight.won) {
    tp = TP_PER_WIN;
    s = updatePlayer(s, { tournamentPoints: s.player.tournamentPoints + tp });
    const owned = hunt.owned + 1;
    s = replaceHunt(s, args.index, { ...hunt, owned });
    if (owned >= hunt.total) {
      const c = completeHunt(s, deps, args.index);
      s = c.state; completed = true; uid = c.uid;
    }
  }
  if (!completed) s = assignHolder(s, deps, now, args.index);
  const lp = addLeaguePoints(s, deps, now, { source: 'pieces', won: fight.won, event: args.event, oppLevel: sim.level });
  s = lp.state;
  return { state: s, battle: fight.battle, won: fight.won, completed, uid, cardId: completed ? hunt.cardId : null, hunt: completed ? null : s.pieces[args.index], levelUps: fight.levelUps, cardLevelUps: fight.cardLevelUps, tournamentPoints: tp, leaguePoints: lp.points };
}

/**
 * Buy every missing piece of a hunt with gems and complete the card.
 * @param {object} state
 * @param {object} deps
 * @param {number} now
 * @param {{index: number, event?: object|string|null}} args
 * @returns {{state: object, cost: number, uid: string}}
 */
export function buyMissingPieces(state, deps, now, args) {
  const hunt = state.pieces[args.index];
  if (!hunt) throw new Error('No such hunt');
  const def = deps.db.get(hunt.cardId);
  const missing = hunt.total - hunt.owned;
  const cost = missingPrice(def.rarity, missing, args.event);
  const s = spendGems(state, cost);
  const c = completeHunt(s, deps, args.index);
  return { state: c.state, cost, uid: c.uid };
}

/**
 * Price of buying the missing pieces of a hunt.
 * @param {object} state
 * @param {object} deps
 * @param {number} index
 * @param {object|string|null} [event]
 * @returns {number}
 */
export function huntBuyPrice(state, deps, index, event) {
  const hunt = state.pieces[index];
  if (!hunt) return 0;
  return missingPrice((deps.db.get(hunt.cardId) || {}).rarity, hunt.total - hunt.owned, event);
}

/**
 * Buy the first piece of a random Rare/Heroic set card into an empty slot (100 gems, 50 on Card-piece Day).
 * @param {object} state
 * @param {object} deps
 * @param {number} now
 * @param {{event?: object|string|null}} [args]
 * @returns {{state: object, cost: number, index: number, cardId: string}}
 */
export function buyFirstPiece(state, deps, now, args = {}) {
  if (state.pieces.length >= MAX_HUNTS) throw new Error('All piece slots are in use');
  const cost = eventId(args.event) === 'card-piece-day' ? FIRST_PIECE_GEMS_EVENT : FIRST_PIECE_GEMS;
  let s = spendGems(state, cost);
  const t = takeRng(s, deps);
  s = t.state;
  const owned = new Set(s.pieces.map((h) => h.cardId));
  const portalIds = new Set(((deps.quests && deps.quests.portals) || []).flatMap((p) => p.cards || []));
  const usable = (d) => !owned.has(d.id) && !d.trainer;
  const rareHeroic = [...(deps.db.byRarity('rare') || []), ...(deps.db.byRarity('heroic') || [])].filter(usable);
  // Portal set cards first (the design's "random Rare/Heroic set card"), then any non-main set, then anything.
  let pool = rareHeroic.filter((d) => portalIds.has(d.id));
  if (!pool.length) pool = rareHeroic.filter((d) => d.set && d.set !== 'main' && d.set !== 'unique-events');
  if (!pool.length) pool = rareHeroic;
  if (!pool.length) pool = deps.db.all().filter(usable);
  const def = t.rng.pick(pool);
  const r = addPiece(s, deps, now, def.id);
  return { state: r.state, cost, index: r.index, cardId: def.id };
}

/**
 * Simulated raids: once per real day each unfinished hunt with at least one piece has a 20 % chance to lose
 * one piece (disabled by settings.raids = false; never the tutorial's piece during the tutorial). Stolen pieces are
 * listed in the login notices.
 * @param {object} state
 * @param {object} deps
 * @param {number} now
 * @returns {{state: object, stolen: string[]}}
 */
export function dailyRaids(state, deps, now) {
  const day = utcDay(now);
  const stolen = [];
  if (!state.settings.raids || !state.pieces.length) return { state, stolen };
  const due = state.pieces.some((h) => h.raidDay !== day);
  if (!due) return { state, stolen };
  const t = takeRng(state, deps);
  let s = t.state;
  const pieces = s.pieces.map((h) => {
    if (h.raidDay === day) return h;
    if (isTutorialHunt(state, h)) return { ...h, raidDay: day };
    let owned = h.owned;
    if (owned > 0 && t.rng.chance(PIECE_RAID_CHANCE)) { owned -= 1; stolen.push(h.cardId); }
    return { ...h, owned, raidDay: day };
  });
  s = { ...s, pieces };
  for (const cardId of stolen) s = addNotice(s, { type: 'raid', cardId, day });
  return { state: s, stolen };
}
