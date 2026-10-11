import Foundation

/// Battle-state builders (`src/engine/battle-state.js`): BattleCard / FighterSide construction and the
/// translation of card abilities into the ORIGINAL simulator's buff shape (original-engine.md §1, §3, §8).
///
/// Direction naming:
///   catalog (cards.json `dirs`)   direct | left | right | ownLeft | ownRight
///   original (buff `directions`)  front  | frontLeft | frontRight | left | right | self
public enum BattleState {
    public static let slotCount = 5
    /// Round-mode buff events (everything else is an event-mode trigger: onDamage / onDeath / onHeal).
    public static let roundEvents: [BuffEvent] = [.always, .round_eq, .round_ge, .round_le, .round_odd, .round_even]

    /// Default stat computation (`defaultComputeStats`: attack / hp / ability from stats.js, hp and attack `?? 0`).
    public static let defaultComputeStats: ComputeStats = { cardDef, stage, level, evolveQuality in
        let stats = Stats()
        let attack = stats.statAt(cardDef, .attack, stage: stage, level: level, evolveQuality: evolveQuality) ?? 0
        let hp = stats.statAt(cardDef, .hp, stage: stage, level: level, evolveQuality: evolveQuality) ?? 0
        let ability = cardDef.base.ability != nil ? stats.statAt(cardDef, .ability, stage: stage, level: level, evolveQuality: evolveQuality) : nil
        return CardStats(attack: Slots.toInt(attack), hp: Slots.toInt(hp), ability: ability)
    }

    // MARK: Directions

    /// Distinct catalog directions in order (`normaliseDirs` on an array; nil → []).
    public static func normaliseDirs(_ dirs: [CatalogDirection]?) -> [CatalogDirection] {
        var out: [CatalogDirection] = []
        for d in dirs ?? [] where !out.contains(d) { out.append(d) }
        return out
    }

    /// `normaliseDirs` on raw names: unknown names are dropped, duplicates removed, order kept.
    public static func normaliseDirs(names: [String]) -> [CatalogDirection] {
        normaliseDirs(names.compactMap { CatalogDirection(rawValue: $0.trimmingCharacters(in: .whitespaces)) })
    }

    /// `normaliseDirs` on a legacy comma / space separated string.
    public static func normaliseDirs(text: String) -> [CatalogDirection] {
        normaliseDirs(names: splitDirs(text))
    }

    /// Catalog directions → original simulator names (distinct, order kept).
    public static func toOriginalDirs(_ dirs: [CatalogDirection]) -> [OriginalDirection] {
        var out: [OriginalDirection] = []
        for d in dirs {
            let o = d.original
            if !out.contains(o) { out.append(o) }
        }
        return out
    }

    /// `toOriginalDirs` on raw names: catalog names are mapped, valid original names pass through, the rest is dropped.
    public static func toOriginalDirs(names: [String]) -> [OriginalDirection] {
        var out: [OriginalDirection] = []
        for raw in names {
            let key = raw.trimmingCharacters(in: .whitespaces)
            let o: OriginalDirection? = CatalogDirection(rawValue: key)?.original ?? OriginalDirection(rawValue: key)
            if let o, !out.contains(o) { out.append(o) }
        }
        return out
    }

    /// `toOriginalDirs` on a comma / space separated string.
    public static func toOriginalDirs(text: String) -> [OriginalDirection] {
        toOriginalDirs(names: splitDirs(text))
    }

    /// Keep only valid original direction names, distinct, order kept (`originalDirs`).
    public static func originalDirs(_ dirs: [OriginalDirection]) -> [OriginalDirection] {
        var out: [OriginalDirection] = []
        for d in dirs where !out.contains(d) { out.append(d) }
        return out
    }

    /// `originalDirs` on raw names (buff directions are never catalog names: `left` means the own left neighbour).
    public static func originalDirs(names: [String]) -> [OriginalDirection] {
        originalDirs(names.compactMap { OriginalDirection(rawValue: $0.trimmingCharacters(in: .whitespaces)) })
    }

    private static func splitDirs(_ text: String) -> [String] {
        text.split(whereSeparator: { $0 == "," || $0 == " " || $0 == "\n" || $0 == "\t" || $0 == "\r" }).map(String.init)
    }

    // MARK: Buffs

    /// Normalise one buff to the engine's internal shape (`normaliseBuff`): value placeholders resolved
    /// (`"value"` / `"-value"` → the ability value, non-finite → 0), directions distinct original names, an `attack`
    /// buff without directions takes the card's, `perTarget` strengths multiplied by the direction count when there
    /// is more than one (the flag removed). The event already defaults to `always` and round-event data to numbers
    /// in the typed model.
    public static func normaliseBuff(_ buff: Buff, abilityValue: Double = 0, cardDirs: [OriginalDirection] = []) -> Buff {
        var b = buff
        b.strength = concrete(b.strength, abilityValue)
        b.strengthPercent = concrete(b.strengthPercent, abilityValue)
        b.cap = concrete(b.cap, abilityValue)
        b.directions = originalDirs(b.directions)
        // The typed model cannot tell a missing `directions` from an empty list; the only attack buff ever stored
        // without directions is the bare `{ type: 'attack' }` of tooling, which takes the card's directions.
        if b.type == .attack && b.directions.isEmpty { b.directions = cardDirs }
        if b.perTarget == true {
            if b.directions.count > 1, case .number(let s)? = b.strength {
                b.strength = .number(s * Double(b.directions.count))
            }
            b.perTarget = nil
        }
        return b
    }

    /// `concrete(v, abilityValue)` followed by `Number(v)` with non-finite → 0.
    private static func concrete(_ v: ValueRef?, _ abilityValue: Double) -> ValueRef? {
        guard let v else { return nil }
        let d = v.resolved(abilityValue)
        return .number(d.isFinite ? d : 0)
    }

    /// Concrete buffs (original naming) of a card: `core/abilities.buffsForStage` (implicit attack, "value"
    /// strengths, perTarget), each buff normalised (`normaliseBuff`); `none` buffs are dropped (`resolveBuffs`).
    public static func resolveBuffs(_ ability: AbilityDef?, stage: Int, abilityValue: Double?, cardDirs: [CatalogDirection]) -> [Buff] {
        let dirs = normaliseDirs(cardDirs)
        let value = JSMath.num(abilityValue)
        let odirs = toOriginalDirs(dirs)
        return Abilities.buffsForStage(ability, stage: stage, abilityValue: value, cardDirs: dirs)
            .filter { $0.type != .none }
            .map { normaliseBuff($0, abilityValue: value, cardDirs: odirs) }
    }

    /// `resolveBuffs` for an entry already resolved for its stage (a BattleCard's `ability`).
    public static func resolveBuffs(entry: AbilityEntry?, stage: Int, abilityValue: Double?, cardDirs: [CatalogDirection]) -> [Buff] {
        resolveBuffs(entry.map { AbilityDef.single($0) }, stage: stage, abilityValue: abilityValue, cardDirs: cardDirs)
    }

    // MARK: Cards and sides

    /// Build a BattleCard from an owned card instance and its definition (`toBattleCard`); stats from `computeStats`
    /// (stats.js by default).
    public static func toBattleCard(_ ref: CardRef, _ cardDef: CardDef, computeStats: ComputeStats?) -> BattleCard {
        let compute = computeStats ?? defaultComputeStats
        let stage = Swift.max(0, ref.stage)
        let level = Swift.max(1, ref.level == 0 ? 1 : ref.level)
        let evolveQuality = ref.evolveQuality.isFinite ? ref.evolveQuality : 1
        let stats = compute(cardDef, stage, level, evolveQuality)
        let attack = Swift.max(0, JSMath.round(JSMath.num(Double(stats.attack))))
        let hp = Swift.max(1, JSMath.round(JSMath.num(Double(stats.hp))))
        let abilityValue = JSMath.num(stats.ability)
        let instanceId = ref.uid.isEmpty ? "\(cardDef.id)#\(stage)/\(level)" : ref.uid
        return BattleCard(instanceId: instanceId, cardId: cardDef.id, name: cardDef.name, tribe: cardDef.tribe, rarity: cardDef.rarity,
                          mana: cardDef.mana, stage: stage, level: level, attack: attack, maxHp: hp, hp: hp, abilityValue: abilityValue,
                          dirs: normaliseDirs(cardDef.dirs), ability: cardDef.ability?.entry(stage: stage), buffs: nil)
    }

    /// Build a fighter side from a player-like object and up to 5 slot entries (`buildSide`). The race bonus (×1.2,
    /// original rule) is applied to `maxHp` here and recorded in `player.tribeBonus`, so the engine does not apply it
    /// again; `options.tribeBonus == false` disables it.
    public static func buildSide(_ player: FighterPlayer, _ entries: [SideEntry?], options: SideOptions) -> FighterSide {
        let compute = options.computeStats ?? defaultComputeStats
        var cards: [BattleCard?] = []
        for i in 0..<slotCount {
            let entry: SideEntry? = i < entries.count ? entries[i] : nil
            switch entry {
            case nil:
                cards.append(nil)
            case .card(var bc)?:
                bc.dirs = normaliseDirs(bc.dirs)
                cards.append(bc)
            case .ref(let ref)?:
                guard let def = options.cardsDb?.get(ref.cardId) else {
                    preconditionFailure("toBattleCard: missing card definition for \(ref.cardId)")
                }
                cards.append(toBattleCard(ref, def, computeStats: compute))
            }
        }
        let rawMax: Double? = (player.maxHp ?? player.hpMax ?? player.hp).map { Double($0) }
        let baseMaxHp = Swift.max(1, JSMath.round(orDefault(rawMax, 1500)))
        let bonus = options.tribeBonus == false ? false : TribeBonus.hasTribeBonus(cards: cards)
        let maxHp = bonus ? JSMath.round(baseMaxHp * TribeBonus.multiplier) : baseMaxHp
        let name = (player.name?.isEmpty == false) ? player.name! : "Player"
        let built = FighterPlayer(name: name, hp: Slots.toInt(maxHp), maxHp: Slots.toInt(maxHp), portrait: player.portrait ?? player.avatar ?? 0,
                                  baseMaxHp: Slots.toInt(baseMaxHp), tribeBonus: bonus)
        return FighterSide(player: built, cards: cards)
    }

    /// `Number(x) || def`: nil, NaN and 0 take the default.
    static func orDefault(_ x: Double?, _ def: Double) -> Double {
        guard let x, x.isFinite, x != 0 else { return def }
        return x
    }
}
