import Foundation
import XCTest
@testable import EvokerCore

/// Port of `tests/game-cards.test.js`: the collection (100-card inventory, selling, sorting, deck editing, card
/// xp), training and fusion, on the fixture catalog and against game-design §2 on the real data.
final class GameCardsTests: XCTestCase {
    // MARK: fixture catalog

    func testInventoryLimitSellsExtraRewardCards() throws {
        var f = Fx.fresh()
        while f.state.cards.count < CollectionOps.collectionLimit { f.state = try CollectionOps.addCard(f.state, deps: f.deps, cardId: "envoy").state }
        XCTAssertEqual(f.state.cards.count, 100)
        XCTAssertEqual(try CollectionOps.addCard(f.state, deps: f.deps, cardId: "envoy", force: true).state.cards.count, 101)
        let gold = f.state.player.gold
        let r = try CollectionOps.addCard(f.state, deps: f.deps, cardId: "rat-eater", level: 3)
        XCTAssertTrue(r.info.converted)
        XCTAssertNil(r.info.uid)
        XCTAssertEqual(r.state.cards.count, 100)
        XCTAssertEqual(r.info.gold, f.deps.stats.sellValue(f.deps.db.get("rat-eater")!, stage: 0, level: 3))
        XCTAssertEqual(r.state.player.gold, gold + r.info.gold)
    }

    func testSellingFormulaAndDeckProtection() throws {
        let f = Fx.fresh()
        assertThrows(try CollectionOps.sellCard(f.state, deps: f.deps, uid: f.state.deck[1]!), "deck")
        let envoy = f.state.cards.first { $0.cardId == "envoy" }!
        let r = try CollectionOps.sellCard(f.state, deps: f.deps, uid: envoy.uid)
        XCTAssertEqual(r.gold, 5 * 2 * (9 + 1 + 0))
        XCTAssertEqual(r.state.player.gold, 300 + r.gold)
        XCTAssertEqual(r.state.cards.count, 5)
    }

    func testSortingLevelManaName() {
        var f = Fx.fresh()
        var u: String
        (f.state, u) = Fx.give(f.state, f.deps, "rat-eater", level: 5)
        (f.state, _) = Fx.give(f.state, f.deps, "arch-angel", level: 5)
        let sorted = CollectionOps.sortCards(f.state.cards, db: f.deps.db)
        XCTAssertEqual(sorted[0].uid, u)
        XCTAssertEqual(sorted[1].cardId, "arch-angel")
        XCTAssertEqual(sorted[2].cardId, "bone-breaker")
        XCTAssertEqual(sorted[3].cardId, "scout")
        XCTAssertEqual(sorted[4].cardId, "master-brewer")
        XCTAssertEqual(sorted[5].cardId, "envoy")
        XCTAssertEqual(CollectionOps.bestCard(f.state, deps: f.deps)?.uid, u)
    }

    func testDeckEditingLockedSlotsManaLimitSwaps() throws {
        var f = Fx.fresh()
        let envoy = f.state.cards.first { $0.cardId == "envoy" }!
        assertThrows(try CollectionOps.placeInDeck(f.state, deps: f.deps, uid: envoy.uid, slot: 0), "locked")
        let r = try CollectionOps.placeInDeck(f.state, deps: f.deps, uid: envoy.uid, slot: 1)
        XCTAssertEqual(r.state.deck[1], envoy.uid)
        XCTAssertFalse(r.state.deck.contains(f.state.deck[1]))
        var big: String
        (f.state, _) = Fx.give(f.state, f.deps, "imperial-dragon")
        (f.state, big) = Fx.give(f.state, f.deps, "dwarf-king")
        let s2 = try CollectionOps.placeInDeck(f.state, deps: f.deps, uid: f.state.cards.first { $0.cardId == "imperial-dragon" }!.uid, slot: 1).state
        assertThrows(try CollectionOps.placeInDeck(s2, deps: f.deps, uid: big, slot: 2), "mana")
        XCTAssertTrue(CollectionOps.validateDeck(s2, deps: f.deps).ok)
        XCTAssertEqual(StateOps.deckMana(s2, deps: f.deps), 25 + 4 + 3)
    }

    func testCardXpLevelsUpAndStopsAtTheCap() {
        let f = Fx.fresh()
        let envoy = f.state.cards.first { $0.cardId == "envoy" }!
        let def = f.deps.db.get("envoy")!
        let r = CollectionOps.addCardXp(f.state, deps: f.deps, uid: envoy.uid, xp: f.deps.stats.cardXpToNext(def, level: 1, stage: 0) + f.deps.stats.cardXpToNext(def, level: 2, stage: 0))
        XCTAssertEqual(r.levelUps, [CardLevelUp(uid: envoy.uid, from: 1, to: 3)])
        let r2 = CollectionOps.addCardXp(r.state, deps: f.deps, uid: envoy.uid, xp: 1_000_000_000)
        let c = r2.state.cards.first { $0.uid == envoy.uid }!
        XCTAssertEqual(c.level, 9)
        XCTAssertEqual(c.xp, 0)
        XCTAssertTrue(r2.capped)
        XCTAssertEqual(CollectionOps.addCardXp(r2.state, deps: f.deps, uid: envoy.uid, xp: 100).levelUps.count, 0)
    }

    func testTrainingPreviewXpGoldAndRejections() {
        var f = Fx.fresh()
        f.state.player.gold = 10000
        let target = f.state.cards.first { $0.cardId == "envoy" }!
        let pike = f.state.cards.first { $0.cardId == "pikeman" }!
        let pouch = f.state.cards.first { $0.cardId == "pouch-tearer" }!
        let pv = TrainingOps.previewTraining(f.state, deps: f.deps, trainUid: target.uid, sacrificeUids: [pike.uid, pouch.uid])
        XCTAssertTrue(pv.ok)
        XCTAssertEqual(pv.xp, 2 * JSMath.roundInt(25 * 2 * 3 * 0.6))
        XCTAssertEqual(pv.gold, 111 + 111)
        XCTAssertGreaterThanOrEqual(pv.levelTo, pv.levelFrom)
        XCTAssertEqual(TrainingOps.previewTraining(f.state, deps: f.deps, trainUid: target.uid, sacrificeUids: [f.state.deck[1]!]).reason, "Cards in the active deck cannot be sacrificed")
        XCTAssertFalse(TrainingOps.previewTraining(f.state, deps: f.deps, trainUid: target.uid, sacrificeUids: [target.uid]).ok)
        XCTAssertFalse(TrainingOps.previewTraining(f.state, deps: f.deps, trainUid: target.uid, sacrificeUids: Array(repeating: pike.uid, count: 10)).ok)
        XCTAssertEqual(TrainingOps.previewTraining(Fx.withPlayer(f.state) { $0.gold = 0 }, deps: f.deps, trainUid: target.uid, sacrificeUids: [pike.uid]).reason, "Not enough gold")
    }

    func testTrainAppliesXpRemovesSacrificesPaysGold() throws {
        var f = Fx.fresh()
        f.state.player.gold = 10000
        var lich: String
        (f.state, lich) = Fx.give(f.state, f.deps, "lich-king")
        XCTAssertEqual(TrainingOps.sacrificeValue(deps: f.deps, inst: f.state.cards.first { $0.uid == lich }!), 4000)
        let target = f.state.cards.first { $0.cardId == "envoy" }!
        let r = try TrainingOps.train(f.state, deps: f.deps, trainUid: target.uid, sacrificeUids: [lich])
        XCTAssertEqual(r.info.xp, 4000)
        XCTAssertEqual(r.info.gold, 75)
        XCTAssertEqual(r.state.player.gold, 9925)
        XCTAssertFalse(r.state.cards.contains { $0.uid == lich })
        XCTAssertEqual(r.state.cards.first { $0.uid == target.uid }!.level, 9)
        XCTAssertEqual(r.info.levelUps[0].to, 9)
    }

    func testFusionRules() throws {
        var f = Fx.fresh()
        f.state.player.gold = 5000
        var a: String, b: String, c: String
        (f.state, a) = Fx.give(f.state, f.deps, "rat-eater", level: 12)
        (f.state, b) = Fx.give(f.state, f.deps, "rat-eater", level: 6)
        (f.state, c) = Fx.give(f.state, f.deps, "armorer", level: 12)
        let v = FusionOps.canFuse(f.state, deps: f.deps, uidA: a, uidB: b)
        XCTAssertTrue(v.ok)
        XCTAssertEqual(v.cost, 1920)
        XCTAssertEqual(v.quality, 1, "round 5: the input levels do not lower the result")
        XCTAssertNil(v.warning)
        XCTAssertFalse(FusionOps.canFuse(f.state, deps: f.deps, uidA: a, uidB: c).ok)
        XCTAssertFalse(FusionOps.canFuse(f.state, deps: f.deps, uidA: a, uidB: a).ok)
        let (s2, d) = Fx.give(f.state, f.deps, "rat-eater", stage: 1, level: 1)
        XCTAssertTrue(FusionOps.canFuse(s2, deps: f.deps, uidA: a, uidB: d).reason!.contains("same fusion stage"))
        XCTAssertEqual(FusionOps.canFuse(Fx.withPlayer(f.state) { $0.gold = 10 }, deps: f.deps, uidA: a, uidB: b).reason, "Not enough gold")
        let inDeck = try CollectionOps.placeInDeck(f.state, deps: f.deps, uid: a, slot: 1).state
        XCTAssertTrue(FusionOps.canFuse(inDeck, deps: f.deps, uidA: a, uidB: b).reason!.contains("deck"))
        XCTAssertEqual(FusionOps.fusionCandidates(f.state, deps: f.deps).count, 1)
    }

    func testFuseConsumesInputs() throws {
        var f = Fx.fresh()
        f.state.player.gold = 5000
        var a: String, b: String
        (f.state, a) = Fx.give(f.state, f.deps, "rat-eater", level: 12)
        (f.state, b) = Fx.give(f.state, f.deps, "rat-eater", level: 12)
        let r = try FusionOps.fuse(f.state, deps: f.deps, uidA: a, uidB: b)
        let fused = r.state.cards.first { $0.uid == r.info.uid }!
        XCTAssertEqual(fused.stage, 1)
        XCTAssertEqual(fused.level, 1)
        XCTAssertEqual(fused.evolveQuality, 1)
        XCTAssertEqual(r.state.player.gold, 5000 - 1920)
        XCTAssertEqual(r.state.cards.filter { $0.cardId == "rat-eater" }.count, 1)
        let (s4, d) = Fx.give(r.state, f.deps, "rat-eater", stage: 4)
        let (s5, e) = Fx.give(s4, f.deps, "rat-eater", stage: 4)
        XCTAssertTrue(FusionOps.canFuse(s5, deps: f.deps, uidA: d, uidB: e).reason!.contains("maximum fusion stage"))
    }

    // MARK: §2 cards (real data)

    func testInventoryOf100OnRealData() throws {
        XCTAssertEqual(CollectionOps.collectionLimit, 100)
        let d = Fx.deps().deps
        var s = Fx.freshReal()
        let def = Fx.sample(.rare)
        while s.cards.count < 100 { s = Fx.give(s, d, def.id, level: 3).0 }
        XCTAssertEqual(s.cards.count, 100)
        let over = try CollectionOps.addCard(s, deps: d, cardId: def.id, stage: 1, level: 7)
        XCTAssertTrue(over.info.converted)
        XCTAssertNil(over.info.uid)
        XCTAssertEqual(over.info.gold, d.stats.sellValue(def, stage: 1, level: 7))
        XCTAssertEqual(over.state.cards.count, 100)
        XCTAssertEqual(over.state.player.gold, s.player.gold + d.stats.sellValue(def, stage: 1, level: 7))
        let forced = try CollectionOps.addCard(s, deps: d, cardId: def.id, force: true)
        XCTAssertFalse(forced.info.converted)
        XCTAssertEqual(forced.state.cards.count, 101)
    }

    func testSortOrderOnRealData() {
        let d = Fx.deps().deps
        var s = Fx.freshReal()
        let hi = Fx.db.byRarity(.heroic).filter { !$0.isTrainer }.sorted { $0.mana > $1.mana }[0]
        let lo = Fx.db.byRarity(.uncommon).filter { !$0.isTrainer }.sorted { $0.mana < $1.mana }[0]
        s = Fx.give(s, d, hi.id, level: 5).0
        s = Fx.give(s, d, lo.id, level: 5).0
        s = Fx.give(s, d, lo.id, level: 9).0
        let sorted = CollectionOps.sortCards(s.cards, db: Fx.db)
        XCTAssertEqual(sorted[0].cardId, lo.id); XCTAssertEqual(sorted[0].level, 9)
        XCTAssertEqual(sorted[1].cardId, hi.id, "same level: higher mana first")
        for i in 1..<sorted.count {
            let a = sorted[i - 1], b = sorted[i]
            let ma = Fx.db.get(a.cardId)!.mana, mb = Fx.db.get(b.cardId)!.mana
            XCTAssertTrue(a.level > b.level || (a.level == b.level && (ma > mb || (ma == mb && JSString.localeCompare(Fx.db.get(a.cardId)!.name, Fx.db.get(b.cardId)!.name) <= 0))))
        }
        XCTAssertEqual(CollectionOps.bestCard(s, deps: d)?.cardId, lo.id)
    }

    func testTrainingXpFormulaPerRarity() {
        let factor: [Rarity: Double] = [.common: 0.6, .standard: 0.8, .uncommon: 1, .rare: 1.6, .heroic: 2.4, .legendary: 3.5, .ultimate: 5]
        let d = Fx.deps().deps
        for r in Fx.rarityIds {
            let def = Fx.sample(r)
            for level in [1, 3, 8] {
                for stage in [0, 2] {
                    let expected = JSMath.roundInt(25 * Double(def.mana) * Double(level + 2) * factor[r]!)
                    XCTAssertEqual(TrainingOps.sacrificeValue(deps: d, inst: CardInstance(uid: "x", cardId: def.id, stage: stage, level: level)), expected, "\(r) L\(level) s\(stage)")
                    XCTAssertEqual(d.stats.sacrificeXp(def, stage: stage, level: level), expected)
                }
            }
        }
        XCTAssertEqual(TrainingOps.sacrificeValue(deps: d, inst: CardInstance(uid: "x", cardId: "lich-king")), 4000)
        XCTAssertEqual(TrainingOps.sacrificeValue(deps: d, inst: CardInstance(uid: "x", cardId: "crystal-ghost")), 9000)
        XCTAssertEqual(TrainingOps.sacrificeValue(deps: d, inst: CardInstance(uid: "x", cardId: "blood-dragon")), 20000)
        XCTAssertEqual(TrainingOps.trainerXp, ["lich-king": 4000, "crystal-ghost": 9000, "blood-dragon": 20000])
    }

    func testTrainingSessionOnRealData() throws {
        let d = Fx.deps().deps
        var s = Fx.rich(Fx.freshReal())
        let target = Fx.sample(.rare)
        let fodder = Fx.sample(.uncommon)
        var tu: String
        (s, tu) = Fx.give(s, d, target.id, level: 1)
        var sac: [String] = []
        for _ in 0..<10 { var u: String; (s, u) = Fx.give(s, d, fodder.id, level: 4); sac.append(u) }
        let nine = Array(sac.prefix(9))
        let pv = TrainingOps.previewTraining(s, deps: d, trainUid: tu, sacrificeUids: nine)
        XCTAssertTrue(pv.ok)
        let perCard = JSMath.roundInt(25 * Double(fodder.mana) * 6 * 1)
        XCTAssertEqual(pv.xp, perCard * 9)
        XCTAssertEqual(pv.gold, 9 * d.stats.enhancePrice(fodder, level: 4))
        XCTAssertEqual(d.stats.enhancePrice(fodder, level: 4), JSMath.ceilInt((Double(fodder.mana) * 25 + 3 * 50) * 1.3 * 2))
        XCTAssertEqual(TrainingOps.trainingCost(deps: d, insts: [CardInstance(uid: "a", cardId: "envoy"), CardInstance(uid: "b", cardId: "master-brewer")]), 111 + 180)
        XCTAssertEqual(TrainingOps.sacrificePrice(deps: d, inst: CardInstance(uid: "a", cardId: "envoy", level: 4)), 441)
        XCTAssertEqual(TrainingOps.maxSacrifices, 9)
        XCTAssertFalse(TrainingOps.previewTraining(s, deps: d, trainUid: tu, sacrificeUids: sac).ok, "10 sacrifices refused")
        XCTAssertTrue(TrainingOps.previewTraining(s, deps: d, trainUid: tu, sacrificeUids: sac).reason!.contains("9"))
        XCTAssertFalse(TrainingOps.previewTraining(s, deps: d, trainUid: tu, sacrificeUids: [s.deck[1]!]).ok, "deck card cannot be sacrificed")
        XCTAssertFalse(TrainingOps.previewTraining(s, deps: d, trainUid: tu, sacrificeUids: [tu]).ok)
        let r = try TrainingOps.train(s, deps: d, trainUid: tu, sacrificeUids: nine)
        XCTAssertEqual(r.state.cards.count, s.cards.count - 9)
        XCTAssertEqual(r.state.player.gold, s.player.gold - pv.gold)
        XCTAssertEqual(r.info.xp, pv.xp)
        let after = StateOps.getCard(r.state, uid: tu)!
        XCTAssertGreaterThan(after.level, 1)
        XCTAssertEqual(r.info.levelUps.count, 1)
        XCTAssertEqual(r.info.levelUps[0].from, 1)
        XCTAssertEqual(r.info.levelUps[0].to, after.level)
        XCTAssertEqual(after.level, pv.levelTo)
        var pool = pv.xp, lvl = 1
        while lvl < d.stats.capFor(target, stage: 0) && pool >= d.stats.cardXpToNext(target, level: lvl, stage: 0) { pool -= d.stats.cardXpToNext(target, level: lvl, stage: 0); lvl += 1 }
        XCTAssertEqual(after.level, lvl)
        XCTAssertEqual(after.xp, lvl >= d.stats.capFor(target, stage: 0) ? 0 : pool)
        let poor = Fx.withPlayer(s) { $0.gold = pv.gold - 1 }
        XCTAssertEqual(TrainingOps.previewTraining(poor, deps: d, trainUid: tu, sacrificeUids: nine).reason, "Not enough gold")
        assertThrows(try TrainingOps.train(poor, deps: d, trainUid: tu, sacrificeUids: nine), "gold")
        let capLevel = d.stats.capFor(target, stage: 0)
        let capped = StateOps.updateCard(s, uid: tu) { $0.level = capLevel }
        XCTAssertFalse(TrainingOps.previewTraining(capped, deps: d, trainUid: tu, sacrificeUids: nine).ok)
    }

    func testFusionCostsPerRarityAndStage() {
        let table: [Rarity: [Int]] = [
            .common: [200, 800, 1800, 3200], .standard: [400, 1600, 3600, 6400], .uncommon: [900, 3600, 8100, 14400],
            .rare: [1920, 7680, 17280, 30720], .heroic: [3750, 15000, 33750, 60000], .legendary: [7200, 28800, 64800, 115200],
            .ultimate: [10780, 43120, 97020, 172480],
        ]
        let stats = Stats()
        for r in Fx.rarityIds { for st in 0..<4 { XCTAssertEqual(stats.fusionCost(rarity: r, stage: st), table[r]![st], "\(r) \(st)") } }
    }

    func testFusionOnRealData() throws {
        let d = Fx.deps().deps
        let def = Fx.sample(.uncommon)
        let cap0 = d.stats.capFor(def, stage: 0)
        var s = Fx.rich(Fx.freshReal())
        var a: String, b: String, c: String, e: String
        (s, a) = Fx.give(s, d, def.id, level: cap0)
        (s, b) = Fx.give(s, d, def.id, level: cap0)
        (s, c) = Fx.give(s, d, def.id, level: 1)
        (s, e) = Fx.give(s, d, def.id, stage: 1, level: 1)
        let perfect = FusionOps.canFuse(s, deps: d, uidA: a, uidB: b)
        XCTAssertTrue(perfect.ok)
        XCTAssertEqual(perfect.quality, 1)
        XCTAssertEqual(perfect.cost, 900)
        XCTAssertEqual(perfect.stage, 1)
        XCTAssertNil(perfect.warning)
        let weak = FusionOps.canFuse(s, deps: d, uidA: a, uidB: c)
        XCTAssertTrue(weak.ok)
        XCTAssertEqual(weak.quality, 1)
        XCTAssertNil(weak.warning)
        XCTAssertEqual(d.stats.evolveQuality(1, 10, 1, 10), 1)
        XCTAssertEqual(d.stats.evolveQuality(10, 10, 10, 10), 1)
        XCTAssertFalse(FusionOps.canFuse(s, deps: d, uidA: a, uidB: e).ok, "different stages")
        XCTAssertFalse(FusionOps.canFuse(s, deps: d, uidA: a, uidB: a).ok)
        XCTAssertFalse(FusionOps.canFuse(s, deps: d, uidA: a, uidB: s.deck[1]!).ok, "different card")
        let r = try FusionOps.fuse(s, deps: d, uidA: a, uidB: c)
        let out = StateOps.getCard(r.state, uid: r.info.uid)!
        XCTAssertEqual(out.stage, 1); XCTAssertEqual(out.level, 1); XCTAssertEqual(out.xp, 0)
        XCTAssertEqual(out.evolveQuality, weak.quality)
        XCTAssertEqual(r.state.player.gold, s.player.gold - 900)
        XCTAssertNil(StateOps.getCard(r.state, uid: a)); XCTAssertNil(StateOps.getCard(r.state, uid: c))
        XCTAssertEqual(r.state.cards.count, s.cards.count - 1)
        // a stored evolve bonus (saves from before round 5) still scales attack / hp
        let q = 0.8
        XCTAssertEqual(d.stats.statAt(def, .attack, stage: 1, level: 1, evolveQuality: q), JSMath.round(d.stats.statAt(def, .attack, stage: 1, level: 1, evolveQuality: 1)! * q))
        XCTAssertEqual(d.stats.statAt(def, .hp, stage: 1, level: 5, evolveQuality: q), JSMath.round(d.stats.statAt(def, .hp, stage: 1, level: 5, evolveQuality: 1)! * q))
        var s4: GameState, x: String, y: String
        (s4, x) = Fx.give(s, d, def.id, stage: 4, level: 1)
        (s4, y) = Fx.give(s4, d, def.id, stage: 4, level: 1)
        XCTAssertFalse(FusionOps.canFuse(s4, deps: d, uidA: x, uidB: y).ok)
        XCTAssertEqual(FusionOps.maxStage, 4)
        // 16 base cards make a ++++
        var s16 = Fx.rich(Fx.freshReal())
        var uids: [String] = []
        for _ in 0..<16 { var u: String; (s16, u) = Fx.give(s16, d, def.id, level: 1); uids.append(u) }
        for _ in 0..<4 {
            var next: [String] = []
            var i = 0
            while i < uids.count {
                let f = try FusionOps.fuse(s16, deps: d, uidA: uids[i], uidB: uids[i + 1])
                s16 = f.state
                next.append(f.info.uid)
                i += 2
            }
            uids = next
        }
        XCTAssertEqual(uids.count, 1)
        XCTAssertEqual(StateOps.getCard(s16, uid: uids[0])!.stage, 4)
        XCTAssertEqual(FusionOps.canFuse(Fx.withPlayer(s) { $0.gold = 899 }, deps: d, uidA: a, uidB: b).reason, "Not enough gold")
    }

    func testSellingFormulasPerRarity() throws {
        let d = Fx.deps().deps
        for r in Fx.rarityIds {
            for def in Fx.db.byRarity(r).prefix(4) {
                for (stage, level) in [(0, 1), (1, 5), (3, 2), (4, 9)] {
                    let M = Double(def.mana), L = Double(level), F = Double(stage)
                    let expected: Double
                    switch r {
                    case .common: expected = 5 * M * (9 + L + F)
                    case .standard: expected = 6.5 * M * (10 + L + 2 * F)
                    case .uncommon: expected = 8.5 * M * (11 + L + 4 * F)
                    case .rare: expected = 20 * M * (12 + L + 6 * F)
                    case .heroic: expected = 30 * M * (13 + L + 8 * F)
                    case .legendary: expected = 50 * M * (14 + L + 10 * F)
                    case .ultimate: expected = 55 * M * (15 + L + 12 * F)
                    }
                    XCTAssertEqual(d.stats.sellValue(def, stage: stage, level: level), JSMath.roundInt(expected), "\(def.id) s\(stage) L\(level)")
                }
            }
        }
        var s = Fx.rich(Fx.freshReal())
        let def = Fx.sample(.heroic)
        var u: String
        (s, u) = Fx.give(s, d, def.id, stage: 2, level: 4)
        let r = try CollectionOps.sellCard(s, deps: d, uid: u)
        XCTAssertEqual(r.gold, JSMath.roundInt(30 * Double(def.mana) * (13 + 4 + 16)))
        XCTAssertEqual(r.state.player.gold, s.player.gold + r.gold)
        XCTAssertNil(StateOps.getCard(r.state, uid: u))
        assertThrows(try CollectionOps.sellCard(s, deps: d, uid: s.deck[1]!), "active deck")
        XCTAssertEqual(CollectionOps.sellValueOf(s, deps: d, uid: u), r.gold)
    }

    func testCardXpPerFightAndThresholds() {
        XCTAssertEqual(PlayerOps.cardFightXp(enemyDeckMana: 20, won: false, infiniteWisdom: false), 20)
        XCTAssertEqual(PlayerOps.cardFightXp(enemyDeckMana: 20, won: true, infiniteWisdom: false), 30)
        XCTAssertEqual(PlayerOps.cardFightXp(enemyDeckMana: 20, won: true, infiniteWisdom: true), 60)
        XCTAssertEqual(PlayerOps.cardFightXp(enemyDeckMana: 20, won: false, infiniteWisdom: true), 40)
        XCTAssertEqual(PlayerOps.cardFightXp(enemyDeckMana: 0, won: false, infiniteWisdom: false), 10)
        XCTAssertEqual(PlayerOps.cardFightXp(enemyDeckMana: 11, won: true, infiniteWisdom: false), JSMath.roundInt(15.5 * 1.5))
        let stats = Stats()
        for def in Fx.db.all().prefix(60) {
            for l in 1...12 {
                let curve = max(20, JSMath.roundInt(40 * Double(def.mana) * pow(Double(l), 1.5) / 10))
                let floor = (def.rarity == .common || def.rarity == .standard) ? (l == 1 ? 105 : 180) : 0
                XCTAssertEqual(stats.cardXpToNext(def, level: l, stage: 0), max(curve, floor), "\(def.id) L\(l)")
                XCTAssertEqual(stats.cardXpToNext(def, level: l, stage: 1), curve, "\(def.id)+ L\(l): a fused card keeps the curve")
            }
        }
    }

    func testCardXpCappedAtTheStageCapAndDeckXp() {
        let d = Fx.deps().deps
        var s = Fx.freshReal()
        let def = Fx.sample(.standard)
        let cap = d.stats.capFor(def, stage: 0)
        var u: String
        (s, u) = Fx.give(s, d, def.id, level: 1)
        let r = CollectionOps.addCardXp(s, deps: d, uid: u, xp: 10_000_000)
        XCTAssertEqual(StateOps.getCard(r.state, uid: u)!.level, cap)
        XCTAssertEqual(StateOps.getCard(r.state, uid: u)!.xp, 0)
        XCTAssertTrue(r.capped)
        XCTAssertEqual(r.levelUps, [CardLevelUp(uid: u, from: 1, to: cap)])
        let again = CollectionOps.addCardXp(r.state, deps: d, uid: u, xp: 50)
        XCTAssertEqual(again.state, r.state, "a capped card gains nothing")
        XCTAssertTrue(again.capped)
        let need1 = d.stats.cardXpToNext(def, level: 1, stage: 0)
        let r1 = CollectionOps.addCardXp(s, deps: d, uid: u, xp: need1 - 1)
        XCTAssertEqual(StateOps.getCard(r1.state, uid: u)!.level, 1)
        XCTAssertEqual(StateOps.getCard(r1.state, uid: u)!.xp, need1 - 1)
        let r2 = CollectionOps.addCardXp(r1.state, deps: d, uid: u, xp: 1)
        XCTAssertEqual(StateOps.getCard(r2.state, uid: u)!.level, 2)
        XCTAssertEqual(StateOps.getCard(r2.state, uid: u)!.xp, 0)
        let dx = CollectionOps.addDeckXp(s, deps: d, xp: 25)
        for uid in s.deck.compactMap({ $0 }) {
            let c = StateOps.getCard(dx.state, uid: uid)!
            XCTAssertTrue(c.level > 1 || c.xp == 25, "deck card got the xp")
        }
        XCTAssertEqual(StateOps.getCard(dx.state, uid: u)!.xp, 0, "cards outside the deck get nothing")
    }

    func testDeckRules() throws {
        let d = Fx.deps().deps
        var s = Fx.freshReal()
        let big = Fx.db.all().filter { !$0.isTrainer }.sorted { $0.mana > $1.mana }[0]
        var u: String
        (s, u) = Fx.give(s, d, big.id, level: 1)
        s.player.manaMax = 20
        XCTAssertEqual(StateOps.deckMana(s, deps: d), 4 + 4 + 3)
        XCTAssertTrue(CollectionOps.validateDeck(s, deps: d).ok)
        XCTAssertEqual(CollectionOps.validateDeck(s, deps: d).mana, 11)
        assertThrows(try CollectionOps.placeInDeck(s, deps: d, uid: u, slot: 1), "Mana needed")
        let roomy = Fx.withPlayer(s) { $0.manaMax = 500 }
        let placed = try CollectionOps.placeInDeck(roomy, deps: d, uid: u, slot: 1)
        XCTAssertEqual(placed.mana, 11 - 4 + big.mana)
        XCTAssertEqual(placed.state.deck[1], u)
        XCTAssertFalse(placed.state.deck.contains(s.deck[1]), "displaced card leaves the deck when the mover came from outside")
        let swap = try CollectionOps.placeInDeck(s, deps: d, uid: s.deck[1]!, slot: 2)
        XCTAssertEqual(swap.state.deck[2], s.deck[1])
        XCTAssertEqual(swap.state.deck[1], s.deck[2], "cards swap places")
        assertThrows(try CollectionOps.setDeck(s, deps: d, slots: [nil, u, u, nil, nil]), "Duplicate")
        assertThrows(try CollectionOps.setDeck(s, deps: d, slots: [nil, nil, nil, nil, nil]), "empty")
        XCTAssertNil(CollectionOps.removeFromDeck(s, slot: 1).deck[1])
    }
}
