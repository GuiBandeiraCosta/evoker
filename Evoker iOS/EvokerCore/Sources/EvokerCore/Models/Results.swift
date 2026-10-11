import Foundation

/// Rewards and the typed results of the game functions (what the web returns next to `state`). Field names follow
/// the web so that the game goldens can compare them as JSON.

public enum RewardType: String, Codable, Sendable, Hashable {
    case none, gold, gems, potion, token, card, piece
}

/// rewards.js reward shapes, flattened: `{type: 'gold', gold}`, `{type: 'card', cardId, stage, level, uid?, converted?, gold?}` …
public struct Reward: Codable, Hashable, Sendable {
    public var type: RewardType
    public var gold: Int?
    public var gems: Int?
    public var potion: PotionKind?
    public var count: Int?
    public var token: TokenKind?
    public var portalId: String?
    public var cardId: String?
    public var stage: Int?
    public var level: Int?
    /// A soul card of the tutorial quests.
    public var soul: Bool?
    /// A burst-only tap record (the coin shower).
    public var burst: Bool?
    /// Annotations added by applyReward.
    public var uid: String?
    public var converted: Bool?
    public var huntIndex: Int?
    public var completed: Bool?
    public var full: Bool?
    /// Deck slot a soul card went into (-1 = none).
    public var slot: Int?

    public init(type: RewardType, gold: Int? = nil, gems: Int? = nil, potion: PotionKind? = nil, count: Int? = nil,
                token: TokenKind? = nil, portalId: String? = nil, cardId: String? = nil, stage: Int? = nil, level: Int? = nil,
                soul: Bool? = nil, burst: Bool? = nil, uid: String? = nil, converted: Bool? = nil, huntIndex: Int? = nil,
                completed: Bool? = nil, full: Bool? = nil, slot: Int? = nil) {
        self.type = type; self.gold = gold; self.gems = gems; self.potion = potion; self.count = count; self.token = token
        self.portalId = portalId; self.cardId = cardId; self.stage = stage; self.level = level; self.soul = soul; self.burst = burst
        self.uid = uid; self.converted = converted; self.huntIndex = huntIndex; self.completed = completed; self.full = full; self.slot = slot
    }

    public static let none = Reward(type: .none)
    public static func gold(_ n: Int) -> Reward { Reward(type: .gold, gold: n) }
    public static func gems(_ n: Int) -> Reward { Reward(type: .gems, gems: n) }
    public static func potion(_ kind: PotionKind, count: Int = 1) -> Reward { Reward(type: .potion, potion: kind, count: count) }
    public static func token(_ kind: TokenKind, portalId: String? = nil, count: Int = 1) -> Reward { Reward(type: .token, count: count, token: kind, portalId: portalId) }
    public static func card(_ id: String, stage: Int = 0, level: Int = 1) -> Reward { Reward(type: .card, cardId: id, stage: stage, level: level) }
    public static func piece(_ id: String) -> Reward { Reward(type: .piece, cardId: id) }

    enum CodingKeys: String, CodingKey {
        case type, gold, gems, potion, count, token, portalId, cardId, stage, level, soul, burst, uid, converted, huntIndex, completed, full, slot
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        type = c.lenient(RewardType.self, .type, default: .none)
        gold = c.intOrNil(.gold)
        gems = c.intOrNil(.gems)
        potion = c.optionalValue(PotionKind.self, .potion)
        count = c.intOrNil(.count)
        token = c.optionalValue(TokenKind.self, .token)
        portalId = c.stringOrNil(.portalId)
        cardId = c.stringOrNil(.cardId)
        stage = c.intOrNil(.stage)
        level = c.intOrNil(.level)
        soul = c.boolOrNil(.soul)
        burst = c.boolOrNil(.burst)
        uid = c.stringOrNil(.uid)
        converted = c.boolOrNil(.converted)
        huntIndex = c.intOrNil(.huntIndex)
        completed = c.boolOrNil(.completed)
        full = c.boolOrNil(.full)
        slot = c.intOrNil(.slot)
    }
}

/// The Drink-potion dialog decision (player.js needsPotion).
public struct NeedsPotion: Codable, Hashable, Sendable {
    public var needed: Bool
    public var kind: PotionKind
    public var have: Int
    public var missing: Int
    public var hasPotion: Bool
    public var potions: Int
    public var price: Int
    public var canBuy: Bool
    public init(needed: Bool, kind: PotionKind, have: Int, missing: Int, hasPotion: Bool, potions: Int, price: Int, canBuy: Bool) {
        self.needed = needed; self.kind = kind; self.have = have; self.missing = missing; self.hasPotion = hasPotion
        self.potions = potions; self.price = price; self.canBuy = canBuy
    }
}

/// The "Rewards" column of the level-up dialog (player.js levelUpRewards).
public struct LevelUpRewards: Codable, Hashable, Sendable {
    public var level: Int
    public var gold: Int
    public var gems: Int
    public var potions: [PotionKind]
    public var tokens: [TokenKind]
    public init(level: Int, gold: Int = 0, gems: Int = 0, potions: [PotionKind] = [], tokens: [TokenKind] = []) {
        self.level = level; self.gold = gold; self.gems = gems; self.potions = potions; self.tokens = tokens
    }
}

public struct LevelUpDetail: Codable, Hashable, Sendable {
    public var level: Int
    public var rewards: LevelUpRewards
    public var statPoints: Int
    public var unlocked: [Feature]
    public init(level: Int, rewards: LevelUpRewards, statPoints: Int, unlocked: [Feature]) {
        self.level = level; self.rewards = rewards; self.statPoints = statPoints; self.unlocked = unlocked
    }
}

/// player.js addPlayerXp info.
public struct XpResult: Codable, Hashable, Sendable {
    public var levelUps: [Int]
    public var levelUpDetails: [LevelUpDetail]
    public var gold: Int
    public var gems: Int
    public var xp: Int
    public init(levelUps: [Int] = [], levelUpDetails: [LevelUpDetail] = [], gold: Int = 0, gems: Int = 0, xp: Int = 0) {
        self.levelUps = levelUps; self.levelUpDetails = levelUpDetails; self.gold = gold; self.gems = gems; self.xp = xp
    }
}

public struct CardLevelUp: Codable, Hashable, Sendable {
    public var uid: String
    public var from: Int
    public var to: Int
    public init(uid: String, from: Int, to: Int) { self.uid = uid; self.from = from; self.to = to }
}

public struct StatAlloc: Codable, Hashable, Sendable {
    public var stamina: Int
    public var mana: Int
    public var hp: Int
    public init(stamina: Int = 0, mana: Int = 0, hp: Int = 0) { self.stamina = stamina; self.mana = mana; self.hp = hp }
}

public struct StatPointsPreview: Codable, Hashable, Sendable {
    public var ok: Bool
    public var spent: Int
    public var pointsLeft: Int
    public var hpMax: Int
    public var staminaMax: Int
    public var manaMax: Int
    public init(ok: Bool, spent: Int, pointsLeft: Int, hpMax: Int, staminaMax: Int, manaMax: Int) {
        self.ok = ok; self.spent = spent; self.pointsLeft = pointsLeft; self.hpMax = hpMax; self.staminaMax = staminaMax; self.manaMax = manaMax
    }
}

/// collection.js addCard info.
public struct AddCardResult: Codable, Hashable, Sendable {
    public var uid: String?
    public var converted: Bool
    public var gold: Int
    public init(uid: String?, converted: Bool, gold: Int) { self.uid = uid; self.converted = converted; self.gold = gold }
}

public struct DeckValidation: Codable, Hashable, Sendable {
    public var ok: Bool
    public var reason: String?
    public var mana: Int
    public var count: Int
    public init(ok: Bool, reason: String?, mana: Int, count: Int) { self.ok = ok; self.reason = reason; self.mana = mana; self.count = count }
}

public struct TrainingPreview: Codable, Hashable, Sendable {
    public var ok: Bool
    public var reason: String?
    public var xp: Int
    public var gold: Int
    public var levelFrom: Int
    public var levelTo: Int
    public var cap: Int
    public init(ok: Bool, reason: String?, xp: Int, gold: Int, levelFrom: Int, levelTo: Int, cap: Int) {
        self.ok = ok; self.reason = reason; self.xp = xp; self.gold = gold; self.levelFrom = levelFrom; self.levelTo = levelTo; self.cap = cap
    }
}

public struct TrainingResult: Codable, Hashable, Sendable {
    public var xp: Int
    public var gold: Int
    public var levelUps: [CardLevelUp]
    public init(xp: Int, gold: Int, levelUps: [CardLevelUp]) { self.xp = xp; self.gold = gold; self.levelUps = levelUps }
}

public struct FusionCheck: Codable, Hashable, Sendable {
    public var ok: Bool
    public var reason: String?
    public var cost: Int
    public var quality: Double
    public var warning: String?
    public var stage: Int
    public init(ok: Bool, reason: String?, cost: Int, quality: Double, warning: String?, stage: Int) {
        self.ok = ok; self.reason = reason; self.cost = cost; self.quality = quality; self.warning = warning; self.stage = stage
    }
}

public struct FusionResult: Codable, Hashable, Sendable {
    public var uid: String
    public var quality: Double
    public var cost: Int
    public var stage: Int
    /// Deck slot of the result (-1 = none).
    public var slot: Int
    public init(uid: String, quality: Double, cost: Int, stage: Int, slot: Int) {
        self.uid = uid; self.quality = quality; self.cost = cost; self.stage = stage; self.slot = slot
    }
}

public struct FusionCandidate: Codable, Hashable, Sendable {
    public var cardId: String
    public var stage: Int
    public var uids: [String]
    public init(cardId: String, stage: Int, uids: [String]) { self.cardId = cardId; self.stage = stage; self.uids = uids }
}

public enum QuestStatus: String, Codable, Sendable, Hashable {
    case done, current, locked
}

public struct MapNode: Sendable {
    public var n: Int
    public var status: QuestStatus
    public var quest: QuestNode
    public init(n: Int, status: QuestStatus, quest: QuestNode) { self.n = n; self.status = status; self.quest = quest }
}

public struct PortalSchedule: Codable, Hashable, Sendable {
    public var portalId: String
    public var index: Int
    public var startedAt: Int64
    public var endsAt: Int64
    public var remainingMs: Int64
    public init(portalId: String, index: Int, startedAt: Int64, endsAt: Int64, remainingMs: Int64) {
        self.portalId = portalId; self.index = index; self.startedAt = startedAt; self.endsAt = endsAt; self.remainingMs = remainingMs
    }
}

/// quests.js questTapInfo.
public struct QuestTapInfo: Codable, Hashable, Sendable {
    public var stamina: Int
    public var gold: Int
    public var xp: Int
    public var figures: Int
    public var burstChance: Double
    public var endGold: Int
    public init(stamina: Int, gold: Int, xp: Int, figures: Int, burstChance: Double, endGold: Int) {
        self.stamina = stamina; self.gold = gold; self.xp = xp; self.figures = figures; self.burstChance = burstChance; self.endGold = endGold
    }
}

/// rewards.js rollTapGold.
public struct TapGold: Codable, Hashable, Sendable {
    public var gold: Int
    public var tap: Int
    public var burst: Int
    public var perfect: Bool
    public init(gold: Int, tap: Int, burst: Int, perfect: Bool) { self.gold = gold; self.tap = tap; self.burst = burst; self.perfect = perfect }
}

/// quests.js tapMinion info.
public struct TapResult: Codable, Hashable, Sendable {
    public var needsPotion: NeedsPotion?
    public var reward: Reward?
    public var waveCleared: Bool
    public var bossReady: Bool
    public var pct: Int
    public var minion: String?
    public var stamina: Int
    public var gold: Int
    public var tapGold: Int
    public var burst: Int
    public var perfect: Bool
    public var xp: Int
    public var levelUps: [Int]
    public var levelUpDetails: [LevelUpDetail]
    public var soulCard: Reward?
    public init(needsPotion: NeedsPotion? = nil, reward: Reward? = nil, waveCleared: Bool = false, bossReady: Bool = false, pct: Int = 0,
                minion: String? = nil, stamina: Int = 0, gold: Int = 0, tapGold: Int = 0, burst: Int = 0, perfect: Bool = false, xp: Int = 0,
                levelUps: [Int] = [], levelUpDetails: [LevelUpDetail] = [], soulCard: Reward? = nil) {
        self.needsPotion = needsPotion; self.reward = reward; self.waveCleared = waveCleared; self.bossReady = bossReady; self.pct = pct
        self.minion = minion; self.stamina = stamina; self.gold = gold; self.tapGold = tapGold; self.burst = burst; self.perfect = perfect
        self.xp = xp; self.levelUps = levelUps; self.levelUpDetails = levelUpDetails; self.soulCard = soulCard
    }
}

/// quests.js resolveBoss / fightBoss info.
public struct BossResult: Sendable {
    public var won: Bool
    public var reward: Reward?
    public var unlocked: Int?
    public var firstWin: Bool
    public var playerXp: Int
    public var cardXp: Int
    public var levelUps: [Int]
    public var levelUpDetails: [LevelUpDetail]
    public var cardLevelUps: [CardLevelUp]
    public var gems: Int
    /// The new open deck-slot count when this win opened one.
    public var deckSlots: Int?
    public var bonusGold: Int
    public var quest: QuestNode
    /// Filled by fightBoss.
    public var battle: BattleOutcome?
    public var lineup: BossLineup?
    public var seed: UInt32?
    public init(won: Bool, reward: Reward?, unlocked: Int?, firstWin: Bool, playerXp: Int, cardXp: Int, levelUps: [Int], levelUpDetails: [LevelUpDetail],
                cardLevelUps: [CardLevelUp], gems: Int, deckSlots: Int?, bonusGold: Int, quest: QuestNode, battle: BattleOutcome? = nil,
                lineup: BossLineup? = nil, seed: UInt32? = nil) {
        self.won = won; self.reward = reward; self.unlocked = unlocked; self.firstWin = firstWin; self.playerXp = playerXp; self.cardXp = cardXp
        self.levelUps = levelUps; self.levelUpDetails = levelUpDetails; self.cardLevelUps = cardLevelUps; self.gems = gems; self.deckSlots = deckSlots
        self.bonusGold = bonusGold; self.quest = quest; self.battle = battle; self.lineup = lineup; self.seed = seed
    }
}

/// pvp.js canFightPvp.
public struct CanFight: Codable, Hashable, Sendable {
    public var ok: Bool
    public var reason: String?
    public var mana: Int
    public var needsPotion: Bool
    public init(ok: Bool, reason: String?, mana: Int, needsPotion: Bool) { self.ok = ok; self.reason = reason; self.mana = mana; self.needsPotion = needsPotion }
}

/// pvp.js runPvpFight info.
public struct PvpFightResult: Sendable {
    public var battle: BattleOutcome
    public var won: Bool
    public var seed: UInt32
    public var playerXp: Int
    public var cardXp: Int
    public var levelUps: [Int]
    public var cardLevelUps: [CardLevelUp]
    public var manaSpent: Int
    public var enemyDeckMana: Int
    public init(battle: BattleOutcome, won: Bool, seed: UInt32, playerXp: Int, cardXp: Int, levelUps: [Int], cardLevelUps: [CardLevelUp], manaSpent: Int, enemyDeckMana: Int) {
        self.battle = battle; self.won = won; self.seed = seed; self.playerXp = playerXp; self.cardXp = cardXp; self.levelUps = levelUps
        self.cardLevelUps = cardLevelUps; self.manaSpent = manaSpent; self.enemyDeckMana = enemyDeckMana
    }
}

public struct SimBestCard: Codable, Hashable, Sendable {
    public var cardId: String
    public var stage: Int
    public var level: Int
    public var evolveQuality: Double
    public var name: String?
    public init(cardId: String, stage: Int, level: Int, evolveQuality: Double, name: String?) {
        self.cardId = cardId; self.stage = stage; self.level = level; self.evolveQuality = evolveQuality; self.name = name
    }
}

/// opponents.js simInfo (+ the offer fields of arena.js offerInfo).
public struct SimInfo: Codable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var avatar: Int
    public var level: Int
    public var stamina: Int
    public var mana: Int
    public var hp: Int
    public var quests: Int
    public var battlesWon: Int
    public var bestCard: SimBestCard?
    public var deckMana: Int
    public var difficulty: Difficulty?
    public var color: String?
    public var power: Double?
    public init(id: String, name: String, avatar: Int, level: Int, stamina: Int, mana: Int, hp: Int, quests: Int, battlesWon: Int,
                bestCard: SimBestCard?, deckMana: Int, difficulty: Difficulty? = nil, color: String? = nil, power: Double? = nil) {
        self.id = id; self.name = name; self.avatar = avatar; self.level = level; self.stamina = stamina; self.mana = mana; self.hp = hp
        self.quests = quests; self.battlesWon = battlesWon; self.bestCard = bestCard; self.deckMana = deckMana
        self.difficulty = difficulty; self.color = color; self.power = power
    }
}

public struct ArenaRewards: Codable, Hashable, Sendable {
    public var gold: Int
    public var tournamentPoints: Int
    public var cardXp: Int
    public var playerXp: Int
    public var leaguePoints: Int
    public init(gold: Int, tournamentPoints: Int, cardXp: Int, playerXp: Int, leaguePoints: Int) {
        self.gold = gold; self.tournamentPoints = tournamentPoints; self.cardXp = cardXp; self.playerXp = playerXp; self.leaguePoints = leaguePoints
    }
}

/// arena.js fightArena info.
public struct ArenaResult: Sendable {
    public var battle: BattleOutcome
    public var won: Bool
    public var rewards: ArenaRewards
    public var levelUps: [Int]
    public var cardLevelUps: [CardLevelUp]
    public var opponent: SimInfo
    public init(battle: BattleOutcome, won: Bool, rewards: ArenaRewards, levelUps: [Int], cardLevelUps: [CardLevelUp], opponent: SimInfo) {
        self.battle = battle; self.won = won; self.rewards = rewards; self.levelUps = levelUps; self.cardLevelUps = cardLevelUps; self.opponent = opponent
    }
}

public struct ArenaOffers: Codable, Hashable, Sendable {
    public var offers: [ArenaOffer]
    public var rerollAt: Int64
    public init(offers: [ArenaOffer], rerollAt: Int64) { self.offers = offers; self.rerollAt = rerollAt }
}

/// pieces.js addPiece info.
public struct AddPieceResult: Codable, Hashable, Sendable {
    public var index: Int
    public var completed: Bool
    public var uid: String?
    public var full: Bool
    public init(index: Int, completed: Bool, uid: String?, full: Bool) { self.index = index; self.completed = completed; self.uid = uid; self.full = full }
}

/// pieces.js fightHolder info.
public struct PiecesFightResult: Sendable {
    public var battle: BattleOutcome
    public var won: Bool
    public var completed: Bool
    public var uid: String?
    public var cardId: String?
    public var hunt: PieceHunt?
    public var levelUps: [Int]
    public var cardLevelUps: [CardLevelUp]
    public var tournamentPoints: Int
    public var leaguePoints: Int
    public init(battle: BattleOutcome, won: Bool, completed: Bool, uid: String?, cardId: String?, hunt: PieceHunt?, levelUps: [Int],
                cardLevelUps: [CardLevelUp], tournamentPoints: Int, leaguePoints: Int) {
        self.battle = battle; self.won = won; self.completed = completed; self.uid = uid; self.cardId = cardId; self.hunt = hunt
        self.levelUps = levelUps; self.cardLevelUps = cardLevelUps; self.tournamentPoints = tournamentPoints; self.leaguePoints = leaguePoints
    }
}

public struct BuyPiecesResult: Codable, Hashable, Sendable {
    public var cost: Int
    public var uid: String
    public init(cost: Int, uid: String) { self.cost = cost; self.uid = uid }
}

public struct BuyFirstPieceResult: Codable, Hashable, Sendable {
    public var cost: Int
    public var index: Int
    public var cardId: String
    public init(cost: Int, index: Int, cardId: String) { self.cost = cost; self.index = index; self.cardId = cardId }
}

public enum PrizeKind: String, Codable, Sendable, Hashable {
    case card, mana, stamina, gems
}

public struct PrizeItem: Codable, Hashable, Sendable {
    public var kind: PrizeKind
    public var amount: Int
    public var rarity: Rarity?
    public init(kind: PrizeKind, amount: Int, rarity: Rarity? = nil) { self.kind = kind; self.amount = amount; self.rarity = rarity }
}

/// league.js prizeFor.
public struct LeaguePrize: Codable, Hashable, Sendable {
    public var gems: Int
    public var potions: [PotionKind]
    public var card: Rarity?
    public var mana: Int
    public var stamina: Int
    public init(gems: Int, potions: [PotionKind], card: Rarity?, mana: Int, stamina: Int) {
        self.gems = gems; self.potions = potions; self.card = card; self.mana = mana; self.stamina = stamina
    }
}

/// league.js standings rows (rankRows + rowsFor).
public struct LeagueRow: Codable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var avatar: Int
    public var picture: Bool
    public var level: Int
    public var points: Int
    public var isPlayer: Bool
    public var fightsLeft: Int
    public var rank: Int?
    public var rankText: String
    public var rewards: [PrizeItem]
    public var markRank: Bool
    public var fightable: Bool
    public init(id: String, name: String, avatar: Int, picture: Bool, level: Int, points: Int, isPlayer: Bool, fightsLeft: Int,
                rank: Int? = nil, rankText: String = "-", rewards: [PrizeItem] = [], markRank: Bool = false, fightable: Bool = false) {
        self.id = id; self.name = name; self.avatar = avatar; self.picture = picture; self.level = level; self.points = points
        self.isPlayer = isPlayer; self.fightsLeft = fightsLeft; self.rank = rank; self.rankText = rankText; self.rewards = rewards
        self.markRank = markRank; self.fightable = fightable
    }
}

public struct FinalStandings: Sendable {
    public var rows: [LeagueRow]
    public var rank: Int?
    public var place: Int
    public var me: LeagueRow
    public init(rows: [LeagueRow], rank: Int?, place: Int, me: LeagueRow) { self.rows = rows; self.rank = rank; self.place = place; self.me = me }
}

public enum LeagueRefusal: String, Codable, Sendable, Hashable {
    case ended, notMember = "not-member", foughtOut = "fought-out"
}

public struct CanFightLeague: Codable, Hashable, Sendable {
    public var ok: Bool
    public var code: LeagueRefusal?
    public var reason: String?
    public var fightsLeft: Int
    public init(ok: Bool, code: LeagueRefusal?, reason: String?, fightsLeft: Int) { self.ok = ok; self.code = code; self.reason = reason; self.fightsLeft = fightsLeft }
}

public struct LeagueFightResult: Sendable {
    public var battle: BattleOutcome
    public var won: Bool
    public var points: Int
    public var levelUps: [Int]
    public var cardLevelUps: [CardLevelUp]
    public var opponent: SimInfo
    public init(battle: BattleOutcome, won: Bool, points: Int, levelUps: [Int], cardLevelUps: [CardLevelUp], opponent: SimInfo) {
        self.battle = battle; self.won = won; self.points = points; self.levelUps = levelUps; self.cardLevelUps = cardLevelUps; self.opponent = opponent
    }
}

public struct OpenLeagueResult: Sendable {
    public var league: League
    public var prizes: LeaguePrizes?
    public init(league: League, prizes: LeaguePrizes?) { self.league = league; self.prizes = prizes }
}

/// shop.js dailyEvent entry.
public struct DailyEvent: Codable, Hashable, Sendable {
    public var id: DailyEventId
    public var name: String
    public var desc: String
    public init(_ id: DailyEventId) { self.id = id; self.name = id.name; self.desc = id.desc }
}

public enum PaymentType: String, Codable, Sendable, Hashable {
    case token, gems
}

/// shop.js pickPayment.
public struct PickPayment: Codable, Hashable, Sendable {
    public var type: PaymentType
    public var amount: Int
    public var canPay: Bool
    public var tokens: Int
    public var gems: Int
    public init(type: PaymentType, amount: Int, canPay: Bool, tokens: Int, gems: Int) {
        self.type = type; self.amount = amount; self.canPay = canPay; self.tokens = tokens; self.gems = gems
    }
}

/// shop.js setProgressFor.
public struct SetProgress: Codable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var owned: Int
    public var total: Int
    public init(id: String, name: String, owned: Int, total: Int) { self.id = id; self.name = name; self.owned = owned; self.total = total }
}

/// shop.js drawBoosterCard info.
public struct BoosterDraw: Codable, Hashable, Sendable {
    public var cardId: String
    public var uid: String?
    public var converted: Bool
    public var gold: Int
    public var paidWith: PaymentType
    public var cost: Int
    public var setAdded: SetProgress?
    public var remaining: Int
    public var booster: Booster
    public init(cardId: String, uid: String?, converted: Bool, gold: Int, paidWith: PaymentType, cost: Int, setAdded: SetProgress?, remaining: Int, booster: Booster) {
        self.cardId = cardId; self.uid = uid; self.converted = converted; self.gold = gold; self.paidWith = paidWith; self.cost = cost
        self.setAdded = setAdded; self.remaining = remaining; self.booster = booster
    }
}

public struct OpenBoosterResult: Codable, Hashable, Sendable {
    public var booster: Booster
    public var fresh: Bool
    public init(booster: Booster, fresh: Bool) { self.booster = booster; self.fresh = fresh }
}

/// One entry of the 21-day cycle (shop.js DAILY_REWARDS), plus `day` once claimed.
public struct DailyReward: Codable, Hashable, Sendable {
    public var day: Int?
    public var stamina: Int?
    public var mana: Int?
    public var gems: Int?
    public var tokens: TokenKind?
    public var count: Int?
    public init(day: Int? = nil, stamina: Int? = nil, mana: Int? = nil, gems: Int? = nil, tokens: TokenKind? = nil, count: Int? = nil) {
        self.day = day; self.stamina = stamina; self.mana = mana; self.gems = gems; self.tokens = tokens; self.count = count
    }
}

public struct DailyClaim: Codable, Hashable, Sendable {
    public var claimed: Bool
    public var day: Int
    public var reward: DailyReward?
    public init(claimed: Bool, day: Int, reward: DailyReward?) { self.claimed = claimed; self.day = day; self.reward = reward }
}

public struct SetCollectionCard: Codable, Hashable, Sendable {
    public var cardId: String
    public var owned: Bool
    public init(cardId: String, owned: Bool) { self.cardId = cardId; self.owned = owned }
}

/// shop.js setCollections entry.
public struct SetCollection: Codable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var reward: Int
    public var cards: [SetCollectionCard]
    public var ownedCount: Int
    public var total: Int
    public var complete: Bool
    public var claimed: Bool
    public init(id: String, name: String, reward: Int, cards: [SetCollectionCard], ownedCount: Int, total: Int, complete: Bool, claimed: Bool) {
        self.id = id; self.name = name; self.reward = reward; self.cards = cards; self.ownedCount = ownedCount; self.total = total
        self.complete = complete; self.claimed = claimed
    }
}

/// shop.js albumSets entry.
public struct AlbumSet: Codable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var gemReward: Int
    public var cards: [String]
    public init(id: String, name: String, gemReward: Int, cards: [String]) { self.id = id; self.name = name; self.gemReward = gemReward; self.cards = cards }
}

/// shop.js shopOffers booster entry.
public struct BoosterOffer: Codable, Hashable, Sendable {
    public var id: TokenKind
    public var name: String
    public var setName: String?
    public var portalId: String?
    public var pickGems: Int
    public var price: Int
    public var discounted: Bool
    public var tokens: Int
    public var left: Int
    public var pre: Bool
    public var endsInMs: Int64
    public var startsInMs: Int64
    public var mayContain: [Rarity]
    public init(id: TokenKind, name: String, setName: String?, portalId: String?, pickGems: Int, price: Int, discounted: Bool, tokens: Int,
                left: Int, pre: Bool, endsInMs: Int64, startsInMs: Int64, mayContain: [Rarity]) {
        self.id = id; self.name = name; self.setName = setName; self.portalId = portalId; self.pickGems = pickGems; self.price = price
        self.discounted = discounted; self.tokens = tokens; self.left = left; self.pre = pre; self.endsInMs = endsInMs; self.startsInMs = startsInMs
        self.mayContain = mayContain
    }
}

public struct PotionDeal: Codable, Hashable, Sendable {
    public var gems: Int
    public var potions: Int
    public init(gems: Int, potions: Int) { self.gems = gems; self.potions = potions }
}

public struct ShopOffers: Sendable {
    public var event: DailyEvent?
    public var boosters: [BoosterOffer]
    public var potionDeal: PotionDeal?
    public var gemPacks: [Constants.GemPack]
    public init(event: DailyEvent?, boosters: [BoosterOffer], potionDeal: PotionDeal?, gemPacks: [Constants.GemPack]) {
        self.event = event; self.boosters = boosters; self.potionDeal = potionDeal; self.gemPacks = gemPacks
    }
}

/// app.js onOpen: what happens when a save is (re)opened.
public struct OnOpenResult: Sendable {
    public var notices: [Notice]
    public init(notices: [Notice]) { self.notices = notices }
}

/// Mode-independent summary of a fight the battle screen needs (built by the screens from the typed results).
public struct FightRewardsSummary: Codable, Hashable, Sendable {
    public var gold: Int
    public var gems: Int
    public var tournamentPoints: Int
    public var leaguePoints: Int
    public var cardXp: Int
    public var playerXp: Int
    public var reward: Reward?
    public var bonusGold: Int
    public var piece: Reward?
    public init(gold: Int = 0, gems: Int = 0, tournamentPoints: Int = 0, leaguePoints: Int = 0, cardXp: Int = 0, playerXp: Int = 0,
                reward: Reward? = nil, bonusGold: Int = 0, piece: Reward? = nil) {
        self.gold = gold; self.gems = gems; self.tournamentPoints = tournamentPoints; self.leaguePoints = leaguePoints; self.cardXp = cardXp
        self.playerXp = playerXp; self.reward = reward; self.bonusGold = bonusGold; self.piece = piece
    }
}
