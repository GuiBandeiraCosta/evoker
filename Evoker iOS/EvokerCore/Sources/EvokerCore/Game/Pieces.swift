import Foundation

/// Card-piece hunts (game-design §5 "Pieces tab"): a literal port of `Evoker Web/src/game/pieces.js`. A hunt is
/// `{cardId, owned, total, holderId, raidDay}` in `state.pieces` (max 8).
public enum PieceOps {
    public static let maxHunts = Constants.pieceHuntSlots
    public static let skipGems = 10
    public static let tutorialPiece = "club-swinger"

    /// Is this hunt the tutorial's card piece on a save still in the tutorial? (`isTutorialHunt`)
    public static func isTutorialHunt(_ state: GameState, hunt: PieceHunt?) -> Bool {
        guard let h = hunt else { return false }
        return h.cardId == tutorialPiece && StateOps.inTutorial(state)
    }

    /// Pieces needed to complete a card (`piecesTotal`; RARITIES[r].pieces, 4 for an unknown card).
    public static func piecesTotal(deps: Deps, cardId: String) -> Int {
        guard let def = deps.db.get(cardId) else { return 4 }
        let n = Constants.rarity(def.rarity).pieces
        return n == 0 ? 4 : n
    }

    /// Gem price to buy `missing` pieces of a rarity, halved on Card-piece Day (`missingPrice`).
    public static func missingPrice(rarity: Rarity?, missing: Int, event: DailyEventId?) -> Int {
        let table = rarity.flatMap { Constants.piecePrices[$0] } ?? Constants.piecePrices[.rare]!
        if missing <= 0 { return 0 }
        var price = missing <= table.count ? table[missing - 1] : table[table.count - 1] + 800 * (missing - table.count)
        if event == .cardPieceDay { price = JSMath.ceilInt(Double(price) / 2) }
        return price
    }

    /// Index of the hunt for a card, or -1 (`huntIndex`).
    public static func huntIndex(_ state: GameState, cardId: String) -> Int {
        state.pieces.firstIndex { $0.cardId == cardId } ?? -1
    }

    static func replaceHunt(_ state: GameState, index: Int, _ hunt: PieceHunt?) -> GameState {
        var s = state
        if let h = hunt {
            if index >= 0 && index < s.pieces.count { s.pieces[index] = h } else if index == s.pieces.count { s.pieces.append(h) }
        } else if index >= 0 && index < s.pieces.count {
            s.pieces.remove(at: index)
        }
        return s
    }

    /// Complete a hunt (`completeHunt`): the card is created (ignoring the collection limit) and the slot freed.
    public static func completeHunt(_ state: GameState, deps: Deps, index: Int) throws -> (state: GameState, uid: String, cardId: String) {
        guard let hunt = state.pieces[js: index] else { throw GameError("No such hunt") }
        let r = try CollectionOps.addCard(state, deps: deps, cardId: hunt.cardId, stage: 0, level: 1, force: true)
        return (replaceHunt(r.state, index: index, nil), r.info.uid ?? "", hunt.cardId)
    }

    /// Receive one piece of a card (`addPiece`): starts a hunt when needed, picks a holder, and completes the card
    /// when all pieces are owned.
    public static func addPiece(_ state: GameState, deps: Deps, now: Int64, cardId: String) throws -> (state: GameState, info: AddPieceResult) {
        var s = state
        var index = huntIndex(s, cardId: cardId)
        if index < 0 {
            if s.pieces.count >= maxHunts { return (s, AddPieceResult(index: -1, completed: false, uid: nil, full: true)) }
            s.pieces.append(PieceHunt(cardId: cardId, owned: 0, total: piecesTotal(deps: deps, cardId: cardId), holderId: nil, raidDay: JSDate.utcDay(now)))
            index = s.pieces.count - 1
        }
        var hunt = s.pieces[index]
        hunt.owned = s.pieces[index].owned + 1
        s = replaceHunt(s, index: index, hunt)
        if hunt.owned >= hunt.total {
            let c = try completeHunt(s, deps: deps, index: index)
            return (c.state, AddPieceResult(index: index, completed: true, uid: c.uid, full: false))
        }
        s = assignHolder(s, deps: deps, now: now, index: index)
        return (s, AddPieceResult(index: index, completed: false, uid: nil, full: false))
    }

    /// Pick a simulated player who "holds" a piece of the hunt's card (`assignHolder`); the scripted tutorial
    /// holder for the tutorial's piece.
    public static func assignHolder(_ state: GameState, deps: Deps, now: Int64, index: Int) -> GameState {
        if let h = state.pieces[js: index], isTutorialHunt(state, hunt: h) {
            var next = h
            next.holderId = OpponentOps.tutorialHolder.id
            return replaceHunt(state, index: index, next)
        }
        var s = OpponentOps.ensurePool(state, deps: deps, now: now).state
        let t = StateOps.takeRng(s, deps: deps)
        s = t.state
        guard let hunt = s.pieces[js: index] else { return s }
        let exclude: [String] = (hunt.holderId ?? "").isEmpty ? [] : [hunt.holderId!]
        let sim = OpponentOps.pickSims(s, rng: t.rng, count: 1, min: -2, max: 3, exclude: exclude).first
        var next = hunt
        next.holderId = sim?.id
        return replaceHunt(s, index: index, next)
    }

    /// Pay 10 gems to get another holder (`skipHolder`).
    public static func skipHolder(_ state: GameState, deps: Deps, now: Int64, index: Int) throws -> GameState {
        guard state.pieces[js: index] != nil else { throw GameError("No such hunt") }
        return assignHolder(try PlayerOps.spendGems(state, amount: skipGems), deps: deps, now: now, index: index)
    }

    /// The holder of a hunt (with info popup data), ensuring one is assigned (`huntHolder`).
    public static func huntHolder(_ state: GameState, deps: Deps, now: Int64, index: Int) -> (state: GameState, holder: SimInfo?) {
        var s = state
        guard var hunt = s.pieces[js: index] else { return (s, nil) }
        let holderId = hunt.holderId ?? ""
        if holderId.isEmpty || OpponentOps.getSim(s, simId: holderId) == nil {
            s = assignHolder(s, deps: deps, now: now, index: index)
            hunt = s.pieces[index]
        }
        let sim = (hunt.holderId ?? "").isEmpty ? nil : OpponentOps.getSim(s, simId: hunt.holderId!)
        return (s, sim.map { OpponentOps.simInfo($0, deps: deps) })
    }

    /// Attack the holder (`fightHolder`): costs deck mana; a win steals one piece (completing the card when it was
    /// the last one) and gives 10 Tournament Points and league points; the holder is rerolled afterwards.
    public static func fightHolder(_ state: GameState, deps: Deps, now: Int64, index: Int, event: DailyEventId?) throws -> (state: GameState, info: PiecesFightResult) {
        let hh = huntHolder(state, deps: deps, now: now, index: index)
        var s = hh.state
        guard let hunt = s.pieces[js: index] else { throw GameError("No such hunt") }
        guard let hid = hunt.holderId, !hid.isEmpty, let sim = OpponentOps.getSim(s, simId: hid) else { throw GameError("No holder") }
        let fight = try PvpOps.runPvpFight(s, deps: deps, now: now, sim: sim, power: 1, event: event, mode: .pieces)
        s = fight.state
        var completed = false
        var uid: String? = nil
        var tp = 0
        if fight.info.won {
            tp = PvpOps.tpPerWin
            s.player.tournamentPoints = s.player.tournamentPoints + tp
            let owned = hunt.owned + 1
            var next = hunt
            next.owned = owned
            s = replaceHunt(s, index: index, next)
            if owned >= hunt.total {
                let c = try completeHunt(s, deps: deps, index: index)
                s = c.state
                completed = true
                uid = c.uid
            }
        }
        if !completed { s = assignHolder(s, deps: deps, now: now, index: index) }
        let lp = LeagueOps.addLeaguePoints(s, deps: deps, now: now, source: .pieces, won: fight.info.won, event: event, difficulty: nil, oppLevel: sim.level)
        s = lp.state
        return (s, PiecesFightResult(battle: fight.info.battle, won: fight.info.won, completed: completed, uid: uid,
                                     cardId: completed ? hunt.cardId : nil, hunt: completed ? nil : s.pieces[js: index],
                                     levelUps: fight.info.levelUps, cardLevelUps: fight.info.cardLevelUps, tournamentPoints: tp, leaguePoints: lp.points))
    }

    /// Buy every missing piece of a hunt with gems and complete the card (`buyMissingPieces`).
    public static func buyMissingPieces(_ state: GameState, deps: Deps, now: Int64, index: Int, event: DailyEventId?) throws -> (state: GameState, info: BuyPiecesResult) {
        guard let hunt = state.pieces[js: index] else { throw GameError("No such hunt") }
        let rarity = deps.db.get(hunt.cardId)?.rarity
        let missing = hunt.total - hunt.owned
        let cost = missingPrice(rarity: rarity, missing: missing, event: event)
        let s = try PlayerOps.spendGems(state, amount: cost)
        let c = try completeHunt(s, deps: deps, index: index)
        return (c.state, BuyPiecesResult(cost: cost, uid: c.uid))
    }

    /// Price of buying the missing pieces of a hunt (`huntBuyPrice`).
    public static func huntBuyPrice(_ state: GameState, deps: Deps, index: Int, event: DailyEventId?) -> Int {
        guard let hunt = state.pieces[js: index] else { return 0 }
        return missingPrice(rarity: deps.db.get(hunt.cardId)?.rarity, missing: hunt.total - hunt.owned, event: event)
    }

    /// Buy the first piece of a random Rare/Heroic set card into an empty slot (`buyFirstPiece`): 100 gems, 50 on
    /// Card-piece Day.
    public static func buyFirstPiece(_ state: GameState, deps: Deps, now: Int64, event: DailyEventId?) throws -> (state: GameState, info: BuyFirstPieceResult) {
        if state.pieces.count >= maxHunts { throw GameError("All piece slots are in use") }
        let cost = event == .cardPieceDay ? Constants.firstPieceGemsEvent : Constants.firstPieceGems
        var s = try PlayerOps.spendGems(state, amount: cost)
        let t = StateOps.takeRng(s, deps: deps)
        s = t.state
        let owned = Set(s.pieces.map { $0.cardId })
        var portalIds = Set<String>()
        for p in deps.quests?.portals ?? [] { for id in p.cards { portalIds.insert(id) } }
        let usable: (CardDef) -> Bool = { !owned.contains($0.id) && !$0.isTrainer }
        let rareHeroic = (deps.db.byRarity(.rare) + deps.db.byRarity(.heroic)).filter(usable)
        // portal set cards first, then any non-main set, then anything
        var pool = rareHeroic.filter { portalIds.contains($0.id) }
        if pool.isEmpty { pool = rareHeroic.filter { !$0.set.isEmpty && $0.set != "main" && $0.set != "unique-events" } }
        if pool.isEmpty { pool = rareHeroic }
        if pool.isEmpty { pool = deps.db.all().filter(usable) }
        guard let def = t.rng.pick(pool) else { throw GameError("No card to hunt") }
        let r = try addPiece(s, deps: deps, now: now, cardId: def.id)
        return (r.state, BuyFirstPieceResult(cost: cost, index: r.info.index, cardId: def.id))
    }

    /// Simulated raids (`dailyRaids`): once per real day each unfinished hunt with at least one piece has a 20 %
    /// chance to lose one piece (never the tutorial's piece during the tutorial); stolen pieces become notices.
    public static func dailyRaids(_ state: GameState, deps: Deps, now: Int64) -> (state: GameState, stolen: [String]) {
        let day = JSDate.utcDay(now)
        var stolen: [String] = []
        if !state.settings.raids || state.pieces.isEmpty { return (state, stolen) }
        let due = state.pieces.contains { $0.raidDay != day }
        if !due { return (state, stolen) }
        let t = StateOps.takeRng(state, deps: deps)
        var s = t.state
        let pieces: [PieceHunt] = s.pieces.map { h in
            if h.raidDay == day { return h }
            var next = h
            if isTutorialHunt(state, hunt: h) {
                next.raidDay = day
                return next
            }
            var owned = h.owned
            if owned > 0 && t.rng.chance(Constants.pieceRaidChance) {
                owned -= 1
                stolen.append(h.cardId)
            }
            next.owned = owned
            next.raidDay = day
            return next
        }
        s.pieces = pieces
        for cardId in stolen {
            s = StateOps.addNotice(s, Notice(type: "raid", ["cardId": .string(cardId), "day": .string(day)]))
        }
        return (s, stolen)
    }
}
