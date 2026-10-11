import Foundation
import XCTest
@testable import EvokerCore

/// Port of `tests/league.test.js`: three tiers, ~50 players, ties share a rank, prize bands to rank 29 per tier,
/// top 3 promote / the rest go back to Bronze, +150 per won league fight, Arena / Pieces points, settlement,
/// old-save migration. Real card db, stub engine (the test picks the winner).
final class LeagueTests: XCTestCase {
    /// A level-10 player with plenty of mana.
    private func player(seed: UInt32 = 4242, _ extra: (inout PlayerState) -> Void = { _ in }) -> GameState {
        var s = StateOps.newGame(name: "Tester", seed: seed, now: Fx.T0, deps: Fx.deps().deps)
        s.player.level = 10; s.player.gems = 0; s.player.mana = 5000; s.player.manaMax = 5000; s.player.staminaPotions = 0; s.player.manaPotions = 0
        extra(&s.player)
        return s
    }
    private func joined(_ s: GameState) -> GameState { LeagueOps.joinLeague(s) }

    // MARK: data

    func testTiersAndConstants() {
        XCTAssertEqual(LeagueOps.tiers.map { [$0.id.rawValue, $0.name, String($0.strength)] }, [["bronze", "Bronze League", "0.9"], ["silver", "Silver League", "1.05"], ["gold", "Gold League", "1.2"]])
        XCTAssertEqual(LeagueOps.leagueSize, 50); XCTAssertEqual(LeagueOps.simCount, 49)
        XCTAssertEqual(LeagueOps.pointsPerWin, 150); XCTAssertEqual(Constants.LeagueRules.pointsPerWinDouble, 300)
        XCTAssertEqual(Constants.LeagueRules.sourcePoints, ["league": 150, "arena": 50, "pieces": 30])
        XCTAssertEqual(LeagueOps.promoteTop, 3)
        XCTAssertEqual(LeagueOps.tierById("platinum").id, .gold, "old Platinum leagues map to Gold")
        XCTAssertEqual(LeagueOps.tierById("nope").id, .bronze)
    }

    func testPrizeTables() {
        let t = Dictionary(uniqueKeysWithValues: LeagueOps.prizeTables().map { ($0.tier.id, $0.rows.map { "\($0.rank): \($0.text)" }) })
        XCTAssertEqual(LeagueOps.prizeTables().map { $0.tier.id }, [.gold, .silver, .bronze], "Gold first like the PRIZES screen")
        XCTAssertEqual(t[.gold], ["1: 1 legendary card, 12 mana potions", "2: 1 legendary card", "3: 1 heroic card", "4: 700 gems", "5-9: 10 mana potions, 10 stamina potions", "10-19: 10 mana potions", "20-29: 200 gems"])
        XCTAssertEqual(t[.silver], ["1: 1 heroic card, 7 mana potions", "2: 1 heroic card", "3: 7 mana potions, 7 stamina potions", "4: 400 gems", "5-9: 5 mana potions, 5 stamina potions", "10-19: 5 mana potions", "20-29: 100 gems"])
        XCTAssertEqual(t[.bronze], ["1: 1 rare card, 5 mana potions", "2: 1 rare card", "3: 5 mana potions, 5 stamina potions", "4: 200 gems", "5-9: 2 mana potions, 2 stamina potions", "10-19: 2 mana potions", "20-29: 25 gems"])
        XCTAssertEqual(LeagueOps.prizeItems(.bronze, rank: 1), [PrizeItem(kind: .card, amount: 1, rarity: .rare), PrizeItem(kind: .mana, amount: 5)])
        XCTAssertEqual(LeagueOps.prizeItems(.bronze, rank: 3), [PrizeItem(kind: .mana, amount: 5), PrizeItem(kind: .stamina, amount: 5)])
        XCTAssertEqual(LeagueOps.prizeItems(.bronze, rank: 4), [PrizeItem(kind: .gems, amount: 200)])
        XCTAssertEqual(LeagueOps.prizeItems(.gold, rank: 29), [PrizeItem(kind: .gems, amount: 200)])
        XCTAssertEqual(LeagueOps.prizeItems(.gold, rank: 30), [])
        XCTAssertEqual(LeagueOps.prizeItems(.gold, rank: nil), [])
        XCTAssertEqual(LeagueOps.prizeFor(rank: 1, tier: .silver), LeaguePrize(gems: 0, potions: Array(repeating: .mana, count: 7), card: .heroic, mana: 7, stamina: 0))
        XCTAssertEqual(LeagueOps.prizeFor(rank: 30, tier: .bronze), LeaguePrize(gems: 0, potions: [], card: nil, mana: 0, stamina: 0))
    }

    func testPromotion() {
        XCTAssertEqual(LeagueOps.nextTier(.bronze, rank: 1, points: 150), .silver)
        XCTAssertEqual(LeagueOps.nextTier(.bronze, rank: 3, points: 150), .silver)
        XCTAssertEqual(LeagueOps.nextTier(.silver, rank: 2, points: 900), .gold)
        XCTAssertEqual(LeagueOps.nextTier(.gold, rank: 1, points: 9000), .gold)
        XCTAssertEqual(LeagueOps.nextTier(.gold, rank: 4, points: 9000), .bronze)
        XCTAssertEqual(LeagueOps.nextTier(.silver, rank: 20, points: 300), .bronze)
        XCTAssertEqual(LeagueOps.nextTier(.silver, rank: nil, points: 0), .bronze)
    }

    func testRanksTiesShareTheRank() {
        let row: (String, Int, Bool) -> LeagueRow = { LeagueRow(id: $0, name: $0, avatar: 0, picture: true, level: 1, points: $1, isPlayer: $2, fightsLeft: 0) }
        let rows = LeagueOps.rankRows([row("a", 1759, false), row("b", 750, false), row("c", 750, false), row("d", 745, false), row("me", 750, true), row("z", 0, false), row("y", 0, false)])
        XCTAssertEqual(rows.map { [$0.name, $0.rankText] }, [["a", "1"], ["me", "2"], ["b", "2"], ["c", "2"], ["d", "5"], ["y", "-"], ["z", "-"]])
        XCTAssertNil(rows[5].rank)
    }

    // MARK: a day of league

    func testOpeningJoinsTodaysLeague() {
        let d = Fx.deps().deps
        let s = player()
        XCTAssertFalse(LeagueOps.hasJoined(s))
        let o = LeagueOps.openLeague(s, deps: d, now: Fx.T0, event: nil)
        let lg = o.info.league
        XCTAssertNil(o.info.prizes)
        XCTAssertEqual(lg.v, LeagueOps.leagueVersion)
        XCTAssertEqual(lg.simIds.count, 49); XCTAssertEqual(Set(lg.simIds).count, 49)
        XCTAssertEqual(lg.tier, .bronze); XCTAssertEqual(lg.power, 0.9)
        XCTAssertEqual(lg.startedAt, JSDate.parseDay("2026-10-07")!); XCTAssertEqual(lg.endsAt, JSDate.parseDay("2026-10-08")!)
        XCTAssertEqual(o.state.sim.leagueJoined, false, "the enter popup is still to be confirmed")
        XCTAssertTrue(LeagueOps.hasJoined(LeagueOps.joinLeague(o.state)))
        XCTAssertEqual(LeagueOps.openLeague(o.state, deps: d, now: Fx.T0 + 60000, event: nil).state, o.state, "same day: unchanged")
        XCTAssertTrue(LeagueOps.openLeague(s, deps: d, now: Fx.T0, event: .doubleLeaguePoints).info.league.doublePoints)
    }

    func testSimulatedPlayersFillTheRowsPlausibly() {
        let d = Fx.deps().deps
        let o = LeagueOps.openLeague(player(), deps: d, now: Fx.T0, event: nil)
        let lg = o.info.league
        let end = lg.simIds.map { LeagueOps.simPoints(lg, simId: $0, now: lg.endsAt) }
        let zero = end.filter { $0 == 0 }.count
        XCTAssertTrue(zero >= 4 && zero <= 25, "\(zero) inactive players")
        XCTAssertTrue(end.max()! <= Int(Constants.LeagueRules.tiers[0].simTop) + 150 && end.max()! >= 600, "top \(end.max()!)")
        XCTAssertTrue(end.contains { $0 > 0 && $0 % 150 != 0 }, "arena / pieces points make odd scores")
        XCTAssertTrue(end.contains { $0 > 0 && $0 % 150 == 0 }, "pure league players score multiples of 150")
        for id in lg.simIds {
            XCTAssertEqual(LeagueOps.simPoints(lg, simId: id, now: lg.startedAt), 0)
            var prev = 0
            for h in 1...24 { let p = LeagueOps.simPoints(lg, simId: id, now: lg.startedAt + Int64(h) * 3600 * 1000); XCTAssertGreaterThanOrEqual(p, prev); prev = p }
            XCTAssertEqual(LeagueOps.simPoints(lg, simId: id, now: lg.endsAt + Fx.DAY), LeagueOps.simPoints(lg, simId: id, now: lg.endsAt), "frozen after the end")
            var dbl = lg
            dbl.doublePoints = true
            XCTAssertEqual(LeagueOps.simPoints(dbl, simId: id, now: lg.endsAt), 2 * LeagueOps.simPoints(lg, simId: id, now: lg.endsAt))
        }
        XCTAssertEqual(LeagueOps.openLeague(player(), deps: d, now: Fx.T0, event: nil).info.league, lg, "the same save gives the same league")
        let rows = LeagueOps.standings(o.state, deps: d, now: lg.endsAt - 1)
        XCTAssertEqual(rows.count, 50)
        let ranked = rows.filter { $0.rank != nil }
        for (i, r) in ranked.enumerated() where i > 0 {
            if r.points < ranked[i - 1].points { XCTAssertEqual(r.rank, i + 1) } else { XCTAssertEqual(r.rank, ranked[i - 1].rank) }
        }
        XCTAssertTrue(rows.filter { $0.rank == nil }.allSatisfy { $0.points == 0 && $0.rankText == "-" })
        XCTAssertTrue(rows.filter { $0.rank != nil && $0.rank! <= 29 }.allSatisfy { !$0.rewards.isEmpty })
        XCTAssertTrue(rows.filter { $0.rank == nil || $0.rank! >= 30 }.allSatisfy { $0.rewards.isEmpty })
        XCTAssertTrue(rows.allSatisfy { $0.markRank == ($0.rank != nil && $0.rank! <= 3) })
    }

    func testLeagueFightPointsAndLimit() throws {
        let dd = Fx.deps(.attacker)
        let d = dd.deps
        let s = LeagueOps.openLeague(joined(player()), deps: d, now: Fx.T0, event: nil).state
        let simId = s.sim.league!.simIds[0]
        let r1 = try LeagueOps.fightLeague(s, deps: d, now: Fx.T0, simId: simId, event: nil)
        XCTAssertEqual(r1.info.points, 150)
        XCTAssertEqual(r1.state.sim.league!.points, 150)
        XCTAssertEqual(r1.state.player.mana, 5000 - StateOps.deckMana(s, deps: d))
        let r3 = try LeagueOps.fightLeague(try LeagueOps.fightLeague(r1.state, deps: d, now: Fx.T0, simId: simId, event: nil).state, deps: d, now: Fx.T0, simId: simId, event: nil)
        XCTAssertEqual(r3.state.sim.league!.points, 450)
        assertThrows(try LeagueOps.fightLeague(r3.state, deps: d, now: Fx.T0, simId: simId, event: nil), "3 times")
        let rows = LeagueOps.standings(r3.state, deps: d, now: Fx.T0)
        XCTAssertFalse(rows.first { $0.id == simId }!.fightable)
        XCTAssertFalse(rows.first { $0.isPlayer }!.fightable)
        XCTAssertTrue(rows.filter { !$0.isPlayer && $0.id != simId }.allSatisfy { $0.fightable })
        XCTAssertEqual(try LeagueOps.fightLeague(s, deps: d, now: Fx.T0, simId: simId, event: .doubleLeaguePoints).info.points, 300)
        XCTAssertEqual(try LeagueOps.fightLeague(s, deps: Fx.deps(.defender).deps, now: Fx.T0, simId: simId, event: nil).info.points, 0)
        XCTAssertFalse(LeagueOps.canFightLeague(s, simId: simId, now: Fx.T0 + Fx.DAY).ok)
    }

    func testArenaAndPiecesWinsAddPoints() {
        let d = Fx.deps().deps
        let s = LeagueOps.openLeague(joined(player()), deps: d, now: Fx.T0, event: nil).state
        let a = LeagueOps.addLeaguePoints(s, deps: d, now: Fx.T0, source: .arena, won: true, event: nil)
        XCTAssertEqual(a.points, 50); XCTAssertEqual(a.state.sim.league!.points, 50)
        let p = LeagueOps.addLeaguePoints(a.state, deps: d, now: Fx.T0, source: .pieces, won: true, event: .doubleLeaguePoints)
        XCTAssertEqual(p.points, 60); XCTAssertEqual(p.state.sim.league!.points, 110)
        XCTAssertEqual(LeagueOps.addLeaguePoints(s, deps: d, now: Fx.T0, source: .arena, won: false, event: nil).points, 0)
        XCTAssertEqual(LeagueOps.addLeaguePoints(s, deps: d, now: Fx.T0, source: .arena, won: false, event: nil).state, s)
        let notJoined = LeagueOps.openLeague(player(), deps: d, now: Fx.T0, event: nil).state
        XCTAssertEqual(LeagueOps.addLeaguePoints(notJoined, deps: d, now: Fx.T0, source: .arena, won: true, event: nil).points, 0)
        let low = Fx.withPlayer(s) { $0.level = 1 }
        XCTAssertEqual(LeagueOps.addLeaguePoints(low, deps: d, now: Fx.T0, source: .arena, won: true, event: nil).points, 0)
        let next = LeagueOps.addLeaguePoints(s, deps: d, now: Fx.T0 + Fx.DAY, source: .arena, won: true, event: nil)
        XCTAssertEqual(next.points, 50)
        XCTAssertEqual(next.state.sim.league!.day, "2026-10-08")
        XCTAssertEqual(next.state.sim.league!.points, 50)
        XCTAssertEqual(next.state.sim.leagueHistory.count, 1)
    }

    func testPointsDependOnTheOpponent() {
        let d = Fx.deps().deps
        let s = LeagueOps.openLeague(joined(player()), deps: d, now: Fx.T0, event: nil).state
        let lv = s.player.level
        let pts: (LeaguePointSource, Difficulty?, Int?) -> Int = { LeagueOps.addLeaguePoints(s, deps: d, now: Fx.T0, source: $0, won: true, event: nil, difficulty: $1, oppLevel: $2).points }
        XCTAssertEqual(pts(.arena, .easy, lv), 20)
        XCTAssertEqual(pts(.arena, .normal, lv), 60)
        XCTAssertEqual(pts(.arena, .hard, lv), 120)
        XCTAssertEqual(pts(.arena, .hard, lv + 2), JSMath.roundInt(120 * 1.16))
        XCTAssertEqual(pts(.arena, .easy, lv - 20), 12) // floor 0.6×
        XCTAssertEqual(pts(.pieces, nil, lv + 30), 48) // cap 1.6×
        XCTAssertEqual(pts(.league, nil, lv + 30), 150) // league fights stay 150
        XCTAssertEqual(LeagueOps.leagueStake(s, source: .arena, difficulty: .hard, oppLevel: lv, event: nil), 120)
        XCTAssertEqual(LeagueOps.leagueStake(LeagueOps.openLeague(player(), deps: d, now: Fx.T0, event: nil).state, source: .arena, difficulty: .hard, oppLevel: lv, event: nil), 0)
    }

    // MARK: end of a league

    func testFirstPlaceInBronze() {
        let d = Fx.deps().deps
        let s = LeagueOps.openLeague(joined(player()), deps: d, now: Fx.T0, event: nil).state
        var lg = s.sim.league!
        lg.points = 99000
        var withPts = s
        withPts.sim.league = lg
        let st = LeagueOps.settleLeague(withPts, league: lg, deps: d)
        XCTAssertEqual(st.prizes.rank, 1); XCTAssertTrue(st.prizes.ranked)
        XCTAssertEqual(st.prizes.card, .rare); XCTAssertNotNil(st.prizes.cardId)
        XCTAssertEqual(Fx.db.get(st.prizes.cardId!)!.rarity, .rare)
        XCTAssertEqual(st.state.cards.count, s.cards.count + 1)
        XCTAssertEqual(st.state.player.manaPotions, 5); XCTAssertEqual(st.state.player.staminaPotions, 0)
        XCTAssertEqual(st.prizes.tournamentPoints, 9900)
        XCTAssertEqual(st.prizes.nextTier, .silver); XCTAssertTrue(st.prizes.promoted)
        XCTAssertEqual(st.state.sim.leagueTier, .silver)
        XCTAssertTrue(st.state.sim.league!.settled)
        XCTAssertEqual(st.state.sim.leaguePending, st.prizes)
        XCTAssertEqual(st.state.notices.last?.type, "league")
        let c = LeagueOps.collectLeagueResult(st.state, deps: d)
        XCTAssertNil(c.state.sim.leaguePending)
        XCTAssertEqual(c.state.cards.count, st.state.cards.count, "card was already granted")
        let next = LeagueOps.openLeague(c.state, deps: d, now: Fx.T0 + Fx.DAY, event: nil)
        XCTAssertEqual(next.info.league.tier, .silver); XCTAssertEqual(next.info.league.power, 1.05)
    }

    func testPendingCardPrizeIsGrantedOnConfirm() {
        let d = Fx.deps().deps
        let s = LeagueOps.openLeague(joined(player()), deps: d, now: Fx.T0, event: nil).state
        var lg = s.sim.league!
        lg.points = 99000
        var withPts = s
        withPts.sim.league = lg
        let settled = LeagueOps.settleLeague(withPts, league: lg, deps: d)
        XCTAssertFalse(settled.prizes.cardPending); XCTAssertNotNil(settled.prizes.cardId)
        var pending = settled.prizes
        pending.cardId = nil
        pending.cardPending = true
        var st = settled.state
        st.cards = s.cards
        st.sim.leaguePending = pending
        let c = LeagueOps.collectLeagueResult(st, deps: d)
        XCTAssertEqual(c.state.cards.count, s.cards.count + 1)
        XCTAssertEqual(Fx.db.get(c.result!.cardId!)!.rarity, .rare)
        XCTAssertNil(c.state.sim.leaguePending)
    }

    func testZeroPointsNoRankBackToBronze() {
        let d = Fx.deps().deps
        var silver = joined(player())
        silver.sim.leagueTier = .silver
        let s = LeagueOps.openLeague(silver, deps: d, now: Fx.T0, event: nil).state
        XCTAssertEqual(s.sim.league!.tier, .silver)
        let next = LeagueOps.openLeague(s, deps: d, now: Fx.T0 + Fx.DAY, event: nil)
        XCTAssertFalse(next.info.prizes!.ranked)
        XCTAssertGreaterThan(next.info.prizes!.rank, 1, "shown place below everybody who scored")
        XCTAssertEqual(next.info.prizes!.gems, 0); XCTAssertNil(next.info.prizes!.card); XCTAssertEqual(next.info.prizes!.potions, [])
        XCTAssertEqual(next.info.prizes!.nextTier, .bronze)
        XCTAssertEqual(next.info.league.tier, .bronze)
        XCTAssertNil(LeagueOps.openLeague(next.state, deps: d, now: Fx.T0 + Fx.DAY + 60000, event: nil).info.prizes, "settled only once")
    }

    func testRankFourInGold() {
        let d = Fx.deps().deps
        var gold = joined(player())
        gold.sim.leagueTier = .gold
        let s = LeagueOps.openLeague(gold, deps: d, now: Fx.T0, event: nil).state
        let ids = s.sim.league!.simIds
        var lg = s.sim.league!
        lg.profiles[ids[0]] = SimProfile(w: 100, x: 0, k: 1, pic: true)
        lg.profiles[ids[1]] = SimProfile(w: 99, x: 0, k: 1, pic: true)
        lg.profiles[ids[2]] = SimProfile(w: 98, x: 0, k: 1, pic: true)
        lg.points = 14000
        var withPts = s
        withPts.sim.league = lg
        let st = LeagueOps.settleLeague(withPts, league: lg, deps: d)
        XCTAssertEqual(st.prizes.rank, 4)
        XCTAssertEqual(st.prizes.gems, 700)
        XCTAssertEqual(st.state.player.gems, 700)
        XCTAssertEqual(st.prizes.nextTier, .bronze)
        XCTAssertFalse(st.prizes.promoted)
    }

    // MARK: old saves

    /// An 8-player league as saved before round 3.
    private func oldLeague(_ s: GameState, day: Int64, tier: String = "platinum") -> JSONValue {
        let start = JSDate.utcDayStart(day)
        let simIds = s.sim.players.prefix(8).map { $0.id }
        var rates: [String: JSONValue] = [:]
        for (i, id) in simIds.enumerated() { rates[id] = .number(Double(4 + i)) }
        return .object([
            "day": .string(JSDate.utcDay(day)), "startedAt": .number(Double(start)), "endsAt": .number(Double(start + Fx.DAY)), "tier": .string(tier),
            "power": .number(1.4), "simIds": .array(simIds.map { .string($0) }), "rates": .object(rates), "fights": .object([simIds[0]: .number(2)]),
            "points": .number(600), "doublePoints": .bool(false), "settled": .bool(false),
        ])
    }

    private func withOldLeague(_ base: GameState, _ league: JSONValue, leagueScore: Int) -> GameState {
        var raw = try! JSONValue.of(base)
        guard case .object(var o) = raw, case .object(var sim)? = o["sim"] else { fatalError() }
        sim = ["players": sim["players"]!, "day": sim["day"]!, "arena": sim["arena"]!, "league": league, "leagueScore": .number(Double(leagueScore)), "leagueHistory": .array([])]
        o["sim"] = .object(sim)
        raw = .object(o)
        return Fx.migrate(raw)
    }

    func testOldLeagueOfTodayIsUpgraded() {
        let d = Fx.deps().deps
        let base = LeagueOps.openLeague(player(), deps: d, now: Fx.T0, event: nil).state
        let old = withOldLeague(base, oldLeague(base, day: Fx.T0), leagueScore: 70000)
        XCTAssertEqual(LeagueOps.leagueTierOf(old), .gold)
        XCTAssertTrue(LeagueOps.hasJoined(old))
        XCTAssertNil(old.sim.leagueJoined)
        let o = LeagueOps.openLeague(old, deps: d, now: Fx.T0, event: nil)
        XCTAssertEqual(o.info.league.v, LeagueOps.leagueVersion)
        XCTAssertEqual(o.info.league.tier, .gold); XCTAssertEqual(o.info.league.power, 1.2)
        XCTAssertEqual(o.info.league.points, 600)
        XCTAssertEqual(o.info.league.simIds.count, 49)
        XCTAssertEqual(o.state.sim.leagueJoined, true)
        let kept = old.sim.league!.simIds[0]
        if o.info.league.simIds.contains(kept) { XCTAssertEqual(o.info.league.fights[kept], 2) }
        XCTAssertNil(o.info.prizes)
    }

    func testOldUnsettledLeagueFromYesterdayIsSettledWithItsRates() {
        let d = Fx.deps().deps
        let base = LeagueOps.openLeague(player(), deps: d, now: Fx.T0, event: nil).state
        let old = withOldLeague(base, oldLeague(base, day: Fx.T0 - Fx.DAY, tier: "bronze"), leagueScore: 0)
        XCTAssertEqual(LeagueOps.simPoints(old.sim.league!, simId: old.sim.league!.simIds[3], now: old.sim.league!.endsAt), 7 * 150)
        let st = LeagueOps.settleLeague(old, league: old.sim.league!, deps: d)
        XCTAssertEqual(st.prizes.tier, .bronze)
        XCTAssertEqual(st.prizes.rank, 8, "600 points: behind the 7 sims with 5..11 wins, tied with the one with 4")
        let o = LeagueOps.openLeague(st.state, deps: d, now: Fx.T0, event: nil)
        XCTAssertNil(o.info.prizes)
        XCTAssertEqual(o.info.league.v, LeagueOps.leagueVersion)
        XCTAssertEqual(o.info.league.day, "2026-10-07")
    }

    // MARK: fixture catalog

    func testDailyBracketFixture() {
        let f = Fx.fresh()
        let r = LeagueOps.openLeague(Fx.richFixture(f.state), deps: f.deps, now: Fx.T0, event: nil)
        XCTAssertNil(r.info.prizes)
        XCTAssertEqual(r.info.league.day, "2026-10-07")
        XCTAssertEqual(r.info.league.simIds.count, 49)
        XCTAssertEqual(r.info.league.tier, .bronze)
        XCTAssertEqual(r.info.league.endsAt - r.info.league.startedAt, Fx.DAY)
        let rows = LeagueOps.standings(r.state, deps: f.deps, now: Fx.T0)
        XCTAssertEqual(rows.count, 50)
        XCTAssertTrue(rows.contains { $0.isPlayer })
        for (i, x) in rows.enumerated() where i > 0 { XCTAssertGreaterThanOrEqual(rows[i - 1].points, x.points) }
        for id in r.info.league.simIds {
            let end = LeagueOps.simPoints(r.info.league, simId: id, now: r.info.league.endsAt)
            XCTAssertEqual(LeagueOps.simPoints(r.info.league, simId: id, now: r.info.league.startedAt), 0)
            XCTAssertLessThanOrEqual(LeagueOps.simPoints(r.info.league, simId: id, now: Fx.T0), end)
            XCTAssertEqual(LeagueOps.simPoints(r.info.league, simId: id, now: r.info.league.endsAt + Fx.DAY), end)
        }
        XCTAssertEqual(LeagueOps.openLeague(r.state, deps: f.deps, now: Fx.T0 + 3600 * 1000, event: nil).state, r.state)
        XCTAssertEqual(LeagueOps.tierById("silver").strength, 1.05)
    }

    func testLeagueFightsFixture() throws {
        let f = Fx.fresh(winner: .attacker)
        let s = LeagueOps.openLeague(Fx.richFixture(f.state), deps: f.deps, now: Fx.T0, event: nil).state
        let id = s.sim.league!.simIds[0]
        var r = try LeagueOps.fightLeague(s, deps: f.deps, now: Fx.T0, simId: id, event: nil)
        XCTAssertEqual(r.info.points, LeagueOps.pointsPerWin)
        XCTAssertEqual(r.state.sim.league!.points, 150)
        XCTAssertEqual(r.state.sim.league!.fights[id], 1)
        r = try LeagueOps.fightLeague(r.state, deps: f.deps, now: Fx.T0, simId: id, event: nil)
        r = try LeagueOps.fightLeague(r.state, deps: f.deps, now: Fx.T0, simId: id, event: nil)
        XCTAssertEqual(r.state.sim.league!.points, 450)
        assertThrows(try LeagueOps.fightLeague(r.state, deps: f.deps, now: Fx.T0, simId: id, event: nil), "3 times")
        f.engine.winner = .defender
        let loss = try LeagueOps.fightLeague(r.state, deps: f.deps, now: Fx.T0, simId: s.sim.league!.simIds[1], event: nil)
        XCTAssertEqual(loss.info.points, 0)
        f.engine.winner = .attacker
        let dbl = try LeagueOps.fightLeague(r.state, deps: f.deps, now: Fx.T0, simId: s.sim.league!.simIds[1], event: .doubleLeaguePoints)
        XCTAssertEqual(dbl.info.points, 300)
        XCTAssertEqual(f.engine.calls[0].defender.player.maxHp, JSMath.roundInt(Double(OpponentOps.getSim(s, simId: id)!.hpMax) * 0.9))
        assertThrows(try LeagueOps.fightLeague(r.state, deps: f.deps, now: Fx.T0 + Fx.DAY, simId: id, event: nil), "ended")
    }

    func testPrizesOnTheNextOpenFixture() throws {
        let f = Fx.fresh(winner: .attacker)
        var s = LeagueOps.openLeague(Fx.richFixture(f.state) { $0.mana = 100_000; $0.manaMax = 100_000 }, deps: f.deps, now: Fx.T0, event: nil).state
        for id in s.sim.league!.simIds { for _ in 0..<3 { s = try LeagueOps.fightLeague(s, deps: f.deps, now: Fx.T0, simId: id, event: nil).state } }
        XCTAssertEqual(s.sim.league!.points, 49 * 450)
        XCTAssertEqual(LeagueOps.finalStandings(s, league: s.sim.league!).rank, 1)
        let next = LeagueOps.openLeague(s, deps: f.deps, now: Fx.T0 + Fx.DAY, event: nil)
        XCTAssertEqual(next.info.prizes!.rank, 1)
        XCTAssertEqual(next.info.prizes!.card, .rare)
        XCTAssertEqual(next.info.prizes!.mana, 5)
        XCTAssertEqual(next.info.prizes!.tournamentPoints, 49 * 45)
        XCTAssertEqual(next.state.sim.leagueScore, 49 * 450)
        XCTAssertEqual(next.info.league.day, "2026-10-08")
        XCTAssertEqual(next.info.league.tier, .silver)
        XCTAssertEqual(next.info.league.points, 0)
        XCTAssertEqual(next.state.sim.leagueHistory.count, 1)
        XCTAssertEqual(LeagueOps.prizeFor(rank: 4, tier: .bronze), LeaguePrize(gems: 200, potions: [], card: nil, mana: 0, stamina: 0))
        XCTAssertEqual(LeagueOps.prizeFor(rank: 12, tier: .gold).mana, 10)
        XCTAssertEqual(LeagueOps.prizeFor(rank: 30, tier: .gold).gems, 0)
        let opened = LeagueOps.openLeague(Fx.richFixture(f.state), deps: f.deps, now: Fx.T0, event: nil).state
        let idle = LeagueOps.settleLeague(opened, league: opened.sim.league!, deps: f.deps)
        XCTAssertFalse(idle.prizes.ranked)
        XCTAssertEqual(idle.prizes.gems, 0)
        XCTAssertEqual(idle.prizes.nextTier, .bronze)
    }

    // MARK: §6

    func testLeaguePerDayAndStandings() {
        let d = Fx.deps().deps
        let now = Fx.T0 + 5 * 60 * Fx.MIN // 17:00 UTC
        let o = LeagueOps.openLeague(Fx.rich(Fx.freshReal()), deps: d, now: now, event: nil)
        let lg = o.info.league
        XCTAssertNil(o.info.prizes)
        XCTAssertEqual(lg.simIds.count, 49); XCTAssertEqual(Set(lg.simIds).count, 49)
        XCTAssertEqual(lg.day, "2026-10-07")
        XCTAssertEqual(lg.tier, .bronze); XCTAssertEqual(lg.power, 0.9)
        XCTAssertEqual(lg.points, 0); XCTAssertFalse(lg.doublePoints); XCTAssertFalse(lg.settled)
        let rows = LeagueOps.standings(o.state, deps: d, now: now)
        XCTAssertEqual(rows.count, 50)
        XCTAssertEqual(rows.filter { $0.isPlayer }.count, 1)
        for (i, r) in rows.enumerated() where i > 0 { XCTAssertLessThanOrEqual(r.points, rows[i - 1].points) }
        XCTAssertEqual(LeagueOps.openLeague(o.state, deps: d, now: now + Fx.MIN, event: nil).state, o.state)
    }

    func testSettlementOnTheNextDay() throws {
        let d = Fx.deps(.attacker).deps
        var s = LeagueOps.openLeague(Fx.rich(Fx.freshReal()) { $0.gems = 0; $0.mana = 100_000; $0.manaMax = 100_000; $0.manaPotions = 0 }, deps: d, now: Fx.T0, event: nil).state
        let simId = s.sim.league!.simIds[0]
        XCTAssertEqual(LeagueOps.canFightLeague(s, simId: simId, now: Fx.T0), CanFightLeague(ok: true, code: nil, reason: nil, fightsLeft: 3))
        let r1 = try LeagueOps.fightLeague(s, deps: d, now: Fx.T0, simId: simId, event: nil)
        XCTAssertEqual(r1.state.player.tournamentPoints, 0, "TP come from the league points at settlement, not per fight")
        XCTAssertEqual(r1.state.replays[0].mode, "league")
        XCTAssertEqual(LeagueOps.canFightLeague(s, simId: simId, now: Fx.T0 + Fx.DAY).code, .ended)
        assertThrows(try LeagueOps.fightLeague(Fx.withPlayer(s) { $0.mana = 0 }, deps: d, now: Fx.T0, simId: simId, event: nil), "mana")
        for id in s.sim.league!.simIds { for _ in 0..<3 { s = try LeagueOps.fightLeague(s, deps: d, now: Fx.T0, simId: id, event: nil).state } }
        XCTAssertEqual(s.sim.league!.points, 49 * 3 * 150)
        let next = LeagueOps.openLeague(s, deps: d, now: Fx.T0 + Fx.DAY, event: nil)
        XCTAssertEqual(next.info.prizes!.rank, 1)
        XCTAssertEqual(next.info.prizes!.card, .rare)
        XCTAssertEqual(next.state.player.manaPotions - s.player.manaPotions, 5)
        XCTAssertEqual(next.info.prizes!.tournamentPoints, 49 * 3 * 15)
        XCTAssertEqual(next.info.league.tier, .silver); XCTAssertEqual(next.info.league.power, 1.05)
        XCTAssertEqual(next.info.league.day, "2026-10-08")
        XCTAssertEqual(next.info.league.points, 0)
        XCTAssertNil(LeagueOps.openLeague(next.state, deps: d, now: Fx.T0 + Fx.DAY + Fx.MIN, event: nil).info.prizes, "settled only once")
    }
}
