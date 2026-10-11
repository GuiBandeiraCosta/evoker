import Foundation
import XCTest
@testable import EvokerCore

/// Port of `tests/shop.test.js` (the game-layer parts): the nine-card booster grid, the shop banner list, daily
/// rewards, set collections, the potion deal and the daily event on the save clock.
final class ShopTests: XCTestCase {
    private func withGems(_ s: GameState, _ gems: Int) -> GameState { Fx.withPlayer(s) { $0.gems = gems } }

    // MARK: booster packs

    func testBoosterConstants() {
        XCTAssertEqual(Constants.boosterGridCards, 9)
        XCTAssertEqual(ShopOps.boosterCards, 9)
        XCTAssertEqual(Dictionary(uniqueKeysWithValues: Constants.boosterPacks.map { ($0.id, $0.pickGems) }), [.neophyte: 50, .summoner: 350, .archmage: 975, .portalLow: 250, .portalHigh: 1000])
        for b in Constants.boosterPacks { XCTAssertEqual(b.slots.reduce(0) { $0 + $1.1 }, 9, b.id.rawValue) }
        XCTAssertEqual(Constants.boosterPack(.portalHigh).slots.map { $0.1 }, [5, 3, 1])
        XCTAssertEqual(Constants.boosterPack(.portalLow).slots.map { $0.0 }, [.uncommon, .rare, .heroic])
        XCTAssertEqual(ShopOps.boosterPrice(.archmage, event: nil), 975)
        XCTAssertEqual(ShopOps.boosterPrice(.archmage, event: .getTheBestCards), 488)
        XCTAssertEqual(ShopOps.boosterPrice(.neophyte, event: .getTheBestCards), 25)
        XCTAssertEqual(ShopOps.booster(.neophyte).mayContain, [.uncommon, .rare, .heroic])
        XCTAssertEqual(ShopOps.booster(.portalHigh).mayContain, [.rare, .heroic, .legendary, .ultimate])
        XCTAssertEqual(Constants.gemPacks.map { $0.gems }, [500, 1000, 3500, 10000, 20000])
        XCTAssertEqual(Constants.gemPacks.map { $0.price }, ["$4.99", "$9.99", "$24.99", "$49.99", "$99.99"])
        XCTAssertEqual(Constants.gemPacks[3].card, .heroic)
        for b in ShopOps.boosters { XCTAssertEqual(b.token, b.pack.id) }
    }

    func testRollingMainPacksKeepsTheMakeUp() throws {
        let d = Fx.deps().deps
        for id in [TokenKind.neophyte, .summoner, .archmage] {
            for seed in 1...40 {
                let cards = try ShopOps.rollBoosterCards(rng: Mulberry32(UInt32(seed)), deps: d, id: id, portalId: nil)
                XCTAssertEqual(cards.count, 9)
                var tally: [Rarity: Int] = [:]
                for c in cards {
                    let def = Fx.db.get(c)
                    XCTAssertTrue(def != nil && !def!.isTrainer, c)
                    XCTAssertEqual(def!.set, "main", "\(id) \(c)")
                    tally[def!.rarity, default: 0] += 1
                }
                XCTAssertEqual(tally, Dictionary(uniqueKeysWithValues: Constants.boosterPack(id).slots), "\(id) seed \(seed)")
            }
        }
    }

    func testPortalPacksMixTheSets() throws {
        let d = Fx.deps().deps
        let portal = Fx.quests.portals.first { $0.id == "the-dark-beyond" }!
        var fromPortal = 0, ultimates = 0
        let N = 600
        for seed in 1...N {
            let cards = try ShopOps.rollBoosterCards(rng: Mulberry32(UInt32(seed)), deps: d, id: .portalHigh, portalId: portal.id)
            XCTAssertEqual(cards.count, 9)
            let r = cards.map { Fx.db.get($0)!.rarity }
            XCTAssertEqual(r.filter { $0 == .rare }.count, 5)
            XCTAssertEqual(r.filter { $0 == .heroic }.count, 3)
            XCTAssertEqual(r.filter { $0 == .legendary || $0 == .ultimate }.count, 1)
            ultimates += r.contains(.ultimate) ? 1 : 0
            fromPortal += cards.filter { portal.cards.contains($0) }.count
        }
        XCTAssertLessThan(abs(Double(ultimates) / Double(N) - 0.1), 0.04, "ultimates \(Double(ultimates) / Double(N))")
        let share = Double(fromPortal) / Double(N * 9)
        XCTAssertTrue(share > 0.3 && share < 0.8, "portal share \(share)")
        let low = try ShopOps.rollBoosterCards(rng: Mulberry32(5), deps: d, id: .portalLow, portalId: portal.id)
        XCTAssertEqual(low.filter { Fx.db.get($0)!.rarity == .uncommon }.count, 5)
        assertThrows(try ShopOps.rollBoosterCards(rng: Mulberry32(1), deps: d, id: .portalLow, portalId: "nope"), "Unknown portal")
        assertThrows(try ShopOps.boosterKey(.portalHigh, portalId: nil), "Unknown portal")
    }

    // MARK: the booster grid

    func testEnteringRollsASealedBoosterOnce() throws {
        let d = Fx.deps().deps
        let s0 = Fx.tutorialStart(d)
        XCTAssertNil(ShopOps.getBooster(s0, id: .neophyte, portalId: nil))
        let a = try ShopOps.openBooster(s0, deps: d, now: Fx.T0, id: .neophyte, portalId: nil)
        XCTAssertTrue(a.info.fresh)
        XCTAssertEqual(a.info.booster.cards.count, 9)
        XCTAssertEqual(a.info.booster.drawn, [])
        XCTAssertFalse(a.info.booster.opened)
        XCTAssertEqual(a.state.player.gems, s0.player.gems)
        let b = try ShopOps.openBooster(a.state, deps: d, now: Fx.T0, id: .neophyte, portalId: nil, open: true)
        XCTAssertEqual(b.info.booster.cards, a.info.booster.cards)
        XCTAssertTrue(b.info.booster.opened)
        let c = try ShopOps.openBooster(b.state, deps: d, now: Fx.T0, id: .neophyte, portalId: nil)
        XCTAssertFalse(c.info.fresh)
        XCTAssertEqual(c.info.booster, b.info.booster)
        let p = try ShopOps.openBooster(s0, deps: d, now: Fx.T0, id: .portalHigh, portalId: "dying-dreams")
        XCTAssertNotNil(p.state.boosters["portalHigh@dying-dreams"])
    }

    func testEachPickCostsATokenThenGems() throws {
        let d = Fx.deps().deps
        var s = PlayerOps.addTokens(withGems(Fx.tutorialStart(d), 2000), kind: .archmage, count: 2, portalId: nil)
        s = try ShopOps.openBooster(s, deps: d, now: Fx.T0, id: .archmage, portalId: nil, open: true).state
        let cards = ShopOps.getBooster(s, id: .archmage, portalId: nil)!.cards
        XCTAssertEqual(ShopOps.pickPayment(s, id: .archmage, portalId: nil, event: nil), PickPayment(type: .token, amount: 1, canPay: true, tokens: 2, gems: 2000))
        let r1 = try ShopOps.drawBoosterCard(s, deps: d, now: Fx.T0, id: .archmage, portalId: nil, position: 4, event: nil)
        XCTAssertEqual(r1.info.paidWith, .token)
        XCTAssertEqual(r1.info.cardId, cards[4])
        XCTAssertEqual(PlayerOps.tokenCount(r1.state, kind: .archmage, portalId: nil), 1)
        XCTAssertEqual(r1.state.cards.count, s.cards.count + 1)
        XCTAssertEqual(r1.state.cards.first { $0.uid == r1.info.uid }!.cardId, cards[4])
        XCTAssertEqual(r1.info.remaining, 8)
        assertThrows(try ShopOps.drawBoosterCard(r1.state, deps: d, now: Fx.T0, id: .archmage, portalId: nil, position: 4, event: nil), "already")
        let r2 = try ShopOps.drawBoosterCard(r1.state, deps: d, now: Fx.T0, id: .archmage, portalId: nil, position: 0, event: nil)
        XCTAssertEqual(r2.info.paidWith, .token)
        let pay = ShopOps.pickPayment(r2.state, id: .archmage, portalId: nil, event: nil)
        XCTAssertEqual([pay.type.rawValue, String(pay.amount), String(pay.canPay)], ["gems", "975", "true"])
        let r3 = try ShopOps.drawBoosterCard(r2.state, deps: d, now: Fx.T0, id: .archmage, portalId: nil, position: 8, event: .getTheBestCards)
        XCTAssertEqual([r3.info.paidWith.rawValue, String(r3.info.cost), String(r3.state.player.gems)], ["gems", "488", "\(2000 - 488)"])
        let r4 = try ShopOps.drawBoosterCard(r3.state, deps: d, now: Fx.T0, id: .archmage, portalId: nil, position: 7, event: nil)
        XCTAssertEqual(r4.state.player.gems, 2000 - 488 - 975)
        XCTAssertFalse(ShopOps.pickPayment(r4.state, id: .archmage, portalId: nil, event: nil).canPay)
        assertThrows(try ShopOps.drawBoosterCard(r4.state, deps: d, now: Fx.T0, id: .archmage, portalId: nil, position: 1, event: nil), "Not enough gems")
        assertThrows(try ShopOps.drawBoosterCard(r4.state, deps: d, now: Fx.T0, id: .archmage, portalId: nil, position: 9, event: nil), "No such card")
        assertThrows(try ShopOps.drawBoosterCard(Fx.tutorialStart(d), deps: d, now: Fx.T0, id: .archmage, portalId: nil, position: 1, event: nil), "not open")
    }

    func testPortalTokensPerPortalAndSetAdded() throws {
        let d = Fx.deps().deps
        let portal = Fx.quests.portals.first { $0.id == "dying-dreams" }!
        var s = PlayerOps.addTokens(Fx.tutorialStart(d), kind: .portalHigh, count: 9, portalId: portal.id)
        s = try ShopOps.openBooster(s, deps: d, now: Fx.T0, id: .portalHigh, portalId: portal.id, open: true).state
        XCTAssertEqual(ShopOps.pickPayment(s, id: .portalHigh, portalId: "dread-empress", event: nil).type, .gems)
        var added = 0
        for pos in 0..<9 {
            let r = try ShopOps.drawBoosterCard(s, deps: d, now: Fx.T0, id: .portalHigh, portalId: portal.id, position: pos, event: nil)
            if let sa = r.info.setAdded {
                added += 1
                if portal.cards.contains(r.info.cardId) {
                    XCTAssertEqual(sa.name, portal.name)
                    XCTAssertEqual(sa.total, 8)
                }
                XCTAssertTrue(sa.owned >= 1 && sa.owned <= sa.total)
            }
            s = r.state
        }
        XCTAssertGreaterThanOrEqual(added, 1)
        XCTAssertEqual(PlayerOps.tokenCount(s, kind: .portalHigh, portalId: portal.id), 0)
        let b = ShopOps.getBooster(s, id: .portalHigh, portalId: portal.id)!
        XCTAssertEqual(b.drawn.count, b.cards.count)
    }

    func testANewBoosterReplacesTheOldOne() throws {
        let d = Fx.deps().deps
        var s = try ShopOps.openBooster(withGems(Fx.tutorialStart(d), 500), deps: d, now: Fx.T0, id: .neophyte, portalId: nil, open: true).state
        s = try ShopOps.drawBoosterCard(s, deps: d, now: Fx.T0, id: .neophyte, portalId: nil, position: 2, event: nil).state
        let old = ShopOps.getBooster(s, id: .neophyte, portalId: nil)!
        let n = try ShopOps.discardBooster(s, deps: d, now: Fx.T0, id: .neophyte, portalId: nil)
        XCTAssertEqual(n.booster.seq, old.seq + 1)
        XCTAssertEqual(n.booster.drawn, [])
        XCTAssertFalse(n.booster.opened)
        XCTAssertNotEqual(n.booster.cards, old.cards)
        XCTAssertEqual(n.state.player.gems, s.player.gems)
        XCTAssertEqual(n.state.cards.count, s.cards.count)
    }

    func testOldSavesWithoutBoostersLoad() throws {
        let d = Fx.deps().deps
        let s = Fx.tutorialStart(d)
        guard case .object(var raw) = try JSONValue.of(s) else { return XCTFail() }
        raw["boosters"] = nil
        let migrated = Fx.migrate(.object(raw))
        XCTAssertNil(ShopOps.getBooster(migrated, id: .summoner, portalId: nil))
        let o = try ShopOps.openBooster(migrated, deps: d, now: Fx.T0, id: .summoner, portalId: nil)
        let again = Fx.roundTrip(o.state)
        XCTAssertEqual(ShopOps.getBooster(again, id: .summoner, portalId: nil), o.info.booster)
    }

    // MARK: shop offers

    func testShopOffersList() {
        let d = Fx.deps().deps
        var s = Fx.tutorialStart(d)
        let cur = ShopOps.shopOffers(s, deps: d, now: Fx.T0)
        XCTAssertEqual(cur.boosters.map { $0.id }, [.neophyte, .portalLow, .portalHigh, .portalLow, .portalHigh, .summoner, .archmage])
        let order = Fx.quests.portals.map { $0.id }
        let running = cur.boosters[1].portalId
        XCTAssertEqual(running, order[0], "a fresh save starts on the first portal of the rotation")
        XCTAssertEqual(cur.boosters[2].portalId, running)
        let next = cur.boosters[3].portalId
        XCTAssertEqual(next, order[1])
        XCTAssertEqual(cur.boosters[4].portalId, next)
        let week = Int64(Fx.quests.portalRotationDays) * 24 * 3600 * 1000
        for b in cur.boosters[1...2] { XCTAssertTrue(!b.pre && b.endsInMs == week && b.startsInMs == 0) }
        for b in cur.boosters[3...4] { XCTAssertTrue(b.pre && b.startsInMs == week && b.endsInMs == 0) }
        for b in [cur.boosters[0], cur.boosters[5], cur.boosters[6]] { XCTAssertTrue(!b.pre && b.portalId == nil && b.endsInMs == 0) }
        let portalDef = Fx.quests.portals[0]
        XCTAssertEqual(cur.boosters[1].name, ShopOps.stripTokenSuffix(portalDef.tokens!.low.name))
        XCTAssertEqual(cur.boosters[2].name, ShopOps.stripTokenSuffix(portalDef.tokens!.high.name))
        XCTAssertEqual(cur.boosters[1].setName, portalDef.name)
        XCTAssertEqual(cur.boosters[0].name, "Neophyte Pack")
        XCTAssertEqual(cur.boosters[0].left, 9)
        XCTAssertEqual(cur.gemPacks.count, 5)
        let later = ShopOps.shopOffers(s, deps: d, now: Fx.T0 + week + 1000)
        XCTAssertEqual(later.boosters[1...4].map { $0.portalId }, [next, next, order[2], order[2]])
        s = PlayerOps.addTokens(s, kind: .portalLow, count: 3, portalId: order[5])
        let more = ShopOps.shopOffers(s, deps: d, now: Fx.T0)
        XCTAssertEqual(more.boosters.filter { $0.portalId == order[5] }.count, 0)
        XCTAssertEqual(PlayerOps.tokenCount(s, kind: .portalLow, portalId: order[5]), 3)
        let back = ShopOps.shopOffers(s, deps: d, now: Fx.T0 + 5 * week + 1000)
        XCTAssertEqual(back.boosters.first { $0.id == .portalLow && !$0.pre }!.tokens, 3)
        var manual = s
        manual.quests.manualPortal = order[6]
        XCTAssertEqual(ShopOps.shopOffers(manual, deps: d, now: Fx.T0).boosters.map { $0.portalId }, cur.boosters.map { $0.portalId })
        let fixed = ShopOps.shopOffers(s, deps: d, now: Fx.T0, portal: .portal(order[3]))
        XCTAssertEqual(fixed.boosters[1...4].map { [$0.portalId!, String($0.pre), String($0.endsInMs), String($0.startsInMs)] },
                       [[order[3], "false", "0", "0"], [order[3], "false", "0", "0"], [order[4], "true", "0", "0"], [order[4], "true", "0", "0"]])
        let none = ShopOps.shopOffers(s, deps: d, now: Fx.T0, portal: .none)
        XCTAssertEqual(none.boosters.map { $0.id }, [.neophyte, .summoner, .archmage])
        // Infinite Void / Empyrean are the Dark Beyond's packs
        let tdb = ShopOps.shopOffers(PlayerOps.addTokens(s, kind: .portalHigh, count: 1, portalId: "the-dark-beyond"), deps: d, now: Fx.T0, portal: .portal("the-dark-beyond"))
        XCTAssertEqual(tdb.boosters.count, 7)
        XCTAssertEqual(tdb.boosters[2].tokens, 1)
        XCTAssertEqual(tdb.boosters[1].name, "Infinite Void")
        XCTAssertEqual(tdb.boosters[2].name, "Empyrean")
    }

    // MARK: fixture catalog

    func testDailyEventIsDeterministic() {
        var seen = Set<DailyEventId>()
        for d in 0..<60 {
            let e = ShopOps.dailyEvent(now: Fx.T0 + Int64(d) * Fx.DAY, state: nil)!
            XCTAssertEqual(e.id, ShopOps.dailyEvent(now: Fx.T0 + Int64(d) * Fx.DAY + 11 * 3600 * 1000, state: nil)!.id)
            seen.insert(e.id)
        }
        XCTAssertGreaterThanOrEqual(seen.count, 5)
        XCTAssertEqual(JSDate.utcDay(Fx.T0), "2026-10-07")
        var tut = Fx.tutorialStart()
        tut.tutorial.r3 = TutorialRecord(intro: true, lost: [], seen: [], named: false, done: false)
        XCTAssertNil(ShopOps.dailyEvent(now: Fx.T0, state: tut), "no event while the tutorial runs")
    }

    func testBoostersFixture() throws {
        let f = Fx.fresh()
        let state = Fx.richFixture(f.state)
        XCTAssertEqual(ShopOps.boosterPrice(.neophyte, event: nil), 50)
        XCTAssertEqual(ShopOps.boosterPrice(.summoner, event: nil), 350)
        XCTAssertEqual(ShopOps.boosterPrice(.portalHigh, event: nil), 1000)
        let t = try ShopOps.openBooster(PlayerOps.addTokens(state, kind: .neophyte, count: 1, portalId: nil), deps: f.deps, now: Fx.T0, id: .neophyte, portalId: nil, open: true)
        XCTAssertEqual(t.info.booster.cards.count, 9)
        let d1 = try ShopOps.drawBoosterCard(t.state, deps: f.deps, now: Fx.T0, id: .neophyte, portalId: nil, position: 3, event: nil)
        XCTAssertEqual([d1.info.paidWith.rawValue, String(d1.info.cost), String(PlayerOps.tokenCount(d1.state, kind: .neophyte, portalId: nil)), String(d1.state.player.gems)], ["token", "0", "0", "5000"])
        XCTAssertEqual(d1.state.cards.first { $0.uid == d1.info.uid }!.cardId, t.info.booster.cards[3])
        let d2 = try ShopOps.drawBoosterCard(d1.state, deps: f.deps, now: Fx.T0, id: .neophyte, portalId: nil, position: 0, event: .getTheBestCards)
        XCTAssertEqual([d2.info.paidWith.rawValue, String(d2.info.cost), String(d2.state.player.gems)], ["gems", "25", "4975"])
        let portal = try ShopOps.openBooster(state, deps: f.deps, now: Fx.T0, id: .portalHigh, portalId: "the-dark-beyond")
        XCTAssertEqual(portal.info.booster.cards.count, 9)
        let rng = Mulberry32(777)
        for _ in 0..<50 {
            var c: [Rarity: Int] = [:]
            for id in try ShopOps.rollBoosterCards(rng: rng, deps: f.deps, id: .archmage, portalId: nil) { c[f.deps.db.get(id)!.rarity, default: 0] += 1 }
            XCTAssertEqual(c, [.rare: 2, .heroic: 5, .legendary: 2])
        }
    }

    func testDailyRewardsFixture() {
        XCTAssertEqual(ShopOps.dailyRewardFor(day: 3), DailyReward(gems: 40))
        XCTAssertEqual(ShopOps.dailyRewardFor(day: 7), DailyReward(tokens: .neophyte, count: 2))
        XCTAssertEqual(ShopOps.dailyRewardFor(day: 21), DailyReward(tokens: .archmage, count: 2))
        XCTAssertEqual(ShopOps.dailyRewardFor(day: 22), ShopOps.dailyRewardFor(day: 1))
        let f = Fx.fresh()
        var r = ShopOps.claimDaily(f.state, now: Fx.T0)
        XCTAssertTrue(r.info.claimed)
        XCTAssertEqual(r.info.day, 1)
        XCTAssertEqual(r.state.player.staminaPotions, 4)
        XCTAssertFalse(ShopOps.claimDaily(r.state, now: Fx.T0 + 3600 * 1000).info.claimed)
        r = ShopOps.claimDaily(r.state, now: Fx.T0 + Fx.DAY)
        XCTAssertEqual(r.info.day, 2)
        XCTAssertEqual(r.state.player.manaPotions, 2)
        r = ShopOps.claimDaily(r.state, now: Fx.T0 + 2 * Fx.DAY)
        XCTAssertEqual(r.info.day, 3)
        XCTAssertEqual(r.state.player.gems, 40)
        r = ShopOps.claimDaily(r.state, now: Fx.T0 + 4 * Fx.DAY)
        XCTAssertEqual(r.info.day, 1)
        var s = r.state
        for d in 5...10 { r = ShopOps.claimDaily(s, now: Fx.T0 + Int64(d) * Fx.DAY); s = r.state }
        XCTAssertEqual(r.info.day, 7)
        XCTAssertEqual(PlayerOps.tokenCount(s, kind: .neophyte, portalId: nil), 2)
    }

    func testSetCollectionsFixture() throws {
        var f = Fx.fresh()
        var cols = ShopOps.setCollections(f.state, deps: f.deps)
        XCTAssertEqual(cols.count, 7, "main + 3 fixture portals + the album sets with cards in the fixture db")
        XCTAssertEqual(cols[0].id, "main")
        XCTAssertEqual(cols[0].reward, 31700)
        XCTAssertEqual(cols[0].ownedCount, 0)
        assertThrows(try ShopOps.claimCollection(f.state, deps: f.deps, setId: "the-dark-beyond"), "not complete")
        (f.state, _) = Fx.give(f.state, f.deps, "airborne-parasite")
        (f.state, _) = Fx.give(f.state, f.deps, "wilderness-shaper", stage: 2)
        cols = ShopOps.setCollections(f.state, deps: f.deps)
        XCTAssertTrue(cols.first { $0.id == "the-dark-beyond" }!.complete)
        let r = try ShopOps.claimCollection(f.state, deps: f.deps, setId: "the-dark-beyond")
        XCTAssertEqual(r.gems, 4600)
        XCTAssertEqual(r.state.player.gems, 4600)
        assertThrows(try ShopOps.claimCollection(r.state, deps: f.deps, setId: "the-dark-beyond"), "Already")
        XCTAssertTrue(ShopOps.setCollections(r.state, deps: f.deps).first { $0.id == "the-dark-beyond" }!.claimed)
    }

    func testGreatPotionDealFixture() throws {
        let f = Fx.fresh()
        let state = Fx.richFixture(f.state)
        assertThrows(try ShopOps.buyPotionDeal(state, now: Fx.T0, event: .goldenDay), "not available")
        let r = try ShopOps.buyPotionDeal(state, now: Fx.T0, event: .greatPotionDeal)
        XCTAssertEqual(r.cost, 60)
        XCTAssertEqual(r.state.player.gems, 4940)
        XCTAssertEqual(r.state.player.staminaPotions + r.state.player.manaPotions, 6)
        assertThrows(try ShopOps.buyPotionDeal(r.state, now: Fx.T0, event: .greatPotionDeal), "not available")
    }

    // MARK: §7 shop (real data)

    func testPotionDealOnceADay() throws {
        let d = Fx.deps().deps
        let s = Fx.rich(Fx.freshReal()) { $0.gems = 100 }
        XCTAssertEqual(ShopOps.potionDealGems, 60); XCTAssertEqual(ShopOps.potionDealCount, 3)
        XCTAssertFalse(ShopOps.potionDealAvailable(s, now: Fx.T0, event: .goldenDay))
        XCTAssertTrue(ShopOps.potionDealAvailable(s, now: Fx.T0, event: .greatPotionDeal))
        assertThrows(try ShopOps.buyPotionDeal(s, now: Fx.T0, event: .goldenDay), "not available")
        let r = try ShopOps.buyPotionDeal(s, now: Fx.T0, event: .greatPotionDeal)
        XCTAssertEqual(r.cost, 60)
        XCTAssertEqual(r.state.player.gems, 40)
        XCTAssertEqual(r.state.player.staminaPotions + r.state.player.manaPotions, s.player.staminaPotions + s.player.manaPotions + 3)
        XCTAssertFalse(ShopOps.potionDealAvailable(r.state, now: Fx.T0 + 60 * Fx.MIN, event: .greatPotionDeal), "once per day")
        assertThrows(try ShopOps.buyPotionDeal(r.state, now: Fx.T0 + 60 * Fx.MIN, event: .greatPotionDeal), "not available")
        XCTAssertTrue(ShopOps.potionDealAvailable(r.state, now: Fx.T0 + Fx.DAY, event: .greatPotionDeal))
        assertThrows(try ShopOps.buyPotionDeal(Fx.withPlayer(s) { $0.gems = 59 }, now: Fx.T0, event: .greatPotionDeal), "gems")
        let offers = ShopOps.shopOffers(s, deps: d, now: Fx.T0)
        XCTAssertEqual(offers.potionDeal != nil, ShopOps.dailyEvent(now: Fx.T0, state: nil)!.id == .greatPotionDeal)
    }

    func testDailyRewardsTableAndStreak() {
        let table: [DailyReward] = [
            DailyReward(stamina: 2), DailyReward(stamina: 1, mana: 1), DailyReward(gems: 40), DailyReward(stamina: 2), DailyReward(stamina: 1, mana: 1), DailyReward(gems: 80), DailyReward(tokens: .neophyte, count: 2),
            DailyReward(stamina: 3), DailyReward(stamina: 2, mana: 1), DailyReward(gems: 120), DailyReward(stamina: 3), DailyReward(stamina: 2, mana: 1), DailyReward(gems: 160), DailyReward(tokens: .summoner, count: 2),
            DailyReward(stamina: 4), DailyReward(stamina: 2, mana: 2), DailyReward(gems: 200), DailyReward(stamina: 4), DailyReward(stamina: 2, mana: 2), DailyReward(gems: 240), DailyReward(tokens: .archmage, count: 2),
        ]
        XCTAssertEqual(ShopOps.dailyRewards, table)
        for (i, r) in table.enumerated() { XCTAssertEqual(ShopOps.dailyRewardFor(day: i + 1), r) }
        XCTAssertEqual(ShopOps.dailyRewardFor(day: 22), table[0])
        XCTAssertEqual(ShopOps.dailyRewardFor(day: 42), table[20])
        let s0 = Fx.withPlayer(Fx.freshReal()) { $0.staminaPotions = 0; $0.manaPotions = 0; $0.gems = 0 }
        let d1 = ShopOps.claimDaily(s0, now: Fx.T0)
        XCTAssertTrue(d1.info.claimed); XCTAssertEqual(d1.info.day, 1)
        XCTAssertEqual(d1.info.reward, DailyReward(day: 1, stamina: 2))
        XCTAssertEqual(d1.state.player.staminaPotions, 2)
        XCTAssertEqual(d1.state.daily.streak, 1); XCTAssertEqual(d1.state.daily.lastClaim, "2026-10-07")
        let same = ShopOps.claimDaily(d1.state, now: Fx.T0 + 5 * 60 * Fx.MIN)
        XCTAssertFalse(same.info.claimed); XCTAssertEqual(same.state, d1.state)
        let d2 = ShopOps.claimDaily(d1.state, now: Fx.T0 + Fx.DAY)
        XCTAssertEqual(d2.info.day, 2)
        XCTAssertEqual(d2.state.player.staminaPotions, 3); XCTAssertEqual(d2.state.player.manaPotions, 1)
        let d3 = ShopOps.claimDaily(d2.state, now: Fx.T0 + 2 * Fx.DAY)
        XCTAssertEqual(d3.info.day, 3); XCTAssertEqual(d3.state.player.gems, 40)
        let missed = ShopOps.claimDaily(d3.state, now: Fx.T0 + 4 * Fx.DAY)
        XCTAssertEqual(missed.info.day, 1, "a missed day resets the streak")
        XCTAssertEqual(missed.state.player.staminaPotions, 5)
        var s = s0
        for i in 0..<22 {
            let r = ShopOps.claimDaily(s, now: Fx.T0 + Int64(i) * Fx.DAY)
            XCTAssertEqual(r.info.day, i + 1)
            s = r.state
        }
        XCTAssertEqual(PlayerOps.tokenCount(s, kind: .neophyte, portalId: nil), 2)
        XCTAssertEqual(PlayerOps.tokenCount(s, kind: .summoner, portalId: nil), 2)
        XCTAssertEqual(PlayerOps.tokenCount(s, kind: .archmage, portalId: nil), 2)
        XCTAssertEqual(s.player.gems, 40 + 80 + 120 + 160 + 200 + 240)
        XCTAssertEqual(s.player.staminaPotions, 2 + 1 + 2 + 1 + 3 + 2 + 3 + 2 + 4 + 2 + 4 + 2 + 2)
        XCTAssertEqual(s.player.manaPotions, 1 + 1 + 1 + 1 + 2 + 2)
        XCTAssertEqual(s.daily.streak, 22)
    }

    func testDailyEventsOverAYear() {
        XCTAssertEqual(ShopOps.events.map { $0.id }, [.infiniteWisdom, .drinkingContest, .cardPieceDay, .doubleLeaguePoints, .greatPotionDeal, .getTheBestCards, .goldenDay])
        var seen = Set<DailyEventId>()
        for day in 0..<365 {
            let t = Fx.T0 + Int64(day) * Fx.DAY
            let e = ShopOps.dailyEvent(now: t, state: nil)!
            XCTAssertEqual(ShopOps.dailyEvent(now: JSDate.utcDayStart(t), state: nil)!.id, e.id, "same event all day")
            XCTAssertEqual(ShopOps.dailyEvent(now: JSDate.utcDayStart(t) + Fx.DAY - 1, state: nil)!.id, e.id)
            seen.insert(e.id)
        }
        XCTAssertEqual(seen.count, 7)
    }

    func testSetCollectionsOnRealData() throws {
        let d = Fx.deps().deps
        var s = Fx.freshReal()
        let cols = ShopOps.setCollections(s, deps: d)
        XCTAssertEqual(cols.count, 13, "main, 8 portals, 4 main-line album sets")
        XCTAssertEqual(cols[9...].map { [$0.id, String($0.total), String($0.reward)] }, [["dwarven-apprentice", "8", "50"], ["elven-novice", "8", "50"], ["orc-grunt", "8", "50"], ["arborearch", "7", "3500"]])
        XCTAssertEqual(cols[0].id, "main"); XCTAssertEqual(cols[0].total, 17); XCTAssertEqual(cols[0].reward, 31700)
        XCTAssertFalse(cols[0].complete); XCTAssertFalse(cols[0].claimed)
        let tdb = cols.first { $0.id == "the-dark-beyond" }!
        XCTAssertEqual(tdb.total, 8); XCTAssertEqual(tdb.reward, 4600)
        assertThrows(try ShopOps.claimCollection(s, deps: d, setId: "the-dark-beyond"), "not complete")
        assertThrows(try ShopOps.claimCollection(s, deps: d, setId: "nope"), "Unknown")
        for (i, id) in Fx.portal(0).cards.enumerated() { s = Fx.give(s, d, id, stage: i % 5, level: 1).0 }
        let now = ShopOps.setCollections(s, deps: d).first { $0.id == "the-dark-beyond" }!
        XCTAssertEqual(now.ownedCount, 8); XCTAssertTrue(now.complete)
        let r = try ShopOps.claimCollection(s, deps: d, setId: "the-dark-beyond")
        XCTAssertEqual(r.gems, 4600)
        XCTAssertEqual(r.state.player.gems, s.player.gems + 4600)
        XCTAssertEqual(r.state.collections.claimed, ["the-dark-beyond"])
        XCTAssertTrue(ShopOps.setCollections(r.state, deps: d).first { $0.id == "the-dark-beyond" }!.claimed)
        assertThrows(try ShopOps.claimCollection(r.state, deps: d, setId: "the-dark-beyond"), "Already")
        var m = r.state
        for id in Fx.quests.main.cards { m = Fx.give(m, d, id, stage: 2).0 }
        XCTAssertEqual(try ShopOps.claimCollection(m, deps: d, setId: "main").gems, 31700)
        for p in Fx.quests.portals { XCTAssertEqual(ShopOps.setCollections(m, deps: d).first { $0.id == p.id }!.reward, p.gemReward) }
        // the album badge: owned set cards not seen yet (the starter cards belong to the main-line album sets)
        let fresh = Set(ShopOps.albumNewCards(s, deps: d))
        XCTAssertTrue(Set(Fx.portal(0).cards).isSubset(of: fresh))
        XCTAssertTrue(fresh.contains("envoy"), "the Envoy is an Elven Novice set card")
        XCTAssertEqual(fresh.count, Set(ShopOps.setCollections(s, deps: d).flatMap { $0.cards.filter { $0.owned }.map { $0.cardId } }).count)
        let seen = ShopOps.markAlbumSeen(s, cardIds: Array(Fx.portal(0).cards.prefix(3)))
        XCTAssertEqual(Set(ShopOps.albumNewCards(seen, deps: d)), fresh.subtracting(Fx.portal(0).cards.prefix(3)))
        XCTAssertEqual(ShopOps.markAlbumSeen(seen, cardIds: Array(Fx.portal(0).cards.prefix(3))), seen, "nothing new: the same state")
        var noList = s
        noList.collections.seen = nil
        XCTAssertEqual(ShopOps.albumNewCards(noList, deps: d), [])
        XCTAssertEqual(ShopOps.setProgressFor(s, deps: d, cardId: Fx.portal(0).cards[0])?.name, Fx.portal(0).name)
    }

    func testGemsAndTokens() {
        XCTAssertEqual(PlayerOps.levelUpRewards(level: 2).gems, 5)
        XCTAssertEqual(PlayerOps.levelUpRewards(level: 12).gems, 50)
        let s = Fx.freshReal()
        XCTAssertEqual(s.player.gems, 0)
        let t = PlayerOps.addTokens(PlayerOps.addTokens(s, kind: .portalLow, count: 2, portalId: "dragon-hunt"), kind: .portalLow, count: 1, portalId: "dying-dreams")
        XCTAssertEqual(PlayerOps.tokenCount(t, kind: .portalLow, portalId: "dragon-hunt"), 2)
        XCTAssertEqual(PlayerOps.tokenCount(t, kind: .portalLow, portalId: "dying-dreams"), 1)
        XCTAssertEqual(PlayerOps.tokenCount(t, kind: .portalLow, portalId: "desert-twilight"), 0)
        XCTAssertEqual(PlayerOps.addGold(s, amount: -1_000_000_000).player.gold, 0, "gold never negative")
        assertThrows(try PlayerOps.spendGold(s, amount: 301), "gold")
        assertThrows(try PlayerOps.spendGems(s, amount: 1), "gems")
    }

    // MARK: the daily event on the save clock

    func testEventClockFollowsDayShift() {
        let s = StateOps.newGame(name: "T", seed: 1, now: Fx.T0, deps: nil)
        XCTAssertEqual(PlayerOps.eventClock(s, now: Fx.T0), Fx.T0)
        XCTAssertEqual(PlayerOps.eventClock(nil, now: Fx.T0), Fx.T0)
        var shifted = s
        shifted.daily.dayShift = 3
        XCTAssertEqual(PlayerOps.eventClock(shifted, now: Fx.T0), Fx.T0 + 3 * Fx.DAY)
        var zero = s
        zero.daily.dayShift = 0
        XCTAssertEqual(StoreHelpers.shiftClocks(zero, deltaMs: -Fx.DAY).daily.dayShift, 0, "shiftClocks keeps the field")
        var seen = Set<DailyEventId>()
        for d in 0..<14 {
            var x = s
            x.daily.dayShift = d
            seen.insert(ShopOps.dailyEvent(now: PlayerOps.eventClock(x, now: Fx.T0), state: x)!.id)
        }
        XCTAssertGreaterThanOrEqual(seen.count, 3)
    }
}
