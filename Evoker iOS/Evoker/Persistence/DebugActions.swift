import Foundation
import EvokerCore

/// The debug API of the web (`Evoker Web/src/app.js` `window.evoker.debug`, architecture.md 8.5), one method per
/// entry, each going through `GameStore.update` / `set` so it autosaves and publishes like any other change.
/// Reached as `store.debug`; meant for a debug menu and UI tests, never for the game's own flows.
@MainActor
struct DebugActions {
    let store: GameStore

    init(store: GameStore) {
        self.store = store
    }

    /// `giveGold(n)`: `addGold`.
    func giveGold(_ n: Int) {
        store.updateState { s, _, _ in PlayerOps.addGold(s, amount: n) }
    }

    /// `giveGems(n)`: `addGems`.
    func giveGems(_ n: Int) {
        store.updateState { s, _, _ in PlayerOps.addGems(s, amount: n) }
    }

    /// `givePotions(stamina, mana)`: stamina potions first, then mana potions.
    func givePotions(stamina: Int = 0, mana: Int = 0) {
        store.updateState { s, _, _ in
            PlayerOps.addPotions(PlayerOps.addPotions(s, kind: .stamina, count: stamina), kind: .mana, count: mana)
        }
    }

    /// `giveTokens(kind, n, portalId)`: the portal kinds need `portalId`.
    func giveTokens(_ kind: TokenKind = .neophyte, _ n: Int = 1, portalId: String? = nil) {
        store.updateState { s, _, _ in PlayerOps.addTokens(s, kind: kind, count: n, portalId: portalId) }
    }

    /// `setLevel(n)`: level clamped to 1...200, xp reset (`updatePlayer`).
    func setLevel(_ n: Int) {
        store.updateState { s, _, _ in
            var next = s
            next.player.level = max(1, min(PlayerOps.maxLevel, n))
            next.player.xp = 0
            return next
        }
    }

    /// `addCard(cardId, stage, level)`: a forced `addCard` (never sold for the inventory limit); the new uid.
    @discardableResult
    func addCard(_ cardId: String, stage: Int = 0, level: Int = 1) throws -> String? {
        return try store.update { s, d, _ in
            let r = try CollectionOps.addCard(s, deps: d, cardId: cardId, stage: stage, level: level, force: true)
            return (state: r.state, info: r.info.uid)
        }
    }

    /// `maxCards()`: every owned card to the level cap of its current stage (stage unchanged), xp reset.
    func maxCards() {
        store.updateState { s, d, _ in
            var next = s
            next.cards = s.cards.map { card in
                guard let def = d.db.get(card.cardId) else { return card }
                var copy = card
                copy.level = CollectionOps.capFor(deps: d, def: def, stage: card.stage)
                copy.xp = 0
                return copy
            }
            return next
        }
    }

    /// `refill()`: stamina and mana to their max.
    func refill() {
        store.updateState { s, _, _ in
            var next = s
            next.player.stamina = s.player.staminaMax
            next.player.mana = s.player.manaMax
            return next
        }
    }

    /// `unlockQuests(n)`: the main line's `unlocked` raised to n (at most 100, never lowered).
    func unlockQuests(_ n: Int) {
        store.updateState { s, _, _ in
            var next = s
            next.quests.main.unlocked = max(s.quests.main.unlocked, min(100, n))
            return next
        }
    }

    /// `unlockAll()`: every quest line beaten (main and portals, `questsDone` raised by the main quests that were
    /// not done), one ++++ max-level copy of every card not already owned at ++++, and max mana raised to the
    /// costliest possible 5-card deck (then refilled).
    func unlockAll() throws {
        try store.updateState { s, d, _ in
            var next = s
            if let quests = d.quests {
                var portals = s.quests.portals
                for line in quests.portals {
                    portals[line.id] = DebugActions.lineDone(line)
                }
                let doneMain = quests.main.nodes.count - s.quests.main.done
                next.quests.main = DebugActions.lineDone(quests.main)
                next.quests.portals = portals
                next.player.questsDone = s.player.questsDone + max(0, doneMain)
            }
            let top = Set(next.cards.filter { $0.stage == 4 }.map { $0.cardId })
            for def in d.db.all() where !top.contains(def.id) {
                let cap = CollectionOps.capFor(deps: d, def: def, stage: 4)
                next = try CollectionOps.addCard(next, deps: d, cardId: def.id, stage: 4, level: cap, force: true).state
            }
            let deckMana = d.db.all().map { $0.mana }.sorted(by: >).prefix(5).reduce(0, +)
            let manaMax = max(next.player.manaMax, deckMana)
            next.player.manaMax = manaMax
            next.player.mana = manaMax
            return next
        }
    }

    /// `addDays(n)`: the save's dates move back by n days (`StoreHelpers.addDays`), `daily.dayShift` grows by n
    /// so the daily event follows (`PlayerOps.eventClock`), then the open hooks run (`openSave`). Returns their
    /// notices (nil without a save). `StoreHelpers.addDays` is documented as bumping `dayShift` itself; the shift
    /// is added here only when it did not, so the result is the web's either way.
    @discardableResult
    func addDays(_ n: Int) -> OnOpenResult? {
        guard let s = store.state else { return nil }
        let before = s.daily.dayShift ?? 0
        var shifted = StoreHelpers.addDays(s, days: n)
        if (shifted.daily.dayShift ?? 0) == before {
            shifted.daily.dayShift = before + n
        }
        return store.open(shifted)
    }

    /// `reset()`: drop the save (the title screen follows).
    func reset() {
        store.reset()
    }

    /// `newGame(name)`: a fresh save (`GameStore.newGame`), replacing the current one.
    @discardableResult
    func newGame(name: String = "Evoker") -> OnOpenResult {
        return store.newGame(name: name)
    }

    /// `lineDone(line)`: a quest line fully beaten (`unlocked` = `done` = node count, every node a first win).
    private static func lineDone(_ line: QuestLine) -> LineProgress {
        let count = line.nodes.count
        return LineProgress(unlocked: count, done: count, firstWins: line.nodes.map { $0.n })
    }
}
