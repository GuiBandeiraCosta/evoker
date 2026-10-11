import Foundation

/// Static card data: one entry of `data/cards.json` (architecture.md §3.1). Decodes the file as built by the web
/// data pipeline; nothing here is edited by hand.
public struct CardDef: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let tribe: Tribe
    public let rarity: Rarity
    public let mana: Int
    /// Attack directions (catalog names); empty = the card does not attack.
    public let dirs: [CatalogDirection]
    /// Stage 0, level 1 values.
    public let base: CardBase
    /// Level cap per stage 0..4.
    public let caps: [Int]
    /// Stat value at the cap of each stage (nil = unknown → derived by Stats).
    public let growth: CardGrowth
    public let ability: AbilityDef?
    public let set: String
    /// Extra sets (the main-line album sets).
    public let sets: [String]?
    /// Art file name per stage ("0" … "4"), present in GameAssets/cards.
    public let art: [String: String]
    public let categories: [String]
    public let sourceText: String
    public let evolving: Bool?
    public let trainer: Bool?
    /// Legacy alias of `flat: ["ability"]`.
    public let abilityFlat: Bool?
    /// Stats that never grow with the level.
    public let flat: [StatKey]?
    /// The ability value is a percentage (Djinn, Medusa, Dark Mage).
    public let abilityIsPercent: Bool?

    public init(id: String, name: String, tribe: Tribe, rarity: Rarity, mana: Int, dirs: [CatalogDirection], base: CardBase,
                caps: [Int], growth: CardGrowth = CardGrowth(), ability: AbilityDef? = nil, set: String = "main", sets: [String]? = nil,
                art: [String: String] = [:], categories: [String] = [], sourceText: String = "", evolving: Bool? = nil,
                trainer: Bool? = nil, abilityFlat: Bool? = nil, flat: [StatKey]? = nil, abilityIsPercent: Bool? = nil) {
        self.id = id; self.name = name; self.tribe = tribe; self.rarity = rarity; self.mana = mana; self.dirs = dirs
        self.base = base; self.caps = caps; self.growth = growth; self.ability = ability; self.set = set; self.sets = sets
        self.art = art; self.categories = categories; self.sourceText = sourceText; self.evolving = evolving
        self.trainer = trainer; self.abilityFlat = abilityFlat; self.flat = flat; self.abilityIsPercent = abilityIsPercent
    }

    public var isTrainer: Bool { trainer == true }
    public var isPercentAbility: Bool { abilityIsPercent == true }

    /// `card.set === set || card.sets.includes(set)` (cards-db.js cardInSet).
    public func inSet(_ setId: String) -> Bool {
        set == setId || (sets?.contains(setId) ?? false)
    }

    /// Art file of a stage, falling back to the base art (card-view.js artUrlFor).
    public func artFile(stage: Int) -> String? {
        art[String(stage)] ?? art["0"]
    }

    enum CodingKeys: String, CodingKey {
        case id, name, tribe, rarity, mana, dirs, base, caps, growth, ability, set, sets, art, categories, sourceText,
             evolving, trainer, abilityFlat, flat, abilityIsPercent
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = c.string(.name, default: id)
        tribe = Tribe(lenient: c.stringOrNil(.tribe))
        rarity = c.lenient(Rarity.self, .rarity, default: .common)
        mana = c.int(.mana)
        dirs = c.array(CatalogDirection.self, .dirs)
        base = c.lenient(CardBase.self, .base, default: CardBase(attack: 0, hp: 1, ability: nil))
        caps = c.array(Int.self, .caps)
        growth = c.lenient(CardGrowth.self, .growth, default: CardGrowth())
        ability = c.optionalValue(AbilityDef.self, .ability)
        set = c.string(.set, default: "main")
        sets = c.optionalValue([String].self, .sets)
        art = c.dictionary(String.self, .art)
        categories = c.array(String.self, .categories)
        sourceText = c.string(.sourceText)
        evolving = c.boolOrNil(.evolving)
        trainer = c.boolOrNil(.trainer)
        abilityFlat = c.boolOrNil(.abilityFlat)
        flat = c.optionalValue([StatKey].self, .flat)
        abilityIsPercent = c.boolOrNil(.abilityIsPercent)
    }
}

public enum StatKey: String, Codable, CaseIterable, Sendable, Hashable {
    case attack, hp, ability
}

public struct CardBase: Codable, Hashable, Sendable {
    public var attack: Double
    public var hp: Double
    /// nil when the card has no ability value.
    public var ability: Double?

    public init(attack: Double, hp: Double, ability: Double?) {
        self.attack = attack; self.hp = hp; self.ability = ability
    }

    enum CodingKeys: String, CodingKey { case attack, hp, ability }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        attack = c.double(.attack)
        hp = c.double(.hp)
        ability = c.doubleOrNil(.ability)
    }

    /// `base[stat]` (nil for a missing ability).
    public func value(_ stat: StatKey) -> Double? {
        switch stat {
        case .attack: return attack
        case .hp: return hp
        case .ability: return ability
        }
    }
}

public struct CardGrowth: Codable, Hashable, Sendable {
    public var attack: [Double?]
    public var hp: [Double?]
    public var ability: [Double?]

    public init(attack: [Double?] = [nil, nil, nil, nil, nil], hp: [Double?] = [nil, nil, nil, nil, nil], ability: [Double?] = [nil, nil, nil, nil, nil]) {
        self.attack = attack; self.hp = hp; self.ability = ability
    }

    enum CodingKeys: String, CodingKey { case attack, hp, ability }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        attack = c.optionalArray(Double.self, .attack)
        hp = c.optionalArray(Double.self, .hp)
        ability = c.optionalArray(Double.self, .ability)
    }

    public func values(_ stat: StatKey) -> [Double?] {
        switch stat {
        case .attack: return attack
        case .hp: return hp
        case .ability: return ability
        }
    }
}

// MARK: - Abilities (docs/design/ability-encoding.md)

/// An ability entry of `data/abilities.json`: a plain entry, or one entry per fusion stage.
public enum AbilityDef: Codable, Hashable, Sendable {
    case single(AbilityEntry)
    case byStage([AbilityEntry?], notes: String?)

    enum CodingKeys: String, CodingKey { case byStage, notes, text, buffs }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if c.contains(.byStage) {
            let stages = c.optionalArray(AbilityEntry.self, .byStage)
            self = .byStage(stages, notes: c.stringOrNil(.notes))
        } else {
            self = .single(try AbilityEntry(from: decoder))
        }
    }

    public func encode(to encoder: Encoder) throws {
        switch self {
        case .single(let e):
            try e.encode(to: encoder)
        case .byStage(let stages, let notes):
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(stages, forKey: .byStage)
            try c.encodeIfPresent(notes, forKey: .notes)
        }
    }

    /// `abilityForStage(ability, stage)`: the entry that applies at a fusion stage.
    public func entry(stage: Int) -> AbilityEntry? {
        switch self {
        case .single(let e): return e
        case .byStage(let stages, _):
            guard !stages.isEmpty else { return nil }
            let s = min(max(stage, 0), stages.count - 1)
            return stages[s]
        }
    }

    /// Every stage entry (one for a plain ability).
    public var entries: [AbilityEntry?] {
        switch self {
        case .single(let e): return [e]
        case .byStage(let stages, _): return stages
        }
    }
}

public struct AbilityEntry: Codable, Hashable, Sendable {
    /// Original card text with the number replaced by `{v}` or the percent by `{pct}`.
    public var text: String
    public var buffs: [Buff]
    public var notes: String?

    public init(text: String, buffs: [Buff], notes: String? = nil) {
        self.text = text; self.buffs = buffs; self.notes = notes
    }

    enum CodingKeys: String, CodingKey { case text, buffs, notes }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        text = c.string(.text)
        buffs = c.array(Buff.self, .buffs)
        notes = c.stringOrNil(.notes)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(text, forKey: .text)
        try c.encode(buffs, forKey: .buffs)
        try c.encodeIfPresent(notes, forKey: .notes)
    }

    public var hasBuffs: Bool { !buffs.isEmpty }
}

/// A buff strength: a number, or the card's level-scaled ability value (`"value"` / `"-value"`).
public enum ValueRef: Codable, Hashable, Sendable {
    case number(Double)
    case value
    case negValue

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let d = try? c.decode(Double.self) { self = .number(d); return }
        let s = try c.decode(String.self)
        switch s {
        case "value": self = .value
        case "-value": self = .negValue
        default:
            if let d = Double(s) { self = .number(d) } else { throw DecodingError.dataCorruptedError(in: c, debugDescription: "bad value ref \(s)") }
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .number(let d):
            if d == d.rounded(.towardZero), abs(d) < 9.0e15 { try c.encode(Int64(d)) } else { try c.encode(d) }
        case .value: try c.encode("value")
        case .negValue: try c.encode("-value")
        }
    }

    /// `concrete(v, abilityValue)` of battle-state.js.
    public func resolved(_ abilityValue: Double) -> Double {
        switch self {
        case .number(let d): return d
        case .value: return abilityValue
        case .negValue: return -abilityValue
        }
    }

    /// True for `"value"` / `"-value"` (a reference to the card's ability value).
    public var isValueRef: Bool { if case .number = self { return false } else { return true } }
}

/// `eventData`: the round number of `round_*` events, or the target tag of `onDamage` / `onDeath` / `onHeal`.
public enum EventData: Codable, Hashable, Sendable {
    case round(Int)
    case tag(String)

    public static let selfTag = EventData.tag("self")
    public static let opponentCards = EventData.tag("opponent_cards")
    public static let ownCards = EventData.tag("own_cards")

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let i = try? c.decode(Int.self) { self = .round(i); return }
        if let d = try? c.decode(Double.self) { self = .round(Int(d)); return }
        let s = try c.decode(String.self)
        if let i = Int(s) { self = .round(i) } else { self = .tag(s) }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .round(let n): try c.encode(n)
        case .tag(let s): try c.encode(s)
        }
    }

    public var roundNumber: Int? { if case .round(let n) = self { return n } else { return nil } }
    public var tagValue: String? { if case .tag(let s) = self { return s } else { return nil } }
}

public struct BuffFilter: Codable, Hashable, Sendable {
    public var tribe: Tribe?
    public var offensive: Bool?
    public var excludeSelf: Bool?
    public var hasAbility: Bool?

    public init(tribe: Tribe? = nil, offensive: Bool? = nil, excludeSelf: Bool? = nil, hasAbility: Bool? = nil) {
        self.tribe = tribe; self.offensive = offensive; self.excludeSelf = excludeSelf; self.hasAbility = hasAbility
    }
}

/// A buff in the original simulator's model (ability-encoding.md §1). Also the shape of the pre-resolved buffs of
/// raw test cards (`BattleCard.buffs`), where strengths are plain numbers.
public struct Buff: Codable, Hashable, Sendable {
    public var type: BuffType
    public var strength: ValueRef?
    public var strengthPercent: ValueRef?
    public var cap: ValueRef?
    public var directions: [OriginalDirection]
    public var scope: BuffScope?
    public var filter: BuffFilter?
    public var pick: PickRule?
    public var count: Int?
    public var event: BuffEvent
    public var eventData: EventData?
    public var nextRound: Bool?
    public var emptyReduction: Int?
    public var perTarget: Bool?
    public var baseAttack: Bool?
    public var unreflectable: Bool?
    public var triggerDirection: OriginalDirection?
    public var damagedBySelf: Bool?
    public var strengthFromEvent: Bool?
    public var ext: Bool?
    /// Whether the buff carried a `directions` list at all (JSON key present / init argument given). The web keeps
    /// `undefined` apart from `[]`: an `attack` buff WITHOUT the key takes the card's directions (battle-state.js
    /// normaliseBuff `dirs == null`), one with an empty list keeps it and hits the opposing player once.
    public var directionsSpecified: Bool

    public init(type: BuffType, strength: ValueRef? = nil, strengthPercent: ValueRef? = nil, cap: ValueRef? = nil,
                directions: [OriginalDirection]? = nil, scope: BuffScope? = nil, filter: BuffFilter? = nil, pick: PickRule? = nil,
                count: Int? = nil, event: BuffEvent = .always, eventData: EventData? = nil, nextRound: Bool? = nil,
                emptyReduction: Int? = nil, perTarget: Bool? = nil, baseAttack: Bool? = nil, unreflectable: Bool? = nil,
                triggerDirection: OriginalDirection? = nil, damagedBySelf: Bool? = nil, strengthFromEvent: Bool? = nil, ext: Bool? = nil) {
        self.type = type; self.strength = strength; self.strengthPercent = strengthPercent; self.cap = cap
        self.directions = directions ?? []; self.directionsSpecified = directions != nil
        self.scope = scope; self.filter = filter; self.pick = pick; self.count = count
        self.event = event; self.eventData = eventData; self.nextRound = nextRound; self.emptyReduction = emptyReduction
        self.perTarget = perTarget; self.baseAttack = baseAttack; self.unreflectable = unreflectable
        self.triggerDirection = triggerDirection; self.damagedBySelf = damagedBySelf; self.strengthFromEvent = strengthFromEvent; self.ext = ext
    }

    enum CodingKeys: String, CodingKey {
        case type, strength, strengthPercent, cap, directions, scope, filter, pick, count, event, eventData, nextRound,
             emptyReduction, perTarget, baseAttack, unreflectable, triggerDirection, damagedBySelf, strengthFromEvent, ext
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let typeRaw = c.string(.type)
        guard let t = BuffType(rawValue: typeRaw) else {
            throw DecodingError.dataCorruptedError(forKey: .type, in: c, debugDescription: "unknown buff type \(typeRaw)")
        }
        type = t
        strength = c.optionalValue(ValueRef.self, .strength)
        strengthPercent = c.optionalValue(ValueRef.self, .strengthPercent)
        cap = c.optionalValue(ValueRef.self, .cap)
        // unknown direction names are dropped (originalDirs of battle-state.js); a missing key stays distinguishable
        let rawDirs = c.array(String.self, .directions)
        directions = rawDirs.compactMap { OriginalDirection(rawValue: $0) }
        directionsSpecified = c.contains(.directions)
        scope = c.optionalValue(BuffScope.self, .scope)
        filter = c.optionalValue(BuffFilter.self, .filter)
        pick = c.optionalValue(PickRule.self, .pick)
        count = c.intOrNil(.count)
        event = c.lenient(BuffEvent.self, .event, default: .always)
        eventData = c.optionalValue(EventData.self, .eventData)
        nextRound = c.boolOrNil(.nextRound)
        emptyReduction = c.intOrNil(.emptyReduction)
        perTarget = c.boolOrNil(.perTarget)
        baseAttack = c.boolOrNil(.baseAttack)
        unreflectable = c.boolOrNil(.unreflectable)
        triggerDirection = c.optionalValue(OriginalDirection.self, .triggerDirection)
        damagedBySelf = c.boolOrNil(.damagedBySelf)
        strengthFromEvent = c.boolOrNil(.strengthFromEvent)
        ext = c.boolOrNil(.ext)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(type, forKey: .type)
        try c.encodeIfPresent(strength, forKey: .strength)
        try c.encodeIfPresent(strengthPercent, forKey: .strengthPercent)
        try c.encodeIfPresent(cap, forKey: .cap)
        if directionsSpecified || !directions.isEmpty { try c.encode(directions, forKey: .directions) }
        try c.encodeIfPresent(scope, forKey: .scope)
        try c.encodeIfPresent(filter, forKey: .filter)
        try c.encodeIfPresent(pick, forKey: .pick)
        try c.encodeIfPresent(count, forKey: .count)
        try c.encode(event, forKey: .event)
        try c.encodeIfPresent(eventData, forKey: .eventData)
        try c.encodeIfPresent(nextRound, forKey: .nextRound)
        try c.encodeIfPresent(emptyReduction, forKey: .emptyReduction)
        try c.encodeIfPresent(perTarget, forKey: .perTarget)
        try c.encodeIfPresent(baseAttack, forKey: .baseAttack)
        try c.encodeIfPresent(unreflectable, forKey: .unreflectable)
        try c.encodeIfPresent(triggerDirection, forKey: .triggerDirection)
        try c.encodeIfPresent(damagedBySelf, forKey: .damagedBySelf)
        try c.encodeIfPresent(strengthFromEvent, forKey: .strengthFromEvent)
        try c.encodeIfPresent(ext, forKey: .ext)
    }
}
