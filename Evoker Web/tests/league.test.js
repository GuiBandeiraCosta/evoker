'use strict';
/**
 * The League (DECISIONS D3, game-design §6): three tiers, ~50 players, ties share a rank, prize bands to rank
 * 29 per tier, top 3 promote / the rest go back to Bronze, +150 per won league fight, Arena / Pieces points,
 * finish / enter popups, old-save migration. Real card db, stub engine (the test picks the winner); the
 * "(fixture catalog)" group runs on tests/fixtures-game.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { LEAGUE } from '../src/core/constants.js';
import * as S from '../src/game/state.js';
import * as L from '../src/game/league.js';
import { timerText, finishPopupLines, enterPopupLines } from '../src/ui/screens/league.js';
import { DAY_MS } from '../src/game/state.js';
import { getSim } from '../src/game/opponents.js';
import {
  openLeague, standings, fightLeague, tierById, simPoints, prizeFor, settleLeague, finalStandings, POINTS_PER_WIN,
} from '../src/game/league.js';
import * as O from '../src/game/opponents.js';
import { T0, MIN, DAY, db, deps, fz, fresh, rich } from './fixtures/real.js';
import * as stub from './fixtures-game/game.js';

/** A level-10 player with plenty of mana (frozen). */
function player(extra = {}, seed = 4242) {
  const s = S.newGame('Tester', seed, T0, deps());
  return fz({ ...s, player: { ...s.player, level: 10, gems: 0, mana: 5000, manaMax: 5000, staminaPotions: 0, manaPotions: 0, ...extra } });
}
const joined = (s) => fz(L.joinLeague(s));

describe('league: data', () => {
  test('three tiers (no Platinum), 50 players, 150 per league win, top 3 promote', () => {
    assert.deepEqual(L.TIERS.map((t) => [t.id, t.name, t.power]), [['bronze', 'Bronze League', 0.9], ['silver', 'Silver League', 1.05], ['gold', 'Gold League', 1.2]]);
    assert.equal(L.LEAGUE_SIZE, 50); assert.equal(L.SIM_COUNT, 49);
    assert.equal(L.POINTS_PER_WIN, 150); assert.equal(LEAGUE.pointsPerWinDouble, 300);
    assert.deepEqual(L.SOURCE_POINTS, { league: 150, arena: 50, pieces: 30 });
    assert.equal(L.PROMOTE_TOP, 3);
    assert.equal(L.tierById('platinum').id, 'gold', 'old Platinum leagues map to Gold');
    assert.equal(L.tierById('nope').id, 'bronze');
  });

  test('prize table of the 1.7 client per tier (ranks 1, 2, 3, 4, 5-9, 10-19, 20-29)', () => {
    const t = Object.fromEntries(L.prizeTables().map(({ tier, rows }) => [tier.id, rows.map((r) => `${r.rank}: ${r.text}`)]));
    assert.deepEqual(Object.keys(t), ['gold', 'silver', 'bronze'], 'Gold first like the PRIZES screen');
    assert.deepEqual(t.gold, ['1: 1 legendary card, 12 mana potions', '2: 1 legendary card', '3: 1 heroic card', '4: 700 gems',
      '5-9: 10 mana potions, 10 stamina potions', '10-19: 10 mana potions', '20-29: 200 gems']);
    assert.deepEqual(t.silver, ['1: 1 heroic card, 7 mana potions', '2: 1 heroic card', '3: 7 mana potions, 7 stamina potions', '4: 400 gems',
      '5-9: 5 mana potions, 5 stamina potions', '10-19: 5 mana potions', '20-29: 100 gems']);
    assert.deepEqual(t.bronze, ['1: 1 rare card, 5 mana potions', '2: 1 rare card', '3: 5 mana potions, 5 stamina potions', '4: 200 gems',
      '5-9: 2 mana potions, 2 stamina potions', '10-19: 2 mana potions', '20-29: 25 gems']);
    assert.deepEqual(L.prizeItems('bronze', 1), [{ kind: 'card', amount: 1, rarity: 'rare' }, { kind: 'mana', amount: 5 }]);
    assert.deepEqual(L.prizeItems('bronze', 3), [{ kind: 'mana', amount: 5 }, { kind: 'stamina', amount: 5 }]);
    assert.deepEqual(L.prizeItems('bronze', 4), [{ kind: 'gems', amount: 200 }]);
    assert.deepEqual(L.prizeItems('gold', 29), [{ kind: 'gems', amount: 200 }]);
    assert.deepEqual(L.prizeItems('gold', 30), []);
    assert.deepEqual(L.prizeItems('gold', null), []);
    assert.deepEqual(L.prizeFor(1, 'silver'), { gems: 0, potions: Array(7).fill('mana'), card: 'heroic', mana: 7, stamina: 0 });
    assert.deepEqual(L.prizeFor(30, 'bronze'), { gems: 0, potions: [], card: null, mana: 0, stamina: 0 });
  });

  test('promotion: top 3 with points go one league up (Gold stays Gold), everybody else back to Bronze', () => {
    assert.equal(L.nextTier('bronze', 1, 150), 'silver');
    assert.equal(L.nextTier('bronze', 3, 150), 'silver');
    assert.equal(L.nextTier('silver', 2, 900), 'gold');
    assert.equal(L.nextTier('gold', 1, 9000), 'gold');
    assert.equal(L.nextTier('gold', 4, 9000), 'bronze');
    assert.equal(L.nextTier('silver', 20, 300), 'bronze');
    assert.equal(L.nextTier('silver', null, 0), 'bronze');
  });

  test('ranks: ties share the rank (5, 5, 7), players without points have none ("-")', () => {
    const rows = L.rankRows([
      { name: 'a', points: 1759 }, { name: 'b', points: 750 }, { name: 'c', points: 750 }, { name: 'd', points: 745 },
      { name: 'me', points: 750, isPlayer: true }, { name: 'z', points: 0 }, { name: 'y', points: 0 },
    ]);
    assert.deepEqual(rows.map((r) => [r.name, r.rankText]), [['a', '1'], ['me', '2'], ['b', '2'], ['c', '2'], ['d', '5'], ['y', '-'], ['z', '-']]);
    assert.equal(rows[5].rank, null);
  });
});

describe('league: a day of league', () => {
  test('opening joins today\'s league: 49 distinct simulated players, Bronze, countdown to midnight UTC', () => {
    const d = deps();
    const s = player();
    assert.equal(L.hasJoined(s), false);
    const o = L.openLeague(s, d, T0, {});
    const lg = o.league;
    assert.equal(o.prizes, null);
    assert.equal(lg.v, L.LEAGUE_VERSION);
    assert.equal(lg.simIds.length, 49); assert.equal(new Set(lg.simIds).size, 49);
    assert.equal(lg.tier, 'bronze'); assert.equal(lg.power, 0.9);
    assert.equal(lg.startedAt, Date.UTC(2026, 9, 7)); assert.equal(lg.endsAt, Date.UTC(2026, 9, 8));
    assert.equal(o.state.sim.leagueJoined, false, 'the enter popup is still to be confirmed');
    assert.equal(L.hasJoined(fz(L.joinLeague(o.state))), true);
    const again = fz(o.state);
    assert.equal(L.openLeague(again, d, T0 + 60000, {}).state, again, 'same day: unchanged');
    assert.equal(L.openLeague(s, d, T0, { event: 'double-league-points' }).league.doublePoints, true);
  });

  test('simulated players fill ~50 rows plausibly and deterministically', () => {
    const d = deps();
    const o = L.openLeague(player(), d, T0, {});
    const lg = o.league;
    const end = lg.simIds.map((id) => L.simPoints(lg, id, lg.endsAt));
    const zero = end.filter((p) => p === 0).length;
    assert.ok(zero >= 4 && zero <= 25, `${zero} inactive players`);
    assert.ok(Math.max(...end) <= LEAGUE.tiers[0].simTop + 150 && Math.max(...end) >= 600, 'top ' + Math.max(...end));
    assert.ok(end.some((p) => p > 0 && p % 150 !== 0), 'arena / pieces points make odd scores');
    assert.ok(end.some((p) => p > 0 && p % 150 === 0), 'pure league players score multiples of 150');
    for (const id of lg.simIds) {
      assert.equal(L.simPoints(lg, id, lg.startedAt), 0);
      let prev = 0;
      for (let h = 1; h <= 24; h++) { const p = L.simPoints(lg, id, lg.startedAt + h * 3600 * 1000); assert.ok(p >= prev); prev = p; }
      assert.equal(L.simPoints(lg, id, lg.endsAt + DAY), L.simPoints(lg, id, lg.endsAt), 'frozen after the end');
      assert.equal(L.simPoints({ ...lg, doublePoints: true }, id, lg.endsAt), 2 * L.simPoints(lg, id, lg.endsAt));
    }
    // the same save gives the same league
    assert.deepEqual(L.openLeague(player(), d, T0, {}).league, lg);
    // ties are shown with a shared rank in the standings at the end of the day
    const rows = L.standings(fz(o.state), d, lg.endsAt - 1);
    assert.equal(rows.length, 50);
    const ranked = rows.filter((r) => r.rank != null);
    assert.ok(ranked.every((r, i) => i === 0 || r.points < ranked[i - 1].points ? r.rank === i + 1 : r.rank === ranked[i - 1].rank));
    assert.ok(rows.filter((r) => r.rank == null).every((r) => r.points === 0 && r.rankText === '-'));
    assert.ok(rows.filter((r) => r.rank != null && r.rank <= 29).every((r) => r.rewards.length > 0));
    assert.ok(rows.filter((r) => r.rank == null || r.rank >= 30).every((r) => r.rewards.length === 0));
    assert.ok(rows.every((r) => r.markRank === (r.rank != null && r.rank <= 3)));
  });

  test('league fight: deck mana, 150 per win, 300 on Double PvP points, 3 fights per opponent, own row not fightable', () => {
    const d = deps('attacker');
    const s = fz(L.openLeague(joined(player()), d, T0, {}).state);
    const simId = s.sim.league.simIds[0];
    const r1 = L.fightLeague(s, d, T0, { simId });
    assert.equal(r1.points, 150);
    assert.equal(r1.state.sim.league.points, 150);
    assert.equal(r1.state.player.mana, 5000 - S.deckMana(s, d));
    const r3 = L.fightLeague(fz(L.fightLeague(fz(r1.state), d, T0, { simId }).state), d, T0, { simId });
    assert.equal(r3.state.sim.league.points, 450);
    assert.throws(() => L.fightLeague(fz(r3.state), d, T0, { simId }), /3 times/);
    const rows = L.standings(fz(r3.state), d, T0);
    assert.equal(rows.find((r) => r.id === simId).fightable, false);
    assert.equal(rows.find((r) => r.isPlayer).fightable, false);
    assert.ok(rows.filter((r) => !r.isPlayer && r.id !== simId).every((r) => r.fightable));
    assert.equal(L.fightLeague(s, d, T0, { simId, event: 'double-league-points' }).points, 300);
    assert.equal(L.fightLeague(s, deps('defender'), T0, { simId }).points, 0);
    assert.equal(L.canFightLeague(s, simId, T0 + DAY).ok, false);
  });

  test('Arena and Pieces wins add league points (base 50 / 30, ×2 on Double PvP points); only after joining', () => {
    const d = deps();
    const s = fz(L.openLeague(joined(player()), d, T0, {}).state);
    const a = L.addLeaguePoints(s, d, T0, { source: 'arena', won: true });
    assert.equal(a.points, 50); assert.equal(a.state.sim.league.points, 50);
    const p = L.addLeaguePoints(fz(a.state), d, T0, { source: 'pieces', won: true, event: 'double-league-points' });
    assert.equal(p.points, 60); assert.equal(p.state.sim.league.points, 110);
    assert.equal(L.addLeaguePoints(s, d, T0, { source: 'arena', won: false }).points, 0);
    assert.equal(L.addLeaguePoints(s, d, T0, { source: 'arena', won: false }).state, s);
    // not joined yet / league locked → nothing
    const notJoined = fz(L.openLeague(player(), d, T0, {}).state);
    assert.equal(L.addLeaguePoints(notJoined, d, T0, { source: 'arena', won: true }).points, 0);
    const low = fz({ ...s, player: { ...s.player, level: 1 } });
    assert.equal(L.addLeaguePoints(low, d, T0, { source: 'arena', won: true }).points, 0);
    // no league today yet: it is opened first (yesterday's is settled)
    const next = L.addLeaguePoints(s, d, T0 + DAY, { source: 'arena', won: true });
    assert.equal(next.points, 50);
    assert.equal(next.state.sim.league.day, '2026-10-08');
    assert.equal(next.state.sim.league.points, 50);
    assert.equal(next.state.sim.leagueHistory.length, 1);
  });

  test('Arena / Pieces points depend on the opponent (difficulty and level gap, 0.6–1.6×) and show as the stake', () => {
    const d = deps();
    const s = fz(L.openLeague(joined(player()), d, T0, {}).state);
    const lv = s.player.level;
    const pts = (args) => L.addLeaguePoints(s, d, T0, { won: true, ...args }).points;
    assert.equal(pts({ source: 'arena', difficulty: 'easy', oppLevel: lv }), 20);
    assert.equal(pts({ source: 'arena', difficulty: 'normal', oppLevel: lv }), 60);
    assert.equal(pts({ source: 'arena', difficulty: 'hard', oppLevel: lv }), 120);
    assert.equal(pts({ source: 'arena', difficulty: 'hard', oppLevel: lv + 2 }), Math.round(120 * 1.16));
    assert.equal(pts({ source: 'arena', difficulty: 'easy', oppLevel: lv - 20 }), 12); // floor 0.6×
    assert.equal(pts({ source: 'pieces', oppLevel: lv + 30 }), 48); // cap 1.6×
    assert.equal(pts({ source: 'league', oppLevel: lv + 30 }), 150); // league fights stay 150
    assert.equal(L.leagueStake(s, { source: 'arena', difficulty: 'hard', oppLevel: lv }), 120);
    assert.equal(L.leagueStake(fz(L.openLeague(player(), d, T0, {}).state), { source: 'arena', difficulty: 'hard', oppLevel: lv }), 0);
  });
});

describe('league: end of a league', () => {
  test('1st place in Bronze: a rare card + 5 mana potions, TP, promotion to Silver, finish popup data', () => {
    const d = deps();
    const s = fz(L.openLeague(joined(player()), d, T0, {}).state);
    const lg = { ...s.sim.league, points: 99000 };
    const withPts = fz({ ...s, sim: { ...s.sim, league: lg } });
    const st = L.settleLeague(withPts, lg, d);
    assert.equal(st.prizes.rank, 1); assert.equal(st.prizes.ranked, true);
    assert.equal(st.prizes.card, 'rare'); assert.ok(st.prizes.cardId);
    assert.equal(db.get(st.prizes.cardId).rarity, 'rare');
    assert.equal(st.state.cards.length, s.cards.length + 1);
    assert.equal(st.state.player.manaPotions, 5); assert.equal(st.state.player.staminaPotions, 0);
    assert.equal(st.prizes.tournamentPoints, 9900);
    assert.equal(st.prizes.nextTier, 'silver'); assert.equal(st.prizes.promoted, true);
    assert.equal(st.state.sim.leagueTier, 'silver');
    assert.equal(st.state.sim.league.settled, true);
    assert.equal(st.state.sim.leaguePending, st.prizes);
    assert.equal(st.state.notices.at(-1).type, 'league');
    const lines = finishPopupLines(st.prizes);
    assert.deepEqual([lines.title, lines.congrats, lines.passed, lines.rank, lines.enterText, lines.next, lines.button],
      ['BRONZE LEAGUE', 'Congratulations!', 'Bronze League completed', 'Your rank: 1', 'Take your Reward and enter the next League:', 'Silver League', 'Join League']);
    assert.deepEqual(lines.rewards.map((r) => r.kind), ['card', 'mana']);
    // confirming the popup clears the pending result
    const c = L.collectLeagueResult(fz(st.state), d);
    assert.equal(c.state.sim.leaguePending, null);
    assert.equal(c.state.cards.length, st.state.cards.length, 'card was already granted');
    // the next league is Silver with stronger players
    const next = L.openLeague(fz(c.state), d, T0 + DAY, {});
    assert.equal(next.league.tier, 'silver'); assert.equal(next.league.power, 1.05);
  });

  test('a card prize still pending in an older save is granted when the finish popup is confirmed', () => {
    const d = deps();
    const s = fz(L.openLeague(joined(player()), d, T0, {}).state);
    const lg = { ...s.sim.league, points: 99000 };
    const settled = L.settleLeague(fz({ ...s, sim: { ...s.sim, league: lg } }), lg, d);
    assert.equal(settled.prizes.cardPending, false); assert.ok(settled.prizes.cardId);
    // older versions settled on save open without the card database: the card waited for the popup
    const pending = { ...settled.prizes, cardId: null, cardPending: true };
    const st = { state: { ...settled.state, cards: s.cards, sim: { ...settled.state.sim, leaguePending: pending } } };
    const c = L.collectLeagueResult(fz(st.state), d);
    assert.equal(c.state.cards.length, s.cards.length + 1);
    assert.equal(db.get(c.result.cardId).rarity, 'rare');
    assert.equal(c.state.sim.leaguePending, null);
  });

  test('0 points: no rank and no prize, back to Bronze; "Enter the next league:"', () => {
    const d = deps();
    const silver = fz({ ...joined(player()), sim: { ...joined(player()).sim, leagueTier: 'silver' } });
    const s = fz(L.openLeague(silver, d, T0, {}).state);
    assert.equal(s.sim.league.tier, 'silver');
    const next = L.openLeague(s, d, T0 + DAY, {});
    assert.equal(next.prizes.ranked, false);
    assert.ok(next.prizes.rank > 1, 'shown place below everybody who scored');
    assert.equal(next.prizes.gems, 0); assert.equal(next.prizes.card, null); assert.deepEqual(next.prizes.potions, []);
    assert.equal(next.prizes.nextTier, 'bronze');
    assert.equal(next.league.tier, 'bronze');
    assert.equal(L.openLeague(fz(next.state), d, T0 + DAY + 60000, {}).prizes, null, 'settled only once');
    const lines = finishPopupLines(next.prizes);
    assert.equal(lines.enterText, 'Enter the next league:');
    assert.deepEqual(lines.rewards, []);
    assert.equal(lines.title, 'SILVER LEAGUE');
  });

  test('rank 4 in Gold: 700 gems and relegation to Bronze', () => {
    const d = deps();
    const gold = joined(player());
    const s = fz(L.openLeague(fz({ ...gold, sim: { ...gold.sim, leagueTier: 'gold' } }), d, T0, {}).state);
    const ids = s.sim.league.simIds;
    const top = (w) => ({ w, x: 0, k: 1, pic: true });
    const lg = { ...s.sim.league, profiles: { ...s.sim.league.profiles, [ids[0]]: top(100), [ids[1]]: top(99), [ids[2]]: top(98) }, points: 14000 };
    const st = L.settleLeague(fz({ ...s, sim: { ...s.sim, league: lg } }), lg, d);
    assert.equal(st.prizes.rank, 4);
    assert.equal(st.prizes.gems, 700);
    assert.equal(st.state.player.gems, 700);
    assert.equal(st.prizes.nextTier, 'bronze');
    assert.equal(st.prizes.promoted, false);
  });
});

describe('league: old saves', () => {
  /** An 8-player league as saved before round 3. */
  function oldLeague(s, day, tier = 'platinum') {
    const start = S.utcDayStart(day);
    const simIds = s.sim.players.slice(0, 8).map((p) => p.id);
    const rates = Object.fromEntries(simIds.map((id, i) => [id, 4 + i]));
    return { day: S.utcDay(day), startedAt: start, endsAt: start + DAY, tier, power: 1.4, simIds, rates, fights: { [simIds[0]]: 2 }, points: 600, doublePoints: false, settled: false };
  }

  test('an old league of today is upgraded (points and fights kept), Platinum becomes Gold, the player counts as joined', () => {
    const d = deps();
    const base = fz(L.openLeague(player(), d, T0, {}).state); // pool exists
    const old = fz({ ...base, sim: { players: base.sim.players, day: base.sim.day, arena: base.sim.arena, league: oldLeague(base, T0), leagueScore: 70000, leagueHistory: [] } });
    assert.equal(L.leagueTierOf(old), 'gold');
    assert.equal(L.hasJoined(old), true);
    const o = L.openLeague(old, d, T0, {});
    assert.equal(o.league.v, L.LEAGUE_VERSION);
    assert.equal(o.league.tier, 'gold'); assert.equal(o.league.power, 1.2);
    assert.equal(o.league.points, 600);
    assert.equal(o.league.simIds.length, 49);
    assert.equal(o.state.sim.leagueJoined, true);
    const kept = old.sim.league.simIds[0];
    if (o.league.simIds.includes(kept)) assert.equal(o.league.fights[kept], 2);
    assert.equal(o.prizes, null);
  });

  test('an old unsettled league from yesterday is settled with its old rates when the save is opened', () => {
    const d = deps();
    const base = fz(L.openLeague(player(), d, T0, {}).state);
    const old = fz({ ...base, sim: { players: base.sim.players, day: base.sim.day, arena: base.sim.arena, league: oldLeague(base, T0 - DAY, 'bronze'), leagueScore: 0, leagueHistory: [] } });
    // legacy points: rate × 150 at the end of the day
    assert.equal(L.simPoints(old.sim.league, old.sim.league.simIds[3], old.sim.league.endsAt), 7 * 150);
    const st = L.settleLeague(old, old.sim.league, d); // what app.js onOpen does
    assert.equal(st.prizes.tier, 'bronze');
    assert.equal(st.prizes.rank, 8, '600 points: behind the 7 sims with 5..11 wins, tied with the one with 4');
    const o = L.openLeague(fz(st.state), d, T0, {});
    assert.equal(o.prizes, null);
    assert.equal(o.league.v, L.LEAGUE_VERSION);
    assert.equal(o.league.day, '2026-10-07');
  });
});

describe('league: screen helpers', () => {
  test('timer d:hh:mm:ss, FINISHED at 0; enter popup texts', () => {
    assert.equal(timerText(17 * 3600 * 1000 + 9 * 60 * 1000 + 10 * 1000), '0:17:09:10');
    assert.equal(timerText(0), 'FINISHED');
    assert.equal(timerText(-5), 'FINISHED');
    const e = enterPopupLines('bronze');
    assert.equal(e.title, 'BRONZE LEAGUE');
    assert.equal(e.leaguetitle, 'Bronze League');
    assert.equal(e.okbutton, 'Join League');
  });
});

describe('league (fixture catalog)', () => {
  const { fresh, rich } = stub; // the fixture-catalog builders

  // ---------------------------------------------------------------- league

  test('league: daily bracket of 49 sims, bronze tier, sim points grow over the day', () => {
    const { state, deps } = fresh();
    const r = openLeague(rich(state), deps, T0);
    assert.equal(r.prizes, null);
    assert.equal(r.league.day, '2026-10-07');
    assert.equal(r.league.simIds.length, 49);
    assert.equal(r.league.tier, 'bronze');
    assert.equal(r.league.endsAt - r.league.startedAt, DAY_MS);
    const rows = standings(r.state, deps, T0);
    assert.equal(rows.length, 50);
    assert.ok(rows.some((x) => x.isPlayer));
    assert.ok(rows.every((x, i) => i === 0 || rows[i - 1].points >= x.points));
    for (const id of r.league.simIds) {
      const end = simPoints(r.league, id, r.league.endsAt);
      assert.equal(simPoints(r.league, id, r.league.startedAt), 0);
      assert.ok(simPoints(r.league, id, T0) <= end);
      assert.equal(simPoints(r.league, id, r.league.endsAt + DAY_MS), end);
    }
    assert.equal(openLeague(r.state, deps, T0 + 3600 * 1000).state, r.state);
    assert.equal(tierById('silver').power, 1.05);
  });

  test('league fights: 150 points per win (300 on Double Points), max 3 fights per opponent', () => {
    const { state, deps } = fresh({ winner: 'attacker' });
    let s = openLeague(rich(state), deps, T0).state;
    const id = s.sim.league.simIds[0];
    let r = fightLeague(s, deps, T0, { simId: id });
    assert.equal(r.points, POINTS_PER_WIN);
    assert.equal(r.state.sim.league.points, 150);
    assert.equal(r.state.sim.league.fights[id], 1);
    r = fightLeague(r.state, deps, T0, { simId: id });
    r = fightLeague(r.state, deps, T0, { simId: id });
    assert.equal(r.state.sim.league.points, 450);
    assert.throws(() => fightLeague(r.state, deps, T0, { simId: id }), /3 times/);
    deps.engine.winner = 'defender';
    const loss = fightLeague(r.state, deps, T0, { simId: s.sim.league.simIds[1] });
    assert.equal(loss.points, 0);
    deps.engine.winner = 'attacker';
    const dbl = fightLeague(r.state, deps, T0, { simId: s.sim.league.simIds[1], event: 'double-league-points' });
    assert.equal(dbl.points, 300);
    assert.equal(deps.engine.calls[0].defender.player.maxHp, Math.round(getSim(s, id).hpMax * 0.9));
    assert.throws(() => fightLeague(r.state, deps, T0 + DAY_MS, { simId: id }), /ended/);
  });

  test('league prizes on the next open: prize bands per tier, TP = points/10, promotion of the top 3', () => {
    const { state, deps } = fresh({ winner: 'attacker' });
    let s = openLeague(rich(state, { mana: 1e5, manaMax: 1e5 }), deps, T0).state;
    for (const id of s.sim.league.simIds) for (let i = 0; i < 3; i++) s = fightLeague(s, deps, T0, { simId: id }).state;
    assert.equal(s.sim.league.points, 49 * 450);
    assert.equal(finalStandings(s, s.sim.league).rank, 1);
    const next = openLeague(s, deps, T0 + DAY_MS);
    assert.equal(next.prizes.rank, 1);
    assert.equal(next.prizes.card, 'rare');
    assert.equal(next.prizes.mana, 5);
    assert.equal(next.prizes.tournamentPoints, 49 * 45);
    assert.equal(next.state.sim.leagueScore, 49 * 450);
    assert.equal(next.league.day, '2026-10-08');
    assert.equal(next.league.tier, 'silver');
    assert.equal(next.league.points, 0);
    assert.equal(next.state.sim.leagueHistory.length, 1);
    assert.deepEqual(prizeFor(4, 'bronze'), { gems: 200, potions: [], card: null, mana: 0, stamina: 0 });
    assert.equal(prizeFor(12, 'gold').mana, 10);
    assert.equal(prizeFor(30, 'gold').gems, 0);
    const idle = settleLeague(openLeague(rich(state), deps, T0).state, openLeague(rich(state), deps, T0).state.sim.league, deps);
    assert.equal(idle.prizes.ranked, false);
    assert.equal(idle.prizes.gems, 0);
    assert.equal(idle.prizes.nextTier, 'bronze');
  });
});

// ================================================================= §6 League

describe('§6 league', () => {
  // Round 3 (DECISIONS D3): the full rule set is covered by the groups above; these are the §6 headlines.
  test('three tiers Bronze / Silver / Gold with strength 0.9 / 1.05 / 1.2; promotion for the top 3, the rest back to Bronze', () => {
    assert.deepEqual(L.TIERS.map((t) => [t.id, t.power]), [['bronze', 0.9], ['silver', 1.05], ['gold', 1.2]]);
    assert.equal(L.nextTier('bronze', 3, 150), 'silver');
    assert.equal(L.nextTier('silver', 4, 3000), 'bronze');
    assert.equal(L.nextTier('gold', 1, 9000), 'gold');
  });

  test('a league per UTC day with 49 simulated players; join on open; countdown to midnight UTC', () => {
    const d = deps();
    const now = T0 + 5 * 60 * MIN; // 17:00 UTC
    const o = L.openLeague(rich(fresh()), d, now, {});
    const lg = o.league;
    assert.equal(o.prizes, null);
    assert.equal(lg.simIds.length, 49); assert.equal(new Set(lg.simIds).size, 49);
    assert.equal(L.LEAGUE_SIZE, 50);
    assert.equal(lg.day, '2026-10-07');
    assert.equal(lg.startedAt, Date.UTC(2026, 9, 7)); assert.equal(lg.endsAt, Date.UTC(2026, 9, 8));
    assert.equal(lg.tier, 'bronze'); assert.equal(lg.power, 0.9);
    assert.equal(lg.points, 0); assert.equal(lg.doublePoints, false); assert.equal(lg.settled, false);
    const rows = L.standings(fz(o.state), d, now);
    assert.equal(rows.length, 50);
    assert.equal(rows.filter((r) => r.isPlayer).length, 1);
    rows.forEach((r, i) => { if (i) assert.ok(r.points <= rows[i - 1].points); });
    const joined = fz(o.state);
    assert.equal(L.openLeague(joined, d, now + MIN, {}).state, joined);
  });

  test('league fight: costs deck mana, 150 points per win (300 on Double Points), 0 per loss, 3 fights per opponent', () => {
    const d = deps('attacker');
    const s = fz(L.openLeague(rich(fresh()), d, T0, {}).state);
    const simId = s.sim.league.simIds[0];
    assert.deepEqual(L.canFightLeague(s, simId, T0), { ok: true, code: null, reason: null, fightsLeft: 3 });
    const r1 = L.fightLeague(s, d, T0, { simId });
    assert.equal(r1.points, 150);
    assert.equal(r1.state.player.mana, 300 - S.deckMana(s, d));
    assert.equal(r1.state.player.tournamentPoints, 0, 'TP come from the league points at settlement, not per fight');
    assert.equal(r1.state.replays[0].mode, 'league');
    assert.equal(d.engine.calls[0].defender.player.maxHp, Math.round(O.getSim(s, simId).hpMax * 0.9), 'Bronze sims fight at 0.9×');
    const r3 = L.fightLeague(fz(L.fightLeague(fz(r1.state), d, T0, { simId }).state), d, T0, { simId });
    assert.equal(r3.state.sim.league.points, 450);
    assert.throws(() => L.fightLeague(fz(r3.state), d, T0, { simId }), /3 times/);
    assert.equal(L.fightLeague(s, d, T0, { simId, event: 'double-league-points' }).points, 300);
    const loss = L.fightLeague(s, deps('defender'), T0, { simId });
    assert.equal(loss.points, 0);
    assert.equal(loss.state.sim.league.fights[simId], 1, 'a loss still uses one of the 3 fights');
    assert.equal(L.canFightLeague(s, simId, T0 + DAY).ok, false, 'yesterday\'s league cannot be fought');
    assert.equal(L.canFightLeague(s, simId, T0 + DAY).code, 'ended');
    assert.throws(() => L.fightLeague(fz({ ...s, player: { ...s.player, mana: 0 } }), d, T0, { simId }), /mana/);
  });

  test('opening the league the next day settles yesterday once: prize band, TP = points / 10, promotion', () => {
    const d = deps('attacker');
    let s = fz(L.openLeague(rich(fresh(), { gems: 0, mana: 1e5, manaMax: 1e5, manaPotions: 0 }), d, T0, {}).state);
    for (const simId of s.sim.league.simIds) for (let i = 0; i < 3; i++) s = fz(L.fightLeague(s, d, T0, { simId }).state);
    assert.equal(s.sim.league.points, 49 * 3 * 150);
    const next = L.openLeague(s, d, T0 + DAY, {});
    assert.equal(next.prizes.rank, 1);
    assert.equal(next.prizes.card, 'rare');
    assert.equal(next.state.player.manaPotions - s.player.manaPotions, 5);
    assert.equal(next.prizes.tournamentPoints, 49 * 3 * 15);
    assert.equal(next.league.tier, 'silver'); assert.equal(next.league.power, 1.05);
    assert.equal(next.league.day, '2026-10-08');
    assert.equal(next.league.points, 0);
    assert.equal(L.openLeague(fz(next.state), d, T0 + DAY + MIN, {}).prizes, null, 'settled only once');
  });
});
