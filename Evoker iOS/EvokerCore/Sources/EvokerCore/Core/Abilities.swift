import Foundation

/// Ability data helpers for the original buff model (`src/core/abilities.js`; docs/design/original-engine.md,
/// ability-encoding.md): validation of `data/abilities.json`, the entry per fusion stage, display text, the
/// direction arrows and `buffsForStage`, the concrete buff list the engine runs. Pure: no randomness, no time.
public enum Abilities {
    /// Metadata of a buff type (`BUFF_TYPES`): the original phase slot it runs in, whether it is an extension.
    public struct BuffTypeInfo: Hashable, Sendable {
        public let phase: String
        public let ext: Bool
        public let description: String
    }

    /// Metadata of a buff event (`EVENTS`).
    public struct EventInfo: Hashable, Sendable {
        public let ext: Bool
        public let roundMode: Bool
        public let description: String
    }

    /// Buff types: the 18 original handlers plus the extensions of original-engine.md §8, in declaration order.
    public static let buffTypes: [(type: BuffType, info: BuffTypeInfo)] = [
        (.no_buff, BuffTypeInfo(phase: "no_buff", ext: false, description: "Target card loses its abilities this round (noBuffsAllowed). Not blocked by the source being suppressed.")),
        (.raise_attack, BuffTypeInfo(phase: "raise_attack", ext: false, description: "Target card attack += round(strength / #directions) this round (negative lowers). Ext: strengthPercent of the card attack, baseAttack for origAttack.")),
        (.raise_hp, BuffTypeInfo(phase: "raise_hp", ext: false, description: "Target card hp += round(strength / #directions) this round.")),
        (.raise_player_hp, BuffTypeInfo(phase: "raise_player_hp", ext: false, description: "Own player hp += strength this round (re-applied every round while the card lives, so effectively permanent).")),
        (.increment_attack, BuffTypeInfo(phase: "increment_attack", ext: false, description: "Target card origAttack and attack += strength, permanently (not split). Ext: strengthPercent + baseAttack = percent of origAttack.")),
        (.invulnerable, BuffTypeInfo(phase: "invulnerable", ext: false, description: "Target card takes no damage this round (attacks are logged as blocked).")),
        (.no_damage, BuffTypeInfo(phase: "no_damage", ext: false, description: "Target card attack = 0 this round (daze).")),
        (.attack, BuffTypeInfo(phase: "attack", ext: false, description: "The normal attack: round(attack / #directions) per direction; empty slot: (attack - emptyReduction) / #directions to the opposing player. Stored only to override the implicit attack.")),
        (.reflect_damage, BuffTypeInfo(phase: "reflect_damage", ext: false, description: "onDamage/self: the attacking card takes the same damage (blocked if it is invulnerable). Ext: cap.")),
        (.reflect_damage_to_player, BuffTypeInfo(phase: "reflect_damage_to_player", ext: false, description: "onDamage/self: the attacking player takes the same damage. Ext: cap = maximum per hit.")),
        (.deal_damage_to_all_opponent_cards, BuffTypeInfo(phase: "deal_damage_to_all_opponent_cards", ext: false, description: "Every opposing card takes strength (blocked by invulnerable; pushes onDamage events unless unreflectable).")),
        (.self_damage, BuffTypeInfo(phase: "self_damage", ext: false, description: "This card takes strength.")),
        (.heal, BuffTypeInfo(phase: "heal", ext: false, description: "Target card (not dead) takenDamage -= round(strength / #directions). Data: perTarget marks a per-target amount that the pipeline multiplies by #directions.")),
        (.heal_player, BuffTypeInfo(phase: "heal_player", ext: false, description: "Own player takenDamage -= strength (min 0).")),
        (.die, BuffTypeInfo(phase: "die", ext: false, description: "Implicit for every card (self/always): marks the card dead when takenDamage >= hp and pushes onDeath. Never stored.")),
        (.resurrect, BuffTypeInfo(phase: "resurrect", ext: false, description: "onDeath/self: once per fight, takenDamage = 0, died = false.")),
        (.deal_damage_to_opponent_player, BuffTypeInfo(phase: "deal_damage_to_opponent_player", ext: false, description: "Opposing player takenDamage += strength. With onDeath/opponent_cards and directions, only when the dying card is at one of the directions.")),
        (.deal_damage_to_player, BuffTypeInfo(phase: "deal_damage_to_player", ext: false, description: "Own player takenDamage += strength.")),
        (.bonus_attack, BuffTypeInfo(phase: "attack", ext: true, description: "[ext] Extra attack in the event loop: strengthPercent of the card attack (origAttack with baseAttack) split over the directions; empty slots hit the opposing player.")),
        (.kill, BuffTypeInfo(phase: "end_of_round", ext: true, description: "[ext] After the phase list of round eventData: marks `count` cards of `scope` picked by `pick` dead (ignores invulnerable) and pushes onDeath.")),
        (.resurrect_allies, BuffTypeInfo(phase: "resurrect", ext: true, description: "[ext] onDeath/self, once per fight: every own card that died this round (itself included) is resurrected; revived cards fire no death triggers.")),
        (.swap_stats_random, BuffTypeInfo(phase: "raise_attack", ext: true, description: "[ext] Before the raise_attack buffs of round eventData: one random living card of `scope` swaps attack and hp (orig values too).")),
        (.wheel, BuffTypeInfo(phase: "heal", ext: true, description: "[ext] Heal slot: every card of `scope` is healed by strength (50 %) or damaged by strength (50 %), one roll per card.")),
        (.gamble, BuffTypeInfo(phase: "raise_attack", ext: true, description: "[ext] After the raise_attack buffs: one roll per round; with probability (100 - strengthPercent) % every card of `scope` gets +25 % attack this round, otherwise -25 %.")),
        (.heal_boost_percent, BuffTypeInfo(phase: "heal", ext: true, description: "[ext] While the card lives: heal buffs of own cards heal round(strength x (1 + pct / 100)); several sources add their percents. Not heal_player.")),
        (.reduce_ability_attack_percent, BuffTypeInfo(phase: "raise_attack", ext: true, description: "[ext] After every raise_attack/gamble of the round: every card of `scope` matching `filter` (cards with an ability, not itself) loses strengthPercent % of its attack; several sources multiply.")),
        (.stun_pattern, BuffTypeInfo(phase: "no_buff", ext: true, description: "[ext] Thief of Time: odd rounds no_buff + no_damage on [front, left, right]; even rounds on [frontLeft, frontRight].")),
    ]

    /// `BUFF_TYPES[type]`.
    public static func info(_ type: BuffType) -> BuffTypeInfo? {
        buffTypes.first { $0.type == type }?.info
    }

    /// Original direction names (original-engine.md §2).
    public static let directions: [OriginalDirection] = [.front, .frontLeft, .frontRight, .left, .right, .selfSlot]

    /// Buff events in declaration order; `round_odd`, `round_even` and `onHeal` are extensions.
    public static let events: [(event: BuffEvent, info: EventInfo)] = [
        (.always, EventInfo(ext: false, roundMode: true, description: "Every round.")),
        (.round_eq, EventInfo(ext: false, roundMode: true, description: "Round == eventData.")),
        (.round_ge, EventInfo(ext: false, roundMode: true, description: "Round >= eventData.")),
        (.round_le, EventInfo(ext: false, roundMode: true, description: "Round <= eventData.")),
        (.round_odd, EventInfo(ext: true, roundMode: true, description: "[ext] Odd rounds.")),
        (.round_even, EventInfo(ext: true, roundMode: true, description: "[ext] Even rounds.")),
        (.onDamage, EventInfo(ext: false, roundMode: false, description: "A card took damage; eventData: nil (any), \"self\", \"opponent_cards\".")),
        (.onDeath, EventInfo(ext: false, roundMode: false, description: "A card died; eventData: nil (any), \"self\", \"opponent_cards\".")),
        (.onHeal, EventInfo(ext: true, roundMode: false, description: "[ext] A card was healed by a heal buff; eventData \"self\".")),
    ]

    /// Catalog direction name → original direction name (`DIR_MAP`).
    public static let dirMap: [CatalogDirection: OriginalDirection] = [.direct: .front, .left: .frontLeft, .right: .frontRight, .ownLeft: .left, .ownRight: .right]
    /// Original direction name → catalog direction name (`DIR_MAP_BACK`; `self` has none).
    public static let dirMapBack: [OriginalDirection: CatalogDirection] = [.front: .direct, .frontLeft: .left, .frontRight: .right, .left: .ownLeft, .right: .ownRight]

    /// [ext] Target scopes for buffs that act on a set of cards instead of directions (`SCOPES`).
    public static let scopes: [(scope: BuffScope, description: String)] = [
        (.own_cards, "every living own card"),
        (.opponent_cards, "every living opposing card"),
        (.all_cards, "every living card on both sides"),
        (.each_side, "the pick is made once on the own side and once on the opponent side (Bouncer)"),
    ]
    /// [ext] Pick rules for scope buffs (`PICKS`).
    public static let picks: [PickRule] = [.highest_attack, .lowest_attack, .random]
    /// [ext] filter keys (`FILTER_KEYS`).
    public static let filterKeys = ["tribe", "offensive", "excludeSelf", "hasAbility"]
    /// Fields that make a buff an extension (must carry `ext: true`) — `EXT_FIELDS`.
    public static let extFields = ["strengthPercent", "cap", "nextRound", "pick", "count", "scope", "filter", "baseAttack",
                                   "unreflectable", "triggerDirection", "damagedBySelf", "strengthFromEvent"]
    static let buffKeys = ["type", "strength", "strengthPercent", "cap", "directions", "scope", "filter", "pick", "count", "event", "eventData",
                           "nextRound", "emptyReduction", "perTarget", "baseAttack", "unreflectable", "triggerDirection", "damagedBySelf", "strengthFromEvent", "ext"]

    static let needsStrength: [BuffType] = [.raise_attack, .raise_hp, .raise_player_hp, .increment_attack, .heal, .heal_player, .self_damage,
                                            .deal_damage_to_all_opponent_cards, .deal_damage_to_opponent_player, .deal_damage_to_player, .wheel]
    static let needsPercent: [BuffType] = [.bonus_attack, .heal_boost_percent, .reduce_ability_attack_percent, .gamble]
    static let noStrength: [BuffType] = [.no_buff, .invulnerable, .no_damage, .attack, .reflect_damage, .reflect_damage_to_player, .die, .resurrect,
                                         .kill, .resurrect_allies, .swap_stats_random, .stun_pattern]
    static let cardTarget: [BuffType] = [.no_buff, .raise_attack, .raise_hp, .increment_attack, .invulnerable, .no_damage, .heal, .attack, .bonus_attack,
                                         .reflect_damage, .reflect_damage_to_player, .resurrect, .die]
    static let noDirections: [BuffType] = [.raise_player_hp, .heal_player, .self_damage, .deal_damage_to_all_opponent_cards, .deal_damage_to_player, .kill,
                                           .resurrect_allies, .swap_stats_random, .wheel, .gamble, .heal_boost_percent, .reduce_ability_attack_percent, .stun_pattern]
    static let eventMode: [BuffEvent] = [.onDamage, .onDeath, .onHeal]
    /// Heal-like buff types whose directions are drawn as green arrows (card-view.js HEAL_BUFF_TYPES).
    public static let healBuffTypes: [BuffType] = [.heal, .heal_boost_percent, .wheel]

    // MARK: Validation

    /// True when a buff uses an extension type, event or field (`isExtensionBuff`).
    public static func isExtensionBuff(_ b: Buff) -> Bool {
        if b.type.isExtension { return true }
        if b.event.isExtension { return true }
        return b.strengthPercent != nil || b.cap != nil || b.nextRound != nil || b.pick != nil || b.count != nil || b.scope != nil
            || b.filter != nil || b.baseAttack != nil || b.unreflectable != nil || b.triggerDirection != nil || b.damagedBySelf != nil
            || b.strengthFromEvent != nil
    }

    private static func isValueOrNumber(_ v: ValueRef?) -> Bool {
        switch v {
        case nil: return true
        case .value?: return true
        case .number(let d)?: return d.isFinite
        case .negValue?: return false
        }
    }

    /// Validate one buff (`validateBuff`) — the checks the typed model can still fail.
    static func validateBuff(_ b: Buff, where: String) -> [String] {
        var errors: [String] = []
        func err(_ m: String) { errors.append("\(`where`): \(m)") }
        if b.type == .none { err("unknown buff type \"none\""); return errors }
        if b.type == .die { err("die is implicit and must not be stored") }
        // directions
        if Set(b.directions).count != b.directions.count { err("duplicate directions") }
        let dirs = b.directions
        // event / eventData
        if [.round_eq, .round_ge, .round_le].contains(b.event) {
            if !(b.eventData?.roundNumber.map { $0 > 0 } ?? false) { err("\(b.event.rawValue) needs a positive integer eventData") }
        } else if eventMode.contains(b.event) {
            if let ed = b.eventData, ed != .selfTag, ed != .opponentCards { err("\(b.event.rawValue) eventData must be \"self\", \"opponent_cards\" or absent") }
            if b.event == .onHeal && b.eventData != .selfTag { err("onHeal needs eventData \"self\"") }
        } else if b.eventData != nil {
            err("\(b.event.rawValue) takes no eventData")
        }
        let isEvent = eventMode.contains(b.event)
        // strengths
        if !isValueOrNumber(b.strength) { err("strength must be \"value\" or a number") }
        if !isValueOrNumber(b.strengthPercent) { err("strengthPercent must be \"value\" or a number") }
        if b.strength != nil && b.strengthPercent != nil { err("strength and strengthPercent are exclusive") }
        if let sfe = b.strengthFromEvent {
            if sfe != true { err("strengthFromEvent must be true") }
            if ![.onHeal, .onDamage].contains(b.event) { err("strengthFromEvent needs an onHeal/onDamage event") }
            if b.strength != nil || b.strengthPercent != nil { err("strengthFromEvent excludes strength") }
        }
        let hasStrength = b.strength != nil || b.strengthPercent != nil || b.strengthFromEvent == true
        if needsStrength.contains(b.type) && !hasStrength { err("\(b.type.rawValue) needs a strength") }
        if needsPercent.contains(b.type) && b.strengthPercent == nil { err("\(b.type.rawValue) needs strengthPercent") }
        if noStrength.contains(b.type) && hasStrength { err("\(b.type.rawValue) takes no strength") }
        if b.strengthPercent != nil && !([.raise_attack, .increment_attack] + needsPercent).contains(b.type) { err("strengthPercent is not allowed on \(b.type.rawValue)") }
        // cap / emptyReduction / unreflectable / baseAttack
        if let cap = b.cap {
            var ok = cap == .value
            if case .number(let d) = cap, d.isFinite, d > 0 { ok = true }
            if !ok { err("cap must be \"value\" or a positive number") }
            if ![.reflect_damage, .reflect_damage_to_player].contains(b.type) { err("cap is only allowed on reflect buffs") }
        }
        if b.emptyReduction != nil && b.type != .attack { err("emptyReduction must be an integer on an attack buff") }
        if let u = b.unreflectable, u != true || ![.attack, .deal_damage_to_all_opponent_cards].contains(b.type) { err("unreflectable must be true on attack / deal_damage_to_all_opponent_cards") }
        if let ba = b.baseAttack, ba != true || b.strengthPercent == nil { err("baseAttack must be true and needs strengthPercent") }
        // scope / filter / pick / count
        if b.scope != nil && !dirs.isEmpty { err("a scope buff has no directions") }
        if let f = b.filter {
            if f.tribe == nil && f.offensive == nil && f.excludeSelf == nil && f.hasAbility == nil { err("filter must be a non-empty object") }
            if f.offensive == false { err("filter.offensive is invalid") }
            if f.excludeSelf == false { err("filter.excludeSelf is invalid") }
            if f.hasAbility == false { err("filter.hasAbility is invalid") }
            if b.scope == nil && dirs.isEmpty { err("filter needs a scope or directions") }
        }
        if b.pick != nil {
            if b.scope == nil { err("pick needs a scope") }
            if !(b.count.map { $0 > 0 } ?? false) { err("pick needs a positive integer count") }
        } else if b.count != nil {
            err("count needs a pick")
        }
        if b.type == .kill && (b.pick == nil || b.event != .round_eq) { err("kill needs pick/count/scope and a round_eq event") }
        if b.type == .swap_stats_random && b.pick != .random { err("swap_stats_random needs pick \"random\"") }
        // directions by type
        if cardTarget.contains(b.type) && b.scope == nil && dirs.isEmpty { err("\(b.type.rawValue) needs directions") }
        if noDirections.contains(b.type) && !dirs.isEmpty { err("\(b.type.rawValue) takes no directions") }
        if b.type == .deal_damage_to_opponent_player && !dirs.isEmpty && !isEvent { err("directions on deal_damage_to_opponent_player are only a target check for event buffs") }
        if [.reflect_damage, .reflect_damage_to_player].contains(b.type) && (b.event != .onDamage || dirs != [.selfSlot]) { err("\(b.type.rawValue) must be onDamage with directions [self]") }
        if b.type == .resurrect && (b.event != .onDeath || b.eventData != .selfTag || dirs != [.selfSlot]) { err("resurrect must be onDeath/self with directions [self]") }
        if b.type == .resurrect_allies && (b.event != .onDeath || b.eventData != .selfTag) { err("resurrect_allies must be onDeath/self") }
        if b.type == .bonus_attack && !isEvent { err("bonus_attack needs an event") }
        // event-only fields
        if let v = b.nextRound, v != true || !isEvent { err("nextRound must be true on an event buff") }
        if let v = b.damagedBySelf, v != true || !isEvent { err("damagedBySelf must be true on an event buff") }
        if b.damagedBySelf != nil && b.event != .onDeath { err("damagedBySelf needs onDeath") }
        if let td = b.triggerDirection, td == .selfSlot || !isEvent { err("triggerDirection must be a non-self direction on an event buff") }
        // perTarget
        if let pt = b.perTarget {
            if pt != true { err("perTarget must be true") }
            if ![.heal, .raise_hp, .raise_attack].contains(b.type) { err("perTarget is only for heal / raise_hp / raise_attack") }
            if dirs.isEmpty || b.strength == nil { err("perTarget needs directions and a strength") }
        }
        // ext flag consistency
        let ext = isExtensionBuff(b)
        if ext && b.ext != true { err("extension buff must carry ext: true") }
        if !ext && b.ext != nil { err("ext is only allowed on extension buffs") }
        return errors
    }

    /// Validate one (non-byStage) ability entry (`validateEntry`).
    static func validateEntry(_ a: AbilityEntry, where: String) -> [String] {
        var errors: [String] = []
        for (i, b) in a.buffs.enumerated() { errors += validateBuff(b, where: "\(`where`).buffs[\(i)]") }
        if a.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("\(`where`): missing text")
        } else {
            let bad = placeholders(in: a.text).filter { $0 != "{v}" && $0 != "{pct}" }
            if !bad.isEmpty { errors.append("\(`where`): unknown placeholder(s) \(bad.joined(separator: ", "))") }
            if a.text.contains("__") { errors.append("\(`where`): text still contains a blank \"____\"") }
            let usesValue = a.buffs.contains { $0.strength == .value || $0.cap == .value }
            let usesPct = a.buffs.contains { $0.strengthPercent == .value }
            if a.text.contains("{v}") && !usesValue { errors.append("\(`where`): text has {v} but no buff uses strength/cap \"value\"") }
            if a.text.contains("{pct}") && !usesPct { errors.append("\(`where`): text has {pct} but no buff uses strengthPercent \"value\"") }
        }
        return errors
    }

    /// `{...}` placeholders of a text.
    static func placeholders(in text: String) -> [String] {
        var out: [String] = []
        var current: String?
        for ch in text {
            if ch == "{" {
                current = "{"
            } else if let c = current {
                current = c + String(ch)
                if ch == "}" {
                    out.append(current!)
                    current = nil
                }
            }
        }
        return out
    }

    /// Validate an ability entry (`validateAbility`): nil, a plain entry, or `byStage` with exactly 5 entries of
    /// which at least one has buffs. The typed model already rejects unknown types / directions / events / fields
    /// (`validateRaw` reports those for raw JSON).
    public static func validate(_ ability: AbilityDef?) -> [String] {
        guard let ability else { return [] }
        switch ability {
        case .single(let entry):
            return validateEntry(entry, where: "ability")
        case .byStage(let stages, _):
            var errors: [String] = []
            if stages.count != 5 { return errors + ["byStage must be an array of exactly 5 entries"] }
            for (i, st) in stages.enumerated() {
                if let st { errors += validateEntry(st, where: "byStage[\(i)]") }
            }
            if !stages.contains(where: { ($0?.buffs.count ?? 0) > 0 }) { errors.append("byStage must contain at least one stage with buffs") }
            return errors
        }
    }

    /// Validate a raw JSON ability value as the web validator does: unknown fields, types, directions, events and
    /// value types first (which the typed decoder would silently drop or reject), then the rules of `validate`.
    public static func validateRaw(_ json: JSONValue) -> [String] {
        if json.isNull { return [] }
        guard case .object(let o) = json else { return ["ability must be an object or null"] }
        var errors: [String] = []
        if let byStage = o["byStage"] {
            for k in o.keys.sorted() where !["byStage", "notes"].contains(k) { errors.append("unknown ability field \"\(k)\" next to byStage") }
            guard case .array(let stages) = byStage, stages.count == 5 else { return errors + ["byStage must be an array of exactly 5 entries"] }
            for (i, st) in stages.enumerated() where !st.isNull { errors += rawEntryErrors(st, where: "byStage[\(i)]") }
            if let notes = o["notes"], notes.stringValue == nil { errors.append("notes must be a string") }
        } else {
            errors += rawEntryErrors(json, where: "ability")
        }
        if errors.isEmpty, let decoded = try? json.decode(AbilityDef?.self) {
            errors += validate(decoded)
        }
        return errors
    }

    private static func rawEntryErrors(_ json: JSONValue, where: String) -> [String] {
        guard case .object(let a) = json else { return ["\(`where`): ability must be an object or null"] }
        var errors: [String] = []
        for k in a.keys.sorted() where !["text", "buffs", "notes"].contains(k) { errors.append("\(`where`): unknown ability field \"\(k)\"") }
        if case .array(let buffs)? = a["buffs"] {
            for (i, b) in buffs.enumerated() { errors += rawBuffErrors(b, where: "\(`where`).buffs[\(i)]") }
        } else {
            errors.append("\(`where`): buffs must be an array")
        }
        if a["text"]?.stringValue == nil { errors.append("\(`where`): missing text") }
        if let notes = a["notes"], notes.stringValue == nil { errors.append("\(`where`): notes must be a string") }
        return errors
    }

    private static func rawBuffErrors(_ json: JSONValue, where: String) -> [String] {
        guard case .object(let b) = json else { return ["\(`where`): buff must be an object"] }
        var errors: [String] = []
        func err(_ m: String) { errors.append("\(`where`): \(m)") }
        for k in b.keys.sorted() where !buffKeys.contains(k) { err("unknown buff field \"\(k)\"") }
        guard let type = b["type"]?.stringValue, let t = BuffType(rawValue: type), t != .none else {
            err("unknown buff type \"\(b["type"]?.stringValue ?? "undefined")\"")
            return errors
        }
        if case .array(let dirs)? = b["directions"] {
            for d in dirs where d.stringValue.flatMap({ OriginalDirection(rawValue: $0) }) == nil { err("unknown direction \"\(d.stringValue ?? d.canonical())\"") }
        } else {
            err("directions must be an array")
        }
        if b["event"]?.stringValue.flatMap({ BuffEvent(rawValue: $0) }) == nil { err("unknown event \"\(b["event"]?.stringValue ?? "undefined")\"") }
        func valueOrNumber(_ key: String) {
            guard let v = b[key] else { return }
            if v.stringValue == "value" { return }
            if case .number(let d) = v, d.isFinite { return }
            err("\(key) must be \"value\" or a number")
        }
        valueOrNumber("strength")
        valueOrNumber("strengthPercent")
        if let cap = b["cap"], cap.stringValue != "value" {
            if case .number(let d) = cap, d.isFinite, d > 0 {} else { err("cap must be \"value\" or a positive number") }
        }
        if let er = b["emptyReduction"] {
            if case .number(let d) = er, d == d.rounded(.towardZero) {} else { err("emptyReduction must be an integer on an attack buff") }
        }
        if let c = b["count"] {
            if case .number(let d) = c, d == d.rounded(.towardZero), d > 0 {} else { err("pick needs a positive integer count") }
        }
        if let s = b["scope"], s.stringValue.flatMap({ BuffScope(rawValue: $0) }) == nil { err("unknown scope \"\(s.stringValue ?? s.canonical())\"") }
        if let p = b["pick"], p.stringValue.flatMap({ PickRule(rawValue: $0) }) == nil { err("unknown pick \"\(p.stringValue ?? p.canonical())\"") }
        if let f = b["filter"] {
            guard case .object(let fo) = f, !fo.isEmpty else { err("filter must be a non-empty object"); return errors }
            for (k, v) in fo.sorted(by: { $0.key < $1.key }) {
                if !filterKeys.contains(k) {
                    err("unknown filter \"\(k)\"")
                } else if k == "tribe" ? (v.stringValue.flatMap { Tribe(rawValue: $0) } == nil) : (v != .bool(true)) {
                    err("filter.\(k) is invalid")
                }
            }
        }
        for k in ["nextRound", "damagedBySelf", "strengthFromEvent", "unreflectable", "baseAttack", "perTarget", "ext"] {
            if let v = b[k], v != .bool(true) {
                if k == "ext" { err("ext is only allowed on extension buffs") } else { err("\(k) must be true") }
            }
        }
        if let td = b["triggerDirection"], td.stringValue.flatMap({ OriginalDirection(rawValue: $0) }) == nil { err("triggerDirection must be a non-self direction on an event buff") }
        return errors
    }

    // MARK: Stages, text, types

    /// Return the entry that applies at a fusion stage (0–4); non-evolving abilities are returned unchanged (`abilityForStage`).
    public static func abilityForStage(_ ability: AbilityDef?, stage: Int = 0) -> AbilityEntry? {
        ability?.entry(stage: stage)
    }

    /// True when the ability (at the given stage) has at least one buff (`hasAbility`).
    public static func hasAbility(_ ability: AbilityDef?, stage: Int = 0) -> Bool {
        !(abilityForStage(ability, stage: stage)?.buffs.isEmpty ?? true)
    }

    /// Format a number with thousands separators ("12,345"), one decimal for non-integers; nil / non-finite → "?" (`formatValue`).
    public static func formatValue(_ n: Double?) -> String {
        guard let n, n.isFinite else { return "?" }
        let neg = n < 0
        let a = abs(n)
        let v = a == a.rounded(.towardZero) ? a : JSMath.round(a * 10) / 10
        let text = jsNumberString(v)
        let parts = text.split(separator: ".", maxSplits: 1).map(String.init)
        let intPart = parts[0]
        let frac = parts.count > 1 ? parts[1] : nil
        var grouped = ""
        for (i, ch) in intPart.enumerated() {
            let fromEnd = intPart.count - i
            if i > 0 && fromEnd % 3 == 0 { grouped.append(",") }
            grouped.append(ch)
        }
        return (neg ? "-" : "") + grouped + (frac.map { "." + $0 } ?? "")
    }

    /// `String(number)` for the values formatValue produces (integers and one-decimal numbers).
    static func jsNumberString(_ v: Double) -> String {
        if v == v.rounded(.towardZero), abs(v) < 1e21 { return String(Int64(v)) }
        return String(v)
    }

    /// Render the display text of an ability with `{v}` replaced by the formatted value and `{pct}` by the percent
    /// (`renderAbilityText`); empty when there is no ability.
    public static func renderAbilityText(_ ability: AbilityDef?, value: Double?, stage: Int = 0) -> String {
        guard let a = abilityForStage(ability, stage: stage) else { return "" }
        let v: Double? = (value?.isFinite == true) ? value : nil
        return a.text
            .replacingOccurrences(of: "{v}", with: v == nil ? "?" : formatValue(v))
            .replacingOccurrences(of: "{pct}", with: v == nil ? "?%" : "\(formatValue(v))%")
    }

    /// Every distinct buff type used by an ability entry (all stages; the implicit attack is not included) — `effectTypesOf`.
    public static func effectTypesOf(_ ability: AbilityDef?) -> [BuffType] {
        guard let ability else { return [] }
        var types: [BuffType] = []
        for entry in ability.entries {
            for b in entry?.buffs ?? [] where !types.contains(b.type) { types.append(b.type) }
        }
        return types
    }

    /// Catalog direction names → original buff directions (order kept) — `toOriginalDirs`.
    public static func toOriginalDirs(_ catalogDirs: [CatalogDirection]) -> [OriginalDirection] {
        catalogDirs.map { $0.original }
    }

    /// Original buff directions → catalog direction names in canonical order (`self` is dropped) — `toCatalogDirs`.
    public static func toCatalogDirs(_ originalDirs: [OriginalDirection]) -> [CatalogDirection] {
        let set = Set(originalDirs.compactMap { $0.catalog })
        return CatalogDirection.order.filter { set.contains($0) }
    }

    /// Catalog-named directions in which the ability acts at a stage (blue arrows): the union of the directions of
    /// every non-attack buff (`self` and scope buffs contribute nothing) — `effectDirs`.
    public static func effectDirs(_ ability: AbilityDef?, stage: Int = 0) -> [CatalogDirection] {
        guard let a = abilityForStage(ability, stage: stage) else { return [] }
        var dirs: [OriginalDirection] = []
        for b in a.buffs where b.type != .attack { dirs += b.directions }
        return toCatalogDirs(dirs)
    }

    /// Directions of the heal-like buffs at the stage (green arrows) — card-view.js `healDirsFor`.
    public static func healDirs(_ ability: AbilityDef?, stage: Int = 0) -> [CatalogDirection] {
        guard let a = abilityForStage(ability, stage: stage) else { return [] }
        var dirs: [OriginalDirection] = []
        for b in a.buffs where healBuffTypes.contains(b.type) { dirs += b.directions }
        return toCatalogDirs(dirs)
    }

    /// Directions of the other (non-heal, non-attack) buffs at the stage (blue arrows) — card-view.js `buffDirsFor`.
    public static func buffDirs(_ ability: AbilityDef?, stage: Int = 0) -> [CatalogDirection] {
        let heal = Set(healDirs(ability, stage: stage))
        return effectDirs(ability, stage: stage).filter { !heal.contains($0) }
    }

    /// Concrete buff list of a card at a stage, ready for the engine (`buffsForStage`): copies with every "value"
    /// strength / cap / strengthPercent replaced by `abilityValue` (the percent itself for percent cards), perTarget
    /// strengths multiplied by the number of directions (flag removed), and the implicit attack buff
    /// `{ type: 'attack', directions: <card dirs in original names>, event: 'always' }` prepended unless the entry
    /// has an explicit attack buff or the card has no attack direction.
    public static func buffsForStage(_ ability: AbilityDef?, stage: Int = 0, abilityValue: Double? = nil, cardDirs: [CatalogDirection] = []) -> [Buff] {
        let a = abilityForStage(ability, stage: stage)
        let value: Double = (abilityValue?.isFinite == true) ? abilityValue! : 0
        var out: [Buff] = []
        var overridesAttack = false
        for src in a?.buffs ?? [] {
            var b = src
            if b.strength == .value { b.strength = .number(value) }
            if b.cap == .value { b.cap = .number(value) }
            if b.strengthPercent == .value { b.strengthPercent = .number(value) }
            if b.perTarget == true {
                if case .number(let s)? = b.strength { b.strength = .number(s * Double(b.directions.count)) }
                b.perTarget = nil
            }
            if b.type == .attack { overridesAttack = true }
            out.append(b)
        }
        let dirs = toOriginalDirs(cardDirs)
        if !overridesAttack && !dirs.isEmpty {
            out.insert(Buff(type: .attack, directions: dirs, event: .always), at: 0)
        }
        return out
    }

    /// `buffsForStage` for an entry already resolved for its stage.
    public static func buffsForStage(entry: AbilityEntry?, abilityValue: Double? = nil, cardDirs: [CatalogDirection] = []) -> [Buff] {
        buffsForStage(entry.map { AbilityDef.single($0) }, stage: 0, abilityValue: abilityValue, cardDirs: cardDirs)
    }
}
