'use strict';

import { takeRng, updatePlayer } from './state.js';
import { spendMana, addPlayerXp, playerFightXp, cardFightXp, eventId } from './player.js';
import { addDeckXp, validateDeck } from './collection.js';
import { buildPlayerSide, buildSimSide, simDeckMana, pvpManaCost } from './opponents.js';
import { ARENA } from '../core/constants.js';

/**
 * The PvP fight runner shared by the Arena, Pieces and League tabs: mana check, simulation, card / player xp and
 * the replay record. Mode-specific rewards stay with the callers (arena.js, pieces.js, league.js).
 */

/** Tournament Points per won Arena or piece fight. */
export const TP_PER_WIN = ARENA.tournamentPointsPerWin;
/** Replays kept in the save (newest first). */
export const MAX_REPLAYS = ARENA.replaysKept;

/**
 * Can the player start a PvP fight with the current deck?
 * @param {object} state
 * @param {object} deps
 * @returns {{ok: boolean, reason: string|null, mana: number, needsPotion: boolean}}
 */
export function canFightPvp(state, deps) {
  const v = validateDeck(state, deps);
  if (!v.ok) return { ok: false, reason: v.reason, mana: v.mana, needsPotion: false };
  const mana = pvpManaCost(state, deps);
  if (state.player.mana < mana) return { ok: false, reason: 'Not enough mana', mana, needsPotion: true };
  return { ok: true, reason: null, mana, needsPotion: false };
}

/**
 * Append a replay record (keeps the last 10).
 * @param {object} state
 * @param {object} replay
 * @returns {object}
 */
export function recordReplay(state, replay) {
  const replays = [replay, ...(state.replays || [])].slice(0, MAX_REPLAYS);
  return { ...state, replays };
}

/**
 * Run one PvP fight against a simulated player: spends deck mana, simulates, grants card xp / player xp,
 * counts the win and stores a replay. Mode-specific rewards (gold, TP, points, pieces) are added by callers.
 * @param {object} state
 * @param {object} deps
 * @param {number} now
 * @param {{sim: object, power?: number, event?: object|string|null, mode: string}} args
 * @returns {{state: object, battle: {events: object[], result: object}, won: boolean, seed: number, playerXp: number, cardXp: number, levelUps: number[], cardLevelUps: object[], manaSpent: number, enemyDeckMana: number}}
 */
export function runPvpFight(state, deps, now, args) {
  const check = canFightPvp(state, deps);
  if (!check.ok) throw new Error(check.reason);
  const power = args.power == null ? 1 : args.power;
  let s = spendMana(state, check.mana);
  const t = takeRng(s, deps);
  s = t.state;
  const attacker = buildPlayerSide(s, deps);
  const defender = buildSimSide(args.sim, deps, power);
  const battle = deps.engine.simulateBattle({ attacker, defender, seed: t.seed });
  const won = battle.result.winner === 'attacker';
  const enemyDeckMana = simDeckMana(args.sim, deps);
  const infinite = eventId(args.event) === 'infinite-wisdom';
  const cardXp = cardFightXp(enemyDeckMana, won, infinite);
  const dx = addDeckXp(s, deps, cardXp);
  s = dx.state;
  const playerXp = playerFightXp(Math.round(args.sim.level * power), won);
  const px = addPlayerXp(s, deps, playerXp);
  s = px.state;
  if (won) s = updatePlayer(s, { battlesWon: s.player.battlesWon + 1 });
  const sideRecord = ({ player: p, cards }) => ({
    name: p.name, maxHp: p.maxHp, avatar: p.portrait ?? 0, cards: cards.map((c) => (c ? { cardId: c.cardId, stage: c.stage, level: c.level } : null)),
  });
  s = recordReplay(s, { seed: t.seed, at: now, mode: args.mode, won, attacker: sideRecord(attacker), defender: sideRecord(defender), result: battle.result });
  return { state: s, battle, won, seed: t.seed, playerXp, cardXp, levelUps: px.levelUps, cardLevelUps: dx.levelUps, manaSpent: check.mana, enemyDeckMana };
}
