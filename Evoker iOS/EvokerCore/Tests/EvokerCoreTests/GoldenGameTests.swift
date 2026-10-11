import Foundation
import XCTest
@testable import EvokerCore

/// Replays the game-function sequences recorded from the web code (Tools/gen-goldens-game.mjs): every step is
/// dispatched to the Swift port, then the returned info (projected like the recording: `battle` keeps only its
/// `result`, a `quest` node only its `n`) and the whole save are compared as canonical JSON. A `set` step replaces
/// the state (and checks that it decodes and re-encodes to the same JSON). The sequences run on the real data
/// through the real `Stats` and `BattleEngine` of package A.
final class GoldenGameTests: XCTestCase {
    struct Step: Decodable {
        let fn: String
        let args: JSONValue?
        let now: Int64?
        let info: JSONValue?
        let state: JSONValue
    }

    static let deps = Deps(db: RealData.db, stats: Stats(), engine: BattleEngine(), rng: { Mulberry32($0) }, quests: RealData.quests, names: RealData.names)

    // MARK: JSON helpers

    private func j<T: Encodable>(_ v: T) -> JSONValue { try! JSONValue.of(v) }
    private func jo<T: Encodable>(_ v: T?) -> JSONValue { v.map { j($0) } ?? .null }
    private func battle(_ b: BattleOutcome?) -> JSONValue { b.map { .object(["result": j($0.result)]) } ?? .null }
    private func num(_ n: Int) -> JSONValue { .number(Double(n)) }
    private func num(_ n: Int?) -> JSONValue { n.map { .number(Double($0)) } ?? .null }
    private func str(_ s: String?) -> JSONValue { s.map { .string($0) } ?? .null }

    private func bossResult(_ r: BossResult) -> JSONValue {
        .object([
            "won": .bool(r.won), "reward": jo(r.reward), "unlocked": num(r.unlocked), "firstWin": .bool(r.firstWin), "playerXp": num(r.playerXp),
            "cardXp": num(r.cardXp), "levelUps": j(r.levelUps), "levelUpDetails": j(r.levelUpDetails), "cardLevelUps": j(r.cardLevelUps),
            "gems": num(r.gems), "deckSlots": num(r.deckSlots), "bonusGold": num(r.bonusGold), "quest": .object(["n": num(r.quest.n)]),
            "battle": battle(r.battle), "lineup": jo(r.lineup), "seed": r.seed.map { .number(Double($0)) } ?? .null,
        ])
    }

    private func arenaResult(_ r: ArenaResult) -> JSONValue {
        .object(["battle": battle(r.battle), "won": .bool(r.won), "rewards": j(r.rewards), "levelUps": j(r.levelUps), "cardLevelUps": j(r.cardLevelUps), "opponent": j(r.opponent)])
    }

    private func leagueFightResult(_ r: LeagueFightResult) -> JSONValue {
        .object(["battle": battle(r.battle), "won": .bool(r.won), "points": num(r.points), "levelUps": j(r.levelUps), "cardLevelUps": j(r.cardLevelUps), "opponent": j(r.opponent)])
    }

    private func piecesFightResult(_ r: PiecesFightResult) -> JSONValue {
        .object(["battle": battle(r.battle), "won": .bool(r.won), "completed": .bool(r.completed), "uid": str(r.uid), "cardId": str(r.cardId), "hunt": jo(r.hunt),
                 "levelUps": j(r.levelUps), "cardLevelUps": j(r.cardLevelUps), "tournamentPoints": num(r.tournamentPoints), "leaguePoints": num(r.leaguePoints)])
    }

    private func notices(_ list: [Notice]) -> JSONValue { .array(list.map { .object($0.fields) }) }

    // MARK: argument helpers

    private func event(_ args: JSONValue) -> DailyEventId? { args["event"]?.stringValue.flatMap { DailyEventId(rawValue: $0) } }
    private func int(_ args: JSONValue, _ key: String) -> Int { args[key]?.intValue ?? 0 }
    private func string(_ args: JSONValue, _ key: String) -> String { args[key]?.stringValue ?? "" }
    private func strings(_ args: JSONValue, _ key: String) -> [String] { (args[key]?.arrayValue ?? []).compactMap { $0.stringValue } }
    private func token(_ args: JSONValue, _ key: String) -> TokenKind { TokenKind(rawValue: string(args, key)) ?? .neophyte }
    private func portalId(_ args: JSONValue) -> String? { args["portalId"]?.stringValue }

    // MARK: the replay

    /// Runs one recorded sequence; returns the number of steps replayed.
    @discardableResult
    private func replay(_ file: String) throws -> Int {
        let steps = try Golden.load(file, as: [Step].self)
        XCTAssertFalse(steps.isEmpty, "\(file) has no steps")
        let deps = GoldenGameTests.deps
        var state: GameState? = nil
        var done = 0
        for (i, step) in steps.enumerated() {
            let label = "\(file)[\(i)] \(step.fn)"
            let now = step.now ?? 0
            let args = step.args ?? .null
            if step.fn == "set" {
                let decoded = try step.state.decode(GameState.self)
                if let d = Canon.firstDifference(try JSONValue.of(decoded), step.state) { XCTFail("\(label): the set state does not round-trip: \(d)"); return done }
                state = decoded
                done += 1
                continue
            }
            var info: JSONValue? = nil
            var queryOnly = false
            do {
                switch step.fn {
                case "newGame":
                    state = StateOps.newGame(name: string(args, "name"), seed: UInt32(int(args, "seed")), now: now, deps: deps)
                case "onOpen":
                    let r = AppFlow.onOpen(state!, deps: deps, now: now); state = r.state; info = .object(["notices": notices(r.info.notices)])
                case "placeInDeck":
                    let r = try CollectionOps.placeInDeck(state!, deps: deps, uid: string(args, "uid"), slot: int(args, "slot")); state = r.state; info = .object(["mana": num(r.mana)])
                case "startQuest":
                    let r = try QuestOps.startQuest(state!, deps: deps, now: now, line: string(args, "line"), n: int(args, "n")); state = r.state; info = .object(["active": j(r.active)])
                case "tapMinion":
                    let r = try QuestOps.tapMinion(state!, deps: deps, now: now, event: event(args)); state = r.state; info = j(r.info)
                case "prepareBoss":
                    let r = try QuestOps.prepareBoss(state!, deps: deps, now: now); state = r.state; info = .object(["lineup": j(r.lineup), "quest": .object(["n": num(r.quest.n)])])
                case "fightBoss":
                    let r = try QuestOps.fightBoss(state!, deps: deps, now: now, event: event(args)); state = r.state; info = bossResult(r.info)
                case "mapNodesStatus":
                    queryOnly = true
                    info = .array(QuestOps.mapNodes(state!, deps: deps, lineId: string(args, "lineId")).prefix(6).map { .object(["n": num($0.n), "status": .string($0.status.rawValue)]) })
                case "deckSlotCount":
                    queryOnly = true; info = num(StateOps.deckSlotCount(state!))
                case "isUnlocked":
                    queryOnly = true; info = .bool(StateOps.isUnlocked(state!, Feature(alias: string(args, "feature"))!))
                case "ensureOffers":
                    let r = ArenaOps.ensureOffers(state!, deps: deps, now: now); state = r.state; info = j(r.info)
                case "offerInfo":
                    queryOnly = true; info = jo(ArenaOps.offerInfo(state!, deps: deps, offerIndex: int(args, "offerIndex")))
                case "openLeague":
                    let r = LeagueOps.openLeague(state!, deps: deps, now: now, event: event(args)); state = r.state; info = .object(["league": j(r.info.league), "prizes": jo(r.info.prizes)])
                case "joinLeague":
                    state = LeagueOps.joinLeague(state!)
                case "leagueStake":
                    queryOnly = true
                    info = num(LeagueOps.leagueStake(state!, source: LeaguePointSource(rawValue: string(args, "source")) ?? .arena, difficulty: args["difficulty"]?.stringValue.flatMap { Difficulty(rawValue: $0) },
                                                     oppLevel: args["oppLevel"]?.intValue, event: event(args)))
                case "fightArena":
                    let r = try ArenaOps.fightArena(state!, deps: deps, now: now, offerIndex: int(args, "offerIndex"), event: event(args)); state = r.state; info = arenaResult(r.info)
                case "fightLeague":
                    let r = try LeagueOps.fightLeague(state!, deps: deps, now: now, simId: string(args, "simId"), event: event(args)); state = r.state; info = leagueFightResult(r.info)
                case "canFightLeague":
                    queryOnly = true; info = j(LeagueOps.canFightLeague(state!, simId: string(args, "simId"), now: now))
                case "standings":
                    queryOnly = true; info = j(LeagueOps.standings(state!, deps: deps, now: now))
                case "addDays":
                    state = StoreHelpers.addDays(state!, days: int(args, "days"))
                case "collectLeagueResult":
                    let r = LeagueOps.collectLeagueResult(state!, deps: deps); state = r.state; info = .object(["result": jo(r.result)])
                case "buyFirstPiece":
                    let r = try PieceOps.buyFirstPiece(state!, deps: deps, now: now, event: event(args)); state = r.state; info = j(r.info)
                case "huntHolderInfo":
                    queryOnly = true; info = jo(PieceOps.huntHolder(state!, deps: deps, now: now, index: int(args, "index")).holder)
                case "fightHolder":
                    let r = try PieceOps.fightHolder(state!, deps: deps, now: now, index: int(args, "index"), event: event(args)); state = r.state; info = piecesFightResult(r.info)
                case "addPiece":
                    let r = try PieceOps.addPiece(state!, deps: deps, now: now, cardId: string(args, "cardId")); state = r.state; info = j(r.info)
                case "skipHolder":
                    state = try PieceOps.skipHolder(state!, deps: deps, now: now, index: int(args, "index"))
                case "huntBuyPrice":
                    queryOnly = true; info = num(PieceOps.huntBuyPrice(state!, deps: deps, index: int(args, "index"), event: event(args)))
                case "buyMissingPieces":
                    let r = try PieceOps.buyMissingPieces(state!, deps: deps, now: now, index: int(args, "index"), event: event(args)); state = r.state; info = j(r.info)
                case "dailyRaids":
                    let r = PieceOps.dailyRaids(state!, deps: deps, now: now); state = r.state; info = .object(["stolen": .array(r.stolen.map { .string($0) })])
                case "ensurePool":
                    let r = OpponentOps.ensurePool(state!, deps: deps, now: now); state = r.state; info = .object(["refreshed": .bool(r.refreshed)])
                case "rollOffers":
                    state = ArenaOps.rollOffers(state!, deps: deps, now: now)
                case "pickPayment":
                    queryOnly = true; info = j(ShopOps.pickPayment(state!, id: token(args, "booster"), portalId: portalId(args), event: event(args)))
                case "openBooster":
                    let r = try ShopOps.openBooster(state!, deps: deps, now: now, id: token(args, "booster"), portalId: portalId(args), open: args["open"]?.boolValue ?? false)
                    state = r.state; info = j(r.info)
                case "drawBoosterCard":
                    let r = try ShopOps.drawBoosterCard(state!, deps: deps, now: now, id: token(args, "booster"), portalId: portalId(args), position: int(args, "position"), event: event(args))
                    state = r.state; info = j(r.info)
                case "discardBooster":
                    let r = try ShopOps.discardBooster(state!, deps: deps, now: now, id: token(args, "booster"), portalId: portalId(args)); state = r.state; info = .object(["booster": j(r.booster)])
                case "claimDaily":
                    let r = ShopOps.claimDaily(state!, now: now); state = r.state; info = j(r.info)
                case "claimDailyAgain":
                    queryOnly = true; info = .bool(ShopOps.claimDaily(state!, now: now).info.claimed)
                case "dailyEvent":
                    queryOnly = true; info = jo(ShopOps.dailyEvent(now: PlayerOps.eventClock(state!, now: now), state: state!))
                case "potionDealAvailable":
                    queryOnly = true; info = .bool(ShopOps.potionDealAvailable(state!, now: now, event: event(args)))
                case "buyPotionDeal":
                    let r = try ShopOps.buyPotionDeal(state!, now: now, event: event(args)); state = r.state; info = .object(["cost": num(r.cost)])
                case "albumNewCards":
                    queryOnly = true; info = .array(ShopOps.albumNewCards(state!, deps: deps).map { .string($0) })
                case "setCollections":
                    queryOnly = true; info = j(ShopOps.setCollections(state!, deps: deps))
                case "claimCollection":
                    let r = try ShopOps.claimCollection(state!, deps: deps, setId: string(args, "setId")); state = r.state; info = .object(["gems": num(r.gems)])
                case "markAlbumSeen":
                    state = ShopOps.markAlbumSeen(state!, cardIds: strings(args, "cardIds"))
                case "setProgressFor":
                    queryOnly = true; info = jo(ShopOps.setProgressFor(state!, deps: deps, cardId: string(args, "cardId")))
                case "addCard":
                    let r = try CollectionOps.addCard(state!, deps: deps, cardId: string(args, "cardId"), stage: int(args, "stage"), level: int(args, "level"), force: args["force"]?.boolValue ?? false)
                    state = r.state; info = j(r.info)
                case "sortCards":
                    queryOnly = true
                    let order = CardSortOrder(rawValue: string(args, "order")) ?? .default
                    info = j(CollectionOps.sortCards(state!.cards, db: deps.db, order: order, stats: order == .attack ? deps.stats : nil))
                case "bestCard":
                    queryOnly = true; info = jo(CollectionOps.bestCard(state!, deps: deps))
                case "validateDeck":
                    queryOnly = true; info = j(CollectionOps.validateDeck(state!, deps: deps))
                case "setDeck":
                    let slots: [String?] = (args["slots"]?.arrayValue ?? []).map { $0.stringValue }
                    let r = try CollectionOps.setDeck(state!, deps: deps, slots: slots); state = r.state; info = .object(["mana": num(r.mana)])
                case "removeFromDeck":
                    state = CollectionOps.removeFromDeck(state!, slot: int(args, "slot"))
                case "sellCard":
                    let r = try CollectionOps.sellCard(state!, deps: deps, uid: string(args, "uid")); state = r.state; info = .object(["gold": num(r.gold)])
                case "previewTraining":
                    queryOnly = true; info = j(TrainingOps.previewTraining(state!, deps: deps, trainUid: string(args, "trainUid"), sacrificeUids: strings(args, "sacrificeUids")))
                case "train":
                    let r = try TrainingOps.train(state!, deps: deps, trainUid: string(args, "trainUid"), sacrificeUids: strings(args, "sacrificeUids")); state = r.state; info = j(r.info)
                case "canFuse":
                    queryOnly = true; info = j(FusionOps.canFuse(state!, deps: deps, uidA: string(args, "uidA"), uidB: string(args, "uidB")))
                case "fusionCandidates":
                    queryOnly = true; info = j(FusionOps.fusionCandidates(state!, deps: deps))
                case "fuse":
                    let r = try FusionOps.fuse(state!, deps: deps, uidA: string(args, "uidA"), uidB: string(args, "uidB")); state = r.state; info = j(r.info)
                case "addDeckXp":
                    let r = CollectionOps.addDeckXp(state!, deps: deps, xp: int(args, "xp")); state = r.state; info = .object(["levelUps": j(r.levelUps)])
                case "addCardXp":
                    let r = CollectionOps.addCardXp(state!, deps: deps, uid: string(args, "uid"), xp: int(args, "xp")); state = r.state; info = .object(["levelUps": j(r.levelUps), "capped": .bool(r.capped)])
                case "previewStatPoints":
                    queryOnly = true; info = j(PlayerOps.previewStatPoints(state!, alloc: StatAlloc(stamina: int(args, "stamina"), mana: int(args, "mana"), hp: int(args, "hp"))))
                case "spendStatPoints":
                    state = try PlayerOps.spendStatPoints(state!, alloc: StatAlloc(stamina: int(args, "stamina"), mana: int(args, "mana"), hp: int(args, "hp")))
                case "editProfile":
                    state = PlayerOps.editProfile(state!, name: args["name"]?.stringValue, avatar: args["avatar"]?.intValue)
                case "applyRegen":
                    state = PlayerOps.applyRegen(state!, now: now)
                case "addPlayerXp":
                    let r = PlayerOps.addPlayerXp(state!, deps: deps, amount: int(args, "amount")); state = r.state; info = j(r.info)
                case "levelUpRewards":
                    queryOnly = true; info = j(PlayerOps.levelUpRewards(level: int(args, "level")))
                case "needsPotion":
                    queryOnly = true; info = j(PlayerOps.needsPotion(state!, kind: PotionKind(rawValue: string(args, "kind")) ?? .stamina, amount: int(args, "amount"), event: event(args)))
                case "drinkPotion":
                    state = try PlayerOps.drinkPotion(state!, kind: PotionKind(rawValue: string(args, "kind")) ?? .stamina)
                case "buyAndDrinkPotion":
                    state = try PlayerOps.buyAndDrinkPotion(state!, kind: PotionKind(rawValue: string(args, "kind")) ?? .stamina, event: event(args))
                case "addTokens":
                    state = PlayerOps.addTokens(state!, kind: token(args, "kind"), count: int(args, "count"), portalId: portalId(args))
                case "unlockSlotsForQuest":
                    let r = StateOps.unlockSlotsForQuest(state!, lineId: string(args, "lineId"), n: int(args, "n")); state = r.state; info = .object(["slots": num(r.slots)])
                case "applyReward":
                    let reward = try args["reward"]!.decode(Reward.self)
                    let r = try RewardOps.applyReward(state!, deps: deps, now: now, reward: reward); state = r.state; info = .object(["reward": j(r.reward)])
                default:
                    XCTFail("\(label): no dispatch for \(step.fn)"); return done
                }
            } catch {
                XCTFail("\(label): threw \(error)"); return done
            }
            if let expected = step.info, !expected.isNull {
                if let d = Canon.firstDifference(info ?? .null, expected) { XCTFail("\(label): info differs: \(d)"); return done }
            } else if let actual = info, !actual.isNull, !queryOnly {
                XCTFail("\(label): the web recorded no info but Swift returned \(actual.canonical().prefix(200))"); return done
            }
            if let d = Canon.firstDifference(try JSONValue.of(state!), step.state) { XCTFail("\(label): state differs: \(d)"); return done }
            done += 1
        }
        return done
    }

    func testNewGameAndQuests() throws {
        let n = try replay("game-newgame-quests")
        XCTAssertGreaterThan(n, 40)
    }

    func testArenaLeagueAndPieces() throws {
        let n = try replay("game-pvp")
        XCTAssertGreaterThan(n, 30)
    }

    func testShop() throws {
        let n = try replay("game-shop")
        XCTAssertGreaterThan(n, 40)
    }

    func testCards() throws {
        let n = try replay("game-cards")
        XCTAssertGreaterThan(n, 40)
    }

    // MARK: migration

    struct MigrateCase: Decodable {
        let name: String
        let now: Int64
        let raw: JSONValue
        let migrated: JSONValue
        let pruned: JSONValue
        let legacyDeckSlots: Int
    }

    /// The web keeps an old league object as it is; the Swift `League` model normalises it on decoding (the
    /// documented contract: `v` defaults to 1, `profiles` to {}, 'platinum' maps to Gold). The expected JSON gets
    /// the same normalisation before the comparison.
    private func normaliseLeague(_ state: JSONValue) -> JSONValue {
        guard case .object(var s) = state, case .object(var sim)? = s["sim"], case .object(var league)? = sim["league"] else { return state }
        if league["v"] == nil { league["v"] = .number(1) }
        if league["profiles"] == nil { league["profiles"] = .object([:]) }
        if league["tier"]?.stringValue == "platinum" { league["tier"] = .string("gold") }
        sim["league"] = .object(league)
        s["sim"] = .object(sim)
        return .object(s)
    }

    func testMigrationOfOldSaves() throws {
        let cases = try Golden.load("game-migrate", as: [MigrateCase].self)
        XCTAssertEqual(cases.count, 3)
        for c in cases {
            XCTAssertEqual(StateOps.legacyDeckSlots(rawSave: c.raw), c.legacyDeckSlots, "\(c.name): legacyDeckSlots")
            let data = try JSONEncoder().encode(c.raw)
            guard let migrated = try SaveCodec.parse(data, now: c.now) else { XCTFail("\(c.name): parse returned nil"); continue }
            if let d = Canon.firstDifference(try JSONValue.of(migrated), normaliseLeague(c.migrated)) { XCTFail("\(c.name): migrated differs: \(d)") }
            let pruned = StateOps.pruneRemoved(migrated, deps: GoldenGameTests.deps)
            if let d = Canon.firstDifference(try JSONValue.of(pruned), normaliseLeague(c.pruned)) { XCTFail("\(c.name): pruned differs: \(d)") }
        }
    }
}
