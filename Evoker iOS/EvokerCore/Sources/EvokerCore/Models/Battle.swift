import Foundation

/// The battle contract (architecture.md §4, original-engine.md §9): the inputs of `simulateBattle`, the event log
/// the UI plays back, and the result. The JSON shape of every type equals the web's so the golden logs compare 1:1.

/// A player-like side owner. Built sides (from `buildSide`) carry `maxHp`, `baseMaxHp` and `tribeBonus`;
/// raw sides (tests) may carry only `name`, `hp`, `maxHp`. The engine reads `maxHp ?? hpMax ?? hp ?? 1500`.
public struct FighterPlayer: Codable, Hashable, Sendable {
    public var name: String?
    public var hp: Int?
    public var maxHp: Int?
    public var hpMax: Int?
    /// Portrait / avatar index (`portrait ?? avatar ?? 0`).
    public var portrait: Int?
    public var avatar: Int?
    public var level: Int?
    /// Max hp before the tribe bonus (built sides).
    public var baseMaxHp: Int?
    /// nil = the engine applies the round-1 race bonus itself (raw sides); true/false = buildSide decided.
    public var tribeBonus: Bool?

    public init(name: String? = nil, hp: Int? = nil, maxHp: Int? = nil, hpMax: Int? = nil, portrait: Int? = nil, avatar: Int? = nil,
                level: Int? = nil, baseMaxHp: Int? = nil, tribeBonus: Bool? = nil) {
        self.name = name; self.hp = hp; self.maxHp = maxHp; self.hpMax = hpMax; self.portrait = portrait; self.avatar = avatar
        self.level = level; self.baseMaxHp = baseMaxHp; self.tribeBonus = tribeBonus
    }

    enum CodingKeys: String, CodingKey { case name, hp, maxHp, hpMax, portrait, avatar, level, baseMaxHp, tribeBonus }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = c.stringOrNil(.name)
        hp = c.intOrNil(.hp)
        maxHp = c.intOrNil(.maxHp)
        hpMax = c.intOrNil(.hpMax)
        portrait = c.intOrNil(.portrait)
        avatar = c.intOrNil(.avatar)
        level = c.intOrNil(.level)
        baseMaxHp = c.intOrNil(.baseMaxHp)
        tribeBonus = c.has(.tribeBonus) ? c.boolOrNil(.tribeBonus) : nil
    }

    /// `p.portrait ?? p.avatar ?? 0`.
    public var portraitIndex: Int { portrait ?? avatar ?? 0 }
}

/// A card ready for the engine (battle-state.js BattleCard). Every field is optional so that the original client's
/// raw test cards (`{attack, hp, buffs}`) decode too; `toBattleCard` fills everything for real cards.
public struct BattleCard: Codable, Hashable, Sendable {
    public var instanceId: String?
    public var cardId: String?
    public var name: String?
    public var tribe: Tribe?
    /// The tribe name as received when it is not one of the four tribes (lower-cased): the web keeps unknown race
    /// names verbatim (the original client tests use "Orks" / "Elfen" / "Zwerge") and the engine counts them as
    /// their own race. nil for real cards.
    public var tribeName: String?
    public var rarity: Rarity?
    public var mana: Int?
    public var stage: Int?
    public var level: Int?
    /// Effective base attack at this stage/level (0 when the card does not attack).
    public var attack: Double?
    public var maxHp: Double?
    public var hp: Double?
    /// The numeric ability value (0 when none; a percent for percent cards).
    public var abilityValue: Double?
    /// Catalog directions (direct, left, right, ownLeft, ownRight).
    public var dirs: [CatalogDirection]?
    /// The ability entry resolved for the stage.
    public var ability: AbilityEntry?
    /// Pre-resolved buffs (tests / tooling); when present they replace the buffs derived from `ability` + `dirs`.
    public var buffs: [Buff]?

    public init(instanceId: String? = nil, cardId: String? = nil, name: String? = nil, tribe: Tribe? = nil, rarity: Rarity? = nil, mana: Int? = nil,
                stage: Int? = nil, level: Int? = nil, attack: Double? = nil, maxHp: Double? = nil, hp: Double? = nil, abilityValue: Double? = nil,
                dirs: [CatalogDirection]? = nil, ability: AbilityEntry? = nil, buffs: [Buff]? = nil, tribeName: String? = nil) {
        self.instanceId = instanceId; self.cardId = cardId; self.name = name; self.tribe = tribe; self.tribeName = tribeName; self.rarity = rarity; self.mana = mana
        self.stage = stage; self.level = level; self.attack = attack; self.maxHp = maxHp; self.hp = hp; self.abilityValue = abilityValue
        self.dirs = dirs; self.ability = ability; self.buffs = buffs
    }

    enum CodingKeys: String, CodingKey { case instanceId, uid, cardId, name, tribe, race, rarity, mana, stage, level, attack, maxHp, hp, abilityValue, dirs, ability, buffs }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        instanceId = c.stringOrNil(.instanceId) ?? c.stringOrNil(.uid)
        cardId = c.stringOrNil(.cardId)
        name = c.stringOrNil(.name)
        if let t = c.stringOrNil(.tribe) ?? c.stringOrNil(.race) {
            let lower = t.lowercased()
            tribe = Tribe(lenient: lower)
            tribeName = (!lower.isEmpty && Tribe(rawValue: lower) == nil) ? lower : nil
        } else {
            tribe = nil
            tribeName = nil
        }
        rarity = c.optionalValue(Rarity.self, .rarity)
        mana = c.intOrNil(.mana)
        stage = c.intOrNil(.stage)
        level = c.intOrNil(.level)
        attack = c.doubleOrNil(.attack)
        maxHp = c.doubleOrNil(.maxHp)
        hp = c.doubleOrNil(.hp)
        abilityValue = c.doubleOrNil(.abilityValue)
        if c.has(.dirs) {
            // Sets / comma strings are not JSON; arrays of names, unknown names dropped (normaliseDirs)
            let raw = c.array(String.self, .dirs)
            dirs = raw.compactMap { CatalogDirection(rawValue: $0) }
        } else {
            dirs = nil
        }
        ability = c.optionalValue(AbilityEntry.self, .ability)
        buffs = c.optionalValue([Buff].self, .buffs)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(instanceId, forKey: .instanceId)
        try c.encodeIfPresent(cardId, forKey: .cardId)
        try c.encodeIfPresent(name, forKey: .name)
        try c.encodeIfPresent(tribeName ?? tribe?.rawValue, forKey: .tribe)
        try c.encodeIfPresent(rarity, forKey: .rarity)
        try c.encodeIfPresent(mana, forKey: .mana)
        try c.encodeIfPresent(stage, forKey: .stage)
        try c.encodeIfPresent(level, forKey: .level)
        try c.encodeIfPresent(attack.map(JSONValue.number), forKey: .attack)
        try c.encodeIfPresent(maxHp.map(JSONValue.number), forKey: .maxHp)
        try c.encodeIfPresent(hp.map(JSONValue.number), forKey: .hp)
        try c.encodeIfPresent(abilityValue.map(JSONValue.number), forKey: .abilityValue)
        try c.encodeIfPresent(dirs, forKey: .dirs)
        try c.encodeIfPresent(ability, forKey: .ability)
        try c.encodeIfPresent(buffs, forKey: .buffs)
    }
}

public struct FighterSide: Codable, Hashable, Sendable {
    public var player: FighterPlayer
    /// Exactly 5 slots (UI order: slot 0 = the side's leftmost card as drawn; defender slot k faces attacker slot k).
    public var cards: [BattleCard?]

    public init(player: FighterPlayer, cards: [BattleCard?]) {
        var list = cards
        while list.count < 5 { list.append(nil) }
        self.player = player
        self.cards = Array(list.prefix(5))
    }

    enum CodingKeys: String, CodingKey { case player, cards }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let p = c.lenient(FighterPlayer.self, .player, default: FighterPlayer())
        let list = c.optionalArray(BattleCard.self, .cards)
        self.init(player: p, cards: list)
    }
}

public struct BattleOptions: Codable, Hashable, Sendable {
    /// Default 20.
    public var maxRounds: Int?
    /// Force the engine's round-1 race bonus on/off (default: applied only for sides without a `tribeBonus` flag).
    public var raceBonus: Bool?
    public init(maxRounds: Int? = nil, raceBonus: Bool? = nil) { self.maxRounds = maxRounds; self.raceBonus = raceBonus }
}

public struct BattleConfig: Codable, Hashable, Sendable {
    public var attacker: FighterSide
    public var defender: FighterSide
    public var seed: UInt32
    public var options: BattleOptions

    public init(attacker: FighterSide, defender: FighterSide, seed: UInt32, options: BattleOptions = BattleOptions()) {
        self.attacker = attacker; self.defender = defender; self.seed = seed; self.options = options
    }

    enum CodingKeys: String, CodingKey { case attacker, defender, seed, options }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        attacker = try c.decode(FighterSide.self, forKey: .attacker)
        defender = try c.decode(FighterSide.self, forKey: .defender)
        seed = c.uint32(.seed)
        options = c.lenient(BattleOptions.self, .options, default: BattleOptions())
    }
}

public struct Deaths: Codable, Hashable, Sendable {
    public var attacker: Int
    public var defender: Int
    public init(attacker: Int = 0, defender: Int = 0) { self.attacker = attacker; self.defender = defender }

    enum CodingKeys: String, CodingKey { case attacker, defender }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        attacker = c.int(.attacker)
        defender = c.int(.defender)
    }

    public subscript(side: Side) -> Int {
        get { side == .attacker ? attacker : defender }
        set { if side == .attacker { attacker = newValue } else { defender = newValue } }
    }
}

public struct BattleResult: Codable, Hashable, Sendable {
    public var winner: Winner
    /// Completed rounds (0 when nobody can attack from the start).
    public var rounds: Int
    /// hp − takenDamage of player 1 (may be negative, as in the original).
    public var attackerHp: Int
    public var defenderHp: Int
    public var deaths: Deaths
    public var endedBy: EndedBy

    public init(winner: Winner, rounds: Int, attackerHp: Int, defenderHp: Int, deaths: Deaths, endedBy: EndedBy) {
        self.winner = winner; self.rounds = rounds; self.attackerHp = attackerHp; self.defenderHp = defenderHp; self.deaths = deaths; self.endedBy = endedBy
    }

    enum CodingKeys: String, CodingKey { case winner, rounds, attackerHp, defenderHp, deaths, endedBy }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        winner = c.lenient(Winner.self, .winner, default: .draw)
        rounds = c.int(.rounds)
        attackerHp = c.int(.attackerHp)
        defenderHp = c.int(.defenderHp)
        deaths = c.lenient(Deaths.self, .deaths, default: Deaths())
        endedBy = c.lenient(EndedBy.self, .endedBy, default: .noAttack)
    }

    public var attackerWon: Bool { winner == .attacker }
}

public struct BattleOutcome: Codable, Hashable, Sendable {
    public var events: [BattleEvent]
    public var result: BattleResult
    public init(events: [BattleEvent], result: BattleResult) { self.events = events; self.result = result }
}

// MARK: - Event log

/// `{side, slot, effect}`: the card whose buff caused an event (`slot` null = a player).
public struct EventSource: Codable, Hashable, Sendable {
    public var side: Side
    public var slot: Int?
    public var effect: String

    public init(side: Side, slot: Int?, effect: String) { self.side = side; self.slot = slot; self.effect = effect }

    enum CodingKeys: String, CodingKey { case side, slot, effect }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        side = c.lenient(Side.self, .side, default: .attacker)
        slot = c.intOrNil(.slot)
        effect = c.string(.effect)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(side, forKey: .side)
        try c.encode(slot, forKey: .slot)
        try c.encode(effect, forKey: .effect)
    }
}

/// One target of an `attack` event (`slot` null = the player).
public struct AttackTarget: Codable, Hashable, Sendable {
    public var side: Side
    public var slot: Int?
    public var damage: Int
    public var blocked: Bool
    /// The original direction the hit travelled (front, frontLeft, …), when known.
    public var dir: String?

    public init(side: Side, slot: Int?, damage: Int, blocked: Bool, dir: String?) {
        self.side = side; self.slot = slot; self.damage = damage; self.blocked = blocked; self.dir = dir
    }

    enum CodingKeys: String, CodingKey { case side, slot, damage, blocked, dir }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        side = c.lenient(Side.self, .side, default: .attacker)
        slot = c.intOrNil(.slot)
        damage = c.int(.damage)
        blocked = c.bool(.blocked)
        dir = c.stringOrNil(.dir)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(side, forKey: .side)
        try c.encode(slot, forKey: .slot)
        try c.encode(damage, forKey: .damage)
        try c.encode(blocked, forKey: .blocked)
        try c.encode(dir, forKey: .dir)
    }
}

/// Public snapshot of a card (battleStart / death events): the card's public fields with the current numbers.
public struct CardSnapshot: Codable, Hashable, Sendable {
    public var instanceId: String?
    public var cardId: String?
    public var name: String?
    public var tribe: Tribe
    /// The raw tribe name when it is not one of the four tribes (see BattleCard.tribeName); encoded as `tribe`.
    public var tribeName: String?
    public var rarity: Rarity?
    public var mana: Int?
    public var stage: Int?
    public var level: Int?
    public var attack: Int
    public var hp: Int
    public var maxHp: Int
    public var abilityValue: Double?
    public var dirs: [CatalogDirection]
    public var ability: AbilityEntry?

    public init(instanceId: String? = nil, cardId: String? = nil, name: String? = nil, tribe: Tribe = .neutral, rarity: Rarity? = nil, mana: Int? = nil,
                stage: Int? = nil, level: Int? = nil, attack: Int, hp: Int, maxHp: Int, abilityValue: Double? = nil, dirs: [CatalogDirection] = [],
                ability: AbilityEntry? = nil, tribeName: String? = nil) {
        self.instanceId = instanceId; self.cardId = cardId; self.name = name; self.tribe = tribe; self.tribeName = tribeName; self.rarity = rarity; self.mana = mana
        self.stage = stage; self.level = level; self.attack = attack; self.hp = hp; self.maxHp = maxHp; self.abilityValue = abilityValue
        self.dirs = dirs; self.ability = ability
    }

    enum CodingKeys: String, CodingKey { case instanceId, cardId, name, tribe, rarity, mana, stage, level, attack, hp, maxHp, abilityValue, dirs, ability }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        instanceId = c.stringOrNil(.instanceId)
        cardId = c.stringOrNil(.cardId)
        name = c.stringOrNil(.name)
        let rawTribe = c.stringOrNil(.tribe)?.lowercased()
        tribe = Tribe(lenient: rawTribe)
        tribeName = rawTribe.flatMap { (!$0.isEmpty && Tribe(rawValue: $0) == nil) ? $0 : nil }
        rarity = c.optionalValue(Rarity.self, .rarity)
        mana = c.intOrNil(.mana)
        stage = c.intOrNil(.stage)
        level = c.intOrNil(.level)
        attack = c.int(.attack)
        hp = c.int(.hp)
        maxHp = c.int(.maxHp, default: hp)
        abilityValue = c.doubleOrNil(.abilityValue)
        dirs = c.array(String.self, .dirs).compactMap { CatalogDirection(rawValue: $0) }
        ability = c.optionalValue(AbilityEntry.self, .ability)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(instanceId, forKey: .instanceId)
        try c.encodeIfPresent(cardId, forKey: .cardId)
        try c.encodeIfPresent(name, forKey: .name)
        try c.encode(tribeName ?? tribe.rawValue, forKey: .tribe)
        try c.encodeIfPresent(rarity, forKey: .rarity)
        try c.encodeIfPresent(mana, forKey: .mana)
        try c.encodeIfPresent(stage, forKey: .stage)
        try c.encodeIfPresent(level, forKey: .level)
        try c.encode(attack, forKey: .attack)
        try c.encode(hp, forKey: .hp)
        try c.encode(maxHp, forKey: .maxHp)
        try c.encodeIfPresent(abilityValue.map(JSONValue.number), forKey: .abilityValue)
        try c.encode(dirs, forKey: .dirs)
        try c.encodeIfPresent(ability, forKey: .ability)
    }
}

/// Public snapshot of a side's player in the battleStart event.
public struct PlayerSnapshot: Codable, Hashable, Sendable {
    public var name: String
    public var portrait: Int
    public var hp: Int
    public var maxHp: Int
    public var baseMaxHp: Int?
    public var tribeBonus: Bool
    public var level: Int?

    public init(name: String, portrait: Int = 0, hp: Int, maxHp: Int, baseMaxHp: Int? = nil, tribeBonus: Bool = false, level: Int? = nil) {
        self.name = name; self.portrait = portrait; self.hp = hp; self.maxHp = maxHp; self.baseMaxHp = baseMaxHp; self.tribeBonus = tribeBonus; self.level = level
    }

    enum CodingKeys: String, CodingKey { case name, portrait, hp, maxHp, baseMaxHp, tribeBonus, level }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = c.string(.name)
        portrait = c.int(.portrait)
        hp = c.int(.hp)
        maxHp = c.int(.maxHp, default: hp)
        baseMaxHp = c.intOrNil(.baseMaxHp)
        tribeBonus = c.bool(.tribeBonus)
        level = c.intOrNil(.level)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(name, forKey: .name)
        try c.encode(portrait, forKey: .portrait)
        try c.encode(hp, forKey: .hp)
        try c.encode(maxHp, forKey: .maxHp)
        try c.encodeIfPresent(baseMaxHp, forKey: .baseMaxHp)
        try c.encode(tribeBonus, forKey: .tribeBonus)
        try c.encodeIfPresent(level, forKey: .level)
    }
}

public struct SideSnapshot: Codable, Hashable, Sendable {
    public var player: PlayerSnapshot
    public var cards: [CardSnapshot?]

    public init(player: PlayerSnapshot, cards: [CardSnapshot?]) {
        var list = cards
        while list.count < 5 { list.append(nil) }
        self.player = player
        self.cards = Array(list.prefix(5))
    }

    enum CodingKeys: String, CodingKey { case player, cards }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let p = c.lenient(PlayerSnapshot.self, .player, default: PlayerSnapshot(name: "", hp: 0, maxHp: 1))
        self.init(player: p, cards: c.optionalArray(CardSnapshot.self, .cards))
    }
}

/// Per-slot current health of both sides at a round end (original-engine.md §9 `roundEnd.cards`).
public struct RoundHpSnapshot: Codable, Hashable, Sendable {
    public var attacker: [Int]
    public var defender: [Int]
    public init(attacker: [Int], defender: [Int]) { self.attacker = attacker; self.defender = defender }

    enum CodingKeys: String, CodingKey { case attacker, defender }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        attacker = c.array(Int.self, .attacker)
        defender = c.array(Int.self, .defender)
    }
}

/// One entry of the engine's event log (architecture.md §4 + the phase-3 additions). The `t` discriminator and
/// the field names are the web's.
public enum BattleEvent: Hashable, Sendable {
    case battleStart(seed: UInt32, attacker: SideSnapshot, defender: SideSnapshot)
    case roundStart(round: Int, attackerHp: Int, defenderHp: Int)
    case status(side: Side, slot: Int, status: CardStatus, on: Bool, source: EventSource?)
    case buff(side: Side, slot: Int?, stat: BuffStat, delta: Int, permanent: Bool, source: EventSource?)
    case attack(side: Side, slot: Int, attack: Int, bonus: Bool, targets: [AttackTarget])
    case damage(side: Side, slot: Int?, amount: Int, hp: Int, cause: DamageCause, blocked: Bool, source: EventSource?)
    case heal(side: Side, slot: Int?, amount: Int, hp: Int, source: EventSource?)
    case death(side: Side, slot: Int, card: CardSnapshot)
    case revive(side: Side, slot: Int, hp: Int, attack: Int, source: EventSource?)
    case swap(side: Side, slot: Int, attack: Int, hp: Int, maxHp: Int, source: EventSource?)
    case gamble(side: Side, slot: Int, failed: Bool, source: EventSource?)
    case roundEnd(round: Int, attackerHp: Int, defenderHp: Int, cards: RoundHpSnapshot)
    case battleEnd(winner: Winner, rounds: Int, attackerHp: Int, defenderHp: Int, endedBy: EndedBy)

    /// The `t` discriminator.
    public var type: String {
        switch self {
        case .battleStart: return "battleStart"
        case .roundStart: return "roundStart"
        case .status: return "status"
        case .buff: return "buff"
        case .attack: return "attack"
        case .damage: return "damage"
        case .heal: return "heal"
        case .death: return "death"
        case .revive: return "revive"
        case .swap: return "swap"
        case .gamble: return "gamble"
        case .roundEnd: return "roundEnd"
        case .battleEnd: return "battleEnd"
        }
    }

    /// The side the event is about (nil for round / battle events).
    public var side: Side? {
        switch self {
        case .status(let s, _, _, _, _), .buff(let s, _, _, _, _, _), .attack(let s, _, _, _, _), .damage(let s, _, _, _, _, _, _),
             .heal(let s, _, _, _, _), .death(let s, _, _), .revive(let s, _, _, _, _), .swap(let s, _, _, _, _, _), .gamble(let s, _, _, _):
            return s
        default: return nil
        }
    }

    /// The slot the event is about (nil for a player or for round / battle events).
    public var slot: Int? {
        switch self {
        case .status(_, let slot, _, _, _), .attack(_, let slot, _, _, _), .death(_, let slot, _), .revive(_, let slot, _, _, _),
             .swap(_, let slot, _, _, _, _), .gamble(_, let slot, _, _):
            return slot
        case .buff(_, let slot, _, _, _, _), .damage(_, let slot, _, _, _, _, _), .heal(_, let slot, _, _, _):
            return slot
        default: return nil
        }
    }

    public var source: EventSource? {
        switch self {
        case .status(_, _, _, _, let s), .buff(_, _, _, _, _, let s), .damage(_, _, _, _, _, _, let s), .heal(_, _, _, _, let s),
             .revive(_, _, _, _, let s), .swap(_, _, _, _, _, let s), .gamble(_, _, _, let s):
            return s
        default: return nil
        }
    }
}

extension BattleEvent: Codable {
    enum CodingKeys: String, CodingKey {
        case t, seed, attacker, defender, round, attackerHp, defenderHp, side, slot, status, on, source, stat, delta, permanent,
             attack, bonus, targets, amount, hp, cause, blocked, card, maxHp, failed, cards, winner, rounds, endedBy
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let t = c.string(.t)
        switch t {
        case "battleStart":
            self = .battleStart(seed: c.uint32(.seed),
                                attacker: c.lenient(SideSnapshot.self, .attacker, default: SideSnapshot(player: PlayerSnapshot(name: "", hp: 0, maxHp: 1), cards: [])),
                                defender: c.lenient(SideSnapshot.self, .defender, default: SideSnapshot(player: PlayerSnapshot(name: "", hp: 0, maxHp: 1), cards: [])))
        case "roundStart":
            self = .roundStart(round: c.int(.round), attackerHp: c.int(.attackerHp), defenderHp: c.int(.defenderHp))
        case "status":
            self = .status(side: c.lenient(Side.self, .side, default: .attacker), slot: c.int(.slot),
                           status: c.lenient(CardStatus.self, .status, default: .dazed), on: c.bool(.on, default: true),
                           source: c.optionalValue(EventSource.self, .source))
        case "buff":
            self = .buff(side: c.lenient(Side.self, .side, default: .attacker), slot: c.intOrNil(.slot),
                         stat: c.lenient(BuffStat.self, .stat, default: .attack), delta: c.int(.delta), permanent: c.bool(.permanent),
                         source: c.optionalValue(EventSource.self, .source))
        case "attack":
            self = .attack(side: c.lenient(Side.self, .side, default: .attacker), slot: c.int(.slot), attack: c.int(.attack),
                           bonus: c.bool(.bonus), targets: c.array(AttackTarget.self, .targets))
        case "damage":
            self = .damage(side: c.lenient(Side.self, .side, default: .attacker), slot: c.intOrNil(.slot), amount: c.int(.amount), hp: c.int(.hp),
                           cause: c.lenient(DamageCause.self, .cause, default: .attack), blocked: c.bool(.blocked),
                           source: c.optionalValue(EventSource.self, .source))
        case "heal":
            self = .heal(side: c.lenient(Side.self, .side, default: .attacker), slot: c.intOrNil(.slot), amount: c.int(.amount), hp: c.int(.hp),
                         source: c.optionalValue(EventSource.self, .source))
        case "death":
            self = .death(side: c.lenient(Side.self, .side, default: .attacker), slot: c.int(.slot),
                          card: c.lenient(CardSnapshot.self, .card, default: CardSnapshot(attack: 0, hp: 0, maxHp: 1)))
        case "revive":
            self = .revive(side: c.lenient(Side.self, .side, default: .attacker), slot: c.int(.slot), hp: c.int(.hp), attack: c.int(.attack),
                           source: c.optionalValue(EventSource.self, .source))
        case "swap":
            self = .swap(side: c.lenient(Side.self, .side, default: .attacker), slot: c.int(.slot), attack: c.int(.attack), hp: c.int(.hp),
                         maxHp: c.int(.maxHp), source: c.optionalValue(EventSource.self, .source))
        case "gamble":
            self = .gamble(side: c.lenient(Side.self, .side, default: .attacker), slot: c.int(.slot), failed: c.bool(.failed),
                           source: c.optionalValue(EventSource.self, .source))
        case "roundEnd":
            self = .roundEnd(round: c.int(.round), attackerHp: c.int(.attackerHp), defenderHp: c.int(.defenderHp),
                             cards: c.lenient(RoundHpSnapshot.self, .cards, default: RoundHpSnapshot(attacker: [], defender: [])))
        case "battleEnd":
            self = .battleEnd(winner: c.lenient(Winner.self, .winner, default: .draw), rounds: c.int(.rounds), attackerHp: c.int(.attackerHp),
                              defenderHp: c.int(.defenderHp), endedBy: c.lenient(EndedBy.self, .endedBy, default: .noAttack))
        default:
            throw DecodingError.dataCorruptedError(forKey: .t, in: c, debugDescription: "unknown event type \(t)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(type, forKey: .t)
        switch self {
        case .battleStart(let seed, let attacker, let defender):
            try c.encode(seed, forKey: .seed)
            try c.encode(attacker, forKey: .attacker)
            try c.encode(defender, forKey: .defender)
        case .roundStart(let round, let a, let d):
            try c.encode(round, forKey: .round)
            try c.encode(a, forKey: .attackerHp)
            try c.encode(d, forKey: .defenderHp)
        case .status(let side, let slot, let status, let on, let source):
            try c.encode(side, forKey: .side)
            try c.encode(slot, forKey: .slot)
            try c.encode(status, forKey: .status)
            try c.encode(on, forKey: .on)
            try c.encode(source, forKey: .source)
        case .buff(let side, let slot, let stat, let delta, let permanent, let source):
            try c.encode(side, forKey: .side)
            try c.encode(slot, forKey: .slot)
            try c.encode(stat, forKey: .stat)
            try c.encode(delta, forKey: .delta)
            try c.encode(permanent, forKey: .permanent)
            try c.encode(source, forKey: .source)
        case .attack(let side, let slot, let attack, let bonus, let targets):
            try c.encode(side, forKey: .side)
            try c.encode(slot, forKey: .slot)
            try c.encode(attack, forKey: .attack)
            try c.encode(bonus, forKey: .bonus)
            try c.encode(targets, forKey: .targets)
        case .damage(let side, let slot, let amount, let hp, let cause, let blocked, let source):
            try c.encode(side, forKey: .side)
            try c.encode(slot, forKey: .slot)
            try c.encode(amount, forKey: .amount)
            try c.encode(hp, forKey: .hp)
            try c.encode(cause, forKey: .cause)
            try c.encode(blocked, forKey: .blocked)
            try c.encode(source, forKey: .source)
        case .heal(let side, let slot, let amount, let hp, let source):
            try c.encode(side, forKey: .side)
            try c.encode(slot, forKey: .slot)
            try c.encode(amount, forKey: .amount)
            try c.encode(hp, forKey: .hp)
            try c.encode(source, forKey: .source)
        case .death(let side, let slot, let card):
            try c.encode(side, forKey: .side)
            try c.encode(slot, forKey: .slot)
            try c.encode(card, forKey: .card)
        case .revive(let side, let slot, let hp, let attack, let source):
            try c.encode(side, forKey: .side)
            try c.encode(slot, forKey: .slot)
            try c.encode(hp, forKey: .hp)
            try c.encode(attack, forKey: .attack)
            try c.encode(source, forKey: .source)
        case .swap(let side, let slot, let attack, let hp, let maxHp, let source):
            try c.encode(side, forKey: .side)
            try c.encode(slot, forKey: .slot)
            try c.encode(attack, forKey: .attack)
            try c.encode(hp, forKey: .hp)
            try c.encode(maxHp, forKey: .maxHp)
            try c.encode(source, forKey: .source)
        case .gamble(let side, let slot, let failed, let source):
            try c.encode(side, forKey: .side)
            try c.encode(slot, forKey: .slot)
            try c.encode(failed, forKey: .failed)
            try c.encode(source, forKey: .source)
        case .roundEnd(let round, let a, let d, let cards):
            try c.encode(round, forKey: .round)
            try c.encode(a, forKey: .attackerHp)
            try c.encode(d, forKey: .defenderHp)
            try c.encode(cards, forKey: .cards)
        case .battleEnd(let winner, let rounds, let a, let d, let endedBy):
            try c.encode(winner, forKey: .winner)
            try c.encode(rounds, forKey: .rounds)
            try c.encode(a, forKey: .attackerHp)
            try c.encode(d, forKey: .defenderHp)
            try c.encode(endedBy, forKey: .endedBy)
        }
    }
}
