import Foundation
import XCTest
@testable import EvokerCore

/// Port of the pure part of `tests/battle-player.test.js`: the timeline builder `fromEvents`, `stepDuration` scaling,
/// the tribe-bonus moment and the board model (`final` is what "Skip fight" jumps to), on real event logs produced by
/// the engine with the fixture cards. The sprite / sound / colour tests of that file belong to the app.
final class TimelineTests: XCTestCase {
    typealias F = EngineFx

    /// Sum of the step durations of a timeline (ms).
    func total(_ steps: [PlaybackStep]) -> Int { steps.reduce(0) { $0 + $1.durationMs } }

    /// A fight with attacks, heals, statuses, buffs, deaths and a revive.
    func richFight() -> Fight {
        F.fight([F.card("Argonaut"), F.card("Dwarf King"), F.card("Phoenix"), F.card("Siren"), F.vanilla("Brute", 400, 300)],
                [F.vanilla("Grunt", 250, 500), F.card("Anvil Guard"), F.vanilla("Slayer", 900, 400), F.card("Lava Toad"), nil],
                seed: 7, aHp: 1500, dHp: 1500)
    }

    let emptySnapshot = SideSnapshot(player: PlayerSnapshot(name: "", hp: 0, maxHp: 0), cards: [])
    var emptyStart: BattleEvent { .battleStart(seed: 0, attacker: emptySnapshot, defender: emptySnapshot) }

    func hits(_ step: PlaybackStep) -> [BattleEvent] {
        if case .attack(_, _, _, _, let hits) = step.payload { return hits }
        return []
    }
    func targets(_ step: PlaybackStep) -> [AttackTarget] {
        if case .attack(_, _, _, let targets, _) = step.payload { return targets }
        return []
    }

    // MARK: fromEvents

    func testKeepsTheEventOrder() {
        let events = richFight().events
        let steps = Timeline.fromEvents(events, speed: 1)
        XCTAssertEqual(steps.first?.kind, .start)
        XCTAssertEqual(steps.last?.kind, .end)
        let rounds: [Int] = steps.compactMap { if case .round(let r) = $0.payload { return r } else { return nil } }
        XCTAssertEqual(rounds, rounds.indices.map { $0 + 1 })
        let ends: [Int] = steps.compactMap { if case .roundEnd(let r, _, _) = $0.payload { return r } else { return nil } }
        XCTAssertEqual(ends, rounds)
        // every step carries the raw events it covers, and the flattened steps reproduce the log exactly
        let flat = steps.flatMap { $0.events }
        XCTAssertEqual(flat.count, events.count)
        XCTAssertEqual(flat, events)
        // a round banner always precedes the first action of that round and the roundEnd follows it
        for i in 1..<steps.count {
            if case .roundEnd(let r, _, _) = steps[i].payload {
                let prevRound: Int? = steps[0..<i].reversed().compactMap { if case .round(let n) = $0.payload { return n } else { return nil } }.first
                XCTAssertEqual(prevRound, r)
            }
        }
    }

    func testFoldsAttackDamageAndGroupsHealsDeathsAndAbilityDamage() {
        let events = richFight().events
        let steps = Timeline.fromEvents(events, speed: 1)
        let attacks = steps.filter { $0.kind == .attack }
        XCTAssertFalse(attacks.isEmpty)
        for a in attacks {
            for hit in hits(a) { XCTAssertTrue([DamageCause.attack, .reflect].contains(hit.cause!)) }
            // the damage dealt by the attack is the damage recorded on its targets
            let dealt = hits(a).filter { $0.cause == .attack }.reduce(0) { $0 + $1.amount! }
            let expected = targets(a).reduce(0) { $0 + ($1.blocked ? 0 : $1.damage) }
            XCTAssertEqual(dealt, expected)
        }
        // no bare 'damage' step is an attack hit (those belong to attack steps)
        for d in steps.filter({ $0.kind == .damage }) {
            if case .damage(let cause, _, _) = d.payload { XCTAssertNotEqual(cause, .attack) }
        }
        let heals = steps.filter { $0.kind == .heal }
        XCTAssertFalse(heals.isEmpty, "Argonaut heals its neighbours")
        for hl in heals {
            if case .heal(_, let list) = hl.payload { for e in list { XCTAssertEqual(e.type, "heal") } }
        }
        let statuses: [CardStatus] = steps.compactMap { if case .status(_, _, let s, _, _) = $0.payload { return s } else { return nil } }
        XCTAssertTrue(statuses.contains(.stunned), "Siren stuns the card opposite")
        XCTAssertTrue(statuses.contains(.indestructible), "Anvil Guard is indestructible in round 1")
        let buffStats: [BuffStat] = steps.compactMap { if case .buff(_, _, let s, _, _, _) = $0.payload { return s } else { return nil } }
        XCTAssertTrue(buffStats.contains(.attack), "Dwarf King strengthens its neighbours")
        let deaths = steps.filter { $0.kind == .death }
        XCTAssertFalse(deaths.isEmpty)
        for d in deaths {
            guard case .death(let list) = d.payload else { return XCTFail("death payload") }
            XCTAssertTrue(list.count >= 1 && list.allSatisfy { $0.type == "death" })
        }
    }

    func testReviveProducesAReviveStepAfterThePhoenixDies() {
        let events = F.fight([F.card("Phoenix")], [F.vanilla("Slayer", 2000, 5000)], seed: 1).events
        let steps = Timeline.fromEvents(events)
        guard let i = steps.firstIndex(where: { $0.kind == .revive }) else { return XCTFail("has a revive step") }
        XCTAssertGreaterThan(i, 0)
        guard case .revive(let side, let slot, let hp, _) = steps[i].payload else { return XCTFail("revive payload") }
        XCTAssertEqual(side, .attacker)
        XCTAssertEqual(slot, 0)
        XCTAssertEqual(hp, 480)
        // the death that triggers the revive happens later (phoenix comes back at full hp, then dies for good)
        XCTAssertNotNil(steps[i...].first { $0.kind == .death })
    }

    func testEmptyInputYieldsNoStepsAndOtherEventsBecomeMiscSteps() {
        XCTAssertEqual(Timeline.fromEvents([]), [])
        let steps = Timeline.fromEvents([emptyStart, .gamble(side: .attacker, slot: 0, failed: true, source: nil)])
        XCTAssertEqual(steps[1].kind, .misc)
        XCTAssertEqual(steps[1].durationMs, StepTiming.stepMs[.misc])
    }

    // MARK: reflect ordering

    var hit: BattleEvent { .damage(side: .defender, slot: 0, amount: 2000, hp: -920, cause: .attack, blocked: false, source: EventSource(side: .attacker, slot: 0, effect: "attack")) }
    var death: BattleEvent { .death(side: .defender, slot: 0, card: CardSnapshot(name: "Lookalike", attack: 0, hp: -920, maxHp: 1080)) }
    var bounce: BattleEvent { .damage(side: .attacker, slot: 0, amount: 2000, hp: 3000, cause: .reflect, blocked: false, source: EventSource(side: .defender, slot: 0, effect: "reflect_damage")) }
    var attackEv: BattleEvent { .attack(side: .attacker, slot: 0, attack: 2000, bonus: false, targets: [AttackTarget(side: .defender, slot: 0, damage: 2000, blocked: false, dir: "front")]) }
    var roundEnd1: BattleEvent { .roundEnd(round: 1, attackerHp: 1500, defenderHp: 1500, cards: RoundHpSnapshot(attacker: [], defender: [])) }

    func testADeathLoggedBeforeTheReflectDamageIsMovedAfterIt() {
        let out = Timeline.orderDeathsAfterReflects([emptyStart, attackEv, hit, death, bounce, roundEnd1])
        XCTAssertEqual(out.map { $0.type + ($0.cause.map { ":" + $0.rawValue } ?? "") }, ["battleStart", "attack", "damage:attack", "damage:reflect", "death", "roundEnd"])
    }

    func testTheBounceJoinsTheAttackStepAndTheDeathStepFollows() {
        let steps = Timeline.fromEvents([emptyStart, .roundStart(round: 1, attackerHp: 1500, defenderHp: 1500), attackEv, hit, death, bounce, roundEnd1])
        XCTAssertEqual(steps.map { $0.kind }, [.start, .round, .attack, .death, .roundEnd])
        XCTAssertEqual(hits(steps[2]).map { $0.cause! }, [.attack, .reflect])
        guard case .death(let deaths) = steps[3].payload else { return XCTFail("death payload") }
        XCTAssertEqual(deaths[0].slot, 0)
    }

    func testDeathsNotFollowedByTheirOwnReflectsAreLeftAlone() {
        let other: BattleEvent = .damage(side: .attacker, slot: 0, amount: 2000, hp: 3000, cause: .reflect, blocked: false, source: EventSource(side: .defender, slot: 1, effect: "reflect_damage"))
        let list = [emptyStart, attackEv, hit, death, other]
        XCTAssertEqual(Timeline.orderDeathsAfterReflects(list), list)
        let plain = [emptyStart, attackEv, hit, death, roundEnd1]
        XCTAssertEqual(Timeline.orderDeathsAfterReflects(plain), plain)
    }

    func testTheRealEngineLogPlaysTheBounceBeforeTheDissolve() {
        let events = F.fight([F.vanilla("Hitter", 2000, 5000)], [F.card("Lookalike")], maxRounds: 1).events
        let steps = Timeline.fromEvents(events)
        let attackIdx = steps.firstIndex { $0.kind == .attack && hits($0).contains { $0.cause == .reflect } } ?? -1
        let deathIdx = steps.firstIndex { $0.kind == .death } ?? -1
        XCTAssertTrue(attackIdx >= 0 && deathIdx > attackIdx, "attack step \(attackIdx) must come before the death step \(deathIdx)")
    }

    // MARK: durations

    func testEveryStepHasAPositiveDurationFromStepMs() {
        let events = richFight().events
        for s in Timeline.fromEvents(events, speed: 1) {
            XCTAssertGreaterThan(s.durationMs, 0)
            let f = s.factor ?? 1
            if s.kind == .attack && (!targets(s).isEmpty || !hits(s).isEmpty) { XCTAssertEqual(s.durationMs, JSMath.roundInt(Double(StepTiming.stepMs[.attack]!) * f)) }
            if s.kind == .round { XCTAssertEqual(s.durationMs, JSMath.roundInt(Double(StepTiming.stepMs[.round]!) * f)) }
            if s.kind == .heal { XCTAssertEqual(s.durationMs, JSMath.roundInt(Double(StepTiming.stepMs[.heal]!) * f)) }
        }
    }

    func testDurationsScaleInverselyWithSpeed() {
        let events = richFight().events
        let s1 = Timeline.fromEvents(events, speed: 1)
        let s2 = Timeline.fromEvents(events, speed: 2)
        XCTAssertEqual(s1.count, s2.count)
        for (i, s) in s1.enumerated() {
            XCTAssertEqual(s2[i].kind, s.kind)
            XCTAssertEqual(s2[i].durationMs, Swift.max(1, JSMath.roundInt(Double(s.durationMs) / 2)))
            XCTAssertLessThanOrEqual(s2[i].durationMs, s.durationMs)
        }
        let t1 = total(s1)
        let t2 = total(s2)
        XCTAssertGreaterThan(t1, 0)
        XCTAssertLessThanOrEqual(abs(t2 - t1 / 2), s1.count, "2x total \(t2) ~ half of \(t1)")
    }

    func testStepDurationToleratesBadSpeedsAndHonoursABase() {
        XCTAssertEqual(Timeline.stepDuration(kind: .heal, baseMs: nil, factor: nil, speed: 0), StepTiming.stepMs[.heal])
        XCTAssertEqual(Timeline.stepDuration(kind: .heal, baseMs: nil, factor: nil, speed: -3), StepTiming.stepMs[.heal])
        XCTAssertEqual(Timeline.stepDuration(kind: .heal, baseMs: nil, factor: nil, speed: .nan), StepTiming.stepMs[.heal])
        XCTAssertEqual(Timeline.stepDuration(kind: .attack, baseMs: 200, factor: nil, speed: 2), 100)
        XCTAssertEqual(Timeline.stepDuration(kind: .misc, baseMs: nil, factor: nil, speed: 1), StepTiming.stepMs[.misc])
        XCTAssertEqual(Timeline.stepDuration(kind: .round, baseMs: nil, factor: nil, speed: 1_000_000), 1)
    }

    // MARK: pacing at 1x = the original client

    func testRound1FollowsTheServerSampleLaterRoundsRunFaster() {
        XCTAssertEqual(StepTiming.stepMs[.attack], 1500)
        XCTAssertEqual(Timeline.roundFactor(1), 1)
        XCTAssertEqual(Timeline.roundFactor(2), 0.9)
        XCTAssertLessThan(abs(Timeline.roundFactor(3) - 0.81), 1e-9)
        XCTAssertEqual(Timeline.roundFactor(40), 0.3, "floored")
        let events = F.fight([F.vanilla("Grunt", 100, 100000)], [nil], seed: 4, aHp: 1500, dHp: 100000, maxRounds: 12).events
        let steps = Timeline.fromEvents(events, speed: 1)
        let attacks = steps.filter { $0.kind == .attack }
        XCTAssertEqual(attacks[0].durationMs, 1500)
        XCTAssertEqual(attacks[1].durationMs, 1350)
        // rounds 3 -> 11 of a lone attacker take about 6-8 s (video: ~6 s)
        var t = 0
        var inRange = false
        for s in steps {
            if case .round(let r) = s.payload {
                if r == 3 { inRange = true }
                if r == 11 { break }
            }
            if inRange { t += s.durationMs }
        }
        XCTAssertTrue(t >= 5500 && t <= 8000, "rounds 3-11 in \(t) ms")
    }

    func testA5v5FightOfTwoRoundsLasts25To35Seconds() {
        let f = F.fight((1...5).map { F.vanilla("A\($0)", 500 + $0 * 10, 700) }, (1...5).map { F.vanilla("D\($0)", 500 - $0 * 10, 750) }, seed: 11, aHp: 1500, dHp: 1500)
        let t1 = total(Timeline.fromEvents(f.events, speed: 1))
        let rounds = f.result.rounds
        XCTAssertTrue(rounds >= 2 && rounds <= 3 && t1 >= 25000 && t1 <= 35000, "5v5 fight \(t1) ms in \(rounds) rounds")
        XCTAssertLessThanOrEqual(total(Timeline.fromEvents(f.events, speed: 2)), t1 / 2 + 50)
    }

    // MARK: tribe bonus moment

    func testASideWithTheBonusCountsUpFromItsBaseHp() {
        let start: BattleEvent = .battleStart(seed: 1,
            attacker: SideSnapshot(player: PlayerSnapshot(name: "A", hp: 1800, maxHp: 1800, baseMaxHp: 1500, tribeBonus: true),
                                   cards: [CardSnapshot(tribe: .orc, attack: 0, hp: 1, maxHp: 1), CardSnapshot(tribe: .orc, attack: 0, hp: 1, maxHp: 1), CardSnapshot(tribe: .neutral, attack: 0, hp: 1, maxHp: 1)]),
            defender: SideSnapshot(player: PlayerSnapshot(name: "D", hp: 960, maxHp: 960, tribeBonus: true), cards: [CardSnapshot(tribe: .elf, attack: 0, hp: 1, maxHp: 1)]))
        let b = Timeline.tribeBonuses(start)
        XCTAssertEqual(b, [TribeBonusMoment(side: .attacker, from: 1500, to: 1800, tribe: .orc), TribeBonusMoment(side: .defender, from: 800, to: 960, tribe: .elf)])
        let steps = Timeline.fromEvents([start])
        XCTAssertEqual(steps[0].kind, .start)
        XCTAssertEqual(steps[0].durationMs, StepTiming.stepMs[.bonus])
        let none: BattleEvent = .battleStart(seed: 1, attacker: SideSnapshot(player: PlayerSnapshot(name: "A", hp: 1500, maxHp: 1500, tribeBonus: false), cards: []), defender: emptySnapshot)
        XCTAssertEqual(Timeline.tribeBonuses(none), [])
        XCTAssertEqual(Timeline.fromEvents([emptyStart])[0].durationMs, StepTiming.stepMs[.start])
    }

    func testARealFightBuiltWithBuildSideReportsTheBonus() {
        let events = F.fight([F.vanilla("O1", 100, 100, [.direct], "orc"), F.vanilla("O2", 100, 100, [.direct], "orc")], [F.vanilla("N", 100, 100)],
                             seed: 1, aHp: 1500, dHp: 1000, maxRounds: 1, tribeBonus: true).events
        XCTAssertEqual(Timeline.tribeBonuses(events[0]), [TribeBonusMoment(side: .attacker, from: 1500, to: 1800, tribe: .orc)], "the all-neutral defender gets nothing")
        XCTAssertEqual(events[0].attackerSnapshot?.player.maxHp, 1800)
    }

    // MARK: final state (skip summary)

    func testPlayerHpAndWinnerEqualTheBattleEndAndTheResult() {
        let f = richFight()
        let final = BoardModel.final(events: f.events)
        let end = f.events.last!
        XCTAssertEqual(end.type, "battleEnd")
        XCTAssertEqual(final.winner, f.result.winner)
        XCTAssertEqual(final.rounds, f.result.rounds)
        XCTAssertEqual(final.attacker.player.hp, end.attackerHp)
        XCTAssertEqual(final.defender.player.hp, end.defenderHp)
        let lastRoundEnd = f.events.filter { $0.type == "roundEnd" }.last!
        XCTAssertEqual(final.attacker.player.hp, lastRoundEnd.attackerHp)
        XCTAssertEqual(final.defender.player.hp, lastRoundEnd.defenderHp)
        XCTAssertEqual(final.attacker.player.hp, f.result.attackerHp)
        XCTAssertEqual(final.defender.player.hp, f.result.defenderHp)
        XCTAssertTrue(final.ended)
    }

    func testCardHpMatchesTheLastDamageOrHealAndDeadSlotsMatchDeathsMinusRevives() {
        let f = richFight()
        let final = BoardModel.final(events: f.events)
        for side in [Side.attacker, .defender] {
            for slot in 0..<5 {
                let m = final[side].cards[slot]
                let start = f.events[0].snapshot(side)!.cards[slot]
                guard let start else { XCTAssertNil(m); continue }
                let last = f.events.filter { ["damage", "heal", "revive"].contains($0.type) && $0.side == side && $0.slot == slot }.last
                if let last { XCTAssertEqual(m?.hp, last.hp) } else { XCTAssertEqual(m?.hp, start.hp) }
                let died = f.events.filter { $0.type == "death" && $0.side == side && $0.slot == slot }.count
                let revived = f.events.filter { $0.type == "revive" && $0.side == side && $0.slot == slot }.count
                XCTAssertEqual(m?.dead, died > revived)
            }
        }
        XCTAssertEqual(final.deaths.attacker, f.result.deaths.attacker)
        XCTAssertEqual(final.deaths.defender, f.result.deaths.defender)
    }

    func testAPhoenixThatRevivedOnceIsAliveUntilItDiesAgain() {
        let f = F.fight([F.card("Phoenix")], [F.vanilla("Weakling", 300, 100000)], seed: 2, maxRounds: 3)
        let revives = f.events.filter { $0.type == "revive" }.count
        let deaths = f.events.filter { $0.type == "death" && $0.side == .attacker }.count
        XCTAssertEqual(revives, 1)
        let final = BoardModel.final(events: f.events)
        XCTAssertEqual(final.attacker.cards[0]?.dead, deaths > revives)
        XCTAssertEqual(final.attacker.cards[0]?.hp, f.events.filter { ["damage", "heal", "revive"].contains($0.type) && $0.side == .attacker && $0.slot == 0 }.last?.hp)
    }

    func testMaxHpBuffsRaiseTheModelAndPermanentAttackBuffsStick() {
        let f = F.fight([F.card("Arch Angel"), F.card("War Tattooist"), F.card("Pikeman")], [F.wall(), F.wall(), F.wall()], seed: 3, maxRounds: 2)
        let final = BoardModel.final(events: f.events)
        let start = f.events[0].attackerSnapshot!.cards
        // Arch Angel: +200 max hp to each neighbour (400 split)
        XCTAssertEqual(final.attacker.cards[1]?.maxHp, start[1]!.maxHp + 200)
        // War Tattooist: +500 attack per round to the card on its right, cumulative over 2 rounds
        XCTAssertEqual(final.attacker.cards[2]?.attack, start[2]!.attack + 1000)
        XCTAssertEqual(final.attacker.cards[0]?.dead, false)
    }

    func testReduceFoldsStepByStepToTheSameResultAsFinal() {
        let f = richFight()
        var model = BoardModel.initial(events: f.events)
        for step in Timeline.fromEvents(f.events) { for ev in step.events { model.reduce(ev) } }
        XCTAssertEqual(model, BoardModel.final(events: f.events))
    }

    func testTheModelCarriesEachCardsTribe() {
        let events = F.fight([F.vanilla("Grunt", 250, 500, [.direct], "orc"), F.card("Argonaut")], [F.vanilla("Slayer", 900, 400, [.direct], "elf")], seed: 7, maxRounds: 1).events
        let model = BoardModel.initial(events: events)
        XCTAssertEqual(model.attacker.cards[0]?.tribe, .orc)
        XCTAssertEqual(model.defender.cards[0]?.tribe, .elf)
        XCTAssertNil(model.attacker.cards[2])
        let bare = BoardModel.initial(events: [.battleStart(seed: 0, attacker: SideSnapshot(player: PlayerSnapshot(name: "", hp: 0, maxHp: 0), cards: [CardSnapshot(cardId: "x", attack: 1, hp: 1, maxHp: 1)]), defender: emptySnapshot)])
        XCTAssertEqual(bare.attacker.cards[0]?.tribe, .neutral)
    }

    func testLethalStepFindsTheStepThatDropsALoserToZero() {
        let f = F.fight([F.hitter(1000)], [], dHp: 1500)
        let steps = Timeline.fromEvents(f.events)
        let i = Timeline.lethalStep(f.events, steps: steps)
        XCTAssertTrue(i >= 0 && i < steps.count)
        XCTAssertEqual(steps[i].kind, .attack)
        var scratch = BoardModel.initial(events: f.events)
        for s in steps[0...i] { for ev in s.events { scratch.reduce(ev) } }
        XCTAssertLessThanOrEqual(scratch.defender.player.hp, 0)
        // a fight on the round limit has no lethal step
        XCTAssertEqual(Timeline.lethalStep(F.fight([F.hitter(1)], [F.hitter(1)], maxRounds: 2).events), -1)
        XCTAssertEqual(Timeline.countdownValue(from: 1000, to: 0, k: 0), 1000)
        XCTAssertEqual(Timeline.countdownValue(from: 1000, to: 0, k: 0.5), 750)
        XCTAssertEqual(Timeline.countdownValue(from: 1000, to: -40, k: 1), -40)
        XCTAssertEqual(Timeline.countdownValue(from: 1000, to: 0, k: 7), 0)
    }

    // MARK: battle model: per-round attack boosts and overkill

    var modelStart: BattleEvent {
        .battleStart(seed: 1,
            attacker: SideSnapshot(player: PlayerSnapshot(name: "A", hp: 1000, maxHp: 1000), cards: [CardSnapshot(cardId: "x", name: "X", attack: 500, hp: 300, maxHp: 300), nil, nil, nil, nil]),
            defender: SideSnapshot(player: PlayerSnapshot(name: "D", hp: 1000, maxHp: 1000), cards: [nil, nil, nil, nil, nil]))
    }

    func testAPerRoundAttackBoostDropsBackAtTheNextRound() {
        var m = BoardModel.initial(events: [modelStart])
        m.reduce(.roundStart(round: 1, attackerHp: 1000, defenderHp: 1000))
        m.reduce(.buff(side: .attacker, slot: 0, stat: .attack, delta: 200, permanent: false, source: nil))
        XCTAssertEqual(m.attacker.cards[0]?.attack, 700)
        m.reduce(.roundStart(round: 2, attackerHp: 1000, defenderHp: 1000))
        XCTAssertEqual(m.attacker.cards[0]?.attack, 500)
        m.reduce(.buff(side: .attacker, slot: 0, stat: .attack, delta: 100, permanent: true, source: nil))
        m.reduce(.roundStart(round: 3, attackerHp: 1000, defenderHp: 1000))
        XCTAssertEqual(m.attacker.cards[0]?.attack, 600, "permanent boosts stay")
    }

    func testCardHpMayGoBelowZero() {
        var m = BoardModel.initial(events: [modelStart])
        m.reduce(.damage(side: .attacker, slot: 0, amount: 450, hp: -150, cause: .attack, blocked: false, source: nil))
        XCTAssertEqual(m.attacker.cards[0]?.hp, -150)
    }
}
