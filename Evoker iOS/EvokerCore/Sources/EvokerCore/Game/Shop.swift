import Foundation

/// A booster pack as the shop lists it (shop.js BOOSTERS entry).
public struct BoosterDef: Sendable {
    public var pack: Constants.BoosterPack
    public var token: TokenKind
    public var gems: Int
    public var mayContain: [Rarity]
    public init(pack: Constants.BoosterPack, token: TokenKind, gems: Int, mayContain: [Rarity]) { self.pack = pack; self.token = token; self.gems = gems; self.mayContain = mayContain }
}

/// Card defs a booster can produce, by slot rarity (shop.js boosterPool entry).
public struct BoosterPoolEntry: Sendable {
    public var rarity: Rarity
    public var count: Int
    public var portal: [CardDef]
    public var main: [CardDef]
    public init(rarity: Rarity, count: Int, portal: [CardDef], main: [CardDef]) { self.rarity = rarity; self.count = count; self.portal = portal; self.main = main }
}

/// Which portal the Shop lists (shop.js shopOffers `portalId`).
public enum ShopPortalChoice: Hashable, Sendable {
    /// The 7-day rotation (`undefined`).
    case rotation
    /// No portal packs (`null`).
    case none
    /// That portal, without countdowns.
    case portal(String)
}

/// Shop and economy (game-design §7): boosters (the nine-card grid), potions, daily rewards, daily events, set
/// collections. A literal port of `Evoker Web/src/game/shop.js`.
public enum ShopOps {
    public static let boosterCards = Constants.boosterGridCards
    public static let potionDealGems = 60
    public static let potionDealCount = 3

    /// The booster packs with their token kind and the rarities a pack may contain (BOOSTERS), in shop order.
    public static let boosters: [BoosterDef] = Constants.boosterPacks.map { p in
        var may: [Rarity] = Rarity.order.filter { r in p.slots.contains { $0.0 == r && $0.1 != 0 } }
        if p.ultimateChance != nil { may.append(.ultimate) }
        return BoosterDef(pack: p, token: p.id, gems: p.pickGems, mayContain: may)
    }

    /// The 21-day daily reward cycle (DAILY_REWARDS).
    public static var dailyRewards: [DailyReward] {
        [
            DailyReward(stamina: 2), DailyReward(stamina: 1, mana: 1), DailyReward(gems: 40), DailyReward(stamina: 2), DailyReward(stamina: 1, mana: 1), DailyReward(gems: 80), DailyReward(tokens: .neophyte, count: 2),
            DailyReward(stamina: 3), DailyReward(stamina: 2, mana: 1), DailyReward(gems: 120), DailyReward(stamina: 3), DailyReward(stamina: 2, mana: 1), DailyReward(gems: 160), DailyReward(tokens: .summoner, count: 2),
            DailyReward(stamina: 4), DailyReward(stamina: 2, mana: 2), DailyReward(gems: 200), DailyReward(stamina: 4), DailyReward(stamina: 2, mana: 2), DailyReward(gems: 240), DailyReward(tokens: .archmage, count: 2),
        ]
    }

    /// The daily events in hash order (EVENTS).
    public static var events: [DailyEvent] { DailyEventId.order.map { DailyEvent($0) } }

    public static func booster(_ id: TokenKind) -> BoosterDef {
        boosters.first { $0.pack.id == id }!
    }

    /// The daily event for a date (`dailyEvent`): nil only for a save in the tutorial.
    public static func dailyEvent(now: Int64, state: GameState?) -> DailyEvent? {
        if let s = state, StateOps.inTutorial(s) { return nil }
        let day = JSMath.floorInt(Double(now) / Double(JSDate.dayMs))
        let list = events
        return list[Seeds.dailyEventIndex(dayNumber: day, count: list.count)]
    }

    /// Gem price of one pick from a booster when the player has no token (`boosterPrice`): −50 % on Get the Best Cards.
    public static func boosterPrice(_ id: TokenKind, event: DailyEventId?) -> Int {
        let b = booster(id)
        return event == .getTheBestCards ? JSMath.ceilInt(Double(b.pack.pickGems) / 2) : b.pack.pickGems
    }

    /// Save key of a booster (`boosterKey`): the pack id, plus the portal for the portal packs.
    public static func boosterKey(_ id: TokenKind, portalId: String?) throws -> String {
        let b = booster(id)
        if !b.pack.portal { return id.rawValue }
        guard let pid = portalId, !pid.isEmpty else { throw GameError("Unknown portal " + (portalId ?? "undefined")) }
        return "\(id.rawValue)@\(pid)"
    }

    /// Card ids of the main set (`mainSetIds`), nil when unknown.
    static func mainSetIds(deps: Deps) -> [String]? {
        let fromDb = deps.db.bySet("main").map { $0.id }
        if !fromDb.isEmpty { return fromDb }
        if let line = QuestOps.questLine(deps: deps, lineId: "main"), !line.cards.isEmpty { return line.cards }
        return nil
    }

    /// Card defs a booster can produce, by slot rarity (`boosterPool`).
    public static func boosterPool(deps: Deps, id: TokenKind, portalId: String?) throws -> [BoosterPoolEntry] {
        let b = booster(id)
        var portalIds: [String]? = nil
        if b.pack.portal {
            guard let pid = portalId, pid != "main", let line = QuestOps.questLine(deps: deps, lineId: pid) else {
                throw GameError("Unknown portal " + (portalId ?? "undefined"))
            }
            portalIds = line.cards
        }
        let main = mainSetIds(deps: deps)
        var rarities = b.pack.slots.map { $0.0 }
        if b.pack.ultimateChance != nil { rarities.append(.ultimate) }
        return rarities.map { rarity in
            let mainCards = CollectionOps.cardsOfRarity(deps.db, rarity: rarity, setIds: main)
            return BoosterPoolEntry(rarity: rarity, count: b.pack.slots.first { $0.0 == rarity }?.1 ?? 0,
                                    portal: portalIds.map { CollectionOps.cardsOfRarity(deps.db, rarity: rarity, setIds: $0) } ?? [],
                                    main: mainCards.isEmpty ? CollectionOps.cardsOfRarity(deps.db, rarity: rarity, setIds: nil) : mainCards)
        }
    }

    /// Roll the nine cards of a booster (`rollBoosterCards`): fixed rarity make-up, shuffled over the 3×3 grid.
    public static func rollBoosterCards(rng: RandomSource, deps: Deps, id: TokenKind, portalId: String?) throws -> [String] {
        let b = booster(id)
        let pool = try boosterPool(deps: deps, id: id, portalId: portalId)
        let ultimate = pool.first { $0.rarity == .ultimate }
        var out: [String] = []
        for e in pool {
            for _ in 0..<e.count {
                var entry = e
                if e.rarity == .legendary, let uc = b.pack.ultimateChance, let u = ultimate, !u.portal.isEmpty, rng.chance(uc) {
                    entry = u
                }
                let fromPortal = !entry.portal.isEmpty && (entry.main.isEmpty || rng.chance(b.pack.portalShare ?? 0))
                let list = fromPortal ? entry.portal : entry.main
                if let picked = rng.pick(list) { out.append(picked.id) }
            }
        }
        return OpponentOps.shuffle(rng: rng, out)
    }

    /// The booster a pack currently holds in the save (`getBooster`), nil before its first visit.
    public static func getBooster(_ state: GameState, id: TokenKind, portalId: String?) -> Booster? {
        guard let key = try? boosterKey(id, portalId: portalId) else { return nil }
        return state.boosters[key]
    }

    static func putBooster(_ state: GameState, _ booster: Booster) throws -> GameState {
        var s = state
        s.boosters[try boosterKey(booster.id, portalId: booster.portalId)] = booster
        return s
    }

    static func rollNewBooster(_ state: GameState, deps: Deps, id: TokenKind, portalId: String?, seq: Int) throws -> (state: GameState, booster: Booster) {
        let t = StateOps.takeRng(state, deps: deps)
        let cards = try rollBoosterCards(rng: t.rng, deps: deps, id: id, portalId: portalId)
        let booster = Booster(id: id, portalId: self.booster(id).pack.portal ? portalId : nil, cards: cards, drawn: [], opened: false, seq: seq)
        return (try putBooster(t.state, booster), booster)
    }

    /// Enter a booster (`openBooster`): rolls a sealed booster when the pack has none yet; `open` marks it opened.
    public static func openBooster(_ state: GameState, deps: Deps, now: Int64, id: TokenKind, portalId: String?, open: Bool = false) throws -> (state: GameState, info: OpenBoosterResult) {
        var s = state
        var booster = getBooster(s, id: id, portalId: portalId)
        let fresh = booster == nil || !(booster!.opened)
        if booster == nil {
            let r = try rollNewBooster(s, deps: deps, id: id, portalId: portalId, seq: 1)
            s = r.state
            booster = r.booster
        }
        if open, var b = booster, !b.opened {
            b.opened = true
            booster = b
            s = try putBooster(s, b)
        }
        return (s, OpenBoosterResult(booster: booster!, fresh: fresh))
    }

    /// How the next pick from a booster gets paid (`pickPayment`): a token while the player has any, else gems.
    public static func pickPayment(_ state: GameState, id: TokenKind, portalId: String?, event: DailyEventId?) -> PickPayment {
        let tokens = PlayerOps.tokenCount(state, kind: id, portalId: portalId)
        let gems = state.player.gems
        if tokens > 0 { return PickPayment(type: .token, amount: 1, canPay: true, tokens: tokens, gems: gems) }
        let amount = boosterPrice(id, event: event)
        return PickPayment(type: .gems, amount: amount, canPay: gems >= amount, tokens: tokens, gems: gems)
    }

    /// The collection set a card counts for, with the owned count (`setProgressFor`).
    public static func setProgressFor(_ state: GameState, deps: Deps, cardId: String) -> SetProgress? {
        let col = setCollections(state, deps: deps)
        let hit = col.first { $0.id != "main" && $0.cards.contains { $0.cardId == cardId } } ?? col.first { $0.cards.contains { $0.cardId == cardId } }
        return hit.map { SetProgress(id: $0.id, name: $0.name, owned: $0.ownedCount, total: $0.total) }
    }

    /// Draw (reveal) the face-down card at a grid position (`drawBoosterCard`): pays 1 token or the gem price and
    /// adds the card; `setAdded` when the card is new to its collection set.
    public static func drawBoosterCard(_ state: GameState, deps: Deps, now: Int64, id: TokenKind, portalId: String?, position: Int, event: DailyEventId?) throws -> (state: GameState, info: BoosterDraw) {
        guard let booster = getBooster(state, id: id, portalId: portalId) else { throw GameError("The booster is not open") }
        guard let cardId = booster.cards[js: position], !cardId.isEmpty else { throw GameError("No such card") }
        if booster.drawn.contains(position) { throw GameError("This card was already drawn") }
        let pay = pickPayment(state, id: id, portalId: portalId, event: event)
        if !pay.canPay { throw GameError("Not enough gems") }
        var s = pay.type == .token ? PlayerOps.addTokens(state, kind: id, count: -1, portalId: portalId) : try PlayerOps.spendGems(state, amount: pay.amount)
        let before = setProgressFor(s, deps: deps, cardId: cardId)
        let wasOwned = s.cards.contains { $0.cardId == cardId }
        let r = try CollectionOps.addCard(s, deps: deps, cardId: cardId, stage: 0, level: 1, force: true)
        s = r.state
        var setAdded: SetProgress? = nil
        if let b = before, !wasOwned, !r.info.converted {
            var sp = b
            sp.owned = b.owned + 1
            setAdded = sp
        }
        var next = booster
        next.opened = true
        next.drawn = booster.drawn + [position]
        s = try putBooster(s, next)
        return (s, BoosterDraw(cardId: cardId, uid: r.info.uid, converted: r.info.converted, gold: r.info.gold, paidWith: pay.type,
                               cost: pay.type == .gems ? pay.amount : 0, setAdded: setAdded, remaining: next.cards.count - next.drawn.count, booster: next))
    }

    /// Discard the current booster and put a new sealed one in its place (`discardBooster`).
    public static func discardBooster(_ state: GameState, deps: Deps, now: Int64, id: TokenKind, portalId: String?) throws -> (state: GameState, booster: Booster) {
        let old = getBooster(state, id: id, portalId: portalId)
        let r = try rollNewBooster(state, deps: deps, id: id, portalId: portalId, seq: (old?.seq ?? 0) + 1)
        return (r.state, r.booster)
    }

    /// Reward for a streak day (1-based, cycles every 21 days) (`dailyRewardFor`).
    public static func dailyRewardFor(day: Int) -> DailyReward {
        let table = dailyRewards
        return table[(max(1, day) - 1) % table.count]
    }

    /// Claim the daily reward on the first open of a UTC day (`claimDaily`): consecutive days advance the streak,
    /// a missed day resets it to 1.
    public static func claimDaily(_ state: GameState, now: Int64) -> (state: GameState, info: DailyClaim) {
        let today = JSDate.utcDay(now)
        let d = state.daily
        if d.lastClaim == today { return (state, DailyClaim(claimed: false, day: d.streak, reward: nil)) }
        let streak = d.lastClaim == JSDate.previousDay(today) ? d.streak + 1 : 1
        let reward = dailyRewardFor(day: streak)
        var s = state
        s.daily.streak = streak
        s.daily.lastClaim = today
        if let g = reward.gems, g != 0 { s = PlayerOps.addGems(s, amount: g) }
        if let st = reward.stamina, st != 0 { s = PlayerOps.addPotions(s, kind: .stamina, count: st) }
        if let m = reward.mana, m != 0 { s = PlayerOps.addPotions(s, kind: .mana, count: m) }
        if let t = reward.tokens { s = PlayerOps.addTokens(s, kind: t, count: reward.count ?? 1, portalId: nil) }
        var out = reward
        out.day = streak
        return (s, DailyClaim(claimed: true, day: streak, reward: out))
    }

    /// Is the Great Potion Deal purchasable now? (`potionDealAvailable`: event day, once per day.)
    public static func potionDealAvailable(_ state: GameState, now: Int64, event: DailyEventId?) -> Bool {
        event == .greatPotionDeal && state.daily.potionDealDay != JSDate.utcDay(now)
    }

    /// Buy the Great Potion Deal (`buyPotionDeal`): 2 stamina + 1 mana potion for 60 gems, once per event day.
    public static func buyPotionDeal(_ state: GameState, now: Int64, event: DailyEventId?) throws -> (state: GameState, cost: Int) {
        if !potionDealAvailable(state, now: now, event: event) { throw GameError("The potion deal is not available") }
        var s = try PlayerOps.spendGems(state, amount: potionDealGems)
        s = PlayerOps.addPotions(s, kind: .stamina, count: 2)
        s = PlayerOps.addPotions(s, kind: .mana, count: 1)
        s.daily.potionDealDay = JSDate.utcDay(now)
        return (s, potionDealGems)
    }

    /// The main-line album sets in their page order, limited to cards the database knows (`albumSets`).
    public static func albumSets(deps: Deps) -> [AlbumSet] {
        Constants.sets.filter { $0.album }.map { s in
            AlbumSet(id: s.id, name: s.name, gemReward: s.setReward, cards: s.cards.filter { deps.db.get($0) != nil })
        }.filter { !$0.cards.isEmpty }
    }

    /// Set collection pages: the main set, every portal, then the album sets (`setCollections`).
    public static func setCollections(_ state: GameState, deps: Deps) -> [SetCollection] {
        guard let q = deps.quests else { return [] }
        let owned = Set(state.cards.map { $0.cardId })
        var lines: [(id: String, name: String, cards: [String], gemReward: Int)] = [(q.main.id, q.main.name, q.main.cards, q.main.gemReward)]
        for p in q.portals { lines.append((p.id, p.name, p.cards, p.gemReward)) }
        for a in albumSets(deps: deps) { lines.append((a.id, a.name, a.cards, a.gemReward)) }
        return lines.map { line in
            let cards = line.cards.map { SetCollectionCard(cardId: $0, owned: owned.contains($0)) }
            let ownedCount = cards.filter { $0.owned }.count
            return SetCollection(id: line.id, name: line.name, reward: line.gemReward, cards: cards, ownedCount: ownedCount, total: cards.count,
                                 complete: ownedCount == cards.count && !cards.isEmpty, claimed: state.collections.claimed.contains(line.id))
        }
    }

    /// Owned set cards the album has not shown yet (`albumNewCards`); a save without the list shows none.
    public static func albumNewCards(_ state: GameState, deps: Deps) -> [String] {
        guard let seen = state.collections.seen else { return [] }
        let known = Set(seen)
        var out: [String] = []
        var added = Set<String>()
        for set in setCollections(state, deps: deps) {
            for c in set.cards where c.owned && !known.contains(c.cardId) && !added.contains(c.cardId) {
                added.insert(c.cardId)
                out.append(c.cardId)
            }
        }
        return out
    }

    /// Mark cards as shown by the album (`markAlbumSeen`); the same state when nothing is new.
    public static func markAlbumSeen(_ state: GameState, cardIds: [String]) -> GameState {
        let seen = state.collections.seen ?? []
        let add = cardIds.filter { !seen.contains($0) }
        if add.isEmpty { return state }
        var s = state
        s.collections.seen = seen + add
        return s
    }

    /// Claim the gem reward of a completed set, once (`claimCollection`).
    public static func claimCollection(_ state: GameState, deps: Deps, setId: String) throws -> (state: GameState, gems: Int) {
        guard let col = setCollections(state, deps: deps).first(where: { $0.id == setId }) else { throw GameError("Unknown set") }
        if !col.complete { throw GameError("The set is not complete") }
        if col.claimed { throw GameError("Already claimed") }
        var s = PlayerOps.addGems(state, amount: col.reward)
        s.collections.claimed = s.collections.claimed + [setId]
        return (s, col.reward)
    }

    /// Everything the Shop screen lists, priced for today (`shopOffers`): Neophyte, the running portal's two packs,
    /// the next portal's two as "coming soon", Summoner, Archmage; the potion deal; the gem packs.
    public static func shopOffers(_ state: GameState, deps: Deps, now: Int64, portal: ShopPortalChoice = .rotation) -> ShopOffers {
        let event = dailyEvent(now: PlayerOps.eventClock(state, now: now), state: state)
        let eventId = event?.id
        let portals = deps.quests?.portals ?? []
        var running: String? = nil
        var endsAt: Int64 = 0
        var next: String? = nil
        switch portal {
        case .rotation:
            if let sch = QuestOps.portalSchedule(deps: deps, createdAt: state.createdAt, now: now), QuestOps.questLine(deps: deps, lineId: sch.portalId) != nil {
                running = sch.portalId
                endsAt = sch.endsAt
                if portals.count > 1 { next = portals[(sch.index + 1) % portals.count].id }
            }
        case .none:
            break
        case .portal(let pid):
            if !pid.isEmpty, pid != "main", QuestOps.questLine(deps: deps, lineId: pid) != nil {
                running = pid
                if portals.count > 1, let i = portals.firstIndex(where: { $0.id == pid }) { next = portals[(i + 1) % portals.count].id }
            }
        }
        func offer(_ id: TokenKind, _ pid: String?, pre: Bool = false, endsInMs: Int64 = 0, startsInMs: Int64 = 0) -> BoosterOffer {
            let b = booster(id)
            let line = pid.flatMap { QuestOps.questLine(deps: deps, lineId: $0) }
            let bst = getBooster(state, id: id, portalId: pid)
            var name = b.pack.name
            if let l = line, let info = l.tokens?.info(id == .portalLow ? .portalLow : .portalHigh) {
                name = stripTokenSuffix(info.name)
            }
            return BoosterOffer(id: id, name: name, setName: line?.name, portalId: pid, pickGems: b.pack.pickGems,
                                price: boosterPrice(id, event: eventId), discounted: eventId == .getTheBestCards,
                                tokens: PlayerOps.tokenCount(state, kind: id, portalId: pid),
                                left: bst.map { $0.cards.count - $0.drawn.count } ?? boosterCards,
                                pre: pre, endsInMs: endsInMs, startsInMs: startsInMs, mayContain: b.mayContain)
        }
        var items = [offer(.neophyte, nil)]
        if let r = running {
            let endsInMs: Int64 = endsAt != 0 ? max(0, endsAt - now) : 0
            items.append(offer(.portalLow, r, endsInMs: endsInMs))
            items.append(offer(.portalHigh, r, endsInMs: endsInMs))
        }
        if let n = next, n != running {
            let startsInMs: Int64 = endsAt != 0 ? max(0, endsAt - now) : 0
            items.append(offer(.portalLow, n, pre: true, startsInMs: startsInMs))
            items.append(offer(.portalHigh, n, pre: true, startsInMs: startsInMs))
        }
        items.append(offer(.summoner, nil))
        items.append(offer(.archmage, nil))
        return ShopOffers(event: event, boosters: items,
                          potionDeal: potionDealAvailable(state, now: now, event: eventId) ? PotionDeal(gems: potionDealGems, potions: potionDealCount) : nil,
                          gemPacks: Constants.gemPacks)
    }

    /// `name.replace(/ token$/i, '')`.
    static func stripTokenSuffix(_ name: String) -> String {
        let suffix = " token"
        if name.count >= suffix.count, name.lowercased().hasSuffix(suffix) {
            return String(name.dropLast(suffix.count))
        }
        return name
    }
}
