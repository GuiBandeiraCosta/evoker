'use strict';

import { takeRng, utcDay, utcDayStart, DAY_MS, updatePlayer, addNotice, isUnlocked } from './state.js';
import { addGems, addPotions, eventId } from './player.js';
import { ensurePool, getSim, pickSims, simInfo } from './opponents.js';
import { runPvpFight } from './pvp.js';
import { addCard, cardsOfRarity } from './collection.js';
import { LEAGUE } from '../core/constants.js';

/**
 * League (game-design §6, DECISIONS D3), after the 1.7.4 client: `game.leaguemanager` keeps the server's league
 * (`activeLeague`, `timeout`, `players[] {id, name, rank, leaguePoints, rewards, fightable, markRank}`), the list
 * (`comp_league_list_entry`) shows rank / avatar / name / points / up to two prize icons / attack button, the
 * top bar (`comp_league_top_bar`) the tier name in its colour and a d:hh:mm:ss countdown ("FINISHED" at 0),
 * `comp_league_finish_popup` the result ("#league# completed", "Your Rank: #rank#", prize, "Enter the next
 * league:") and `comp_league_enter_popup` the first join. The server side (rules, prizes, promotion) is from the
 * 1.7 videos: Bronze / Silver / Gold, ~50 players, ties share a rank, prizes to rank 29, the top 3 advance and
 * everybody else goes back to Bronze, +150 points per won league fight; Arena and Pieces wins count too.
 *
 * Here a league lasts one UTC day; the 49 simulated players earn points along deterministic per-player curves.
 *
 * state.sim.league = { v: 3, day, startedAt, endsAt, tier, power, simIds, profiles, fights, points, doublePoints, settled }
 *   profiles[simId] = { w: league wins by the end, x: extra (arena / pieces) points by the end, k: curve exponent,
 *                       pic: shows a portrait (else the "?" default picture) }
 * state.sim.leagueTier    'bronze' | 'silver' | 'gold' (the league the player is in / enters next)
 * state.sim.leagueJoined  the enter popup was confirmed once
 * state.sim.leaguePending result of the last settled league until its finish popup was confirmed
 * state.sim.leagueScore   cumulative league points (statistic only since round 3)
 * Saves from before round 3 (8-player leagues, 'platinum', score-based tiers) are read and upgraded on open.
 */

export const LEAGUE_SIZE = LEAGUE.players;
export const SIM_COUNT = LEAGUE.players - 1;
export const POINTS_PER_WIN = LEAGUE.pointsPerWin;
export const SOURCE_POINTS = LEAGUE.sourcePoints;
export const MAX_FIGHTS_PER_OPPONENT = LEAGUE.maxFightsPerOpponent;
export const PROMOTE_TOP = LEAGUE.promote;
export const LEAGUE_VERSION = 3;
/** Tiers (id, name, strength of the simulated players as `power`, `simTop` = best simulated score of a day). */
export const TIERS = LEAGUE.tiers.map((t) => ({ ...t, power: t.strength }));
/** Prize bands per tier id. */
export const PRIZE_TABLE = LEAGUE.prizes;
/** Text colours of the tiers (exploration/apk/data/colors.json bronze / silver / gold). */
export const TIER_COLORS = { bronze: '#d47a42', silver: '#e3e3e3', gold: '#ffcf35' };
/** Rules text of the info screen (server text, translated from the PT client's "REGRAS"). */
export const RULES_TEXT = 'You start in the Bronze League. Defeat other players to earn points! After each tournament, the three players with the most points advance to the next league; the others go back to the Bronze League. The higher the league, the better the prizes!';

/** Share of simulated players that never fight in a league (they keep 0 points and rank "-"). */
const INACTIVE_SHARE = 0.28;
/** Share of active simulated players that only fight league fights (points are multiples of 150 → ties). */
const PURE_LEAGUE_SHARE = 0.5;

/**
 * Tier definition for a tier id (old 'platinum' leagues map to Gold).
 * @param {string} tierId
 * @returns {object}
 */
export function tierById(tierId) {
  const id = tierId === 'platinum' ? 'gold' : tierId;
  return TIERS.find((t) => t.id === id) || TIERS[0];
}

/**
 * The tier after a finished league: the top 3 (with points) go one up (Gold stays Gold), everybody else to Bronze.
 * @param {string} tierId
 * @param {number|null} rank
 * @param {number} points
 * @returns {string}
 */
export function nextTier(tierId, rank, points) {
  const i = TIERS.indexOf(tierById(tierId));
  if (points > 0 && rank != null && rank <= PROMOTE_TOP) return TIERS[Math.min(TIERS.length - 1, i + 1)].id;
  return TIERS[0].id;
}

/**
 * The league the player is in (or enters next), with old saves mapped: an old league's tier, 'platinum' → Gold.
 * @param {object} state
 * @returns {string}
 */
export function leagueTierOf(state) {
  const sim = state.sim;
  if (sim.leagueTier) return tierById(sim.leagueTier).id;
  if (sim.league && sim.league.tier) return tierById(sim.league.tier).id;
  return TIERS[0].id;
}

/**
 * Has the player confirmed the enter popup? Old saves that already played a league count as joined.
 * @param {object} state
 * @returns {boolean}
 */
export function hasJoined(state) {
  const sim = state.sim;
  if (sim.leagueJoined != null) return Boolean(sim.leagueJoined);
  return Boolean(sim.league && sim.league.v !== LEAGUE_VERSION) || (sim.leagueHistory || []).length > 0;
}

/**
 * Confirm the enter popup ("Join League").
 * @param {object} state
 * @returns {object}
 */
export function joinLeague(state) {
  return { ...state, sim: { ...state.sim, leagueJoined: true, leagueTier: leagueTierOf(state) } };
}

/**
 * Prize band of a rank in a tier (null outside the bands or without a rank).
 * @param {string} tierId
 * @param {number|null} rank
 * @returns {{from: number, to: number, card?: string, mana?: number, stamina?: number, gems?: number}|null}
 */
export function prizeBand(tierId, rank) {
  if (!(rank >= 1)) return null;
  const bands = PRIZE_TABLE[tierById(tierId).id] || [];
  return bands.find((b) => rank >= b.from && rank <= b.to) || null;
}

/**
 * Prize items of a rank, in the order the list shows them (card, mana, stamina, gems).
 * @param {string} tierId
 * @param {number|null} rank
 * @returns {Array<{kind: 'card'|'mana'|'stamina'|'gems', amount: number, rarity?: string}>}
 */
export function prizeItems(tierId, rank) {
  const b = prizeBand(tierId, rank);
  if (!b) return [];
  const out = [];
  if (b.card) out.push({ kind: 'card', amount: 1, rarity: b.card });
  if (b.mana) out.push({ kind: 'mana', amount: b.mana });
  if (b.stamina) out.push({ kind: 'stamina', amount: b.stamina });
  if (b.gems) out.push({ kind: 'gems', amount: b.gems });
  return out;
}

/**
 * Prize text of a band like the PRIZES screen ("1 rare card, 5 mana potions").
 * @param {{card?: string, mana?: number, stamina?: number, gems?: number}} band
 * @returns {string}
 */
export function prizeText(band) {
  const parts = [];
  if (band.card) parts.push(`1 ${band.card} card`);
  if (band.mana) parts.push(`${band.mana} mana potion${band.mana === 1 ? '' : 's'}`);
  if (band.stamina) parts.push(`${band.stamina} stamina potion${band.stamina === 1 ? '' : 's'}`);
  if (band.gems) parts.push(`${band.gems} gems`);
  return parts.join(', ');
}

/**
 * Rows of the PRIZES screen, Gold first like the client (rank label "5-9", text).
 * @returns {Array<{tier: object, rows: Array<{rank: string, text: string}>}>}
 */
export function prizeTables() {
  return TIERS.slice().reverse().map((tier) => ({
    tier,
    rows: (PRIZE_TABLE[tier.id] || []).map((b) => ({ rank: b.from === b.to ? String(b.from) : `${b.from}-${b.to}`, text: prizeText(b) })),
  }));
}

/**
 * Activity profile of a simulated player for one league (deterministic from the rng).
 * @param {object} rng
 * @param {object} tier
 * @returns {{w: number, x: number, k: number, pic: boolean}}
 */
export function simProfile(rng, tier) {
  const pic = rng.chance(0.4);
  if (rng.chance(INACTIVE_SHARE)) return { w: 0, x: 0, k: 1, pic };
  const total = tier.simTop * (0.03 + 0.97 * rng.next() ** 2.4);
  const k = Math.round((0.6 + 1.2 * rng.next()) * 100) / 100;
  if (rng.chance(PURE_LEAGUE_SHARE)) return { w: Math.max(1, Math.round(total / POINTS_PER_WIN)), x: 0, k, pic };
  const share = 0.45 + 0.5 * rng.next();
  const w = Math.floor((total * share) / POINTS_PER_WIN);
  return { w, x: Math.max(1, Math.round(total - w * POINTS_PER_WIN)), k, pic };
}

/**
 * Points a simulated player has at a time: wins and extra points grow along `fraction^k` of the league's run.
 * Old (pre-round-3) leagues store a wins-per-day rate instead.
 * @param {object} league
 * @param {string} simId
 * @param {number} now
 * @returns {number}
 */
export function simPoints(league, simId, now) {
  const span = Math.max(1, league.endsAt - league.startedAt);
  const t = Math.min(now, league.endsAt);
  const fraction = Math.max(0, Math.min(1, (t - league.startedAt) / span));
  const mult = league.doublePoints ? 2 : 1;
  const p = league.profiles && league.profiles[simId];
  if (p) {
    const g = fraction ** (p.k || 1);
    return (Math.floor(p.w * g + 1e-9) * POINTS_PER_WIN + Math.floor(p.x * g + 1e-9)) * mult;
  }
  const rate = (league.rates && league.rates[simId]) || 0;
  return Math.floor(rate * fraction) * POINTS_PER_WIN * mult;
}

/**
 * Create today's league in the player's tier.
 * @param {object} state
 * @param {object} deps
 * @param {number} now
 * @param {object|string|null} [event]
 * @param {{points?: number, fights?: object}} [keep]  carried over when an old league of today is upgraded
 * @returns {object}
 */
export function createLeague(state, deps, now, event, keep = {}) {
  let s = ensurePool(state, deps, now).state;
  const t = takeRng(s, deps);
  s = t.state;
  const tier = tierById(leagueTierOf(s));
  const sims = pickSims(s, t.rng, { count: SIM_COUNT, min: -3, max: 5 });
  const profiles = {};
  for (const sim of sims) profiles[sim.id] = simProfile(t.rng, tier);
  const startedAt = utcDayStart(now);
  const fights = {};
  for (const [id, n] of Object.entries(keep.fights || {})) if (profiles[id]) fights[id] = n;
  const league = {
    v: LEAGUE_VERSION, day: utcDay(now), startedAt, endsAt: startedAt + DAY_MS, tier: tier.id, power: tier.power,
    simIds: sims.map((x) => x.id), profiles, fights, points: keep.points || 0,
    doublePoints: eventId(event) === 'double-league-points', settled: false,
  };
  return { ...s, sim: { ...s.sim, league, leagueTier: tier.id } };
}

/**
 * Rank rows by points: ties share a rank (1, 2, 2, 4), players without points have no rank ("-"). Within a tie
 * the human comes first, then by name.
 * @param {object[]} rows  { points, isPlayer, name }
 * @returns {object[]} sorted copies with rank (number|null) and rankText
 */
export function rankRows(rows) {
  const sorted = rows.map((r) => ({ ...r })).sort((a, b) => b.points - a.points || (a.isPlayer ? -1 : b.isPlayer ? 1 : String(a.name).localeCompare(String(b.name))));
  let rank = 0;
  sorted.forEach((r, i) => {
    if (i === 0 || r.points !== sorted[i - 1].points) rank = i + 1;
    r.rank = r.points > 0 ? rank : null;
    r.rankText = r.rank == null ? '-' : String(r.rank);
  });
  return sorted;
}

function rowsFor(state, league, now) {
  const tier = tierById(league.tier);
  const rows = (league.simIds || []).map((id) => {
    const sim = getSim(state, id);
    const prof = (league.profiles && league.profiles[id]) || null;
    const used = (league.fights && league.fights[id]) || 0;
    return {
      id, name: sim ? sim.name : id, avatar: sim ? sim.avatar : 0, picture: prof ? prof.pic !== false : true,
      level: sim ? sim.level : 0, points: simPoints(league, id, now), isPlayer: false,
      fightsLeft: Math.max(0, MAX_FIGHTS_PER_OPPONENT - used),
    };
  });
  rows.push({ id: 'player', name: state.player.name, avatar: state.player.avatar, picture: true, level: state.player.level, points: league.points || 0, isPlayer: true, fightsLeft: 0 });
  const ranked = rankRows(rows);
  const active = league.day === utcDay(now) && now < league.endsAt && !league.settled;
  for (const r of ranked) {
    r.rewards = prizeItems(tier.id, r.rank);
    r.markRank = r.rank != null && r.rank <= PROMOTE_TOP;
    r.fightable = active && !r.isPlayer && r.fightsLeft > 0;
  }
  return ranked;
}

/**
 * Final standings of a league (at its end time) and the player's row.
 * @param {object} state
 * @param {object} league
 * @returns {{rows: object[], rank: number|null, place: number, me: object}}
 */
export function finalStandings(state, league) {
  const rows = rowsFor(state, league, league.endsAt);
  const me = rows.find((r) => r.isPlayer);
  // A player without points has no rank; "Your Rank" then shows the first place below everybody who scored.
  const place = me.rank != null ? me.rank : rows.filter((r) => r.points > 0).length + 1;
  return { rows, rank: me.rank, place, me };
}

/**
 * Prize of a rank as totals: gems, one `potions` entry per potion, the card rarity, mana and stamina potion counts.
 * @param {number} rank
 * @param {string} [tierId='bronze']
 * @returns {{gems: number, potions: Array<'stamina'|'mana'>, card: string|null, mana: number, stamina: number}}
 */
export function prizeFor(rank, tierId = 'bronze') {
  const b = prizeBand(tierId, rank) || {};
  const potions = [];
  for (let i = 0; i < (b.mana || 0); i++) potions.push('mana');
  for (let i = 0; i < (b.stamina || 0); i++) potions.push('stamina');
  return { gems: b.gems || 0, potions, card: b.card || null, mana: b.mana || 0, stamina: b.stamina || 0 };
}

/**
 * Grant a prize card of a rarity (random card of that rarity, level 1).
 * @param {object} state
 * @param {object} deps
 * @param {string} rarity
 * @returns {{state: object, cardId: string|null}}
 */
function grantPrizeCard(state, deps, rarity) {
  const pool = cardsOfRarity(deps.db, rarity);
  if (!pool.length) return { state, cardId: null };
  const t = takeRng(state, deps);
  const def = t.rng.pick(pool);
  const r = addCard(t.state, deps, def.id, {});
  return { state: r.state, cardId: def.id };
}

/**
 * Settle a finished league: grant the prize (gems, potions and the card), Tournament Points (= points / 10),
 * promotion / relegation, history, and the pending result for the finish popup.
 * @param {object} state
 * @param {object} league
 * @param {object} deps
 * @returns {{state: object, prizes: object}}
 */
export function settleLeague(state, league, deps) {
  const fs = finalStandings(state, league);
  const tier = tierById(league.tier);
  const points = league.points || 0;
  // a player without points has no rank (rankRows), so fs.rank is null and the prize empty
  const prize = prizeFor(fs.rank, tier.id);
  let s = addGems(state, prize.gems);
  if (prize.mana) s = addPotions(s, 'mana', prize.mana);
  if (prize.stamina) s = addPotions(s, 'stamina', prize.stamina);
  let cardId = null;
  if (prize.card) { const g = grantPrizeCard(s, deps, prize.card); s = g.state; cardId = g.cardId; }
  const tp = Math.floor(points / LEAGUE.tournamentPointsDiv);
  s = updatePlayer(s, { tournamentPoints: s.player.tournamentPoints + tp });
  const next = nextTier(tier.id, fs.rank, points);
  const prizes = {
    day: league.day, tier: tier.id, rank: fs.place, ranked: fs.rank != null, points,
    gems: prize.gems, potions: prize.potions, mana: prize.mana, stamina: prize.stamina, card: prize.card, cardId, cardPending: false,
    tournamentPoints: tp, nextTier: next, promoted: TIERS.indexOf(tierById(next)) > TIERS.indexOf(tier),
  };
  s = {
    ...s,
    sim: {
      ...s.sim,
      leagueScore: s.sim.leagueScore + points,
      leagueTier: next,
      league: { ...league, settled: true },
      leagueHistory: [prizes, ...s.sim.leagueHistory].slice(0, 30),
      leaguePending: prizes,
    },
  };
  s = addNotice(s, { type: 'league', ...prizes });
  return { state: s, prizes };
}

/**
 * Confirm the finish popup: clears the pending result, granting a card prize that is still pending (`cardPending`:
 * results that older versions settled without the card database).
 * @param {object} state
 * @param {object} deps
 * @returns {{state: object, result: object|null}}
 */
export function collectLeagueResult(state, deps) {
  const pending = state.sim.leaguePending;
  if (!pending) return { state, result: null };
  let s = state;
  let result = pending;
  if (pending.cardPending && pending.card) {
    const g = grantPrizeCard(s, deps, pending.card);
    s = g.state;
    result = { ...pending, cardId: g.cardId, cardPending: false };
  }
  return { state: { ...s, sim: { ...s.sim, leaguePending: null } }, result };
}

/**
 * Open the League tab: settles an earlier day's league (if any), upgrades an old-format league of today and joins
 * today's league.
 * @param {object} state
 * @param {object} deps
 * @param {number} now
 * @param {{event?: object|string|null}} [args]
 * @returns {{state: object, league: object, prizes: object|null}}
 */
export function openLeague(state, deps, now, args = {}) {
  let s = ensurePool(state, deps, now).state;
  // Old saves that already played a league count as joined; remember it before the league is replaced.
  if (s.sim.leagueJoined == null) s = { ...s, sim: { ...s.sim, leagueJoined: hasJoined(s) } };
  let prizes = null;
  const league = s.sim.league;
  const today = utcDay(now);
  if (league && league.day !== today) {
    if (!league.settled) { const r = settleLeague(s, league, deps); s = r.state; prizes = r.prizes; }
    s = createLeague(s, deps, now, args.event);
  } else if (!league) {
    s = createLeague(s, deps, now, args.event);
  } else if (league.v !== LEAGUE_VERSION) {
    s = createLeague(s, deps, now, args.event || (league.doublePoints ? 'double-league-points' : null), { points: league.points || 0, fights: league.fights });
  }
  return { state: s, league: s.sim.league, prizes };
}

/**
 * Live standings for the current league.
 * @param {object} state
 * @param {object} deps
 * @param {number} now
 * @returns {object[]} rows with rank, rankText, name, avatar, picture, level, points, isPlayer, fightsLeft,
 *   fightable, markRank, rewards
 */
export function standings(state, deps, now) {
  const league = state.sim.league;
  if (!league) return [];
  return rowsFor(state, league, Math.min(now, league.endsAt));
}

/**
 * Can the player fight this opponent now? `code` names the refusal for the UI ('ended': the day's league is over,
 * 'not-member', 'fought-out'); `reason` is the message shown.
 * @param {object} state
 * @param {string} simId
 * @param {number} now
 * @returns {{ok: boolean, code: 'ended'|'not-member'|'fought-out'|null, reason: string|null, fightsLeft: number}}
 */
export function canFightLeague(state, simId, now) {
  const league = state.sim.league;
  if (!league || league.day !== utcDay(now) || league.settled) return { ok: false, code: 'ended', reason: 'The league has ended', fightsLeft: 0 };
  if (!(league.simIds || []).includes(simId)) return { ok: false, code: 'not-member', reason: 'Not in this league', fightsLeft: 0 };
  const left = MAX_FIGHTS_PER_OPPONENT - ((league.fights && league.fights[simId]) || 0);
  if (left <= 0) return { ok: false, code: 'fought-out', reason: `You already fought this player ${MAX_FIGHTS_PER_OPPONENT} times`, fightsLeft: 0 };
  return { ok: true, code: null, reason: null, fightsLeft: left };
}

/**
 * Points a won fight is worth now (×2 on a Double PvP Points day).
 * @param {object|null} league
 * @param {'league'|'arena'|'pieces'} source
 * @param {object|string|null} [event]
 * @returns {number}
 */
export function pointsFor(league, source, event, opts = {}) {
  let base = SOURCE_POINTS[source] || 0;
  if (source === 'arena' && opts.difficulty && LEAGUE.arenaPoints[opts.difficulty] != null) base = LEAGUE.arenaPoints[opts.difficulty];
  if (source !== 'league' && Number.isFinite(opts.oppLevel) && Number.isFinite(opts.myLevel)) {
    const [lo, hi] = LEAGUE.stakeRange;
    base = Math.round(base * Math.min(hi, Math.max(lo, 1 + LEAGUE.stakeLevelStep * (opts.oppLevel - opts.myLevel))));
  }
  const double = (league && league.doublePoints) || eventId(event) === 'double-league-points';
  return base * (double ? 2 : 1);
}

/**
 * League points an Arena / piece-hunt win against this opponent would add right now, or 0 when the league is
 * locked or not joined (shown on the opponent rows, like the client's points-at-stake label).
 * @param {object} state
 * @param {{source: 'arena'|'pieces', difficulty?: string, oppLevel?: number, event?: object|string|null}} args
 * @returns {number}
 */
export function leagueStake(state, args) {
  if (!isUnlocked(state, 'league') || !hasJoined(state)) return 0;
  const league = state.sim.league;
  return pointsFor(league, args.source, args.event, { difficulty: args.difficulty, oppLevel: args.oppLevel, myLevel: state.player.level });
}

/**
 * Fight a league opponent: costs deck mana, 150 points per win (300 on Double Points days).
 * @param {object} state
 * @param {object} deps
 * @param {number} now
 * @param {{simId: string, event?: object|string|null}} args
 * @returns {{state: object, battle: object, won: boolean, points: number, levelUps: number[], cardLevelUps: object[], opponent: object}}
 */
export function fightLeague(state, deps, now, args) {
  const check = canFightLeague(state, args.simId, now);
  if (!check.ok) throw new Error(check.reason);
  const sim = getSim(state, args.simId);
  if (!sim) throw new Error('No such player');
  const league = state.sim.league;
  const fight = runPvpFight(state, deps, now, { sim, power: league.power, event: args.event, mode: 'league' });
  let s = fight.state;
  const points = fight.won ? pointsFor(league, 'league', args.event) : 0;
  const next = { ...league, fights: { ...league.fights, [args.simId]: ((league.fights && league.fights[args.simId]) || 0) + 1 }, points: (league.points || 0) + points };
  s = { ...s, sim: { ...s.sim, league: next } };
  return { state: s, battle: fight.battle, won: fight.won, points, levelUps: fight.levelUps, cardLevelUps: fight.cardLevelUps, opponent: simInfo(sim, deps) };
}

/**
 * League points from fights outside the League tab (Arena, Pieces). Counts only for a player who unlocked and
 * joined the league; when today's league does not exist yet it is created (settling an older one) first.
 * Call it after the fight with the fight's result.
 * @param {object} state
 * @param {object} deps
 * @param {number} now
 * @param {{source: 'arena'|'pieces'|'league', won: boolean, event?: object|string|null, difficulty?: string, oppLevel?: number}} args
 *        difficulty / oppLevel: the opponent, for the variable arena / piece-hunt points (`pointsFor`)
 * @returns {{state: object, points: number}}
 */
export function addLeaguePoints(state, deps, now, args) {
  if (!args || !args.won || !isUnlocked(state, 'league') || !hasJoined(state)) return { state, points: 0 };
  let s = state;
  const league = s.sim.league;
  if (!league || league.day !== utcDay(now) || league.settled || league.v !== LEAGUE_VERSION) {
    s = openLeague(s, deps, now, { event: args.event }).state;
  }
  const lg = s.sim.league;
  const points = pointsFor(lg, args.source, args.event, { difficulty: args.difficulty, oppLevel: args.oppLevel, myLevel: s.player.level });
  if (!points) return { state: s, points: 0 };
  return { state: { ...s, sim: { ...s.sim, league: { ...lg, points: (lg.points || 0) + points } } }, points };
}
