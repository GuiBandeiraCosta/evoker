'use strict';

import { addGold, addGems, addPotions, addTokens, goldWithEvent } from './player.js';
import { addCard, cardsOfRarity } from './collection.js';
import { addPiece } from './pieces.js';
import {
  WAVE_REWARDS, QUEST_TAP_BURST, BOSS_REWARDS, BOSS_GEMS_RANGE, QUEST_GOLD, PORTAL_PIECE_FROM_NODE,
} from '../core/constants.js';

/**
 * Shared reward rolls (quest waves, bosses) and the function that applies any reward to the save.
 *
 * Reward shapes:
 *  { type: 'none' }
 *  { type: 'gold', gold }
 *  { type: 'gems', gems }
 *  { type: 'potion', potion: 'stamina'|'mana', count }
 *  { type: 'token', token: 'neophyte'|'summoner'|'archmage'|'portalLow'|'portalHigh', portalId?, count }
 *  { type: 'card', cardId, stage, level }
 *  { type: 'piece', cardId }
 */

/** End-of-wave drop: a card of the quest's band 20 % of the time (the gold is paid per tap, `rollTapGold`). */
export const WAVE_ODDS = { card: WAVE_REWARDS.card, none: WAVE_REWARDS.nothing };
/** Boss reward roll (constants BOSS_REWARDS); the gem reward is drawn from BOSS_GEMS_RANGE. */
export const BOSS_ODDS = BOSS_REWARDS;
export { BOSS_GEMS_RANGE };
/** Most minions in one wave (the boss gold is QUEST_GOLD.bossMult waves of this size). */
export const MAX_WAVE_SIZE = 4;

/**
 * Pick a random card definition from a quality band. Trainer cards (Lich King, Crystal Ghost, Blood
 * Dragon) only come from events: they never drop from waves nor fight for a boss.
 * @param {object} rng
 * @param {object} db
 * @param {{rarities: string[]}} band
 * @returns {object|null}
 */
export function pickBandCard(rng, db, band) {
  const rarities = band.rarities.slice();
  while (rarities.length) {
    const i = rng.int(rarities.length);
    const r = rarities.splice(i, 1)[0];
    const pool = (db.byRarity(r) || []).filter((d) => !d.trainer);
    if (pool.length) return rng.pick(pool);
  }
  const all = db.all().filter((d) => !d.trainer);
  return all.length ? rng.pick(all) : null;
}

/**
 * Gold of one minion tap: the quest's flat gold per tap ("Perfect!" tap, `quest.goldPerFigure`), and with
 * probability `quest.burstChance` (default QUEST_TAP_BURST.chance, 10 %) a bonus burst of QUEST_TAP_BURST.mult
 * (4.5) × the tap value on top. A quest's last tap adds `quest.endGold` when the node has one (quest 1: +10, the
 * coin shower at 100 %). Golden Day ×1.5.
 * @param {object} rng
 * @param {object} quest   quest node
 * @param {{last?: boolean, event?: object|string|null}} [opts]  last = this tap clears the quest
 * @returns {{gold: number, tap: number, burst: number, perfect: boolean}}  gold = tap + burst (after the event)
 */
export function rollTapGold(rng, quest, opts = {}) {
  const tapBase = Math.max(0, Number(quest.goldPerFigure) || 0);
  const chance = quest.burstChance == null ? QUEST_TAP_BURST.chance : Number(quest.burstChance) || 0;
  let burstBase = chance > 0 && rng.next() < chance ? Math.round(tapBase * QUEST_TAP_BURST.mult) : 0;
  if (opts.last && quest.endGold) burstBase += Number(quest.endGold) || 0;
  const tap = goldWithEvent(tapBase, opts.event);
  const burst = burstBase ? goldWithEvent(burstBase, opts.event) : 0;
  return { gold: tap + burst, tap, burst, perfect: true };
}

/**
 * Roll the drop after a minion wave: 20 % a whole card of the band (shown face-up mid-quest), else nothing.
 * @param {object} rng
 * @param {object} deps
 * @param {object} quest   quest node from data/quests.json
 * @returns {object} reward
 */
export function rollWaveReward(rng, deps, quest) {
  const roll = rng.next();
  if (roll < WAVE_ODDS.card) {
    const def = pickBandCard(rng, deps.db, quest.band);
    if (!def) return { type: 'none' };
    const stage = quest.band.stages ? quest.band.stages[0] : 0;
    return { type: 'card', cardId: def.id, stage, level: 1 };
  }
  return { type: 'none' };
}

/**
 * Candidate card ids for a piece drop of a line (main set or portal set) at a rarity.
 * @param {object} deps
 * @param {{id: string, cards: string[]}} line
 * @param {string} rarity
 * @returns {string[]}
 */
export function pieceCandidates(deps, line, rarity) {
  const setIds = line.cards || [];
  const order = ['legendary', 'heroic', 'rare', 'uncommon'];
  const start = Math.max(0, order.indexOf(rarity));
  for (let i = start; i < order.length; i++) {
    const inSet = cardsOfRarity(deps.db, order[i], setIds).map((d) => d.id);
    if (inSet.length) return inSet;
  }
  return cardsOfRarity(deps.db, rarity, null).map((d) => d.id);
}

/**
 * Roll the boss reward: 45 % gold (3 waves' worth), 25 % token, 15 % card piece, 10 % potion, 5 % gems.
 * Portal node 25 always gives the portal's high token on the first win; a node with `rewardCard` gives that
 * card on its first win (quest 1: the Throat-Cutter soul card), one with `firstWinReward` that reward.
 * @param {object} rng
 * @param {object} deps
 * @param {{id: string, cards: string[]}} line   main or portal definition
 * @param {object} quest
 * @param {boolean} firstWin
 * @param {object|string|null} [event]
 * @returns {object} reward
 */
export function rollBossReward(rng, deps, line, quest, firstWin, event) {
  const isPortal = line.id !== 'main';
  if (quest.rewardCard && firstWin && deps.db.get(quest.rewardCard)) return { type: 'card', cardId: quest.rewardCard, stage: 0, level: 1, soul: true };
  // scripted first-win rewards of the tutorial quests (1.7.0: Q2 50 gold, Q6 the Club Swinger piece, Q8 100 gold)
  const fw = quest.firstWinReward;
  if (fw && firstWin && (fw.type !== 'piece' || deps.db.get(fw.cardId))) return { ...fw, gold: fw.gold != null ? goldWithEvent(fw.gold, event) : fw.gold };
  if (isPortal && quest.highTokenFirstWin && firstWin) return { type: 'token', token: 'portalHigh', portalId: line.id, count: 1 };
  const pieceOk = isPortal ? quest.n >= PORTAL_PIECE_FROM_NODE : !!quest.pieceRarity;
  const gold = { type: 'gold', gold: goldWithEvent(quest.goldPerFigure * MAX_WAVE_SIZE * QUEST_GOLD.bossMult, event) };
  const odds = { ...BOSS_ODDS };
  if (!pieceOk) { odds.gold += odds.piece; odds.piece = 0; }
  const roll = rng.next();
  let acc = odds.gold;
  if (roll < acc) return gold;
  acc += odds.token;
  if (roll < acc) {
    if (isPortal) return { type: 'token', token: quest.token === 'high' ? 'portalHigh' : 'portalLow', portalId: line.id, count: 1 };
    return { type: 'token', token: quest.token, count: 1 };
  }
  acc += odds.piece;
  if (roll < acc) {
    const cands = pieceCandidates(deps, line, quest.pieceRarity || 'rare');
    return cands.length ? { type: 'piece', cardId: rng.pick(cands) } : gold;
  }
  acc += odds.potion;
  if (roll < acc) return { type: 'potion', potion: rng.chance(0.5) ? 'stamina' : 'mana', count: 1 };
  const [lo, hi] = BOSS_GEMS_RANGE;
  return { type: 'gems', gems: lo + rng.int(hi - lo + 1) };
}

/**
 * Apply a reward to the save.
 * @param {object} state
 * @param {object} deps
 * @param {number} now
 * @param {object} reward
 * @returns {{state: object, reward: object}}  reward is annotated (uid, converted, gold, hunt…)
 */
export function applyReward(state, deps, now, reward) {
  if (!reward) return { state, reward: { type: 'none' } };
  switch (reward.type) {
    case 'gold': return { state: addGold(state, reward.gold), reward };
    case 'gems': return { state: addGems(state, reward.gems), reward };
    case 'potion': return { state: addPotions(state, reward.potion, reward.count || 1), reward };
    case 'token': return { state: addTokens(state, reward.token, reward.count || 1, reward.portalId), reward };
    case 'card': {
      const r = addCard(state, deps, reward.cardId, { stage: reward.stage || 0, level: reward.level || 1 });
      return { state: r.state, reward: { ...reward, uid: r.uid, converted: r.converted, gold: r.gold } };
    }
    case 'piece': {
      const r = addPiece(state, deps, now, reward.cardId);
      return { state: r.state, reward: { ...reward, huntIndex: r.index, completed: r.completed, uid: r.uid, full: r.full } };
    }
    default: return { state, reward: { type: 'none' } };
  }
}

/**
 * Human-readable summary of a reward (for toasts and result popups).
 * @param {object} reward
 * @param {object} db
 * @returns {string}
 */
export function describeReward(reward, db) {
  if (!reward || reward.type === 'none') return 'Nothing this time';
  const name = (id) => ((db && db.get(id)) || {}).name || id;
  switch (reward.type) {
    case 'gold': return reward.gold + ' gold';
    case 'gems': return reward.gems + ' gems';
    case 'potion': return (reward.count || 1) + ' ' + reward.potion + ' potion' + ((reward.count || 1) > 1 ? 's' : '');
    case 'token': return (reward.count || 1) + ' ' + ({ neophyte: 'Neophyte', summoner: 'Summoner', archmage: 'Archmage', portalLow: 'portal (low)', portalHigh: 'portal (high)' }[reward.token] || reward.token) + ' token';
    case 'card': return reward.converted ? name(reward.cardId) + ' (collection full: sold for ' + reward.gold + ' gold)' : name(reward.cardId);
    case 'piece': return reward.full ? 'Card piece of ' + name(reward.cardId) + ' (all piece slots are full)' : 'Card piece: ' + name(reward.cardId);
    default: return '';
  }
}
