import Foundation

/// Game-wide constants: a 1:1 port of `Evoker Web/src/core/constants.js` (rarities, tribes, level caps, growth
/// multipliers and every economy number of `docs/design/game-design.md`). Same names, same values.
public enum Constants {
    // MARK: Cards: fusion stages and stat growth, rarities, tribes, directions, sets, card XP, training

    /// Highest fusion stage (0 = unfused, 4 = "++++").
    public static let maxStage = 4
    /// Fusion level-1 reset factor: stage-s level-1 stat = base × 1.15^s.
    public static let fusionResetFactor = 1.15
    /// When a wiki cap value is below the stage's level-1 value, the cap is forced to level-1 × this.
    public static let badCapFactor = 1.3
    /// Within a stage a stat grows as start + (cap − start) × t^growthExponent, t = (level−1)/(cap−1).
    public static let growthExponent = 1.1
    /// Evolve bonus q = base + span × avg(level / cap); round 5: always 1.
    public static let evolveBonus = (base: 1.0, span: 0.0)

    public struct RarityDef: Sendable {
        public let id: Rarity
        public let name: String
        public let order: Int
        public let color: String
        /// Level cap per stage 0..4.
        public let caps: [Int]
        /// Median stat multiplier at the cap of each stage vs level 1.
        public let growth: [Double]
        /// Gold to fuse from stage i to i+1 (index 0..3).
        public let fusionCosts: [Int]
        /// Gold = k × mana × (base + level + perFusion × stage).
        public let sell: (k: Double, base: Int, perFusion: Int)
        public let sacrificeFactor: Double
        public let manaRange: (Int, Int)
        /// Puzzle pieces needed to complete a card of this rarity.
        public let pieces: Int
    }

    public static let rarities: [Rarity: RarityDef] = [
        .common: RarityDef(id: .common, name: "Common", order: 0, color: "#9a9a9a",
                           caps: [9, 10, 11, 12, 13], growth: [1.87, 2.36, 2.91, 3.52, 4.19],
                           fusionCosts: [200, 800, 1800, 3200], sell: (k: 5, base: 9, perFusion: 1),
                           sacrificeFactor: 0.6, manaRange: (1, 2), pieces: 1),
        .standard: RarityDef(id: .standard, name: "Standard", order: 1, color: "#d8d8d8",
                             caps: [10, 12, 14, 16, 18], growth: [2.0, 2.65, 3.4, 4.25, 6.9],
                             fusionCosts: [400, 1600, 3600, 6400], sell: (k: 6.5, base: 10, perFusion: 2),
                             sacrificeFactor: 0.8, manaRange: (3, 5), pieces: 1),
        .uncommon: RarityDef(id: .uncommon, name: "Uncommon", order: 2, color: "#3ccf4e",
                             caps: [11, 15, 19, 23, 27], growth: [1.8, 2.5, 3.4, 4.7, 6.1],
                             fusionCosts: [900, 3600, 8100, 14400], sell: (k: 8.5, base: 11, perFusion: 4),
                             sacrificeFactor: 1, manaRange: (6, 10), pieces: 2),
        .rare: RarityDef(id: .rare, name: "Rare", order: 3, color: "#3b82f6",
                         caps: [12, 18, 24, 30, 36], growth: [1.58, 2.22, 3.15, 4.11, 5.66],
                         fusionCosts: [1920, 7680, 17280, 30720], sell: (k: 20, base: 12, perFusion: 6),
                         sacrificeFactor: 1.6, manaRange: (11, 15), pieces: 4),
        .heroic: RarityDef(id: .heroic, name: "Heroic", order: 4, color: "#a855f7",
                           caps: [13, 21, 29, 37, 45], growth: [1.43, 2.04, 2.84, 3.88, 5.24],
                           fusionCosts: [3750, 15000, 33750, 60000], sell: (k: 30, base: 13, perFusion: 8),
                           sacrificeFactor: 2.4, manaRange: (16, 20), pieces: 6),
        .legendary: RarityDef(id: .legendary, name: "Legendary", order: 5, color: "#f59e0b",
                              caps: [14, 24, 34, 44, 54], growth: [1.31, 1.86, 2.6, 3.58, 4.87],
                              fusionCosts: [7200, 28800, 64800, 115200], sell: (k: 50, base: 14, perFusion: 10),
                              sacrificeFactor: 3.5, manaRange: (21, 25), pieces: 10),
        .ultimate: RarityDef(id: .ultimate, name: "Ultimate", order: 6, color: "#ef4444",
                             caps: [15, 27, 39, 51, 63], growth: [1.45, 2.25, 3.3, 4.6, 6.3],
                             fusionCosts: [10780, 43120, 97020, 172480], sell: (k: 55, base: 15, perFusion: 12),
                             sacrificeFactor: 5, manaRange: (30, 30), pieces: 12),
    ]

    public static func rarity(_ r: Rarity) -> RarityDef { rarities[r]! }

    public struct TribeDef: Sendable {
        public let id: Tribe
        public let name: String
        public let plural: String
        public let color: String
        /// Icon name under assets/ui (emblem-<name>.svg).
        public let emblem: String
        /// Counts for the tribe bonus.
        public let main: Bool
    }

    public static let tribes: [Tribe: TribeDef] = [
        .dwarf: TribeDef(id: .dwarf, name: "Dwarf", plural: "Dwarves", color: "#3fae4a", emblem: "crystal", main: true),
        .elf: TribeDef(id: .elf, name: "Elf", plural: "Elves", color: "#3a8de0", emblem: "triple-arrow", main: true),
        .orc: TribeDef(id: .orc, name: "Orc", plural: "Orcs", color: "#d9432f", emblem: "axe", main: true),
        .neutral: TribeDef(id: .neutral, name: "Neutral", plural: "Neutrals", color: "#f2a93b", emblem: "flame", main: false),
    ]

    public struct SetDef: Sendable {
        public let id: String
        public let name: String
        public let portal: Bool
        public let album: Bool
        public let setReward: Int
        public let setSize: Int
        /// Page order of the album sets (membership is also in cards.json `sets`).
        public let cards: [String]
    }

    /// Card sets (the main pool plus one per portal / event; then the main-line album sets of the /26 client).
    public static let sets: [SetDef] = [
        SetDef(id: "main", name: "Main", portal: false, album: false, setReward: 31700, setSize: 17, cards: []),
        SetDef(id: "the-dark-beyond", name: "The Dark Beyond", portal: true, album: false, setReward: 4600, setSize: 8, cards: []),
        SetDef(id: "dawn-of-eternity", name: "Dawn of Eternity", portal: true, album: false, setReward: 5600, setSize: 8, cards: []),
        SetDef(id: "desert-twilight", name: "Desert Twilight", portal: true, album: false, setReward: 4000, setSize: 8, cards: []),
        SetDef(id: "divine-peace", name: "Divine Peace", portal: true, album: false, setReward: 4000, setSize: 8, cards: []),
        SetDef(id: "dragon-hunt", name: "Dragon Hunt", portal: true, album: false, setReward: 5000, setSize: 8, cards: []),
        SetDef(id: "dread-empress", name: "Dread Empress", portal: true, album: false, setReward: 4500, setSize: 8, cards: []),
        SetDef(id: "dwarven-rage", name: "Dwarven Rage", portal: true, album: false, setReward: 4000, setSize: 8, cards: []),
        SetDef(id: "dying-dreams", name: "Dying Dreams", portal: true, album: false, setReward: 5300, setSize: 8, cards: []),
        SetDef(id: "unique-events", name: "Unique Events", portal: false, album: false, setReward: 0, setSize: 3, cards: []),
        SetDef(id: "dwarven-apprentice", name: "Dwarven Apprentice", portal: false, album: true, setReward: 50, setSize: 8,
               cards: ["pikeman", "master-brewer", "iron-breaker", "blunderbuss-gunner", "lance-stabber", "korim-stoneskull", "axe-whirler", "pyromancer"]),
        SetDef(id: "elven-novice", name: "Elven Novice", portal: false, album: true, setReward: 50, setSize: 8,
               cards: ["envoy", "keeper", "falconer", "scout", "archer", "meadow-guard", "hunter", "tree-of-life"]),
        SetDef(id: "orc-grunt", name: "Orc Grunt", portal: false, album: true, setReward: 50, setSize: 8,
               cards: ["pouch-tearer", "throat-cutter", "lurking-goblin", "bone-breaker", "worm-shaman", "flinger", "blood-spitter", "tribe-avenger"]),
        SetDef(id: "arborearch", name: "Arborearch", portal: false, album: true, setReward: 3500, setSize: 7,
               cards: ["gremlin", "will-o-the-wisp", "ogre", "giant-lizard", "giant", "giant-spider", "griffin"]),
    ]

    /// Card XP from level l to l+1: max(min, round(k × mana × l^exp / div)); unfused Common/Standard cards at least `low`.
    public static let cardXpCurve = (k: 40.0, exp: 1.5, div: 10.0, min: 20, low: [105, 180], lowRarities: [Rarity.common, .standard])
    /// Sacrifice (training) XP = k × mana × (level + levelOffset) × rarityFactor.
    public static let sacrifice = (k: 25.0, levelOffset: 2)
    /// Fixed XP given by trainer cards when sacrificed.
    public static let trainerXp: [String: Int] = ["lich-king": 4000, "crystal-ghost": 9000, "blood-dragon": 20000]
    /// Most cards sacrificed in one training.
    public static let maxSacrificeCards = 9

    /// Training (enhance) gold price: ceil((mana × costManaFactor + (level − 1) × costLevelFactor) × (1 + raritySellFactor / costRarityDivisor) × rarityEnhanceFactor).
    public enum EnhancePrice {
        public static let costManaFactor = 25.0
        public static let costLevelFactor = 50.0
        public static let costRarityDivisor = 10.0
        public static let rarityEnhanceFactor = 2.0
        public static let raritySellFactor: [Rarity: Double] = [.common: 1, .standard: 2, .uncommon: 3, .rare: 4, .heroic: 5, .legendary: 6, .ultimate: 7]
    }

    /// Card inventory size ("Your cards n/100").
    public static let collectionLimit = 100

    // MARK: Progression

    /// Fresh account (200 gold, 0 gems, 50/50, no potions).
    public enum PlayerStart {
        public static let level = 1
        public static let xp = 0
        public static let statPoints = 0
        public static let stamina = 50
        public static let mana = 50
        public static let hpMax = 1500
        public static let gold = 200
        public static let gems = 0
        public static let staminaPotions = 0
        public static let manaPotions = 0
    }
    public static let maxPlayerLevel = 200
    public static let statPointsPerLevel = 12
    /// What one stat point buys.
    public static let statPointValue = (hp: 30, stamina: 1, mana: 1)
    /// Stamina and mana regenerate by 1 per this many ms of real time.
    public static let regenIntervalMs: Int64 = 60 * 1000
    /// Player XP from level L to L+1: round(k × L^exp), levels 1–4 from the `low` table.
    public static let playerXpCurve = (k: 50.0, exp: 0.875, low: [47, 47, 92, 94])

    public enum BattleXp {
        public static let player = (base: 1.5, perOpponentLevel: 0.5, winMult: 4.0, questBoss: 0)
        public static let card = (base: 10.0, enemyManaDiv: 2.0, winMult: 1.5, wisdomMult: 2.0)
    }

    public enum LevelUpExtra: Sendable, Equatable {
        case gems
        case potion(PotionKind)
        case token(TokenKind)
    }

    public enum LevelUpRewardsTable {
        public static let goldPerLevel = 50
        /// Levels whose gold differs from goldPerLevel × level.
        public static let goldOverrides: [Int: Int] = [4: 150]
        public static let firstGems = 5
        public static let gems = 50
        /// Extra by (level − 2) mod 5.
        public static let cycle: [LevelUpExtra] = [.gems, .potion(.stamina), .potion(.stamina), .potion(.mana), .token(.neophyte)]
    }

    // MARK: Unlocks

    /// Player level at which a feature becomes available (saves without a tutorial record).
    public static let featureUnlockLevels: [Feature: Int] = [
        .quests: 1, .cards: 1, .shop: 1, .fusion: 2, .arena: 4, .pieces: 4, .replays: 4, .training: 5, .league: 6,
    ]
    /// Main quest whose first win opens a feature for a save with a tutorial record.
    public static let featureUnlockQuests: [Feature: Int] = [.fusion: 3, .arena: 8, .pieces: 8, .replays: 8, .training: 9, .league: 10]

    public enum DeckSlots {
        /// Slot indices in the order they open (slots 3 and 2 at the start, then 4, 5, 1).
        public static let order = [2, 1, 3, 4, 0]
        /// Open slots of a new game.
        public static let start = 2
        /// Open-slot count → main quest whose first win opens it.
        public static let quests: [Int: Int] = [3: 2, 4: 4, 5: 7]
    }
    /// Legacy (pre-round-3) deck slot unlock level by slot index 0..4.
    public static let slotUnlockLevels = [5, 1, 1, 1, 3]
    /// Starter collection: Envoy (in the deck), Master Brewer (in the collection).
    public static let starterCards = ["envoy", "master-brewer"]
    /// Deck slot index of each starter card that starts in the deck.
    public static let starterDeckSlots = [2]
    /// Starter collection of a tutorial game.
    public static let tutorialStarterCards = ["envoy"]

    // MARK: Economy

    public static let potionPriceGems = 40
    public static let potionPriceGemsEvent = 20

    public struct BoosterPack: Sendable {
        public let id: TokenKind
        public let name: String
        public let pickGems: Int
        public let portal: Bool
        /// Chance that a slot draws from the portal's own set when it has that rarity.
        public let portalShare: Double?
        /// Chance the Legendary slot is the portal's Ultimate instead.
        public let ultimateChance: Double?
        /// Fixed rarity make-up of the nine cards, in rarity order.
        public let slots: [(Rarity, Int)]
    }

    /// Booster packs of the 1.7.4 client (nine face-down cards in a 3×3 grid).
    public static let boosterPacks: [BoosterPack] = [
        BoosterPack(id: .neophyte, name: "Neophyte Pack", pickGems: 50, portal: false, portalShare: nil, ultimateChance: nil, slots: [(.uncommon, 5), (.rare, 3), (.heroic, 1)]),
        BoosterPack(id: .summoner, name: "Summoner's Pack", pickGems: 350, portal: false, portalShare: nil, ultimateChance: nil, slots: [(.rare, 5), (.heroic, 3), (.legendary, 1)]),
        BoosterPack(id: .archmage, name: "Archmage's Pack", pickGems: 975, portal: false, portalShare: nil, ultimateChance: nil, slots: [(.rare, 2), (.heroic, 5), (.legendary, 2)]),
        BoosterPack(id: .portalLow, name: "Portal Pack", pickGems: 250, portal: true, portalShare: 0.5, ultimateChance: nil, slots: [(.uncommon, 5), (.rare, 3), (.heroic, 1)]),
        BoosterPack(id: .portalHigh, name: "Grand Portal Pack", pickGems: 1000, portal: true, portalShare: 0.6, ultimateChance: 0.1, slots: [(.rare, 5), (.heroic, 3), (.legendary, 1)]),
    ]
    public static func boosterPack(_ id: TokenKind) -> BoosterPack { boosterPacks.first { $0.id == id }! }
    /// Cards in one booster (the 3×3 grid).
    public static let boosterGridCards = 9

    public struct GemPack: Sendable {
        public let id: String
        public let name: String
        public let gems: Int
        public let potions: Int
        public let card: Rarity?
        public let price: String
        public let sprite: String
    }
    /// Gem packs of the premium shop (display only).
    public static let gemPacks: [GemPack] = [
        GemPack(id: "apprentice", name: "Apprentice's Bundle", gems: 500, potions: 0, card: nil, price: "$4.99", sprite: "shop_gems01"),
        GemPack(id: "wanderer", name: "Wanderer's Purse", gems: 1000, potions: 0, card: nil, price: "$9.99", sprite: "shop_gems02"),
        GemPack(id: "hero", name: "Hero's Wallet", gems: 3500, potions: 5, card: nil, price: "$24.99", sprite: "shop_gems02"),
        GemPack(id: "treasure", name: "Evoker's Treasure", gems: 10000, potions: 10, card: .heroic, price: "$49.99", sprite: "shop_gems05"),
        GemPack(id: "vault", name: "Master's Vault", gems: 20000, potions: 20, card: .legendary, price: "$99.99", sprite: "shop_gems05"),
    ]

    /// Gem price to complete a card by number of missing pieces (index = missing − 1). Halved on Card-piece Day.
    public static let piecePrices: [Rarity: [Int]] = [
        .uncommon: [20],
        .rare: [30, 60, 140],
        .heroic: [170, 285, 625, 1100, 1700],
        .legendary: [125, 200, 450, 800, 1250, 1750, 2500, 3200, 4000],
        .ultimate: [150, 250, 550, 950, 1500, 2100, 3000, 3900, 4800, 5600, 6500],
    ]
    public static let firstPieceGems = 100
    public static let firstPieceGemsEvent = 50
    public static let pieceHuntSlots = 8
    public static let pieceRaidChance = 0.2

    // MARK: Quests

    public static let mainQuestCount = 100
    public static let portalQuestCount = 25
    /// Stamina per minion tap by main-quest band (fromQuest, toQuest, stamina).
    public static let questStaminaPerTap: [(Int, Int, Int)] = [(1, 1, 2), (2, 5, 3), (6, 10, 4), (11, 30, 5), (31, 70, 6), (71, 100, 7)]
    /// Gold per minion tap on the main line by quest band.
    public static let questGoldPerTap: [(Int, Int, Int)] = [(1, 1, 6), (2, 5, 18), (6, 10, 24), (11, 30, 30), (31, 70, 33), (71, 100, 36)]
    /// Occasional bonus burst on a tap: ~1 in 10 taps pays ~4.5× the tap value.
    public static let questTapBurst = (chance: 0.1, mult: 4.5)
    public static let xpPerStamina = 1
    public static let portalFinalGold = 1000

    public struct QuestBandDef: Sendable {
        public let id: String
        public let scope: String
        public let from: Int
        public let to: Int
        public let rarities: [Rarity]
        public let levels: (Int, Int)
        public let stage: Int
    }
    public static let questBands: [QuestBandDef] = [
        QuestBandDef(id: "main-1", scope: "main", from: 1, to: 10, rarities: [.common, .standard], levels: (1, 3), stage: 0),
        QuestBandDef(id: "main-2", scope: "main", from: 11, to: 30, rarities: [.standard, .uncommon], levels: (2, 8), stage: 0),
        QuestBandDef(id: "main-3", scope: "main", from: 31, to: 60, rarities: [.uncommon, .rare], levels: (5, 14), stage: 0),
        QuestBandDef(id: "main-4", scope: "main", from: 61, to: 90, rarities: [.rare, .heroic], levels: (10, 26), stage: 1),
        QuestBandDef(id: "main-5", scope: "main", from: 91, to: 100, rarities: [.heroic, .legendary], levels: (20, 34), stage: 2),
        QuestBandDef(id: "portal-1", scope: "portal", from: 1, to: 8, rarities: [.uncommon, .rare], levels: (8, 18), stage: 0),
        QuestBandDef(id: "portal-2", scope: "portal", from: 9, to: 17, rarities: [.rare, .heroic], levels: (14, 30), stage: 1),
        QuestBandDef(id: "portal-3", scope: "portal", from: 18, to: 25, rarities: [.heroic, .legendary], levels: (24, 44), stage: 2),
    ]
    /// Wave reward roll.
    public static let waveRewards = (card: 0.2, nothing: 0.8)
    /// Boss reward roll (probabilities sum to 1).
    public static let bossRewards = (gold: 0.45, token: 0.25, piece: 0.15, potion: 0.1, gems: 0.05)
    public static let bossGemsRange = (13, 82)
    /// Boss gold reward = bossMult × MAX_WAVE_SIZE × gold per tap.
    /// Boss gold reward = bossMult × MAX_WAVE_SIZE × gold per tap.
    public static let questGoldBossMult = 3
    public static let bossHp = (main: (base: 1500, perQuest: 90), portal: (base: 3965, perNode: 260))
    public static let questTokenTiers: [(from: Int, to: Int, token: TokenKind)] = [(1, 30, .neophyte), (31, 70, .summoner), (71, 100, .archmage)]
    public static let pieceDropFromQuest: [Rarity: Int] = [.heroic: 31, .legendary: 71]
    public static let portalPieceFromNode = 4

    // MARK: PvP

    public struct ArenaDifficulty: Sendable {
        public let id: Difficulty
        public let color: String
        public let levelOffset: (Int, Int)
        public let power: Double
    }
    public enum ArenaRules {
        public static let goldPerEnemyMana = 6
        public static let winGoldMult = 2
        public static let tournamentPointsPerWin = 10
        public static let offerRotationMinutes = 30
        public static let difficulties: [ArenaDifficulty] = [
            ArenaDifficulty(id: .easy, color: "green", levelOffset: (-2, 0), power: 0.7),
            ArenaDifficulty(id: .normal, color: "yellow", levelOffset: (-1, 1), power: 1.0),
            ArenaDifficulty(id: .hard, color: "red", levelOffset: (1, 3), power: 1.3),
        ]
        public static let simulatedPlayers = 60
        public static let replaysKept = 10
    }

    public struct LeagueTierDef: Sendable {
        public let id: LeagueTier
        public let name: String
        public let strength: Double
        public let simTop: Double
    }
    public struct PrizeBand: Sendable, Equatable {
        public let from: Int
        public let to: Int
        public let card: Rarity?
        public let mana: Int
        public let stamina: Int
        public let gems: Int
        public init(from: Int, to: Int, card: Rarity? = nil, mana: Int = 0, stamina: Int = 0, gems: Int = 0) {
            self.from = from; self.to = to; self.card = card; self.mana = mana; self.stamina = stamina; self.gems = gems
        }
    }
    public enum LeagueRules {
        public static let durationHours = 24
        /// You + 49 simulated players.
        public static let players = 50
        public static let pointsPerWin = 150
        public static let pointsPerWinDouble = 300
        public static let sourcePoints: [String: Int] = ["league": 150, "arena": 50, "pieces": 30]
        public static let arenaPoints: [Difficulty: Int] = [.easy: 20, .normal: 60, .hard: 120]
        public static let stakeLevelStep = 0.08
        public static let stakeRange = (0.6, 1.6)
        public static let maxFightsPerOpponent = 3
        public static let promote = 3
        public static let tournamentPointsDiv = 10
        public static let tiers: [LeagueTierDef] = [
            LeagueTierDef(id: .bronze, name: "Bronze League", strength: 0.9, simTop: 2400),
            LeagueTierDef(id: .silver, name: "Silver League", strength: 1.05, simTop: 5000),
            LeagueTierDef(id: .gold, name: "Gold League", strength: 1.2, simTop: 11000),
        ]
        public static let prizes: [LeagueTier: [PrizeBand]] = [
            .gold: [
                PrizeBand(from: 1, to: 1, card: .legendary, mana: 12), PrizeBand(from: 2, to: 2, card: .legendary), PrizeBand(from: 3, to: 3, card: .heroic),
                PrizeBand(from: 4, to: 4, gems: 700), PrizeBand(from: 5, to: 9, mana: 10, stamina: 10), PrizeBand(from: 10, to: 19, mana: 10), PrizeBand(from: 20, to: 29, gems: 200),
            ],
            .silver: [
                PrizeBand(from: 1, to: 1, card: .heroic, mana: 7), PrizeBand(from: 2, to: 2, card: .heroic), PrizeBand(from: 3, to: 3, mana: 7, stamina: 7),
                PrizeBand(from: 4, to: 4, gems: 400), PrizeBand(from: 5, to: 9, mana: 5, stamina: 5), PrizeBand(from: 10, to: 19, mana: 5), PrizeBand(from: 20, to: 29, gems: 100),
            ],
            .bronze: [
                PrizeBand(from: 1, to: 1, card: .rare, mana: 5), PrizeBand(from: 2, to: 2, card: .rare), PrizeBand(from: 3, to: 3, mana: 5, stamina: 5),
                PrizeBand(from: 4, to: 4, gems: 200), PrizeBand(from: 5, to: 9, mana: 2, stamina: 2), PrizeBand(from: 10, to: 19, mana: 2), PrizeBand(from: 20, to: 29, gems: 25),
            ],
        ]
        /// Text colours of the tiers.
        public static let tierColors: [LeagueTier: String] = [.bronze: "#d47a42", .silver: "#e3e3e3", .gold: "#ffcf35"]
        public static let rulesText = "You start in the Bronze League. Defeat other players to earn points! After each tournament, the three players with the most points advance to the next league; the others go back to the Bronze League. The higher the league, the better the prizes!"
    }
}
