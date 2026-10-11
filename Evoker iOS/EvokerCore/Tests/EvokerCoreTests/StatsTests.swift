import Foundation
import XCTest
@testable import EvokerCore

/// Port of `tests/stats.test.js` (the stat formulas; the game-layer helpers of that file belong to the game package).
final class StatsTests: XCTestCase {
    let db = RealData.db
    let stats = Stats()
    static let statKeys: [StatKey] = [.attack, .hp, .ability]

    /// Minimal synthetic card for formula tests without wiki checkpoints.
    func fixture(rarity: Rarity = .uncommon, base: CardBase = CardBase(attack: 300, hp: 500, ability: 200), growth: CardGrowth = CardGrowth(),
                 abilityIsPercent: Bool? = nil, caps: [Int]? = nil) -> CardDef {
        CardDef(id: "fixture", name: "Fixture", tribe: .elf, rarity: rarity, mana: 8, dirs: [.direct], base: base,
                caps: caps ?? Constants.rarity(.uncommon).caps, growth: growth, abilityIsPercent: abilityIsPercent)
    }

    func cardWith(mana: Int, rarity: Rarity = .uncommon, id: String = "x") -> CardDef {
        CardDef(id: id, name: id, tribe: .neutral, rarity: rarity, mana: mana, dirs: [], base: CardBase(attack: 1, hp: 1, ability: nil), caps: [])
    }

    func attackAt(_ c: CardDef, _ s: Int, _ l: Int, _ q: Double = 1) -> Int { stats.attackAt(c, stage: s, level: l, evolveQuality: q) }
    func hpAt(_ c: CardDef, _ s: Int, _ l: Int, _ q: Double = 1) -> Int { stats.hpAt(c, stage: s, level: l, evolveQuality: q) }
    func abilityAt(_ c: CardDef, _ s: Int, _ l: Int, _ q: Double = 1) -> Double? { stats.abilityAt(c, stage: s, level: l, evolveQuality: q) }
    func near(_ a: Double, _ b: Double, _ tol: Double = 1) -> Bool { abs(a - b) <= tol }

    // MARK: wiki checkpoints

    func testDwarfKingCheckpoints() {
        let king = db.get("dwarf-king")!
        XCTAssertEqual(attackAt(king, 0, 1), 800)
        XCTAssertTrue(near(Double(attackAt(king, 0, 14)), 1046))
        XCTAssertTrue(near(Double(attackAt(king, 4, 54)), 3849))
        XCTAssertTrue(near(Double(hpAt(king, 2, 34)), 6188))
        XCTAssertTrue(near(abilityAt(king, 3, 44)!, 5674))
        XCTAssertEqual(abilityAt(king, 0, 1), 1600)
    }

    func testWerewolfDwarfStage1Level1IsBaseTimes115() {
        let ww = db.get("werewolf-dwarf")!
        XCTAssertTrue(near(Double(attackAt(ww, 1, 1)), 1840))
        XCTAssertTrue(near(Double(attackAt(ww, 4, 54)), 7451))
        XCTAssertTrue(near(Double(hpAt(ww, 1, 24)), 3727))
    }

    func testEveryKnownWikiCapIsReproducedWithinOne() {
        var checked = 0
        var misses: [String] = []
        for card in db.all() {
            for stat in StatsTests.statKeys {
                for (stage, wiki) in card.growth.values(stat).enumerated() {
                    guard let wiki else { continue }
                    let got = stats.statAt(card, stat, stage: stage, level: stats.capFor(card, stage: stage), evolveQuality: 1) ?? -1
                    checked += 1
                    if abs(got - wiki) > 1 { misses.append("\(card.id) \(stat) stage \(stage): \(got) vs \(wiki)") }
                }
            }
        }
        XCTAssertGreaterThan(checked, 1400, "only \(checked) checkpoints")
        XCTAssertEqual(misses, [])
    }

    func testPercentAbilitiesInterpolateWithOneDecimal() {
        let djinn = db.get("djinn")!
        XCTAssertEqual(djinn.abilityIsPercent, true)
        XCTAssertEqual(abilityAt(djinn, 0, 1), 6)
        XCTAssertTrue(near(abilityAt(djinn, 0, 13)!, 18, 0.1))
        let mid = abilityAt(djinn, 0, 7)!
        XCTAssertEqual(mid, JSMath.round(mid * 10) / 10)
        XCTAssertTrue(mid > 6 && mid < 18)
        let darkMage = db.get("dark-mage")!
        XCTAssertEqual(abilityAt(darkMage, 1, 1), 15)
        XCTAssertTrue(near(abilityAt(darkMage, 4, 63)!, 20, 0.1))
    }

    func testFlatAbilitiesNeverGrow() {
        let bs = db.get("blood-spitter")!
        XCTAssertEqual(abilityAt(bs, 0, 1), 100)
        XCTAssertEqual(abilityAt(bs, 4, 27), 100)
        XCTAssertEqual(abilityAt(bs, 2, 10, 0.8), 100)
    }

    func testZeroAttackBasesGrowFromZero() {
        let stag = db.get("cursed-stag")!
        XCTAssertEqual(attackAt(stag, 0, 1), 0)
        XCTAssertEqual(attackAt(stag, 0, 14), 0)
        XCTAssertEqual(attackAt(stag, 1, 1), 0)
        XCTAssertEqual(attackAt(stag, 1, 24), 200)
    }

    // MARK: statAt formula

    func testUnknownCapsDeriveFromTheRarityTable() {
        let card = fixture()
        let g = Constants.rarity(.uncommon).growth
        for stage in 0...4 {
            let expected = JSMath.roundInt(300 * g[stage])
            XCTAssertTrue(near(Double(attackAt(card, stage, stats.capFor(card, stage: stage))), Double(expected)), "stage \(stage)")
            XCTAssertEqual(attackAt(card, stage, 1), JSMath.roundInt(300 * JSMath.pow(1.15, Double(stage))))
        }
    }

    func testBadWikiCapsAreReplacedByStartTimes13() {
        let card = fixture(growth: CardGrowth(attack: [nil, 100, nil, nil, nil]))
        let start = JSMath.roundInt(300 * 1.15)
        XCTAssertEqual(attackAt(card, 1, 1), start)
        XCTAssertEqual(attackAt(card, 1, 15), JSMath.roundInt(Double(start) * 1.3))
        // the bad cap is not a representative checkpoint: the other stages stay on the plain rarity table
        let g = Constants.rarity(.uncommon).growth
        XCTAssertTrue(near(Double(attackAt(card, 2, stats.capFor(card, stage: 2))), Double(JSMath.roundInt(300 * g[2]))))
    }

    func testUnknownCapsOfAPartlyKnownCardFollowItsOwnCurve() {
        let g = Constants.rarity(.uncommon).growth
        let card = fixture(growth: CardGrowth(attack: [JSMath.round(300 * g[0] * 1.2), JSMath.round(300 * g[1] * 1.2), nil, nil, nil]))
        for stage in [2, 3, 4] {
            let cap = stats.capFor(card, stage: stage)
            XCTAssertTrue(near(Double(attackAt(card, stage, cap)), JSMath.round(300 * g[stage] * 1.2)), "attack stage \(stage)")
            // hp and ability have no checkpoints of their own: they borrow the card's attack ratio
            XCTAssertTrue(near(Double(hpAt(card, stage, cap)), JSMath.round(500 * g[stage] * 1.2)), "hp stage \(stage)")
            XCTAssertTrue(near(abilityAt(card, stage, cap)!, JSMath.round(200 * g[stage] * 1.2)), "ability stage \(stage)")
        }
        XCTAssertEqual(attackAt(card, 0, 1), 300, "level-1 values are untouched")
    }

    func testAStatWithOwnCheckpointsUsesItsOwnRatio() {
        let g = Constants.rarity(.uncommon).growth
        let card = fixture(growth: CardGrowth(attack: [JSMath.round(300 * g[0] * 1.2), nil, nil, nil, nil], hp: [JSMath.round(500 * g[0] * 0.9), nil, nil, nil, nil]))
        let cap4 = stats.capFor(card, stage: 4)
        XCTAssertTrue(near(Double(hpAt(card, 4, cap4)), JSMath.round(500 * g[4] * 0.9)))
        XCTAssertTrue(near(Double(attackAt(card, 4, cap4)), JSMath.round(300 * g[4] * 1.2)))
        // ability borrows the median of the card's other stats (1.2 and 0.9 → 1.05)
        XCTAssertTrue(near(abilityAt(card, 4, cap4)!, JSMath.round(200 * g[4] * 1.05)))
    }

    func testPercentAbilitiesNeverTakeAPointStatScale() {
        let g = Constants.rarity(.uncommon).growth
        let card = fixture(base: CardBase(attack: 300, hp: 500, ability: 6), growth: CardGrowth(attack: [JSMath.round(300 * g[0] * 1.5), nil, nil, nil, nil]), abilityIsPercent: true)
        XCTAssertTrue(near(abilityAt(card, 4, stats.capFor(card, stage: 4))!, JSMath.round(6 * g[4] * 10) / 10, 0.1))
    }

    func testValuesAreMonotonicAndLevelIsClamped() {
        for card in db.all() {
            for stat in StatsTests.statKeys {
                guard card.base.value(stat) != nil else { continue }
                for stage in 0...4 {
                    var prev = -Double.infinity
                    for level in 1...stats.capFor(card, stage: stage) {
                        let v = stats.statAt(card, stat, stage: stage, level: level, evolveQuality: 1)!
                        XCTAssertGreaterThanOrEqual(v, prev, "\(card.id) \(stat) s\(stage) L\(level)")
                        prev = v
                    }
                }
            }
        }
        let king = db.get("dwarf-king")!
        XCTAssertEqual(attackAt(king, 0, 0), attackAt(king, 0, 1))
        XCTAssertEqual(attackAt(king, 0, 99), attackAt(king, 0, 14))
    }

    func testNilStatsStayNilWrappersDefaultToZero() {
        let gremlin = db.get("gremlin")!
        XCTAssertNil(stats.statAt(gremlin, .ability, stage: 0, level: 1, evolveQuality: 1))
        XCTAssertNil(abilityAt(gremlin, 0, 1))
        XCTAssertEqual(attackAt(gremlin, 0, 5), 0)
        XCTAssertEqual(stats.statsAt(gremlin, stage: 0, level: 1), CardStats(attack: 0, hp: 400, ability: nil))
    }

    func testEvolveQualityScalesAttackHpAndAbility() {
        let king = db.get("dwarf-king")!
        XCTAssertEqual(attackAt(king, 1, 1, 0.9), JSMath.roundInt(Double(attackAt(king, 1, 1)) * 0.9))
        XCTAssertEqual(hpAt(king, 1, 24, 0.75), JSMath.roundInt(Double(hpAt(king, 1, 24)) * 0.75))
        let djinn = db.get("djinn")!
        XCTAssertEqual(abilityAt(djinn, 1, 1, 0.8), JSMath.round(6 * 0.8 * 10) / 10)
    }

    func testCapForUsesTheCardCapsAndFallsBackToTheRarity() {
        XCTAssertEqual(stats.capFor(db.get("dwarf-king")!, stage: 4), 54)
        XCTAssertEqual(stats.capFor(db.get("siren")!, stage: 4), 27)
        XCTAssertEqual(stats.capFor(cardWith(mana: 1, rarity: .rare), stage: 2), 24)
        // the web throws a RangeError for stages outside 0...4; the Swift port traps (precondition), not testable here
    }

    // MARK: xp curves

    func testCardXpToNext() {
        XCTAssertEqual(stats.cardXpToNext(cardWith(mana: 3), level: 1, stage: 0), 20)
        XCTAssertEqual(stats.cardXpToNext(cardWith(mana: 24), level: 4, stage: 0), 768)
        XCTAssertEqual(stats.cardXpToNext(db.get("dwarf-king")!, level: 1, stage: 0), 96)
        XCTAssertGreaterThan(stats.cardXpToNext(cardWith(mana: 10), level: 10, stage: 0), stats.cardXpToNext(cardWith(mana: 10), level: 9, stage: 0))
        // the Common / Standard floor of unfused cards: 105 at level 1, 180 from level 2; fused cards keep the plain curve
        XCTAssertEqual(stats.cardXpToNext(cardWith(mana: 3, rarity: .standard), level: 1, stage: 0), 105)
        XCTAssertEqual(stats.cardXpToNext(cardWith(mana: 3, rarity: .standard), level: 2, stage: 0), 180)
        XCTAssertEqual(stats.cardXpToNext(cardWith(mana: 3, rarity: .standard), level: 2, stage: 1), JSMath.roundInt(40 * 3 * JSMath.pow(2, 1.5) / 10))
    }

    func testPlayerXpToNext() {
        XCTAssertEqual(stats.playerXpToNext(level: 1), 47)
        XCTAssertEqual(stats.playerXpToNext(level: 4), 94)
        XCTAssertEqual(stats.playerXpToNext(level: 5), 204)
        XCTAssertEqual(stats.playerXpToNext(level: 6), 240)
        XCTAssertEqual(stats.playerXpToNext(level: 7), 274)
        XCTAssertEqual(stats.playerXpToNext(level: 10), JSMath.roundInt(50 * JSMath.pow(10, 0.875)))
        XCTAssertNil(stats.playerXpToNext(level: Constants.maxPlayerLevel))
    }

    // MARK: economy formulas

    func testSellValueFollowsThePerRarityCoefficients() {
        XCTAssertEqual(stats.sellValue(cardWith(mana: 1, rarity: .common), stage: 0, level: 1), 50)
        XCTAssertEqual(stats.sellValue(cardWith(mana: 4, rarity: .standard), stage: 1, level: 3), JSMath.roundInt(6.5 * 4 * Double(10 + 3 + 2)))
        XCTAssertEqual(stats.sellValue(cardWith(mana: 6, rarity: .uncommon), stage: 0, level: 11), JSMath.roundInt(8.5 * 6 * 22))
        XCTAssertEqual(stats.sellValue(cardWith(mana: 12, rarity: .rare), stage: 2, level: 5), 6960)
        XCTAssertEqual(stats.sellValue(cardWith(mana: 20, rarity: .heroic), stage: 4, level: 45), 30 * 20 * (13 + 45 + 32))
        XCTAssertEqual(stats.sellValue(cardWith(mana: 24, rarity: .legendary), stage: 0, level: 1), 50 * 24 * 15)
        XCTAssertEqual(stats.sellValue(cardWith(mana: 30, rarity: .ultimate), stage: 1, level: 1), 55 * 30 * (15 + 1 + 12))
    }

    func testFusionCostPerRarityAndStage() {
        XCTAssertEqual(stats.fusionCost(rarity: .common, stage: 0), 200)
        XCTAssertEqual(stats.fusionCost(rarity: .common, stage: 3), 3200)
        XCTAssertEqual(stats.fusionCost(rarity: .standard, stage: 0), 400)
        XCTAssertEqual(stats.fusionCost(rarity: .uncommon, stage: 1), 3600)
        XCTAssertEqual(stats.fusionCost(rarity: .rare, stage: 2), 17280)
        XCTAssertEqual(stats.fusionCost(rarity: .heroic, stage: 3), 60000)
        XCTAssertEqual(stats.fusionCost(rarity: .legendary, stage: 0), 7200)
        XCTAssertEqual(stats.fusionCost(rarity: .ultimate, stage: 3), 172480)
        XCTAssertEqual(stats.fusionCost(rarity: db.get("dwarf-king")!.rarity, stage: 1), 28800)
        for r in Rarity.order {
            let costs = Constants.rarity(r).fusionCosts
            XCTAssertTrue(costs[0] < costs[1] && costs[1] < costs[2] && costs[2] < costs[3], r.rawValue)
        }
    }

    func testSacrificeXp() {
        XCTAssertEqual(stats.sacrificeXp(cardWith(mana: 6, rarity: .uncommon), stage: 0, level: 1), 450)
        XCTAssertEqual(stats.sacrificeXp(cardWith(mana: 1, rarity: .common), stage: 0, level: 1), JSMath.roundInt(25 * 1 * 3 * 0.6))
        XCTAssertEqual(stats.sacrificeXp(cardWith(mana: 24, rarity: .legendary), stage: 2, level: 10), JSMath.roundInt(25 * 24 * 12 * 3.5))
        XCTAssertEqual(stats.sacrificeXp(db.get("lich-king")!, stage: 0, level: 1), Constants.trainerXp["lich-king"])
        XCTAssertEqual(stats.sacrificeXp(db.get("crystal-ghost")!, stage: 0, level: 1), 9000)
        XCTAssertEqual(stats.sacrificeXp(db.get("blood-dragon")!, stage: 0, level: 5), 20000)
    }

    func testEnhancePriceReproducesTheObservedTrainingPrices() {
        let seen: [(Rarity, Int, Int, Int)] = [
            (.standard, 4, 1, 240), (.standard, 3, 4, 540), (.common, 2, 4, 441), (.standard, 3, 5, 660),
            (.standard, 3, 1, 180), (.common, 2, 1, 111), (.uncommon, 8, 1, 520), (.standard, 4, 1, 240),
        ]
        for (rarity, mana, level, gold) in seen {
            XCTAssertEqual(stats.enhancePrice(cardWith(mana: mana, rarity: rarity), level: level), gold, "\(rarity) \(mana) mana L\(level)")
        }
        XCTAssertGreaterThan(stats.enhancePrice(cardWith(mana: 24, rarity: .legendary), level: 1), stats.enhancePrice(cardWith(mana: 24, rarity: .rare), level: 1))
    }

    func testEvolveQualityIsOneWhateverTheLevels() {
        XCTAssertEqual(stats.evolveQuality(11, 11, 11, 11), 1)
        XCTAssertEqual(stats.evolveQuality(1, 11, 1, 11), 1)
        XCTAssertEqual(stats.evolveQuality(11, 11, 0, 11), 1)
        XCTAssertLessThanOrEqual(stats.evolveQuality(99, 11, 99, 11), 1)
    }

    func testAFusedLevel1ThroatCutterShows230And115() {
        let tc = CardDef(id: "tc", name: "Throat Cutter", tribe: .orc, rarity: .standard, mana: 3, dirs: [.direct], base: CardBase(attack: 200, hp: 100, ability: nil),
                         caps: [10, 12, 14, 16, 18], growth: CardGrowth(attack: [nil, 678, nil, nil, nil], hp: [nil, 340, nil, nil, nil]))
        let q = stats.evolveQuality(1, 10, 3, 10)
        XCTAssertEqual(stats.statAt(tc, .attack, stage: 1, level: 1, evolveQuality: q), 230)
        XCTAssertEqual(stats.statAt(tc, .hp, stage: 1, level: 1, evolveQuality: q), 115)
    }

    func testPowMatchesV8OnTheSampledInputs() {
        // The fdlibm port must reproduce V8's results where the host libm differs (see JSPow.swift)
        XCTAssertEqual(JSMath.pow(2, 1.5).bitPattern, 2.8284271247461898.bitPattern)
        XCTAssertEqual(JSMath.pow(18, 1.5).bitPattern, 76.36753236814712.bitPattern)
        XCTAssertEqual(JSMath.pow(7, 0.875).bitPattern, 5.488589936824572.bitPattern)
        XCTAssertEqual(JSMath.pow(1.15, 2), 1.3224999999999998)
        XCTAssertEqual(JSMath.pow(1.15, 3), 1.5208749999999998)
        XCTAssertEqual(JSMath.pow(1.15, 4), 1.7490062499999994)
        XCTAssertEqual(JSMath.pow(0.5, 1.1), 0.46651649576840371)
        XCTAssertEqual(JSMath.pow(1.15, 1), 1.15)
        XCTAssertEqual(JSMath.pow(4, 1.5), 8)
        XCTAssertEqual(JSMath.pow(9, 0.5), 3)
        XCTAssertEqual(JSMath.pow(5, 0), 1)
        XCTAssertEqual(JSMath.pow(-2, 3), -8)
        XCTAssertTrue(JSMath.pow(-2, 0.5).isNaN)
    }
}
