'use strict';

import { takeRng, updatePlayer } from './state.js';
import { addGold, goldWithEvent } from './player.js';
import { ensurePool, getSim, pickSims, simInfo } from './opponents.js';
import { runPvpFight, TP_PER_WIN } from './pvp.js';
import { addLeaguePoints } from './league.js';
import { ARENA } from '../core/constants.js';

/**
 * Arena (game-design §5): three opponents (easy / normal / hard), replaced after every fight and every 30 minutes.
 * The fight itself is the shared PvP runner of pvp.js.
 */

/** Lifetime of the three offers (`state.sim.arena.rerollAt` is when they are replaced). */
export const OFFER_ROTATION_MS = ARENA.offerRotationMinutes * 60 * 1000;
/** Offer difficulties: opponent level offset range [min, max] and the power multiplier of their side. */
export const DIFFICULTIES = ARENA.difficulties.map((d) => ({ id: d.id, color: d.color, min: d.levelOffset[0], max: d.levelOffset[1], power: d.power }));

/**
 * Make sure three arena offers exist (generates them when missing or when the timer expired).
 * @param {object} state
 * @param {object} deps
 * @param {number} now
 * @returns {{state: object, offers: object[], rerollAt: number}}
 */
export function ensureOffers(state, deps, now) {
  let s = ensurePool(state, deps, now).state;
  const arena = s.sim.arena;
  const stale = arena.offers.length !== DIFFICULTIES.length || now >= (arena.rerollAt || 0) || arena.offers.some((o) => !getSim(s, o.simId));
  if (!stale) return { state: s, offers: arena.offers, rerollAt: arena.rerollAt };
  s = rollOffers(s, deps, now);
  return { state: s, offers: s.sim.arena.offers, rerollAt: s.sim.arena.rerollAt };
}

/**
 * Generate three fresh offers (easy / normal / hard) and arm the 30-minute timer.
 * @param {object} state
 * @param {object} deps
 * @param {number} now
 * @returns {object}
 */
export function rollOffers(state, deps, now) {
  const t = takeRng(state, deps);
  const offers = [];
  const used = [];
  for (const d of DIFFICULTIES) {
    const sim = pickSims(t.state, t.rng, { count: 1, min: d.min, max: d.max, exclude: used })[0];
    if (!sim) continue;
    used.push(sim.id);
    offers.push({ difficulty: d.id, color: d.color, simId: sim.id, power: d.power, level: sim.level, name: sim.name, avatar: sim.avatar });
  }
  return { ...t.state, sim: { ...t.state.sim, arena: { offers, rerollAt: now + OFFER_ROTATION_MS } } };
}

/**
 * Fight one of the three arena offers. Rewards: gold `enemyDeckMana × 6` (×2 on a win), 10 Tournament
 * Points per win, card xp and player xp; a win also counts for today's league (`addLeaguePoints`, source
 * 'arena'). The offers are rerolled afterwards.
 * @param {object} state
 * @param {object} deps
 * @param {number} now
 * @param {{offerIndex: number, event?: object|string|null}} args
 * @returns {{state: object, battle: object, won: boolean, rewards: {gold: number, tournamentPoints: number, cardXp: number, playerXp: number, leaguePoints: number}, levelUps: number[], cardLevelUps: object[], opponent: object}}
 */
export function fightArena(state, deps, now, args) {
  const eo = ensureOffers(state, deps, now);
  const offer = eo.offers[args.offerIndex];
  if (!offer) throw new Error('No such opponent');
  const sim = getSim(eo.state, offer.simId);
  const fight = runPvpFight(eo.state, deps, now, { sim, power: offer.power, event: args.event, mode: 'arena' });
  let s = fight.state;
  const gold = goldWithEvent(fight.enemyDeckMana * ARENA.goldPerEnemyMana * (fight.won ? ARENA.winGoldMult : 1), args.event);
  s = addGold(s, gold);
  const tp = fight.won ? TP_PER_WIN : 0;
  s = updatePlayer(s, { tournamentPoints: s.player.tournamentPoints + tp });
  s = rollOffers(s, deps, now);
  const lp = addLeaguePoints(s, deps, now, { source: 'arena', won: fight.won, event: args.event, difficulty: offer.difficulty, oppLevel: offer.level });
  s = lp.state;
  return {
    state: s, battle: fight.battle, won: fight.won,
    rewards: { gold, tournamentPoints: tp, cardXp: fight.cardXp, playerXp: fight.playerXp, leaguePoints: lp.points },
    levelUps: fight.levelUps, cardLevelUps: fight.cardLevelUps, opponent: simInfo(sim, deps),
  };
}

/**
 * Info popup for an offer.
 * @param {object} state
 * @param {object} deps
 * @param {number} offerIndex
 * @returns {object|null}
 */
export function offerInfo(state, deps, offerIndex) {
  const offer = state.sim.arena && state.sim.arena.offers[offerIndex];
  const sim = offer && getSim(state, offer.simId);
  return sim ? { ...simInfo(sim, deps), difficulty: offer.difficulty, color: offer.color, power: offer.power } : null;
}
