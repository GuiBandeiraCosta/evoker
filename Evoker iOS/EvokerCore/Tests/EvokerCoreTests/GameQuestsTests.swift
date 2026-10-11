import Foundation
import XCTest
@testable import EvokerCore

/// Port of `tests/game-quests.test.js`: quests (portal rotation, minion waves, taps, boss line-ups and fights,
/// rewards) on the fixture catalog and against game-design §4 on the real data.
final class GameQuestsTests: XCTestCase {
    // MARK: fixture catalog

    func testPortalRotationSevenDaysFromCreation() {
        let d = Fx.makeDeps().deps
        let s0 = QuestOps.portalSchedule(deps: d, createdAt: Fx.T0, now: Fx.T0)!
        XCTAssertEqual(s0.portalId, "the-dark-beyond")
        XCTAssertEqual(s0.remainingMs, 7 * Fx.DAY)
        XCTAssertEqual(QuestOps.portalSchedule(deps: d, createdAt: Fx.T0, now: Fx.T0 + 7 * Fx.DAY)!.portalId, "dragon-hunt")
        XCTAssertEqual(QuestOps.portalSchedule(deps: d, createdAt: Fx.T0, now: Fx.T0 + 20 * Fx.DAY)!.portalId, "dwarven-rage")
        XCTAssertEqual(QuestOps.portalSchedule(deps: d, createdAt: Fx.T0, now: Fx.T0 + 21 * Fx.DAY)!.portalId, "the-dark-beyond")
        XCTAssertEqual(QuestOps.portalSchedule(deps: d, createdAt: Fx.T0, now: Fx.T0 + 8 * Fx.DAY)!.portalId, "dragon-hunt")
    }

    func testStartQuestBuildsWaves() throws {
        let f = Fx.fresh()
        let r = try QuestOps.startQuest(f.state, deps: f.deps, now: Fx.T0, line: "main", n: 1)
        XCTAssertEqual(r.active.figuresTotal, 5)
        XCTAssertEqual(r.active.waves.count, 2)
        XCTAssertTrue(r.active.waves.allSatisfy { $0.count >= 2 && $0.count <= 4 })
        XCTAssertTrue(r.active.waves.flatMap { $0 }.allSatisfy { [Rarity.common, .standard].contains(f.deps.db.get($0!)!.rarity) })
        assertThrows(try QuestOps.startQuest(f.state, deps: f.deps, now: Fx.T0, line: "main", n: 2), "locked")
        let big = try QuestOps.startQuest(Fx.withMain(f.state, unlocked: 60, done: 59, firstWins: []), deps: f.deps, now: Fx.T0, line: "main", n: 60)
        XCTAssertTrue(big.active.waves.count >= 2 && big.active.waves.count <= 5)
        XCTAssertEqual(big.active.waves.flatMap { $0 }.count, f.deps.quests!.main.nodes[59].figures)
    }

    func testTapMinionStaminaPotionRewardsBoss() throws {
        var f = Fx.fresh()
        f.state = try QuestOps.startQuest(f.state, deps: f.deps, now: Fx.T0, line: "main", n: 1).state
        var r = try QuestOps.tapMinion(f.state, deps: f.deps, now: Fx.T0, event: nil)
        XCTAssertEqual(r.state.player.stamina, 48)
        XCTAssertEqual(r.info.gold, 6)
        XCTAssertTrue(r.info.perfect)
        XCTAssertEqual(r.info.xp, 2)
        XCTAssertEqual(r.state.player.gold, 306)
        XCTAssertEqual(r.info.minion, f.state.quests.active!.waves[0][0])
        XCTAssertEqual(r.info.pct, 20)
        let short = Fx.withPlayer(f.state) { $0.stamina = 1 }
        let blocked = try QuestOps.tapMinion(short, deps: f.deps, now: Fx.T0, event: nil)
        XCTAssertTrue(blocked.info.needsPotion!.needed)
        XCTAssertEqual(blocked.state, short)
        var s = r.state
        var rewards: [Reward?] = []
        var cleared = 0
        for _ in 0..<4 {
            r = try QuestOps.tapMinion(s, deps: f.deps, now: Fx.T0, event: nil)
            s = r.state
            if r.info.waveCleared { cleared += 1; rewards.append(r.info.reward) }
        }
        XCTAssertEqual(cleared, 2)
        XCTAssertTrue(r.info.bossReady)
        XCTAssertEqual(r.info.pct, 100)
        XCTAssertEqual(s.player.stamina, 40)
        XCTAssertEqual(r.info.gold, 16)
        let converted = rewards.compactMap { $0 }.filter { $0.type == .card && $0.converted == true }.reduce(0) { $0 + ($1.gold ?? 0) }
        XCTAssertEqual(s.player.gold, 300 + 5 * 6 + 10 + converted)
        XCTAssertEqual(s.player.xp, 10)
        XCTAssertTrue(rewards.allSatisfy { $0 == nil || $0!.type == .card || ($0!.type == .gold && $0!.burst == true) })
        let again = try QuestOps.tapMinion(s, deps: f.deps, now: Fx.T0, event: nil)
        XCTAssertTrue(again.info.bossReady)
        XCTAssertEqual(again.state.player.stamina, 40)
    }

    func testWaveDropOddsAndTapGoldFixture() {
        let d = Fx.makeDeps().deps
        let quest = d.quests!.main.nodes[11]
        let rng = Mulberry32(99)
        var card = 0, none = 0
        let N = 4000
        for _ in 0..<N { if RewardOps.rollWaveReward(rng: rng, deps: d, quest: quest).type == .card { card += 1 } else { none += 1 } }
        XCTAssertLessThan(abs(Double(card) / Double(N) - 0.2), 0.03)
        XCTAssertLessThan(abs(Double(none) / Double(N) - 0.8), 0.03)
        var bursts = 0
        for _ in 0..<N {
            let t = RewardOps.rollTapGold(rng: rng, quest: quest)
            XCTAssertEqual(t.tap, 30)
            if t.burst != 0 { bursts += 1; XCTAssertEqual(t.burst, 135) }
        }
        XCTAssertLessThan(abs(Double(bursts) / Double(N) - 0.1), 0.02)
        XCTAssertEqual(RewardOps.rollTapGold(rng: FixedRng(0.05), quest: quest, last: false, event: .goldenDay), TapGold(gold: 45 + 203, tap: 45, burst: 203, perfect: true))
        let q1 = d.quests!.main.nodes[0]
        XCTAssertEqual(RewardOps.rollTapGold(rng: FixedRng(0), quest: q1), TapGold(gold: 6, tap: 6, burst: 0, perfect: true))
        XCTAssertEqual(RewardOps.rollTapGold(rng: FixedRng(0), quest: q1, last: true), TapGold(gold: 16, tap: 6, burst: 10, perfect: true))
    }

    func testBossLineupFixture() {
        let d = Fx.makeDeps().deps
        let q1 = d.quests!.main.nodes[0]
        let l1 = QuestOps.bossLineup(quest: q1, rng: Mulberry32(3), db: d.db, stats: d.stats, lineId: "main")
        XCTAssertEqual(l1.cards.compactMap { $0 }.map { $0.cardId }, ["throat-cutter", "throat-cutter"])
        XCTAssertEqual(l1.cards[2]!.cardId, "throat-cutter")
        XCTAssertEqual(l1.player.name, "Worm Shaman")
        XCTAssertEqual(l1.player.maxHp, 250)
        XCTAssertEqual(l1.cards[2]!.level, 1)
        let q100 = d.quests!.main.nodes[99]
        let l100 = QuestOps.bossLineup(quest: q100, rng: Mulberry32(5), db: d.db, stats: d.stats, lineId: "main")
        XCTAssertEqual(l100.cards[2]!.cardId, "imperial-dragon")
        XCTAssertEqual(l100.cards[2]!.stage, 2)
        XCTAssertEqual(l100.cards[2]!.level, 34)
        XCTAssertEqual(l100.player.name, "Imperial Dragon++")
        XCTAssertEqual(l100.cards.compactMap { $0 }.count, 5)
        for c in l100.cards.compactMap({ $0 }) {
            let def = d.db.get(c.cardId)!
            XCTAssertLessThanOrEqual(c.level, d.stats.capFor(def, stage: c.stage))
            XCTAssertGreaterThanOrEqual(c.level, 18)
            XCTAssertTrue([Rarity.heroic, .legendary].contains(def.rarity) || c.isBoss == true)
        }
        let q5 = d.quests!.main.nodes[4]
        let l5 = QuestOps.bossLineup(quest: q5, rng: Mulberry32(8), db: d.db, stats: d.stats, lineId: "main")
        XCTAssertTrue([Rarity.common, .standard].contains(d.db.get(l5.cards[2]!.cardId)!.rarity))
        XCTAssertTrue(l5.cards.compactMap { $0 }.allSatisfy { $0.level >= 1 && $0.level <= 3 })
    }

    func testQuestFlowWinAndLoss() throws {
        var f = Fx.fresh(winner: .attacker)
        f.state = try QuestOps.startQuest(f.state, deps: f.deps, now: Fx.T0, line: "main", n: 1).state
        for _ in 0..<5 { f.state = try QuestOps.tapMinion(f.state, deps: f.deps, now: Fx.T0, event: nil).state }
        XCTAssertTrue(f.state.quests.active!.bossReady)
        let pb = try QuestOps.prepareBoss(f.state, deps: f.deps, now: Fx.T0)
        XCTAssertEqual(pb.lineup.cards[2]!.cardId, "throat-cutter")
        let r = try QuestOps.fightBoss(pb.state, deps: f.deps, now: Fx.T0, event: nil)
        XCTAssertTrue(r.info.won)
        XCTAssertEqual(r.info.unlocked, 2)
        XCTAssertTrue(r.info.firstWin)
        XCTAssertEqual(r.state.quests.main.unlocked, 2)
        XCTAssertEqual(r.state.player.questsDone, 1)
        XCTAssertNil(r.state.quests.active)
        XCTAssertEqual(r.info.playerXp, 0)
        XCTAssertEqual([r.info.reward!.type.rawValue, r.info.reward!.cardId!], ["card", "throat-cutter"])
        XCTAssertNil(r.info.deckSlots)
        XCTAssertEqual(QuestOps.questStatus(r.state, lineId: "main", n: 1), .done)
        XCTAssertEqual(QuestOps.questStatus(r.state, lineId: "main", n: 2), .current)
        XCTAssertTrue(r.state.cards.first { $0.uid == f.state.deck[1] }!.xp > 0 || !r.info.cardLevelUps.isEmpty)
        XCTAssertEqual(f.engine.calls.count, 1)
        XCTAssertEqual(f.engine.calls[0].defender.player.maxHp, 250)
        f.engine.winner = .defender
        var s = try QuestOps.startQuest(r.state, deps: f.deps, now: Fx.T0, line: "main", n: 2).state
        while !s.quests.active!.bossReady { s = try QuestOps.tapMinion(s, deps: f.deps, now: Fx.T0, event: nil).state }
        let loss = try QuestOps.fightBoss(s, deps: f.deps, now: Fx.T0, event: nil)
        XCTAssertFalse(loss.info.won)
        XCTAssertEqual(loss.state.quests.main.unlocked, 2)
        XCTAssertEqual(loss.state.quests.active!.figuresDone, 0)
        XCTAssertFalse(loss.state.quests.active!.bossReady)
        XCTAssertEqual(QuestOps.questProgressPct(loss.state.quests.active), 0)
        XCTAssertEqual(loss.info.playerXp, 0)
        var noActive = r.state
        noActive.quests.active = nil
        assertThrows(try QuestOps.fightBoss(noActive, deps: f.deps, now: Fx.T0, event: nil), "not beaten")
    }

    func testReplayGivesNoSecondFirstWin() throws {
        var f = Fx.fresh(winner: .attacker)
        f.state = Fx.withMain(f.state, unlocked: 3, done: 2, firstWins: [1, 2])
        f.state = try QuestOps.startQuest(f.state, deps: f.deps, now: Fx.T0, line: "main", n: 1).state
        while !f.state.quests.active!.bossReady { f.state = try QuestOps.tapMinion(f.state, deps: f.deps, now: Fx.T0, event: nil).state }
        let r = try QuestOps.fightBoss(f.state, deps: f.deps, now: Fx.T0, event: nil)
        XCTAssertFalse(r.info.firstWin)
        XCTAssertNil(r.info.unlocked)
        XCTAssertEqual(r.state.quests.main.unlocked, 3)
        XCTAssertEqual(r.state.player.questsDone, 0)
    }

    func testBossRewardOddsFixture() {
        let d = Fx.makeDeps().deps
        let line = d.quests!.main
        let quest = line.nodes[71]
        let rng = Mulberry32(2024)
        var counts: [RewardType: Int] = [:]
        let N = 4000
        for _ in 0..<N { counts[RewardOps.rollBossReward(rng: rng, deps: d, line: line, quest: quest, firstWin: false, event: nil).type, default: 0] += 1 }
        let p: (RewardType) -> Double = { Double(counts[$0] ?? 0) / Double(N) }
        XCTAssertLessThan(abs(p(.gold) - 0.45), 0.03)
        XCTAssertLessThan(abs(p(.token) - 0.25), 0.03)
        XCTAssertLessThan(abs(p(.piece) - 0.15), 0.03)
        XCTAssertLessThan(abs(p(.potion) - 0.1), 0.03)
        XCTAssertLessThan(abs(p(.gems) - 0.05), 0.02)
        let early = line.nodes[4]
        var pieces = 0
        for _ in 0..<1000 { if RewardOps.rollBossReward(rng: rng, deps: d, line: line, quest: early, firstWin: false, event: nil).type == .piece { pieces += 1 } }
        XCTAssertEqual(pieces, 0)
        let tok = RewardOps.rollBossReward(rng: Mulberry32(1), deps: d, line: line, quest: early, firstWin: false, event: nil)
        if tok.type == .token { XCTAssertEqual(tok.token, .neophyte) }
        let portal = d.quests!.portals[0]
        let first = RewardOps.rollBossReward(rng: Mulberry32(1), deps: d, line: portal, quest: portal.nodes[24], firstWin: true, event: nil)
        XCTAssertEqual(first, Reward(type: .token, count: 1, token: .portalHigh, portalId: "the-dark-beyond"))
        for _ in 0..<200 {
            let p = RewardOps.rollBossReward(rng: rng, deps: d, line: portal, quest: portal.nodes[10], firstWin: false, event: nil)
            if p.type == .piece { XCTAssertTrue(portal.cards.contains(p.cardId!)) }
            if p.type == .token { XCTAssertEqual(p.token, .portalHigh) }
        }
    }

    func testApplyRewardHandlesEveryType() throws {
        var f = Fx.fresh()
        f.state = try RewardOps.applyReward(f.state, deps: f.deps, now: Fx.T0, reward: .gold(50)).state
        XCTAssertEqual(f.state.player.gold, 350)
        f.state = try RewardOps.applyReward(f.state, deps: f.deps, now: Fx.T0, reward: .gems(13)).state
        XCTAssertEqual(f.state.player.gems, 13)
        f.state = try RewardOps.applyReward(f.state, deps: f.deps, now: Fx.T0, reward: .potion(.mana, count: 2)).state
        XCTAssertEqual(f.state.player.manaPotions, 3)
        f.state = try RewardOps.applyReward(f.state, deps: f.deps, now: Fx.T0, reward: .token(.portalLow, portalId: "dragon-hunt", count: 1)).state
        XCTAssertEqual(PlayerOps.tokenCount(f.state, kind: .portalLow, portalId: "dragon-hunt"), 1)
        let card = try RewardOps.applyReward(f.state, deps: f.deps, now: Fx.T0, reward: .card("basilisk", stage: 0, level: 2))
        XCTAssertEqual(card.reward.converted, false)
        XCTAssertEqual(card.state.cards.first { $0.uid == card.reward.uid }!.level, 2)
        let piece = try RewardOps.applyReward(card.state, deps: f.deps, now: Fx.T0, reward: .piece("dwarf-king"))
        XCTAssertEqual(piece.state.pieces.count, 1)
        XCTAssertEqual(piece.state.pieces[0].total, 10)
        XCTAssertEqual(piece.reward.huntIndex, 0)
        XCTAssertEqual(RewardOps.describeReward(nil, db: f.deps.db), "Nothing this time")
        XCTAssertEqual(RewardOps.describeReward(.gold(5), db: f.deps.db), "5 gold")
        XCTAssertEqual(RewardOps.describeReward(.potion(.mana, count: 2), db: f.deps.db), "2 mana potions")
    }

    // MARK: §4 quest flow (real data)

    func testPortalRotationCyclesInOrder() {
        let d = Fx.deps().deps
        let s = Fx.freshReal()
        let ids = Fx.quests.portals.map { $0.id }
        for k in 0..<20 {
            let now = Fx.T0 + Int64(k) * 7 * Fx.DAY + 3 * Fx.DAY
            let sch = QuestOps.portalSchedule(deps: d, createdAt: Fx.T0, now: now)!
            XCTAssertEqual(sch.portalId, ids[k % ids.count], "period \(k)")
            XCTAssertEqual(sch.startedAt, Fx.T0 + Int64(k) * 7 * Fx.DAY)
            XCTAssertEqual(sch.endsAt, Fx.T0 + Int64(k + 1) * 7 * Fx.DAY)
            XCTAssertEqual(sch.remainingMs, 4 * Fx.DAY)
        }
        XCTAssertEqual(QuestOps.portalSchedule(deps: d, createdAt: Fx.T0, now: Fx.T0 + 7 * Fx.DAY - 1)!.portalId, ids[0])
        XCTAssertEqual(QuestOps.portalSchedule(deps: d, createdAt: Fx.T0, now: Fx.T0 + 7 * Fx.DAY)!.portalId, ids[1])
        XCTAssertEqual(QuestOps.questStatus(s, lineId: "dying-dreams", n: 1), .current)
        XCTAssertEqual(QuestOps.questStatus(s, lineId: "dying-dreams", n: 2), .locked)
    }

    func testQuestOneWormShaman() throws {
        let d = Fx.deps().deps
        let s = Fx.tutorialStart(d)
        XCTAssertEqual(QuestOps.questStatus(s, lineId: "main", n: 1), .current)
        XCTAssertEqual(QuestOps.questStatus(s, lineId: "main", n: 2), .locked)
        assertThrows(try QuestOps.startQuest(s, deps: d, now: Fx.T0, line: "main", n: 2), "locked")
        let q1 = Fx.mainNode(1)
        XCTAssertEqual(q1.staminaPerTap, 2); XCTAssertEqual(q1.figures, 5); XCTAssertEqual(q1.bossHp, 250)
        let st = try QuestOps.startQuest(s, deps: d, now: Fx.T0, line: "main", n: 1)
        XCTAssertEqual(st.active.figuresTotal, 5)
        XCTAssertEqual(st.active.waves.count, 2)
        XCTAssertEqual(st.active.waves.map { $0.count }, [3, 2])
        let lineup = QuestOps.bossLineup(quest: q1, rng: Mulberry32(5), db: Fx.db, stats: d.stats, lineId: "main")
        XCTAssertEqual(lineup.boss.cardId, "throat-cutter")
        XCTAssertEqual(lineup.boss.level, 1)
        XCTAssertEqual(lineup.boss.stage, 0)
        XCTAssertEqual(lineup.cards[2], lineup.boss, "the boss card sits in the middle slot")
        XCTAssertEqual(lineup.cards.compactMap { $0 }.map { $0.cardId }, ["throat-cutter", "throat-cutter"])
        XCTAssertEqual(lineup.player.hp, 250); XCTAssertEqual(lineup.player.maxHp, 250)
        XCTAssertEqual(lineup.player.level, 1)
        XCTAssertEqual(lineup.player.name, "Worm Shaman")
        for c in lineup.cards.compactMap({ $0 }) where c != lineup.boss {
            XCTAssertTrue([Rarity.common, .standard].contains(Fx.db.get(c.cardId)!.rarity))
            XCTAssertTrue(c.level >= 1 && c.level <= 3)
        }
    }

    func testWavesOfEveryNode() {
        let d = Fx.deps().deps
        var lines: [(String, QuestLine)] = [("main", Fx.quests.main)]
        for p in Fx.quests.portals { lines.append((p.id, p)) }
        for (lineId, line) in lines {
            for q in line.nodes {
                let waves = QuestOps.generateWaves(rng: Mulberry32(UInt32(q.n * 31 + lineId.count)), deps: d, quest: q)
                XCTAssertTrue(waves.count >= 2 && waves.count <= 5, "\(lineId) \(q.n) waves")
                XCTAssertEqual(waves.reduce(0) { $0 + $1.count }, q.figures, "\(lineId) \(q.n) figures")
                for w in waves {
                    XCTAssertGreaterThanOrEqual(w.count, 2, "\(lineId) \(q.n) wave size")
                    if q.figures <= 20 { XCTAssertLessThanOrEqual(w.count, 4, "\(lineId) \(q.n) wave size \(w.count)") }
                    for id in w {
                        let def = Fx.db.get(id!)
                        XCTAssertTrue(def != nil && !def!.isTrainer && q.band.rarities.contains(def!.rarity), "\(lineId) \(q.n) minion \(id!)")
                    }
                }
            }
        }
    }

    func testTappingCostsStaminaPaysGoldAndXp() throws {
        let d = Fx.deps().deps
        let s = Fx.freshReal()
        let st = try QuestOps.startQuest(s, deps: d, now: Fx.T0, line: "main", n: 1).state
        let t1 = try QuestOps.tapMinion(st, deps: d, now: Fx.T0, event: nil)
        XCTAssertEqual(t1.state.player.stamina, 48)
        XCTAssertNil(t1.info.needsPotion)
        XCTAssertFalse(t1.info.waveCleared)
        XCTAssertEqual(t1.info.pct, 20)
        XCTAssertEqual(t1.info.minion, st.quests.active!.waves[0][0])
        XCTAssertEqual([t1.info.stamina, t1.info.gold, t1.info.tapGold, t1.info.burst, t1.info.xp], [2, 6, 6, 0, 2])
        XCTAssertTrue(t1.info.perfect)
        XCTAssertEqual(t1.state.player.gold, st.player.gold + 6)
        XCTAssertEqual(t1.state.player.xp, st.player.xp + 2)
        XCTAssertEqual(QuestOps.questTapInfo(Fx.mainNode(12)), QuestTapInfo(stamina: 5, gold: 30, xp: 5, figures: 11, burstChance: 0.1, endGold: 0))
        let short = Fx.withPlayer(st) { $0.stamina = 1 }
        let t2 = try QuestOps.tapMinion(short, deps: d, now: Fx.T0, event: .drinkingContest)
        XCTAssertEqual(t2.state, short, "nothing changes when short")
        XCTAssertTrue(t2.info.needsPotion!.needed)
        XCTAssertEqual(t2.info.needsPotion!.kind, .stamina)
        XCTAssertEqual(t2.info.needsPotion!.price, 20)
        XCTAssertEqual(t2.info.needsPotion!.missing, 1)
        XCTAssertEqual(try QuestOps.tapMinion(short, deps: d, now: Fx.T0, event: nil).info.needsPotion!.price, 40)
        let r31 = Fx.withMain(Fx.rich(s), unlocked: 31, done: 30, firstWins: [])
        let st31 = try QuestOps.startQuest(r31, deps: d, now: Fx.T0, line: "main", n: 31).state
        XCTAssertEqual(try QuestOps.tapMinion(st31, deps: d, now: Fx.T0, event: nil).state.player.stamina, 5000 - 6)
        let edge = Fx.withPlayer(st31) { $0.xp = d.stats.playerXpToNext(level: 10)! - 1; $0.stamina = 10; $0.staminaMax = 60 }
        let lv = try QuestOps.tapMinion(edge, deps: d, now: Fx.T0, event: nil)
        XCTAssertEqual(lv.info.levelUps, [11])
        XCTAssertEqual(lv.info.levelUpDetails[0].rewards.gold, 550)
        XCTAssertEqual(lv.state.player.stamina, 60, "a level-up refills stamina")
        let stP = try QuestOps.startQuest(Fx.rich(s), deps: d, now: Fx.T0, line: "the-dark-beyond", n: 1).state
        XCTAssertEqual(try QuestOps.tapMinion(stP, deps: d, now: Fx.T0, event: nil).state.player.stamina, 5000 - 6)
    }

    func testClearingEveryWave() throws {
        let d = Fx.deps().deps
        var s = try QuestOps.startQuest(Fx.rich(Fx.freshReal()), deps: d, now: Fx.T0, line: "main", n: 1).state
        let total = s.quests.active!.figuresTotal
        var rewards = 0, cleared = 0
        for i in 0..<total {
            let r = try QuestOps.tapMinion(s, deps: d, now: Fx.T0, event: nil)
            s = r.state
            XCTAssertEqual(r.info.pct, JSMath.roundInt(Double(i + 1) / Double(total) * 100))
            if r.info.waveCleared { cleared += 1; rewards += 1 }
            XCTAssertTrue(r.info.reward == nil || r.info.reward!.type == .card || (r.info.reward!.type == .gold && r.info.reward!.burst == true), "card drop or gold burst")
            if i < total - 1 { XCTAssertTrue(r.info.reward == nil || r.info.reward!.type == .card, "quest 1 has no random bursts") }
            XCTAssertEqual(r.info.bossReady, i == total - 1)
        }
        XCTAssertEqual(cleared, s.quests.active!.waves.count)
        XCTAssertEqual(rewards, 2)
        XCTAssertTrue(s.quests.active!.bossReady)
        XCTAssertEqual(QuestOps.questProgressPct(s.quests.active), 100)
        XCTAssertEqual(s.player.stamina, 5000 - 2 * total)
        let after = try QuestOps.tapMinion(s, deps: d, now: Fx.T0, event: nil)
        XCTAssertEqual(after.state, s, "no more taps once the boss is ready")
        XCTAssertTrue(after.info.bossReady)
        assertThrows(try QuestOps.prepareBoss(try QuestOps.startQuest(Fx.rich(Fx.freshReal()), deps: d, now: Fx.T0, line: "main", n: 1).state, deps: d, now: Fx.T0), "minions")
    }

    func testWaveDropOddsAndGoldenDay() {
        let d = Fx.deps().deps
        let q = Fx.mainNode(45)
        let N = 20000
        var card = 0, none = 0, gold = 0, bursts = 0
        for i in 0..<N {
            let t = RewardOps.rollTapGold(rng: Mulberry32(UInt32(i)), quest: q)
            XCTAssertEqual(t.tap, 33)
            if t.burst != 0 { bursts += 1; XCTAssertEqual(t.burst, JSMath.roundInt(33 * 4.5)) }
            let r = RewardOps.rollWaveReward(rng: Mulberry32(UInt32(i)), deps: d, quest: q)
            switch r.type {
            case .card:
                card += 1
                let def = Fx.db.get(r.cardId!)!
                XCTAssertTrue(q.band.rarities.contains(def.rarity))
                XCTAssertFalse(def.isTrainer)
                XCTAssertEqual(r.level, 1)
                XCTAssertEqual(r.stage, q.band.stages![0])
            case .gold: gold += 1
            default: none += 1
            }
        }
        XCTAssertEqual(gold, 0)
        XCTAssertTrue(Fx.within(Double(card) / Double(N), 0.2, 0.015), "card \(card)")
        XCTAssertTrue(Fx.within(Double(none) / Double(N), 0.8, 0.015), "none \(none)")
        XCTAssertTrue(Fx.within(Double(bursts) / Double(N), 0.1, 0.01), "bursts \(bursts)")
        XCTAssertEqual(RewardOps.waveOdds.card, 0.2); XCTAssertEqual(RewardOps.waveOdds.none, 0.8)
        XCTAssertEqual(RewardOps.rollTapGold(rng: Mulberry32(1), quest: q, last: false, event: .goldenDay).tap, JSMath.roundInt(33 * 1.5))
        XCTAssertEqual(PlayerOps.goldWithEvent(100, event: .goldenDay), 150)
        XCTAssertEqual(PlayerOps.goldWithEvent(100, event: .infiniteWisdom), 100)
        var fused: Reward? = nil
        var i: UInt32 = 0
        while fused == nil { let r = RewardOps.rollWaveReward(rng: Mulberry32(i), deps: d, quest: Fx.mainNode(70)); if r.type == .card { fused = r }; i += 1 }
        XCTAssertEqual(fused!.stage, 1)
    }

    func testBossLineupsOfMainAndPortals() {
        let d = Fx.deps().deps
        @discardableResult
        func check(_ lineId: String, _ q: QuestNode, _ seed: UInt32) -> BossLineup {
            let lu = QuestOps.bossLineup(quest: q, rng: Mulberry32(seed), db: Fx.db, stats: d.stats, lineId: lineId)
            let (lo, hi) = q.band.levelRange
            XCTAssertEqual(lu.cards.compactMap { $0 }.count, 1 + (q.bossCards ?? 4))
            XCTAssertEqual(lu.player.hp, q.bossHp)
            XCTAssertEqual(lu.player.level, q.n)
            if let b = q.boss { XCTAssertEqual(lu.boss.cardId, b); XCTAssertEqual(lu.boss.stage, q.bossStage) }
            let t = QuestOps.bandPosition(lineId: lineId, n: q.n)
            let bdef = Fx.db.get(lu.boss.cardId)!
            let want = q.bossLevel ?? JSMath.roundInt(Double(lo) + Double(hi - lo) * t)
            XCTAssertEqual(lu.boss.level, max(1, min(d.stats.capFor(bdef, stage: lu.boss.stage), want)))
            for c in lu.cards.compactMap({ $0 }) where c != lu.boss {
                let def = Fx.db.get(c.cardId)!
                XCTAssertFalse(def.isTrainer, "trainer in line-up")
                XCTAssertTrue(q.band.rarities.contains(def.rarity), "\(lineId) \(q.n) rarity \(def.rarity)")
                let (s0, s1) = q.band.stageRange
                XCTAssertTrue(c.stage >= s0 && c.stage <= s1)
                XCTAssertTrue(c.level >= max(1, lo - 2) && c.level <= hi + 2, "\(lineId) \(q.n) level \(c.level)")
                XCTAssertLessThanOrEqual(c.level, d.stats.capFor(def, stage: c.stage), "level above cap")
            }
            return lu
        }
        for n in [1, 5, 11, 30, 33, 45, 61, 77, 91, 100] { for seed in 1...5 { check("main", Fx.mainNode(n), UInt32(seed * 100 + n)) } }
        for p in Fx.quests.portals { for n in [1, 4, 8, 9, 17, 18, 25] { check(p.id, p.nodes[n - 1], UInt32(n)) } }
        let q100 = check("main", Fx.mainNode(100), 1)
        XCTAssertEqual(q100.boss.cardId, "imperial-dragon")
        XCTAssertEqual(q100.boss.stage, 2)
        XCTAssertEqual(q100.boss.level, 34)
        XCTAssertEqual(q100.player.name, "Imperial Dragon++")
        XCTAssertEqual(q100.player.hp, 10500)
        let q33 = check("main", Fx.mainNode(33), 1)
        XCTAssertEqual(q33.boss.cardId, "tunnel-digger")
        XCTAssertEqual(q33.player.hp, 1500 + 90 * 33)
    }

    func testBossRewardOddsRealData() {
        let d = Fx.deps().deps
        let N = 20000
        struct Tally { var c: [RewardType: Int] = [:]; var tokens = Set<String>(); var pieces = Set<String>(); var potions = Set<PotionKind>(); var gemsMin = Int.max; var gemsMax = Int.min; var gold = Set<Int>() }
        func tally(_ line: QuestLine, _ q: QuestNode, _ firstWin: Bool, _ event: DailyEventId?) -> Tally {
            var t = Tally()
            for i in 0..<N {
                let r = RewardOps.rollBossReward(rng: Mulberry32(UInt32(i)), deps: d, line: line, quest: q, firstWin: firstWin, event: event)
                t.c[r.type, default: 0] += 1
                switch r.type {
                case .token: t.tokens.insert((r.token?.rawValue ?? "") + ":" + (r.portalId ?? ""))
                case .piece: t.pieces.insert(r.cardId!)
                case .potion: t.potions.insert(r.potion!); XCTAssertEqual(r.count, 1)
                case .gems: t.gemsMin = min(t.gemsMin, r.gems!); t.gemsMax = max(t.gemsMax, r.gems!)
                case .gold: t.gold.insert(r.gold!)
                default: break
                }
            }
            return t
        }
        let q50 = Fx.mainNode(50)
        let t = tally(Fx.quests.main, q50, false, nil)
        let p: (Tally, RewardType) -> Double = { Double($0.c[$1] ?? 0) / Double(N) }
        XCTAssertTrue(Fx.within(p(t, .gold), 0.45, 0.015), "gold \(p(t, .gold))")
        XCTAssertTrue(Fx.within(p(t, .token), 0.25, 0.015), "token \(p(t, .token))")
        XCTAssertTrue(Fx.within(p(t, .piece), 0.15, 0.015), "piece \(p(t, .piece))")
        XCTAssertTrue(Fx.within(p(t, .potion), 0.1, 0.012), "potion \(p(t, .potion))")
        XCTAssertTrue(Fx.within(p(t, .gems), 0.05, 0.01), "gems \(p(t, .gems))")
        XCTAssertEqual(t.gold, [q50.goldPerFigure * 4 * 3])
        XCTAssertEqual(t.tokens, ["summoner:"])
        XCTAssertEqual(t.potions, [.mana, .stamina])
        XCTAssertEqual(t.gemsMin, 13); XCTAssertEqual(t.gemsMax, 82)
        for id in t.pieces {
            XCTAssertTrue(Fx.quests.main.cards.contains(id), "piece of a main set card")
            XCTAssertEqual(Fx.db.get(id)!.rarity, .heroic)
        }
        XCTAssertEqual(RewardOps.bossOdds.gold, 0.45); XCTAssertEqual(RewardOps.bossOdds.gems, 0.05)
        XCTAssertEqual(RewardOps.bossGemsRange.0, 13); XCTAssertEqual(RewardOps.bossGemsRange.1, 82)
        let early = tally(Fx.quests.main, Fx.mainNode(12), true, nil)
        XCTAssertEqual(early.c[.piece] ?? 0, 0)
        XCTAssertTrue(Fx.within(p(early, .gold), 0.6, 0.015))
        XCTAssertEqual(early.tokens, ["neophyte:"])
        let late = tally(Fx.quests.main, Fx.mainNode(80), false, nil)
        XCTAssertEqual(late.tokens, ["archmage:"])
        XCTAssertFalse(late.pieces.isEmpty)
        for id in late.pieces { XCTAssertEqual(Fx.db.get(id)!.rarity, .legendary) }
        var g: Int? = nil
        var i: UInt32 = 0
        while g == nil { let r = RewardOps.rollBossReward(rng: Mulberry32(i), deps: d, line: Fx.quests.main, quest: q50, firstWin: false, event: .goldenDay); if r.type == .gold { g = r.gold }; i += 1 }
        XCTAssertEqual(g, JSMath.roundInt(Double(q50.goldPerFigure * 12) * 1.5))
    }

    func testPortalBossRewards() {
        let d = Fx.deps().deps
        let p = Fx.portal(0)
        let N = 6000
        func tally(_ q: QuestNode, _ firstWin: Bool) -> (c: [RewardType: Int], tokens: Set<String>, pieces: Set<String>) {
            var c: [RewardType: Int] = [:]
            var tokens = Set<String>(), pieces = Set<String>()
            for i in 0..<N {
                let r = RewardOps.rollBossReward(rng: Mulberry32(UInt32(i)), deps: d, line: p, quest: q, firstWin: firstWin, event: nil)
                c[r.type, default: 0] += 1
                if r.type == .token { tokens.insert(r.token!.rawValue + ":" + r.portalId!) }
                if r.type == .piece { pieces.insert(r.cardId!) }
            }
            return (c, tokens, pieces)
        }
        let n3 = tally(p.nodes[2], true)
        XCTAssertEqual(n3.c[.piece] ?? 0, 0, "no pieces before node 4")
        XCTAssertTrue(Fx.within(Double(n3.c[.gold] ?? 0) / Double(N), 0.6, 0.025))
        XCTAssertEqual(n3.tokens, ["portalLow:the-dark-beyond"])
        let n4 = tally(p.nodes[3], true)
        XCTAssertTrue(Fx.within(Double(n4.c[.piece] ?? 0) / Double(N), 0.15, 0.025))
        for id in n4.pieces { XCTAssertTrue(p.cards.contains(id), "portal piece from the portal set") }
        let n20 = tally(p.nodes[19], false)
        XCTAssertEqual(n20.tokens, ["portalHigh:the-dark-beyond"])
        let n25first = tally(p.nodes[24], true)
        XCTAssertEqual(n25first.c[.token], N, "node 25 first win is always the high token")
        XCTAssertEqual(n25first.tokens, ["portalHigh:the-dark-beyond"])
        let n25again = tally(p.nodes[24], false)
        XCTAssertTrue(Fx.within(Double(n25again.c[.token] ?? 0) / Double(N), 0.25, 0.025), "replays roll normally")
    }

    func testBossFightWinAndLoss() throws {
        let base = Fx.rich(Fx.freshReal()) { $0.level = 10; $0.xp = 0 }
        func clear(_ s0: GameState, _ d: Deps) throws -> GameState {
            var s = try QuestOps.startQuest(s0, deps: d, now: Fx.T0, line: "main", n: 1).state
            while !s.quests.active!.bossReady { s = try QuestOps.tapMinion(s, deps: d, now: Fx.T0, event: nil).state }
            return s
        }
        let dw = Fx.deps(.attacker)
        let ready = try clear(base, dw.deps)
        let pb = try QuestOps.prepareBoss(ready, deps: dw.deps, now: Fx.T0)
        XCTAssertEqual(pb.lineup.boss.cardId, "throat-cutter")
        let stored = pb.state
        XCTAssertEqual(try QuestOps.prepareBoss(stored, deps: dw.deps, now: Fx.T0).lineup, stored.quests.active!.boss, "line-up is stored once")
        XCTAssertEqual(try QuestOps.prepareBoss(stored, deps: dw.deps, now: Fx.T0).state, stored)
        let win = try QuestOps.fightBoss(pb.state, deps: dw.deps, now: Fx.T0, event: nil)
        XCTAssertTrue(win.info.won)
        XCTAssertEqual(win.info.unlocked, 2)
        XCTAssertTrue(win.info.firstWin)
        XCTAssertEqual(win.state.quests.main.unlocked, 2)
        XCTAssertEqual(win.state.quests.main.done, 1)
        XCTAssertEqual(win.state.quests.main.firstWins, [1])
        XCTAssertEqual(win.state.player.questsDone, 1)
        XCTAssertNil(win.state.quests.active)
        XCTAssertEqual(win.info.playerXp, 0, "boss fights give no player xp")
        let enemyMana = pb.lineup.cards.compactMap { $0 }.reduce(0) { $0 + Fx.db.get($1.cardId)!.mana }
        XCTAssertEqual(win.info.cardXp, PlayerOps.cardFightXp(enemyDeckMana: enemyMana, won: true, infiniteWisdom: false))
        XCTAssertEqual(win.info.reward?.type, .card); XCTAssertEqual(win.info.reward?.cardId, "throat-cutter"); XCTAssertEqual(win.info.reward?.soul, true)
        XCTAssertEqual(win.state.player.xp, pb.state.player.xp + win.info.playerXp)
        XCTAssertEqual(dw.engine.calls.count, 1)
        XCTAssertEqual(dw.engine.calls[0].defender.player.maxHp, 250)
        XCTAssertEqual(dw.engine.calls[0].attacker.player.maxHp, base.player.hpMax)
        let wis = try QuestOps.fightBoss(pb.state, deps: dw.deps, now: Fx.T0, event: .infiniteWisdom)
        XCTAssertEqual(wis.info.cardXp, PlayerOps.cardFightXp(enemyDeckMana: enemyMana, won: true, infiniteWisdom: true))
        var rs = try QuestOps.startQuest(win.state, deps: dw.deps, now: Fx.T0, line: "main", n: 1).state
        while !rs.quests.active!.bossReady { rs = try QuestOps.tapMinion(rs, deps: dw.deps, now: Fx.T0, event: nil).state }
        let again = try QuestOps.fightBoss(rs, deps: dw.deps, now: Fx.T0, event: nil)
        XCTAssertFalse(again.info.firstWin)
        XCTAssertNil(again.info.unlocked)
        XCTAssertEqual(again.state.quests.main.done, 1)
        XCTAssertEqual(again.state.player.questsDone, 1)
        XCTAssertEqual(again.state.quests.main.unlocked, 2)
        XCTAssertFalse(again.info.reward?.cardId == "throat-cutter" && again.info.reward?.soul == true, "the soul card only on the first win")
        // the quest-2 boss opens the third deck slot; the last portal quest pays 1000 gold
        var q2 = Fx.withPlayer(win.state) { $0.deckSlots = 2 }
        q2.quests.active = nil
        var s2 = try QuestOps.startQuest(q2, deps: dw.deps, now: Fx.T0, line: "main", n: 2).state
        while !s2.quests.active!.bossReady { s2 = try QuestOps.tapMinion(s2, deps: dw.deps, now: Fx.T0, event: nil).state }
        let w2 = try QuestOps.fightBoss(s2, deps: dw.deps, now: Fx.T0, event: nil)
        XCTAssertEqual(w2.info.deckSlots, 3)
        XCTAssertEqual(StateOps.deckSlotCount(w2.state), 3)
        var p25 = Fx.rich(Fx.freshReal())
        p25.quests.portals = ["dying-dreams": LineProgress(unlocked: 25, done: 24, firstWins: [])]
        var sp = try QuestOps.startQuest(p25, deps: dw.deps, now: Fx.T0, line: "dying-dreams", n: 25).state
        while !sp.quests.active!.bossReady { sp = try QuestOps.tapMinion(sp, deps: dw.deps, now: Fx.T0, event: nil).state }
        let wp = try QuestOps.fightBoss(sp, deps: dw.deps, now: Fx.T0, event: nil)
        XCTAssertEqual(wp.info.bonusGold, 1000)
        XCTAssertEqual(wp.state.player.gold, sp.player.gold + 1000)
        // loss
        let dl = Fx.deps(.defender)
        let readyL = try clear(base, dl.deps)
        let loss = try QuestOps.fightBoss(readyL, deps: dl.deps, now: Fx.T0, event: nil)
        XCTAssertFalse(loss.info.won)
        XCTAssertNil(loss.info.reward)
        XCTAssertEqual(loss.state.quests.main.unlocked, 1)
        XCTAssertEqual(loss.state.player.questsDone, 0)
        XCTAssertFalse(loss.state.quests.active!.bossReady)
        XCTAssertEqual(loss.state.quests.active!.figuresDone, 0)
        XCTAssertEqual(loss.state.quests.active!.waveIndex, 0)
        XCTAssertNil(loss.state.quests.active!.boss)
        XCTAssertEqual(QuestOps.questProgressPct(loss.state.quests.active), 0)
        XCTAssertEqual(loss.info.playerXp, 0)
        let lossMana = loss.info.lineup!.cards.compactMap { $0 }.reduce(0) { $0 + Fx.db.get($1.cardId)!.mana }
        XCTAssertEqual(loss.info.cardXp, PlayerOps.cardFightXp(enemyDeckMana: lossMana, won: false, infiniteWisdom: false))
        XCTAssertNil(QuestOps.guideLine(loss.state, lastLoss: true))
        var empty = readyL
        empty.deck = [nil, nil, nil, nil, nil]
        assertThrows(try QuestOps.fightBoss(empty, deps: dl.deps, now: Fx.T0, event: nil), "empty")
    }

    func testGuideLinesNeedATutorialRecord() {
        XCTAssertNil(QuestOps.guideLine(Fx.freshReal()))
        var tut = Fx.tutorialStart()
        tut.tutorial.r3 = TutorialRecord(intro: true, lost: [], seen: [], named: false, done: false)
        XCTAssertEqual(QuestOps.guideLine(tut), QuestOps.GuideLines.follow)
        tut.quests.main.firstWins = [1]
        XCTAssertEqual(QuestOps.guideLine(tut), QuestOps.GuideLines.afterHim)
        XCTAssertEqual(QuestOps.guideLine(tut, lastLoss: true), QuestOps.GuideLines.tough)
        tut.quests.main.firstWins = [1, 2, 3, 4, 5]
        XCTAssertEqual(QuestOps.guideLine(tut), QuestOps.GuideLines.rune)
        tut.quests.main.firstWins = [1, 2, 3, 4, 5, 6, 7, 8]
        XCTAssertEqual(QuestOps.guideLine(tut), QuestOps.GuideLines.finishClubSwinger)
    }

    func testMapNodesAndQuestStatus() {
        let d = Fx.deps().deps
        let s = Fx.withMain(Fx.freshReal(), unlocked: 5, done: 4, firstWins: [1, 2, 3, 4])
        let nodes = QuestOps.mapNodes(s, deps: d, lineId: "main")
        XCTAssertEqual(nodes.count, 100)
        XCTAssertEqual(nodes.prefix(6).map { $0.status }, [.done, .done, .done, .done, .current, .locked])
        XCTAssertEqual(QuestOps.mapNodes(s, deps: d, lineId: "the-dark-beyond").count, 25)
        XCTAssertNil(QuestOps.getQuest(deps: d, lineId: "main", n: 101))
        assertThrows(try QuestOps.startQuest(s, deps: d, now: Fx.T0, line: "main", n: 101), "No such quest")
    }
}

/// An rng whose `next()` always returns the same value (the web tests' `{ next: () => 0.05 }`).
final class FixedRng: RandomSource {
    let value: Double
    let seed: UInt32 = 0
    init(_ value: Double) { self.value = value }
    func next() -> Double { value }
    func int(_ n: Int) -> Int { n > 0 ? JSMath.floorInt(value * Double(n)) : 0 }
    func pick<T>(_ arr: [T]) -> T? { arr.isEmpty ? nil : arr[JSMath.floorInt(value * Double(arr.count))] }
    func chance(_ p: Double) -> Bool { value < p }
}
