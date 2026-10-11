import Foundation
import XCTest
@testable import EvokerCore

/// Port of `tests/battle.test.js` (every group except the original-client replay, which GoldenBattleTests covers):
/// the engine against the ORIGINAL simulator rules (original-engine.md) and the extensions of ability-encoding.md
/// §3. Expected numbers are computed by hand from the spec, never from the engine.
final class EngineTests: XCTestCase {
    typealias F = EngineFx
    let big = EngineFx.big

    func sum(_ list: [BattleEvent]) -> Int { list.reduce(0) { $0 + ($1.amount ?? 0) } }
    func dmgDesc(_ e: BattleEvent) -> String { "\(e.who) \(e.amount ?? -1) \(e.hp ?? -1)" }
    func statusDesc(_ e: BattleEvent) -> String { "\(e.who) \(e.status?.rawValue ?? "?")" }
    func buffDesc(_ e: BattleEvent) -> String { "\(e.who) \(e.stat?.rawValue ?? "?") \(e.delta ?? 0)\(e.permanent == true ? " permanent" : "")" }
    func playerBuffs(_ events: [BattleEvent]) -> [BattleEvent] { events.filter { $0.type == "buff" && $0.slot == nil } }

    // MARK: race (tribe) bonus

    func testRaceBonusRule() {
        func t(_ s: String) -> Tribe? { Tribe(lenient: s) }
        XCTAssertTrue(TribeBonus.hasTribeBonus([t("orc"), t("orc"), t("orc"), t("orc"), t("orc")]))
        XCTAssertTrue(TribeBonus.hasTribeBonus([t("orc"), t("orc"), t("orc"), t("orc"), t("neutral")]))
        XCTAssertTrue(TribeBonus.hasTribeBonus([t("orc"), t("orc"), t("orc"), t("neutral"), t("neutral")]))
        XCTAssertFalse(TribeBonus.hasTribeBonus([t("orc"), t("orc"), t("neutral"), t("neutral"), t("neutral")]))
        XCTAssertFalse(TribeBonus.hasTribeBonus([t("orc"), t("orc"), t("orc"), t("orc"), t("elf")]))
        XCTAssertFalse(TribeBonus.hasTribeBonus([t("neutral"), t("neutral"), t("neutral"), t("neutral"), t("neutral")]))
        XCTAssertTrue(TribeBonus.hasTribeBonus([nil, t("dwarf"), nil, nil, nil]))
        XCTAssertFalse(TribeBonus.hasTribeBonus([nil, t("dwarf"), t("neutral"), nil, nil]))
        XCTAssertFalse(TribeBonus.hasTribeBonus([]))
        XCTAssertEqual(TribeBonus.bonusTribe([t("elf"), t("elf"), t("neutral")]), .elf)
        XCTAssertEqual(TribeBonus.multiplier, 1.2)
        // the engine's string version counts unknown race names (the original client tests' "Orks") as their own race
        XCTAssertTrue(TribeBonus.hasTribeBonus(names: ["Orks", "Orks", "Neutral"]))
        XCTAssertEqual(TribeBonus.bonusTribeName(names: ["Orks", nil]), "orks")
    }

    func testBuildSideAppliesTheBonusAndFlagsIt() {
        let s = BattleState.buildSide(FighterPlayer(name: "x", hpMax: 2000), [.card(F.card("Dwarf King")), .card(F.card("Dwarf Judge")), .card(F.card("Argonaut")), nil, nil], options: SideOptions())
        XCTAssertEqual(s.player.tribeBonus, true)
        XCTAssertEqual(s.player.maxHp, 2400)
        XCTAssertEqual(s.player.hp, 2400)
        XCTAssertEqual(s.player.baseMaxHp, 2000)
        let n = BattleState.buildSide(FighterPlayer(name: "x", hpMax: 2000), [.card(F.card("Dwarf King")), .card(F.card("Phoenix")), .card(F.card("Siren")), nil, nil], options: SideOptions())
        XCTAssertEqual(n.player.tribeBonus, false)
        XCTAssertEqual(n.player.maxHp, 2000)
    }

    func testEngineAppliesTheBonusOnlyForRawSidesOrWhenForced() {
        func rawSide(_ cards: [BattleCard?], _ hp: Int) -> FighterSide { FighterSide(player: FighterPlayer(name: "r", hp: hp, maxHp: hp), cards: cards) }
        let engine = BattleEngine()
        let orc = F.raw("Orc", 100, big, [.direct], [], tribe: "orc")
        let out = engine.simulateBattle(BattleConfig(attacker: rawSide([orc], 1000), defender: rawSide([], 1000), seed: 1))
        XCTAssertEqual(playerBuffs(out.events).map(buffDesc), ["attackerplayer maxHp 200"])
        XCTAssertEqual(out.events.first { $0.type == "roundEnd" }?.attackerHp, 1200)
        XCTAssertEqual(out.result.rounds, 10) // 1000 / 100 per round until the defender is at 0
        XCTAssertEqual(out.result.winner, .attacker)
        XCTAssertEqual(out.result.endedBy, .playerHp)
        // mixed line-ups earn nothing
        let mixed = engine.simulateBattle(BattleConfig(attacker: rawSide([orc, F.raw("N", 0, big, [], [], tribe: "neutral")], 1000), defender: rawSide([], 1000), seed: 1))
        XCTAssertEqual(playerBuffs(mixed.events).count, 0)
        let two = engine.simulateBattle(BattleConfig(attacker: rawSide([orc, F.raw("E", 0, big, [], [], tribe: "elf")], 1000), defender: rawSide([], 1000), seed: 1))
        XCTAssertEqual(playerBuffs(two.events).count, 0)
        // buildSide already applied it: the engine does not double it
        let built = F.side([orc], tribeBonus: true)
        XCTAssertEqual(built.player.maxHp, 1800)
        let out2 = engine.simulateBattle(BattleConfig(attacker: built, defender: F.side([]), seed: 1))
        XCTAssertEqual(playerBuffs(out2.events).count, 0)
        XCTAssertEqual(out2.events.first { $0.type == "roundEnd" }?.attackerHp, 1800)
        // forced off
        let off = engine.simulateBattle(BattleConfig(attacker: rawSide([orc], 1000), defender: rawSide([], 1000), seed: 1, options: BattleOptions(raceBonus: false)))
        XCTAssertEqual(playerBuffs(off.events).count, 0)
    }

    // MARK: battle-state

    func testToBattleCardUsesInjectedComputeStatsAndResolvesTheAbility() {
        var calls: [(Int, Int, Double)] = []
        let cs: ComputeStats = { def, stage, level, q in
            calls.append((stage, level, q))
            return F.computeStats(def, stage, level, q)
        }
        let bc = BattleState.toBattleCard(CardRef(uid: "c9", cardId: "dwarf-king", stage: 1, level: 3, evolveQuality: 0.9), F.cardDefs["dwarf-king"]!, computeStats: cs)
        XCTAssertEqual(calls.count, 1)
        XCTAssertEqual(calls[0].0, 1)
        XCTAssertEqual(calls[0].1, 3)
        XCTAssertEqual(calls[0].2, 0.9)
        XCTAssertEqual(bc.instanceId, "c9")
        XCTAssertEqual(bc.attack, JSMath.round(800 * 1.2 * 1.15 * 0.9))
        XCTAssertEqual(bc.hp, bc.maxHp)
        XCTAssertEqual(bc.dirs, [.direct])
        XCTAssertEqual(bc.ability?.buffs.first?.type, .raise_attack)
        XCTAssertEqual(bc.tribe, .dwarf)
        XCTAssertNil(bc.buffs)
    }

    func testEvolvingAbilitiesResolveByStageAndDirectionNormalisation() {
        let yeti = F.cardDefs["bog-yeti"]!.ability
        XCTAssertEqual(Abilities.abilityForStage(yeti, stage: 0)?.buffs, [])
        XCTAssertEqual(Abilities.abilityForStage(yeti, stage: 1)?.buffs.first?.type, .invulnerable)
        XCTAssertEqual(F.card("Bog Yeti", stage: 0).ability?.buffs, [])
        XCTAssertEqual(F.card("Bog Yeti", stage: 3).ability?.buffs.count, 2)
        XCTAssertEqual(BattleState.normaliseDirs(names: ["left", "direct"]), [.left, .direct])
        XCTAssertEqual(BattleState.normaliseDirs(text: "left, direct, bogus"), [.left, .direct])
        XCTAssertEqual(BattleState.normaliseDirs([.left, .left, .direct]), [.left, .direct])
    }

    func testCatalogDirectionsMapToTheOriginalNames() {
        XCTAssertEqual(BattleState.toOriginalDirs([.left, .direct, .right, .ownLeft, .ownRight]), [.frontLeft, .front, .frontRight, .left, .right])
        XCTAssertEqual(BattleState.toOriginalDirs(names: ["front", "self"]), [.front, .selfSlot])
        XCTAssertEqual(BattleState.toOriginalDirs(names: ["bogus"]), [])
    }

    func testResolveBuffsImplicitAttackOverridesAndValues() {
        XCTAssertEqual(BattleState.resolveBuffs(nil, stage: 0, abilityValue: 0, cardDirs: [.direct]), [F.b(.attack, [.front], .always)])
        XCTAssertEqual(BattleState.resolveBuffs(nil, stage: 0, abilityValue: 0, cardDirs: []), [])
        let rat = BattleState.resolveBuffs(F.cardDefs["rat-eater"]!.ability, stage: 0, abilityValue: 0, cardDirs: [.direct])
        XCTAssertEqual(rat.filter { $0.type == .attack }.count, 1)
        XCTAssertEqual(rat[0].emptyReduction, -200)
        let king = BattleState.resolveBuffs(F.cardDefs["dwarf-king"]!.ability, stage: 0, abilityValue: 1600, cardDirs: [.direct])
        XCTAssertEqual(king.map { $0.type }, [.attack, .raise_attack])
        XCTAssertEqual(king[1].strength, .number(1600))
        XCTAssertEqual(king[1].directions, [.left, .right])
        // perTarget: per-neighbour amount doubled so the handler's split gives it back
        let arg = BattleState.resolveBuffs(F.cardDefs["argonaut"]!.ability, stage: 0, abilityValue: 240, cardDirs: [.direct])
        XCTAssertEqual(arg[1].strength, .number(480))
        XCTAssertNil(arg[1].perTarget)
        // no round-mode attack buff is added when the card defines a death attack only
        let schemer = BattleState.resolveBuffs(F.cardDefs["schemer"]!.ability, stage: 0, abilityValue: 0, cardDirs: [.direct])
        XCTAssertEqual(schemer.map { $0.type }, [.attack, .bonus_attack])
    }

    func testNormaliseBuffValuePlaceholdersAndPerTarget() {
        let entry = AbilityEntry(text: "", buffs: [
            F.b(.heal, [.left, .right], .always, strength: .value, perTarget: true),
            F.b(.raise_attack, [.selfSlot], .round_eq, eventData: .round(2), strength: .negValue),
            F.b(.deal_damage_to_player, strength: .number(10)),
        ])
        let list = BattleState.resolveBuffs(entry: entry, stage: 0, abilityValue: 50, cardDirs: [.direct, .ownLeft])
        XCTAssertEqual(list[0], F.b(.attack, [.front, .left], .always))
        XCTAssertEqual(list[1].strength, .number(100))
        XCTAssertEqual(list[2].strength, .number(-50))
        XCTAssertEqual(list[2].eventData, .round(2))
        XCTAssertEqual(list[3].strength, .number(10))
        XCTAssertEqual(list[3].event, .always)
        XCTAssertEqual(list[3].directions, [])
        // `{ type: 'attack' }` without a directions key takes the card's; an explicit `[]` stays empty (battle-state.js `dirs == null`)
        XCTAssertEqual(BattleState.normaliseBuff(F.b(.attack, nil), cardDirs: [.front]).directions, [.front])
        XCTAssertEqual(BattleState.normaliseBuff(F.b(.attack, []), cardDirs: [.front]).directions, [])
        // buff directions are original names: `left` stays the own left neighbour
        XCTAssertEqual(BattleState.normaliseBuff(F.b(.heal, [.left, .left])).directions, [.left])
    }

    func testBuildSideConvertsInstancesPadsAndKeepsExplicitBuffs() {
        let s = BattleState.buildSide(FighterPlayer(name: "me", hpMax: 1500),
                                      [nil, .ref(CardRef(uid: "a", cardId: "pikeman", stage: 0, level: 2)), .card(F.raw("R", 1, 1, [.direct]))],
                                      options: SideOptions(cardsDb: F.cardsDb, computeStats: F.computeStats))
        XCTAssertEqual(s.cards.count, BattleState.slotCount)
        XCTAssertNil(s.cards[0])
        XCTAssertEqual(s.cards[1]?.cardId, "pikeman")
        XCTAssertEqual(s.cards[1]?.attack, 110)
        XCTAssertEqual(s.cards[2]?.buffs?.count, 1)
        XCTAssertNil(s.cards[4])
        XCTAssertEqual(Slug.slugify("Will-o'-the-Wisp"), "will-o-the-wisp")
    }

    func testEffectRegistryHasAHandlerAndAPhaseForEveryType() {
        for type in Phases.originalTypes + Phases.extensionTypes {
            XCTAssertTrue(Phases.list.contains { $0.type == type }, "\(type) has no phase")
            for p in Phases.list where p.type == type { XCTAssertTrue(Phases.handlerKeys.contains(p.handler), "\(type)") }
        }
        XCTAssertEqual(Phases.list.filter { !$0.ext }.map { $0.type }, [.no_buff, .raise_attack, .raise_hp, .raise_player_hp, .increment_attack, .invulnerable, .no_damage, .attack,
                                                                      .reflect_damage, .reflect_damage_to_player, .deal_damage_to_all_opponent_cards, .self_damage, .heal, .heal_player, .die, .resurrect,
                                                                      .deal_damage_to_opponent_player, .deal_damage_to_player])
        XCTAssertEqual(Phases.list.count, 28)
    }

    // MARK: engine basics

    func testDeterministicForASeedAndInputsNeverMutated() throws {
        let deck: [BattleCard?] = [F.card("Bouncer"), F.card("Wheel of Fortune"), F.card("Wizard Apprentice"), F.vanilla("A", 300, 900), F.card("Goblin Thieves")]
        let foes: [BattleCard?] = [F.vanilla("B", 250, 800), F.card("Umbral Dragon"), F.vanilla("C", 400, 700), F.card("Phoenix"), F.vanilla("D", 100, 2000)]
        let a = F.fight(deck, foes, seed: 11)
        let frozen = try Canon.text(a.cfg)
        let b = F.fight(deck, foes, seed: 11)
        XCTAssertEqual(a.events, b.events)
        XCTAssertEqual(a.result, b.result)
        XCTAssertEqual(try Canon.text(a.cfg), frozen, "cfg mutated")
        let c = F.fight(deck, foes, seed: 12)
        XCTAssertNotEqual(a.events, c.events)
    }

    func testEventLogFrame() {
        let f = F.fight([F.vanilla("A", 100, 300), nil, F.card("Pikeman")], [nil, F.vanilla("B", 50, 200)], seed: 3, maxRounds: 2)
        let start = f.events[0]
        XCTAssertEqual(start.type, "battleStart")
        XCTAssertEqual(start.seed, 3)
        let att = start.attackerSnapshot!
        XCTAssertEqual(att.player.name, "A")
        XCTAssertEqual(att.player.hp, 1500)
        XCTAssertEqual(att.player.maxHp, 1500)
        XCTAssertEqual(att.cards.count, 5)
        XCTAssertNil(att.cards[1])
        XCTAssertEqual(att.cards[0]?.cardId, "a")
        XCTAssertEqual(att.cards[0]?.hp, 300)
        XCTAssertEqual(att.cards[0]?.maxHp, 300)
        XCTAssertEqual(att.cards[0]?.attack, 100)
        XCTAssertEqual(att.cards[2]?.dirs, [.direct])
        XCTAssertEqual(start.defenderSnapshot?.cards[1]?.name, "B")
        let starts = f.of("roundStart")
        let ends = f.of("roundEnd")
        XCTAssertEqual(starts.map { $0.round }, [1, 2])
        XCTAssertEqual(ends.map { $0.round }, [1, 2])
        for e in starts + ends {
            XCTAssertNotNil(e.attackerHp)
            XCTAssertNotNil(e.defenderHp)
        }
        guard case .roundEnd(_, _, _, let cards) = ends[0] else { return XCTFail("roundEnd") }
        XCTAssertEqual(cards.attacker.count, 5)
        XCTAssertEqual(cards.defender.count, 5)
        XCTAssertEqual(f.events.last?.type, "battleEnd")
        XCTAssertEqual(f.result.rounds, 2)
        XCTAssertEqual(f.result.endedBy, .maxRounds)
    }

    func testEmptyDecks() {
        let f = F.fight([], [])
        XCTAssertEqual(f.result.rounds, 0)
        XCTAssertEqual(f.result.winner, .draw)
        XCTAssertEqual(f.result.endedBy, .noAttack)
        XCTAssertEqual(f.events.map { $0.type }, ["battleStart", "battleEnd"])
    }

    func testRoundCapAndMaxRoundsOption() {
        let f = F.fight([F.hitter(1)], [F.hitter(1)])
        XCTAssertEqual(f.result.rounds, BattleEngine.defaultMaxRounds)
        XCTAssertEqual(f.result.winner, .draw)
        XCTAssertEqual(f.result.endedBy, .maxRounds)
        XCTAssertEqual(f.of("roundStart").count, 20)
        let g = F.fight([F.hitter(1)], [F.hitter(1)], maxRounds: 3)
        XCTAssertEqual(g.result.rounds, 3)
        let h = F.fight([F.hitter(10), F.hitter(1)], [F.hitter(10)])
        XCTAssertEqual(h.result.winner, .attacker)
        XCTAssertEqual(h.result.rounds, 20)
    }

    func testResultHpMayBeNegativeAndMatchesTheLastRoundEnd() {
        let f = F.fight([F.hitter(1000)], [], dHp: 1500)
        XCTAssertEqual(f.result.rounds, 2)
        XCTAssertEqual(f.result.defenderHp, -500)
        XCTAssertEqual(f.roundEnd(2).defenderHp, -500)
        XCTAssertEqual(f.result.winner, .attacker)
    }

    // MARK: slots and directions

    func testAttackerDirectHitsTheFacingSlotLeftRightTheNeighbours() {
        let f = F.fight([F.wall(), F.wall(), F.raw("Tri", 300, big, [.left, .direct, .right]), F.wall(), F.wall()], [F.wall(), F.wall(), F.wall(), F.wall(), F.wall()], maxRounds: 1)
        let a = f.attack(1, .attacker, 2)!
        XCTAssertEqual(a.targets.map { $0.desc }, ["frontLeft defender 1 100", "front defender 2 100", "frontRight defender 3 100"])
        XCTAssertEqual(f.damages(1).map(dmgDesc), ["defender1 100 \(big - 100)", "defender2 100 \(big - 100)", "defender3 100 \(big - 100)"])
    }

    func testOffBoardDiagonalsAreNone() {
        let f = F.fight([F.raw("Tri", 300, big, [.left, .direct, .right])], [F.wall(), F.wall()], maxRounds: 1)
        let a = f.attack(1, .attacker, 0)!
        XCTAssertEqual(a.targets.map { $0.desc }, ["front defender 0 100", "frontRight defender 1 100"])
        XCTAssertEqual(f.playerDamage(.defender, 1), [])
    }

    func testDefenderRowsFaceEachOther() {
        let f = F.fight([F.wall(), F.wall(), F.wall(), F.wall(), F.wall()], [F.wall(), F.raw("Tri", 300, big, [.left, .direct, .right]), F.wall(), F.wall(), F.wall()], maxRounds: 1)
        let a = f.attack(1, .defender, 1)!
        var byDir: [String: String] = [:]
        for t in a.targets { byDir[t.dir ?? "-"] = "\(t.side.rawValue) \(t.slot ?? -1) \(t.damage)" }
        XCTAssertEqual(byDir, ["frontLeft": "attacker 2 100", "front": "attacker 1 100", "frontRight": "attacker 0 100"])
    }

    func testOwnNeighbourDirectionsHitTheOwnRow() {
        let f = F.fight([F.wall(), F.wall(), F.raw("Own", 200, big, [.ownLeft, .ownRight]), F.wall(), F.wall()],
                        [F.wall(), F.wall(), F.raw("OwnL", 200, big, [.ownLeft]), F.wall(), F.wall()], maxRounds: 1)
        XCTAssertEqual(f.attack(1, .attacker, 2)!.targets.map { $0.desc }, ["left attacker 1 100", "right attacker 3 100"])
        XCTAssertEqual(f.attack(1, .defender, 2)!.targets.map { $0.desc }, ["left defender 3 200"])
    }

    func testAnEmptySlotSendsTheShareToTheOpposingPlayer() {
        let f = F.fight([nil, nil, F.hitter(500), nil, nil], [], maxRounds: 1)
        XCTAssertEqual(f.attack(1, .attacker, 2)!.targets, [AttackTarget(side: .defender, slot: nil, damage: 500, blocked: false, dir: "front")])
        XCTAssertEqual(sum(f.playerDamage(.defender, 1)), 500)
        let g = F.fight([nil, nil, F.raw("OwnL", 200, big, [.ownLeft]), nil, nil], [F.wall(), F.wall(), F.wall(), F.wall(), F.wall()], maxRounds: 1)
        XCTAssertEqual(sum(g.playerDamage(.defender, 1)), 200)
        XCTAssertEqual(g.playerDamage(.attacker, 1), [])
    }

    func testProcessingOrderAttacker0To4ThenDefender4To0() {
        let f = F.fight([F.hitter(100), F.hitter(100), F.hitter(100)], [F.hitter(100), F.hitter(100), F.hitter(100)], maxRounds: 1)
        XCTAssertEqual(f.attacks(1).map { "\($0.side!.rawValue.prefix(1))\($0.slot!)" }, ["a0", "a1", "a2", "d2", "d1", "d0"])
    }

    func testDamageSplitPerDirection() {
        let f = F.fight([F.wall(), F.wall(), F.raw("Tri", 1000, big, [.left, .direct, .right]), F.wall(), F.raw("Two", 1001, big, [.left, .right])],
                        [F.wall(), F.wall(), F.wall(), F.wall(), F.wall()], maxRounds: 1)
        XCTAssertEqual(f.attack(1, .attacker, 2)!.targets.map { $0.damage }, [333, 333, 333])
        XCTAssertEqual(f.attack(1, .attacker, 4)!.targets.map { "\($0.slot!) \($0.damage)" }, ["3 501"])
    }

    // MARK: over()

    func testALoneDamagingAbilityDoesNotCount() {
        let witch = F.raw("Witch", 0, 1000, [], [F.b(.deal_damage_to_opponent_player, [], .always, strength: .number(50))])
        let f = F.fight([witch], [])
        XCTAssertEqual(f.result.rounds, 0)
        XCTAssertEqual(f.result.endedBy, .noAttack)
        XCTAssertEqual(f.result.winner, .draw)
    }

    func testRoundLimitedAttacks() {
        let le = F.fight([F.raw("Cat", 100, big, [], [F.b(.attack, [.front], .round_le, eventData: .round(2))])], [F.wall()])
        XCTAssertEqual(le.result.rounds, 2)
        XCTAssertEqual(le.result.endedBy, .noAttack)
        XCTAssertEqual(le.cardHp(.defender, 0, 2), big - 200)
        let eq = F.fight([F.raw("Cat", 100, big, [], [F.b(.attack, [.front], .round_eq, eventData: .round(2))])], [F.wall()])
        XCTAssertEqual(eq.result.rounds, 2)
        XCTAssertEqual(eq.attacks(1).count, 0)
        XCTAssertEqual(eq.attacks(2).count, 1)
        let ge = F.fight([F.raw("Cat", 100, big, [], [F.b(.attack, [.front], .round_ge, eventData: .round(2))])], [F.wall()])
        XCTAssertEqual(ge.result.rounds, 20)
        XCTAssertEqual(ge.result.endedBy, .maxRounds)
        XCTAssertEqual(ge.of("attack").count, 19)
    }

    func testTheFightStopsAsSoonAsAPlayerIsAtZero() {
        let f = F.fight([F.hitter(400)], [], dHp: 1000)
        XCTAssertEqual(f.result.rounds, 3)
        XCTAssertEqual(f.result.defenderHp, -200)
        XCTAssertEqual(f.result.endedBy, .playerHp)
    }

    // MARK: phase order and per-round resets

    func testHealsComeBeforeTheDiePhase() {
        let healer = F.raw("Healer", 0, 100, [], [F.b(.heal, [.selfSlot], .always, strength: .number(50))])
        let f = F.fight([healer], [F.hitter(100)], maxRounds: 3)
        XCTAssertEqual(f.deaths(1).count, 0)
        XCTAssertEqual(f.cardHp(.attacker, 0, 1), 50)
        XCTAssertEqual(f.deaths(2).count, 1)
        XCTAssertEqual(f.heals(1)[0].hp, 50)
    }

    func testNoBuffSuppressesAbilitiesNotTheNormalAttack() {
        let supp = F.raw("Supp", 0, big, [], [F.b(.no_buff, [.front], .round_eq, eventData: .round(1))])
        let buffed = F.raw("Buffed", 100, big, [.direct], [F.b(.raise_attack, [.selfSlot], .always, strength: .number(100))])
        let f = F.fight([supp], [buffed], maxRounds: 2)
        XCTAssertEqual(f.statuses(1).map { "\(statusDesc($0)) \($0.on == true)" }, ["defender0 suspended true"])
        XCTAssertEqual(f.attack(1, .defender, 0)!.targets[0].damage, 100)
        XCTAssertEqual(f.attack(2, .defender, 0)!.targets[0].damage, 200)
        XCTAssertEqual(f.buffs(1).count, 0)
        XCTAssertEqual(f.buffs(2).count, 1)
    }

    func testNoDamageZeroesTheAttackButAbilitiesStillFire() {
        let daze = F.raw("Daze", 0, big, [], [F.b(.no_damage, [.front], .always)])
        let dmg = F.raw("Dmg", 100, big, [.direct], [F.b(.deal_damage_to_opponent_player, [], .always, strength: .number(50))])
        let f = F.fight([daze], [dmg], maxRounds: 1)
        XCTAssertEqual(f.statuses(1).map(statusDesc), ["defender0 dazed"])
        XCTAssertEqual(f.attacks(1).count, 0)
        XCTAssertEqual(f.playerDamage(.attacker, 1).map { "\($0.amount!) \($0.cause!.rawValue) \($0.hp!)" }, ["50 ability 1450"])
    }

    func testSuspendPlusDazeFromTheSameCardIsStunned() {
        let f = F.fight([F.card("Siren")], [F.hitter(100)], maxRounds: 2)
        XCTAssertEqual(f.statuses(1).map(statusDesc), ["defender0 suspended", "defender0 stunned"])
        XCTAssertEqual(f.attacks(1).count, 0)
        XCTAssertEqual(f.attacks(2).count, 1)
    }

    func testIncrementAttackIsPermanentRaiseAttackIsReset() {
        let inc = F.raw("Inc", 100, big, [.direct], [F.b(.increment_attack, [.selfSlot], .always, strength: .number(10))])
        let f = F.fight([inc], [F.wall()], maxRounds: 3)
        XCTAssertEqual([1, 2, 3].map { f.attack($0, .attacker, 0)!.attack! }, [110, 120, 130])
        XCTAssertEqual(f.buffs(1).map(buffDesc), ["attacker0 attack 10 permanent"])
        let rs = F.raw("Rs", 100, big, [.direct], [F.b(.raise_attack, [.selfSlot], .always, strength: .number(50))])
        let g = F.fight([rs], [F.wall()], maxRounds: 3)
        XCTAssertEqual([1, 2, 3].map { g.attack($0, .attacker, 0)!.attack! }, [150, 150, 150])
        XCTAssertEqual(g.buffs(1)[0].permanent, false)
    }

    func testRaisePlayerHpIsReappliedEachRoundWhileTheCardLives() {
        let tree = F.raw("Tree", 0, 100, [], [F.b(.raise_player_hp, [], .always, strength: .number(500))])
        let f = F.fight([tree], [F.hitter(100), F.hitter(100)], aHp: 1000, maxRounds: 2)
        XCTAssertEqual(f.buffs(1).map(buffDesc), ["attackerplayer maxHp 500"])
        XCTAssertEqual(f.roundEnd(1).attackerHp, 1400)
        XCTAssertEqual(f.deaths(1).count, 1)
        XCTAssertEqual(f.buffs(2).map(buffDesc), ["attackerplayer maxHp -500"])
        XCTAssertEqual(f.roundEnd(2).attackerHp, 700)
    }

    func testHealPlayerNeverExceedsTheMaxAndComesAfterTheAttacks() {
        let healer = F.raw("Healer", 0, big, [], [F.b(.heal_player, [], .always, strength: .number(500))])
        let f = F.fight([healer], [nil, F.hitter(100)], maxRounds: 1)
        XCTAssertEqual(f.playerDamage(.attacker, 1).map { "\($0.amount!) \($0.hp!)" }, ["100 1400"])
        let heals = f.heals(1).filter { $0.slot == nil }
        XCTAssertEqual(heals.map { "\($0.side!.rawValue) \($0.amount!) \($0.hp!)" }, ["attacker 100 1500"])
        XCTAssertEqual(f.roundEnd(1).attackerHp, 1500)
    }

    func testADiedCardKeepsItsSlotUntilCleanUp() {
        let f = F.fight([nil, F.hitter(100)], [F.raw("Weak", 0, 50, []), nil], maxRounds: 1)
        // attacker slot 1 faces defender slot 1 (empty): player damage; defender slot 0 card is untouched
        XCTAssertEqual(sum(f.playerDamage(.defender, 1)), 100)
        let g = F.fight([F.hitter(100), F.raw("Diag", 100, big, [.left])], [F.raw("Weak", 0, 50, [])], maxRounds: 1)
        // slot 0 kills Weak in the attack phase (not yet removed); slot 1's frontLeft still hits the card, not the player
        XCTAssertEqual(g.attack(1, .attacker, 1)!.targets.map { "\($0.side.rawValue) \($0.slot!) \($0.damage)" }, ["defender 0 100"])
        XCTAssertEqual(g.playerDamage(.defender, 1), [])
        XCTAssertEqual(g.deaths(1).count, 1)
    }

    // MARK: reflect

    func testReflectDamageSendsTheDamageBack() {
        let f = F.fight([F.raw("A", 300, 1000, [.direct])], [F.card("Lookalike")], maxRounds: 1)
        XCTAssertEqual(f.damages(1).map { "\($0.who) \($0.amount!) \($0.cause!.rawValue) \($0.hp!)" }, ["defender0 300 attack 780", "attacker0 300 reflect 700"])
        XCTAssertEqual(f.cardHp(.attacker, 0, 1), 700)
    }

    func testInvulnerableAttackerAndInvulnerableReflector() {
        let inv = F.raw("Inv", 300, 1000, [.direct], [F.b(.invulnerable, [.selfSlot], .always)])
        let f = F.fight([inv], [F.card("Lookalike")], maxRounds: 1)
        XCTAssertEqual(f.damages(1).map { "\($0.who) \($0.amount!) \($0.cause!.rawValue) \($0.blocked!)" }, ["defender0 300 attack false", "attacker0 0 reflect true"])
        XCTAssertEqual(f.cardHp(.attacker, 0, 1), 1000)
        let mirror = F.raw("Mirror", 0, 1000, [], [F.b(.invulnerable, [.selfSlot], .always), F.b(.reflect_damage, [.selfSlot], .onDamage, eventData: .selfTag)])
        let g = F.fight([F.hitter(300)], [mirror], maxRounds: 1)
        XCTAssertEqual(g.damages(1).map { "\($0.who) \($0.amount!) \($0.blocked!)" }, ["defender0 0 true"])
        XCTAssertEqual(g.attack(1, .attacker, 0)!.targets.map { "\($0.damage) \($0.blocked)" }, ["300 true"])
    }

    func testReflectDamageToPlayerIsCappedPerHit() {
        let f = F.fight([F.hitter(500)], [F.card("Lava Toad")], maxRounds: 1)
        XCTAssertEqual(f.playerDamage(.attacker, 1).map { "\($0.amount!) \($0.cause!.rawValue) \($0.hp!)" }, ["300 reflect 1200"])
        let g = F.fight([F.hitter(100)], [F.card("Lava Toad")], maxRounds: 1)
        XCTAssertEqual(sum(g.playerDamage(.attacker, 1)), 100)
    }

    func testASuspendedReflectorDoesNotReflect() {
        let a = F.raw("A", 300, 1000, [.direct], [F.b(.no_buff, [.front], .round_eq, eventData: .round(1))])
        let f = F.fight([a], [F.card("Lookalike")], maxRounds: 2)
        XCTAssertEqual(f.damages(1).filter { $0.cause == .reflect }.count, 0)
        XCTAssertEqual(f.damages(2).filter { $0.cause == .reflect }.count, 1)
    }

    // MARK: deaths, resurrect and the event loop

    func testResurrectWorksOncePerFight() {
        let f = F.fight([F.card("Phoenix")], [F.hitter(2000)], maxRounds: 3)
        XCTAssertEqual(f.deaths(1).map { "\($0.who) \($0.card!.name!)" }, ["attacker0 Phoenix"])
        XCTAssertEqual(f.revives(1).map { "\($0.who) \($0.hp!) \($0.attack!)" }, ["attacker0 480 720"])
        XCTAssertEqual(f.deaths(2).count, 1)
        XCTAssertEqual(f.revives(2).count, 0)
        XCTAssertEqual(f.result.deaths.attacker, 2)
        XCTAssertEqual(f.of("revive").count, 1)
        XCTAssertEqual(f.cardHp(.attacker, 0, 1), 480)
    }

    func testDeathEffectsChainThroughTheEventLoop() {
        let d1 = F.raw("D1", 0, 100, [], [F.b(.deal_damage_to_all_opponent_cards, [], .onDeath, eventData: .selfTag, strength: .number(100))])
        let f = F.fight([F.card("Tribe Avenger"), F.raw("A2", 0, 150, [])], [F.hitter(1000), d1], maxRounds: 1)
        XCTAssertEqual(f.deaths(1).map { $0.who }, ["attacker0", "defender1"])
        XCTAssertEqual(f.cardHp(.attacker, 1, 1), 50)
        XCTAssertEqual(f.cardHp(.defender, 0, 1), big - 300)
        // bursts walk the opponent's slots in the original order (its own left first = our right-to-left for the defender)
        let bursts = f.damages(1).filter { $0.cause == .death }
        XCTAssertEqual(bursts.map { "\($0.who) \($0.amount!)" }, ["defender1 100", "defender0 100", "attacker0 100", "attacker1 100"])
    }

    func testDealDamageToAllOpponentCardsIsBlockedByInvulnerable() {
        let spirit = F.raw("Spirit", 0, big, [], [F.b(.deal_damage_to_all_opponent_cards, [], .always, strength: .number(700))])
        let f = F.fight([spirit], [F.card("Anvil Guard"), F.wall()], maxRounds: 2)
        func hits(_ r: Int) -> [String] {
            f.damages(r).filter { $0.side == .defender }.sorted { $0.slot! < $1.slot! }.map { "\($0.slot!) \($0.amount!) \($0.blocked!)" }
        }
        XCTAssertEqual(hits(1), ["0 0 true", "1 700 false"])
        XCTAssertEqual(hits(2), ["0 700 false", "1 700 false"])
    }

    func testACardKilledInTheDiePhaseStillFiresItsLaterPhaseAbilities() {
        let f = F.fight([F.card("Dryad Oracle")], [F.hitter(5000)], maxRounds: 1)
        XCTAssertEqual(f.deaths(1).count, 1)
        XCTAssertEqual(f.playerDamage(.defender, 1).map { "\($0.amount!) \($0.cause!.rawValue)" }, ["360 attack", "600 death"])
    }

    // MARK: nextRound queue (extension)

    func testSkyGuardianDazesTheDeadCardsNeighboursNextRoundOnly() {
        let f = F.fight([nil, nil, F.card("Sky Guardian"), nil, nil], [F.wall(), F.hitter(100), F.raw("Front", 0, 100, []), F.hitter(100), F.wall()], maxRounds: 3)
        XCTAssertEqual(f.deaths(1).map { $0.who }, ["defender2"])
        XCTAssertEqual(f.statuses(1).count, 0)
        XCTAssertEqual(f.statuses(2).map(statusDesc), ["defender1 dazed", "defender3 dazed"])
        XCTAssertEqual(f.attacks(1).filter { $0.side == .defender }.map { $0.slot! }, [3, 1])
        XCTAssertEqual(f.attacks(2).filter { $0.side == .defender }.map { $0.slot! }, [])
        XCTAssertEqual(f.attacks(3).filter { $0.side == .defender }.map { $0.slot! }, [3, 1])
        XCTAssertEqual(f.statuses(3).count, 0)
    }

    func testTriggerDirectionADeathElsewhereDoesNotTrigger() {
        let f = F.fight([nil, F.hitter(500), F.card("Sky Guardian"), nil, nil], [F.wall(), F.raw("Weak", 100, 100, [.direct]), F.wall(), F.hitter(100), F.wall()], maxRounds: 2)
        XCTAssertEqual(f.deaths(1).map { $0.who }, ["defender1"])
        XCTAssertEqual(f.statuses(2).count, 0)
    }

    func testBoneCollectorNextRoundPerEnemyDeathNotPermanent() {
        let f = F.fight([F.card("Bone Collector"), F.hitter(300)], [F.raw("W1", 0, 100, []), F.raw("W2", 0, 100, [])], maxRounds: 3)
        XCTAssertEqual(f.deaths(1).count, 2)
        XCTAssertEqual(f.attack(1, .attacker, 0)!.attack, 300)
        XCTAssertEqual(f.buffs(2).map(buffDesc), ["attacker0 attack 100", "attacker0 attack 100"])
        XCTAssertEqual(f.attack(2, .attacker, 0)!.attack, 500)
        XCTAssertEqual(f.attack(3, .attacker, 0)!.attack, 300)
    }

    func testGladiatorAddsTheHealedAmountToNextRoundsAttack() {
        let healer = F.raw("H", 0, big, [], [F.b(.heal, [.left], .always, strength: .number(100))])
        let f = F.fight([nil, F.card("Gladiator"), healer], [F.wall(), F.hitter(200), F.wall()], maxRounds: 3)
        XCTAssertEqual(f.attack(1, .attacker, 1)!.attack, 480)
        XCTAssertEqual(f.heals(1).map { "\($0.who) \($0.amount!) \($0.hp!)" }, ["attacker1 100 980"])
        XCTAssertEqual(f.buffs(2).map { "\($0.slot!) \($0.delta!)" }, ["1 100"])
        XCTAssertEqual(f.attack(2, .attacker, 1)!.attack, 580)
    }

    // MARK: kill (extension)

    func testColossusKillsTheHighestAttackCardAtTheEndOfRound2() {
        let f = F.fight([F.card("Colossus")], [F.hitter(100), F.hitter(300), F.hitter(200)], maxRounds: 3)
        XCTAssertEqual(f.deaths(1).count, 0)
        XCTAssertEqual(f.deaths(2).map { $0.who }, ["defender1"])
        let kill = f.damages(2).first { $0.cause == .kill }!
        XCTAssertEqual("\(kill.who) \(kill.hp!)", "defender1 0")
        XCTAssertEqual(f.attacks(3).filter { $0.side == .defender }.count, 2)
    }

    func testDwarfJudgeKillsTheLowestAttackCardInvulnerableOrNot() {
        let inv = F.raw("Inv", 100, big, [.direct], [F.b(.invulnerable, [.selfSlot], .always)])
        let f = F.fight([F.card("Dwarf Judge")], [inv, F.hitter(300), F.hitter(200)], maxRounds: 3)
        XCTAssertEqual(f.deaths(2).map { $0.who }, ["defender0"])
    }

    func testUmbralDragonKillsTwoRandomCardsExceptItselfASuppressedKillerDoesNothing() {
        let f = F.fight([F.card("Umbral Dragon"), F.wall()], [F.wall(), F.wall(), F.wall()], seed: 5, maxRounds: 2)
        let killed = f.deaths(2).map { $0.who }
        XCTAssertEqual(killed.count, 2)
        XCTAssertFalse(killed.contains("attacker0"))
        XCTAssertEqual(F.fight([F.card("Umbral Dragon"), F.wall()], [F.wall(), F.wall(), F.wall()], seed: 5, maxRounds: 2).deaths(2).map { $0.who }, killed)
        let supp = F.raw("Supp", 100, big, [.direct], [F.b(.no_buff, [.front], .round_eq, eventData: .round(2))])
        let g = F.fight([F.card("Colossus")], [supp, F.hitter(300)], maxRounds: 3)
        XCTAssertEqual(g.of("death").count, 0)
    }

    // MARK: extensions

    func testSchemerDeathAttack() {
        let f = F.fight([F.card("Schemer")], [F.raw("K", 2000, 5000, [.direct])], maxRounds: 1)
        let bonus = f.attacks(1).first { $0.bonus == true }!
        XCTAssertEqual(bonus.targets.map { "\($0.side.rawValue) \($0.slot!) \($0.damage)" }, ["defender 0 720"])
        XCTAssertEqual(f.cardHp(.defender, 0, 1), 5000 - 360 - 720)
    }

    func testWargRiderSplitsOverFiveDirections() {
        let f = F.fight([F.wall(), F.wall(), F.card("Warg Rider"), F.wall(), F.wall()], [F.wall(), F.wall(), F.hitter(2000), F.wall(), F.wall()], maxRounds: 1)
        let bonus = f.attacks(1).first { $0.bonus == true }!
        XCTAssertEqual(bonus.targets.map { "\($0.side.rawValue) \($0.slot!) \($0.damage)" }.sorted(), ["attacker 1 900", "attacker 3 900", "defender 1 900", "defender 2 900", "defender 3 900"].sorted())
    }

    func testEmptyReductionRatEaterAndTreeman() {
        let f = F.fight([F.card("Rat Eater"), F.card("Treeman")], [], maxRounds: 1)
        XCTAssertEqual(f.playerDamage(.defender, 1).map { $0.amount! }, [920, 100])
        let g = F.fight([F.card("Rat Eater"), F.card("Treeman")], [F.wall(), F.wall()], maxRounds: 1)
        XCTAssertEqual(g.damages(1).map { $0.amount! }, [720, 300])
    }

    func testStrengthPercentGasherAndBaseAttackGoblinMob() {
        let f = F.fight([F.card("Gasher"), F.card("Goblin Mob")], [F.wall(), F.wall()], maxRounds: 3)
        XCTAssertEqual([1, 2, 3].map { f.attack($0, .attacker, 0)!.attack! }, [500, 875, 500])
        XCTAssertEqual([1, 2, 3].map { f.attack($0, .attacker, 1)!.attack! }, [900, 300, 300])
    }

    func testRoundEvenHarpy() {
        let f = F.fight([F.card("Harpy")], [F.hitter(100)], maxRounds: 3)
        XCTAssertEqual([1, 2, 3].map { r in f.dmg(r, .attacker, 0).map { "\($0.amount!) \($0.blocked!)" } }, [["100 false"], ["0 true"], ["100 false"]])
        XCTAssertEqual(f.statuses(2).map { "\($0.slot!) \($0.status!.rawValue)" }, ["0 indestructible"])
    }

    func testCatapultAloneEndsTheFightAfterRound3() {
        let f = F.fight([F.card("Catapult")], [F.wall(), F.wall()])
        XCTAssertEqual(f.result.rounds, 3)
        XCTAssertEqual(f.result.endedBy, .noAttack)
        XCTAssertEqual(f.of("attack").count, 3)
    }

    func testThiefOfTime() {
        let f = F.fight([nil, F.hitter(100), F.card("Thief of Time"), F.hitter(100), nil], [F.wall(), F.hitter(100), F.hitter(100), F.hitter(100), F.wall()], maxRounds: 2)
        func stunned(_ r: Int) -> [String] { f.statuses(r).filter { $0.status == .stunned }.map { $0.who }.sorted() }
        XCTAssertEqual(stunned(1), ["attacker1", "attacker3", "defender2"])
        XCTAssertEqual(stunned(2), ["defender1", "defender3"])
        XCTAssertEqual(f.attack(1, .attacker, 2)!.attack, 800)
        XCTAssertEqual(f.attack(2, .attacker, 2)!.attack, 1600)
        XCTAssertEqual(f.attacks(1).map { $0.who }, ["attacker2", "defender3", "defender1"])
    }

    func testMoonDragonRevivesEveryAllyOnce() {
        let f = F.fight([F.card("Moon Dragon"), F.raw("Ally", 0, 100, [])], [F.hitter(2000), F.hitter(2000)], maxRounds: 2)
        XCTAssertEqual(f.revives(1).map { "\($0.who) \($0.hp!)" }, ["attacker0 900", "attacker1 100"])
        XCTAssertEqual(f.deaths(2).count, 2)
        XCTAssertEqual(f.revives(2).count, 0)
        XCTAssertEqual(f.result.deaths.attacker, 4)
    }

    func testBouncerSharesItsPicksBetweenNoBuffAndNoDamage() {
        let f = F.fight([F.card("Bouncer"), F.hitter(100), F.hitter(100)], [F.hitter(100), F.hitter(100), F.hitter(100)], seed: 9, maxRounds: 3)
        for r in [1, 2] {
            let st = f.statuses(r)
            XCTAssertEqual(st.map { $0.status! }, [CardStatus.suspended, .suspended, .stunned, .stunned])
            func pairs(_ status: CardStatus) -> [String] { st.filter { $0.status == status }.map { $0.who }.sorted() }
            XCTAssertEqual(pairs(.suspended), pairs(.stunned))
            XCTAssertEqual(pairs(.stunned).filter { $0.hasPrefix("attacker") }.count, 1)
            XCTAssertEqual(pairs(.stunned).filter { $0.hasPrefix("defender") }.count, 1)
            XCTAssertFalse(pairs(.stunned).contains("attacker0"))
            for p in pairs(.stunned) { XCTAssertFalse(f.attacks(r).contains { $0.who == p }, "\(p) attacked in round \(r)") }
        }
        XCTAssertEqual(f.statuses(3).count, 0)
    }

    func testScopeAndFilterTotemCarver() {
        let orc = F.raw("Orc", 400, big, [.direct], [], tribe: "orc")
        let elf = F.raw("Elf", 500, big, [.direct], [], tribe: "elf")
        let orcWall = F.raw("OrcWall", 0, big, [], [], tribe: "orc")
        let f = F.fight([F.card("Totem Carver"), orc, elf, orcWall], [F.raw("D", 0, 100, [])], maxRounds: 2)
        XCTAssertEqual(f.deaths(1).count, 1)
        XCTAssertEqual(f.buffs(1).map { "\($0.slot!) \($0.delta!) \($0.permanent!)" }, ["0 200 true", "1 200 true"])
        XCTAssertEqual([0, 1, 2].map { f.attack(2, .attacker, $0)!.attack! }, [500, 600, 500])
    }

    func testFilterOnDirectionBuffsBoneOracle() {
        let orc = F.raw("Orc", 0, big, [], [], tribe: "orc")
        let elf = F.raw("Elf", 0, big, [], [], tribe: "elf")
        let f = F.fight([orc, F.card("Bone Oracle"), elf], [F.hitter(100), F.hitter(100), F.hitter(100)], maxRounds: 2)
        XCTAssertEqual(f.statuses(1).count, 0)
        XCTAssertEqual(f.statuses(2).map(statusDesc), ["attacker0 indestructible"])
        XCTAssertEqual(f.dmg(2, .attacker, 0).map { $0.blocked! }, [true])
        XCTAssertEqual(f.dmg(2, .attacker, 2).map { $0.blocked! }, [false])
    }

    func testUnreflectableLightningSpirit() {
        func cardHits(_ f: Fight) -> [String] { f.damages(1).filter { $0.slot != nil }.map { "\($0.who) \($0.amount!) \($0.cause!.rawValue)" } }
        let f = F.fight([F.card("Lightning Spirit"), F.hitter(1)], [F.card("Lookalike")], maxRounds: 1)
        XCTAssertEqual(cardHits(f), ["defender0 700 ability"])
        let plain = F.raw("Plain", 0, big, [], [F.b(.deal_damage_to_all_opponent_cards, [], .always, strength: .number(700))])
        let g = F.fight([plain, F.hitter(1)], [F.card("Lookalike")], maxRounds: 1)
        XCTAssertEqual(cardHits(g), ["defender0 700 ability", "attacker0 700 reflect"])
    }

    func testDamagedBySelfBatteringRamVersusCrystalGolem() {
        let f = F.fight([F.card("Battering Ram")], [F.raw("D0", 0, 1000, [])], maxRounds: 1)
        XCTAssertEqual(f.playerDamage(.defender, 1).map { "\($0.amount!) \($0.cause!.rawValue)" }, ["300 death"])
        let dazer = F.raw("D0", 0, 1000, [], [F.b(.no_damage, [.front], .round_eq, eventData: .round(1))])
        let sidekick = F.raw("Side", 2000, big, [.left])
        let g = F.fight([F.card("Battering Ram"), sidekick], [dazer], maxRounds: 1)
        XCTAssertEqual(g.deaths(1).count, 1)
        XCTAssertEqual(g.playerDamage(.defender, 1), [])
        let h = F.fight([F.card("Crystal Golem"), sidekick], [dazer], maxRounds: 1)
        XCTAssertEqual(h.playerDamage(.defender, 1).map { $0.amount! }, [720])
    }

    func testHealBoostPercentDjinn() {
        let f = F.fight([F.card("Argonaut"), F.card("Djinn")], [F.wall(), F.wall()], maxRounds: 1)
        XCTAssertEqual(f.heals(1).map { "\($0.who) \($0.amount!)" }, ["attacker1 254"])
        let g = F.fight([F.card("Argonaut"), F.wall()], [F.wall(), F.wall()], maxRounds: 1)
        XCTAssertEqual(g.heals(1).map { $0.amount! }, [240])
    }

    func testReduceAbilityAttackPercentMedusa() {
        let ab = F.raw("Ab", 1000, big, [.direct], [F.b(.heal, [.selfSlot], .always, strength: .number(1))])
        let plain = F.raw("Plain", 1000, big, [.direct])
        let dab = F.raw("DAb", 1000, big, [.direct], [F.b(.self_damage, [], .always, strength: .number(1))])
        let f = F.fight([F.card("Medusa"), ab, plain], [dab], dHp: 10000, maxRounds: 2)
        XCTAssertEqual(f.buffs(1).map { "\($0.who) \($0.delta!)" }, ["attacker1 -60", "defender0 -60"])
        XCTAssertEqual([0, 1, 2].map { f.attack(1, .attacker, $0)!.attack! }, [1350, 940, 1000])
        XCTAssertEqual(f.attack(2, .attacker, 1)!.attack, 1000)
    }

    func testGambleOneRollPerRound() {
        let f = F.fight([F.card("Wizard Apprentice"), F.hitter(1000), F.wall()], [F.wall(), F.wall(), F.wall()], seed: 4, maxRounds: 1)
        let g = f.of("gamble", 1)
        XCTAssertEqual(g.count, 1)
        let sign = g[0].failed == true ? -1 : 1
        XCTAssertEqual(f.buffs(1).map { "\($0.slot!) \($0.delta!)" }, ["0 \(375 * sign)", "1 \(250 * sign)"])
        XCTAssertEqual(f.attack(1, .attacker, 1)!.attack, 1000 + 250 * sign)
    }

    func testWheelTouchesEveryOtherLivingCard() {
        let f = F.fight([F.card("Wheel of Fortune"), F.hitter(1)], [F.wall(), F.wall()], seed: 2, maxRounds: 2)
        for r in [1, 2] {
            let touched = f.heals(r) + f.damages(r).filter { $0.cause == .ability }
            XCTAssertEqual(touched.map { $0.who }.sorted(), ["attacker1", "defender0", "defender1"])
            XCTAssertTrue(touched.allSatisfy { $0.amount == 900 })
        }
    }

    func testSwapStatsRandom() {
        let f = F.fight([F.card("Goblin Thieves")], [F.raw("Big", 100, 5000, [.direct])], seed: 1, maxRounds: 2)
        let swaps = f.of("swap")
        XCTAssertEqual(swaps.count, 1)
        let sw = swaps[0]
        let before = f.events[0].snapshot(sw.side!)!.cards[sw.slot!]!
        XCTAssertEqual(sw.attack, before.maxHp)
        XCTAssertEqual(sw.maxHp, before.attack)
        XCTAssertEqual(f.attack(1, sw.side!, sw.slot!)!.attack, before.maxHp)
    }

    func testHurricaneDancerDazesFiveCardsInRound1() {
        let f = F.fight([nil, F.hitter(100), F.card("Hurricane Dancer"), F.hitter(100), nil], [F.wall(), F.hitter(100), F.hitter(100), F.hitter(100), F.wall()], maxRounds: 2)
        XCTAssertEqual(f.statuses(1).map { $0.who }.sorted(), ["attacker1", "attacker3", "defender1", "defender2", "defender3"])
        XCTAssertEqual(f.attacks(1).map { $0.who }, ["attacker2"])
        XCTAssertEqual(f.attacks(2).count, 6)
    }

    func testEnormousLarvaAndBoneDragonReturnStronger() {
        let f = F.fight([F.card("Enormous Larva"), F.card("Bone dragon")], [F.hitter(5000), F.hitter(5000)], maxRounds: 2)
        XCTAssertEqual(f.revives(1).map { "\($0.slot!) \($0.attack!)" }, ["0 1650", "1 3200"])
        XCTAssertEqual(f.attack(2, .attacker, 0)!.attack, 1650)
        XCTAssertEqual(f.attack(2, .attacker, 1)!.attack, 3200)
    }

    // MARK: event log details for the UI

    func testStatusEventsCarrySourcesAndBlockedHits() {
        let f = F.fight([F.hitter(300)], [F.card("Anvil Guard")], maxRounds: 2)
        XCTAssertEqual(f.statuses(1), [.status(side: .defender, slot: 0, status: .indestructible, on: true, source: EventSource(side: .defender, slot: 0, effect: "invulnerable"))])
        XCTAssertEqual(f.attack(1, .attacker, 0)!.targets, [AttackTarget(side: .defender, slot: 0, damage: 300, blocked: true, dir: "front")])
        XCTAssertEqual(f.dmg(1, .defender, 0).map { "\($0.amount!) \($0.blocked!) \($0.hp!)" }, ["0 true 720"])
        XCTAssertEqual(f.dmg(2, .defender, 0).map { "\($0.amount!) \($0.blocked!) \($0.hp!)" }, ["300 false 420"])
    }

    func testDamageAndHealEventsReportTheHpAfterTheChange() {
        let healer = F.raw("H", 0, 1000, [], [F.b(.heal, [.selfSlot], .always, strength: .number(400))])
        let f = F.fight([healer], [F.hitter(100)], maxRounds: 2)
        XCTAssertEqual(f.dmg(1, .attacker, 0).map { $0.hp! }, [900])
        XCTAssertEqual(f.heals(1).map { "\($0.amount!) \($0.hp!)" }, ["400 1000"])
        XCTAssertEqual(f.cardHp(.attacker, 0, 1), 1000)
        XCTAssertEqual(f.dmg(2, .attacker, 0).map { $0.hp! }, [900])
    }

    func testMaxHpBuffsArchAngel() {
        let f = F.fight([F.card("Arch Angel"), F.raw("N", 0, 1000, [])], [F.hitter(2000), F.wall()], maxRounds: 3)
        XCTAssertEqual(f.buffs(1).map { "\(buffDesc($0)) \($0.source?.effect ?? "-")" }, ["attacker1 maxHp 200 raise_hp"])
        XCTAssertEqual(f.deaths(1).count, 1)
        XCTAssertEqual(f.buffs(2).map(buffDesc), ["attacker1 maxHp -200"])
        XCTAssertEqual(f.buffs(3).count, 0)
        let g = F.fight([F.card("Arch Angel"), F.raw("N", 0, 1000, [])], [F.wall(), F.wall()], maxRounds: 3)
        XCTAssertEqual(g.of("buff").count, 1)
    }

    func testDeathReviveBattleEndAndTheSummary() {
        let f = F.fight([F.card("Phoenix")], [F.hitter(2000)], maxRounds: 2)
        let death = f.deaths(1)[0]
        XCTAssertEqual(death.card?.cardId, "phoenix")
        XCTAssertEqual(death.card?.name, "Phoenix")
        let end = f.events.last!
        XCTAssertEqual(end.type, "battleEnd")
        XCTAssertEqual(end.winner, f.result.winner)
        XCTAssertEqual(end.rounds, 2)
        XCTAssertEqual(end.endedBy, .maxRounds)
        let s = Summaries.summarise(f.events)
        XCTAssertEqual(s.winner, f.result.winner)
        XCTAssertEqual(s.rounds, 2)
        XCTAssertEqual(s.deaths, f.result.deaths)
        XCTAssertTrue(s.lines[0].hasPrefix("battle start"))
        XCTAssertTrue(s.lines.contains { $0.contains("revives") })
        XCTAssertTrue(s.lines.last!.hasPrefix("battle end"))
        XCTAssertEqual(Summaries.lines(f.events), s.lines)
    }

    func testADazedCardWithNegativeEmptyReductionStillHurtsThePlayer() {
        let daze = F.raw("Daze", 0, big, [], [F.b(.no_damage, [.frontRight], .always)])
        let f = F.fight([nil, daze, nil], [nil, nil, F.card("Rat Eater")], maxRounds: 1)
        // the dazed Rat Eater (defender slot 2) faces attacker slot 2 (empty): attack 0, empty-slot share round((0 + 200) / 1)
        XCTAssertEqual(f.playerDamage(.attacker, 1).map { $0.amount! }, [200])
    }

    // MARK: real catalog

    func testRandomFightsWithTheRealCatalogAreWellFormed() {
        let db = RealData.db
        let rng = Mulberry32(20261008)
        let pool = db.all().filter { !$0.isTrainer }
        let stats = Stats()
        func instance(_ uid: String) -> CardRef {
            let def = rng.pick(pool)!
            let stage = rng.int(5)
            return CardRef(uid: uid, cardId: def.id, stage: stage, level: 1 + rng.int(stats.capFor(def, stage: stage)), evolveQuality: 1)
        }
        func sideOf(_ name: String) -> FighterSide {
            var list: [SideEntry?] = []
            for i in 0..<BattleState.slotCount { list.append(rng.chance(0.85) ? .ref(instance("\(name)\(i)")) : nil) }
            return BattleState.buildSide(FighterPlayer(name: name, hp: 1500 + rng.int(3000)), list, options: SideOptions(cardsDb: db))
        }
        let t0 = Date()
        var winners: [Winner: Int] = [:]
        let engine = BattleEngine()
        for _ in 0..<1000 {
            let out = engine.simulateBattle(BattleConfig(attacker: sideOf("a"), defender: sideOf("d"), seed: UInt32(rng.int(1_000_000_000))))
            winners[out.result.winner, default: 0] += 1
            XCTAssertEqual(out.events.first?.type, "battleStart")
            XCTAssertEqual(out.events.last?.type, "battleEnd")
            XCTAssertTrue(out.result.rounds >= 0 && out.result.rounds <= 20)
        }
        let ms = Date().timeIntervalSince(t0) * 1000
        XCTAssertLessThan(ms, 60_000, "1000 fights took \(Int(ms)) ms")
        XCTAssertGreaterThan(winners[.attacker] ?? 0, 0)
        XCTAssertGreaterThan(winners[.defender] ?? 0, 0)
    }
}
