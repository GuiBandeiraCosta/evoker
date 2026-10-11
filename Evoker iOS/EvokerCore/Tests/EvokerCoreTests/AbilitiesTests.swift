import Foundation
import XCTest
@testable import EvokerCore

/// Port of `tests/abilities.test.js` on the shipped `data/abilities.json` + `data/cards.json` (the wiki catalog the
/// web test reads from `exploration/` is not shipped: the presence rule uses cards.json's `sourceText` / `categories`).
final class AbilitiesTests: XCTestCase {
    static let abilities: [String: AbilityDef?] = try! DataLoader.loadAbilities()
    static let raw: JSONValue = try! DataLoader.loadAbilitiesJSON()
    let db = RealData.db
    let trainers = ["lich-king", "crystal-ghost", "blood-dragon"]
    /// Effect types the engine keeps although their only cards were removed with the Dungeon Casino.
    let unusedTypes: [BuffType] = [.swap_stats_random, .wheel, .gamble]

    var abilities: [String: AbilityDef?] { AbilitiesTests.abilities }
    func ability(_ id: String) -> AbilityDef? { abilities[id] ?? nil }
    func buffs(_ id: String) -> [Buff] { Abilities.abilityForStage(ability(id), stage: 0)?.buffs ?? [] }
    func b(_ type: BuffType, _ directions: [OriginalDirection], _ event: BuffEvent, eventData: EventData? = nil, strength: ValueRef? = nil,
           strengthPercent: ValueRef? = nil, cap: ValueRef? = nil, scope: BuffScope? = nil, filter: BuffFilter? = nil, pick: PickRule? = nil, count: Int? = nil,
           nextRound: Bool? = nil, emptyReduction: Int? = nil, perTarget: Bool? = nil, baseAttack: Bool? = nil, unreflectable: Bool? = nil,
           triggerDirection: OriginalDirection? = nil, damagedBySelf: Bool? = nil, strengthFromEvent: Bool? = nil, ext: Bool? = nil) -> Buff {
        EngineFx.b(type, directions, event, eventData: eventData, strength: strength, strengthPercent: strengthPercent, cap: cap, scope: scope, filter: filter,
             pick: pick, count: count, nextRound: nextRound, emptyReduction: emptyReduction, perTarget: perTarget, baseAttack: baseAttack,
             unreflectable: unreflectable, triggerDirection: triggerDirection, damagedBySelf: damagedBySelf, strengthFromEvent: strengthFromEvent, ext: ext)
    }
    func json(_ text: String) -> JSONValue { try! JSONValue.parse(text) }
    func rawErrors(_ text: String) -> [String] { Abilities.validateRaw(json(text)) }
    func hasError(_ text: String, _ pattern: String) -> Bool { rawErrors(text).contains { $0.range(of: pattern, options: .regularExpression) != nil } }

    func testAbilitiesJsonHasExactlyTheCatalogIds() {
        let ids = Set(abilities.keys)
        XCTAssertEqual(ids.count, db.size)
        XCTAssertEqual(ids, Set(db.all().map { $0.id }))
        XCTAssertTrue(ids.contains("will-o-the-wisp"))
        XCTAssertTrue(ids.contains("guruk-the-destroyer"))
        XCTAssertTrue(ids.contains("bone-dragon"))
        // the abilities embedded in cards.json are the same data
        for card in db.all() { XCTAssertEqual(card.ability, ability(card.id), card.id) }
    }

    func testEveryEntryValidatesWithZeroErrors() {
        guard case .object(let entries) = AbilitiesTests.raw else { return XCTFail("abilities.json is an object") }
        var all: [String] = []
        for (id, entry) in entries.sorted(by: { $0.key < $1.key }) {
            for e in Abilities.validateRaw(entry) { all.append("\(id): \(e)") }
            for e in Abilities.validate(ability(id)) { all.append("\(id) (typed): \(e)") }
        }
        XCTAssertEqual(all, [])
    }

    func testEveryCardWithAbilityTextOrCategoriesHasBuffs() {
        for card in db.all() {
            let id = card.id
            let text = card.sourceText.replacingOccurrences(of: "\"", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
            let hasText = !text.isEmpty && text != "null"
            let hasCat = card.categories.contains { !["Legendary", "Ultimate", "Own Attacker", "Trainer"].contains($0) }
            let a = ability(id)
            if trainers.contains(id) {
                XCTAssertEqual(buffs(id), [], id)
                XCTAssertGreaterThan(Abilities.abilityForStage(a, stage: 0)?.text.count ?? 0, 10, id)
                XCTAssertFalse(Abilities.hasAbility(a), id)
            } else if hasText || hasCat {
                XCTAssertNotNil(a, "\(id) should have an ability")
                XCTAssertTrue(a?.entries.contains { ($0?.buffs.count ?? 0) > 0 } ?? false, "\(id) has no buffs")
            } else {
                XCTAssertNil(a, "\(id) should be null")
            }
        }
    }

    func testDeclaredTypesDirectionsEventsAndMapsAreConsistent() {
        for (t, meta) in Abilities.buffTypes {
            XCTAssertFalse(meta.phase.isEmpty, t.rawValue)
            XCTAssertGreaterThan(meta.description.count, 10, t.rawValue)
        }
        XCTAssertEqual(Abilities.buffTypes.map { $0.type }.count, 27)
        XCTAssertEqual(Abilities.directions, [.front, .frontLeft, .frontRight, .left, .right, .selfSlot])
        XCTAssertEqual(Abilities.events.map { $0.event }, [.always, .round_eq, .round_ge, .round_le, .round_odd, .round_even, .onDamage, .onDeath, .onHeal])
        XCTAssertEqual(Abilities.dirMap, [.direct: .front, .left: .frontLeft, .right: .frontRight, .ownLeft: .left, .ownRight: .right])
        for (k, v) in Abilities.dirMap { XCTAssertEqual(Abilities.dirMapBack[v], k) }
        XCTAssertEqual(Set(Abilities.dirMap.keys), Set(CatalogDirection.order))
        XCTAssertTrue(Abilities.scopes.contains { $0.scope == .own_cards } && Abilities.picks.contains(.random) && Abilities.extFields.contains("nextRound"))
        // Every declared type is used by at least one card (die is implicit).
        var used = Set<BuffType>()
        for a in abilities.values { for t in Abilities.effectTypesOf(a) { used.insert(t) } }
        for t in used { XCTAssertNotNil(Abilities.info(t), "undeclared type \(t)") }
        for (t, _) in Abilities.buffTypes where t != .die && !unusedTypes.contains(t) { XCTAssertTrue(used.contains(t), "declared type \(t) is not used by any card") }
        XCTAssertFalse(used.contains(.die))
    }

    func testExtFlagMarksExactlyTheExtensionBuffs() {
        var ext = 0
        var total = 0
        for (id, a) in abilities {
            guard let a else { continue }
            for st in a.entries {
                guard let st else { continue }
                for buff in st.buffs {
                    total += 1
                    XCTAssertEqual(buff.ext == true, Abilities.isExtensionBuff(buff), "\(id): \(buff.type)")
                    if buff.ext == true { ext += 1 }
                }
            }
        }
        XCTAssertTrue(total > 150 && ext > 30 && ext < total, "\(ext)/\(total)")
    }

    func testValidateAbilityRejectsBadShapes() {
        let ok = #"{"text":"Heals {v}.","buffs":[{"type":"heal","directions":["self"],"event":"always","strength":"value"}]}"#
        XCTAssertEqual(rawErrors(ok), [])
        XCTAssertEqual(Abilities.validate(try? json(ok).decode(AbilityDef.self)), [])
        XCTAssertEqual(Abilities.validateRaw(.null), [])
        XCTAssertEqual(Abilities.validate(nil), [])
        XCTAssertTrue(hasError(#"{"text":"x","buffs":[{"type":"explode","directions":["self"],"event":"always"}]}"#, "unknown buff type"))
        XCTAssertTrue(hasError(#"{"text":"x","buffs":[{"type":"heal","directions":["moon"],"event":"always","strength":1}]}"#, "unknown direction"))
        XCTAssertTrue(hasError(#"{"text":"x","buffs":[{"type":"heal","directions":["self"],"event":"sometimes","strength":1}]}"#, "unknown event"))
        XCTAssertTrue(hasError(#"{"text":"x","buffs":[{"type":"no_damage","directions":["front"],"event":"round_eq"}]}"#, "eventData"))
        XCTAssertTrue(hasError(#"{"text":"x","buffs":[{"type":"no_damage","directions":["front"],"event":"always","eventData":1}]}"#, "no eventData"))
        XCTAssertTrue(hasError(#"{"text":"x","buffs":[{"type":"heal","directions":["self"],"event":"always"}]}"#, "needs a strength"))
        XCTAssertTrue(hasError(#"{"text":"x","buffs":[{"type":"heal","directions":["self"],"event":"always","strength":"banana"}]}"#, "strength must be"))
        XCTAssertTrue(hasError(#"{"text":"x","buffs":[{"type":"invulnerable","directions":["self"],"event":"round_even"}]}"#, "ext: true"))
        XCTAssertTrue(hasError(#"{"text":"x","buffs":[{"type":"invulnerable","directions":["self"],"event":"always","ext":true}]}"#, "ext is only allowed"))
        XCTAssertTrue(hasError(#"{"text":"x","buffs":[{"type":"raise_attack","directions":["self"],"event":"always","strengthPercent":75}]}"#, "ext: true"))
        XCTAssertTrue(hasError(#"{"text":"Heals {v}.","buffs":[{"type":"heal","directions":["self"],"event":"always","strength":5}]}"#, "\\{v\\}"))
        XCTAssertTrue(hasError(#"{"text":"Heals {pct}.","buffs":[{"type":"heal","directions":["self"],"event":"always","strength":"value"}]}"#, "\\{pct\\}"))
        XCTAssertTrue(hasError(#"{"text":"Heals {x}.","buffs":[{"type":"heal","directions":["self"],"event":"always","strength":"value"}]}"#, "unknown placeholder"))
        XCTAssertTrue(hasError(#"{"text":"Heals ____.","buffs":[{"type":"heal","directions":["self"],"event":"always","strength":"value"}]}"#, "blank"))
        XCTAssertTrue(hasError(#"{"buffs":[]}"#, "missing text"))
        XCTAssertTrue(hasError(#"{"text":"x"}"#, "buffs must be an array"))
        XCTAssertTrue(hasError(#"{"text":"x","buffs":[{"type":"heal","directions":["self"],"event":"always","strength":1,"bogus":1}]}"#, "unknown buff field"))
        XCTAssertTrue(hasError(#"{"text":"x","buffs":[{"type":"heal","directions":[],"event":"always","strength":1,"perTarget":true}]}"#, "perTarget"))
        XCTAssertTrue(hasError(#"{"text":"x","buffs":[{"type":"heal_player","directions":["self"],"event":"always","strength":1}]}"#, "takes no directions"))
        XCTAssertTrue(hasError(#"{"text":"x","buffs":[{"type":"kill","directions":[],"event":"round_eq","eventData":2,"ext":true}]}"#, "kill needs"))
        XCTAssertTrue(hasError(#"{"text":"x","buffs":[{"type":"heal","directions":[],"event":"always","strength":1,"scope":"moon","ext":true}]}"#, "unknown scope"))
        XCTAssertTrue(hasError(#"{"text":"x","buffs":[{"type":"heal","directions":[],"event":"always","strength":1,"scope":"own_cards","filter":{"tribe":"goblin"},"ext":true}]}"#, "filter\\.tribe"))
        XCTAssertTrue(hasError(#"{"text":"x","buffs":[{"type":"attack","directions":["front"],"event":"always","emptyReduction":1.5}]}"#, "emptyReduction"))
        XCTAssertTrue(hasError(#"{"text":"x","buffs":[{"type":"heal","directions":["self"],"event":"always","strength":1,"cap":5,"ext":true}]}"#, "cap is only"))
        XCTAssertTrue(hasError(#"{"text":"x","buffs":[{"type":"die","directions":["self"],"event":"always"}]}"#, "implicit"))
        XCTAssertTrue(hasError(#"{"byStage":[null,null]}"#, "exactly 5"))
        XCTAssertTrue(hasError(#"{"byStage":[null,null,null,null,{"text":"x","buffs":[]}]}"#, "at least one stage"))
        XCTAssertTrue(hasError(#"{"text":"x","buffs":[],"extra":1}"#, "unknown ability field"))
    }

    func testExactEncodingsOfRepresentativeCards() {
        XCTAssertEqual(buffs("dwarf-king"), [b(.raise_attack, [.left, .right], .always, strength: .value)])
        XCTAssertEqual(buffs("keeper"), [b(.heal, [.left, .right], .always, strength: .value, perTarget: true)])
        XCTAssertEqual(buffs("arch-angel"), [b(.raise_hp, [.left, .right], .always, strength: .value, perTarget: true)])
        XCTAssertEqual(buffs("armorer"), [b(.raise_attack, [.right], .always, strength: .value)])
        XCTAssertEqual(buffs("siren"), [b(.no_buff, [.front], .round_eq, eventData: .round(1)), b(.no_damage, [.front], .round_eq, eventData: .round(1))])
        XCTAssertEqual(buffs("basilisk"), [b(.no_damage, [.front], .round_le, eventData: .round(2))])
        XCTAssertEqual(buffs("cursed-stag"), buffs("basilisk"))
        XCTAssertEqual(buffs("tundugar-ironeye"), [b(.no_buff, [.front], .round_eq, eventData: .round(1))])
        XCTAssertEqual(buffs("anvil-guard"), [b(.invulnerable, [.selfSlot], .round_eq, eventData: .round(1))])
        XCTAssertEqual(buffs("phoenix"), [b(.resurrect, [.selfSlot], .onDeath, eventData: .selfTag)])
        XCTAssertEqual(buffs("tribe-avenger"), [b(.deal_damage_to_all_opponent_cards, [], .onDeath, eventData: .selfTag, strength: .value)])
        XCTAssertEqual(buffs("sun-dragon"), buffs("tribe-avenger"))
        XCTAssertEqual(buffs("crystal-golem"), [b(.deal_damage_to_opponent_player, [.front], .onDeath, eventData: .opponentCards, strength: .value)])
        XCTAssertEqual(buffs("mammoth-citadel"), buffs("crystal-golem"))
        XCTAssertEqual(buffs("battering-ram"), [b(.deal_damage_to_opponent_player, [.front], .onDeath, eventData: .opponentCards, strength: .value, damagedBySelf: true, ext: true)])
        XCTAssertEqual(buffs("dryad-oracle"), [b(.deal_damage_to_opponent_player, [], .onDeath, eventData: .selfTag, strength: .value)])
        XCTAssertEqual(buffs("catapult"), [b(.attack, [.frontLeft, .front, .frontRight], .round_le, eventData: .round(3))])
        XCTAssertEqual(buffs("rat-eater"), [b(.attack, [.front], .always, emptyReduction: -200)])
        XCTAssertEqual(buffs("succubus"), buffs("rat-eater"))
        XCTAssertEqual(buffs("treeman"), [b(.attack, [.front], .always, emptyReduction: 200)])
        XCTAssertEqual(buffs("carnivorous-toadstool"), [b(.attack, [.frontLeft, .front], .always, unreflectable: true, ext: true)])
        XCTAssertEqual(buffs("lookalike"), [b(.reflect_damage, [.selfSlot], .onDamage, eventData: .selfTag)])
        XCTAssertEqual(buffs("will-o-the-wisp"), buffs("lookalike"))
        XCTAssertEqual(buffs("lava-toad"), [b(.reflect_damage_to_player, [.selfSlot], .onDamage, eventData: .selfTag, cap: .value, ext: true)])
        XCTAssertEqual(buffs("loremaster"), buffs("lava-toad"))
        XCTAssertEqual(buffs("star-seer"), buffs("lava-toad"))
        XCTAssertEqual(buffs("scrapmaster"), [b(.increment_attack, [.selfSlot], .always, strength: .value)])
        XCTAssertEqual(buffs("war-tattooist"), [b(.increment_attack, [.right], .always, strength: .value)])
        XCTAssertEqual(buffs("voodoo-witch"), [b(.deal_damage_to_opponent_player, [], .always, strength: .value), b(.heal_player, [], .always, strength: .value)])
        XCTAssertEqual(buffs("incubus"), [b(.deal_damage_to_opponent_player, [], .always, strength: .value), b(.deal_damage_to_player, [], .always, strength: .value)])
        XCTAssertEqual(buffs("minor-demon"), [b(.deal_damage_to_player, [], .always, strength: .number(100))])
        XCTAssertEqual(buffs("arch-demon").first?.strength, .number(240))
        XCTAssertEqual(buffs("blood-spitter"), [b(.self_damage, [], .always, strength: .value)])
        XCTAssertEqual(buffs("dwarven-sage"), [b(.raise_player_hp, [], .always, strength: .value)])
        XCTAssertEqual(buffs("tree-of-life"), buffs("dwarven-sage"))
        XCTAssertEqual(buffs("rune-smith"), [b(.heal_player, [], .always, strength: .value)])
        XCTAssertEqual(buffs("harpy"), [b(.invulnerable, [.selfSlot], .round_even, ext: true)])
        XCTAssertEqual(buffs("werewolf-dwarf"), buffs("harpy"))
        XCTAssertEqual(buffs("thief-of-time"), [b(.increment_attack, [.selfSlot], .always, strength: .value), b(.stun_pattern, [], .always, ext: true)])
        XCTAssertEqual(buffs("colossus"), [b(.kill, [], .round_eq, eventData: .round(2), scope: .opponent_cards, pick: .highest_attack, count: 1, ext: true)])
        XCTAssertEqual(buffs("dwarf-judge").first?.pick, .lowest_attack)
        XCTAssertEqual(buffs("moon-dragon"), [b(.resurrect_allies, [], .onDeath, eventData: .selfTag, scope: .own_cards, ext: true)])
        XCTAssertEqual(buffs("arrow-master"), [b(.raise_attack, [.selfSlot], .round_eq, eventData: .round(1), strengthPercent: .number(75), ext: true)])
        XCTAssertEqual(buffs("gasher").first?.eventData, .round(2))
        XCTAssertEqual(buffs("goblin-mob"), [b(.raise_attack, [.selfSlot], .round_eq, eventData: .round(1), strengthPercent: .number(200), baseAttack: true, ext: true)])
        XCTAssertEqual(buffs("battle-boar"), [b(.raise_attack, [.selfSlot], .round_eq, eventData: .round(1), strength: .value)])
        XCTAssertEqual(buffs("blood-fairy"), [b(.raise_attack, [.left, .right], .round_eq, eventData: .round(1), strength: .value)])
        XCTAssertEqual(buffs("bone-collector"), [b(.raise_attack, [.selfSlot], .onDeath, eventData: .opponentCards, strength: .number(100), nextRound: true, ext: true)])
        XCTAssertEqual(buffs("guruk-the-destroyer").first?.strength, .number(120))
        XCTAssertEqual(buffs("slaver"), [b(.no_damage, [.frontLeft, .frontRight], .onDeath, eventData: .opponentCards, nextRound: true, triggerDirection: .front, ext: true)])
        XCTAssertEqual(buffs("sky-guardian"), buffs("slaver"))
        XCTAssertEqual(buffs("goblin-patriarch"), [
            b(.no_damage, [.frontLeft, .frontRight], .round_eq, eventData: .round(1)),
            b(.bonus_attack, [.left, .right], .onDeath, eventData: .selfTag, strengthPercent: .number(200), baseAttack: true, ext: true),
        ])
        XCTAssertEqual(buffs("warg-rider"), [b(.bonus_attack, [.frontLeft, .front, .frontRight, .left, .right], .onDeath, eventData: .selfTag, strengthPercent: .number(250), baseAttack: true, ext: true)])
        XCTAssertEqual(buffs("schemer"), [b(.bonus_attack, [.front], .onDeath, eventData: .selfTag, strengthPercent: .number(200), baseAttack: true, ext: true)])
        XCTAssertEqual(buffs("flameling").first?.strengthPercent, .number(100))
        XCTAssertEqual(buffs("hurricane-dancer"), [b(.no_damage, [.frontLeft, .front, .frontRight, .left, .right], .round_eq, eventData: .round(1))])
        XCTAssertEqual(buffs("medusa"), [b(.reduce_ability_attack_percent, [], .round_eq, eventData: .round(1), strengthPercent: .value, scope: .all_cards, filter: BuffFilter(excludeSelf: true, hasAbility: true), ext: true)])
        XCTAssertEqual(buffs("dark-mage"), buffs("medusa"))
        XCTAssertEqual(buffs("djinn"), [b(.heal_boost_percent, [], .always, strengthPercent: .value, scope: .own_cards, ext: true)])
        XCTAssertEqual(buffs("guardian-of-time"), [b(.raise_attack, [], .always, strength: .value, scope: .own_cards, filter: BuffFilter(offensive: true), ext: true)])
        XCTAssertEqual(buffs("bloodsoaked-totem"), [b(.increment_attack, [], .always, strength: .value, scope: .own_cards, filter: BuffFilter(offensive: true), ext: true)])
        XCTAssertEqual(buffs("mendicant"), [b(.raise_attack, [], .always, strength: .value, scope: .own_cards, filter: BuffFilter(tribe: .elf, offensive: true, excludeSelf: true), ext: true)])
        XCTAssertEqual(buffs("magma-thrower"), [b(.raise_attack, [], .round_eq, eventData: .round(1), strength: .value, scope: .own_cards, filter: BuffFilter(tribe: .dwarf, offensive: true), ext: true)])
        XCTAssertEqual(buffs("herb-collector"), [b(.heal, [], .always, strength: .value, scope: .own_cards, filter: BuffFilter(tribe: .elf, excludeSelf: true), ext: true)])
        XCTAssertEqual(buffs("sentinel"), [
            b(.heal, [], .always, strength: .value, scope: .own_cards, filter: BuffFilter(excludeSelf: true), ext: true),
            b(.invulnerable, [.selfSlot], .round_eq, eventData: .round(1)),
        ])
        XCTAssertEqual(buffs("totem-carver"), [b(.increment_attack, [], .onDeath, strength: .value, scope: .own_cards, filter: BuffFilter(tribe: .orc, offensive: true), ext: true)])
        XCTAssertEqual(buffs("baby-dragon"), [b(.increment_attack, [], .onDeath, eventData: .selfTag, strength: .value, scope: .own_cards, filter: BuffFilter(tribe: .neutral, offensive: true, excludeSelf: true), ext: true)])
        XCTAssertEqual(buffs("devourer"), [b(.heal, [.selfSlot], .onDeath, eventData: .opponentCards, strength: .value)])
        XCTAssertEqual(buffs("giant-spider"), buffs("devourer"))
        XCTAssertEqual(buffs("gladiator"), [b(.raise_attack, [.selfSlot], .onHeal, eventData: .selfTag, nextRound: true, strengthFromEvent: true, ext: true)])
        XCTAssertEqual(buffs("leviathan"), buffs("gladiator"))
        XCTAssertEqual(buffs("bone-oracle"), [b(.invulnerable, [.left, .right], .round_eq, eventData: .round(2), filter: BuffFilter(tribe: .orc), ext: true)])
        XCTAssertEqual(buffs("swarmkeeper"), [b(.invulnerable, [.left], .round_eq, eventData: .round(1), filter: BuffFilter(tribe: .orc), ext: true)])
        XCTAssertEqual(buffs("enormous-larva"), [
            b(.resurrect, [.selfSlot], .onDeath, eventData: .selfTag),
            b(.increment_attack, [.selfSlot], .onDeath, eventData: .selfTag, strengthPercent: .number(1000), baseAttack: true, ext: true),
        ])
        XCTAssertEqual(buffs("bone-dragon"), [
            b(.resurrect, [.selfSlot], .onDeath, eventData: .selfTag),
            b(.increment_attack, [.selfSlot], .onDeath, eventData: .selfTag, strength: .value),
        ])
        XCTAssertEqual(buffs("astral-navigator"), [b(.resurrect, [.selfSlot], .onDeath, eventData: .selfTag), b(.heal_player, [], .always, strength: .value)])
        XCTAssertEqual(buffs("goblin-cook"), [b(.raise_player_hp, [], .always, strength: .value), b(.deal_damage_to_player, [], .round_eq, eventData: .round(4), strength: .value)])
        XCTAssertEqual(buffs("lightning-spirit"), [b(.deal_damage_to_all_opponent_cards, [], .always, strength: .value, unreflectable: true, ext: true)])
        XCTAssertEqual(buffs("sand-kraken"), [b(.deal_damage_to_all_opponent_cards, [], .always, strength: .value)])
        XCTAssertEqual(buffs("raven-shaman"), [b(.heal, [.left], .always, strength: .value)])
        XCTAssertEqual(buffs("worm-shaman"), [b(.heal, [.right], .always, strength: .value)])
        XCTAssertEqual(buffs("cave-troll"), [b(.heal, [.selfSlot], .always, strength: .value)])
    }

    func testCardsWithoutAbilitiesAreNull() {
        for id in ["archer", "gremlin", "minotaur", "chimera", "imperial-dragon", "tomb-colossus", "keeper-of-the-treasure", "envoy", "adept", "stone-golem"] {
            XCTAssertNil(ability(id), id)
            XCTAssertFalse(Abilities.hasAbility(ability(id)))
        }
        XCTAssertEqual(abilities.values.filter { $0 == nil }.count, 55)
        XCTAssertTrue(Abilities.hasAbility(ability("siren")))
    }

    func testEvolvingAbilitiesHaveFiveStages() {
        for id in ["bog-yeti", "sand-yeti", "mountain-yeti", "magmamancer", "army-of-ghosts"] {
            guard case .byStage(let stages, _)? = ability(id) else { return XCTFail("\(id) evolves") }
            XCTAssertEqual(stages.count, 5, id)
        }
        func inv(_ n: Int) -> Buff { b(.invulnerable, [.selfSlot], .round_eq, eventData: .round(n)) }
        let invGe2 = b(.invulnerable, [.selfSlot], .round_ge, eventData: .round(2))
        func stage(_ id: String, _ s: Int) -> AbilityEntry? { Abilities.abilityForStage(ability(id), stage: s) }
        // Yetis: stage 0 is text only, stage 4 is invulnerable from round 2.
        XCTAssertFalse(Abilities.hasAbility(ability("bog-yeti"), stage: 0))
        XCTAssertEqual(stage("bog-yeti", 0), AbilityEntry(text: "Has no special abilities, as far as you can tell.", buffs: []))
        XCTAssertTrue(Abilities.hasAbility(ability("bog-yeti"), stage: 4))
        XCTAssertEqual(stage("bog-yeti", 1)?.buffs, [inv(2)])
        XCTAssertEqual(stage("bog-yeti", 2)?.buffs, [inv(3)])
        XCTAssertEqual(stage("bog-yeti", 3)?.buffs, [inv(2), inv(3)])
        XCTAssertEqual(stage("bog-yeti", 4)?.buffs, [invGe2])
        for id in ["mountain-yeti", "army-of-ghosts"] {
            XCTAssertFalse(Abilities.hasAbility(ability(id), stage: 0), id)
            XCTAssertEqual(stage(id, 1)?.buffs, [inv(3)], id)
            XCTAssertEqual(stage(id, 2)?.buffs, [inv(2)], id)
            XCTAssertEqual(stage(id, 3)?.buffs, [inv(2), inv(3)], id)
            XCTAssertEqual(stage(id, 4)?.buffs, [invGe2], id)
        }
        // Sand Yeti heals the player at every stage.
        let healP = b(.heal_player, [], .always, strength: .value)
        XCTAssertEqual(stage("sand-yeti", 0)?.buffs, [healP])
        XCTAssertEqual(stage("sand-yeti", 0)?.text, "Heals {v} of your health points each round. That's it, as far as you can tell.")
        XCTAssertEqual(stage("sand-yeti", 1)?.buffs, [healP, inv(3)])
        XCTAssertEqual(stage("sand-yeti", 2)?.buffs, [healP, inv(2)])
        XCTAssertEqual(stage("sand-yeti", 3)?.buffs, [healP, inv(2), inv(3)])
        XCTAssertEqual(stage("sand-yeti", 4)?.buffs, [healP, invGe2])
        // Magmamancer: no_buff / no_damage on frontLeft in round 1, then front in round 2.
        func nb(_ d: OriginalDirection, _ n: Int) -> Buff { b(.no_buff, [d], .round_eq, eventData: .round(n)) }
        func nd(_ d: OriginalDirection, _ n: Int) -> Buff { b(.no_damage, [d], .round_eq, eventData: .round(n)) }
        XCTAssertEqual(stage("magmamancer", 0)?.text, "Her visions appear to have no practical value.")
        XCTAssertFalse(Abilities.hasAbility(ability("magmamancer"), stage: 0))
        XCTAssertEqual(stage("magmamancer", 1)?.buffs, [nb(.frontLeft, 1)])
        XCTAssertEqual(stage("magmamancer", 2)?.buffs, [nb(.frontLeft, 1), nd(.frontLeft, 1)])
        XCTAssertEqual(stage("magmamancer", 3)?.buffs, [nb(.frontLeft, 1), nd(.frontLeft, 1), nb(.front, 2)])
        XCTAssertEqual(stage("magmamancer", 4)?.buffs, [nb(.frontLeft, 1), nd(.frontLeft, 1), nb(.front, 2), nd(.front, 2)])
        // Out-of-range stage clamps; non-evolving returns itself.
        XCTAssertEqual(stage("magmamancer", 9), stage("magmamancer", 4))
        XCTAssertEqual(stage("siren", 3), stage("siren", 0))
        XCTAssertNil(Abilities.abilityForStage(nil, stage: 2))
    }

    func testRenderAbilityTextFillsPlaceholders() {
        XCTAssertEqual(Abilities.renderAbilityText(ability("djinn"), value: 6), "The healing power of each of your cards increases by 6%.")
        XCTAssertEqual(Abilities.renderAbilityText(ability("djinn"), value: 12.5), "The healing power of each of your cards increases by 12.5%.")
        XCTAssertEqual(Abilities.renderAbilityText(ability("medusa"), value: 15), "The attack power of all cards with special abilities is reduced by 15% in round 1.")
        XCTAssertEqual(Abilities.renderAbilityText(ability("dwarf-king"), value: 1600), "Increases the damage dealt by his neighbors by 1,600.")
        XCTAssertEqual(Abilities.renderAbilityText(ability("dwarven-sage"), value: 12345), "Raises your maximum health by 12,345.")
        XCTAssertEqual(Abilities.renderAbilityText(ability("sand-yeti"), value: 840, stage: 2), "Heals 840 of your health points each round. Receives no damage in round 2.")
        XCTAssertEqual(Abilities.renderAbilityText(ability("bog-yeti"), value: nil, stage: 0), "Has no special abilities, as far as you can tell.")
        XCTAssertEqual(Abilities.renderAbilityText(ability("arrow-master"), value: nil), "Deals 75% more damage in the first round.")
        XCTAssertEqual(Abilities.renderAbilityText(ability("dwarf-king"), value: nil), "Increases the damage dealt by his neighbors by ?.")
        XCTAssertGreaterThan(Abilities.renderAbilityText(ability("lich-king"), value: nil).count, 10)
        XCTAssertEqual(Abilities.renderAbilityText(nil, value: 5), "")
        XCTAssertEqual(Abilities.renderAbilityText(ability("archer"), value: 5), "")
        XCTAssertEqual(Abilities.formatValue(1_000_000), "1,000,000")
        XCTAssertEqual(Abilities.formatValue(-200), "-200")
        XCTAssertEqual(Abilities.formatValue(12.96), "13")
        XCTAssertEqual(Abilities.formatValue(1234.5), "1,234.5")
        XCTAssertEqual(Abilities.formatValue(nil), "?")
        XCTAssertEqual(Abilities.formatValue(.infinity), "?")
    }

    func testEveryRenderedTextHasNoLeftoverPlaceholders() {
        for (id, a) in abilities {
            for s in 0..<5 {
                let t = Abilities.renderAbilityText(a, value: 1234, stage: s)
                XCTAssertFalse(t.contains("{") || t.contains("}") || t.contains("__"), "\(id)@\(s): \(t)")
            }
        }
    }

    func testEffectDirsMapBackToCatalogNames() {
        XCTAssertEqual(Abilities.effectDirs(ability("dwarf-king")), [.ownLeft, .ownRight])
        XCTAssertEqual(Abilities.effectDirs(ability("armorer")), [.ownRight])
        XCTAssertEqual(Abilities.effectDirs(ability("equipment-master")), [.ownLeft])
        XCTAssertEqual(Abilities.effectDirs(ability("siren")), [.direct])
        XCTAssertEqual(Abilities.effectDirs(ability("goblin-patriarch")), [.left, .right, .ownLeft, .ownRight])
        XCTAssertEqual(Abilities.effectDirs(ability("hurricane-dancer")), [.left, .direct, .right, .ownLeft, .ownRight])
        XCTAssertEqual(Abilities.effectDirs(ability("warg-rider")), [.left, .direct, .right, .ownLeft, .ownRight])
        XCTAssertEqual(Abilities.effectDirs(ability("magmamancer"), stage: 1), [.left])
        XCTAssertEqual(Abilities.effectDirs(ability("magmamancer"), stage: 4), [.left, .direct])
        XCTAssertEqual(Abilities.effectDirs(ability("anvil-guard")), [])
        XCTAssertEqual(Abilities.effectDirs(ability("guardian-of-time")), [])
        XCTAssertEqual(Abilities.effectDirs(ability("catapult")), [], "attack overrides are not ability arrows")
        XCTAssertEqual(Abilities.effectDirs(ability("crystal-golem")), [.direct])
        XCTAssertEqual(Abilities.effectDirs(nil), [])
        XCTAssertEqual(Abilities.effectDirs(ability("bog-yeti"), stage: 0), [])
        XCTAssertEqual(Abilities.toOriginalDirs([.left, .direct, .right, .ownLeft, .ownRight]), [.frontLeft, .front, .frontRight, .left, .right])
        XCTAssertEqual(Abilities.toCatalogDirs([.right, .selfSlot, .front, .frontLeft]), [.left, .direct, .ownRight])
        // green arrows (card-view.js healDirsFor) and the remaining blue ones
        XCTAssertEqual(Abilities.healDirs(ability("keeper")), [.ownLeft, .ownRight])
        XCTAssertEqual(Abilities.healDirs(ability("dwarf-king")), [])
        XCTAssertEqual(Abilities.buffDirs(ability("dwarf-king")), [.ownLeft, .ownRight])
        XCTAssertEqual(Abilities.buffDirs(ability("keeper")), [])
    }

    func testBuffsForStageImplicitAttackResolvedStrengthsPerTargetOverrides() {
        // Dwarf King: implicit attack from its dirs + the raise_attack with the value resolved (no perTarget: split by the engine).
        XCTAssertEqual(Abilities.buffsForStage(ability("dwarf-king"), stage: 0, abilityValue: 1600, cardDirs: [.direct]), [
            b(.attack, [.front], .always),
            b(.raise_attack, [.left, .right], .always, strength: .number(1600)),
        ])
        // Keeper: no attack dirs → no implicit attack; perTarget doubles the stored per-neighbour amount.
        XCTAssertEqual(Abilities.buffsForStage(ability("keeper"), stage: 0, abilityValue: 100, cardDirs: []), [b(.heal, [.left, .right], .always, strength: .number(200))])
        XCTAssertEqual(Abilities.buffsForStage(ability("raven-shaman"), stage: 0, abilityValue: 100, cardDirs: [.direct]), [
            b(.attack, [.front], .always),
            b(.heal, [.left], .always, strength: .number(100)),
        ])
        // Catapult: the explicit attack replaces the implicit one.
        XCTAssertEqual(Abilities.buffsForStage(ability("catapult"), stage: 0, abilityValue: nil, cardDirs: [.left, .direct, .right]), [b(.attack, [.frontLeft, .front, .frontRight], .round_le, eventData: .round(3))])
        XCTAssertEqual(Abilities.buffsForStage(ability("rat-eater"), stage: 0, abilityValue: nil, cardDirs: [.direct]), [b(.attack, [.front], .always, emptyReduction: -200)])
        // Reflect cap and percent strengths are resolved; ext flags survive.
        XCTAssertEqual(Abilities.buffsForStage(ability("lava-toad"), stage: 0, abilityValue: 2000, cardDirs: []), [b(.reflect_damage_to_player, [.selfSlot], .onDamage, eventData: .selfTag, cap: .number(2000), ext: true)])
        XCTAssertEqual(Abilities.buffsForStage(ability("djinn"), stage: 0, abilityValue: 6, cardDirs: [.direct]), [
            b(.attack, [.front], .always),
            b(.heal_boost_percent, [], .always, strengthPercent: .number(6), scope: .own_cards, ext: true),
        ])
        XCTAssertEqual(Abilities.buffsForStage(ability("arrow-master"), stage: 0, abilityValue: nil, cardDirs: [.left, .direct, .right])[1].strengthPercent, .number(75))
        // Flat strengths stay; own-neighbour attackers map to left/right.
        XCTAssertEqual(Abilities.buffsForStage(ability("minor-demon"), stage: 0, abilityValue: 999, cardDirs: [.direct])[1].strength, .number(100))
        XCTAssertEqual(Abilities.buffsForStage(ability("bloodsoaked-totem"), stage: 0, abilityValue: 300, cardDirs: [.ownLeft, .ownRight])[0], b(.attack, [.left, .right], .always))
        XCTAssertEqual(Abilities.buffsForStage(nil, stage: 0, abilityValue: 5, cardDirs: [.direct, .ownLeft]), [b(.attack, [.front, .left], .always)])
        XCTAssertEqual(Abilities.buffsForStage(nil, stage: 0, abilityValue: 5, cardDirs: []), [])
        XCTAssertEqual(Abilities.buffsForStage(ability("lich-king"), stage: 0, abilityValue: nil, cardDirs: []), [])
        // Stages: Sand Yeti ++++ and Magmamancer +.
        XCTAssertEqual(Abilities.buffsForStage(ability("sand-yeti"), stage: 4, abilityValue: 840, cardDirs: []), [
            b(.heal_player, [], .always, strength: .number(840)),
            b(.invulnerable, [.selfSlot], .round_ge, eventData: .round(2)),
        ])
        XCTAssertEqual(Abilities.buffsForStage(ability("magmamancer"), stage: 1, abilityValue: nil, cardDirs: []), [b(.no_buff, [.frontLeft], .round_eq, eventData: .round(1))])
        // Missing value → 0, never the "value" placeholder; the source data is not mutated (value semantics).
        XCTAssertEqual(Abilities.buffsForStage(ability("dwarf-king"), stage: 0, abilityValue: nil, cardDirs: [.direct])[1].strength, .number(0))
        XCTAssertEqual(buffs("dwarf-king").first?.strength, .value)
        for (id, a) in abilities {
            for s in 0..<5 {
                for buff in Abilities.buffsForStage(a, stage: s, abilityValue: 10, cardDirs: db.get(id)!.dirs) {
                    XCTAssertNotEqual(buff.strength, .value, "\(id)@\(s)")
                    XCTAssertNotEqual(buff.cap, .value, "\(id)@\(s)")
                    XCTAssertNotEqual(buff.strengthPercent, .value, "\(id)@\(s)")
                    XCTAssertNil(buff.perTarget, "\(id)@\(s)")
                }
            }
        }
    }

    func testExplicitAttackOverridesUseExactlyTheCardDirs() {
        var overrides = 0
        for (id, a) in abilities {
            guard let a else { continue }
            for st in a.entries {
                guard let st else { continue }
                for buff in st.buffs where buff.type == .attack {
                    overrides += 1
                    XCTAssertEqual(buff.directions, Abilities.toOriginalDirs(db.get(id)!.dirs), id)
                }
            }
        }
        XCTAssertEqual(overrides, 5, "Catapult, Rat Eater, Succubus, Treeman, Carnivorous Toadstool")
        // Every card with buffs and attack dirs gets the implicit attack from buffsForStage.
        for c in db.all() {
            let list = Abilities.buffsForStage(c.ability, stage: 0, abilityValue: 1, cardDirs: c.dirs)
            XCTAssertEqual(list.contains { $0.type == .attack }, !c.dirs.isEmpty, c.id)
        }
    }
}
