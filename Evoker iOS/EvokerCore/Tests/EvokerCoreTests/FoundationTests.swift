import Foundation
import XCTest
@testable import EvokerCore

/// The JS-compatibility layer and the shared models: numbers, the rng, dates, slugs, Codable round trips.
final class JSMathTests: XCTestCase {
    func testRoundHalfUp() {
        XCTAssertEqual(JSMath.round(2.5), 3)
        XCTAssertEqual(JSMath.round(-2.5), -2)
        XCTAssertEqual(JSMath.round(-3.5), -3)
        XCTAssertEqual(JSMath.round(0.49999), 0)
        XCTAssertEqual(JSMath.round(1.5), 2)
        XCTAssertEqual(JSMath.roundInt(-0.4), 0)
        XCTAssertEqual(JSMath.roundInt(199.5), 200)
        XCTAssertEqual(JSMath.roundInt(1162.0), 1162)
    }

    func testInt32Semantics() {
        XCTAssertEqual(JSMath.toInt32(4294967295), -1)
        XCTAssertEqual(JSMath.toInt32(2147483648), -2147483648)
        XCTAssertEqual(JSMath.toUInt32(-1), 4294967295)
        XCTAssertEqual(JSMath.toInt32(3.9), 3)
        XCTAssertEqual(JSMath.toInt32(-3.9), -3)
        XCTAssertEqual(JSMath.imul(0xffffffff, 5), 0xfffffffb)
        XCTAssertEqual(JSMath.floorInt(-0.5), -1)
        XCTAssertEqual(JSMath.ceilInt(110.2), 111)
    }

    func testUtcDays() {
        XCTAssertEqual(JSDate.utcDay(0), "1970-01-01")
        XCTAssertEqual(JSDate.utcDay(1_759_881_600_000), "2025-10-08")
        XCTAssertEqual(JSDate.utcDay(1_791_417_600_000 - 1), "2026-10-07")
        XCTAssertEqual(JSDate.utcDay(1_791_417_600_000), "2026-10-08")
        XCTAssertEqual(JSDate.utcDayStart(1_759_881_600_000 + 12_345), 1_759_881_600_000)
        XCTAssertEqual(JSDate.parseDay("2025-10-08"), 1_759_881_600_000)
        XCTAssertEqual(JSDate.previousDay("2024-03-01"), "2024-02-29")
        XCTAssertEqual(JSDate.shiftDay("", 1), "")
        XCTAssertEqual(JSDate.shiftDay("2025-10-08", -JSDate.dayMs), "2025-10-07")
    }

    func testSlugify() {
        XCTAssertEqual(Slug.slugify("Will-o'-the-Wisp"), "will-o-the-wisp")
        XCTAssertEqual(Slug.slugify("Arch Angel"), "arch-angel")
        XCTAssertEqual(Slug.slugify("  Siribia, Morning Dew!! "), "siribia-morning-dew")
        XCTAssertEqual(Slug.slugify("Café Élan"), "cafe-elan")
    }
}

final class RngTests: XCTestCase {
    /// First values of mulberry32(42) as JavaScript produces them (recorded in Golden/rng.json by gen-goldens).
    func testMulberry32MatchesTheWeb() throws {
        struct RngGolden: Decodable { let seed: UInt32; let next: [Double]; let ints: [Int]; let chance: [Bool] }
        let cases = try Golden.load("rng", as: [RngGolden].self)
        XCTAssertFalse(cases.isEmpty)
        for c in cases {
            let rng = Mulberry32(c.seed)
            for (i, v) in c.next.enumerated() {
                XCTAssertEqual(rng.next(), v, accuracy: 0, "seed \(c.seed) next[\(i)]")
            }
            let rng2 = Mulberry32(c.seed)
            for (i, v) in c.ints.enumerated() { XCTAssertEqual(rng2.int(100), v, "seed \(c.seed) int[\(i)]") }
            let rng3 = Mulberry32(c.seed)
            for (i, v) in c.chance.enumerated() { XCTAssertEqual(rng3.chance(0.3), v, "seed \(c.seed) chance[\(i)]") }
        }
    }

    func testSeedMixing() throws {
        struct SeedGolden: Decodable { let mixSeed: [[UInt32]]; let seedFromNow: [[Int64]]; let dailyEventIndex: [[Int]] }
        let g = try Golden.load("seeds", as: SeedGolden.self)
        for row in g.mixSeed { XCTAssertEqual(Seeds.mixSeed(row[0], Int(row[1])), row[2], "mixSeed(\(row[0]), \(row[1]))") }
        for row in g.seedFromNow { XCTAssertEqual(Int64(Seeds.seedFromNow(row[0])), row[1], "seedFromNow(\(row[0]))") }
        for row in g.dailyEventIndex { XCTAssertEqual(Seeds.dailyEventIndex(dayNumber: row[0], count: 7), row[1], "dailyEventIndex(\(row[0]))") }
    }

    func testVariantPicker() {
        let p = Seeds.VariantPicker(seed: 7)
        let list = ["a", "b", "c"]
        let seq = (0..<6).map { _ in p.pick(list)! }
        XCTAssertEqual(seq.count, 6)
        let p2 = Seeds.VariantPicker(seed: 7)
        XCTAssertEqual((0..<6).map { _ in p2.pick(list)! }, seq)
        XCTAssertNil(p.pick([String]()))
    }
}

final class ModelsTests: XCTestCase {
    func testRealDataLoads() {
        XCTAssertEqual(RealData.db.size, 195)
        XCTAssertNotNil(RealData.db.get("dwarf-king"))
        XCTAssertEqual(RealData.quests.main.nodes.count, 100)
        XCTAssertEqual(RealData.quests.portals.count, 8)
        XCTAssertEqual(RealData.quests.portals.map { $0.nodes.count }, Array(repeating: 25, count: 8))
        XCTAssertEqual(RealData.names.avatars.count, 12)
        XCTAssertEqual(RealData.db.all().first?.id, "adept", "catalog order must be the file order")
    }

    func testAbilityDecoding() throws {
        let king = RealData.db.get("dwarf-king")!
        guard case .single(let entry)? = king.ability else { return XCTFail("dwarf-king has a plain ability") }
        XCTAssertEqual(entry.buffs.first?.type, .raise_attack)
        XCTAssertEqual(entry.buffs.first?.directions, [.left, .right])
        XCTAssertEqual(entry.buffs.first?.strength, .value)
        let yeti = RealData.db.get("bog-yeti")!
        guard case .byStage(let stages, _)? = yeti.ability else { return XCTFail("bog-yeti evolves") }
        XCTAssertEqual(stages.count, 5)
        XCTAssertEqual(yeti.ability?.entry(stage: 0)?.buffs.count, 0)
        XCTAssertEqual(yeti.ability?.entry(stage: 1)?.buffs.first?.type, .invulnerable)
        // encoding keeps the web's shape
        let text = try Canon.text(king.ability!)
        XCTAssertTrue(text.contains("\"strength\":\"value\""))
        XCTAssertTrue(text.contains("\"event\":\"always\""))
    }

    func testBattleEventRoundTrip() throws {
        let events: [BattleEvent] = [
            .battleStart(seed: 7, attacker: SideSnapshot(player: PlayerSnapshot(name: "A", hp: 1500, maxHp: 1500), cards: [CardSnapshot(cardId: "envoy", name: "Envoy", tribe: .elf, attack: 100, hp: 100, maxHp: 100)]),
                         defender: SideSnapshot(player: PlayerSnapshot(name: "B", hp: 300, maxHp: 300, baseMaxHp: 250, tribeBonus: true), cards: [])),
            .roundStart(round: 1, attackerHp: 1500, defenderHp: 300),
            .status(side: .defender, slot: 2, status: .stunned, on: true, source: EventSource(side: .attacker, slot: 1, effect: "no_damage")),
            .buff(side: .attacker, slot: nil, stat: .maxHp, delta: 200, permanent: false, source: nil),
            .attack(side: .attacker, slot: 0, attack: 100, bonus: false, targets: [AttackTarget(side: .defender, slot: nil, damage: 100, blocked: false, dir: "front")]),
            .damage(side: .defender, slot: nil, amount: 100, hp: 200, cause: .attack, blocked: false, source: EventSource(side: .attacker, slot: 0, effect: "attack")),
            .heal(side: .attacker, slot: 1, amount: 50, hp: 150, source: nil),
            .death(side: .defender, slot: 3, card: CardSnapshot(cardId: "x", tribe: .orc, attack: 1, hp: 0, maxHp: 10)),
            .revive(side: .defender, slot: 3, hp: 10, attack: 1, source: nil),
            .roundEnd(round: 1, attackerHp: 1500, defenderHp: 200, cards: RoundHpSnapshot(attacker: [100, 0, 0, 0, 0], defender: [0, 0, 0, 0, 0])),
            .battleEnd(winner: .attacker, rounds: 3, attackerHp: 1500, defenderHp: -40, endedBy: .playerHp),
        ]
        let data = try JSONEncoder().encode(events)
        let back = try JSONDecoder().decode([BattleEvent].self, from: data)
        XCTAssertEqual(back, events)
        let json = try JSONValue.parse(data)
        XCTAssertEqual(json[0]?["t"]?.stringValue, "battleStart")
        XCTAssertEqual(json[3]?["slot"], .null, "a player buff carries slot: null like the web")
        XCTAssertEqual(json[4]?["targets"]?[0]?["slot"], .null)
    }

    func testGameStateDecodesAWebSaveLeniently() throws {
        let raw = """
        {"version":1,"createdAt":1,"lastSeen":2,"seed":123,"player":{"name":"Me","level":3,"gold":50,"tokens":{"neophyte":1,"portalLow":{"the-dark-beyond":2}}},
         "cards":[{"uid":"c1","cardId":"envoy"},{"uid":"c2","cardId":"master-brewer","stage":1,"level":4,"xp":10}],
         "deck":[null,"c1",null,null,null],"quests":{"main":{"unlocked":3,"done":2,"firstWins":[1,2]}},
         "sim":{"players":[],"league":null},"settings":{"sound":false},"tutorial":{"r3":{"intro":true,"lost":[2],"seen":[],"named":false,"done":false}},
         "futureField":{"x":1}}
        """
        let state = try JSONDecoder().decode(GameState.self, from: Data(raw.utf8))
        XCTAssertEqual(state.player.name, "Me")
        XCTAssertEqual(state.player.level, 3)
        XCTAssertEqual(state.player.stamina, 50, "missing fields take the defaults")
        XCTAssertEqual(state.player.tokens.count(.portalLow, portalId: "the-dark-beyond"), 2)
        XCTAssertEqual(state.cards.count, 2)
        XCTAssertEqual(state.cards[0].level, 1)
        XCTAssertEqual(state.cards[0].evolveQuality, 1)
        XCTAssertEqual(state.deck, [nil, "c1", nil, nil, nil])
        XCTAssertEqual(state.quests.main.firstWins, [1, 2])
        XCTAssertNil(state.sim.leagueJoined, "a save without the flag keeps it unknown")
        XCTAssertNil(state.sim.leagueTier)
        XCTAssertNil(state.player.deckSlots)
        XCTAssertEqual(state.settings.sound, false)
        XCTAssertEqual(state.tutorial.r3?.lost, [2])
        XCTAssertEqual(state.extras["futureField"], .object(["x": .number(1)]))
        let encoded = try JSONValue.of(state)
        XCTAssertEqual(encoded["futureField"], .object(["x": .number(1)]), "unknown keys survive a round trip")
        XCTAssertEqual(encoded["sim"]?["leagueJoined"], .null)
    }

    func testCanonicalJson() throws {
        let v = JSONValue.object(["b": .number(1.5), "a": .array([.null, .number(2), .string("x\"y")]), "n": .null, "t": .bool(true)])
        XCTAssertEqual(v.canonical(), "{\"a\":[null,2,\"x\\\"y\"],\"b\":1.5,\"t\":true}")
        XCTAssertEqual(v.canonical(dropNullKeys: false), "{\"a\":[null,2,\"x\\\"y\"],\"b\":1.5,\"n\":null,\"t\":true}")
        XCTAssertNil(Canon.firstDifference(v, v))
        XCTAssertEqual(Canon.firstDifference(.object(["x": .number(1)]), .object(["x": .number(2)])), "$.x: 1 != 2")
    }
}
