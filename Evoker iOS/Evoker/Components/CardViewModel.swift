import Foundation
import EvokerCore

/// The `cardView` objects of `src/ui/card-view.js` that the card component renders: `fromDef` = defView (a catalog
/// card at a stage / level), `fromInstance` = cardView (an owned card), `fromBattleCard` = battleView (a card inside
/// a fight). Pure data built from the game's stats and abilities modules.
struct CardFaceModel: Hashable, Identifiable {
    var id: String { uid ?? "catalog:\(cardId)#\(stage)@\(level)" }
    var uid: String?
    var cardId: String
    var name: String
    var tribe: Tribe
    var rarity: Rarity
    var set: String
    var stage: Int
    var level: Int
    var levelCap: Int
    var attack: Int
    var hp: Int
    var maxHp: Int
    var abilityValue: Double?
    var abilityText: String
    var abilityIsPercent: Bool
    var mana: Int
    var dirs: [CatalogDirection]
    var healDirs: [CatalogDirection]
    var buffDirs: [CatalogDirection]
    var pips: Int
    var xp: Int
    var xpToNext: Int
    var evolveQuality: Double
    var def: CardDef

    /// `abilityTextFor`: the ability text with the value filled in ("" when the card has no ability at this stage).
    static func abilityText(_ def: CardDef, stage: Int, value: Double?) -> String {
        if !Abilities.hasAbility(def.ability, stage: stage) {
            return def.isTrainer ? Abilities.renderAbilityText(def.ability, value: nil, stage: stage) : ""
        }
        return Abilities.renderAbilityText(def.ability, value: value, stage: stage)
    }

    /// `healDirsFor`: directions of the heal buffs at the stage (green arrows).
    static func healDirs(_ def: CardDef, stage: Int) -> [CatalogDirection] {
        Abilities.healDirs(def.ability, stage: stage)
    }

    /// `buffDirsFor`: the other (non-heal, non-attack) buff directions (blue arrows).
    static func buffDirs(_ def: CardDef, stage: Int) -> [CatalogDirection] {
        let heal = Set(healDirs(def, stage: stage))
        return Abilities.effectDirs(def.ability, stage: stage).filter { !heal.contains($0) }
    }

    /// `defView(cardDef, stage, level, opts)`.
    static func fromDef(_ def: CardDef, stage: Int = 0, level: Int = 1, deps: Deps, uid: String? = nil, xp: Int = 0, evolveQuality: Double = 1) -> CardFaceModel {
        let s = max(0, min(4, stage))
        let cap = deps.stats.capFor(def, stage: s)
        let lvl = max(1, min(cap, level < 1 ? 1 : level))
        let st = deps.stats.statsAt(def, stage: s, level: lvl, evolveQuality: evolveQuality)
        return CardFaceModel(
            uid: uid, cardId: def.id, name: def.name, tribe: def.tribe, rarity: def.rarity, set: def.set,
            stage: s, level: lvl, levelCap: cap, attack: st.attack, hp: st.hp, maxHp: st.hp,
            abilityValue: st.ability, abilityText: abilityText(def, stage: s, value: st.ability),
            abilityIsPercent: def.isPercentAbility, mana: def.mana, dirs: def.dirs,
            healDirs: healDirs(def, stage: s), buffDirs: buffDirs(def, stage: s), pips: s + 1, xp: xp,
            xpToNext: deps.stats.cardXpToNext(def, level: lvl, stage: s), evolveQuality: evolveQuality, def: def)
    }

    /// `cardView(inst, cardDef)`.
    static func fromInstance(_ inst: CardInstance, def: CardDef, deps: Deps) -> CardFaceModel {
        fromDef(def, stage: inst.stage, level: inst.level, deps: deps, uid: inst.uid, xp: inst.xp, evolveQuality: inst.evolveQuality)
    }

    /// `cardView` of an owned uid (nil when the card or its definition is gone).
    static func forUid(_ uid: String, state: GameState, deps: Deps) -> CardFaceModel? {
        guard let inst = StateOps.getCard(state, uid: uid), let def = deps.db.get(inst.cardId) else { return nil }
        return fromInstance(inst, def: def, deps: deps)
    }

    /// `battleView(battleCard, cardDef)`: current hp / attack from the battle state.
    static func fromBattleCard(_ bc: BattleCard, def: CardDef, deps: Deps) -> CardFaceModel {
        let s = max(0, min(4, bc.stage ?? 0))
        let abilityValue = bc.abilityValue
        return CardFaceModel(
            uid: bc.instanceId, cardId: bc.cardId ?? def.id, name: bc.name ?? def.name, tribe: bc.tribe ?? def.tribe,
            rarity: bc.rarity ?? def.rarity, set: def.set, stage: s, level: bc.level ?? 1, levelCap: deps.stats.capFor(def, stage: s),
            attack: Int(JSMath.round(bc.attack ?? 0)), hp: Int(JSMath.round(bc.hp ?? bc.maxHp ?? 0)), maxHp: Int(JSMath.round(bc.maxHp ?? 0)),
            abilityValue: abilityValue, abilityText: abilityText(def, stage: s, value: abilityValue),
            abilityIsPercent: def.isPercentAbility, mana: def.mana, dirs: bc.dirs ?? def.dirs,
            healDirs: healDirs(def, stage: s), buffDirs: buffDirs(def, stage: s), pips: s + 1, xp: 0,
            xpToNext: 0, evolveQuality: 1, def: def)
    }

    /// A face for a card reference (boss line-ups, scaled sim decks, replay sides).
    static func fromRef(_ ref: CardRef, deps: Deps) -> CardFaceModel? {
        guard let def = deps.db.get(ref.cardId) else { return nil }
        return fromDef(def, stage: ref.stage, level: ref.level, deps: deps, uid: ref.uid, evolveQuality: ref.evolveQuality)
    }

    var nameWithPlus: String { cardNameWithPlus(name, stage: stage) }
}

/// `pvp-view.js strongestCard`: highest level, then stage, then mana.
func strongestCard(_ cards: [SimDeckCard?], db: CardsDb) -> (cardId: String, stage: Int, level: Int)? {
    let list = cards.compactMap { $0 }.filter { db.get($0.cardId) != nil }
    guard !list.isEmpty else { return nil }
    let best = list.sorted { a, b in
        if a.level != b.level { return a.level > b.level }
        if a.stage != b.stage { return a.stage > b.stage }
        return (db.get(a.cardId)?.mana ?? 0) > (db.get(b.cardId)?.mana ?? 0)
    }[0]
    return (best.cardId, best.stage, max(1, best.level))
}

/// `strongestCard` over replay cards.
func strongestReplayCard(_ cards: [ReplayCard?], db: CardsDb) -> (cardId: String, stage: Int, level: Int)? {
    strongestCard(cards.map { c in c.map { SimDeckCard(cardId: $0.cardId, stage: $0.stage, level: $0.level) } }, db: db)
}

/// `pvp-view.js avatarCardId`: the card id used as the portrait for an avatar index.
func avatarCardId(_ index: Int, names: NamesData?) -> String? {
    guard let avatars = names?.avatars, !avatars.isEmpty else { return nil }
    let n = avatars.count
    return avatars[((index % n) + n) % n]
}
