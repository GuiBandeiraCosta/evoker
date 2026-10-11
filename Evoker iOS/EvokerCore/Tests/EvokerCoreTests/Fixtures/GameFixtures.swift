import Foundation
import XCTest
@testable import EvokerCore

/// Save builders and dependency bundles of the game tests (`tests/fixtures/real.js`, `tests/fixtures-game/*.js`):
/// the fixed clock, the fixture-catalog deps (21 cards, stub stats, stub engine), the real-data deps (real
/// catalog, quests, names and `Stats`, with the stub engine whose winner the test chooses, or the real engine).
enum Fx {
    /// The tests' clock: 2026-10-07 12:00 UTC (`Date.UTC(2026, 9, 7, 12, 0, 0)`).
    static let T0: Int64 = JSDate.parseDay("2026-10-07")! + 12 * 60 * 60 * 1000
    static let MIN: Int64 = 60 * 1000
    static let DAY: Int64 = JSDate.dayMs
    static let rarityIds: [Rarity] = Rarity.order

    // MARK: fixture catalog (tests/fixtures-game)

    /// `makeDeps({winner})`: the fixture db, stub stats, stub engine, fixture quests and names.
    static func makeDeps(winner: Winner = .attacker) -> (deps: Deps, engine: FixtureEngine) {
        let engine = FixtureEngine(winner: winner)
        let deps = Deps(db: FixtureCatalog.makeDb(), stats: FixtureStats(), engine: engine, rng: { Mulberry32($0) }, quests: FixtureQuests.quests, names: FixtureQuests.names)
        return (deps, engine)
    }

    /// The pre-round-3 starting save (`classicGame`): 6 starter cards, Bone Breaker / Scout / Master Brewer in slots
    /// 1–3, 300 gold, 2 stamina + 1 mana potions, 3 open deck slots.
    static func classicGame(name: String, seed: UInt32, now: Int64) -> GameState {
        var state = StateOps.defaultState(now: now, seed: seed)
        state.player.name = name
        state.player.gold = 300
        state.player.staminaPotions = 2
        state.player.manaPotions = 1
        state.player.deckSlots = 3
        let ids = ["envoy", "pikeman", "pouch-tearer", "bone-breaker", "scout", "master-brewer"]
        var cards: [CardInstance] = []
        var uid: [String: String] = [:]
        for cardId in ids {
            let r = StateOps.nextUid(state)
            state = r.state
            cards.append(CardInstance(uid: r.uid, cardId: cardId, stage: 0, level: 1, xp: 0, evolveQuality: 1))
            uid[cardId] = r.uid
        }
        state.cards = cards
        state.deck = [nil, uid["bone-breaker"], uid["scout"], uid["master-brewer"], nil]
        return state
    }

    /// `stub.fresh(opts)`: the classic 6-card save with fixture deps.
    static func fresh(winner: Winner = .attacker) -> (state: GameState, deps: Deps, engine: FixtureEngine) {
        let d = makeDeps(winner: winner)
        return (classicGame(name: "Tester", seed: 4242, now: T0), d.deps, d.engine)
    }

    /// `stub.rich(state, extra)`: level 10, 100000 gold, 5000 gems, 200/200 mana, 500/500 stamina.
    static func richFixture(_ state: GameState, _ extra: (inout PlayerState) -> Void = { _ in }) -> GameState {
        var s = state
        s.player.level = 10
        s.player.gold = 100000
        s.player.gems = 5000
        s.player.mana = 200
        s.player.manaMax = 200
        s.player.stamina = 500
        s.player.staminaMax = 500
        extra(&s.player)
        return s
    }

    // MARK: real data (tests/fixtures/real.js)

    static var db: CardsDb { RealData.db }
    static var quests: QuestsData { RealData.quests }
    static var names: NamesData { RealData.names }

    /// `deps(winner)`: real db / stats / quests / names + the stub engine whose winner the test chooses.
    static func deps(_ winner: Winner = .attacker) -> (deps: Deps, engine: FixtureEngine) {
        let engine = FixtureEngine(winner: winner)
        return (Deps(db: RealData.db, stats: Stats(), engine: engine, rng: { Mulberry32($0) }, quests: RealData.quests, names: RealData.names), engine)
    }

    /// `realDeps()`: everything real, including the battle engine.
    static func realDeps() -> Deps {
        Deps(db: RealData.db, stats: Stats(), engine: BattleEngine(), rng: { Mulberry32($0) }, quests: RealData.quests, names: RealData.names)
    }

    /// `fresh()` of real.js: the classic 6-card save.
    static func freshReal() -> GameState {
        classicGame(name: "Tester", seed: 4242, now: T0)
    }

    /// `tutorialStart`: the real round-3 `newGame`.
    static func tutorialStart(_ d: Deps? = nil) -> GameState {
        StateOps.newGame(name: "Tester", seed: 4242, now: T0, deps: d ?? deps().deps)
    }

    /// `rich(state, extra)` of real.js: level 10, 1e6 gold, 1e5 gems, 300/300 mana, 5000/5000 stamina.
    static func rich(_ state: GameState, _ extra: (inout PlayerState) -> Void = { _ in }) -> GameState {
        var s = state
        s.player.level = 10
        s.player.gold = 1_000_000
        s.player.gems = 100_000
        s.player.mana = 300
        s.player.manaMax = 300
        s.player.stamina = 5000
        s.player.staminaMax = 5000
        extra(&s.player)
        return s
    }

    /// `give(state, deps, cardId, opts)`: add a card, returning the new state and the uid.
    static func give(_ state: GameState, _ d: Deps, _ cardId: String, stage: Int = 0, level: Int = 1, force: Bool = false) -> (GameState, String) {
        let r = try! CollectionOps.addCard(state, deps: d, cardId: cardId, stage: stage, level: level, force: force)
        return (r.state, r.info.uid ?? "")
    }

    /// First non-trainer card of a rarity (`sample`).
    static func sample(_ rarity: Rarity, _ n: Int = 0) -> CardDef {
        RealData.db.byRarity(rarity).filter { !$0.isTrainer }[n]
    }

    static func mainNode(_ n: Int) -> QuestNode { RealData.quests.main.nodes[n - 1] }
    static func portal(_ i: Int = 0) -> QuestLine { RealData.quests.portals[i] }
    static func within(_ x: Double, _ target: Double, _ tol: Double) -> Bool { abs(x - target) <= tol }

    /// Open deck slot indices of a save.
    static func openSlots(_ state: GameState) -> [Int] {
        (0..<5).filter { StateOps.slotUnlocked(state, slot: $0) }
    }

    /// A state with player fields changed.
    static func withPlayer(_ state: GameState, _ change: (inout PlayerState) -> Void) -> GameState {
        var s = state
        change(&s.player)
        return s
    }

    /// A state with the main-line progress replaced.
    static func withMain(_ state: GameState, unlocked: Int, done: Int, firstWins: [Int]) -> GameState {
        var s = state
        s.quests.main = LineProgress(unlocked: unlocked, done: done, firstWins: firstWins)
        return s
    }

    /// `migrate(JSON)`: the web's migration of a raw save object, through SaveCodec.parse.
    static func migrate(_ raw: JSONValue, now: Int64 = T0) -> GameState {
        let data = try! JSONEncoder().encode(raw)
        return try! SaveCodec.parse(data, now: now)!
    }

    /// `migrate(JSON.parse(JSON.stringify(state)))`.
    static func roundTrip(_ state: GameState, now: Int64 = T0) -> GameState {
        migrate(try! JSONValue.of(state), now: now)
    }

    /// Canonical JSON equality of two saves, with the first difference as the message.
    static func assertSameState(_ a: GameState, _ b: GameState, _ label: String = "", file: StaticString = #filePath, line: UInt = #line) {
        let ja = try! JSONValue.of(a), jb = try! JSONValue.of(b)
        if let d = Canon.firstDifference(ja, jb) { XCTFail("\(label): \(d)", file: file, line: line) }
    }
}

/// XCTAssertThrowsError with a message check (the web's `assert.throws(fn, /regex/)`).
func assertThrows<T>(_ expr: @autoclosure () throws -> T, _ contains: String, file: StaticString = #filePath, line: UInt = #line) {
    do {
        _ = try expr()
        XCTFail("expected an error containing \"\(contains)\"", file: file, line: line)
    } catch {
        let msg = (error as? GameError)?.message ?? "\(error)"
        XCTAssertTrue(msg.lowercased().contains(contains.lowercased()), "error \"\(msg)\" does not contain \"\(contains)\"", file: file, line: line)
    }
}
