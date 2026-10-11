import Foundation

/// The save (`evoker.save.v1`, architecture.md §3.4 / state.js). Keys are the web's, so a web export decodes here
/// and an iOS save can be imported by the web game. Decoding is lenient: missing or malformed fields take the
/// defaults of `state.js defaultState` (the equivalent of `migrate`'s deepDefaults); `migrated(now:)` applies the
/// remaining migration rules (uidCounter, legacy deck slots, audio defaults, album seen list).

public struct Tokens: Codable, Hashable, Sendable {
    public var neophyte: Int
    public var summoner: Int
    public var archmage: Int
    public var portalLow: [String: Int]
    public var portalHigh: [String: Int]

    public init(neophyte: Int = 0, summoner: Int = 0, archmage: Int = 0, portalLow: [String: Int] = [:], portalHigh: [String: Int] = [:]) {
        self.neophyte = neophyte; self.summoner = summoner; self.archmage = archmage; self.portalLow = portalLow; self.portalHigh = portalHigh
    }

    enum CodingKeys: String, CodingKey { case neophyte, summoner, archmage, portalLow, portalHigh }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        neophyte = c.int(.neophyte)
        summoner = c.int(.summoner)
        archmage = c.int(.archmage)
        portalLow = c.dictionary(Int.self, .portalLow)
        portalHigh = c.dictionary(Int.self, .portalHigh)
    }

    /// `tokenCount(state, kind, portalId)`.
    public func count(_ kind: TokenKind, portalId: String? = nil) -> Int {
        switch kind {
        case .neophyte: return neophyte
        case .summoner: return summoner
        case .archmage: return archmage
        case .portalLow: return portalId.flatMap { portalLow[$0] } ?? 0
        case .portalHigh: return portalId.flatMap { portalHigh[$0] } ?? 0
        }
    }
}

public struct PlayerState: Codable, Hashable, Sendable {
    public var name: String
    public var avatar: Int
    public var level: Int
    public var xp: Int
    public var statPoints: Int
    public var stamina: Int
    public var staminaMax: Int
    public var mana: Int
    public var manaMax: Int
    public var hpMax: Int
    public var staminaPotions: Int
    public var manaPotions: Int
    public var gold: Int
    public var gems: Int
    public var tokens: Tokens
    public var regenAt: Int64
    public var questsDone: Int
    public var battlesWon: Int
    public var tournamentPoints: Int
    /// Open deck slots (nil in a save written before round 3: `migrated` sizes it with legacyDeckSlots).
    public var deckSlots: Int?

    public init(name: String = "", avatar: Int = 0, level: Int = Constants.PlayerStart.level, xp: Int = 0, statPoints: Int = 0,
                stamina: Int = Constants.PlayerStart.stamina, staminaMax: Int = Constants.PlayerStart.stamina,
                mana: Int = Constants.PlayerStart.mana, manaMax: Int = Constants.PlayerStart.mana, hpMax: Int = Constants.PlayerStart.hpMax,
                staminaPotions: Int = 0, manaPotions: Int = 0, gold: Int = Constants.PlayerStart.gold, gems: Int = Constants.PlayerStart.gems,
                tokens: Tokens = Tokens(), regenAt: Int64 = 0, questsDone: Int = 0, battlesWon: Int = 0, tournamentPoints: Int = 0,
                deckSlots: Int? = Constants.DeckSlots.start) {
        self.name = name; self.avatar = avatar; self.level = level; self.xp = xp; self.statPoints = statPoints; self.stamina = stamina
        self.staminaMax = staminaMax; self.mana = mana; self.manaMax = manaMax; self.hpMax = hpMax; self.staminaPotions = staminaPotions
        self.manaPotions = manaPotions; self.gold = gold; self.gems = gems; self.tokens = tokens; self.regenAt = regenAt
        self.questsDone = questsDone; self.battlesWon = battlesWon; self.tournamentPoints = tournamentPoints; self.deckSlots = deckSlots
    }

    enum CodingKeys: String, CodingKey {
        case name, avatar, level, xp, statPoints, stamina, staminaMax, mana, manaMax, hpMax, staminaPotions, manaPotions, gold, gems,
             tokens, regenAt, questsDone, battlesWon, tournamentPoints, deckSlots
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = c.string(.name)
        avatar = c.int(.avatar)
        level = c.int(.level, default: Constants.PlayerStart.level)
        xp = c.int(.xp)
        statPoints = c.int(.statPoints)
        stamina = c.int(.stamina, default: Constants.PlayerStart.stamina)
        staminaMax = c.int(.staminaMax, default: Constants.PlayerStart.stamina)
        mana = c.int(.mana, default: Constants.PlayerStart.mana)
        manaMax = c.int(.manaMax, default: Constants.PlayerStart.mana)
        hpMax = c.int(.hpMax, default: Constants.PlayerStart.hpMax)
        staminaPotions = c.int(.staminaPotions)
        manaPotions = c.int(.manaPotions)
        gold = c.int(.gold, default: Constants.PlayerStart.gold)
        gems = c.int(.gems, default: Constants.PlayerStart.gems)
        tokens = c.lenient(Tokens.self, .tokens, default: Tokens())
        regenAt = c.int64(.regenAt)
        questsDone = c.int(.questsDone)
        battlesWon = c.int(.battlesWon)
        tournamentPoints = c.int(.tournamentPoints)
        deckSlots = c.intOrNil(.deckSlots)
    }
}

/// An owned card (game-design §2.2).
public struct CardInstance: Codable, Hashable, Sendable, Identifiable {
    public var uid: String
    public var cardId: String
    public var stage: Int
    public var level: Int
    public var xp: Int
    public var evolveQuality: Double

    public var id: String { uid }

    public init(uid: String, cardId: String, stage: Int = 0, level: Int = 1, xp: Int = 0, evolveQuality: Double = 1) {
        self.uid = uid; self.cardId = cardId; self.stage = stage; self.level = level; self.xp = xp; self.evolveQuality = evolveQuality
    }

    enum CodingKeys: String, CodingKey { case uid, cardId, stage, level, xp, evolveQuality }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        uid = c.string(.uid)
        cardId = c.string(.cardId)
        stage = c.int(.stage)
        level = c.int(.level, default: 1)
        xp = c.int(.xp)
        evolveQuality = c.double(.evolveQuality, default: 1)
    }

    /// The instance as a battle-side input.
    public var ref: CardRef { CardRef(uid: uid, cardId: cardId, stage: stage, level: level, evolveQuality: evolveQuality) }
}

/// The instance-like input of `buildSide` (owned cards, boss line-up cards, scaled sim deck cards).
public struct CardRef: Codable, Hashable, Sendable {
    public var uid: String
    public var cardId: String
    public var stage: Int
    public var level: Int
    public var evolveQuality: Double
    public init(uid: String, cardId: String, stage: Int = 0, level: Int = 1, evolveQuality: Double = 1) {
        self.uid = uid; self.cardId = cardId; self.stage = stage; self.level = level; self.evolveQuality = evolveQuality
    }
}

/// A card-piece hunt (pieces.js).
public struct PieceHunt: Codable, Hashable, Sendable {
    public var cardId: String
    public var owned: Int
    public var total: Int
    public var holderId: String?
    public var raidDay: String

    public init(cardId: String, owned: Int = 0, total: Int, holderId: String? = nil, raidDay: String = "") {
        self.cardId = cardId; self.owned = owned; self.total = total; self.holderId = holderId; self.raidDay = raidDay
    }

    enum CodingKeys: String, CodingKey { case cardId, owned, total, holderId, raidDay }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        cardId = c.string(.cardId)
        owned = c.int(.owned)
        total = c.int(.total, default: 4)
        holderId = c.stringOrNil(.holderId)
        raidDay = c.string(.raidDay)
    }
}

public struct LineProgress: Codable, Hashable, Sendable {
    public var unlocked: Int
    public var done: Int
    public var firstWins: [Int]

    public init(unlocked: Int = 1, done: Int = 0, firstWins: [Int] = []) {
        self.unlocked = unlocked; self.done = done; self.firstWins = firstWins
    }

    enum CodingKeys: String, CodingKey { case unlocked, done, firstWins }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        unlocked = c.int(.unlocked, default: 1)
        done = c.int(.done)
        firstWins = c.array(Int.self, .firstWins)
    }
}

/// A card of a boss line-up (quests.js bossLineup); `uid` is "boss" / "boss-<i>".
public struct LineupCard: Codable, Hashable, Sendable {
    public var uid: String
    public var cardId: String
    public var stage: Int
    public var level: Int
    public var evolveQuality: Double
    public var isBoss: Bool?

    public init(uid: String, cardId: String, stage: Int, level: Int, evolveQuality: Double = 1, isBoss: Bool? = nil) {
        self.uid = uid; self.cardId = cardId; self.stage = stage; self.level = level; self.evolveQuality = evolveQuality; self.isBoss = isBoss
    }

    enum CodingKeys: String, CodingKey { case uid, cardId, stage, level, evolveQuality, isBoss }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        uid = c.string(.uid)
        cardId = c.string(.cardId)
        stage = c.int(.stage)
        level = c.int(.level, default: 1)
        evolveQuality = c.double(.evolveQuality, default: 1)
        isBoss = c.boolOrNil(.isBoss)
    }

    public var ref: CardRef { CardRef(uid: uid, cardId: cardId, stage: stage, level: level, evolveQuality: evolveQuality) }
}

public struct LineupPlayer: Codable, Hashable, Sendable {
    public var name: String
    public var hp: Int
    public var maxHp: Int
    public var level: Int?

    public init(name: String, hp: Int, maxHp: Int, level: Int? = nil) { self.name = name; self.hp = hp; self.maxHp = maxHp; self.level = level }

    enum CodingKeys: String, CodingKey { case name, hp, maxHp, level }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = c.string(.name)
        hp = c.int(.hp)
        maxHp = c.int(.maxHp, default: hp)
        level = c.intOrNil(.level)
    }
}

public struct BossLineup: Codable, Hashable, Sendable {
    public var boss: LineupCard
    public var player: LineupPlayer
    public var cards: [LineupCard?]

    public init(boss: LineupCard, player: LineupPlayer, cards: [LineupCard?]) { self.boss = boss; self.player = player; self.cards = cards }

    enum CodingKeys: String, CodingKey { case boss, player, cards }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        boss = try c.decode(LineupCard.self, forKey: .boss)
        player = try c.decode(LineupPlayer.self, forKey: .player)
        var list = c.optionalArray(LineupCard.self, .cards)
        while list.count < 5 { list.append(nil) }
        cards = Array(list.prefix(5))
    }
}

public struct ActiveQuest: Codable, Hashable, Sendable {
    public var line: String
    public var n: Int
    /// Minion card ids per wave (a null entry = a wave slot without a band card).
    public var waves: [[String?]]
    public var waveIndex: Int
    public var waveDone: Int
    public var figuresDone: Int
    public var figuresTotal: Int
    public var bossReady: Bool
    public var boss: BossLineup?
    public var startedAt: Int64?

    public init(line: String, n: Int, waves: [[String?]], waveIndex: Int = 0, waveDone: Int = 0, figuresDone: Int = 0, figuresTotal: Int,
                bossReady: Bool = false, boss: BossLineup? = nil, startedAt: Int64? = nil) {
        self.line = line; self.n = n; self.waves = waves; self.waveIndex = waveIndex; self.waveDone = waveDone; self.figuresDone = figuresDone
        self.figuresTotal = figuresTotal; self.bossReady = bossReady; self.boss = boss; self.startedAt = startedAt
    }

    enum CodingKeys: String, CodingKey { case line, n, waves, waveIndex, waveDone, figuresDone, figuresTotal, bossReady, boss, startedAt }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        line = c.string(.line, default: "main")
        n = c.int(.n, default: 1)
        waves = (try? c.decodeIfPresent([[String?]].self, forKey: .waves)) ?? []
        waveIndex = c.int(.waveIndex)
        waveDone = c.int(.waveDone)
        figuresDone = c.int(.figuresDone)
        figuresTotal = c.int(.figuresTotal)
        bossReady = c.bool(.bossReady)
        boss = c.optionalValue(BossLineup.self, .boss)
        startedAt = c.int64OrNil(.startedAt)
    }
}

public struct QuestsState: Codable, Hashable, Sendable {
    public var main: LineProgress
    public var portals: [String: LineProgress]
    public var active: ActiveQuest?
    /// Written by the removed Portal archive; kept for old saves, ignored.
    public var manualPortal: String?

    public init(main: LineProgress = LineProgress(), portals: [String: LineProgress] = [:], active: ActiveQuest? = nil, manualPortal: String? = nil) {
        self.main = main; self.portals = portals; self.active = active; self.manualPortal = manualPortal
    }

    enum CodingKeys: String, CodingKey { case main, portals, active, manualPortal }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        main = c.lenient(LineProgress.self, .main, default: LineProgress())
        portals = c.dictionary(LineProgress.self, .portals)
        active = c.optionalValue(ActiveQuest.self, .active)
        manualPortal = c.stringOrNil(.manualPortal)
    }
}

public struct SimDeckCard: Codable, Hashable, Sendable {
    public var cardId: String
    public var stage: Int
    public var level: Int
    public var evolveQuality: Double

    public init(cardId: String, stage: Int = 0, level: Int = 1, evolveQuality: Double = 1) {
        self.cardId = cardId; self.stage = stage; self.level = level; self.evolveQuality = evolveQuality
    }

    enum CodingKeys: String, CodingKey { case cardId, stage, level, evolveQuality }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        cardId = c.string(.cardId)
        stage = c.int(.stage)
        level = c.int(.level, default: 1)
        evolveQuality = c.double(.evolveQuality, default: 1)
    }
}

/// A simulated player (opponents.js SimPlayer).
public struct SimPlayer: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var avatar: Int
    public var level: Int
    public var hpMax: Int
    public var staminaMax: Int
    public var manaMax: Int
    public var questsDone: Int
    public var battlesWon: Int
    public var deck: [SimDeckCard?]
    public var bornDay: String

    public init(id: String, name: String, avatar: Int, level: Int, hpMax: Int, staminaMax: Int, manaMax: Int, questsDone: Int, battlesWon: Int,
                deck: [SimDeckCard?], bornDay: String) {
        self.id = id; self.name = name; self.avatar = avatar; self.level = level; self.hpMax = hpMax; self.staminaMax = staminaMax
        self.manaMax = manaMax; self.questsDone = questsDone; self.battlesWon = battlesWon; self.deck = deck; self.bornDay = bornDay
    }

    enum CodingKeys: String, CodingKey { case id, name, avatar, level, hpMax, staminaMax, manaMax, questsDone, battlesWon, deck, bornDay }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.string(.id)
        name = c.string(.name, default: id)
        avatar = c.int(.avatar)
        level = c.int(.level, default: 1)
        hpMax = c.int(.hpMax, default: 1500)
        staminaMax = c.int(.staminaMax, default: 50)
        manaMax = c.int(.manaMax, default: 50)
        questsDone = c.int(.questsDone)
        battlesWon = c.int(.battlesWon)
        var list = c.optionalArray(SimDeckCard.self, .deck)
        while list.count < 5 { list.append(nil) }
        deck = Array(list.prefix(5))
        bornDay = c.string(.bornDay)
    }
}

public struct ArenaOffer: Codable, Hashable, Sendable {
    public var difficulty: Difficulty
    public var color: String
    public var simId: String
    public var power: Double
    public var level: Int
    public var name: String
    public var avatar: Int

    public init(difficulty: Difficulty, color: String, simId: String, power: Double, level: Int, name: String, avatar: Int) {
        self.difficulty = difficulty; self.color = color; self.simId = simId; self.power = power; self.level = level; self.name = name; self.avatar = avatar
    }

    enum CodingKeys: String, CodingKey { case difficulty, color, simId, power, level, name, avatar }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        difficulty = c.lenient(Difficulty.self, .difficulty, default: .normal)
        color = c.string(.color, default: "yellow")
        simId = c.string(.simId)
        power = c.double(.power, default: 1)
        level = c.int(.level, default: 1)
        name = c.string(.name)
        avatar = c.int(.avatar)
    }
}

public struct ArenaState: Codable, Hashable, Sendable {
    public var offers: [ArenaOffer]
    public var rerollAt: Int64

    public init(offers: [ArenaOffer] = [], rerollAt: Int64 = 0) { self.offers = offers; self.rerollAt = rerollAt }

    enum CodingKeys: String, CodingKey { case offers, rerollAt }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        offers = c.array(ArenaOffer.self, .offers)
        rerollAt = c.int64(.rerollAt)
    }
}

/// Activity profile of a simulated player for one league (league.js simProfile).
public struct SimProfile: Codable, Hashable, Sendable {
    public var w: Int
    public var x: Int
    public var k: Double
    public var pic: Bool

    public init(w: Int, x: Int, k: Double, pic: Bool) { self.w = w; self.x = x; self.k = k; self.pic = pic }

    enum CodingKeys: String, CodingKey { case w, x, k, pic }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        w = c.int(.w)
        x = c.int(.x)
        k = c.double(.k, default: 1)
        pic = c.bool(.pic, default: true)
    }
}

/// Today's league (league.js: `state.sim.league`, version 3). Older formats carry `rates` and `v < 3`.
public struct League: Codable, Hashable, Sendable {
    public var v: Int
    public var day: String
    public var startedAt: Int64
    public var endsAt: Int64
    public var tier: LeagueTier
    public var power: Double
    public var simIds: [String]
    public var profiles: [String: SimProfile]
    public var fights: [String: Int]
    public var points: Int
    public var doublePoints: Bool
    public var settled: Bool
    /// Pre-round-3 leagues: wins-per-day rate per sim.
    public var rates: [String: Double]?

    public init(v: Int = 3, day: String, startedAt: Int64, endsAt: Int64, tier: LeagueTier, power: Double, simIds: [String],
                profiles: [String: SimProfile], fights: [String: Int] = [:], points: Int = 0, doublePoints: Bool = false, settled: Bool = false,
                rates: [String: Double]? = nil) {
        self.v = v; self.day = day; self.startedAt = startedAt; self.endsAt = endsAt; self.tier = tier; self.power = power; self.simIds = simIds
        self.profiles = profiles; self.fights = fights; self.points = points; self.doublePoints = doublePoints; self.settled = settled; self.rates = rates
    }

    enum CodingKeys: String, CodingKey { case v, day, startedAt, endsAt, tier, power, simIds, profiles, fights, points, doublePoints, settled, rates }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        v = c.int(.v, default: 1)
        day = c.string(.day)
        startedAt = c.int64(.startedAt)
        endsAt = c.int64(.endsAt)
        let tierRaw = c.string(.tier, default: "bronze")
        tier = LeagueTier(rawValue: tierRaw == "platinum" ? "gold" : tierRaw) ?? .bronze
        power = c.double(.power, default: 1)
        simIds = c.array(String.self, .simIds)
        profiles = c.dictionary(SimProfile.self, .profiles)
        fights = c.dictionary(Int.self, .fights)
        points = c.int(.points)
        doublePoints = c.bool(.doublePoints)
        settled = c.bool(.settled)
        rates = c.optionalValue([String: Double].self, .rates)
    }
}

/// Result of a settled league (league.js settleLeague `prizes`), kept in history and as the pending finish popup.
public struct LeaguePrizes: Codable, Hashable, Sendable {
    public var day: String
    public var tier: LeagueTier
    public var rank: Int
    public var ranked: Bool
    public var points: Int
    public var gems: Int
    public var potions: [PotionKind]
    public var mana: Int
    public var stamina: Int
    public var card: Rarity?
    public var cardId: String?
    public var cardPending: Bool
    public var tournamentPoints: Int
    public var nextTier: LeagueTier
    public var promoted: Bool

    public init(day: String, tier: LeagueTier, rank: Int, ranked: Bool, points: Int, gems: Int, potions: [PotionKind], mana: Int, stamina: Int,
                card: Rarity?, cardId: String?, cardPending: Bool, tournamentPoints: Int, nextTier: LeagueTier, promoted: Bool) {
        self.day = day; self.tier = tier; self.rank = rank; self.ranked = ranked; self.points = points; self.gems = gems; self.potions = potions
        self.mana = mana; self.stamina = stamina; self.card = card; self.cardId = cardId; self.cardPending = cardPending
        self.tournamentPoints = tournamentPoints; self.nextTier = nextTier; self.promoted = promoted
    }

    enum CodingKeys: String, CodingKey { case day, tier, rank, ranked, points, gems, potions, mana, stamina, card, cardId, cardPending, tournamentPoints, nextTier, promoted }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        day = c.string(.day)
        tier = c.lenient(LeagueTier.self, .tier, default: .bronze)
        rank = c.int(.rank)
        ranked = c.bool(.ranked)
        points = c.int(.points)
        gems = c.int(.gems)
        potions = c.array(PotionKind.self, .potions)
        mana = c.int(.mana)
        stamina = c.int(.stamina)
        card = c.optionalValue(Rarity.self, .card)
        cardId = c.stringOrNil(.cardId)
        cardPending = c.bool(.cardPending)
        tournamentPoints = c.int(.tournamentPoints)
        nextTier = c.lenient(LeagueTier.self, .nextTier, default: .bronze)
        promoted = c.bool(.promoted)
    }
}

public struct SimState: Codable, Hashable, Sendable {
    public var players: [SimPlayer]
    public var day: String
    public var arena: ArenaState
    public var league: League?
    public var leagueScore: Int
    public var leagueHistory: [LeaguePrizes]
    /// nil in a save from before round 3 (league.js leagueTierOf reads the old league instead).
    public var leagueTier: LeagueTier?
    /// nil in a save from before round 3 (hasJoined counts an old league as joined).
    public var leagueJoined: Bool?
    public var leaguePending: LeaguePrizes?

    public init(players: [SimPlayer] = [], day: String = "", arena: ArenaState = ArenaState(), league: League? = nil, leagueScore: Int = 0,
                leagueHistory: [LeaguePrizes] = [], leagueTier: LeagueTier? = .bronze, leagueJoined: Bool? = false, leaguePending: LeaguePrizes? = nil) {
        self.players = players; self.day = day; self.arena = arena; self.league = league; self.leagueScore = leagueScore
        self.leagueHistory = leagueHistory; self.leagueTier = leagueTier; self.leagueJoined = leagueJoined; self.leaguePending = leaguePending
    }

    enum CodingKeys: String, CodingKey { case players, day, arena, league, leagueScore, leagueHistory, leagueTier, leagueJoined, leaguePending }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        players = c.array(SimPlayer.self, .players)
        day = c.string(.day)
        arena = c.lenient(ArenaState.self, .arena, default: ArenaState())
        league = c.optionalValue(League.self, .league)
        leagueScore = c.int(.leagueScore)
        leagueHistory = c.array(LeaguePrizes.self, .leagueHistory)
        if c.has(.leagueTier) {
            let raw = c.stringOrNil(.leagueTier)
            leagueTier = raw.flatMap { LeagueTier(rawValue: $0 == "platinum" ? "gold" : $0) }
        } else {
            leagueTier = nil
        }
        leagueJoined = c.has(.leagueJoined) ? c.boolOrNil(.leagueJoined) : nil
        leaguePending = c.optionalValue(LeaguePrizes.self, .leaguePending)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(players, forKey: .players)
        try c.encode(day, forKey: .day)
        try c.encode(arena, forKey: .arena)
        try c.encode(league, forKey: .league)
        try c.encode(leagueScore, forKey: .leagueScore)
        try c.encode(leagueHistory, forKey: .leagueHistory)
        try c.encode(leagueTier, forKey: .leagueTier)
        try c.encode(leagueJoined, forKey: .leagueJoined)
        try c.encode(leaguePending, forKey: .leaguePending)
    }
}

public struct DailyState: Codable, Hashable, Sendable {
    public var streak: Int
    public var lastClaim: String
    public var potionDealDay: String
    /// Days skipped through the debug `addDays` (the daily event follows the shifted clock).
    public var dayShift: Int?

    public init(streak: Int = 0, lastClaim: String = "", potionDealDay: String = "", dayShift: Int? = nil) {
        self.streak = streak; self.lastClaim = lastClaim; self.potionDealDay = potionDealDay; self.dayShift = dayShift
    }

    enum CodingKeys: String, CodingKey { case streak, lastClaim, potionDealDay, dayShift }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        streak = c.int(.streak)
        lastClaim = c.string(.lastClaim)
        potionDealDay = c.string(.potionDealDay)
        dayShift = c.intOrNil(.dayShift)
    }
}

public struct CollectionsState: Codable, Hashable, Sendable {
    public var claimed: [String]
    /// Card ids the album has shown (nil in a save from before round 5 → `migrated` fills it with every owned card).
    public var seen: [String]?

    public init(claimed: [String] = [], seen: [String]? = []) { self.claimed = claimed; self.seen = seen }

    enum CodingKeys: String, CodingKey { case claimed, seen }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        claimed = c.array(String.self, .claimed)
        seen = c.optionalValue([String].self, .seen)
    }
}

/// An open booster (shop.js getBooster), keyed in `state.boosters` by `boosterKey`.
public struct Booster: Codable, Hashable, Sendable {
    public var id: TokenKind
    public var portalId: String?
    /// Nine card ids by grid position (row by row).
    public var cards: [String]
    /// Drawn grid positions.
    public var drawn: [Int]
    public var opened: Bool
    public var seq: Int

    public init(id: TokenKind, portalId: String?, cards: [String], drawn: [Int] = [], opened: Bool = false, seq: Int = 1) {
        self.id = id; self.portalId = portalId; self.cards = cards; self.drawn = drawn; self.opened = opened; self.seq = seq
    }

    enum CodingKeys: String, CodingKey { case id, portalId, cards, drawn, opened, seq }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lenient(TokenKind.self, .id, default: .neophyte)
        portalId = c.stringOrNil(.portalId)
        cards = c.array(String.self, .cards)
        drawn = c.array(Int.self, .drawn)
        opened = c.bool(.opened)
        seq = c.int(.seq, default: 1)
    }
}

public struct ReplayCard: Codable, Hashable, Sendable {
    public var cardId: String
    public var stage: Int
    public var level: Int
    public init(cardId: String, stage: Int, level: Int) { self.cardId = cardId; self.stage = stage; self.level = level }

    enum CodingKeys: String, CodingKey { case cardId, stage, level }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        cardId = c.string(.cardId)
        stage = c.int(.stage)
        level = c.int(.level, default: 1)
    }
}

public struct ReplaySide: Codable, Hashable, Sendable {
    public var name: String
    public var maxHp: Int
    public var avatar: Int
    public var cards: [ReplayCard?]

    public init(name: String, maxHp: Int, avatar: Int, cards: [ReplayCard?]) { self.name = name; self.maxHp = maxHp; self.avatar = avatar; self.cards = cards }

    enum CodingKeys: String, CodingKey { case name, maxHp, avatar, cards }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = c.string(.name)
        maxHp = c.int(.maxHp, default: 1500)
        avatar = c.int(.avatar)
        var list = c.optionalArray(ReplayCard.self, .cards)
        while list.count < 5 { list.append(nil) }
        cards = Array(list.prefix(5))
    }
}

/// A recorded fight (pvp.js recordReplay): seed + line-ups reproduce it exactly.
public struct Replay: Codable, Hashable, Sendable {
    public var seed: UInt32
    public var at: Int64
    public var mode: String
    public var won: Bool
    public var attacker: ReplaySide
    public var defender: ReplaySide
    public var result: BattleResult

    public init(seed: UInt32, at: Int64, mode: String, won: Bool, attacker: ReplaySide, defender: ReplaySide, result: BattleResult) {
        self.seed = seed; self.at = at; self.mode = mode; self.won = won; self.attacker = attacker; self.defender = defender; self.result = result
    }

    enum CodingKeys: String, CodingKey { case seed, at, mode, won, attacker, defender, result }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        seed = c.uint32(.seed)
        at = c.int64(.at)
        mode = c.string(.mode, default: "arena")
        won = c.bool(.won)
        attacker = try c.decode(ReplaySide.self, forKey: .attacker)
        defender = try c.decode(ReplaySide.self, forKey: .defender)
        result = try c.decode(BattleResult.self, forKey: .result)
    }
}

public struct Settings: Codable, Hashable, Sendable {
    public var sound: Bool
    public var musicVolume: Double
    public var fxVolume: Double
    /// Battle playback speed (1 or 2).
    public var speed: Int
    public var raids: Bool
    public var reducedMotion: Bool

    public init(sound: Bool = true, musicVolume: Double = 0.7, fxVolume: Double = 1, speed: Int = 1, raids: Bool = true, reducedMotion: Bool = false) {
        self.sound = sound; self.musicVolume = musicVolume; self.fxVolume = fxVolume; self.speed = speed; self.raids = raids; self.reducedMotion = reducedMotion
    }

    enum CodingKeys: String, CodingKey { case sound, musicVolume, fxVolume, speed, raids, reducedMotion }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        sound = c.bool(.sound, default: true)
        musicVolume = c.double(.musicVolume, default: 0.7)
        fxVolume = c.double(.fxVolume, default: 1)
        speed = c.int(.speed, default: 1)
        raids = c.bool(.raids, default: true)
        reducedMotion = c.bool(.reducedMotion)
    }
}

/// The first-session tutorial record (tutorial/progress.js: `state.tutorial.r3`).
public struct TutorialRecord: Codable, Hashable, Sendable {
    public var intro: Bool
    public var lost: [Int]
    public var seen: [String]
    public var named: Bool
    public var done: Bool
    public var legacy: Bool?

    public init(intro: Bool = true, lost: [Int] = [], seen: [String] = [], named: Bool = false, done: Bool = false, legacy: Bool? = nil) {
        self.intro = intro; self.lost = lost; self.seen = seen; self.named = named; self.done = done; self.legacy = legacy
    }

    enum CodingKeys: String, CodingKey { case intro, lost, seen, named, done, legacy }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        intro = c.bool(.intro, default: true)
        lost = c.array(Int.self, .lost)
        seen = c.array(String.self, .seen)
        named = c.bool(.named)
        done = c.bool(.done)
        legacy = c.boolOrNil(.legacy)
    }

    /// The record a game without a tutorial run counts as (DONE_RECORD).
    public static let finished = TutorialRecord(intro: true, lost: [], seen: [], named: true, done: true, legacy: true)
    /// A new iOS game: quest-based unlocks and the name prompt, no scripted lessons (docs/PLAN.md §1).
    public static let newGame = TutorialRecord(intro: true, lost: [], seen: [], named: false, done: true)
}

public struct TutorialState: Codable, Hashable, Sendable {
    public var step: Int
    /// Unlock popups already shown (feature ids, cardslot3..5).
    public var seen: [String]
    public var r3: TutorialRecord?

    public init(step: Int = 0, seen: [String] = [], r3: TutorialRecord? = nil) { self.step = step; self.seen = seen; self.r3 = r3 }

    enum CodingKeys: String, CodingKey { case step, seen, r3 }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        step = c.int(.step)
        seen = c.array(String.self, .seen)
        r3 = c.optionalValue(TutorialRecord.self, .r3)
    }
}

/// A login notice (`{type: 'daily'|'league'|'raid', ...}`), free-form like the web's.
public struct Notice: Codable, Hashable, Sendable {
    public var fields: [String: JSONValue]

    public init(_ fields: [String: JSONValue]) { self.fields = fields }

    public init(type: String, _ extra: [String: JSONValue] = [:]) {
        var f = extra
        f["type"] = .string(type)
        self.fields = f
    }

    public var type: String { fields["type"]?.stringValue ?? "" }
    public subscript(key: String) -> JSONValue? { fields[key] }

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        fields = (try? c.decode([String: JSONValue].self)) ?? [:]
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(fields)
    }
}

/// The whole save.
public struct GameState: Codable, Hashable, Sendable {
    public static let saveVersion = 1
    public static let saveKey = "evoker.save.v1"

    public var version: Int
    public var createdAt: Int64
    public var lastSeen: Int64
    public var seed: UInt32
    public var rngStep: Int
    public var uidCounter: Int
    public var player: PlayerState
    public var cards: [CardInstance]
    /// uids by deck slot (5 entries).
    public var deck: [String?]
    public var pieces: [PieceHunt]
    public var quests: QuestsState
    public var sim: SimState
    public var daily: DailyState
    public var collections: CollectionsState
    /// Open boosters by `boosterKey` ("neophyte", "portalHigh@the-dark-beyond").
    public var boosters: [String: Booster]
    public var replays: [Replay]
    public var settings: Settings
    public var tutorial: TutorialState
    public var notices: [Notice]
    /// Unknown top-level keys of an imported save, kept through a round trip (deepDefaults keeps extra keys).
    public var extras: [String: JSONValue]

    public init(version: Int = GameState.saveVersion, createdAt: Int64, lastSeen: Int64, seed: UInt32, rngStep: Int = 0, uidCounter: Int = 0,
                player: PlayerState = PlayerState(), cards: [CardInstance] = [], deck: [String?] = [nil, nil, nil, nil, nil], pieces: [PieceHunt] = [],
                quests: QuestsState = QuestsState(), sim: SimState = SimState(), daily: DailyState = DailyState(),
                collections: CollectionsState = CollectionsState(), boosters: [String: Booster] = [:], replays: [Replay] = [],
                settings: Settings = Settings(), tutorial: TutorialState = TutorialState(), notices: [Notice] = [], extras: [String: JSONValue] = [:]) {
        self.version = version; self.createdAt = createdAt; self.lastSeen = lastSeen; self.seed = seed; self.rngStep = rngStep
        self.uidCounter = uidCounter; self.player = player; self.cards = cards; self.deck = deck; self.pieces = pieces; self.quests = quests
        self.sim = sim; self.daily = daily; self.collections = collections; self.boosters = boosters; self.replays = replays
        self.settings = settings; self.tutorial = tutorial; self.notices = notices; self.extras = extras
    }

    enum CodingKeys: String, CodingKey {
        case version, createdAt, lastSeen, seed, rngStep, uidCounter, player, cards, deck, pieces, quests, sim, daily, collections,
             boosters, replays, settings, tutorial, notices
    }

    private struct AnyKey: CodingKey {
        var stringValue: String
        var intValue: Int? { nil }
        init(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { return nil }
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = c.int(.version, default: GameState.saveVersion)
        createdAt = c.int64(.createdAt)
        lastSeen = c.int64(.lastSeen)
        seed = c.has(.seed) ? c.uint32(.seed, default: 1) : 1
        rngStep = c.int(.rngStep)
        uidCounter = c.int(.uidCounter)
        player = c.lenient(PlayerState.self, .player, default: PlayerState())
        cards = c.array(CardInstance.self, .cards)
        var d = c.optionalArray(String.self, .deck)
        if d.count != 5 { d = [nil, nil, nil, nil, nil] }
        deck = d
        pieces = c.array(PieceHunt.self, .pieces)
        quests = c.lenient(QuestsState.self, .quests, default: QuestsState())
        sim = c.lenient(SimState.self, .sim, default: SimState())
        daily = c.lenient(DailyState.self, .daily, default: DailyState())
        collections = c.lenient(CollectionsState.self, .collections, default: CollectionsState())
        boosters = c.dictionary(Booster.self, .boosters)
        replays = c.array(Replay.self, .replays)
        settings = c.lenient(Settings.self, .settings, default: Settings())
        tutorial = c.lenient(TutorialState.self, .tutorial, default: TutorialState())
        notices = c.array(Notice.self, .notices)
        // unknown top-level keys survive a round trip
        var extra: [String: JSONValue] = [:]
        let known = Set(CodingKeys.allCases.map { $0.stringValue })
        if let any = try? decoder.container(keyedBy: AnyKey.self) {
            for key in any.allKeys where !known.contains(key.stringValue) {
                if let v = try? any.decode(JSONValue.self, forKey: key) { extra[key.stringValue] = v }
            }
        }
        extras = extra
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(version, forKey: .version)
        try c.encode(createdAt, forKey: .createdAt)
        try c.encode(lastSeen, forKey: .lastSeen)
        try c.encode(seed, forKey: .seed)
        try c.encode(rngStep, forKey: .rngStep)
        try c.encode(uidCounter, forKey: .uidCounter)
        try c.encode(player, forKey: .player)
        try c.encode(cards, forKey: .cards)
        try c.encode(deck, forKey: .deck)
        try c.encode(pieces, forKey: .pieces)
        try c.encode(quests, forKey: .quests)
        try c.encode(sim, forKey: .sim)
        try c.encode(daily, forKey: .daily)
        try c.encode(collections, forKey: .collections)
        try c.encode(boosters, forKey: .boosters)
        try c.encode(replays, forKey: .replays)
        try c.encode(settings, forKey: .settings)
        try c.encode(tutorial, forKey: .tutorial)
        try c.encode(notices, forKey: .notices)
        if !extras.isEmpty {
            var any = encoder.container(keyedBy: AnyKey.self)
            for (k, v) in extras { try any.encode(v, forKey: AnyKey(stringValue: k)) }
        }
    }
}

extension GameState.CodingKeys: CaseIterable {}
