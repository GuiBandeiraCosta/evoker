import Foundation

/// String-backed enums shared by the data, the save, the engine and the UI. Raw values are the web's ids, so
/// JSON produced by the web decodes directly.

public enum Tribe: String, Codable, CaseIterable, Sendable, Hashable {
    case dwarf, elf, orc, neutral
    /// The three main tribes first, then neutral (constants.TRIBE_ORDER).
    public static let order: [Tribe] = [.dwarf, .elf, .orc, .neutral]
    public var isMain: Bool { self != .neutral }
    /// `tribeOf(card)`: unknown / missing values are neutral.
    public init(lenient raw: String?) {
        self = raw.flatMap { Tribe(rawValue: $0.lowercased()) } ?? .neutral
    }
}

public enum Rarity: String, Codable, CaseIterable, Sendable, Hashable, Comparable {
    case common, standard, uncommon, rare, heroic, legendary, ultimate
    /// Ascending order (constants.RARITY_ORDER).
    public static let order: [Rarity] = [.common, .standard, .uncommon, .rare, .heroic, .legendary, .ultimate]
    public var index: Int { Rarity.order.firstIndex(of: self)! }
    public static func < (a: Rarity, b: Rarity) -> Bool { a.index < b.index }
}

/// Catalog direction names (cards.json `dirs`), canonical order left, direct, right, ownLeft, ownRight.
public enum CatalogDirection: String, Codable, CaseIterable, Sendable, Hashable {
    case left, direct, right, ownLeft, ownRight
    public static let order: [CatalogDirection] = [.left, .direct, .right, .ownLeft, .ownRight]
    /// Catalog name → original simulator name (abilities.js DIR_MAP).
    public var original: OriginalDirection {
        switch self {
        case .direct: return .front
        case .left: return .frontLeft
        case .right: return .frontRight
        case .ownLeft: return .left
        case .ownRight: return .right
        }
    }
}

/// Original simulator direction names (buff `directions`).
public enum OriginalDirection: String, Codable, CaseIterable, Sendable, Hashable {
    case front, frontLeft, frontRight, left, right
    case selfSlot = "self"
    /// Original name → catalog name (`self` has none).
    public var catalog: CatalogDirection? {
        switch self {
        case .front: return .direct
        case .frontLeft: return .left
        case .frontRight: return .right
        case .left: return .ownLeft
        case .right: return .ownRight
        case .selfSlot: return nil
        }
    }
}

/// The 18 original buff handlers plus the extensions (original-engine.md §3, §8).
public enum BuffType: String, Codable, CaseIterable, Sendable, Hashable {
    case no_buff, heal, raise_attack, raise_hp, raise_player_hp, heal_player, increment_attack, invulnerable, no_damage,
         attack, resurrect, die, reflect_damage, reflect_damage_to_player, deal_damage_to_opponent_player,
         deal_damage_to_player, deal_damage_to_all_opponent_cards, self_damage
    case bonus_attack, kill, resurrect_allies, swap_stats_random, wheel, gamble, heal_boost_percent,
         reduce_ability_attack_percent, stun_pattern
    /// The web's `none` placeholder (dropped by resolveBuffs).
    case none

    public static let originals: [BuffType] = [
        .no_buff, .heal, .raise_attack, .raise_hp, .raise_player_hp, .heal_player, .increment_attack, .invulnerable, .no_damage,
        .attack, .resurrect, .die, .reflect_damage, .reflect_damage_to_player, .deal_damage_to_opponent_player,
        .deal_damage_to_player, .deal_damage_to_all_opponent_cards, .self_damage,
    ]
    public static let extensions: [BuffType] = [
        .bonus_attack, .kill, .resurrect_allies, .swap_stats_random, .wheel, .gamble, .heal_boost_percent,
        .reduce_ability_attack_percent, .stun_pattern,
    ]
    public var isExtension: Bool { BuffType.extensions.contains(self) }
}

/// Buff events. `round_odd`, `round_even` and `onHeal` are extensions.
public enum BuffEvent: String, Codable, CaseIterable, Sendable, Hashable {
    case always, round_eq, round_ge, round_le, round_odd, round_even, onDamage, onDeath, onHeal
    public var isRoundMode: Bool {
        switch self {
        case .always, .round_eq, .round_ge, .round_le, .round_odd, .round_even: return true
        case .onDamage, .onDeath, .onHeal: return false
        }
    }
    public var isExtension: Bool { self == .round_odd || self == .round_even || self == .onHeal }
}

/// Engine event types pushed between handlers (not the UI log).
public enum EngineEventType: String, Sendable, Hashable {
    case onDamage, onDeath, onHeal
}

/// [ext] Target scopes for buffs that act on a set of cards instead of directions.
public enum BuffScope: String, Codable, CaseIterable, Sendable, Hashable {
    case own_cards, opponent_cards, all_cards, each_side
}

/// [ext] Pick rules for scope buffs.
public enum PickRule: String, Codable, CaseIterable, Sendable, Hashable {
    case highest_attack, lowest_attack, random
}

/// Booster token kinds (also the booster pack ids).
public enum TokenKind: String, Codable, CaseIterable, Sendable, Hashable {
    case neophyte, summoner, archmage, portalLow, portalHigh
    public var isPortal: Bool { self == .portalLow || self == .portalHigh }
}

public enum PotionKind: String, Codable, CaseIterable, Sendable, Hashable {
    case stamina, mana
}

public enum Difficulty: String, Codable, CaseIterable, Sendable, Hashable {
    case easy, normal, hard
}

public enum LeagueTier: String, Codable, CaseIterable, Sendable, Hashable {
    case bronze, silver, gold
    public static let order: [LeagueTier] = [.bronze, .silver, .gold]
    public var index: Int { LeagueTier.order.firstIndex(of: self)! }
}

/// Daily events (shop.js EVENTS), one per UTC day.
public enum DailyEventId: String, Codable, CaseIterable, Sendable, Hashable {
    case infiniteWisdom = "infinite-wisdom"
    case drinkingContest = "drinking-contest"
    case cardPieceDay = "card-piece-day"
    case doubleLeaguePoints = "double-league-points"
    case greatPotionDeal = "great-potion-deal"
    case getTheBestCards = "get-the-best-cards"
    case goldenDay = "golden-day"

    public static let order: [DailyEventId] = [.infiniteWisdom, .drinkingContest, .cardPieceDay, .doubleLeaguePoints, .greatPotionDeal, .getTheBestCards, .goldenDay]

    public var name: String {
        switch self {
        case .infiniteWisdom: return "Infinite Wisdom"
        case .drinkingContest: return "Drinking Contest"
        case .cardPieceDay: return "Card-piece Day"
        case .doubleLeaguePoints: return "Double League Points"
        case .greatPotionDeal: return "Great Potion Deal"
        case .getTheBestCards: return "Get the Best Cards"
        case .goldenDay: return "Golden Day"
        }
    }

    public var desc: String {
        switch self {
        case .infiniteWisdom: return "Double card XP from every fight."
        case .drinkingContest: return "Potions cost 20 gems."
        case .cardPieceDay: return "Card-piece prices halved, first piece 50 gems."
        case .doubleLeaguePoints: return "300 league points per win."
        case .greatPotionDeal: return "3 potions for 60 gems in the shop."
        case .getTheBestCards: return "Boosters cost 50 % less gems."
        case .goldenDay: return "+50 % gold from quests and arena."
        }
    }
}

/// Features that can be locked (state.js isUnlocked). The client ids (evolve, pvp, enhance, leagues) are aliases.
public enum Feature: String, Codable, CaseIterable, Sendable, Hashable {
    case quests, cards, shop, fusion, arena, pieces, replays, training, league

    /// `featureId(name)`: accepts the client ids and other aliases.
    public init?(alias: String) {
        switch alias {
        case "evolve", "fuse": self = .fusion
        case "pvp": self = .arena
        case "enhance": self = .training
        case "leagues": self = .league
        case "quest": self = .quests
        default:
            guard let f = Feature(rawValue: alias) else { return nil }
            self = f
        }
    }

    /// Features that get a "… Unlocked!" popup.
    public static let popupFeatures: [Feature] = [.fusion, .arena, .training, .league]
}

/// The two sides of a fight (the engine's player 1 = attacker, player 2 = defender).
public enum Side: String, Codable, CaseIterable, Sendable, Hashable {
    case attacker, defender
    public var other: Side { self == .attacker ? .defender : .attacker }
}

public enum Winner: String, Codable, Sendable, Hashable {
    case attacker, defender, draw
}

public enum EndedBy: String, Codable, Sendable, Hashable {
    case playerHp, maxRounds, noAttack
}

/// Card statuses the engine logs (`status` events).
public enum CardStatus: String, Codable, Sendable, Hashable {
    case dazed, suspended, stunned, indestructible
}

/// Causes of `damage` events.
public enum DamageCause: String, Codable, Sendable, Hashable {
    case attack, ability, reflect, death, poison, kill
}

/// Stats a `buff` event can change.
public enum BuffStat: String, Codable, Sendable, Hashable {
    case attack, maxHp
}

/// Fight modes (replays, league points sources).
public enum FightMode: String, Codable, Sendable, Hashable {
    case quest, arena, pieces, league, replay, lab
}

/// Sources of league points.
public enum LeaguePointSource: String, Codable, Sendable, Hashable {
    case league, arena, pieces
}
