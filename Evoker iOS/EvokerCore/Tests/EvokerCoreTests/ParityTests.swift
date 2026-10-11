import Foundation
import XCTest
@testable import EvokerCore

/// Rules-parity regression tests against the web code (`Evoker Web/src`): behaviour the goldens do not exercise.
///
/// `testEngineFuzzParity` replays `Parity/engine-fuzz.json` (Tools/gen-parity.mjs): 400 random raw-buff fights run
/// through the WEB engine, timeline and board model, covering every handler / event / scope / pick / filter /
/// extension field in combinations the catalog never produces (pre-damaged cards, unknown race names, forced race
/// bonus, short round limits, nextRound queues, strengthFromEvent, triggerDirection, damagedBySelf, ...).
/// The other tests pin single differences found by the line-by-line review, with the expected values computed
/// from the web module (`node -e "import(...)"`).
final class ParityTests: XCTestCase {
    struct FuzzCase: Decodable {
        let name: String
        let cfg: BattleConfig
        let expected: Expected
    }
    struct Expected: Decodable {
        let result: BattleResult
        let events: JSONValue
        let steps: [StepRow]
        let durationsAt2x: [Int]
        let final: JSONValue
        let lethalStep: Int
    }
    struct StepRow: Decodable {
        let type: String
        let dur: Int
        let base: Int?
        let factor: Double?
        let events: Int
    }

    static func parityURL(_ name: String) -> URL {
        if let u = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Parity") { return u }
        let here = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        return here.appendingPathComponent("Parity").appendingPathComponent(name + ".json")
    }

    /// The board model as model.js finalState serialises it (the typed `tribe` is left out: unknown race names
    /// of raw cards cannot be represented, see CONTRACTS.md §6).
    static func modelJSON(_ m: BoardModel) -> JSONValue {
        func side(_ s: BoardSide) -> JSONValue {
            .object([
                "player": .object(["name": .string(s.player.name), "hp": .number(Double(s.player.hp)), "maxHp": .number(Double(s.player.maxHp))]),
                "cards": .array(s.cards.map { c in
                    guard let c else { return .null }
                    var o: [String: JSONValue] = ["hp": .number(Double(c.hp)), "maxHp": .number(Double(c.maxHp)), "attack": .number(Double(c.attack)),
                                                  "baseAttack": .number(Double(c.baseAttack)), "dead": .bool(c.dead)]
                    if let id = c.cardId { o["cardId"] = .string(id) }
                    if let n = c.name { o["name"] = .string(n) }
                    return .object(o)
                }),
            ])
        }
        return .object([
            "round": .number(Double(m.round)),
            "winner": m.winner.map { .string($0.rawValue) } ?? .null,
            "ended": .bool(m.ended),
            "rounds": .number(Double(m.rounds)),
            "attacker": side(m.attacker),
            "defender": side(m.defender),
            "deaths": .object(["attacker": .number(Double(m.deaths.attacker)), "defender": .number(Double(m.deaths.defender))]),
        ])
    }

    static func stripTribe(_ model: JSONValue) -> JSONValue {
        guard case .object(var o) = model else { return model }
        for side in ["attacker", "defender"] {
            guard case .object(var s)? = o[side], case .array(let cards)? = s["cards"] else { continue }
            s["cards"] = .array(cards.map { card in
                guard case .object(var c) = card else { return card }
                c["tribe"] = nil
                return .object(c)
            })
            o[side] = .object(s)
        }
        return .object(o)
    }

    /// The first event at which two logs differ, with both events printed (Swift first, web second).
    static func firstEventDifference(_ a: JSONValue, _ b: JSONValue) -> String? {
        guard case .array(let la) = a, case .array(let lb) = b else { return Canon.firstDifference(a, b) }
        for (i, (x, y)) in zip(la, lb).enumerated() {
            if let d = Canon.firstDifference(x, y, path: "events[\(i)]") {
                return "\(d)\n    swift: \(x.canonical())\n    web:   \(y.canonical())"
            }
        }
        if la.count != lb.count {
            let i = min(la.count, lb.count)
            let extra = la.count > lb.count ? "swift has \(la.count - lb.count) more, next: \(la[i].canonical())" : "web has \(lb.count - la.count) more, next: \(lb[i].canonical())"
            return "events: length \(la.count) != \(lb.count); \(extra)"
        }
        return nil
    }

    // MARK: single differences pinned from the web

    /// battle-state.js normaliseBuff: `if (b.type === 'attack' && dirs == null) b.directions = cardDirs` — an attack
    /// buff with an explicit `directions: []` keeps the empty list and the handler hits the opposing player once
    /// for the whole attack; only a MISSING list takes the card's directions. Expected values from the web engine
    /// (node, maxRounds 3, a lone orc attacker with a card in front): empty → defender player 900, front card
    /// untouched; missing → the front card takes 100 per round and the players stay even.
    func testAttackBuffWithEmptyDirectionsHitsThePlayer() throws {
        func fight(_ buffs: [Buff]) -> BattleOutcome {
            let a = BattleCard(instanceId: "a", cardId: "a", name: "A1", tribe: .orc, attack: 100, maxHp: 500, hp: 500, abilityValue: 0, dirs: [.direct], buffs: buffs)
            let d = BattleCard(instanceId: "d", cardId: "d", name: "D1", tribe: .elf, attack: 30, maxHp: 400, hp: 400, abilityValue: 0, dirs: [.direct],
                               buffs: [Buff(type: .attack, directions: [.front], event: .always)])
            let cfg = BattleConfig(attacker: FighterSide(player: FighterPlayer(name: "A", hp: 1000, maxHp: 1000), cards: [nil, nil, a, nil, nil]),
                                   defender: FighterSide(player: FighterPlayer(name: "D", hp: 1000, maxHp: 1000), cards: [nil, nil, d, nil, nil]),
                                   seed: 7, options: BattleOptions(maxRounds: 3))
            return BattleEngine().simulateBattle(cfg)
        }
        func attackerTargets(_ out: BattleOutcome) -> [[AttackTarget]] {
            out.events.compactMap { ev in
                if case .attack(let side, _, _, _, let targets) = ev, side == .attacker { return targets }
                return nil
            }
        }
        let empty = fight([Buff(type: .attack, directions: [], event: .always)])
        XCTAssertEqual(empty.result.winner, .attacker)
        XCTAssertEqual(empty.result.attackerHp, 1200, "the lone orc earns the race bonus on a raw side")
        XCTAssertEqual(empty.result.defenderHp, 900)
        XCTAssertEqual(attackerTargets(empty).count, 3)
        for t in attackerTargets(empty) {
            XCTAssertEqual(t.count, 1)
            XCTAssertEqual(t[0].side, .defender)
            XCTAssertNil(t[0].slot, "no target: the opposing player takes the whole attack")
            XCTAssertEqual(t[0].damage, 100)
            XCTAssertNil(t[0].dir)
        }
        let missing = fight([Buff(type: .attack, event: .always)])
        XCTAssertEqual(missing.result.winner, .draw)
        XCTAssertEqual(missing.result.defenderHp, 1200)
        for t in attackerTargets(missing) {
            XCTAssertEqual(t.count, 1)
            XCTAssertEqual(t[0].slot, 2, "a missing list takes the card's directions: the front card")
            XCTAssertEqual(t[0].dir, "front")
        }
        // the JSON shape keeps the distinction through a round trip
        let decoded = try JSONDecoder().decode(Buff.self, from: Data(#"{"type":"attack","directions":[],"event":"always"}"#.utf8))
        XCTAssertTrue(decoded.directionsSpecified)
        let bare = try JSONDecoder().decode(Buff.self, from: Data(#"{"type":"attack","event":"always"}"#.utf8))
        XCTAssertFalse(bare.directionsSpecified)
        let again = try JSONDecoder().decode(Buff.self, from: JSONEncoder().encode(bare))
        XCTAssertFalse(again.directionsSpecified)
    }

    /// `String.prototype.localeCompare` (ICU root) on names: punctuation follows the CLDR order (`_`, `-` before `'`),
    /// letters compare case-insensitively, a full tie puts the lowercase form first. Signs from node 22.
    func testLocaleCompareFollowsIcuRootCollation() {
        let pairs: [(String, String, Int)] = [
            ("alice", "Alice", -1), ("Alice", "alice", 1), ("Zoe", "adam", 1), ("Ann Marie", "Ann-Marie", -1),
            ("Will-o'-the-Wisp", "Will-o'-the-Wisp", 0), ("a", "ab", -1), ("Bone Breaker", "Bone-breaker", -1),
            ("Lich King", "lich king", 1), ("Orc", "orc-grunt", -1), ("Dark_Mage", "Dark Mage", 1),
            ("Will-o'-the-Wisp", "Will-o-the-Wisp", 1), ("O'Neil", "O-Neil", 1), ("abc", "ABD", -1), ("", "a", -1),
            ("a-b", "a b", 1), ("a_b", "a b", 1), ("ab", "a b", 1), ("a1", "a b", 1), ("a1", "ab", -1), ("a!", "a-", 1),
            ("A", "a", 1), ("Ab", "aB", 1), ("aB", "Ab", -1), ("a", "A", -1),
        ]
        for (a, b, sign) in pairs {
            XCTAssertEqual(JSString.localeCompare(a, b), sign, "\"\(a)\" vs \"\(b)\"")
        }
        // the real names sort as node sorts them
        let names = RealData.names.names.sorted { JSString.localeCompare($0, $1) < 0 }
        XCTAssertEqual(Array(names.prefix(12)), ["Aelric", "Amaryllis", "Anwen", "ArcaneFox", "Ashwyn", "Baldrik", "Bloodaxe", "Boromund", "Brokk", "Brunhild", "Caelia", "Calyx"])
        let cards = RealData.db.all().map { $0.name }.sorted { JSString.localeCompare($0, $1) < 0 }
        XCTAssertEqual(Array(cards.prefix(10)), ["Adept", "Air Elemental", "Airborne Parasite", "Alchemist", "Anvil Guard", "Arch Angel", "Arch Demon", "Archer", "Argonaut", "Armorer"])
        XCTAssertEqual(Array(cards.suffix(6)), ["Wilderness Shaper", "Will-o'-the-Wisp", "Wolf Beast", "Wolf Shaman", "Worm Shaman", "Wrath Bringer"])
    }

    /// abilities.js formatValue / renderAbilityText (node 22).
    func testFormatValueAndRenderAbilityText() {
        let cases: [(Double, String)] = [
            (12345, "12,345"), (1234.5, "1,234.5"), (-5, "-5"), (0.1 + 0.2, "0.3"), (1234567.25, "1,234,567.3"), (0, "0"),
            (-0.5, "-0.5"), (999.95, "1,000"), (100.04, "100"), (1e6, "1,000,000"), (12.345, "12.3"), (.nan, "?"), (.infinity, "?"),
        ]
        for (v, text) in cases { XCTAssertEqual(Abilities.formatValue(v), text, "\(v)") }
        XCTAssertEqual(Abilities.formatValue(nil), "?")
        let plain = AbilityDef.single(AbilityEntry(text: "Heals {v} and {pct}", buffs: []))
        XCTAssertEqual(Abilities.renderAbilityText(plain, value: 12.5), "Heals 12.5 and 12.5%")
        XCTAssertEqual(Abilities.renderAbilityText(.single(AbilityEntry(text: "{v}", buffs: [])), value: nil), "?")
        XCTAssertEqual(Abilities.renderAbilityText(.single(AbilityEntry(text: "{v} {pct}", buffs: [])), value: .nan), "? ?%")
        let staged = AbilityDef.byStage([nil, AbilityEntry(text: "S1 {v}", buffs: []), nil, nil, nil], notes: nil)
        XCTAssertEqual(Abilities.renderAbilityText(staged, value: 7, stage: 9), "", "the stage clamps to the last entry (nil)")
        XCTAssertEqual(Abilities.renderAbilityText(staged, value: 7, stage: -2), "", "a negative stage clamps to the first entry (nil)")
        XCTAssertEqual(Abilities.renderAbilityText(staged, value: 7, stage: 1), "S1 7")
    }

    /// state.js utcDay / utcDayStart, shop.js previousDay, store.js shiftDay (node 22).
    func testUtcDateHelpers() {
        let days: [(Int64, String, Int64)] = [
            (0, "1970-01-01", 0), (-1, "1969-12-31", -86_400_000), (-86_400_000, "1969-12-31", -86_400_000),
            (951_782_400_000, "2000-02-29", 951_782_400_000), (951_868_799_999, "2000-02-29", 951_782_400_000),
            (951_868_800_000, "2000-03-01", 951_868_800_000), (1_704_067_199_999, "2023-12-31", 1_703_980_800_000),
            (1_704_067_200_000, "2024-01-01", 1_704_067_200_000), (4_102_444_800_000, "2100-01-01", 4_102_444_800_000),
            (1_760_184_000_000, "2025-10-11", 1_760_140_800_000), (253_402_300_799_999, "9999-12-31", 253_402_214_400_000),
        ]
        for (t, day, start) in days {
            XCTAssertEqual(JSDate.utcDay(t), day, "\(t)")
            XCTAssertEqual(JSDate.utcDayStart(t), start, "\(t)")
        }
        let shifts: [(String, String, String, String)] = [
            ("2024-02-29", "2024-02-28", "2024-01-29", "2025-02-28"), ("2024-03-01", "2024-02-29", "2024-01-30", "2025-03-01"),
            ("2023-03-01", "2023-02-28", "2023-01-29", "2024-02-29"), ("2000-01-01", "1999-12-31", "1999-12-01", "2000-12-31"),
            ("1970-01-01", "1969-12-31", "1969-12-01", "1971-01-01"), ("2026-10-07", "2026-10-06", "2026-09-06", "2027-10-07"),
        ]
        for (day, prev, minus31, plus365) in shifts {
            XCTAssertEqual(JSDate.previousDay(day), prev)
            XCTAssertEqual(JSDate.shiftDay(day, -31 * JSDate.dayMs), minus31)
            XCTAssertEqual(JSDate.shiftDay(day, 365 * JSDate.dayMs), plus365)
        }
        XCTAssertEqual(JSDate.shiftDay("", 5), "")
        XCTAssertEqual(JSDate.shiftDay("nonsense", 5), "nonsense")
    }

    /// store.js seedFromNow, state.js mixSeed and the shop.js dailyEvent hash (node 22).
    func testSeedHashes() {
        let seeds: [(Int64, UInt32)] = [
            (0, 3_108_667_723), (1, 226_214_301), (1_760_184_000_000, 2_315_338_646), (4_294_967_295, 1_350_286_657),
            (4_294_967_296, 3_108_667_723), (9_007_199_254_740_991, 1_350_286_657), (-5, 2_150_183_801),
        ]
        for (now, seed) in seeds { XCTAssertEqual(Seeds.seedFromNow(now), seed, "\(now)") }
        let mixes: [(UInt32, Int, UInt32)] = [
            (1, 1, 2_980_047_484), (0, 0, 0), (4_294_967_295, 2_147_483_647, 167_747_872), (4242, 7, 1_724_430_309),
            (123_456_789, -3, 1_323_050_217), (1, 4_294_967_296, 1_364_076_727),
        ]
        for (seed, step, mixed) in mixes { XCTAssertEqual(Seeds.mixSeed(seed, step), mixed, "\(seed) \(step)") }
        let events: [(Int64, DailyEventId)] = [
            (0, .getTheBestCards), (86_400_000 * 20000, .goldenDay), (1_760_184_000_000, .doubleLeaguePoints),
            (86_400_000 * (2_147_483_648 + 5), .doubleLeaguePoints), (-86_400_000 * 3, .greatPotionDeal),
        ]
        for (now, id) in events { XCTAssertEqual(ShopOps.dailyEvent(now: now, state: nil)?.id, id, "\(now)") }
    }

    /// pieces.js missingPrice beyond the wiki table (+800 per extra piece), unknown rarities on the Rare row,
    /// Card-piece Day halves with ceil (node 22).
    func testMissingPieceBeyondTheTable() {
        XCTAssertEqual(PieceOps.missingPrice(rarity: .rare, missing: 4, event: nil), 940)
        XCTAssertEqual(PieceOps.missingPrice(rarity: .rare, missing: 3, event: nil), 140)
        XCTAssertEqual(PieceOps.missingPrice(rarity: .heroic, missing: 6, event: nil), 2500)
        XCTAssertEqual(PieceOps.missingPrice(rarity: .legendary, missing: 10, event: nil), 4800)
        XCTAssertEqual(PieceOps.missingPrice(rarity: .ultimate, missing: 12, event: nil), 7300)
        XCTAssertEqual(PieceOps.missingPrice(rarity: .uncommon, missing: 2, event: nil), 820)
        XCTAssertEqual(PieceOps.missingPrice(rarity: .common, missing: 2, event: nil), 60)
        XCTAssertEqual(PieceOps.missingPrice(rarity: nil, missing: 2, event: nil), 60)
        XCTAssertEqual(PieceOps.missingPrice(rarity: .rare, missing: 0, event: nil), 0)
        XCTAssertEqual(PieceOps.missingPrice(rarity: .heroic, missing: 2, event: .cardPieceDay), 143)
        XCTAssertEqual(PieceOps.missingPrice(rarity: .legendary, missing: 9, event: .cardPieceDay), 2000)
    }

    /// player.js levelUpRewards over a whole cycle and at the cap (node 22).
    func testLevelUpRewardsCycle() {
        func r(_ level: Int) -> (Int, Int, [PotionKind], [TokenKind]) {
            let x = PlayerOps.levelUpRewards(level: level)
            return (x.gold, x.gems, x.potions, x.tokens)
        }
        XCTAssertTrue(r(1) == (0, 0, [], []))
        XCTAssertTrue(r(2) == (100, 5, [], []))
        XCTAssertTrue(r(3) == (150, 0, [.stamina], []))
        XCTAssertTrue(r(4) == (150, 0, [.stamina], []), "level 4 pays 150, not 200")
        XCTAssertTrue(r(5) == (250, 0, [.mana], []))
        XCTAssertTrue(r(6) == (300, 0, [], [.neophyte]))
        XCTAssertTrue(r(7) == (350, 50, [], []))
        XCTAssertTrue(r(8) == (400, 0, [.stamina], []))
        XCTAssertTrue(r(11) == (550, 0, [], [.neophyte]))
        XCTAssertTrue(r(12) == (600, 50, [], []))
        XCTAssertTrue(r(16) == (800, 0, [], [.neophyte]))
        XCTAssertTrue(r(17) == (850, 50, [], []))
        XCTAssertTrue(r(200) == (10000, 0, [.mana], []))
    }

    /// stats.js playerXpToNext: the low table, the curve and the cap (node 22).
    func testPlayerXpToNextCurve() {
        let expected: [(Int, Int?)] = [(1, 47), (2, 47), (3, 92), (4, 94), (5, 204), (6, 240), (7, 274), (50, 1533), (199, 5134), (200, nil)]
        for (level, xp) in expected { XCTAssertEqual(Stats.playerXpToNext(level: level), xp, "level \(level)") }
    }

    /// league.js simPoints for a pre-round-3 league (`rates`), a profile with `k: 0` (`p.k || 1`) and clamped times;
    /// pointsFor / nextTier / prizeFor edge cases (node 22).
    func testLeagueFormulas() {
        let old = League(v: 1, day: "", startedAt: 1_000_000, endsAt: 1_000_000 + JSDate.dayMs, tier: .bronze, power: 1, simIds: [], profiles: [:],
                         fights: [:], points: 0, doublePoints: true, settled: false, rates: ["sim-1": 7.5, "sim-2": 0.4])
        XCTAssertEqual(LeagueOps.simPoints(old, simId: "sim-1", now: 1_000_000 + 43_200_000), 900)
        XCTAssertEqual(LeagueOps.simPoints(old, simId: "sim-2", now: 1_000_000 + 2 * JSDate.dayMs), 0)
        XCTAssertEqual(LeagueOps.simPoints(old, simId: "sim-3", now: 1_000_005), 0)
        let prof = League(v: 3, day: "", startedAt: 0, endsAt: JSDate.dayMs, tier: .bronze, power: 0.9, simIds: ["a", "b"],
                          profiles: ["a": SimProfile(w: 7, x: 123, k: 1.7, pic: true), "b": SimProfile(w: 3, x: 0, k: 0, pic: false)])
        XCTAssertEqual(LeagueOps.simPoints(prof, simId: "a", now: 43_200_000), 337)
        XCTAssertEqual(LeagueOps.simPoints(prof, simId: "b", now: 43_200_000), 150, "k 0 counts as 1")
        XCTAssertEqual(LeagueOps.simPoints(prof, simId: "a", now: -5), 0)
        XCTAssertEqual(LeagueOps.simPoints(prof, simId: "a", now: 99_999_999_999), 1173, "the time clamps to the end")
        XCTAssertEqual(LeagueOps.pointsFor(nil, source: .arena, event: nil, difficulty: .hard, oppLevel: 12, myLevel: 5), 187)
        XCTAssertEqual(LeagueOps.pointsFor(nil, source: .arena, event: nil, difficulty: .easy, oppLevel: 1, myLevel: 30), 12)
        var doubled = prof
        doubled.doublePoints = true
        XCTAssertEqual(LeagueOps.pointsFor(doubled, source: .pieces, event: nil, oppLevel: 9, myLevel: 7), 70)
        XCTAssertEqual(LeagueOps.pointsFor(nil, source: .league, event: nil, oppLevel: 1, myLevel: 50), 150, "league fights do not scale")
        XCTAssertEqual(LeagueOps.pointsFor(nil, source: .arena, event: .doubleLeaguePoints, difficulty: .normal), 120)
        XCTAssertEqual(LeagueOps.nextTier(.bronze, rank: 3, points: 150), .silver)
        XCTAssertEqual(LeagueOps.nextTier(.bronze, rank: 4, points: 150), .bronze)
        XCTAssertEqual(LeagueOps.nextTier(.gold, rank: 1, points: 10), .gold)
        XCTAssertEqual(LeagueOps.nextTier(.silver, rank: 2, points: 0), .bronze, "a rank without points never promotes")
        XCTAssertEqual(LeagueOps.nextTier(.silver, rank: nil, points: 100), .bronze)
        XCTAssertEqual(LeagueOps.tierById("platinum").id, .gold)
        let gold1 = LeagueOps.prizeFor(rank: 1, tier: .gold)
        XCTAssertEqual(gold1.card, .legendary)
        XCTAssertEqual(gold1.potions, Array(repeating: PotionKind.mana, count: 12))
        XCTAssertEqual(LeagueOps.prizeFor(rank: 29, tier: .bronze).gems, 25)
        XCTAssertEqual(LeagueOps.prizeFor(rank: 30, tier: .bronze).gems, 0)
        XCTAssertEqual(LeagueOps.prizeFor(rank: nil, tier: .gold).potions, [])
        let gold5 = LeagueOps.prizeFor(rank: 5, tier: .gold)
        XCTAssertEqual(gold5.potions, Array(repeating: PotionKind.mana, count: 10) + Array(repeating: PotionKind.stamina, count: 10))
    }

    /// player.js goldWithEvent / cardFightXp / playerFightXp: JS rounds .5 up (node 22).
    func testFightRewardRounding() {
        XCTAssertEqual(PlayerOps.goldWithEvent(25, event: .goldenDay), 38)
        XCTAssertEqual(PlayerOps.goldWithEvent(1, event: .goldenDay), 2)
        XCTAssertEqual(PlayerOps.goldWithEvent(3, event: .goldenDay), 5)
        XCTAssertEqual(PlayerOps.goldWithEvent(7, event: nil), 7)
        XCTAssertEqual(PlayerOps.cardFightXp(enemyDeckMana: 0, won: false, infiniteWisdom: false), 10)
        XCTAssertEqual(PlayerOps.cardFightXp(enemyDeckMana: 1, won: false, infiniteWisdom: false), 11)
        XCTAssertEqual(PlayerOps.cardFightXp(enemyDeckMana: 3, won: true, infiniteWisdom: false), 17)
        XCTAssertEqual(PlayerOps.cardFightXp(enemyDeckMana: 5, won: true, infiniteWisdom: true), 38)
        XCTAssertEqual(PlayerOps.cardFightXp(enemyDeckMana: 7, won: false, infiniteWisdom: true), 27)
        XCTAssertEqual(PlayerOps.cardFightXp(enemyDeckMana: 45, won: true, infiniteWisdom: false), 49)
        XCTAssertEqual(PlayerOps.playerFightXp(opponentLevel: 1, won: true), 8)
        XCTAssertEqual(PlayerOps.playerFightXp(opponentLevel: 1, won: false), 2)
        XCTAssertEqual(PlayerOps.playerFightXp(opponentLevel: 8, won: true), 22)
        XCTAssertEqual(PlayerOps.playerFightXp(opponentLevel: 8, won: false), 6)
        XCTAssertEqual(PlayerOps.playerFightXp(opponentLevel: 0, won: true), 6)
        XCTAssertEqual(PlayerOps.playerFightXp(opponentLevel: -3, won: false), 2)
        XCTAssertEqual(PlayerOps.playerFightXp(opponentLevel: 200, won: true), 406)
    }

    /// `Parity/game-parity.json` (Tools/gen-parity-game.mjs): the web game functions the game goldens do not reach,
    /// on the real data with fixed seeds — stats with an evolve bonus below 1, every sort order of the Cards screen,
    /// the Shop list in every portal mode, boss line-ups (scripted and random), league ranking ties, tap gold, waves,
    /// band picks, sim profiles / decks / players, tap info and band positions.
    func testGameParity() throws {
        let data = try Data(contentsOf: ParityTests.parityURL("game-parity"))
        let g = try JSONValue.parse(data)
        let deps = Fx.realDeps()
        let db = RealData.db
        func check(_ label: String, _ actual: JSONValue, _ expected: JSONValue?, file: StaticString = #filePath, line: UInt = #line) {
            guard let expected else { XCTFail("\(label): missing in the fixture", file: file, line: line); return }
            if let d = Canon.firstDifference(actual, expected) { XCTFail("\(label): \(d)", file: file, line: line) }
        }
        func num(_ v: JSONValue?) -> Double { v?.doubleValue ?? 0 }
        func int(_ v: JSONValue?) -> Int { Int(num(v)) }
        func str(_ v: JSONValue?) -> String { v?.stringValue ?? "" }

        // stats with an evolve bonus
        for row in g["statsQ"]?.arrayValue ?? [] {
            let def = db.get(str(row["id"]))!
            let stage = int(row["stage"]), level = int(row["level"]), q = num(row["q"])
            let actual: JSONValue = .object([
                "attack": Stats.statAt(def, .attack, stage: stage, level: level, evolveQuality: q).map { .number($0) } ?? .null,
                "hp": Stats.statAt(def, .hp, stage: stage, level: level, evolveQuality: q).map { .number($0) } ?? .null,
                "ability": Stats.statAt(def, .ability, stage: stage, level: level, evolveQuality: q).map { .number($0) } ?? .null,
            ])
            let expected: JSONValue = .object(["attack": row["attack"] ?? .null, "hp": row["hp"] ?? .null, "ability": row["ability"] ?? .null])
            check("statAt \(def.id) s\(stage) l\(level) q\(q)", actual, expected)
        }

        // sortCards
        let col = try g["sortCards"]!["cards"]!.decode([CardInstance].self)
        for order in [CardSortOrder.default, .level, .mana, .name, .rarity, .attack] {
            let uids = CollectionOps.sortCards(col, db: db, order: order, stats: Stats()).map { JSONValue.string($0.uid) }
            check("sortCards \(order.rawValue)", .array(uids), g["sortCards"]?["orders"]?[order.rawValue])
        }

        // shopOffers
        let shop = g["shopOffers"]!
        let shopState = try shop["state"]!.decode(GameState.self)
        let now = Int64(num(shop["now"]))
        func offers(_ o: ShopOffers) -> JSONValue {
            .object([
                "event": o.event.map { .string($0.id.rawValue) } ?? .null,
                "potionDeal": o.potionDeal.map { .object(["gems": .number(Double($0.gems)), "potions": .number(Double($0.potions))]) } ?? .null,
                "boosters": .array(o.boosters.map { b in
                    .object(["id": .string(b.id.rawValue), "name": .string(b.name), "setName": b.setName.map(JSONValue.string) ?? .null,
                             "portalId": b.portalId.map(JSONValue.string) ?? .null, "price": .number(Double(b.price)), "discounted": .bool(b.discounted),
                             "tokens": .number(Double(b.tokens)), "left": .number(Double(b.left)), "pre": .bool(b.pre),
                             "endsInMs": .number(Double(b.endsInMs)), "startsInMs": .number(Double(b.startsInMs))])
                }),
            ])
        }
        check("shopOffers rotation", offers(ShopOps.shopOffers(shopState, deps: deps, now: now, portal: .rotation)), shop["rotation"])
        check("shopOffers explicit", offers(ShopOps.shopOffers(shopState, deps: deps, now: now, portal: .portal("dying-dreams"))), shop["explicit"])
        check("shopOffers none", offers(ShopOps.shopOffers(shopState, deps: deps, now: now, portal: .none)), shop["none"])
        check("shopOffers main", offers(ShopOps.shopOffers(shopState, deps: deps, now: now, portal: .portal("main"))), shop["main"])

        // bossLineup
        for row in g["bossLineups"]?.arrayValue ?? [] {
            let line = str(row["line"]), n = int(row["n"]), seed = UInt32(num(row["seed"]))
            let quest = QuestOps.getQuest(deps: deps, lineId: line, n: n)!
            let lineup = QuestOps.bossLineup(quest: quest, rng: Mulberry32(seed), db: db, stats: Stats(), lineId: line)
            check("bossLineup \(line) \(n) seed \(seed)", try JSONValue.of(lineup), row["lineup"])
        }

        // rankRows
        let rows: [LeagueRow] = (g["rankRows"]?["rows"]?.arrayValue ?? []).map { r in
            LeagueRow(id: str(r["id"]), name: str(r["name"]), avatar: 0, picture: true, level: 1, points: int(r["points"]), isPlayer: r["isPlayer"]?.boolValue ?? false, fightsLeft: 0)
        }
        let ranked: [JSONValue] = LeagueOps.rankRows(rows).map { r in
            .object(["id": .string(r.id), "rank": r.rank.map { .number(Double($0)) } ?? .null, "rankText": .string(r.rankText)])
        }
        check("rankRows", .array(ranked), g["rankRows"]?["ranked"])

        // rollTapGold
        for row in g["tapGold"]?.arrayValue ?? [] {
            let quest = QuestOps.getQuest(deps: deps, lineId: str(row["line"]), n: int(row["n"]))!
            let event = row["event"]?.stringValue.flatMap { DailyEventId(rawValue: $0) }
            let out = RewardOps.rollTapGold(rng: Mulberry32(UInt32(num(row["seed"]))), quest: quest, last: row["last"]?.boolValue ?? false, event: event)
            check("rollTapGold \(str(row["line"])) \(int(row["n"])) seed \(int(row["seed"])) last \(row["last"]?.boolValue ?? false) \(event?.rawValue ?? "-")", try JSONValue.of(out), row["out"])
        }

        // generateWaves / pickBandCard
        for row in g["waves"]?.arrayValue ?? [] {
            let quest = QuestOps.getQuest(deps: deps, lineId: str(row["line"]), n: int(row["n"]))!
            let waves = QuestOps.generateWaves(rng: Mulberry32(UInt32(num(row["seed"]))), deps: deps, quest: quest)
            check("generateWaves \(str(row["line"])) \(int(row["n"]))", try JSONValue.of(waves), row["waves"])
        }
        for row in g["bandPicks"]?.arrayValue ?? [] {
            let rarities = (row["band"]?["rarities"]?.arrayValue ?? []).compactMap { $0.stringValue.flatMap { Rarity(rawValue: $0) } }
            let band = QuestBand(rarities: rarities, levels: [1, 1], stages: nil)
            let rng = Mulberry32(5)
            let ids: [JSONValue] = (0..<6).map { _ in RewardOps.pickBandCard(rng: rng, db: db, band: band).map { .string($0.id) } ?? .null }
            check("pickBandCard \(rarities)", .array(ids), row["ids"])
        }

        // simProfile / buildSimDeck / makeSim
        for row in g["simProfiles"]?.arrayValue ?? [] {
            let tier = LeagueOps.tierById(str(row["tier"]))
            let rng = Mulberry32(31)
            let profiles = (0..<12).map { _ in LeagueOps.simProfile(rng: rng, tier: tier) }
            check("simProfile \(tier.id.rawValue)", try JSONValue.of(profiles), row["profiles"])
        }
        for row in g["simDecks"]?.arrayValue ?? [] {
            let level = int(row["level"]), power = num(row["power"])
            let seed = UInt32(level * 10 + JSMath.roundInt(power * 10))
            let deck = OpponentOps.buildSimDeck(rng: Mulberry32(seed), deps: deps, level: level, power: power)
            check("buildSimDeck level \(level) power \(power)", try JSONValue.of(deck), row["deck"])
        }
        for row in g["makeSims"]?.arrayValue ?? [] {
            let level = int(row["level"])
            let sim = OpponentOps.makeSim(rng: Mulberry32(UInt32(level + 3)), deps: deps, id: "sim-x", level: level, day: "2026-10-07", name: "Name")
            check("makeSim level \(level)", try JSONValue.of(sim), row["sim"])
        }

        // questTapInfo / bandPosition
        for row in g["tapInfo"]?.arrayValue ?? [] {
            let quest = QuestOps.getQuest(deps: deps, lineId: str(row["line"]), n: int(row["n"]))!
            let info = QuestOps.questTapInfo(quest)
            let actual: JSONValue = .object(["stamina": .number(Double(info.stamina)), "gold": .number(Double(info.gold)), "xp": .number(Double(info.xp)),
                                             "figures": .number(Double(info.figures)), "burstChance": .number(info.burstChance), "endGold": .number(Double(info.endGold))])
            check("questTapInfo \(str(row["line"])) \(int(row["n"]))", actual, row["info"])
        }
        for row in g["bandPosition"]?.arrayValue ?? [] {
            let v = row.arrayValue ?? []
            XCTAssertEqual(QuestOps.bandPosition(lineId: str(v[0]), n: int(v[1])), num(v[2]), accuracy: 1e-12, "bandPosition \(str(v[0])) \(int(v[1]))")
        }
    }

    func testEngineFuzzParity() throws {
        let data = try Data(contentsOf: ParityTests.parityURL("engine-fuzz"))
        let cases = try JSONDecoder().decode([FuzzCase].self, from: data)
        XCTAssertEqual(cases.count, 400)
        var failures = 0
        for c in cases {
            let out = BattleEngine().simulateBattle(c.cfg)
            var bad = false
            if let d = Canon.firstDifference(try JSONValue.of(out.result), try JSONValue.of(c.expected.result)) {
                XCTFail("\(c.name): result differs: \(d)"); bad = true
            }
            if let d = ParityTests.firstEventDifference(EventProjection.project(try JSONValue.of(out.events)), EventProjection.project(c.expected.events)) {
                XCTFail("\(c.name): events differ: \(d)"); bad = true
            }
            if !bad {
                let steps = Timeline.fromEvents(out.events)
                let rows: [JSONValue] = steps.map { s in
                    .object(["type": .string(s.kind.rawValue), "dur": .number(Double(s.durationMs)), "base": s.baseMs.map { .number(Double($0)) } ?? .null,
                             "factor": s.factor.map { .number($0) } ?? .null, "events": .number(Double(s.events.count))])
                }
                let expectedRows: [JSONValue] = c.expected.steps.map { r in
                    .object(["type": .string(r.type), "dur": .number(Double(r.dur)), "base": r.base.map { .number(Double($0)) } ?? .null,
                             "factor": r.factor.map { .number($0) } ?? .null, "events": .number(Double(r.events))])
                }
                if let d = Canon.firstDifference(.array(rows), .array(expectedRows)) { XCTFail("\(c.name): timeline differs: \(d)"); bad = true }
                let fast = Timeline.fromEvents(out.events, speed: 2).map { $0.durationMs }
                if fast != c.expected.durationsAt2x { XCTFail("\(c.name): 2x durations differ"); bad = true }
                let final = ParityTests.modelJSON(BoardModel.final(events: out.events))
                if let d = Canon.firstDifference(final, ParityTests.stripTribe(c.expected.final)) { XCTFail("\(c.name): final board differs: \(d)"); bad = true }
                let lethal = Timeline.lethalStep(out.events, steps: steps)
                if lethal != c.expected.lethalStep { XCTFail("\(c.name): lethal step \(lethal) != \(c.expected.lethalStep)"); bad = true }
            }
            if bad { failures += 1 }
            if failures >= 8 { XCTFail("stopping after 8 failing cases"); break }
        }
    }
}
