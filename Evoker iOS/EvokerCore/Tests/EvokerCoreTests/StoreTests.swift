import Foundation
import XCTest
@testable import EvokerCore

/// Port of the store parts of `tests/app.test.js` (shiftClocks / addDays, parseSave, seedFromNow) and of
/// `app.js onOpen`: regen, the daily reward, league settlement and raids on (re)opening a save.
final class StoreTests: XCTestCase {
    func testShiftClocksMovesEveryClock() {
        XCTAssertEqual(JSDate.shiftDay("2026-10-07", -Fx.DAY), "2026-10-06")
        XCTAssertEqual(JSDate.shiftDay("", -Fx.DAY), "")
        var s = Fx.freshReal()
        s.daily.lastClaim = JSDate.utcDay(Fx.T0)
        s.sim.day = JSDate.utcDay(Fx.T0)
        s.sim.league = League(day: JSDate.utcDay(Fx.T0), startedAt: Fx.T0, endsAt: Fx.T0 + Fx.DAY, tier: .bronze, power: 0.9, simIds: [], profiles: [:])
        s.pieces = [PieceHunt(cardId: "x", owned: 1, total: 2, holderId: nil, raidDay: JSDate.utcDay(Fx.T0))]
        s.sim.arena.rerollAt = Fx.T0 + 1000
        s.quests.active = ActiveQuest(line: "main", n: 1, waves: [["envoy"]], figuresTotal: 1, startedAt: Fx.T0)
        let shifted = StoreHelpers.addDays(s, days: 2)
        XCTAssertEqual(shifted.createdAt, Fx.T0 - 2 * Fx.DAY)
        XCTAssertEqual(shifted.player.regenAt, Fx.T0 - 2 * Fx.DAY)
        XCTAssertEqual(shifted.daily.lastClaim, JSDate.utcDay(Fx.T0 - 2 * Fx.DAY))
        XCTAssertEqual(shifted.sim.day, JSDate.utcDay(Fx.T0 - 2 * Fx.DAY))
        XCTAssertEqual(shifted.sim.league!.day, JSDate.utcDay(Fx.T0 - 2 * Fx.DAY))
        XCTAssertEqual(shifted.sim.league!.endsAt, Fx.T0 - Fx.DAY)
        XCTAssertEqual(shifted.pieces[0].raidDay, JSDate.utcDay(Fx.T0 - 2 * Fx.DAY))
        XCTAssertEqual(shifted.sim.arena.rerollAt, Fx.T0 + 1000 - 2 * Fx.DAY)
        XCTAssertEqual(shifted.quests.active!.startedAt, Fx.T0 - 2 * Fx.DAY)
        XCTAssertEqual(shifted.daily.dayShift, 2, "the debug addDays remembers the skipped days")
        XCTAssertEqual(StoreHelpers.addDays(shifted, days: 1).daily.dayShift, 3)
        XCTAssertEqual(s.createdAt, Fx.T0, "input not mutated")
        let spent = Fx.withPlayer(shifted) { $0.stamina = 1; $0.mana = 1 }
        let regen = PlayerOps.applyRegen(spent, now: Fx.T0)
        XCTAssertEqual(regen.player.stamina, 50)
        XCTAssertEqual(regen.player.mana, 50)
        XCTAssertEqual(StoreHelpers.shiftClocks(s, deltaMs: 0).createdAt, Fx.T0)
        XCTAssertEqual(StoreHelpers.shiftClocks(s, deltaMs: -Fx.DAY).sim.arena.rerollAt, Fx.T0 + 1000 - Fx.DAY)
        var zero = s
        zero.sim.arena.rerollAt = 0
        XCTAssertEqual(StoreHelpers.shiftClocks(zero, deltaMs: -Fx.DAY).sim.arena.rerollAt, 0, "a zero clock stays zero")
    }

    func testSeedFromNow() {
        XCTAssertEqual(Seeds.seedFromNow(Fx.T0), Seeds.seedFromNow(Fx.T0))
        XCTAssertNotEqual(Seeds.seedFromNow(Fx.T0), Seeds.seedFromNow(Fx.T0 + 1))
        XCTAssertGreaterThan(Seeds.seedFromNow(0), 0)
    }

    func testOnOpenRegenDailyAndRaids() throws {
        let d = Fx.deps().deps
        var s = StateOps.newGame(name: "Tester", seed: 11, now: Fx.T0, deps: d)
        let first = AppFlow.onOpen(s, deps: d, now: Fx.T0)
        XCTAssertEqual(first.info.notices.count, 0, "the first day pays nothing")
        XCTAssertEqual(first.state.lastSeen, Fx.T0)
        // the next day: regen, the day-1 reward, a raid on a hunt from yesterday
        s = first.state
        s.player.stamina = 10
        s.player.mana = 10
        s = try PieceOps.addPiece(Fx.rich(s), deps: d, now: Fx.T0, cardId: Fx.sample(.rare).id).state
        s.pieces[0].owned = 3
        s.notices = [Notice(type: "raid", ["cardId": .string("old"), "day": .string("2026-10-01")])]
        let later = Fx.T0 + Fx.DAY
        let r = AppFlow.onOpen(s, deps: d, now: later)
        XCTAssertEqual(r.state.player.stamina, r.state.player.staminaMax, "regen refills over a day")
        XCTAssertEqual(r.state.daily.streak, 1)
        XCTAssertEqual(r.state.daily.lastClaim, JSDate.utcDay(later))
        XCTAssertEqual(r.info.notices.first?.type, "daily")
        XCTAssertEqual(r.info.notices.first?["day"]?.intValue, 1)
        XCTAssertEqual(r.info.notices.first?["stamina"]?.intValue, 2)
        XCTAssertTrue(r.info.notices.contains { $0.type == "raid" && $0["cardId"]?.stringValue == "old" }, "the save's own notices are drained")
        XCTAssertEqual(r.state.notices, [])
        XCTAssertEqual(r.state.pieces[0].raidDay, JSDate.utcDay(later))
        XCTAssertEqual(r.state.lastSeen, later)
        XCTAssertFalse(AppFlow.onOpen(r.state, deps: d, now: later + Fx.MIN).info.notices.contains { $0.type == "daily" }, "one claim per day")
    }

    func testOnOpenSettlesYesterdaysLeague() throws {
        let d = Fx.deps(.attacker).deps
        var s = Fx.rich(StateOps.newGame(name: "Tester", seed: 12, now: Fx.T0, deps: d))
        s = LeagueOps.openLeague(LeagueOps.joinLeague(s), deps: d, now: Fx.T0, event: nil).state
        s = try LeagueOps.fightLeague(s, deps: d, now: Fx.T0, simId: s.sim.league!.simIds[0], event: nil).state
        let r = AppFlow.onOpen(s, deps: d, now: Fx.T0 + Fx.DAY)
        XCTAssertTrue(r.state.sim.league!.settled)
        XCTAssertEqual(r.state.sim.leagueHistory.count, 1)
        XCTAssertNotNil(r.state.sim.leaguePending)
        XCTAssertTrue(r.info.notices.contains { $0.type == "league" })
        XCTAssertEqual(r.info.notices.first { $0.type == "league" }?["points"]?.intValue, 150)
        XCTAssertEqual(r.state.notices, [])
    }
}
