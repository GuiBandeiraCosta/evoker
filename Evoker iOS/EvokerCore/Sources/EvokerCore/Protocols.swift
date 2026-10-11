import Foundation

/// The dependency bundle every game function takes (`deps` of the web: `{ db, stats, engine, rng, quests, names }`).
public struct Deps {
    public var db: CardsDb
    public var stats: StatsProviding
    public var engine: BattleSimulating
    /// The seeded generator factory (`mulberry32`).
    public var rng: (UInt32) -> RandomSource
    public var quests: QuestsData?
    public var names: NamesData?

    public init(db: CardsDb, stats: StatsProviding, engine: BattleSimulating, rng: @escaping (UInt32) -> RandomSource = { Mulberry32($0) },
                quests: QuestsData? = nil, names: NamesData? = nil) {
        self.db = db; self.stats = stats; self.engine = engine; self.rng = rng; self.quests = quests; self.names = names
    }
}

/// The three computed stats of a card at a stage / level (`statsAt`, `computeStats`).
public struct CardStats: Hashable, Sendable, Codable {
    public var attack: Int
    public var hp: Int
    /// nil when the card has no ability value.
    public var ability: Double?
    public init(attack: Int, hp: Int, ability: Double?) { self.attack = attack; self.hp = hp; self.ability = ability }
}

/// The stat formulas (`src/core/stats.js`). `Stats` is the real implementation; tests may inject a stub catalog.
public protocol StatsProviding {
    /// Value of a stat for a card at a fusion stage and level (nil when the card has no such stat).
    func statAt(_ card: CardDef, _ stat: StatKey, stage: Int, level: Int, evolveQuality: Double) -> Double?
    /// Level cap of a card at a fusion stage (card.caps wins over the rarity table).
    func capFor(_ card: CardDef, stage: Int) -> Int
    /// Card XP needed from `level` to `level + 1` (stage 0 = unfused: the Common/Standard floor applies).
    func cardXpToNext(_ card: CardDef, level: Int, stage: Int) -> Int
    /// Player XP needed from `level` to `level + 1`; nil = Infinity at the level cap.
    func playerXpToNext(level: Int) -> Int?
    func sellValue(_ card: CardDef, stage: Int, level: Int) -> Int
    func fusionCost(rarity: Rarity, stage: Int) -> Int
    func sacrificeXp(_ card: CardDef, stage: Int, level: Int) -> Int
    func enhancePrice(_ card: CardDef, level: Int) -> Int
    func evolveQuality(_ l1: Int, _ cap1: Int, _ l2: Int, _ cap2: Int) -> Double
}

public extension StatsProviding {
    func attackAt(_ card: CardDef, stage: Int, level: Int, evolveQuality: Double = 1) -> Int {
        Int((statAt(card, .attack, stage: stage, level: level, evolveQuality: evolveQuality) ?? 0).rounded(.towardZero))
    }
    func hpAt(_ card: CardDef, stage: Int, level: Int, evolveQuality: Double = 1) -> Int {
        Int((statAt(card, .hp, stage: stage, level: level, evolveQuality: evolveQuality) ?? 0).rounded(.towardZero))
    }
    func abilityAt(_ card: CardDef, stage: Int, level: Int, evolveQuality: Double = 1) -> Double? {
        statAt(card, .ability, stage: stage, level: level, evolveQuality: evolveQuality)
    }
    /// All three stats at once (`statsAt`).
    func statsAt(_ card: CardDef, stage: Int, level: Int, evolveQuality: Double = 1) -> CardStats {
        CardStats(attack: attackAt(card, stage: stage, level: level, evolveQuality: evolveQuality),
                  hp: hpAt(card, stage: stage, level: level, evolveQuality: evolveQuality),
                  ability: abilityAt(card, stage: stage, level: level, evolveQuality: evolveQuality))
    }
}

/// `battle-state.js` ComputeStats callback: stats of a card definition at a stage / level.
public typealias ComputeStats = (_ cardDef: CardDef, _ stage: Int, _ level: Int, _ evolveQuality: Double) -> CardStats

/// Options of `buildSide` (`{ cardsDb, computeStats, tribeBonus }`).
public struct SideOptions {
    public var cardsDb: CardsDb?
    public var computeStats: ComputeStats?
    /// false = never apply the tribe bonus.
    public var tribeBonus: Bool?
    public init(cardsDb: CardsDb? = nil, computeStats: ComputeStats? = nil, tribeBonus: Bool? = nil) {
        self.cardsDb = cardsDb; self.computeStats = computeStats; self.tribeBonus = tribeBonus
    }
}

/// An entry handed to `buildSide`: an owned/boss/sim card reference or an already built BattleCard.
public enum SideEntry {
    case ref(CardRef)
    case card(BattleCard)
}

/// The battle engine (`src/engine/battle.js` + `battle-state.js`).
public protocol BattleSimulating {
    /// Simulate a whole battle. Deterministic for a given config; never mutates its input.
    func simulateBattle(_ cfg: BattleConfig) -> BattleOutcome
    /// Build a fighter side from a player-like object and up to 5 slot entries; applies the race bonus (×1.2) to
    /// maxHp and records it in `player.tribeBonus` so the engine does not apply it again.
    func buildSide(_ player: FighterPlayer, _ cards: [SideEntry?], options: SideOptions) -> FighterSide
    /// Build a BattleCard from a card reference and its definition (stats from `computeStats`).
    func toBattleCard(_ ref: CardRef, _ cardDef: CardDef, computeStats: ComputeStats?) -> BattleCard
}

/// Where the save lives (`Persistence/FileSaveStore` in the app, an in-memory store in tests).
public protocol SaveStore {
    /// The stored save, migrated, or nil when none exists (or it is corrupt).
    func load(now: Int64) throws -> GameState?
    func save(_ state: GameState, now: Int64) throws
    func delete() throws
    var exists: Bool { get }
}

/// An in-memory save store for tests and previews.
public final class MemorySaveStore: SaveStore {
    public private(set) var data: Data?
    public init(initial: GameState? = nil) {
        if let s = initial { data = try? JSONEncoder().encode(s) }
    }
    public func load(now: Int64) throws -> GameState? {
        guard let d = data else { return nil }
        return try SaveCodec.parse(d, now: now)
    }
    public func save(_ state: GameState, now: Int64) throws {
        data = try SaveCodec.serialize(state, now: now)
    }
    public func delete() throws { data = nil }
    public var exists: Bool { data != nil }
}

/// The game clock (ms epoch); the only clock game logic ever sees.
public typealias Clock = () -> Int64

/// Save text ↔ state (`store.js parseSave / serializeSave`).
public enum SaveCodec {
    /// Parse a raw save (JSON text) into a migrated state, or nil when absent / corrupt (`parseSave`).
    public static func parse(_ data: Data, now: Int64) throws -> GameState? {
        guard !data.isEmpty else { return nil }
        guard let json = try? JSONValue.parse(data), case .object(let o) = json, o["player"] != nil else { return nil }
        let raw = try json.decode(GameState.self)
        return StateOps.migrated(raw, rawJSON: json, now: now)
    }

    /// Serialise a save for storage, touching `lastSeen` (`serializeSave`).
    public static func serialize(_ state: GameState, now: Int64) throws -> Data {
        var s = state
        s.lastSeen = now
        let enc = JSONEncoder()
        enc.outputFormatting = [.sortedKeys]
        return try enc.encode(s)
    }
}
