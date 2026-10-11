import Foundation
@testable import EvokerCore

/// The 21-card fixture catalog of the web tests (`tests/fixtures-game/cards.js`) in the data/cards.json shape,
/// with the same ids as the real catalog. `makeDb()` builds a CardsDb over it.
enum FixtureCatalog {
    static let caps: [Rarity: [Int]] = [
        .common: [9, 10, 11, 12, 13],
        .standard: [10, 12, 14, 16, 18],
        .uncommon: [11, 15, 19, 23, 27],
        .rare: [12, 18, 24, 30, 36],
        .heroic: [13, 21, 29, 37, 45],
        .legendary: [14, 24, 34, 44, 54],
        .ultimate: [15, 27, 39, 51, 63],
    ]

    static func card(_ id: String, _ name: String, _ tribe: Tribe, _ rarity: Rarity, _ mana: Int, _ dirs: [CatalogDirection],
                     _ attack: Double, _ hp: Double, _ ability: Double?, _ set: String = "main") -> CardDef {
        CardDef(id: id, name: name, tribe: tribe, rarity: rarity, mana: mana, dirs: dirs,
                base: CardBase(attack: attack, hp: hp, ability: ability), caps: caps[rarity]!, growth: CardGrowth(),
                ability: ability == nil ? nil : .single(AbilityEntry(text: "Does {v}.", buffs: [])), set: set)
    }

    static let cards: [CardDef] = [
        card("envoy", "Envoy", .elf, .common, 2, [.direct], 100, 100, nil),
        card("pikeman", "Pikeman", .dwarf, .common, 2, [.direct], 100, 100, nil),
        card("pouch-tearer", "Pouch Tearer", .orc, .common, 2, [.direct], 100, 100, nil),
        card("bone-breaker", "Bone Breaker", .orc, .standard, 4, [.direct], 200, 200, nil),
        card("scout", "Scout", .elf, .standard, 4, [.left, .direct], 200, 200, nil),
        card("master-brewer", "Master Brewer", .dwarf, .standard, 3, [.direct], 100, 200, nil),
        card("throat-cutter", "Throat Cutter", .orc, .standard, 3, [.direct], 200, 100, nil),
        card("sister-elenia", "Sister Elenia", .elf, .heroic, 18, [.direct], 900, 1500, 600),
        card("wilderness-shaper", "Wilderness Shaper", .neutral, .ultimate, 30, [], 0, 2000, 1000, "the-dark-beyond"),
        card("arch-angel", "Arch Angel", .neutral, .uncommon, 9, [.direct], 200, 500, 400),
        card("club-swinger", "Club Swinger", .orc, .uncommon, 6, [.direct], 300, 300, nil),
        card("tunnel-digger", "Tunnel Digger", .dwarf, .uncommon, 9, [.direct], 200, 300, 400),
        card("basilisk", "Basilisk", .neutral, .uncommon, 9, [.direct], 100, 500, nil),
        card("rat-eater", "Rat Eater", .orc, .rare, 11, [.direct], 720, 480, nil),
        card("armorer", "Armorer", .dwarf, .rare, 12, [.direct], 480, 720, 240),
        card("phoenix", "Phoenix", .neutral, .rare, 13, [.direct], 720, 480, nil),
        card("guruk-the-destroyer", "Guruk the Destroyer", .orc, .rare, 15, [.direct], 600, 1080, nil),
        card("dwarf-king", "Dwarf King", .dwarf, .legendary, 24, [.direct], 800, 2400, 1600),
        card("imperial-dragon", "Imperial Dragon", .neutral, .legendary, 25, [.left, .direct, .right], 3000, 2000, nil),
        card("airborne-parasite", "Airborne Parasite", .neutral, .rare, 13, [.direct], 600, 480, 480, "the-dark-beyond"),
        card("lich-king", "Lich King", .neutral, .heroic, 1, [], 0, 100, nil, "unique-events"),
    ]

    static func makeDb() -> CardsDb {
        try! CardsDb(cards: cards)
    }
}

/// Stub of `src/core/stats.js` with the simplified growth of the web fixture (`tests/fixtures-game/stats.js`).
struct FixtureStats: StatsProviding {
    static let rarityFactor: [Rarity: Double] = [.common: 0.6, .standard: 0.8, .uncommon: 1, .rare: 1.6, .heroic: 2.4, .legendary: 3.5, .ultimate: 5]
    static let fusionCosts: [Rarity: [Int]] = [
        .common: [200, 800, 1800, 3200], .standard: [400, 1600, 3600, 6400], .uncommon: [900, 3600, 8100, 14400],
        .rare: [1920, 7680, 17280, 30720], .heroic: [3750, 15000, 33750, 60000], .legendary: [7200, 28800, 64800, 115200],
        .ultimate: [10780, 43120, 97020, 172480],
    ]
    static let sellFactor: [Rarity: Double] = [.common: 1, .standard: 2, .uncommon: 3, .rare: 4, .heroic: 5, .legendary: 6, .ultimate: 7]

    static func sell(_ rarity: Rarity, _ M: Double, _ L: Double, _ F: Double) -> Double {
        switch rarity {
        case .common: return 5 * M * (9 + L + F)
        case .standard: return 6.5 * M * (10 + L + 2 * F)
        case .uncommon: return 8.5 * M * (11 + L + 4 * F)
        case .rare: return 20 * M * (12 + L + 6 * F)
        case .heroic: return 30 * M * (13 + L + 8 * F)
        case .legendary: return 50 * M * (14 + L + 10 * F)
        case .ultimate: return 55 * M * (15 + L + 12 * F)
        }
    }

    func capFor(_ card: CardDef, stage: Int) -> Int {
        card.caps[max(0, min(4, stage))]
    }

    func statAt(_ card: CardDef, _ stat: StatKey, stage: Int, level: Int, evolveQuality: Double) -> Double? {
        guard let base = card.base.value(stat) else { return stat == .ability ? nil : 0 }
        return JSMath.round(base * JSMath.pow(1.15, Double(stage)) * (1 + 0.08 * Double(level - 1)) * evolveQuality)
    }

    func cardXpToNext(_ card: CardDef, level: Int, stage: Int) -> Int {
        max(20, JSMath.roundInt((40 * Double(card.mana) * JSMath.pow(Double(level), 1.5)) / 10))
    }

    func playerXpToNext(level: Int) -> Int? {
        JSMath.roundInt(50 * JSMath.pow(Double(level), 0.875))
    }

    func sellValue(_ card: CardDef, stage: Int, level: Int) -> Int {
        JSMath.roundInt(FixtureStats.sell(card.rarity, Double(card.mana), Double(level), Double(stage)))
    }

    func fusionCost(rarity: Rarity, stage: Int) -> Int {
        FixtureStats.fusionCosts[rarity]![max(0, min(3, stage))]
    }

    func sacrificeXp(_ card: CardDef, stage: Int, level: Int) -> Int {
        JSMath.roundInt(25 * Double(card.mana) * Double(level + 2) * FixtureStats.rarityFactor[card.rarity]!)
    }

    func enhancePrice(_ card: CardDef, level: Int) -> Int {
        JSMath.ceilInt((Double(card.mana) * 25 + Double(max(1, level) - 1) * 50) * (1 + FixtureStats.sellFactor[card.rarity]! / 10) * 2)
    }

    func evolveQuality(_ l1: Int, _ cap1: Int, _ l2: Int, _ cap2: Int) -> Double {
        1
    }
}

/// Stub battle engine (`tests/fixtures-game/engine.js`): `buildSide` mirrors battle-state.js (calls
/// `options.computeStats`), `simulateBattle` returns the winner the test chooses and records every config.
final class FixtureEngine: BattleSimulating {
    var winner: Winner
    var winnerFn: ((BattleConfig) -> Winner)?
    private(set) var calls: [BattleConfig] = []

    init(winner: Winner = .attacker, winnerFn: ((BattleConfig) -> Winner)? = nil) {
        self.winner = winner
        self.winnerFn = winnerFn
    }

    func toBattleCard(_ ref: CardRef, _ cardDef: CardDef, computeStats: ComputeStats?) -> BattleCard {
        let st = computeStats?(cardDef, ref.stage, ref.level, ref.evolveQuality) ?? CardStats(attack: Int(cardDef.base.attack), hp: Int(cardDef.base.hp), ability: cardDef.base.ability)
        return BattleCard(instanceId: ref.uid.isEmpty ? cardDef.id : ref.uid, cardId: cardDef.id, name: cardDef.name, tribe: cardDef.tribe, rarity: cardDef.rarity,
                          mana: cardDef.mana, stage: ref.stage, level: ref.level, attack: Double(st.attack), maxHp: Double(st.hp), hp: Double(st.hp),
                          abilityValue: st.ability ?? 0, dirs: cardDef.dirs, ability: cardDef.ability?.entry(stage: ref.stage))
    }

    func buildSide(_ player: FighterPlayer, _ cards: [SideEntry?], options: SideOptions) -> FighterSide {
        var out: [BattleCard?] = []
        for i in 0..<5 {
            guard let entry = cards[js: i] ?? nil else { out.append(nil); continue }
            switch entry {
            case .card(let bc): out.append(bc)
            case .ref(let ref):
                guard let def = options.cardsDb?.get(ref.cardId) else { fatalError("fixture engine: unknown card " + ref.cardId) }
                out.append(toBattleCard(ref, def, computeStats: options.computeStats))
            }
        }
        // Math.round(Number(playerLike.maxHp || playerLike.hp || 1500))
        let raw = (player.maxHp.flatMap { $0 != 0 ? $0 : nil }) ?? (player.hp.flatMap { $0 != 0 ? $0 : nil }) ?? 1500
        let p = FighterPlayer(name: (player.name ?? "").isEmpty ? "Player" : player.name, hp: raw, maxHp: raw, baseMaxHp: raw, tribeBonus: false)
        return FighterSide(player: p, cards: out)
    }

    func simulateBattle(_ cfg: BattleConfig) -> BattleOutcome {
        calls.append(cfg)
        let w = winnerFn?(cfg) ?? winner
        let attackerHp = w == .attacker ? (cfg.attacker.player.maxHp ?? 0) : 0
        let defenderHp = w == .defender ? (cfg.defender.player.maxHp ?? 0) : 0
        let result = BattleResult(winner: w, rounds: 3, attackerHp: attackerHp, defenderHp: defenderHp, deaths: Deaths(), endedBy: .playerHp)
        func snap(_ side: FighterSide) -> SideSnapshot {
            SideSnapshot(player: PlayerSnapshot(name: side.player.name ?? "", hp: side.player.hp ?? 0, maxHp: side.player.maxHp ?? 0),
                         cards: side.cards.map { c in c.map { CardSnapshot(cardId: $0.cardId, name: $0.name, tribe: $0.tribe ?? .neutral, attack: Int($0.attack ?? 0), hp: Int($0.hp ?? 0), maxHp: Int($0.maxHp ?? 0)) } })
        }
        let events: [BattleEvent] = [
            .battleStart(seed: cfg.seed, attacker: snap(cfg.attacker), defender: snap(cfg.defender)),
            .battleEnd(winner: w, rounds: 3, attackerHp: attackerHp, defenderHp: defenderHp, endedBy: .playerHp),
        ]
        return BattleOutcome(events: events, result: result)
    }
}

/// Small quests dataset in the data/quests.json shape (`tests/fixtures-game/quests.js`), built from fixture ids.
enum FixtureQuests {
    static func mainBand(_ q: Int) -> [String: Any] {
        if q <= 10 { return ["rarities": ["common", "standard"], "levels": [1, 3], "stages": [0, 0]] }
        if q <= 30 { return ["rarities": ["standard", "uncommon"], "levels": [2, 8], "stages": [0, 0]] }
        if q <= 60 { return ["rarities": ["uncommon", "rare"], "levels": [5, 14], "stages": [0, 0]] }
        if q <= 90 { return ["rarities": ["rare", "heroic"], "levels": [10, 26], "stages": [1, 2]] }
        return ["rarities": ["heroic", "legendary"], "levels": [20, 34], "stages": [2, 2]]
    }
    static func perTap(_ q: Int) -> Int { q == 1 ? 2 : q <= 5 ? 3 : q <= 10 ? 4 : q <= 30 ? 5 : q <= 70 ? 6 : 7 }
    static func goldPerTap(_ q: Int) -> Int { q == 1 ? 6 : q <= 5 ? 18 : q <= 10 ? 24 : q <= 30 ? 30 : q <= 70 ? 33 : 36 }
    static func portalBand(_ n: Int) -> [String: Any] {
        if n <= 8 { return ["rarities": ["uncommon", "rare"], "levels": [8, 18], "stages": [0, 0]] }
        if n <= 17 { return ["rarities": ["rare", "heroic"], "levels": [14, 30], "stages": [1, 1]] }
        return ["rarities": ["heroic", "legendary"], "levels": [24, 44], "stages": [2, 2]]
    }
    static let mainBosses: [Int: String] = [1: "throat-cutter", 33: "tunnel-digger", 34: "rat-eater", 35: "basilisk", 54: "phoenix", 57: "armorer", 72: "guruk-the-destroyer", 99: "dwarf-king", 100: "imperial-dragon"]
    static let mainStage: [Int: Int] = [54: 1, 57: 1, 72: 2, 99: 2, 100: 2]

    static func makeMain(_ count: Int = 100) -> [String: Any] {
        var nodes: [[String: Any]] = []
        for q in 1...count {
            let tap = perTap(q)
            let figures = q == 1 ? 5 : min(22, 6 + q / 6)
            var node: [String: Any] = [
                "n": q, "section": min(6, (q + 16) / 17), "bossStage": mainStage[q] ?? 0,
                "bossHp": q == 1 ? 250 : 1500 + 90 * q, "bossCards": q == 1 ? 1 : 4, "band": mainBand(q),
                "staminaPerTap": tap, "figures": figures, "stamina": figures * tap, "goldPerFigure": goldPerTap(q),
                "token": q <= 30 ? "neophyte" : q <= 70 ? "summoner" : "archmage",
            ]
            if let b = mainBosses[q] { node["boss"] = b } else { node["boss"] = NSNull() }
            if q >= 71 { node["pieceRarity"] = "legendary" } else if q >= 31 { node["pieceRarity"] = "heroic" } else { node["pieceRarity"] = NSNull() }
            if q == 1 {
                node["bossCardIds"] = ["throat-cutter"]
                node["bossName"] = "Worm Shaman"
                node["rewardCard"] = "throat-cutter"
                node["endGold"] = 10
                node["burstChance"] = 0
            }
            nodes.append(node)
        }
        return ["id": "main", "name": "Main Quest", "cards": ["dwarf-king", "imperial-dragon", "sister-elenia"], "gemReward": 31700, "nodes": nodes]
    }

    static func makePortal(_ id: String, _ name: String, _ cards: [String], _ gemReward: Int, _ bossIds: [String]) -> [String: Any] {
        var nodes: [[String: Any]] = []
        for n in 1...25 {
            let spf = 6 + (n - 1) / 2
            nodes.append([
                "n": n, "boss": bossIds[(n - 1) % bossIds.count], "bossStage": n <= 8 ? 0 : n <= 17 ? 1 : 2, "bossHp": 3965 + 260 * (n - 1), "bossCards": 4,
                "band": portalBand(n), "staminaPerTap": spf, "figures": 12, "stamina": 12 * spf, "goldPerFigure": 34 + 3 * (n - 1),
                "token": n <= 8 ? "low" : "high", "pieceRarity": n <= 8 ? "rare" : n <= 17 ? "heroic" : "legendary", "highTokenFirstWin": n == 25,
            ])
        }
        return ["id": id, "name": name, "cards": cards, "gemReward": gemReward,
                "tokens": ["low": ["name": "Low token", "gems": 100], "high": ["name": "High token", "gems": 1000]], "nodes": nodes]
    }

    static let quests: QuestsData = {
        let obj: [String: Any] = [
            "version": 1, "sections": [], "main": makeMain(100), "portalRotationDays": 7,
            "portals": [
                makePortal("the-dark-beyond", "The Dark Beyond", ["airborne-parasite", "wilderness-shaper"], 4600, ["airborne-parasite", "wilderness-shaper"]),
                makePortal("dragon-hunt", "Dragon Hunt", ["phoenix", "imperial-dragon"], 5000, ["phoenix", "imperial-dragon"]),
                makePortal("dwarven-rage", "Dwarven Rage", ["armorer", "dwarf-king"], 4000, ["armorer", "dwarf-king"]),
            ],
        ]
        let data = try! JSONSerialization.data(withJSONObject: obj)
        return try! JSONDecoder().decode(QuestsData.self, from: data)
    }()

    static let names = NamesData(names: ["Aelric", "Morwen", "Thrainor", "Sylvara", "Grukk", "Elowen", "Baldrik", "Nyssa", "Korgath", "Isolde", "Fenwick", "Ravenna"],
                                 avatars: ["arch-angel", "dwarf-king", "imperial-dragon", "guruk-the-destroyer", "phoenix", "armorer", "basilisk", "rat-eater", "scout", "envoy", "pikeman", "club-swinger"])
}
