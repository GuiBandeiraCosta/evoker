import Foundation
import XCTest
@testable import EvokerCore

/// Stat formulas against the web's numbers (Tools/gen-goldens.mjs → stats.json): every card × stage × three
/// levels (1, middle, cap) for attack / hp / ability, plus the xp, sell, fusion, sacrifice and enhance tables.
final class GoldenStatsTests: XCTestCase {
    struct StatsGolden: Decodable {
        struct CardRow: Decodable {
            let id: String
            /// [stage][levelIndex] → {level, attack, hp, ability}
            let stages: [[Point]]
            let caps: [Int]
            let sell: [[Int]]        // [stage][levelIndex]
            let sacrifice: [[Int]]   // [stage][levelIndex]
            let enhance: [Int]       // per levelIndex of stage 0 levels
            let cardXp: [[Int]]      // [stage][levelIndex] cardXpToNext
        }
        struct Point: Decodable {
            let level: Int
            let attack: Int?
            let hp: Int?
            let ability: Double?
        }
        let cards: [CardRow]
        let playerXp: [Int?]          // index = level 1..; null = Infinity
        let fusionCosts: [String: [Int]]
    }

    func testStatCheckpoints() throws {
        let g = try Golden.load("stats", as: StatsGolden.self)
        let stats = Stats()
        var failures = 0
        for row in g.cards {
            guard let def = RealData.db.get(row.id) else { XCTFail("unknown card \(row.id)"); continue }
            for stage in 0..<row.stages.count {
                XCTAssertEqual(stats.capFor(def, stage: stage), row.caps[stage], "\(row.id) cap stage \(stage)")
                for (li, p) in row.stages[stage].enumerated() {
                    let a = stats.statAt(def, .attack, stage: stage, level: p.level, evolveQuality: 1)
                    let h = stats.statAt(def, .hp, stage: stage, level: p.level, evolveQuality: 1)
                    let ab = stats.statAt(def, .ability, stage: stage, level: p.level, evolveQuality: 1)
                    if a.map({ Int($0) }) != p.attack || h.map({ Int($0) }) != p.hp || !GoldenStatsTests.sameDouble(ab, p.ability) {
                        XCTFail("\(row.id) stage \(stage) level \(p.level): got \(a ?? -1)/\(h ?? -1)/\(ab.map { String($0) } ?? "nil") expected \(p.attack ?? -1)/\(p.hp ?? -1)/\(p.ability.map { String($0) } ?? "nil")")
                        failures += 1
                    }
                    XCTAssertEqual(stats.sellValue(def, stage: stage, level: p.level), row.sell[stage][li], "\(row.id) sell s\(stage) l\(p.level)")
                    XCTAssertEqual(stats.sacrificeXp(def, stage: stage, level: p.level), row.sacrifice[stage][li], "\(row.id) sacrifice s\(stage) l\(p.level)")
                    XCTAssertEqual(stats.cardXpToNext(def, level: p.level, stage: stage), row.cardXp[stage][li], "\(row.id) cardXp s\(stage) l\(p.level)")
                    if stage == 0 { XCTAssertEqual(stats.enhancePrice(def, level: p.level), row.enhance[li], "\(row.id) enhance l\(p.level)") }
                }
            }
            if failures > 10 { XCTFail("stopping after 10 failures"); break }
        }
        for (i, need) in g.playerXp.enumerated() {
            XCTAssertEqual(stats.playerXpToNext(level: i + 1), need, "playerXpToNext(\(i + 1))")
        }
        for (rarity, costs) in g.fusionCosts {
            for stage in 0..<costs.count {
                XCTAssertEqual(stats.fusionCost(rarity: Rarity(rawValue: rarity)!, stage: stage), costs[stage], "fusionCost \(rarity) \(stage)")
            }
        }
    }

    static func sameDouble(_ a: Double?, _ b: Double?) -> Bool {
        switch (a, b) {
        case (nil, nil): return true
        case (let x?, let y?): return abs(x - y) < 1e-9
        default: return false
        }
    }
}
