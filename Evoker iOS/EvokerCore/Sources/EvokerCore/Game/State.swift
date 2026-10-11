import Foundation

/// Save schema, new game, migration and the small selectors shared by every game module: a literal port of
/// `Evoker Web/src/game/state.js`. Every function is pure: `(state, …) -> state` or `(state, …) -> (state, info)`.
public enum StateOps {
    public static let saveVersion = GameState.saveVersion
    public static let saveKey = GameState.saveKey
    public static let startDeckSlots = Constants.DeckSlots.start

    /// Slot indices in the order they open (state.js DECK_SLOT_ORDER).
    static let deckSlotOrder = Constants.DeckSlots.order
    /// DECK_SLOT_QUESTS as `Object.entries` iterates it (integer-like keys ascending): (open-slot count, quest).
    static let deckSlotQuests: [(count: Int, quest: Int)] = Constants.DeckSlots.quests.sorted { $0.key < $1.key }.map { ($0.key, $0.value) }

    /// The empty save with every default filled in (`defaultState`).
    public static func defaultState(now: Int64, seed: UInt32) -> GameState {
        var player = PlayerState()
        player.regenAt = now
        return GameState(version: saveVersion, createdAt: now, lastSeen: now, seed: seed, rngStep: 0, uidCounter: 0,
                         player: player, cards: [], deck: [nil, nil, nil, nil, nil], pieces: [], quests: QuestsState(),
                         sim: SimState(), daily: DailyState(), collections: CollectionsState(), boosters: [:], replays: [],
                         settings: Settings(), tutorial: TutorialState(), notices: [])
    }

    /// A brand-new save with the starter collection and deck (`newGame`): Envoy in deck slot 3, Master Brewer in
    /// the collection, the first day already claimed (streak 0). No tutorial record: the app sets
    /// `TutorialRecord.newGame` afterwards.
    public static func newGame(name: String, seed: UInt32, now: Int64, deps: Deps?) -> GameState {
        var state = defaultState(now: now, seed: seed)
        state.player.name = JSString.slice(name.isEmpty ? "Evoker" : name, 20)
        var cards: [CardInstance] = []
        var uidByCard: [String: String] = [:]
        for cardId in Constants.starterCards {
            if let db = deps?.db, db.get(cardId) == nil { continue }
            let r = nextUid(state)
            state = r.state
            cards.append(CardInstance(uid: r.uid, cardId: cardId, stage: 0, level: 1, xp: 0, evolveQuality: 1))
            uidByCard[cardId] = r.uid
        }
        // STARTER_DECK: STARTER_CARDS[i] sits in slot STARTER_DECK_SLOTS[i]
        var deck: [String?] = [nil, nil, nil, nil, nil]
        for (i, cardId) in Constants.starterCards.enumerated() {
            guard let slot = Constants.starterDeckSlots[js: i], slot >= 0, slot < 5 else { continue }
            deck[slot] = uidByCard[cardId]
        }
        state.cards = cards
        state.deck = deck
        // the first day pays no daily reward: day 1 of the calendar is claimed on the next day's first open
        state.daily.streak = 0
        state.daily.lastClaim = JSDate.utcDay(now)
        return state
    }

    /// Open-slot count a save written before round 3 gets (`legacyDeckSlots`), from the raw save JSON: never fewer
    /// than the legacy level table gave it, than its quest progress earns, or than needed to keep every card it has
    /// in the deck on an open slot.
    public static func legacyDeckSlots(rawSave: JSONValue) -> Int {
        // (save.player && Number(save.player.level)) || 1
        var level: Double = 1
        if let n = JSValue.number(rawSave["player"]?["level"]), n != 0, !n.isNaN { level = n }
        let legacy = Constants.slotUnlockLevels.filter { level >= Double($0) }.count
        var cover = 0
        if case .array(let deck)? = rawSave["deck"] {
            for (i, uid) in deck.enumerated() where JSValue.truthy(uid) {
                cover = max(cover, (deckSlotOrder.firstIndex(of: i) ?? -1) + 1)
            }
        }
        var wins: [Int] = []
        if case .array(let list)? = rawSave["quests"]?["main"]?["firstWins"] {
            for v in list { if case .number(let d) = v, d == d.rounded(.towardZero) { wins.append(Int(d)) } }
        }
        return min(5, max(startDeckSlots, legacy, cover, slotsForQuestWins(wins)))
    }

    /// Open-slot count earned by main-quest first wins (`slotsForQuestWins`).
    public static func slotsForQuestWins(_ firstWins: [Int]) -> Int {
        var n = startDeckSlots
        for (count, quest) in deckSlotQuests where firstWins.contains(quest) {
            n = max(n, count)
        }
        return n
    }

    /// The remaining migration rules after the lenient decoding (`migrate`): version, the audio defaults of saves
    /// without volume fields, the clock defaults of missing fields, legacy deck slots, the album seen list and the
    /// uid counter. `rawJSON` is the save as parsed (nil when the state did not come from JSON: the rules that
    /// look at the raw save then look at the encoded state instead).
    public static func migrated(_ decoded: GameState, rawJSON: JSONValue?, now: Int64) -> GameState {
        var s = decoded
        s.version = saveVersion
        let raw: JSONValue = rawJSON ?? ((try? JSONValue.of(decoded)) ?? .object([:]))
        let fromJSON = rawJSON != nil
        // defaultState(now, …) fills the clocks of fields a partial save lacks
        if fromJSON {
            if raw["createdAt"] == nil { s.createdAt = now }
            if raw["lastSeen"] == nil { s.lastSeen = now }
            let rawPlayer = raw["player"]
            if rawPlayer == nil || rawPlayer?.objectValue == nil || rawPlayer?["regenAt"] == nil { s.player.regenAt = now }
        }
        // Saves written before the audio module existed carry sound:false from the old 'no audio ships' default;
        // it was never a player choice, so a save without the volume fields gets audio on with the default volumes.
        let rawSettings = raw["settings"]
        if rawSettings == nil || rawSettings?.objectValue == nil || rawSettings?["musicVolume"] == nil {
            let base = Settings()
            s.settings.sound = true
            s.settings.musicVolume = base.musicVolume
            s.settings.fxVolume = base.fxVolume
        }
        if s.deck.count != 5 { s.deck = [nil, nil, nil, nil, nil] }
        // League fields of saves from before round 3 stay unknown (nil) so that league.js can read the old league
        // instead: hasJoined() counts an old league as joined and leagueTierOf() keeps its tier. The decoder does
        // this for a `sim` object without the keys; a save without any `sim` object gets the same treatment here.
        let rawSim = raw["sim"]?.objectValue ?? [:]
        if rawSim["leagueJoined"] == nil { s.sim.leagueJoined = nil }
        if rawSim["leagueTier"] == nil { s.sim.leagueTier = nil }
        // Saves from before round 3 used level-based deck slots: size the new quest-based slot count so that no
        // slot that was open (or holds a card) gets locked. Number(deckSlots): null → 0 → clamped to 1.
        var rawSlots: Double? = nil
        if let p = raw["player"], p.objectValue != nil, let v = p["deckSlots"] { rawSlots = JSValue.number(v) }
        if let n = rawSlots, n.isFinite {
            s.player.deckSlots = max(1, min(5, Int(n.rounded(.towardZero))))
        } else {
            s.player.deckSlots = legacyDeckSlots(rawSave: raw)
        }
        // Saves from before the album badge (round 5): every card they own counts as seen.
        var seenIsArray = false
        if case .array? = raw["collections"]?["seen"] { seenIsArray = true }
        if !seenIsArray || s.collections.seen == nil {
            var seen: [String] = []
            var known = Set<String>()
            for c in s.cards where !known.contains(c.cardId) {
                known.insert(c.cardId)
                seen.append(c.cardId)
            }
            s.collections.seen = seen
        }
        // uidCounter must be above every uid in the save
        var maxUid = s.uidCounter
        for c in s.cards {
            if let n = uidNumber(c.uid) { maxUid = max(maxUid, n) }
        }
        s.uidCounter = maxUid
        return s
    }

    /// The number of a "c<n>" uid (`/^c(\d+)$/`).
    static func uidNumber(_ uid: String) -> Int? {
        guard uid.hasPrefix("c"), uid.count > 1 else { return nil }
        let digits = uid.dropFirst()
        guard digits.allSatisfy({ $0 >= "0" && $0 <= "9" }) else { return nil }
        return Int(digits)
    }

    /// Drop what a save refers to that the game no longer has (`pruneRemoved`): unknown cards leave the collection
    /// and the deck, unknown portal records, an active quest on an unknown line, a manual portal choice and
    /// claimed / seen entries of unknown sets or cards go. Returns the same state when nothing had to go.
    public static func pruneRemoved(_ state: GameState, deps: Deps) -> GameState {
        let db = deps.db
        var lines: Set<String> = ["main"]
        for p in deps.quests?.portals ?? [] { lines.insert(p.id) }
        var changed = false
        let cards = state.cards.filter { db.get($0.cardId) != nil }
        if cards.count != state.cards.count { changed = true }
        let uids = Set(cards.map { $0.uid })
        let deck: [String?] = state.deck.map { uid in
            if let u = uid, !u.isEmpty, uids.contains(u) { return u }
            return nil
        }
        for (a, b) in zip(deck, state.deck) where a != b { changed = true }
        var portals: [String: LineProgress] = [:]
        for (id, rec) in state.quests.portals {
            if lines.contains(id) { portals[id] = rec } else { changed = true }
        }
        var active = state.quests.active
        if let a = active, !a.line.isEmpty, !lines.contains(a.line) {
            active = nil
            changed = true
        }
        var manualPortal = state.quests.manualPortal
        if let m = manualPortal, !m.isEmpty, !lines.contains(m) {
            manualPortal = nil
            changed = true
        }
        let claimed = state.collections.claimed.filter { lines.contains($0) }
        let seenList = state.collections.seen ?? []
        let seen = seenList.filter { db.get($0) != nil }
        if claimed.count != state.collections.claimed.count || seen.count != seenList.count { changed = true }
        if !changed { return state }
        var s = state
        s.cards = cards
        s.deck = deck
        s.quests.portals = portals
        s.quests.active = active
        s.quests.manualPortal = manualPortal
        s.collections.claimed = claimed
        s.collections.seen = seen
        return s
    }

    /// Allocate the next card uid ("c<n>").
    public static func nextUid(_ state: GameState) -> (state: GameState, uid: String) {
        let n = state.uidCounter + 1
        var s = state
        s.uidCounter = n
        return (s, "c\(n)")
    }

    /// Draw a fresh seeded generator from the save and advance its counter (`takeRng`).
    public static func takeRng(_ state: GameState, deps: Deps) -> (state: GameState, rng: RandomSource, seed: UInt32) {
        let step = state.rngStep + 1
        let seed = Seeds.mixSeed(state.seed, step)
        var s = state
        s.rngStep = step
        return (s, deps.rng(seed), seed)
    }

    public static func getCard(_ state: GameState, uid: String) -> CardInstance? {
        state.cards.first { $0.uid == uid }
    }

    /// Card instances in deck order (nil for empty slots).
    public static func deckCards(_ state: GameState) -> [CardInstance?] {
        state.deck.map { uid in
            guard let u = uid, !u.isEmpty else { return nil }
            return getCard(state, uid: u)
        }
    }

    /// Sum of mana costs of the cards in the deck.
    public static func deckMana(_ state: GameState, deps: Deps) -> Int {
        deckCards(state).reduce(0) { sum, c in
            guard let c = c, let def = deps.db.get(c.cardId) else { return sum }
            return sum + def.mana
        }
    }

    /// Number of open deck slots (1..5): the stored count, never below what the main-quest first wins earn.
    public static func deckSlotCount(_ state: GameState) -> Int {
        let base = state.player.deckSlots ?? startDeckSlots
        return max(1, min(5, max(base, slotsForQuestWins(state.quests.main.firstWins))))
    }

    /// Is a deck slot (0..4) open? Slots open by quest progress, in `DECK_SLOTS.order`.
    public static func slotUnlocked(_ state: GameState, slot: Int) -> Bool {
        guard slot >= 0, slot < 5, let i = deckSlotOrder.firstIndex(of: slot) else { return false }
        return i < deckSlotCount(state)
    }

    /// Open deck slots after a quest win (`unlockSlotsForQuest`): the first win of main Q2 / Q4 / Q7 opens the
    /// 3rd / 4th / 5th slot; `slots` = the new open-slot count when one opened.
    public static func unlockSlotsForQuest(_ state: GameState, lineId: String, n: Int) -> (state: GameState, slots: Int?) {
        if lineId != "main" { return (state, nil) }
        let before = state.player.deckSlots ?? startDeckSlots
        var target = before
        for (count, quest) in deckSlotQuests where quest == n { target = max(target, count) }
        if target <= before { return (state, nil) }
        var s = state
        s.player.deckSlots = target
        return (s, target)
    }

    /// Is a feature available? (`isUnlocked`): by main-quest first wins on a save with a tutorial record, else by
    /// player level. Deck slots: `isCardSlotUnlocked`.
    public static func isUnlocked(_ state: GameState, _ feature: Feature) -> Bool {
        guard let need = Constants.featureUnlockLevels[feature] else { return false }
        if let quest = Constants.featureUnlockQuests[feature], unlocksByQuest(state) {
            return state.quests.main.firstWins.contains(quest)
        }
        return state.player.level >= need
    }

    /// `isUnlocked(state, 'cardslotN')`, N 1-based.
    public static func isCardSlotUnlocked(_ state: GameState, slotNumber: Int) -> Bool {
        guard slotNumber >= 1, slotNumber <= 5 else { return false }
        return slotUnlocked(state, slot: slotNumber - 1)
    }

    /// Does this save open its features by main-quest wins (a tutorial record exists)?
    public static func unlocksByQuest(_ state: GameState) -> Bool {
        state.tutorial.r3 != nil
    }

    /// Is the first-session tutorial still running on this save (a record that is not `done`)?
    public static func inTutorial(_ state: GameState) -> Bool {
        guard let r3 = state.tutorial.r3 else { return false }
        return !r3.done
    }

    /// Features whose "… Unlocked!" popup belongs to a level-up (`featuresUnlockedAt`); none for a quest-unlock save.
    public static func featuresUnlockedAt(level: Int, state: GameState?) -> [Feature] {
        if let s = state, unlocksByQuest(s) { return [] }
        return Feature.popupFeatures.filter { Constants.featureUnlockLevels[$0] == level }
    }

    /// Append a login notice (`addNotice`).
    public static func addNotice(_ state: GameState, _ notice: Notice) -> GameState {
        var s = state
        s.notices.append(notice)
        return s
    }

    /// Touch `lastSeen`.
    public static func touch(_ state: GameState, now: Int64) -> GameState {
        var s = state
        s.lastSeen = now
        return s
    }

    /// Replace fields of one card instance (`updateCard`).
    static func updateCard(_ state: GameState, uid: String, _ change: (inout CardInstance) -> Void) -> GameState {
        var s = state
        s.cards = s.cards.map { c in
            guard c.uid == uid else { return c }
            var copy = c
            change(&copy)
            return copy
        }
        return s
    }
}
