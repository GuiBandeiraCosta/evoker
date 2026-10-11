import Foundation

/// Sort orders of the Cards screen (collection.js sortCards `order`).
public enum CardSortOrder: String, Codable, Sendable, Hashable {
    case `default`, level, mana, name, rarity, attack
}

/// Collection: add / remove / sell / sort, the 100-card inventory, deck editing, card xp (game-design §2): a
/// literal port of `Evoker Web/src/game/collection.js`.
public enum CollectionOps {
    public static let collectionLimit = Constants.collectionLimit

    /// Level cap of a card at a stage (`capFor` → stats.capFor).
    public static func capFor(deps: Deps, def: CardDef, stage: Int) -> Int {
        deps.stats.capFor(def, stage: stage)
    }

    /// Add a card instance (`addCard`). At or over the inventory size the card is sold automatically unless
    /// `force` (boosters, fusion and completed pieces always add the card).
    public static func addCard(_ state: GameState, deps: Deps, cardId: String, stage: Int = 0, level: Int = 1, evolveQuality: Double? = nil, force: Bool = false) throws -> (state: GameState, info: AddCardResult) {
        guard let def = deps.db.get(cardId) else { throw GameError("Unknown card " + cardId) }
        let st = max(0, min(4, stage))
        let lv = max(1, min(capFor(deps: deps, def: def, stage: st), level == 0 ? 1 : level))
        if !force && state.cards.count >= collectionLimit {
            let gold = deps.stats.sellValue(def, stage: st, level: lv)
            return (PlayerOps.addGold(state, amount: gold), AddCardResult(uid: nil, converted: true, gold: gold))
        }
        let r = StateOps.nextUid(state)
        let inst = CardInstance(uid: r.uid, cardId: cardId, stage: st, level: lv, xp: 0, evolveQuality: evolveQuality ?? 1)
        var s = r.state
        s.cards.append(inst)
        return (s, AddCardResult(uid: r.uid, converted: false, gold: 0))
    }

    /// Card definitions of a rarity, optionally restricted to a set of ids; never trainers (`cardsOfRarity`).
    public static func cardsOfRarity(_ db: CardsDb, rarity: Rarity, setIds: [String]?) -> [CardDef] {
        let all = db.byRarity(rarity).filter { !$0.isTrainer }
        guard let ids = setIds else { return all }
        return all.filter { ids.contains($0.id) }
    }

    /// Remove an instance and clear it from the deck (`removeCard`).
    public static func removeCard(_ state: GameState, uid: String) -> GameState {
        var s = state
        s.cards = state.cards.filter { $0.uid != uid }
        s.deck = state.deck.map { $0 == uid ? nil : $0 }
        return s
    }

    public static func isInDeck(_ state: GameState, uid: String) -> Bool {
        state.deck.contains { $0 == uid }
    }

    /// Gold a card would sell for (`sellValueOf`).
    public static func sellValueOf(_ state: GameState, deps: Deps, uid: String) -> Int {
        guard let c = StateOps.getCard(state, uid: uid), let def = deps.db.get(c.cardId) else { return 0 }
        return deps.stats.sellValue(def, stage: c.stage, level: c.level)
    }

    /// Sell a card for gold (`sellCard`); cards in the active deck cannot be sold.
    public static func sellCard(_ state: GameState, deps: Deps, uid: String) throws -> (state: GameState, gold: Int) {
        guard StateOps.getCard(state, uid: uid) != nil else { throw GameError("No such card") }
        if isInDeck(state, uid: uid) { throw GameError("Cards in the active deck cannot be sold") }
        let gold = sellValueOf(state, deps: deps, uid: uid)
        return (PlayerOps.addGold(removeCard(state, uid: uid), amount: gold), gold)
    }

    /// Sort instances (`sortCards`): the default order is level desc, mana desc, name asc.
    public static func sortCards(_ cards: [CardInstance], db: CardsDb, order: CardSortOrder = .default, stats: StatsProviding? = nil) -> [CardInstance] {
        typealias Cmp = (CardInstance, CardInstance) -> Int
        let def: (CardInstance) -> CardDef? = { db.get($0.cardId) }
        let byName: Cmp = { a, b in JSString.localeCompare(def(a)?.name ?? "", def(b)?.name ?? "") }
        let byLevel: Cmp = { a, b in b.level - a.level }
        let byMana: Cmp = { a, b in (def(b)?.mana ?? 0) - (def(a)?.mana ?? 0) }
        let byRarity: Cmp = { a, b in (def(b)?.rarity.index ?? -1) - (def(a)?.rarity.index ?? -1) }
        let byStage: Cmp = { a, b in b.stage - a.stage }
        func chain(_ fns: [Cmp]) -> Cmp {
            return { a, b in
                for f in fns {
                    let r = f(a, b)
                    if r != 0 { return r }
                }
                return 0
            }
        }
        let cmp: Cmp
        switch order {
        case .default: cmp = chain([byLevel, byMana, byName])
        case .level: cmp = chain([byLevel, byStage, byMana, byName])
        case .mana: cmp = chain([byMana, byLevel, byName])
        case .name: cmp = chain([byName, byLevel])
        case .rarity: cmp = chain([byRarity, byMana, byLevel, byName])
        case .attack:
            if let stats = stats {
                let attack: (CardInstance) -> Double = { c in
                    guard let d = def(c) else { return 0 }
                    return stats.statAt(d, .attack, stage: c.stage, level: c.level, evolveQuality: c.evolveQuality) ?? 0
                }
                let byAttack: Cmp = { a, b in
                    let d = attack(b) - attack(a)
                    return d > 0 ? 1 : (d < 0 ? -1 : 0)
                }
                cmp = chain([byAttack, byName])
            } else {
                cmp = chain([byLevel, byName])
            }
        }
        return cards.sorted { cmp($0, $1) < 0 }
    }

    /// The player's "best card": highest level, then highest mana (`bestCard`).
    public static func bestCard(_ state: GameState, deps: Deps) -> CardInstance? {
        if state.cards.isEmpty { return nil }
        return sortCards(state.cards, db: deps.db, order: .default).first
    }

    /// Put a card in a deck slot, swapping if it already sits elsewhere (`placeInDeck`).
    public static func placeInDeck(_ state: GameState, deps: Deps, uid: String, slot: Int) throws -> (state: GameState, mana: Int) {
        guard StateOps.getCard(state, uid: uid) != nil else { throw GameError("No such card") }
        if !StateOps.slotUnlocked(state, slot: slot) { throw GameError("Slot locked") }
        var deck = state.deck
        let prev = deck.firstIndex { $0 == uid }
        let displaced = deck[slot]
        deck[slot] = uid
        if let p = prev {
            if let d = displaced, !d.isEmpty, d != uid { deck[p] = d } else { deck[p] = nil }
        }
        var next = state
        next.deck = deck
        let v = validateDeck(next, deps: deps)
        if !v.ok { throw GameError(v.reason ?? "Invalid deck") }
        return (next, v.mana)
    }

    /// Empty a deck slot (`removeFromDeck`).
    public static func removeFromDeck(_ state: GameState, slot: Int) -> GameState {
        var s = state
        if slot >= 0 && slot < s.deck.count { s.deck[slot] = nil }
        return s
    }

    /// Replace the whole deck (uids by slot) after validation (`setDeck`).
    public static func setDeck(_ state: GameState, deps: Deps, slots: [String?]) throws -> (state: GameState, mana: Int) {
        let deck: [String?] = (0..<5).map { i in
            guard let u = slots[js: i] ?? nil, !u.isEmpty else { return nil }
            return u
        }
        for i in 0..<5 {
            if let u = deck[i] {
                if StateOps.getCard(state, uid: u) == nil { throw GameError("No such card " + u) }
                if !StateOps.slotUnlocked(state, slot: i) { throw GameError("Slot locked") }
            }
        }
        var next = state
        next.deck = deck
        let v = validateDeck(next, deps: deps)
        if !v.ok { throw GameError(v.reason ?? "Invalid deck") }
        return (next, v.mana)
    }

    /// Check the deck rules (`validateDeck`): no duplicate uid, every uid exists, mana sum <= max mana, at least one card.
    public static func validateDeck(_ state: GameState, deps: Deps) -> DeckValidation {
        let uids = state.deck.compactMap { u -> String? in
            guard let u = u, !u.isEmpty else { return nil }
            return u
        }
        if Set(uids).count != uids.count { return DeckValidation(ok: false, reason: "Duplicate card in deck", mana: 0, count: uids.count) }
        var mana = 0
        for uid in uids {
            guard let c = StateOps.getCard(state, uid: uid) else { return DeckValidation(ok: false, reason: "Missing card " + uid, mana: 0, count: uids.count) }
            mana += deps.db.get(c.cardId)?.mana ?? 0
        }
        if mana > state.player.manaMax { return DeckValidation(ok: false, reason: "Mana needed exceeds your maximum mana", mana: mana, count: uids.count) }
        if uids.isEmpty { return DeckValidation(ok: false, reason: "The deck is empty", mana: mana, count: 0) }
        return DeckValidation(ok: true, reason: nil, mana: mana, count: uids.count)
    }

    /// Add xp to a card instance; levels up while the threshold is met, capped at the stage's level cap (`addCardXp`).
    public static func addCardXp(_ state: GameState, deps: Deps, uid: String, xp: Int) -> (state: GameState, levelUps: [CardLevelUp], capped: Bool) {
        guard let c = StateOps.getCard(state, uid: uid), let def = deps.db.get(c.cardId) else { return (state, [], false) }
        let cap = capFor(deps: deps, def: def, stage: c.stage)
        if c.level >= cap { return (state, [], true) }
        var level = c.level
        var pool = c.xp + max(0, xp)
        let from = level
        while level < cap {
            let need = deps.stats.cardXpToNext(def, level: level, stage: c.stage)
            if pool < need { break }
            pool -= need
            level += 1
        }
        if level >= cap { pool = 0 }
        let finalLevel = level, finalPool = pool
        let next = StateOps.updateCard(state, uid: uid) { $0.level = finalLevel; $0.xp = finalPool }
        return (next, level > from ? [CardLevelUp(uid: uid, from: from, to: level)] : [], level >= cap)
    }

    /// Give fight xp to every card in the deck (`addDeckXp`).
    public static func addDeckXp(_ state: GameState, deps: Deps, xp: Int) -> (state: GameState, levelUps: [CardLevelUp]) {
        var s = state
        var levelUps: [CardLevelUp] = []
        for uid in state.deck {
            guard let u = uid, !u.isEmpty else { continue }
            let r = addCardXp(s, deps: deps, uid: u, xp: xp)
            s = r.state
            levelUps.append(contentsOf: r.levelUps)
        }
        return (s, levelUps)
    }
}
