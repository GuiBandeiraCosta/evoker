import Foundation
import XCTest
@testable import EvokerCore

/// Port of `tests/game-state.test.js`: the save (new game, migration, deck slots, rng), the player (regen,
/// level-ups, stat points, potions, fight xp), persistence. The "fixture catalog" tests run on the 21-card fixture
/// catalog with the stub stats / engine; the "§" tests verify game-design.md against the real data.
final class GameStateTests: XCTestCase {
    // MARK: state and player (fixture catalog)

    func testNewGameStarterCollection() {
        let d = Fx.makeDeps().deps
        let state = StateOps.newGame(name: "Tester", seed: 4242, now: Fx.T0, deps: d)
        XCTAssertEqual(state.cards.map { $0.cardId }, ["envoy", "master-brewer"])
        XCTAssertEqual(state.deck[2], state.cards[0].uid)
        XCTAssertEqual(state.deck.compactMap { $0 }.count, 1)
        XCTAssertEqual(StateOps.deckSlotCount(state), 2)
        XCTAssertEqual(Fx.openSlots(state), [1, 2])
        XCTAssertEqual(state.player.name, "Tester")
        XCTAssertEqual(state.player.gold, 200)
        XCTAssertEqual(state.player.gems, 0)
        XCTAssertEqual(state.player.staminaPotions, 0)
        XCTAssertEqual(state.player.manaPotions, 0)
        XCTAssertEqual(state.player.hpMax, 1500)
        XCTAssertEqual(state.quests.main.unlocked, 1)
        XCTAssertEqual(state.createdAt, Fx.T0)
        XCTAssertEqual(state.daily.lastClaim, "2026-10-07", "the first day is claimed with streak 0")
        XCTAssertEqual(state.daily.streak, 0)
        XCTAssertNil(state.tutorial.r3)
    }

    func testMigrateFillsDefaultsAndKeepsUidsAboveTheCounter() {
        let raw: JSONValue = .object(["seed": .number(7), "cards": .array([.object(["uid": .string("c9"), "cardId": .string("envoy")])]),
                                      "player": .object(["name": .string("Old"), "gold": .number(12)])])
        let s = Fx.migrate(raw)
        XCTAssertEqual(s.version, 1)
        XCTAssertEqual(s.player.name, "Old")
        XCTAssertEqual(s.player.gold, 12)
        XCTAssertEqual(s.player.staminaMax, 50)
        XCTAssertEqual(s.cards[0].evolveQuality, 1)
        XCTAssertEqual(s.uidCounter, 9)
        XCTAssertEqual(s.deck, [nil, nil, nil, nil, nil])
        XCTAssertEqual(s.sim.leagueScore, 0)
        XCTAssertEqual(s.createdAt, Fx.T0, "a missing clock takes `now`")
        XCTAssertEqual(s.player.regenAt, Fx.T0)
        XCTAssertEqual(s.collections.seen, ["envoy"])
        XCTAssertNil(s.sim.leagueJoined)
        XCTAssertNil(s.sim.leagueTier)
    }

    func testDeckSlotsOpenByQuestAndFeaturesByLevel() {
        let state = StateOps.newGame(name: "Tester", seed: 4242, now: Fx.T0, deps: Fx.makeDeps().deps)
        XCTAssertTrue(StateOps.slotUnlocked(state, slot: 2))
        XCTAssertFalse(StateOps.slotUnlocked(state, slot: 3))
        let q2 = Fx.withMain(state, unlocked: 3, done: 2, firstWins: [1, 2])
        XCTAssertEqual(Fx.openSlots(q2), [1, 2, 3])
        let q6 = Fx.withMain(state, unlocked: 7, done: 6, firstWins: [1, 2, 3, 4, 5, 6])
        XCTAssertEqual(Fx.openSlots(q6), [1, 2, 3, 4])
        let q7 = Fx.withMain(state, unlocked: 8, done: 7, firstWins: [1, 2, 3, 4, 5, 6, 7])
        XCTAssertEqual(Fx.openSlots(q7), [0, 1, 2, 3, 4])
        XCTAssertTrue(StateOps.isCardSlotUnlocked(q2, slotNumber: 4))
        XCTAssertFalse(StateOps.isCardSlotUnlocked(q2, slotNumber: 1))
        XCTAssertEqual(Fx.openSlots(Fx.migrate(.object(["seed": .number(1), "player": .object(["level": .number(1)])]))), [1, 2, 3], "an old level-1 save keeps the legacy table")
        let at: (Int) -> GameState = { level in Fx.withPlayer(state) { $0.level = level } }
        XCTAssertTrue(StateOps.isUnlocked(state, .quests))
        XCTAssertFalse(StateOps.isUnlocked(state, .fusion))
        XCTAssertTrue(StateOps.isUnlocked(at(2), Feature(alias: "evolve")!))
        XCTAssertFalse(StateOps.isUnlocked(at(3), .arena))
        XCTAssertTrue(StateOps.isUnlocked(at(4), Feature(alias: "pvp")!))
        XCTAssertTrue(StateOps.isUnlocked(at(4), .pieces))
        XCTAssertFalse(StateOps.isUnlocked(at(4), .training))
        XCTAssertTrue(StateOps.isUnlocked(at(5), Feature(alias: "enhance")!))
        XCTAssertFalse(StateOps.isUnlocked(at(5), .league))
        XCTAssertTrue(StateOps.isUnlocked(at(6), Feature(alias: "leagues")!))
        XCTAssertNil(Feature(alias: "nonsense"))
    }

    func testTakeRngIsReproducibleAndAdvancesTheCounter() {
        let f = Fx.fresh()
        let a = StateOps.takeRng(f.state, deps: f.deps)
        let b = StateOps.takeRng(f.state, deps: f.deps)
        XCTAssertEqual(a.rng.next(), b.rng.next())
        XCTAssertEqual(a.state.rngStep, 1)
        let c = StateOps.takeRng(a.state, deps: f.deps)
        XCTAssertNotEqual(c.seed, a.seed)
    }

    func testRegenOneStaminaAndManaPerMinute() {
        let f = Fx.fresh()
        let low = Fx.withPlayer(f.state) { $0.stamina = 10; $0.mana = 45; $0.regenAt = Fx.T0 }
        let s1 = PlayerOps.applyRegen(low, now: Fx.T0 + 5 * Fx.MIN + 30 * 1000)
        XCTAssertEqual(s1.player.stamina, 15)
        XCTAssertEqual(s1.player.mana, 50)
        XCTAssertEqual(s1.player.regenAt, Fx.T0 + 5 * Fx.MIN)
        let s2 = PlayerOps.applyRegen(s1, now: Fx.T0 + 2 * 60 * Fx.MIN)
        XCTAssertEqual(s2.player.stamina, 50)
        XCTAssertEqual(PlayerOps.applyRegen(low, now: Fx.T0 + 1000).player.stamina, 10)
    }

    func testLevelUpGrantsPointsRefillsBarsAndRewards() {
        let f = Fx.fresh()
        let tired = Fx.withPlayer(f.state) { $0.stamina = 1; $0.mana = 2; $0.gold = 0; $0.gems = 0 }
        let r = PlayerOps.addPlayerXp(tired, deps: f.deps, amount: f.deps.stats.playerXpToNext(level: 1)!)
        XCTAssertEqual(r.info.levelUps, [2])
        XCTAssertEqual(r.state.player.level, 2)
        XCTAssertEqual(r.state.player.statPoints, 12)
        XCTAssertEqual(r.state.player.stamina, 50)
        XCTAssertEqual(r.state.player.mana, 50)
        XCTAssertEqual(r.info.gems, 5)
        XCTAssertEqual(r.info.gold, 100)
        XCTAssertEqual(r.info.levelUpDetails, [LevelUpDetail(level: 2, rewards: PlayerOps.levelUpRewards(level: 2), statPoints: 12, unlocked: [.fusion])])
        XCTAssertEqual([r.state.player.gold, r.state.player.gems], [100, 5])
        var xp = 0
        for l in 1..<7 { xp += f.deps.stats.playerXpToNext(level: l)! }
        let r2 = PlayerOps.addPlayerXp(tired, deps: f.deps, amount: xp)
        XCTAssertEqual(r2.state.player.level, 7)
        XCTAssertEqual(r2.info.levelUps, [2, 3, 4, 5, 6, 7])
        XCTAssertEqual(r2.info.gold, 100 + 150 + 150 + 250 + 300 + 350)
        XCTAssertEqual(r2.info.gems, 55)
        XCTAssertEqual(r2.state.player.staminaPotions, 2 + 2)
        XCTAssertEqual(r2.state.player.manaPotions, 1 + 1)
        XCTAssertEqual(r2.state.player.tokens.neophyte, 1)
        XCTAssertEqual(r2.state.player.statPoints, 72)
        XCTAssertEqual(r2.info.levelUpDetails.map { $0.unlocked }, [[.fusion], [], [.arena], [.training], [.league], []])
    }

    func testStatPointsOneEach() throws {
        let f = Fx.fresh()
        let s = Fx.withPlayer(f.state) { $0.statPoints = 12 }
        let r = try PlayerOps.spendStatPoints(s, alloc: StatAlloc(stamina: 4, mana: 3, hp: 5))
        XCTAssertEqual(r.player.staminaMax, 54)
        XCTAssertEqual(r.player.manaMax, 53)
        XCTAssertEqual(r.player.hpMax, 1650)
        XCTAssertEqual(r.player.statPoints, 0)
        assertThrows(try PlayerOps.spendStatPoints(s, alloc: StatAlloc(hp: 13)), "stat points")
    }

    func testPotionDialogDecision() throws {
        let f = Fx.fresh()
        let low = Fx.withPlayer(f.state) { $0.stamina = 2; $0.gems = 50 }
        let d = PlayerOps.needsPotion(low, kind: .stamina, amount: 3, event: nil)
        XCTAssertTrue(d.needed)
        XCTAssertTrue(d.hasPotion)
        XCTAssertEqual(d.price, 40)
        XCTAssertTrue(d.canBuy)
        XCTAssertFalse(PlayerOps.needsPotion(low, kind: .stamina, amount: 2, event: nil).needed)
        let drunk = try PlayerOps.drinkPotion(low, kind: .stamina)
        XCTAssertEqual(drunk.player.stamina, 50)
        XCTAssertEqual(drunk.player.staminaPotions, 1)
        let bought = try PlayerOps.buyAndDrinkPotion(low, kind: .mana, event: .drinkingContest)
        XCTAssertEqual(bought.player.gems, 30)
        XCTAssertEqual(bought.player.mana, 50)
        XCTAssertEqual(PlayerOps.needsPotion(low, kind: .mana, amount: 99, event: .drinkingContest).price, 20)
        assertThrows(try PlayerOps.buyAndDrinkPotion(Fx.withPlayer(low) { $0.gems = 5 }, kind: .stamina, event: nil), "gems")
    }

    func testFightXpFormulas() {
        XCTAssertEqual(PlayerOps.playerFightXp(opponentLevel: 8, won: true), 22)
        XCTAssertEqual(PlayerOps.playerFightXp(opponentLevel: 8, won: false), 6)
        XCTAssertEqual(PlayerOps.playerFightXp(opponentLevel: 10, won: true), 26)
        XCTAssertEqual(PlayerOps.cardFightXp(enemyDeckMana: 20, won: false, infiniteWisdom: false), 20)
        XCTAssertEqual(PlayerOps.cardFightXp(enemyDeckMana: 20, won: true, infiniteWisdom: false), 30)
        XCTAssertEqual(PlayerOps.cardFightXp(enemyDeckMana: 20, won: true, infiniteWisdom: true), 60)
    }

    // MARK: §3 character (real data)

    func testStartValues() {
        let s = Fx.freshReal()
        XCTAssertEqual(s.player.level, 1)
        XCTAssertEqual(s.player.stamina, 50); XCTAssertEqual(s.player.staminaMax, 50)
        XCTAssertEqual(s.player.mana, 50); XCTAssertEqual(s.player.manaMax, 50)
        XCTAssertEqual(s.player.hpMax, 1500)
        XCTAssertEqual(s.player.xp, 0)
        XCTAssertEqual(s.player.statPoints, 0)
        XCTAssertEqual(PlayerOps.maxLevel, 200)
    }

    func testPvpPlayerXpPerFight() {
        XCTAssertEqual(PlayerOps.playerFightXp(opponentLevel: 8, won: true), 22)
        XCTAssertEqual(PlayerOps.playerFightXp(opponentLevel: 8, won: false), 6)
        XCTAssertEqual(PlayerOps.playerFightXp(opponentLevel: 0, won: true), 6)
        var l = 0
        while l <= 200 {
            XCTAssertEqual(PlayerOps.playerFightXp(opponentLevel: l, won: false), JSMath.roundInt(1.5 + 0.5 * Double(l)))
            XCTAssertEqual(PlayerOps.playerFightXp(opponentLevel: l, won: true), JSMath.roundInt((1.5 + 0.5 * Double(l)) * 4))
            l += 7
        }
        XCTAssertEqual(PlayerOps.questBossPlayerXp, 0)
    }

    func testPlayerXpCurve() {
        let stats = Stats()
        for l in 5..<200 { XCTAssertEqual(stats.playerXpToNext(level: l), JSMath.roundInt(50 * pow(Double(l), 0.875)), "level \(l)") }
        XCTAssertEqual([1, 2, 3, 4].map { stats.playerXpToNext(level: $0) }, [47, 47, 92, 94])
        XCTAssertEqual(stats.playerXpToNext(level: 6), 240)
        XCTAssertEqual(stats.playerXpToNext(level: 7), 274)
        XCTAssertNil(stats.playerXpToNext(level: 200))
    }

    func testLevelUpMultipleInOneGrant() {
        let d = Fx.deps().deps
        let stats = d.stats
        let s0 = Fx.withPlayer(Fx.freshReal()) { $0.stamina = 3; $0.mana = 4; $0.gold = 0; $0.gems = 0; $0.staminaPotions = 0; $0.manaPotions = 0 }
        let r1 = PlayerOps.addPlayerXp(s0, deps: d, amount: stats.playerXpToNext(level: 1)!)
        XCTAssertEqual(r1.state.player.level, 2)
        XCTAssertEqual(r1.state.player.xp, 0)
        XCTAssertEqual(r1.state.player.statPoints, 12)
        XCTAssertEqual(r1.state.player.stamina, 50)
        XCTAssertEqual(r1.state.player.mana, 50)
        XCTAssertEqual(r1.info.levelUps, [2])
        XCTAssertEqual([r1.info.gold, r1.info.gems, r1.state.player.gold, r1.state.player.gems], [100, 5, 100, 5])
        let need15 = [1, 2, 3, 4].reduce(0) { $0 + stats.playerXpToNext(level: $1)! }
        XCTAssertEqual(need15, 47 + 47 + 92 + 94)
        let r5 = PlayerOps.addPlayerXp(s0, deps: d, amount: need15 + 7)
        XCTAssertEqual(r5.state.player.level, 5)
        XCTAssertEqual(r5.state.player.xp, 7)
        XCTAssertEqual(r5.state.player.statPoints, 48)
        XCTAssertEqual(r5.info.levelUps, [2, 3, 4, 5])
        XCTAssertEqual(r5.info.gold, 100 + 150 + 150 + 250)
        XCTAssertEqual(r5.info.gems, 5)
        XCTAssertEqual([r5.state.player.staminaPotions, r5.state.player.manaPotions], [2, 1])
        XCTAssertEqual(r5.info.levelUpDetails.map { [$0.level, $0.statPoints] }, [[2, 12], [3, 12], [4, 12], [5, 12]])
        XCTAssertEqual(r5.info.levelUpDetails.map { $0.unlocked }, [[.fusion], [], [.arena], [.training]])
        XCTAssertEqual(PlayerOps.levelUpRewards(level: 6), LevelUpRewards(level: 6, gold: 300, gems: 0, potions: [], tokens: [.neophyte]))
        XCTAssertEqual(PlayerOps.levelUpRewards(level: 7), LevelUpRewards(level: 7, gold: 350, gems: 50, potions: [], tokens: []))
        XCTAssertEqual(PlayerOps.levelUpRewards(level: 1), LevelUpRewards(level: 1, gold: 0, gems: 0, potions: [], tokens: []))
        for l in 2...200 {
            let r = PlayerOps.levelUpRewards(level: l)
            XCTAssertEqual(r.gold, l == 4 ? 150 : 50 * l)
            XCTAssertEqual((r.gems > 0 ? 1 : 0) + r.potions.count + r.tokens.count, 1, "one extra per level \(l)")
        }
        let s199 = Fx.withPlayer(s0) { $0.level = 199 }
        let r200 = PlayerOps.addPlayerXp(s199, deps: d, amount: 1_000_000_000)
        XCTAssertEqual(r200.state.player.level, 200)
        XCTAssertEqual(r200.state.player.xp, 0)
        XCTAssertEqual(PlayerOps.addPlayerXp(r200.state, deps: d, amount: 500).info.xp, 0)
        XCTAssertEqual(PlayerOps.addPlayerXp(r200.state, deps: d, amount: 500).state.player.level, 200)
    }

    func testStatPointsPreviewForTheDialog() throws {
        let s = Fx.withPlayer(Fx.freshReal()) { $0.statPoints = 12 }
        XCTAssertEqual(PlayerOps.previewStatPoints(s, alloc: StatAlloc(stamina: 1, mana: 1, hp: 10)), StatPointsPreview(ok: true, spent: 12, pointsLeft: 0, hpMax: 1800, staminaMax: 51, manaMax: 51))
        XCTAssertFalse(PlayerOps.previewStatPoints(s, alloc: StatAlloc(hp: 13)).ok)
        let r = try PlayerOps.spendStatPoints(s, alloc: StatAlloc(stamina: 1, mana: 1, hp: 10))
        XCTAssertEqual(r.player.statPoints, 0)
        XCTAssertEqual(r.player.staminaMax, 51); XCTAssertEqual(r.player.stamina, 51)
        XCTAssertEqual(r.player.manaMax, 51); XCTAssertEqual(r.player.mana, 51)
        XCTAssertEqual(r.player.hpMax, 1500 + 300)
        XCTAssertEqual(PlayerOps.hpPerPoint, 30)
        XCTAssertEqual(PlayerOps.statPointsPerLevel, 12)
        assertThrows(try PlayerOps.spendStatPoints(s, alloc: StatAlloc(hp: 13)), "stat points")
        XCTAssertEqual(try PlayerOps.spendStatPoints(s, alloc: StatAlloc()), s)
    }

    func testRegenerationWholeMinutes() {
        let s = Fx.withPlayer(Fx.freshReal()) { $0.stamina = 10; $0.mana = 45; $0.regenAt = Fx.T0 }
        XCTAssertEqual(PlayerOps.applyRegen(s, now: Fx.T0 + 59 * 1000), s)
        let r1 = PlayerOps.applyRegen(s, now: Fx.T0 + 90 * 1000)
        XCTAssertEqual(r1.player.stamina, 11)
        XCTAssertEqual(r1.player.mana, 46)
        XCTAssertEqual(r1.player.regenAt, Fx.T0 + Fx.MIN, "only whole minutes are consumed")
        let r7 = PlayerOps.applyRegen(s, now: Fx.T0 + 7 * Fx.MIN)
        XCTAssertEqual(r7.player.stamina, 17)
        XCTAssertEqual(r7.player.mana, 50, "capped at max")
        let rLong = PlayerOps.applyRegen(s, now: Fx.T0 + 2 * Fx.DAY)
        XCTAssertEqual(rLong.player.stamina, 50)
        XCTAssertEqual(rLong.player.mana, 50)
        XCTAssertEqual(rLong.player.regenAt, Fx.T0 + 2 * Fx.DAY)
    }

    func testPotionsRefillAndPrices() throws {
        XCTAssertEqual(PlayerOps.potionPrice(event: nil), 40)
        XCTAssertEqual(PlayerOps.potionPrice(event: .drinkingContest), 20)
        XCTAssertEqual(PlayerOps.potionPrice(event: .goldenDay), 40)
        let s = Fx.withPlayer(Fx.freshReal()) { $0.stamina = 2; $0.mana = 1; $0.gems = 45; $0.staminaMax = 70; $0.manaMax = 60 }
        let np = PlayerOps.needsPotion(s, kind: .stamina, amount: 3, event: nil)
        XCTAssertTrue(np.needed); XCTAssertEqual(np.missing, 1); XCTAssertEqual(np.price, 40)
        XCTAssertTrue(np.hasPotion); XCTAssertEqual(np.potions, 2); XCTAssertTrue(np.canBuy)
        XCTAssertFalse(PlayerOps.needsPotion(s, kind: .stamina, amount: 2, event: nil).needed)
        let drank = try PlayerOps.drinkPotion(s, kind: .stamina)
        XCTAssertEqual(drank.player.stamina, 70)
        XCTAssertEqual(drank.player.staminaPotions, 1)
        let drankM = try PlayerOps.drinkPotion(s, kind: .mana)
        XCTAssertEqual(drankM.player.mana, 60)
        XCTAssertEqual(drankM.player.manaPotions, 0)
        assertThrows(try PlayerOps.drinkPotion(drankM, kind: .mana), "No mana potion")
        let bought = try PlayerOps.buyAndDrinkPotion(s, kind: .mana, event: nil)
        XCTAssertEqual(bought.player.gems, 5)
        XCTAssertEqual(bought.player.mana, 60)
        XCTAssertEqual(bought.player.manaPotions, 1, "a bought potion is consumed immediately")
        let boughtEvent = try PlayerOps.buyAndDrinkPotion(s, kind: .stamina, event: .drinkingContest)
        XCTAssertEqual(boughtEvent.player.gems, 25)
        assertThrows(try PlayerOps.buyAndDrinkPotion(Fx.withPlayer(s) { $0.gems = 39 }, kind: .mana, event: nil), "gems")
    }

    func testLegacyDeckSlotTableOnlySizesOldSaves() {
        let atLevel: (Int) -> [Int] = { level in Fx.openSlots(Fx.migrate(.object(["seed": .number(1), "player": .object(["level": .number(Double(level))])]))) }
        XCTAssertEqual(atLevel(1), [1, 2, 3])
        XCTAssertEqual(atLevel(2), [1, 2, 3])
        XCTAssertEqual(atLevel(3), [1, 2, 3, 4])
        XCTAssertEqual(atLevel(4), [1, 2, 3, 4])
        XCTAssertEqual(atLevel(5), [0, 1, 2, 3, 4])
        let s = Fx.freshReal()
        let d = Fx.deps().deps
        assertThrows(try CollectionOps.placeInDeck(s, deps: d, uid: s.cards[0].uid, slot: 0), "locked")
        assertThrows(try CollectionOps.placeInDeck(s, deps: d, uid: s.cards[0].uid, slot: 4), "locked")
    }

    func testFeatureUnlockLevels() {
        XCTAssertEqual(Constants.featureUnlockLevels, [.quests: 1, .cards: 1, .shop: 1, .fusion: 2, .arena: 4, .pieces: 4, .replays: 4, .training: 5, .league: 6])
        let at: (Int) -> GameState = { level in Fx.withPlayer(Fx.freshReal()) { $0.level = level } }
        for f in [Feature.quests, .cards, .shop] { XCTAssertTrue(StateOps.isUnlocked(at(1), f)) }
        for (alias, lvl) in [("fusion", 2), ("evolve", 2), ("arena", 4), ("pvp", 4), ("pieces", 4), ("training", 5), ("enhance", 5), ("league", 6), ("leagues", 6)] {
            let f = Feature(alias: alias)!
            XCTAssertFalse(StateOps.isUnlocked(at(lvl - 1), f), alias)
            XCTAssertTrue(StateOps.isUnlocked(at(lvl), f), alias)
        }
        XCTAssertEqual([2, 3, 4, 5, 6, 7].map { StateOps.featuresUnlockedAt(level: $0, state: nil) }, [[.fusion], [], [.arena], [.training], [.league], []])
        // a save with a tutorial record opens its features by quest wins
        var tut = at(10)
        tut.tutorial.r3 = TutorialRecord.newGame
        XCTAssertFalse(StateOps.isUnlocked(tut, .arena))
        tut.quests.main.firstWins = [1, 2, 3, 4, 5, 6, 7, 8]
        XCTAssertTrue(StateOps.isUnlocked(tut, .arena))
        XCTAssertFalse(StateOps.isUnlocked(tut, .league))
        XCTAssertEqual(StateOps.featuresUnlockedAt(level: 2, state: tut), [])
        XCTAssertTrue(StateOps.unlocksByQuest(tut))
        XCTAssertFalse(StateOps.inTutorial(tut), "newGame's record is done")
    }

    func testDeckSlotsByQuestProgress() throws {
        let d = Fx.deps().deps
        let s = Fx.tutorialStart(d)
        XCTAssertEqual(StateOps.deckSlotCount(s), 2)
        XCTAssertEqual(Fx.openSlots(s), [1, 2])
        assertThrows(try CollectionOps.placeInDeck(s, deps: d, uid: s.cards[1].uid, slot: 3), "locked")
        XCTAssertEqual(try CollectionOps.placeInDeck(s, deps: d, uid: s.cards[1].uid, slot: 1).state.deck[1], s.cards[1].uid)
        let u2 = StateOps.unlockSlotsForQuest(s, lineId: "main", n: 2)
        XCTAssertEqual(u2.slots, 3)
        XCTAssertEqual(Fx.openSlots(u2.state), [1, 2, 3])
        XCTAssertNil(StateOps.unlockSlotsForQuest(u2.state, lineId: "main", n: 2).slots, "only once")
        XCTAssertNil(StateOps.unlockSlotsForQuest(u2.state, lineId: "main", n: 3).slots)
        XCTAssertNil(StateOps.unlockSlotsForQuest(u2.state, lineId: "dragon-hunt", n: 4).slots)
        let u4 = StateOps.unlockSlotsForQuest(u2.state, lineId: "main", n: 4)
        XCTAssertEqual(Fx.openSlots(u4.state), [1, 2, 3, 4])
        XCTAssertNil(StateOps.unlockSlotsForQuest(u4.state, lineId: "main", n: 6).slots)
        XCTAssertEqual(Fx.openSlots(StateOps.unlockSlotsForQuest(u4.state, lineId: "main", n: 7).state), [0, 1, 2, 3, 4])
        // a pre-round-3 save keeps every slot it had (level table) and every slot that holds a card
        let old = Fx.migrate(.object(["seed": .number(1), "player": .object(["level": .number(3)]), "deck": .array([.null, .string("c1"), .null, .null, .string("c2")]),
                                       "cards": .array([.object(["uid": .string("c1"), "cardId": .string("envoy")]), .object(["uid": .string("c2"), "cardId": .string("scout")])])]))
        XCTAssertEqual(old.player.deckSlots, 4)
        XCTAssertTrue(Fx.openSlots(old).contains(4) && Fx.openSlots(old).contains(1))
        XCTAssertEqual(Fx.migrate(.object(["seed": .number(1), "player": .object(["level": .number(1)])])).player.deckSlots, 3)
        XCTAssertEqual(Fx.migrate(.object(["seed": .number(1), "player": .object(["level": .number(7)])])).player.deckSlots, 5)
        XCTAssertEqual(Fx.roundTrip(s).player.deckSlots, 2, "a round-3 save keeps its count")
    }

    func testProfileNameAndAvatar() {
        let s = Fx.freshReal()
        XCTAssertEqual(PlayerOps.editProfile(s, name: "  Morden the Great and Terrible  ", avatar: nil).player.name, "Morden the Great and")
        XCTAssertEqual(PlayerOps.editProfile(s, name: nil, avatar: 11).player.avatar, 11)
        XCTAssertEqual(PlayerOps.editProfile(s, name: nil, avatar: 12).player.avatar, 0)
        XCTAssertEqual(PlayerOps.editProfile(s, name: "   ", avatar: nil).player.name, "Tester")
    }

    // MARK: §10 persistence

    /// A long mixed scenario touching every subsystem (real data, stub engine).
    private func scenario(_ d: Deps) throws -> GameState {
        var s = Fx.rich(Fx.freshReal()) { $0.gems = 3000 }
        s.seed = 99
        s = ShopOps.claimDaily(s, now: Fx.T0).state
        s = try QuestOps.startQuest(s, deps: d, now: Fx.T0, line: "main", n: 1).state
        while !(s.quests.active?.bossReady ?? true) { s = try QuestOps.tapMinion(s, deps: d, now: Fx.T0, event: nil).state }
        s = try QuestOps.prepareBoss(s, deps: d, now: Fx.T0).state
        s = try QuestOps.fightBoss(s, deps: d, now: Fx.T0 + Fx.MIN, event: nil).state
        s = try QuestOps.startQuest(s, deps: d, now: Fx.T0 + 2 * Fx.MIN, line: "the-dark-beyond", n: 1).state
        s = try QuestOps.tapMinion(s, deps: d, now: Fx.T0 + 2 * Fx.MIN, event: nil).state
        s = ArenaOps.ensureOffers(s, deps: d, now: Fx.T0 + 3 * Fx.MIN).state
        s = try ArenaOps.fightArena(s, deps: d, now: Fx.T0 + 3 * Fx.MIN, offerIndex: 1, event: nil).state
        s = ArenaOps.rollOffers(s, deps: d, now: Fx.T0 + 4 * Fx.MIN)
        s = LeagueOps.openLeague(s, deps: d, now: Fx.T0 + 5 * Fx.MIN, event: nil).state
        s = try LeagueOps.fightLeague(s, deps: d, now: Fx.T0 + 5 * Fx.MIN, simId: s.sim.league!.simIds[2], event: nil).state
        s = try ShopOps.openBooster(s, deps: d, now: Fx.T0 + 6 * Fx.MIN, id: .summoner, portalId: nil, open: true).state
        s = try ShopOps.drawBoosterCard(s, deps: d, now: Fx.T0 + 6 * Fx.MIN, id: .summoner, portalId: nil, position: 0, event: nil).state
        s = try PieceOps.buyFirstPiece(s, deps: d, now: Fx.T0 + 7 * Fx.MIN, event: nil).state
        s = try PieceOps.addPiece(s, deps: d, now: Fx.T0 + 7 * Fx.MIN, cardId: Fx.sample(.rare, 2).id).state
        s = try PieceOps.fightHolder(s, deps: d, now: Fx.T0 + 8 * Fx.MIN, index: 1, event: nil).state
        let def = Fx.sample(.uncommon, 1)
        var a: String, c: String
        (s, a) = Fx.give(s, d, def.id, level: d.stats.capFor(def, stage: 0))
        (s, c) = Fx.give(s, d, def.id, level: 2)
        s = try FusionOps.fuse(s, deps: d, uidA: a, uidB: c).state
        var tr: String, sac: String
        (s, tr) = Fx.give(s, d, Fx.sample(.rare, 1).id)
        (s, sac) = Fx.give(s, d, "lich-king")
        s = try TrainingOps.train(s, deps: d, trainUid: tr, sacrificeUids: [sac]).state
        s = try CollectionOps.sellCard(s, deps: d, uid: s.cards.last!.uid).state
        s = try PlayerOps.spendStatPoints(Fx.withPlayer(s) { $0.statPoints = 12 }, alloc: StatAlloc(stamina: 4, mana: 4, hp: 4))
        s = PlayerOps.applyRegen(s, now: Fx.T0 + 20 * Fx.MIN)
        s.pieces = s.pieces.map { var h = $0; h.raidDay = JSDate.utcDay(Fx.T0 - Fx.DAY); return h }
        s = PieceOps.dailyRaids(s, deps: d, now: Fx.T0 + 21 * Fx.MIN).state
        s = LeagueOps.openLeague(s, deps: d, now: Fx.T0 + Fx.DAY, event: nil).state
        s = ShopOps.claimDaily(s, now: Fx.T0 + Fx.DAY).state
        s = StateOps.touch(s, now: Fx.T0 + Fx.DAY)
        return s
    }

    func testFullScenarioWithTheStubEngine() throws {
        let d = Fx.deps(.attacker).deps
        let s = try scenario(d)
        XCTAssertGreaterThan(s.cards.count, 6)
        XCTAssertEqual(s.quests.main.unlocked, 2)
        XCTAssertEqual(s.replays.count, 3)
        XCTAssertEqual(s.sim.leagueHistory.count, 1)
        XCTAssertEqual(s.daily.streak, 2)
    }

    func testRealEngineFightsAndTheBossConfig() throws {
        let d = Fx.realDeps()
        var s = Fx.rich(Fx.freshReal())
        s.seed = 7
        s = try QuestOps.startQuest(s, deps: d, now: Fx.T0, line: "main", n: 1).state
        while !(s.quests.active?.bossReady ?? true) { s = try QuestOps.tapMinion(s, deps: d, now: Fx.T0, event: nil).state }
        let boss = try QuestOps.fightBoss(s, deps: d, now: Fx.T0, event: nil)
        XCTAssertNotNil(boss.info.battle)
        s = boss.state
        s = ArenaOps.ensureOffers(s, deps: d, now: Fx.T0).state
        s = try ArenaOps.fightArena(s, deps: d, now: Fx.T0, offerIndex: 2, event: nil).state
        s = try PieceOps.addPiece(s, deps: d, now: Fx.T0, cardId: Fx.sample(.heroic).id).state
        s = try PieceOps.fightHolder(s, deps: d, now: Fx.T0, index: 0, event: nil).state
        s = LeagueOps.openLeague(s, deps: d, now: Fx.T0, event: nil).state
        s = try LeagueOps.fightLeague(s, deps: d, now: Fx.T0, simId: s.sim.league!.simIds[0], event: nil).state
        XCTAssertEqual(s.replays.count, 3)
        let lineup = QuestOps.bossLineup(quest: Fx.mainNode(1), rng: Mulberry32(1), db: Fx.db, stats: d.stats, lineId: "main")
        let cfg = QuestOps.bossBattleConfig(s, deps: d, lineup: lineup, seed: 5)
        XCTAssertEqual(cfg.attacker.player.maxHp, s.player.hpMax)
        XCTAssertEqual(cfg.attacker.cards.compactMap { $0 }.count, 3)
        XCTAssertEqual(cfg.seed, 5)
    }

    func testSaveRoundTripReproducesTheState() throws {
        let d = Fx.deps(.attacker).deps
        let s = try scenario(d)
        let rt = Fx.roundTrip(s, now: Fx.T0 + 9 * Fx.DAY)
        Fx.assertSameState(rt, s, "round trip")
        XCTAssertEqual(rt.version, StateOps.saveVersion)
        XCTAssertEqual(StateOps.saveKey, "evoker.save.v1")
        Fx.assertSameState(Fx.roundTrip(rt), rt, "second trip")
        let f = Fx.freshReal()
        Fx.assertSameState(Fx.roundTrip(f, now: Fx.T0 + Fx.DAY), f, "fresh game")
        // a partial/old save gets every default without losing data, and uids never collide
        let old = Fx.migrate(.object(["seed": .number(3), "player": .object(["name": .string("Old"), "gold": .number(5)]),
                                       "cards": .array([.object(["uid": .string("c40"), "cardId": .string("envoy")])]), "uidCounter": .number(2)]))
        XCTAssertEqual(old.player.name, "Old"); XCTAssertEqual(old.player.gold, 5); XCTAssertEqual(old.player.staminaMax, 50)
        XCTAssertEqual(old.uidCounter, 40)
        XCTAssertEqual(old.cards[0], CardInstance(uid: "c40", cardId: "envoy", stage: 0, level: 1, xp: 0, evolveQuality: 1))
        XCTAssertEqual(StateOps.nextUid(old).uid, "c41")
        XCTAssertEqual(old.settings, Settings(sound: true, musicVolume: 0.7, fxVolume: 1, speed: 1, raids: true, reducedMotion: false))
        // every seeded roll is reproducible from the save (same seed + step → same result)
        let r1 = try QuestOps.startQuest(s, deps: d, now: Fx.T0, line: "main", n: 2)
        let r2 = try QuestOps.startQuest(rt, deps: d, now: Fx.T0, line: "main", n: 2)
        XCTAssertEqual(r1.active.waves, r2.active.waves)
        XCTAssertEqual(r1.state.rngStep, s.rngStep + 1)
    }

    func testParseSaveRejectsGarbage() throws {
        XCTAssertNil(try SaveCodec.parse(Data(), now: Fx.T0))
        XCTAssertNil(try SaveCodec.parse(Data("{not json".utf8), now: Fx.T0))
        XCTAssertNil(try SaveCodec.parse(Data("{\"foo\":1}".utf8), now: Fx.T0))
        XCTAssertNil(try SaveCodec.parse(Data("42".utf8), now: Fx.T0))
        let s = Fx.freshReal()
        let raw = try SaveCodec.serialize(s, now: Fx.T0 + 5)
        let back = try SaveCodec.parse(raw, now: Fx.T0 + 10)!
        XCTAssertEqual(back.version, StateOps.saveVersion)
        XCTAssertEqual(back.player.name, "Tester")
        XCTAssertEqual(back.lastSeen, Fx.T0 + 5)
        XCTAssertEqual(back.cards.count, s.cards.count)
    }

    func testPruneRemovedDropsUnknownCardsAndLines() {
        let d = Fx.deps().deps
        var s = Fx.freshReal()
        s.cards.append(CardInstance(uid: "c99", cardId: "dungeon-casino-dealer"))
        s.deck[4] = "c99"
        s.quests.portals["dungeon-casino"] = LineProgress(unlocked: 2, done: 1, firstWins: [1])
        s.quests.portals["dragon-hunt"] = LineProgress(unlocked: 1, done: 0, firstWins: [])
        s.quests.manualPortal = "dungeon-casino"
        s.collections.claimed = ["dungeon-casino", "the-dark-beyond"]
        s.collections.seen = ["envoy", "dungeon-casino-dealer"]
        let p = StateOps.pruneRemoved(s, deps: d)
        XCTAssertEqual(p.cards.count, 6)
        XCTAssertNil(p.deck[4])
        XCTAssertEqual(Array(p.quests.portals.keys), ["dragon-hunt"])
        XCTAssertNil(p.quests.manualPortal)
        XCTAssertEqual(p.collections.claimed, ["the-dark-beyond"])
        XCTAssertEqual(p.collections.seen, ["envoy"])
        XCTAssertEqual(StateOps.pruneRemoved(Fx.freshReal(), deps: d), Fx.freshReal(), "nothing to prune: the same state")
    }
}
