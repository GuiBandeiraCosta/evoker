import Foundation

/// Handler registry keys: a buff type, or one of the two halves of `stun_pattern` (`src/engine/effects/index.js`).
public enum HandlerKey: Hashable, Sendable {
    case type(BuffType)
    case stunPatternSuppress
    case stunPatternDaze
}

/// One entry of the phase list (`PHASES` of effects/index.js): the buff type the phase matches, the handler that
/// runs it and whether the phase is an extension slot.
public struct Phase: Hashable, Sendable {
    public let type: BuffType
    public let handler: HandlerKey
    public let ext: Bool

    public init(_ type: BuffType, handler: HandlerKey? = nil, ext: Bool = false) {
        self.type = type
        self.handler = handler ?? .type(type)
        self.ext = ext
    }
}

/// The phase list and the type sets of the original simulator (`src/engine/effects/index.js`).
public enum Phases {
    /// The 18 original buff types in their handler-registration order (`ORIGINAL_TYPES`).
    public static let originalTypes: [BuffType] = BuffType.originals
    /// Extension buff types (`EXTENSION_TYPES`, original-engine.md §8).
    public static let extensionTypes: [BuffType] = BuffType.extensions

    /// Phase list: one buff type per phase in the original order with the extension phases interleaved
    /// (ability-encoding.md §3.1). `stun_pattern` runs in two parts.
    public static let list: [Phase] = [
        Phase(.no_buff),
        Phase(.stun_pattern, handler: .stunPatternSuppress, ext: true),
        Phase(.swap_stats_random, ext: true),
        Phase(.raise_attack),
        Phase(.raise_hp),
        Phase(.raise_player_hp),
        Phase(.increment_attack),
        Phase(.gamble, ext: true),
        Phase(.reduce_ability_attack_percent, ext: true),
        Phase(.invulnerable),
        Phase(.no_damage),
        Phase(.stun_pattern, handler: .stunPatternDaze, ext: true),
        Phase(.attack),
        Phase(.bonus_attack, ext: true),
        Phase(.reflect_damage),
        Phase(.reflect_damage_to_player),
        Phase(.deal_damage_to_all_opponent_cards),
        Phase(.self_damage),
        Phase(.heal_boost_percent, ext: true),
        Phase(.heal),
        Phase(.wheel, ext: true),
        Phase(.heal_player),
        Phase(.die),
        Phase(.resurrect),
        Phase(.resurrect_allies, ext: true),
        Phase(.deal_damage_to_opponent_player),
        Phase(.deal_damage_to_player),
        Phase(.kill, ext: true),
    ]

    /// The `die` phase entry (run again after every event-loop pass).
    public static let diePhase: Phase = list.first { $0.type == .die }!

    /// Original buff types whose handler ignores its target: in event mode their directions act as a trigger
    /// filter (the handler runs only for directions whose target is the event's `to` card).
    public static let targetlessTypes: Set<BuffType> = [
        .raise_player_hp, .heal_player, .self_damage, .deal_damage_to_opponent_player, .deal_damage_to_player,
        .deal_damage_to_all_opponent_cards, .resurrect,
    ]

    /// Extension types called once per matched buff (target nil) whatever their scope says.
    public static let onceTypes: Set<BuffType> = [.heal_boost_percent, .resurrect_allies, .stun_pattern]

    /// Every handler key the registry knows (`HANDLERS`).
    public static let handlerKeys: Set<HandlerKey> = Set(originalTypes.map { HandlerKey.type($0) } + extensionTypes.map { HandlerKey.type($0) }
        + [.stunPatternSuppress, .stunPatternDaze]).subtracting([.type(.stun_pattern)])
}
