import Foundation
import XCTest
@testable import EvokerCore

/// Battle-engine test fixtures (port of `tests/fixtures/cards.js`): a hand-made subset of the card catalog (level-1
/// wiki values) with abilities encoded as ORIGINAL-simulator buffs (ability-encoding.md), a stub `computeStats`,
/// raw cards with explicit buffs, and helpers to build sides and run fights.
///
/// Buff directions are original names (front, frontLeft, frontRight, left, right, self); card `dirs` are catalog
/// names (direct, left, right, ownLeft, ownRight).
enum EngineFx {
    static let big = 1_000_000

    /// Buff builder with the web's defaults (event `always`).
    /// `directions` nil = the JSON key is absent (`{ type: 'attack' }` takes the card's directions), [] = an explicit empty list.
    static func b(_ type: BuffType, _ directions: [OriginalDirection]? = [], _ event: BuffEvent = .always, eventData: EventData? = nil,
                  strength: ValueRef? = nil, strengthPercent: ValueRef? = nil, cap: ValueRef? = nil, scope: BuffScope? = nil, filter: BuffFilter? = nil,
                  pick: PickRule? = nil, count: Int? = nil, nextRound: Bool? = nil, emptyReduction: Int? = nil, perTarget: Bool? = nil,
                  baseAttack: Bool? = nil, unreflectable: Bool? = nil, triggerDirection: OriginalDirection? = nil, damagedBySelf: Bool? = nil,
                  strengthFromEvent: Bool? = nil, ext: Bool? = nil) -> Buff {
        Buff(type: type, strength: strength, strengthPercent: strengthPercent, cap: cap, directions: directions, scope: scope, filter: filter, pick: pick,
             count: count, event: event, eventData: eventData, nextRound: nextRound, emptyReduction: emptyReduction, perTarget: perTarget,
             baseAttack: baseAttack, unreflectable: unreflectable, triggerDirection: triggerDirection, damagedBySelf: damagedBySelf,
             strengthFromEvent: strengthFromEvent, ext: ext)
    }

    static let r1: (BuffEvent, EventData?) = (.round_eq, .round(1))
    static let r2: (BuffEvent, EventData?) = (.round_eq, .round(2))
    static let onDeathSelf: (BuffEvent, EventData?) = (.onDeath, .selfTag)

    static func def(_ name: String, _ tribe: Tribe, _ rarity: Rarity, _ mana: Int, _ dirs: [CatalogDirection], attack: Double = 0, hp: Double,
                    ability: Double? = nil, buffs: [Buff]?, abilityDef: AbilityDef? = nil) -> CardDef {
        let id = Slug.slugify(name)
        let ab: AbilityDef? = abilityDef ?? buffs.map { AbilityDef.single(AbilityEntry(text: "\(name) ability", buffs: $0)) }
        return CardDef(id: id, name: name, tribe: tribe, rarity: rarity, mana: mana, dirs: dirs, base: CardBase(attack: attack, hp: hp, ability: ability),
                       caps: [], growth: CardGrowth(), ability: ab)
    }

    static let cardDefList: [CardDef] = [
        def("Scorpion Rider", .elf, .legendary, 23, [.direct], attack: 2000, hp: 1400, buffs: [b(.no_buff, [.front], r1.0, eventData: r1.1)]),
        def("Siren", .neutral, .standard, 10, [], hp: 300, buffs: [
            b(.no_buff, [.front], r1.0, eventData: r1.1),
            b(.no_damage, [.front], r1.0, eventData: r1.1),
        ]),
        def("Dwarven Sage", .dwarf, .legendary, 25, [], hp: 2400, ability: 5000, buffs: [b(.raise_player_hp, [], .always, strength: .value)]),
        def("Dwarf King", .dwarf, .legendary, 24, [.direct], attack: 800, hp: 2400, ability: 1600, buffs: [b(.raise_attack, [.left, .right], .always, strength: .value)]),
        def("Moon Dragon", .neutral, .legendary, 22, [.left, .direct, .right], attack: 900, hp: 900, buffs: [b(.resurrect_allies, [], onDeathSelf.0, eventData: onDeathSelf.1, scope: .own_cards, ext: true)]),
        def("Colossus", .neutral, .legendary, 22, [.direct], attack: 1800, hp: 1400, buffs: [b(.kill, [], r2.0, eventData: r2.1, scope: .opponent_cards, pick: .highest_attack, count: 1, ext: true)]),
        def("Dwarf Judge", .dwarf, .heroic, 19, [.direct], attack: 600, hp: 1500, buffs: [b(.kill, [], r2.0, eventData: r2.1, scope: .opponent_cards, pick: .lowest_attack, count: 1, ext: true)]),
        def("Umbral Dragon", .neutral, .ultimate, 30, [.direct], attack: 1500, hp: 1500, buffs: [b(.kill, [], r2.0, eventData: r2.1, scope: .all_cards, filter: BuffFilter(excludeSelf: true), pick: .random, count: 2, ext: true)]),
        def("Thief of Time", .neutral, .ultimate, 30, [.direct], attack: 0, hp: 4000, ability: 800, buffs: [
            b(.increment_attack, [.selfSlot], .always, strength: .value),
            b(.stun_pattern, [], .always, ext: true),
        ]),
        def("Goblin Patriarch", .orc, .legendary, 23, [.left, .right], attack: 1600, hp: 1800, buffs: [
            b(.no_damage, [.frontLeft, .frontRight], r1.0, eventData: r1.1),
            b(.bonus_attack, [.left, .right], onDeathSelf.0, eventData: onDeathSelf.1, strengthPercent: .number(200), baseAttack: true, ext: true),
        ]),
        def("Warg Rider", .orc, .heroic, 20, [.left, .right], attack: 1800, hp: 1200, buffs: [
            b(.bonus_attack, [.frontLeft, .front, .frontRight, .left, .right], onDeathSelf.0, eventData: onDeathSelf.1, strengthPercent: .number(250), baseAttack: true, ext: true),
        ]),
        def("Voodoo Witch", .orc, .ultimate, 30, [], hp: 2000, ability: 2000, buffs: [
            b(.deal_damage_to_opponent_player, [], .always, strength: .value),
            b(.heal_player, [], .always, strength: .value),
        ]),
        def("Goblin Cook", .orc, .rare, 15, [], hp: 960, ability: 2500, buffs: [
            b(.raise_player_hp, [], .always, strength: .value),
            b(.deal_damage_to_player, [], .round_eq, eventData: .round(4), strength: .value),
        ]),
        def("Wheel of Fortune", .elf, .heroic, 20, [], hp: 2000, ability: 900, buffs: [b(.wheel, [], .always, strength: .value, scope: .all_cards, filter: BuffFilter(excludeSelf: true), ext: true)]),
        def("Wizard Apprentice", .dwarf, .legendary, 25, [.left, .direct, .right], attack: 1500, hp: 1500, ability: 6, buffs: [b(.gamble, [], .always, strengthPercent: .value, scope: .own_cards, filter: BuffFilter(offensive: true), ext: true)]),
        def("Goblin Thieves", .orc, .uncommon, 10, [.direct], attack: 350, hp: 350, buffs: [b(.swap_stats_random, [], r1.0, eventData: r1.1, scope: .all_cards, pick: .random, count: 1, ext: true)]),
        def("Phoenix", .neutral, .rare, 13, [.direct], attack: 720, hp: 480, buffs: [b(.resurrect, [.selfSlot], onDeathSelf.0, eventData: onDeathSelf.1)]),
        def("Enormous Larva", .orc, .heroic, 19, [.direct], attack: 150, hp: 1200, ability: 1650, buffs: [
            b(.resurrect, [.selfSlot], onDeathSelf.0, eventData: onDeathSelf.1),
            b(.increment_attack, [.selfSlot], onDeathSelf.0, eventData: onDeathSelf.1, strengthPercent: .number(1000), baseAttack: true, ext: true),
        ]),
        def("Bone dragon", .neutral, .ultimate, 30, [.direct], attack: 100, hp: 200, ability: 3100, buffs: [
            b(.resurrect, [.selfSlot], onDeathSelf.0, eventData: onDeathSelf.1),
            b(.increment_attack, [.selfSlot], onDeathSelf.0, eventData: onDeathSelf.1, strength: .value),
        ]),
        def("Bouncer", .neutral, .legendary, 25, [.direct], attack: 0, hp: 2000, buffs: [
            b(.no_buff, [], .round_le, eventData: .round(2), scope: .each_side, filter: BuffFilter(excludeSelf: true), pick: .random, count: 1, ext: true),
            b(.no_damage, [], .round_le, eventData: .round(2), scope: .each_side, filter: BuffFilter(excludeSelf: true), pick: .random, count: 1, ext: true),
        ]),
        def("Tribe Avenger", .orc, .uncommon, 6, [.direct], attack: 200, hp: 100, ability: 100, buffs: [b(.deal_damage_to_all_opponent_cards, [], onDeathSelf.0, eventData: onDeathSelf.1, strength: .value)]),
        def("Sun Dragon", .neutral, .legendary, 22, [.left, .direct, .right], attack: 2400, hp: 800, ability: 400, buffs: [b(.deal_damage_to_all_opponent_cards, [], onDeathSelf.0, eventData: onDeathSelf.1, strength: .value)]),
        def("Djinn", .elf, .heroic, 18, [.direct], attack: 750, hp: 1500, ability: 6, buffs: [b(.heal_boost_percent, [], .always, strengthPercent: .value, scope: .own_cards, ext: true)]),
        def("Medusa", .neutral, .heroic, 19, [.direct], attack: 1350, hp: 1200, ability: 6, buffs: [b(.reduce_ability_attack_percent, [], r1.0, eventData: r1.1, strengthPercent: .value, scope: .all_cards, filter: BuffFilter(excludeSelf: true, hasAbility: true), ext: true)]),
        def("Battering Ram", .dwarf, .heroic, 18, [.direct], attack: 1500, hp: 1050, ability: 300, buffs: [b(.deal_damage_to_opponent_player, [.front], .onDeath, eventData: .opponentCards, strength: .value, damagedBySelf: true, ext: true)]),
        def("Arch Angel", .neutral, .uncommon, 9, [.direct], attack: 200, hp: 500, ability: 400, buffs: [b(.raise_hp, [.left, .right], .always, strength: .value)]),
        def("Minotaur", .elf, .rare, 15, [.direct, .ownLeft], attack: 1620, hp: 1200, buffs: nil),
        def("Rat Eater", .orc, .rare, 11, [.direct], attack: 720, hp: 480, buffs: [b(.attack, [.front], .always, emptyReduction: -200)]),
        def("Treeman", .elf, .uncommon, 8, [.direct], attack: 300, hp: 600, buffs: [b(.attack, [.front], .always, emptyReduction: 200)]),
        def("Catapult", .dwarf, .uncommon, 10, [.left, .direct, .right], attack: 600, hp: 500, buffs: [b(.attack, [.frontLeft, .front, .frontRight], .round_le, eventData: .round(3))]),
        def("Gasher", .orc, .uncommon, 10, [.direct], attack: 500, hp: 400, buffs: [b(.raise_attack, [.selfSlot], r2.0, eventData: r2.1, strengthPercent: .number(75), ext: true)]),
        def("Goblin Mob", .orc, .uncommon, 9, [.direct], attack: 300, hp: 450, buffs: [b(.raise_attack, [.selfSlot], r1.0, eventData: r1.1, strengthPercent: .number(200), baseAttack: true, ext: true)]),
        def("Sky Guardian", .elf, .uncommon, 7, [.direct], attack: 200, hp: 300, buffs: [b(.no_damage, [.frontLeft, .frontRight], .onDeath, eventData: .opponentCards, nextRound: true, triggerDirection: .front, ext: true)]),
        def("Lava Toad", .dwarf, .uncommon, 7, [], hp: 500, ability: 300, buffs: [b(.reflect_damage_to_player, [.selfSlot], .onDamage, eventData: .selfTag, cap: .value, ext: true)]),
        def("Lookalike", .neutral, .rare, 12, [], hp: 1080, buffs: [b(.reflect_damage, [.selfSlot], .onDamage, eventData: .selfTag)]),
        def("Anvil Guard", .dwarf, .rare, 12, [.direct], attack: 600, hp: 720, buffs: [b(.invulnerable, [.selfSlot], r1.0, eventData: r1.1)]),
        def("Harpy", .elf, .rare, 12, [.direct, .right], attack: 720, hp: 720, buffs: [b(.invulnerable, [.selfSlot], .round_even, ext: true)]),
        def("Dwarf Tinker", .dwarf, .uncommon, 7, [.direct], attack: 100, hp: 400, buffs: [b(.no_damage, [.front], r1.0, eventData: r1.1)]),
        def("Basilisk", .neutral, .uncommon, 9, [.direct], attack: 100, hp: 500, buffs: [b(.no_damage, [.front], .round_le, eventData: .round(2))]),
        def("War Tattooist", .orc, .rare, 12, [.direct], attack: 240, hp: 840, ability: 500, buffs: [b(.increment_attack, [.right], .always, strength: .value)]),
        def("Argonaut", .dwarf, .rare, 11, [.direct], attack: 240, hp: 600, ability: 240, buffs: [b(.heal, [.left, .right], .always, strength: .value, perTarget: true)]),
        def("Gladiator", .neutral, .rare, 12, [.direct], attack: 480, hp: 1080, buffs: [b(.raise_attack, [.selfSlot], .onHeal, eventData: .selfTag, nextRound: true, strengthFromEvent: true, ext: true)]),
        def("Bone Collector", .orc, .uncommon, 9, [.direct], attack: 300, hp: 500, buffs: [b(.raise_attack, [.selfSlot], .onDeath, eventData: .opponentCards, strength: .number(100), nextRound: true, ext: true)]),
        def("Devourer", .orc, .legendary, 21, [.direct], attack: 2000, hp: 2000, ability: 400, buffs: [b(.heal, [.selfSlot], .onDeath, eventData: .opponentCards, strength: .value)]),
        def("Blood Spitter", .orc, .uncommon, 6, [.direct], attack: 500, hp: 300, ability: 100, buffs: [b(.self_damage, [], .always, strength: .value)]),
        def("Minor Demon", .neutral, .uncommon, 8, [.direct], attack: 500, hp: 500, buffs: [b(.deal_damage_to_player, [], .always, strength: .number(100))]),
        def("Hurricane Dancer", .elf, .heroic, 20, [.left, .direct, .right], attack: 1650, hp: 900, buffs: [b(.no_damage, [.frontLeft, .front, .frontRight, .left, .right], r1.0, eventData: r1.1)]),
        def("Crystal Golem", .dwarf, .rare, 15, [.direct], attack: 720, hp: 720, ability: 720, buffs: [b(.deal_damage_to_opponent_player, [.front], .onDeath, eventData: .opponentCards, strength: .value)]),
        def("Dryad Oracle", .elf, .rare, 14, [.left, .right], attack: 720, hp: 600, ability: 600, buffs: [b(.deal_damage_to_opponent_player, [], onDeathSelf.0, eventData: onDeathSelf.1, strength: .value)]),
        def("Bone Oracle", .orc, .rare, 11, [], hp: 700, buffs: [b(.invulnerable, [.left, .right], r2.0, eventData: r2.1, filter: BuffFilter(tribe: .orc), ext: true)]),
        def("Baby Dragon", .neutral, .uncommon, 8, [.left, .direct, .right], attack: 300, hp: 100, ability: 300, buffs: [
            b(.increment_attack, [], onDeathSelf.0, eventData: onDeathSelf.1, strength: .value, scope: .own_cards, filter: BuffFilter(tribe: .neutral, offensive: true, excludeSelf: true), ext: true),
        ]),
        def("Totem Carver", .orc, .rare, 15, [.direct], attack: 300, hp: 1000, ability: 200, buffs: [
            b(.increment_attack, [], .onDeath, strength: .value, scope: .own_cards, filter: BuffFilter(tribe: .orc, offensive: true), ext: true),
        ]),
        def("Guardian of Time", .elf, .heroic, 20, [], hp: 1500, ability: 300, buffs: [b(.raise_attack, [], .always, strength: .value, scope: .own_cards, filter: BuffFilter(offensive: true), ext: true)]),
        def("Lightning Spirit", .elf, .legendary, 25, [], hp: 1400, ability: 700, buffs: [b(.deal_damage_to_all_opponent_cards, [], .always, strength: .value, unreflectable: true, ext: true)]),
        def("Astral Navigator", .elf, .legendary, 25, [], hp: 2000, ability: 2400, buffs: [
            b(.resurrect, [.selfSlot], onDeathSelf.0, eventData: onDeathSelf.1),
            b(.heal_player, [], .always, strength: .value),
        ]),
        def("Schemer", .orc, .rare, 14, [.direct], attack: 360, hp: 960, buffs: [b(.bonus_attack, [.front], onDeathSelf.0, eventData: onDeathSelf.1, strengthPercent: .number(200), baseAttack: true, ext: true)]),
        def("Pikeman", .dwarf, .common, 3, [.direct], attack: 100, hp: 200, buffs: nil),
        def("Archer", .elf, .standard, 5, [.left, .direct, .right], attack: 300, hp: 200, buffs: nil),
        def("Stone Wall", .neutral, .rare, 10, [], hp: 100, buffs: [b(.invulnerable, [.selfSlot], .always)]),
        // evolving ability: stage 0 nothing, stage 1 indestructible in round 2
        def("Bog Yeti", .neutral, .rare, 14, [.direct], attack: 600, hp: 900, buffs: nil, abilityDef: .byStage([
            AbilityEntry(text: "Has no special abilities, as far as you can tell.", buffs: []),
            AbilityEntry(text: "Receives no damage in round 2.", buffs: [b(.invulnerable, [.selfSlot], r2.0, eventData: r2.1)]),
            AbilityEntry(text: "Receives no damage in round 3.", buffs: [b(.invulnerable, [.selfSlot], .round_eq, eventData: .round(3))]),
            AbilityEntry(text: "Receives no damage in rounds 2 and 3.", buffs: [b(.invulnerable, [.selfSlot], r2.0, eventData: r2.1), b(.invulnerable, [.selfSlot], .round_eq, eventData: .round(3))]),
            AbilityEntry(text: "Receives no damage from round 2 on.", buffs: [b(.invulnerable, [.selfSlot], .round_ge, eventData: .round(2))]),
        ], notes: nil)),
    ]

    /// `CARD_DEFS` by id.
    static let cardDefs: [String: CardDef] = Dictionary(uniqueKeysWithValues: cardDefList.map { ($0.id, $0) })

    /// cardsDb lookup compatible with buildSide.
    static let cardsDb: CardsDb = try! CardsDb(cards: cardDefList)

    /// Stub for stats.js: level-1 values at stage 0; +10 % per level, x1.15 per stage, x evolveQuality.
    static let computeStats: ComputeStats = { cardDef, stage, level, evolveQuality in
        let f = (1 + 0.1 * Double(level - 1)) * JSMath.pow(1.15, Double(stage)) * evolveQuality
        let b = cardDef.base
        return CardStats(attack: JSMath.roundInt(b.attack * f), hp: JSMath.roundInt(b.hp * f), ability: b.ability.map { JSMath.round($0 * f * 10) / 10 })
    }

    private static var uidCounter = 0
    private static func nextUid(_ prefix: String) -> String {
        uidCounter += 1
        return "\(prefix)\(uidCounter)"
    }

    /// A BattleCard for a fixture card (`card(idOrName, opts)`).
    static func card(_ idOrName: String, stage: Int = 0, level: Int = 1, evolveQuality: Double = 1, uid: String? = nil) -> BattleCard {
        let id = cardDefs[idOrName] != nil ? idOrName : Slug.slugify(idOrName)
        guard let cardDef = cardDefs[id] else { fatalError("fixture card not found: \(idOrName)") }
        let ref = CardRef(uid: uid ?? nextUid("u"), cardId: id, stage: stage, level: level, evolveQuality: evolveQuality)
        return BattleState.toBattleCard(ref, cardDef, computeStats: computeStats)
    }

    /// A plain card with no ability (its normal attack comes from the catalog dirs) — `vanilla`.
    static func vanilla(_ name: String, _ attack: Int, _ hp: Int, _ dirs: [CatalogDirection] = [.direct], _ tribe: String = "neutral") -> BattleCard {
        BattleCard(instanceId: nextUid("v"), cardId: Slug.slugify(name), name: name, tribe: Tribe(lenient: tribe), rarity: .common, mana: 1, stage: 0, level: 1,
                   attack: Double(attack), maxHp: Double(hp), hp: Double(hp), abilityValue: 0, dirs: dirs, ability: nil, buffs: nil)
    }

    /// A card with explicit ORIGINAL buffs (plus the implicit attack buff for the catalog `dirs` unless the buffs
    /// already contain an `attack`) — `raw`.
    static func raw(_ name: String, _ attack: Int, _ hp: Int, _ dirs: [CatalogDirection] = [], _ buffs: [Buff] = [], tribe: String = "neutral",
                    abilityValue: Double = 0) -> BattleCard {
        var list: [Buff] = []
        let odirs = BattleState.toOriginalDirs(dirs)
        if !odirs.isEmpty && !buffs.contains(where: { $0.type == .attack }) { list.append(b(.attack, odirs, .always)) }
        return BattleCard(instanceId: nextUid("r"), cardId: Slug.slugify(name), name: name, tribe: Tribe(lenient: tribe), rarity: .common, mana: 1, stage: 0, level: 1,
                          attack: Double(attack), maxHp: Double(hp), hp: Double(hp), abilityValue: abilityValue, dirs: BattleState.normaliseDirs(dirs), ability: nil,
                          buffs: list + buffs)
    }

    /// A 0-attack, high-hp card that keeps a slot occupied without affecting the fight — `wall`.
    static func wall(_ hp: Int = big, _ tribe: String = "neutral") -> BattleCard {
        vanilla("Wall", 0, hp, [], tribe)
    }

    /// A card that attacks straight ahead and never dies — `hitter`.
    static func hitter(_ attack: Int, _ dirs: [CatalogDirection] = [.direct]) -> BattleCard {
        raw("Hitter", attack, big, dirs)
    }

    /// Build a side; the tribe bonus is off by default so player hp numbers in tests stay simple — `side`.
    static func side(_ cards: [BattleCard?], hp: Int? = nil, name: String = "P", tribeBonus: Bool = false) -> FighterSide {
        BattleState.buildSide(FighterPlayer(name: name, maxHp: hp ?? 1500), cards.map { $0.map { SideEntry.card($0) } },
                              options: SideOptions(tribeBonus: tribeBonus == true))
    }

    /// Run a fight — `fight(attackerCards, defenderCards, opts)`.
    static func fight(_ attackerCards: [BattleCard?], _ defenderCards: [BattleCard?], seed: UInt32 = 1, aHp: Int? = nil, dHp: Int? = nil,
                      maxRounds: Int? = nil, tribeBonus: Bool = false) -> Fight {
        var options = BattleOptions()
        options.maxRounds = maxRounds
        let cfg = BattleConfig(attacker: side(attackerCards, hp: aHp, name: "A", tribeBonus: tribeBonus),
                               defender: side(defenderCards, hp: dHp, name: "D", tribeBonus: tribeBonus), seed: seed, options: options)
        let out = BattleEngine().simulateBattle(cfg)
        return Fight(cfg: cfg, events: out.events, result: out.result)
    }
}

/// A fight's outcome with the query helpers of the web fixture (`eventHelpers`).
struct Fight {
    let cfg: BattleConfig
    let events: [BattleEvent]
    let result: BattleResult

    func inRound(_ round: Int) -> [BattleEvent] {
        guard let start = events.firstIndex(where: { if case .roundStart(let r, _, _) = $0 { return r == round } else { return false } }) else { return [] }
        let endIndex = events.indices.first { $0 > start && events[$0].type == "roundEnd" }
        return Array(events[start...(endIndex ?? events.count - 1)])
    }

    func of(_ type: String, _ round: Int? = nil) -> [BattleEvent] {
        (round.map(inRound) ?? events).filter { $0.type == type }
    }

    func attacks(_ round: Int? = nil) -> [BattleEvent] { of("attack", round) }
    func damages(_ round: Int? = nil) -> [BattleEvent] { of("damage", round) }
    func heals(_ round: Int? = nil) -> [BattleEvent] { of("heal", round) }
    func deaths(_ round: Int? = nil) -> [BattleEvent] { of("death", round) }
    func statuses(_ round: Int? = nil) -> [BattleEvent] { of("status", round) }
    func buffs(_ round: Int? = nil) -> [BattleEvent] { of("buff", round) }
    func revives(_ round: Int? = nil) -> [BattleEvent] { of("revive", round) }
    func roundEnd(_ round: Int) -> BattleEvent { of("roundEnd", round)[0] }
    func playerDamage(_ side: Side, _ round: Int? = nil) -> [BattleEvent] {
        of("damage", round).filter { $0.side == side && $0.slot == nil }
    }
    func cardHp(_ side: Side, _ slot: Int, _ round: Int) -> Int {
        guard case .roundEnd(_, _, _, let cards) = roundEnd(round) else { return -1 }
        return side == .attacker ? cards.attacker[slot] : cards.defender[slot]
    }

    /// `attackOf(f, round, side, slot)`.
    func attack(_ round: Int, _ side: Side, _ slot: Int) -> BattleEvent? {
        attacks(round).first { $0.side == side && $0.slot == slot }
    }

    /// `dmgOf(f, round, side, slot)`.
    func dmg(_ round: Int, _ side: Side, _ slot: Int) -> [BattleEvent] {
        damages(round).filter { $0.side == side && $0.slot == slot }
    }
}

/// Field accessors for test assertions (the web's events are plain objects).
extension BattleEvent {
    var round: Int? {
        switch self {
        case .roundStart(let r, _, _), .roundEnd(let r, _, _, _): return r
        default: return nil
        }
    }
    var amount: Int? {
        switch self {
        case .damage(_, _, let a, _, _, _, _), .heal(_, _, let a, _, _): return a
        default: return nil
        }
    }
    var hp: Int? {
        switch self {
        case .damage(_, _, _, let h, _, _, _), .heal(_, _, _, let h, _), .revive(_, _, let h, _, _), .swap(_, _, _, let h, _, _): return h
        default: return nil
        }
    }
    var cause: DamageCause? {
        if case .damage(_, _, _, _, let c, _, _) = self { return c }
        return nil
    }
    var blocked: Bool? {
        if case .damage(_, _, _, _, _, let b, _) = self { return b }
        return nil
    }
    var status: CardStatus? {
        if case .status(_, _, let s, _, _) = self { return s }
        return nil
    }
    var on: Bool? {
        if case .status(_, _, _, let o, _) = self { return o }
        return nil
    }
    var stat: BuffStat? {
        if case .buff(_, _, let s, _, _, _) = self { return s }
        return nil
    }
    var delta: Int? {
        if case .buff(_, _, _, let d, _, _) = self { return d }
        return nil
    }
    var permanent: Bool? {
        if case .buff(_, _, _, _, let p, _) = self { return p }
        return nil
    }
    /// The `attack` value of an attack, revive or swap event.
    var attack: Int? {
        switch self {
        case .attack(_, _, let a, _, _), .revive(_, _, _, let a, _), .swap(_, _, let a, _, _, _): return a
        default: return nil
        }
    }
    var bonus: Bool? {
        if case .attack(_, _, _, let b, _) = self { return b }
        return nil
    }
    var targets: [AttackTarget] {
        if case .attack(_, _, _, _, let t) = self { return t }
        return []
    }
    var card: CardSnapshot? {
        if case .death(_, _, let c) = self { return c }
        return nil
    }
    var failed: Bool? {
        if case .gamble(_, _, let f, _) = self { return f }
        return nil
    }
    var attackerHp: Int? {
        switch self {
        case .roundStart(_, let a, _), .roundEnd(_, let a, _, _), .battleEnd(_, _, let a, _, _): return a
        default: return nil
        }
    }
    var defenderHp: Int? {
        switch self {
        case .roundStart(_, _, let d), .roundEnd(_, _, let d, _), .battleEnd(_, _, _, let d, _): return d
        default: return nil
        }
    }
    var winner: Winner? {
        if case .battleEnd(let w, _, _, _, _) = self { return w }
        return nil
    }
    var rounds: Int? {
        if case .battleEnd(_, let r, _, _, _) = self { return r }
        return nil
    }
    var endedBy: EndedBy? {
        if case .battleEnd(_, _, _, _, let e) = self { return e }
        return nil
    }
    var maxHp: Int? {
        if case .swap(_, _, _, _, let m, _) = self { return m }
        return nil
    }
    var seed: UInt32? {
        if case .battleStart(let s, _, _) = self { return s }
        return nil
    }
    var attackerSnapshot: SideSnapshot? {
        if case .battleStart(_, let a, _) = self { return a }
        return nil
    }
    var defenderSnapshot: SideSnapshot? {
        if case .battleStart(_, _, let d) = self { return d }
        return nil
    }
    func snapshot(_ side: Side) -> SideSnapshot? {
        side == .attacker ? attackerSnapshot : defenderSnapshot
    }
}

extension AttackTarget {
    /// "dir side slot damage" for compact comparisons.
    var desc: String { "\(dir ?? "-") \(side.rawValue) \(slot.map(String.init) ?? "player") \(damage)\(blocked ? " blocked" : "")" }
}

/// "side[slot]" / "side player" tags.
func tag(_ side: Side, _ slot: Int?) -> String {
    slot.map { "\(side.rawValue)\($0)" } ?? "\(side.rawValue)player"
}

extension BattleEvent {
    /// "attacker0", "defenderplayer", ... of the event's subject.
    var who: String { tag(side ?? .attacker, slot) }
}
