import Foundation
import XCTest
@testable import EvokerCore

/// Replays the fights recorded from the web engine (Tools/gen-goldens.mjs) and compares the full event logs and
/// results. Three fixture files:
///  - battles-original.json: the original client's 64 simulator unit tests (raw cards with explicit buffs)
///  - battles-cards.json:    one fight per catalog card (the card in the middle slot against a fixed row)
///  - battles-random.json:   40 seeded random line-ups of real cards at random stages / levels
/// Each case carries the engine config as the web received it and the expected output.
final class GoldenBattleTests: XCTestCase {
    struct Case: Decodable {
        let name: String
        let seed: UInt32
        let attacker: FighterSide
        let defender: FighterSide
        let options: BattleOptions?
        /// For battles-cards / battles-random: the sides before buildSide (player + card refs), to test the whole chain.
        let attackerInput: SideInput?
        let defenderInput: SideInput?
        let expected: Expected
    }
    struct SideInput: Decodable {
        let player: FighterPlayer
        let cards: [CardRef?]
    }
    struct Expected: Decodable {
        let result: BattleResult
        let events: JSONValue
    }

    private func engine() -> BattleSimulating { BattleEngine() }

    private func run(_ file: String, buildSides: Bool, limit: Int? = nil) throws {
        let cases = try Golden.load(file, as: [Case].self)
        XCTAssertFalse(cases.isEmpty, "\(file) has no cases")
        var failures = 0
        for (i, c) in cases.enumerated() {
            if let limit, i >= limit { break }
            let eng = engine()
            var attacker = c.attacker, defender = c.defender
            if buildSides, let ai = c.attackerInput, let di = c.defenderInput {
                let opts = OpponentOps.sideOptions(deps: deps())
                attacker = eng.buildSide(ai.player, ai.cards.map { $0.map(SideEntry.ref) }, options: opts)
                defender = eng.buildSide(di.player, di.cards.map { $0.map(SideEntry.ref) }, options: opts)
                // the built sides must equal the web's built sides (stats, buffs, tribe bonus)
                let builtA = try JSONValue.of(attacker), builtD = try JSONValue.of(defender)
                if let d = Canon.firstDifference(EventProjection.projectSide(builtA), EventProjection.projectSide(try JSONValue.of(c.attacker))) {
                    XCTFail("\(file)[\(i)] \(c.name): built attacker differs: \(d)"); failures += 1; continue
                }
                if let d = Canon.firstDifference(EventProjection.projectSide(builtD), EventProjection.projectSide(try JSONValue.of(c.defender))) {
                    XCTFail("\(file)[\(i)] \(c.name): built defender differs: \(d)"); failures += 1; continue
                }
            }
            let cfg = BattleConfig(attacker: attacker, defender: defender, seed: c.seed, options: c.options ?? BattleOptions())
            let out = eng.simulateBattle(cfg)
            let actualResult = try JSONValue.of(out.result)
            let expectedResult = try JSONValue.of(c.expected.result)
            if let d = Canon.firstDifference(actualResult, expectedResult) {
                XCTFail("\(file)[\(i)] \(c.name): result differs: \(d)")
                failures += 1
            }
            let actualEvents = EventProjection.project(try JSONValue.of(out.events))
            let expectedEvents = EventProjection.project(c.expected.events)
            if let d = Canon.firstDifference(actualEvents, expectedEvents) {
                XCTFail("\(file)[\(i)] \(c.name): events differ: \(d)")
                failures += 1
            }
            if failures >= 5 { XCTFail("\(file): stopping after 5 failing cases"); break }
        }
    }

    private func deps() -> Deps {
        Deps(db: RealData.db, stats: Stats(), engine: BattleEngine(), quests: RealData.quests, names: RealData.names)
    }

    func testOriginalClientUnitTests() throws {
        try run("battles-original", buildSides: false)
    }

    func testOneFightPerCard() throws {
        try run("battles-cards", buildSides: true)
    }

    func testRandomRealFights() throws {
        try run("battles-random", buildSides: true)
    }
}

extension EventProjection {
    /// A built FighterSide projected to the fields the goldens compare: numbers, dirs, tribe, the resolved buff list
    /// is not part of the side (buffs come from `ability`), so compare player + cards without `ability` text/notes.
    static func projectSide(_ side: JSONValue) -> JSONValue {
        guard case .object(var s) = side else { return side }
        if case .object(let p)? = s["player"] { s["player"] = .object(p.filter { !$0.value.isNull }) }
        if case .array(let cards)? = s["cards"] {
            s["cards"] = .array(cards.map { card in
                guard case .object(var c) = card else { return card }
                c["ability"] = nil
                c["instanceId"] = nil
                return .object(c.filter { !$0.value.isNull })
            })
        }
        return .object(s)
    }
}
