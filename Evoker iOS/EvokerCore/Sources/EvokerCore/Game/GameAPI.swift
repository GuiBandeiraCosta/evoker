import Foundation

// The game layer API: one `enum` namespace per web module of `Evoker Web/src/game`, same function names, pure
// `(state, deps, now, args) -> (state, info)` functions. The bodies below are placeholders that the game-logic
// port replaces module by module (one Swift file per module); the SIGNATURES are the contract the screens and
// the persistence layer code against and must not change without a note in docs/PLAN.md.

private func notPorted(_ what: String = #function) -> Never {
    fatalError("EvokerCore: \(what) is not ported yet")
}

// MARK: - state.js

public enum StateOps {
    public static let saveVersion = GameState.saveVersion
    public static let saveKey = GameState.saveKey
    public static let startDeckSlots = Constants.DeckSlots.start

    /// The empty save with every default filled in (`defaultState`).
    public static func defaultState(now: Int64, seed: UInt32) -> GameState { notPorted() }
    /// A brand-new save with the starter collection and deck (`newGame`). The iOS game starts with the
    /// `TutorialRecord.newGame` record (quest-based unlocks, name prompt at the first Arena visit).
    public static func newGame(name: String, seed: UInt32, now: Int64, deps: Deps?) -> GameState { notPorted() }
    /// Open-slot count a save written before round 3 gets (`legacyDeckSlots`), from the raw save JSON.
    public static func legacyDeckSlots(rawSave: JSONValue) -> Int { notPorted() }
    /// Open-slot count earned by main-quest first wins (`slotsForQuestWins`).
    public static func slotsForQuestWins(_ firstWins: [Int]) -> Int { notPorted() }
    /// The remaining migration rules after lenient decoding (`migrate`): version, audio defaults for saves without
    /// volume fields, deck length, legacy league flags, legacy deck slots, card defaults, album seen list, uidCounter.
    /// `rawJSON` is the save as parsed (nil when the state did not come from JSON).
    public static func migrated(_ decoded: GameState, rawJSON: JSONValue?, now: Int64) -> GameState { notPorted() }
    /// Drop what a save refers to that the game no longer has (`pruneRemoved`).
    public static func pruneRemoved(_ state: GameState, deps: Deps) -> GameState { notPorted() }
    /// Allocate the next card uid ("c<n>").
    public static func nextUid(_ state: GameState) -> (state: GameState, uid: String) { notPorted() }
    /// Draw a fresh seeded generator from the save and advance its counter (`takeRng`).
    public static func takeRng(_ state: GameState, deps: Deps) -> (state: GameState, rng: RandomSource, seed: UInt32) { notPorted() }
    public static func getCard(_ state: GameState, uid: String) -> CardInstance? { notPorted() }
    /// Card instances in deck order (nil for empty slots).
    public static func deckCards(_ state: GameState) -> [CardInstance?] { notPorted() }
    /// Sum of mana costs of the cards in the deck.
    public static func deckMana(_ state: GameState, deps: Deps) -> Int { notPorted() }
    /// Number of open deck slots (1..5).
    public static func deckSlotCount(_ state: GameState) -> Int { notPorted() }
    /// Is a deck slot (0..4) open?
    public static func slotUnlocked(_ state: GameState, slot: Int) -> Bool { notPorted() }
    /// Open deck slots after a quest win (`unlockSlotsForQuest`); `slots` = the new count when one opened.
    public static func unlockSlotsForQuest(_ state: GameState, lineId: String, n: Int) -> (state: GameState, slots: Int?) { notPorted() }
    /// Is a feature available? (`isUnlocked`; deck slots: `isCardSlotUnlocked`).
    public static func isUnlocked(_ state: GameState, _ feature: Feature) -> Bool { notPorted() }
    /// `isUnlocked(state, 'cardslotN')`, N 1-based.
    public static func isCardSlotUnlocked(_ state: GameState, slotNumber: Int) -> Bool { notPorted() }
    /// Does this save open its features by main-quest wins (a tutorial record exists)?
    public static func unlocksByQuest(_ state: GameState) -> Bool { notPorted() }
    /// Is the first-session tutorial still running on this save?
    public static func inTutorial(_ state: GameState) -> Bool { notPorted() }
    /// Features whose "… Unlocked!" popup belongs to a level-up (`featuresUnlockedAt`).
    public static func featuresUnlockedAt(level: Int, state: GameState?) -> [Feature] { notPorted() }
    public static func addNotice(_ state: GameState, _ notice: Notice) -> GameState { notPorted() }
    public static func touch(_ state: GameState, now: Int64) -> GameState { notPorted() }
}

// MARK: - player.js

public enum PlayerOps {
    public static let maxLevel = Constants.maxPlayerLevel
    public static let statPointsPerLevel = Constants.statPointsPerLevel
    public static let hpPerPoint = Constants.statPointValue.hp
    public static let staminaPerPoint = Constants.statPointValue.stamina
    public static let manaPerPoint = Constants.statPointValue.mana
    public static let regenMs = Constants.regenIntervalMs
    public static let questBossPlayerXp = Constants.BattleXp.player.questBoss

    /// Regenerate 1 stamina and 1 mana per full real minute since `regenAt`, up to the max.
    public static func applyRegen(_ state: GameState, now: Int64) -> GameState { notPorted() }
    /// Player xp of one PvP fight: round((1.5 + 0.5 × level) × (4 on a win)).
    public static func playerFightXp(opponentLevel: Int, won: Bool) -> Int { notPorted() }
    /// Card xp per deck card for one fight: round((10 + enemyMana / 2) × 1.5 on a win × 2 on Infinite Wisdom).
    public static func cardFightXp(enemyDeckMana: Int, won: Bool, infiniteWisdom: Bool) -> Int { notPorted() }
    /// Rewards of reaching `level`.
    public static func levelUpRewards(level: Int) -> LevelUpRewards { notPorted() }
    /// Add player xp and apply every level-up.
    public static func addPlayerXp(_ state: GameState, deps: Deps, amount: Int) -> (state: GameState, info: XpResult) { notPorted() }
    public static func previewStatPoints(_ state: GameState, alloc: StatAlloc) -> StatPointsPreview { notPorted() }
    /// Spend unspent stat points; throws "Not enough stat points".
    public static func spendStatPoints(_ state: GameState, alloc: StatAlloc) throws -> GameState { notPorted() }
    /// The clock the daily event follows (shifted by `daily.dayShift` days).
    public static func eventClock(_ state: GameState?, now: Int64) -> Int64 { notPorted() }
    /// Golden Day: +50 % gold.
    public static func goldWithEvent(_ gold: Int, event: DailyEventId?) -> Int { notPorted() }
    public static func potionPrice(event: DailyEventId?) -> Int { notPorted() }
    public static func needsPotion(_ state: GameState, kind: PotionKind, amount: Int, event: DailyEventId?) -> NeedsPotion { notPorted() }
    public static func drinkPotion(_ state: GameState, kind: PotionKind) throws -> GameState { notPorted() }
    public static func buyAndDrinkPotion(_ state: GameState, kind: PotionKind, event: DailyEventId?) throws -> GameState { notPorted() }
    public static func addPotions(_ state: GameState, kind: PotionKind, count: Int) -> GameState { notPorted() }
    public static func spendStamina(_ state: GameState, amount: Int) throws -> GameState { notPorted() }
    public static func spendMana(_ state: GameState, amount: Int) throws -> GameState { notPorted() }
    public static func addGold(_ state: GameState, amount: Int) -> GameState { notPorted() }
    public static func spendGold(_ state: GameState, amount: Int) throws -> GameState { notPorted() }
    public static func addGems(_ state: GameState, amount: Int) -> GameState { notPorted() }
    public static func spendGems(_ state: GameState, amount: Int) throws -> GameState { notPorted() }
    public static func addTokens(_ state: GameState, kind: TokenKind, count: Int, portalId: String?) -> GameState { notPorted() }
    public static func tokenCount(_ state: GameState, kind: TokenKind, portalId: String?) -> Int { notPorted() }
    /// Change the player's name (trimmed, max 20) and/or avatar (0..11).
    public static func editProfile(_ state: GameState, name: String?, avatar: Int?) -> GameState { notPorted() }
}

// MARK: - collection.js

public enum CardSortOrder: String, Codable, Sendable, Hashable {
    case `default`, level, mana, name, rarity, attack
}

public enum CollectionOps {
    public static let collectionLimit = Constants.collectionLimit

    public static func capFor(deps: Deps, def: CardDef, stage: Int) -> Int { notPorted() }
    /// Add a card instance; at or over the inventory size it is sold automatically unless `force`.
    public static func addCard(_ state: GameState, deps: Deps, cardId: String, stage: Int = 0, level: Int = 1, evolveQuality: Double? = nil, force: Bool = false) throws -> (state: GameState, info: AddCardResult) { notPorted() }
    /// Card definitions of a rarity, optionally restricted to a set of ids; never trainers.
    public static func cardsOfRarity(_ db: CardsDb, rarity: Rarity, setIds: [String]?) -> [CardDef] { notPorted() }
    public static func removeCard(_ state: GameState, uid: String) -> GameState { notPorted() }
    public static func isInDeck(_ state: GameState, uid: String) -> Bool { notPorted() }
    public static func sellValueOf(_ state: GameState, deps: Deps, uid: String) -> Int { notPorted() }
    public static func sellCard(_ state: GameState, deps: Deps, uid: String) throws -> (state: GameState, gold: Int) { notPorted() }
    /// Sort instances: default order is level desc, mana desc, name asc.
    public static func sortCards(_ cards: [CardInstance], db: CardsDb, order: CardSortOrder = .default, stats: StatsProviding? = nil) -> [CardInstance] { notPorted() }
    public static func bestCard(_ state: GameState, deps: Deps) -> CardInstance? { notPorted() }
    public static func placeInDeck(_ state: GameState, deps: Deps, uid: String, slot: Int) throws -> (state: GameState, mana: Int) { notPorted() }
    public static func removeFromDeck(_ state: GameState, slot: Int) -> GameState { notPorted() }
    public static func setDeck(_ state: GameState, deps: Deps, slots: [String?]) throws -> (state: GameState, mana: Int) { notPorted() }
    public static func validateDeck(_ state: GameState, deps: Deps) -> DeckValidation { notPorted() }
    public static func addCardXp(_ state: GameState, deps: Deps, uid: String, xp: Int) -> (state: GameState, levelUps: [CardLevelUp], capped: Bool) { notPorted() }
    public static func addDeckXp(_ state: GameState, deps: Deps, xp: Int) -> (state: GameState, levelUps: [CardLevelUp]) { notPorted() }
}

// MARK: - training.js

public enum TrainingOps {
    public static let maxSacrifices = Constants.maxSacrificeCards
    public static let trainerXp = Constants.trainerXp

    public static func sacrificeValue(deps: Deps, inst: CardInstance) -> Int { notPorted() }
    public static func sacrificePrice(deps: Deps, inst: CardInstance) -> Int { notPorted() }
    public static func trainingCost(deps: Deps, insts: [CardInstance]) -> Int { notPorted() }
    public static func previewTraining(_ state: GameState, deps: Deps, trainUid: String, sacrificeUids: [String], allowDeck: Bool = false) -> TrainingPreview { notPorted() }
    public static func train(_ state: GameState, deps: Deps, trainUid: String, sacrificeUids: [String], allowDeck: Bool = false) throws -> (state: GameState, info: TrainingResult) { notPorted() }
}

// MARK: - fusion.js

public enum FusionOps {
    public static let maxStage = Constants.maxStage

    public static func canFuse(_ state: GameState, deps: Deps, uidA: String, uidB: String, allowDeck: Bool = false) -> FusionCheck { notPorted() }
    public static func fuse(_ state: GameState, deps: Deps, uidA: String, uidB: String, allowDeck: Bool = false) throws -> (state: GameState, info: FusionResult) { notPorted() }
    public static func fusionCandidates(_ state: GameState, deps: Deps) -> [FusionCandidate] { notPorted() }
}

// MARK: - quests.js

public enum QuestOps {
    public static let minWaves = 2
    public static let maxWaves = 5
    public static let minWaveSize = 2

    public static func questLine(deps: Deps, lineId: String) -> QuestLine? { notPorted() }
    public static func getQuest(deps: Deps, lineId: String, n: Int) -> QuestNode? { notPorted() }
    public static func lineProgress(_ state: GameState, lineId: String) -> LineProgress { notPorted() }
    public static func questStatus(_ state: GameState, lineId: String, n: Int) -> QuestStatus { notPorted() }
    /// Which portal is open by the 7-day rotation that starts at the save's creation.
    public static func portalSchedule(deps: Deps, createdAt: Int64, now: Int64) -> PortalSchedule? { notPorted() }
    /// Band position (0..1) of a quest inside its quality band.
    public static func bandPosition(lineId: String, n: Int) -> Double { notPorted() }
    public static func generateWaves(rng: RandomSource, deps: Deps, quest: QuestNode) -> [[String?]] { notPorted() }
    public static func startQuest(_ state: GameState, deps: Deps, now: Int64, line: String, n: Int) throws -> (state: GameState, active: ActiveQuest) { notPorted() }
    public static func leaveQuest(_ state: GameState) -> GameState { notPorted() }
    public static func questProgressPct(_ active: ActiveQuest?) -> Int { notPorted() }
    public static func questTapInfo(_ quest: QuestNode) -> QuestTapInfo { notPorted() }
    /// Tap the next minion.
    public static func tapMinion(_ state: GameState, deps: Deps, now: Int64, event: DailyEventId?) throws -> (state: GameState, info: TapResult) { notPorted() }
    public static func soulDrop(_ state: GameState, deps: Deps, quest: QuestNode, figuresDone: Int) throws -> (state: GameState, reward: Reward?) { notPorted() }
    public static func bossLineup(quest: QuestNode, rng: RandomSource, db: CardsDb, stats: StatsProviding, lineId: String = "main") -> BossLineup { notPorted() }
    public static func prepareBoss(_ state: GameState, deps: Deps, now: Int64) throws -> (state: GameState, lineup: BossLineup, quest: QuestNode) { notPorted() }
    public static func bossBattleConfig(_ state: GameState, deps: Deps, lineup: BossLineup, seed: UInt32) -> BattleConfig { notPorted() }
    /// Run the boss fight of the active quest and resolve it (`battle`, `lineup`, `seed` filled).
    public static func fightBoss(_ state: GameState, deps: Deps, now: Int64, event: DailyEventId?) throws -> (state: GameState, info: BossResult) { notPorted() }
    public static func resolveBoss(_ state: GameState, deps: Deps, now: Int64, result: BattleResult, lineup: BossLineup?, event: DailyEventId?) throws -> (state: GameState, info: BossResult) { notPorted() }
    public static func mapNodes(_ state: GameState, deps: Deps, lineId: String) -> [MapNode] { notPorted() }
    /// The ranger's line on the main quest map during the first session, or nil.
    public static func guideLine(_ state: GameState, lastLoss: Bool = false) -> String? { notPorted() }
}

// MARK: - rewards.js

public enum RewardOps {
    public static let maxWaveSize = 4

    public static func pickBandCard(rng: RandomSource, db: CardsDb, band: QuestBand) -> CardDef? { notPorted() }
    public static func rollTapGold(rng: RandomSource, quest: QuestNode, last: Bool = false, event: DailyEventId? = nil) -> TapGold { notPorted() }
    public static func rollWaveReward(rng: RandomSource, deps: Deps, quest: QuestNode) -> Reward { notPorted() }
    public static func pieceCandidates(deps: Deps, line: QuestLine, rarity: Rarity) -> [String] { notPorted() }
    public static func rollBossReward(rng: RandomSource, deps: Deps, line: QuestLine, quest: QuestNode, firstWin: Bool, event: DailyEventId?) -> Reward { notPorted() }
    /// Apply a reward to the save; the returned reward is annotated (uid, converted, gold, hunt…).
    public static func applyReward(_ state: GameState, deps: Deps, now: Int64, reward: Reward?) throws -> (state: GameState, reward: Reward) { notPorted() }
    public static func describeReward(_ reward: Reward?, db: CardsDb?) -> String { notPorted() }
}

// MARK: - opponents.js

public struct SimStatsMax: Hashable, Sendable {
    public var hpMax: Int
    public var staminaMax: Int
    public var manaMax: Int
    public init(hpMax: Int, staminaMax: Int, manaMax: Int) { self.hpMax = hpMax; self.staminaMax = staminaMax; self.manaMax = manaMax }
}

public enum OpponentOps {
    public static let poolSize = Constants.ArenaRules.simulatedPlayers
    public static let dailyLevelChance = 0.3
    public static let staleLevelGap = 5
    /// The tutorial's scripted piece holder "Baltasar".
    public static var tutorialHolder: SimPlayer { notPorted() }

    public static func raritiesForLevel(_ level: Int) -> [Rarity] { notPorted() }
    public static func stageForLevel(_ effLevel: Int) -> Int { notPorted() }
    public static func slotsForLevel(_ level: Int) -> [Int] { notPorted() }
    public static func simCardLevel(level: Int, power: Double, cap: Int) -> Int { notPorted() }
    public static func simStats(level: Int) -> SimStatsMax { notPorted() }
    public static func buildSimDeck(rng: RandomSource, deps: Deps, level: Int, power: Double = 1) -> [SimDeckCard?] { notPorted() }
    public static func makeSim(rng: RandomSource, deps: Deps, id: String, level: Int, day: String, name: String) -> SimPlayer { notPorted() }
    public static func generatePool(_ state: GameState, deps: Deps, now: Int64) -> GameState { notPorted() }
    public static func ensurePool(_ state: GameState, deps: Deps, now: Int64) -> (state: GameState, refreshed: Bool) { notPorted() }
    public static func getSim(_ state: GameState, simId: String) -> SimPlayer? { notPorted() }
    public static func pickSims(_ state: GameState, rng: RandomSource, count: Int, min: Int, max: Int, exclude: [String] = []) -> [SimPlayer] { notPorted() }
    public static func simInfo(_ sim: SimPlayer, deps: Deps) -> SimInfo { notPorted() }
    public static func simDeckMana(_ sim: SimPlayer, deps: Deps) -> Int { notPorted() }
    /// The `computeStats` callback backed by `deps.stats.statAt` (hp at least 1).
    public static func statsAdapter(deps: Deps) -> ComputeStats { notPorted() }
    public static func sideOptions(deps: Deps) -> SideOptions { notPorted() }
    /// The human player's fighter side from the current deck.
    public static func buildPlayerSide(_ state: GameState, deps: Deps) -> FighterSide { notPorted() }
    public static func scaledSimDeck(_ sim: SimPlayer, deps: Deps, power: Double) -> [CardRef?] { notPorted() }
    public static func buildSimSide(_ sim: SimPlayer, deps: Deps, power: Double = 1) -> FighterSide { notPorted() }
    public static func pvpManaCost(_ state: GameState, deps: Deps) -> Int { notPorted() }
    /// Fisher–Yates with the seeded rng.
    public static func shuffle<T>(rng: RandomSource, _ arr: [T]) -> [T] { notPorted() }
}

// MARK: - pvp.js

public enum PvpOps {
    public static let tpPerWin = Constants.ArenaRules.tournamentPointsPerWin
    public static let maxReplays = Constants.ArenaRules.replaysKept

    public static func canFightPvp(_ state: GameState, deps: Deps) -> CanFight { notPorted() }
    public static func recordReplay(_ state: GameState, _ replay: Replay) -> GameState { notPorted() }
    public static func runPvpFight(_ state: GameState, deps: Deps, now: Int64, sim: SimPlayer, power: Double = 1, event: DailyEventId?, mode: FightMode) throws -> (state: GameState, info: PvpFightResult) { notPorted() }
}

// MARK: - arena.js

public enum ArenaOps {
    public static let offerRotationMs: Int64 = Int64(Constants.ArenaRules.offerRotationMinutes) * 60 * 1000

    public static func ensureOffers(_ state: GameState, deps: Deps, now: Int64) -> (state: GameState, info: ArenaOffers) { notPorted() }
    public static func rollOffers(_ state: GameState, deps: Deps, now: Int64) -> GameState { notPorted() }
    public static func fightArena(_ state: GameState, deps: Deps, now: Int64, offerIndex: Int, event: DailyEventId?) throws -> (state: GameState, info: ArenaResult) { notPorted() }
    public static func offerInfo(_ state: GameState, deps: Deps, offerIndex: Int) -> SimInfo? { notPorted() }
}

// MARK: - pieces.js

public enum PieceOps {
    public static let maxHunts = Constants.pieceHuntSlots
    public static let skipGems = 10
    public static let tutorialPiece = "club-swinger"

    public static func isTutorialHunt(_ state: GameState, hunt: PieceHunt?) -> Bool { notPorted() }
    public static func piecesTotal(deps: Deps, cardId: String) -> Int { notPorted() }
    public static func missingPrice(rarity: Rarity?, missing: Int, event: DailyEventId?) -> Int { notPorted() }
    public static func huntIndex(_ state: GameState, cardId: String) -> Int { notPorted() }
    public static func completeHunt(_ state: GameState, deps: Deps, index: Int) throws -> (state: GameState, uid: String, cardId: String) { notPorted() }
    public static func addPiece(_ state: GameState, deps: Deps, now: Int64, cardId: String) throws -> (state: GameState, info: AddPieceResult) { notPorted() }
    public static func assignHolder(_ state: GameState, deps: Deps, now: Int64, index: Int) -> GameState { notPorted() }
    public static func skipHolder(_ state: GameState, deps: Deps, now: Int64, index: Int) throws -> GameState { notPorted() }
    public static func huntHolder(_ state: GameState, deps: Deps, now: Int64, index: Int) -> (state: GameState, holder: SimInfo?) { notPorted() }
    public static func fightHolder(_ state: GameState, deps: Deps, now: Int64, index: Int, event: DailyEventId?) throws -> (state: GameState, info: PiecesFightResult) { notPorted() }
    public static func buyMissingPieces(_ state: GameState, deps: Deps, now: Int64, index: Int, event: DailyEventId?) throws -> (state: GameState, info: BuyPiecesResult) { notPorted() }
    public static func huntBuyPrice(_ state: GameState, deps: Deps, index: Int, event: DailyEventId?) -> Int { notPorted() }
    public static func buyFirstPiece(_ state: GameState, deps: Deps, now: Int64, event: DailyEventId?) throws -> (state: GameState, info: BuyFirstPieceResult) { notPorted() }
    public static func dailyRaids(_ state: GameState, deps: Deps, now: Int64) -> (state: GameState, stolen: [String]) { notPorted() }
}

// MARK: - league.js

public struct PrizeTableRow: Hashable, Sendable {
    public var rank: String
    public var text: String
    public init(rank: String, text: String) { self.rank = rank; self.text = text }
}

public struct PrizeTable: Sendable {
    public var tier: Constants.LeagueTierDef
    public var rows: [PrizeTableRow]
    public init(tier: Constants.LeagueTierDef, rows: [PrizeTableRow]) { self.tier = tier; self.rows = rows }
}

public enum LeagueOps {
    public static let leagueSize = Constants.LeagueRules.players
    public static let simCount = Constants.LeagueRules.players - 1
    public static let pointsPerWin = Constants.LeagueRules.pointsPerWin
    public static let maxFightsPerOpponent = Constants.LeagueRules.maxFightsPerOpponent
    public static let promoteTop = Constants.LeagueRules.promote
    public static let leagueVersion = 3
    public static let tierColors = Constants.LeagueRules.tierColors
    public static let rulesText = Constants.LeagueRules.rulesText

    /// Tier definition for a tier id ('platinum' maps to Gold; unknown → Bronze).
    public static func tierById(_ tierId: String?) -> Constants.LeagueTierDef { notPorted() }
    public static func tierDef(_ tier: LeagueTier) -> Constants.LeagueTierDef { notPorted() }
    public static func nextTier(_ tier: LeagueTier, rank: Int?, points: Int) -> LeagueTier { notPorted() }
    public static func leagueTierOf(_ state: GameState) -> LeagueTier { notPorted() }
    public static func hasJoined(_ state: GameState) -> Bool { notPorted() }
    public static func joinLeague(_ state: GameState) -> GameState { notPorted() }
    public static func prizeBand(_ tier: LeagueTier, rank: Int?) -> Constants.PrizeBand? { notPorted() }
    public static func prizeItems(_ tier: LeagueTier, rank: Int?) -> [PrizeItem] { notPorted() }
    public static func prizeText(_ band: Constants.PrizeBand) -> String { notPorted() }
    /// Rows of the PRIZES screen, Gold first.
    public static func prizeTables() -> [PrizeTable] { notPorted() }
    public static func simProfile(rng: RandomSource, tier: Constants.LeagueTierDef) -> SimProfile { notPorted() }
    public static func simPoints(_ league: League, simId: String, now: Int64) -> Int { notPorted() }
    public static func createLeague(_ state: GameState, deps: Deps, now: Int64, event: DailyEventId?, keepPoints: Int = 0, keepFights: [String: Int] = [:]) -> GameState { notPorted() }
    /// Rank rows by points: ties share a rank, players without points have no rank.
    public static func rankRows(_ rows: [LeagueRow]) -> [LeagueRow] { notPorted() }
    public static func finalStandings(_ state: GameState, league: League) -> FinalStandings { notPorted() }
    public static func prizeFor(rank: Int?, tier: LeagueTier = .bronze) -> LeaguePrize { notPorted() }
    public static func settleLeague(_ state: GameState, league: League, deps: Deps) -> (state: GameState, prizes: LeaguePrizes) { notPorted() }
    public static func collectLeagueResult(_ state: GameState, deps: Deps) -> (state: GameState, result: LeaguePrizes?) { notPorted() }
    public static func openLeague(_ state: GameState, deps: Deps, now: Int64, event: DailyEventId?) -> (state: GameState, info: OpenLeagueResult) { notPorted() }
    public static func standings(_ state: GameState, deps: Deps, now: Int64) -> [LeagueRow] { notPorted() }
    public static func canFightLeague(_ state: GameState, simId: String, now: Int64) -> CanFightLeague { notPorted() }
    public static func pointsFor(_ league: League?, source: LeaguePointSource, event: DailyEventId?, difficulty: Difficulty? = nil, oppLevel: Int? = nil, myLevel: Int? = nil) -> Int { notPorted() }
    public static func leagueStake(_ state: GameState, source: LeaguePointSource, difficulty: Difficulty? = nil, oppLevel: Int? = nil, event: DailyEventId?) -> Int { notPorted() }
    public static func fightLeague(_ state: GameState, deps: Deps, now: Int64, simId: String, event: DailyEventId?) throws -> (state: GameState, info: LeagueFightResult) { notPorted() }
    public static func addLeaguePoints(_ state: GameState, deps: Deps, now: Int64, source: LeaguePointSource, won: Bool, event: DailyEventId?, difficulty: Difficulty? = nil, oppLevel: Int? = nil) -> (state: GameState, points: Int) { notPorted() }
}

// MARK: - shop.js

public struct BoosterDef: Sendable {
    public var pack: Constants.BoosterPack
    public var token: TokenKind
    public var gems: Int
    public var mayContain: [Rarity]
    public init(pack: Constants.BoosterPack, token: TokenKind, gems: Int, mayContain: [Rarity]) { self.pack = pack; self.token = token; self.gems = gems; self.mayContain = mayContain }
}

public struct BoosterPoolEntry: Sendable {
    public var rarity: Rarity
    public var count: Int
    public var portal: [CardDef]
    public var main: [CardDef]
    public init(rarity: Rarity, count: Int, portal: [CardDef], main: [CardDef]) { self.rarity = rarity; self.count = count; self.portal = portal; self.main = main }
}

public enum ShopOps {
    public static let boosterCards = Constants.boosterGridCards
    public static let potionDealGems = 60
    public static let potionDealCount = 3
    /// The 21-day daily reward cycle.
    public static var dailyRewards: [DailyReward] { notPorted() }
    /// The daily events in hash order.
    public static var events: [DailyEvent] { notPorted() }

    public static func booster(_ id: TokenKind) -> BoosterDef { notPorted() }
    /// The daily event for a date (nil for a save in the tutorial).
    public static func dailyEvent(now: Int64, state: GameState?) -> DailyEvent? { notPorted() }
    public static func boosterPrice(_ id: TokenKind, event: DailyEventId?) -> Int { notPorted() }
    public static func boosterKey(_ id: TokenKind, portalId: String?) throws -> String { notPorted() }
    public static func boosterPool(deps: Deps, id: TokenKind, portalId: String?) throws -> [BoosterPoolEntry] { notPorted() }
    public static func rollBoosterCards(rng: RandomSource, deps: Deps, id: TokenKind, portalId: String?) throws -> [String] { notPorted() }
    public static func getBooster(_ state: GameState, id: TokenKind, portalId: String?) -> Booster? { notPorted() }
    public static func openBooster(_ state: GameState, deps: Deps, now: Int64, id: TokenKind, portalId: String?, open: Bool = false) throws -> (state: GameState, info: OpenBoosterResult) { notPorted() }
    public static func pickPayment(_ state: GameState, id: TokenKind, portalId: String?, event: DailyEventId?) -> PickPayment { notPorted() }
    public static func setProgressFor(_ state: GameState, deps: Deps, cardId: String) -> SetProgress? { notPorted() }
    public static func drawBoosterCard(_ state: GameState, deps: Deps, now: Int64, id: TokenKind, portalId: String?, position: Int, event: DailyEventId?) throws -> (state: GameState, info: BoosterDraw) { notPorted() }
    public static func discardBooster(_ state: GameState, deps: Deps, now: Int64, id: TokenKind, portalId: String?) throws -> (state: GameState, booster: Booster) { notPorted() }
    public static func dailyRewardFor(day: Int) -> DailyReward { notPorted() }
    public static func claimDaily(_ state: GameState, now: Int64) -> (state: GameState, info: DailyClaim) { notPorted() }
    public static func potionDealAvailable(_ state: GameState, now: Int64, event: DailyEventId?) -> Bool { notPorted() }
    public static func buyPotionDeal(_ state: GameState, now: Int64, event: DailyEventId?) throws -> (state: GameState, cost: Int) { notPorted() }
    public static func albumSets(deps: Deps) -> [AlbumSet] { notPorted() }
    public static func setCollections(_ state: GameState, deps: Deps) -> [SetCollection] { notPorted() }
    public static func albumNewCards(_ state: GameState, deps: Deps) -> [String] { notPorted() }
    public static func markAlbumSeen(_ state: GameState, cardIds: [String]) -> GameState { notPorted() }
    public static func claimCollection(_ state: GameState, deps: Deps, setId: String) throws -> (state: GameState, gems: Int) { notPorted() }
    /// Everything the Shop screen lists, priced for today. `portalId`: `.rotation` = the 7-day rotation,
    /// `.none` = no portal packs, `.portal(id)` = that portal (no countdowns).
    public static func shopOffers(_ state: GameState, deps: Deps, now: Int64, portal: ShopPortalChoice = .rotation) -> ShopOffers { notPorted() }
}

public enum ShopPortalChoice: Hashable, Sendable {
    case rotation
    case none
    case portal(String)
}

// MARK: - store.js helpers and app.js onOpen

public enum StoreHelpers {
    /// Shift every clock in the save by `deltaMs` (negative = the save looks older), for the daily features.
    public static func shiftClocks(_ state: GameState, deltaMs: Int64) -> GameState { notPorted() }
    /// Shift the save so that `days` real days appear to have passed (`debug.addDays`, also bumps `daily.dayShift`).
    public static func addDays(_ state: GameState, days: Int) -> GameState { notPorted() }
}

public enum AppFlow {
    /// What happens when a save is (re)opened: regen, daily reward, league settlement, piece raids (`app.js onOpen`).
    public static func onOpen(_ state: GameState, deps: Deps, now: Int64) -> (state: GameState, info: OnOpenResult) { notPorted() }
}
