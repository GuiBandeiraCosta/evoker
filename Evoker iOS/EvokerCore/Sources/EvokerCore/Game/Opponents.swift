import Foundation

/// Max stats of a simulated player (opponents.js simStats).
public struct SimStatsMax: Hashable, Sendable {
    public var hpMax: Int
    public var staminaMax: Int
    public var manaMax: Int
    public init(hpMax: Int, staminaMax: Int, manaMax: Int) { self.hpMax = hpMax; self.staminaMax = staminaMax; self.manaMax = manaMax }
}

/// Simulated players: the pool (generated once, refreshed daily), the AI deck builder, and the helpers that turn
/// a simulated player or the human player into an engine fighter side (game-design §5): a literal port of
/// `Evoker Web/src/game/opponents.js`.
public enum OpponentOps {
    public static let poolSize = Constants.ArenaRules.simulatedPlayers
    public static let dailyLevelChance = 0.3
    public static let staleLevelGap = 5

    /// The tutorial's scripted piece holder "Baltasar" (TUTORIAL_HOLDER).
    public static var tutorialHolder: SimPlayer {
        SimPlayer(id: "sim-tutorial", name: "Baltasar", avatar: 3, level: 2, hpMax: 1500, staminaMax: 50, manaMax: 50,
                  questsDone: 2, battlesWon: 0,
                  deck: [nil, SimDeckCard(cardId: "pouch-tearer", stage: 0, level: 1, evolveQuality: 1),
                         SimDeckCard(cardId: "envoy", stage: 0, level: 1, evolveQuality: 1),
                         SimDeckCard(cardId: "pouch-tearer", stage: 0, level: 1, evolveQuality: 1), nil],
                  bornDay: "")
    }

    /// Rarities a simulated player of a level fields (`raritiesForLevel`).
    public static func raritiesForLevel(_ level: Int) -> [Rarity] {
        if level < 4 { return [.common, .standard] }
        if level < 8 { return [.standard, .uncommon] }
        if level < 15 { return [.uncommon] }
        if level < 25 { return [.uncommon, .rare] }
        if level < 40 { return [.rare] }
        if level < 60 { return [.rare, .heroic] }
        if level < 90 { return [.heroic] }
        if level < 130 { return [.heroic, .legendary] }
        return [.legendary, .ultimate]
    }

    /// Fusion stage a simulated player's cards have at an effective level (`stageForLevel`).
    public static func stageForLevel(_ effLevel: Int) -> Int {
        if effLevel >= 150 { return 4 }
        if effLevel >= 90 { return 3 }
        if effLevel >= 50 { return 2 }
        if effLevel >= 25 { return 1 }
        return 0
    }

    /// Deck slots a simulated player of a level can use (`slotsForLevel`).
    public static func slotsForLevel(_ level: Int) -> [Int] {
        if level < 3 { return [1, 2, 3] }
        if level < 5 { return [1, 2, 3, 4] }
        return [0, 1, 2, 3, 4]
    }

    /// Card level of a simulated deck card (`simCardLevel`).
    public static func simCardLevel(level: Int, power: Double, cap: Int) -> Int {
        max(1, min(cap, JSMath.roundInt((1 + Double(level) * 0.5) * power)))
    }

    /// Max stats of a simulated player (`simStats`).
    public static func simStats(level: Int) -> SimStatsMax {
        SimStatsMax(hpMax: 1500 + 120 * (level - 1), staminaMax: 50 + 4 * (level - 1), manaMax: 50 + 4 * (level - 1))
    }

    /// Build an AI deck for a level and power multiplier within the sim's mana budget (`buildSimDeck`).
    public static func buildSimDeck(rng: RandomSource, deps: Deps, level: Int, power: Double = 1) -> [SimDeckCard?] {
        let db = deps.db
        let effLevel = JSMath.roundInt(Double(level) * power)
        let rarities = raritiesForLevel(effLevel)
        let budget = simStats(level: level).manaMax
        let slots = slotsForLevel(level)
        var deck: [SimDeckCard?] = [nil, nil, nil, nil, nil]
        var manaLeft = budget
        for slot in slots {
            var chosen: CardDef? = nil
            var attempt = 0
            while attempt < 12 && chosen == nil {
                let r: Rarity
                if attempt < 6 {
                    r = rng.pick(rarities) ?? .common
                } else {
                    let idx = max(0, rarities[0].index - 1 - (attempt - 6) / 2)
                    r = Rarity.order[js: idx] ?? .common
                }
                let pool = db.byRarity(r).filter { !$0.isTrainer && $0.mana <= manaLeft }
                if !pool.isEmpty { chosen = rng.pick(pool) }
                attempt += 1
            }
            guard let def = chosen else { continue }
            let stage = stageForLevel(effLevel)
            let lvl = simCardLevel(level: level, power: power, cap: CollectionOps.capFor(deps: deps, def: def, stage: stage))
            deck[slot] = SimDeckCard(cardId: def.id, stage: stage, level: lvl, evolveQuality: 1)
            manaLeft -= def.mana
        }
        return deck
    }

    /// Create one simulated player (`makeSim`).
    public static func makeSim(rng: RandomSource, deps: Deps, id: String, level: Int, day: String, name: String) -> SimPlayer {
        let lvl = max(1, min(Constants.maxPlayerLevel, level))
        let st = simStats(level: lvl)
        let avatar = rng.int(12)
        let questsDone = min(300, lvl * 3 + rng.int(10))
        let battlesWon = lvl * 5 + rng.int(20)
        let deck = buildSimDeck(rng: rng, deps: deps, level: lvl, power: 1)
        return SimPlayer(id: id, name: name, avatar: avatar, level: lvl, hpMax: st.hpMax, staminaMax: st.staminaMax, manaMax: st.manaMax,
                         questsDone: questsDone, battlesWon: battlesWon, deck: deck, bornDay: day)
    }

    /// Generate the whole pool around the player's level, replacing any existing pool (`generatePool`).
    public static func generatePool(_ state: GameState, deps: Deps, now: Int64) -> GameState {
        let t = StateOps.takeRng(state, deps: deps)
        let rng = t.rng
        let names = shuffle(rng: rng, deps.names?.names ?? [])
        let day = JSDate.utcDay(now)
        let base = state.player.level
        var players: [SimPlayer] = []
        for i in 0..<poolSize {
            let offset = -3 + rng.int(9)   // -3 .. +5
            let name = names.isEmpty ? "Evoker \(i + 1)" : names[i % names.count]
            players.append(makeSim(rng: rng, deps: deps, id: "sim-\(i + 1)", level: base + offset, day: day, name: name))
        }
        var s = t.state
        s.sim.players = players
        s.sim.day = day
        s.sim.arena = ArenaState(offers: [], rerollAt: 0)
        return s
    }

    /// Make sure a pool exists and refresh it once per UTC day (`ensurePool`): simulated players gain levels
    /// slowly, players that fell far behind are replaced, decks are rebuilt.
    public static func ensurePool(_ state: GameState, deps: Deps, now: Int64) -> (state: GameState, refreshed: Bool) {
        let day = JSDate.utcDay(now)
        if state.sim.players.isEmpty { return (generatePool(state, deps: deps, now: now), true) }
        if state.sim.day == day { return (state, false) }
        let t = StateOps.takeRng(state, deps: deps)
        let rng = t.rng
        let names = deps.names?.names ?? []
        let base = state.player.level
        let players: [SimPlayer] = state.sim.players.map { sim in
            if sim.level < base - staleLevelGap {
                let name = names.isEmpty ? sim.name : (rng.pick(names) ?? sim.name)
                let level = base - 1 + rng.int(5)
                return makeSim(rng: rng, deps: deps, id: sim.id, level: level, day: day, name: name)
            }
            let level = min(Constants.maxPlayerLevel, sim.level + (rng.chance(dailyLevelChance) ? 1 : 0))
            let st = simStats(level: level)
            var next = sim
            next.level = level
            next.hpMax = st.hpMax
            next.staminaMax = st.staminaMax
            next.manaMax = st.manaMax
            next.deck = buildSimDeck(rng: rng, deps: deps, level: level, power: 1)
            next.battlesWon = sim.battlesWon + rng.int(6)
            next.questsDone = min(300, sim.questsDone + rng.int(3))
            return next
        }
        var s = t.state
        s.sim.players = players
        s.sim.day = day
        s.sim.arena = ArenaState(offers: [], rerollAt: 0)
        return (s, true)
    }

    /// A simulated player by id (`getSim`); the tutorial holder resolves too.
    public static func getSim(_ state: GameState, simId: String) -> SimPlayer? {
        if simId == "sim-tutorial" { return tutorialHolder }
        return state.sim.players.first { $0.id == simId }
    }

    /// Pick `count` distinct simulated players whose level lies in [min, max] relative to the player, falling back
    /// to the nearest levels when too few match (`pickSims`).
    public static func pickSims(_ state: GameState, rng: RandomSource, count: Int, min: Int, max: Int, exclude: [String] = []) -> [SimPlayer] {
        let base = state.player.level
        let excluded = Set(exclude)
        let all = state.sim.players.filter { !excluded.contains($0.id) }
        var pool = all.filter { $0.level >= base + min && $0.level <= base + max }
        if pool.count < count {
            let target = Double(base) + Double(min + max) / 2
            pool = Array(all.sorted { abs(Double($0.level) - target) < abs(Double($1.level) - target) }.prefix(Swift.max(count, 6)))
        }
        var out: [SimPlayer] = []
        while out.count < count && !pool.isEmpty {
            out.append(pool.remove(at: rng.int(pool.count)))
        }
        return out
    }

    /// Info popup data for a simulated player (`simInfo`).
    public static func simInfo(_ sim: SimPlayer, deps: Deps) -> SimInfo {
        let mana: (SimDeckCard) -> Int = { deps.db.get($0.cardId)?.mana ?? 0 }
        let sorted = sim.deck.compactMap { $0 }.sorted { a, b in
            if a.level != b.level { return a.level > b.level }
            return mana(a) > mana(b)
        }
        let best: SimBestCard? = sorted.first.map { c in
            SimBestCard(cardId: c.cardId, stage: c.stage, level: c.level, evolveQuality: c.evolveQuality, name: deps.db.get(c.cardId)?.name)
        }
        return SimInfo(id: sim.id, name: sim.name, avatar: sim.avatar, level: sim.level, stamina: sim.staminaMax, mana: sim.manaMax,
                       hp: sim.hpMax, quests: sim.questsDone, battlesWon: sim.battlesWon, bestCard: best, deckMana: simDeckMana(sim, deps: deps))
    }

    /// Mana sum of a sim's deck (`simDeckMana`).
    public static func simDeckMana(_ sim: SimPlayer, deps: Deps) -> Int {
        sim.deck.compactMap { $0 }.reduce(0) { $0 + (deps.db.get($1.cardId)?.mana ?? 0) }
    }

    /// The `computeStats` callback battle-state.js expects, backed by stats.statAt (`statsAdapter`): attack `|| 0`,
    /// hp `|| 1`, the ability value when the card has one.
    public static func statsAdapter(deps: Deps) -> ComputeStats {
        let stats = deps.stats
        return { cardDef, stage, level, evolveQuality in
            let attack = JSMath.num(stats.statAt(cardDef, .attack, stage: stage, level: level, evolveQuality: evolveQuality))
            var hp = JSMath.num(stats.statAt(cardDef, .hp, stage: stage, level: level, evolveQuality: evolveQuality))
            if hp == 0 { hp = 1 }
            let ability: Double? = cardDef.base.ability != nil ? stats.statAt(cardDef, .ability, stage: stage, level: level, evolveQuality: evolveQuality) : nil
            return CardStats(attack: Int(attack.rounded(.towardZero)), hp: Int(hp.rounded(.towardZero)), ability: ability)
        }
    }

    /// Options object for engine.buildSide (`sideOptions`).
    public static func sideOptions(deps: Deps) -> SideOptions {
        SideOptions(cardsDb: deps.db, computeStats: statsAdapter(deps: deps), tribeBonus: nil)
    }

    /// The human player's fighter side from the current deck (`buildPlayerSide`).
    public static func buildPlayerSide(_ state: GameState, deps: Deps) -> FighterSide {
        let p = state.player
        let player = FighterPlayer(name: p.name, hp: p.hpMax, maxHp: p.hpMax, avatar: p.avatar)
        let cards: [SideEntry?] = StateOps.deckCards(state).map { $0.map { SideEntry.ref($0.ref) } }
        return deps.engine.buildSide(player, cards, options: sideOptions(deps: deps))
    }

    /// Deck instances of a sim scaled by a power multiplier (`scaledSimDeck`): levels scaled, clamped to caps.
    public static func scaledSimDeck(_ sim: SimPlayer, deps: Deps, power: Double) -> [CardRef?] {
        sim.deck.enumerated().map { i, c -> CardRef? in
            guard let c = c, let def = deps.db.get(c.cardId) else { return nil }
            let level = max(1, min(CollectionOps.capFor(deps: deps, def: def, stage: c.stage), JSMath.roundInt(Double(c.level) * power)))
            return CardRef(uid: sim.id + "-" + String(i), cardId: c.cardId, stage: c.stage, level: level, evolveQuality: c.evolveQuality)
        }
    }

    /// Build a simulated player's fighter side (`buildSimSide`).
    public static func buildSimSide(_ sim: SimPlayer, deps: Deps, power: Double = 1) -> FighterSide {
        let hp = JSMath.roundInt(Double(sim.hpMax) * power)
        let player = FighterPlayer(name: sim.name, hp: hp, maxHp: hp, avatar: sim.avatar, level: sim.level)
        let cards: [SideEntry?] = scaledSimDeck(sim, deps: deps, power: power).map { $0.map { SideEntry.ref($0) } }
        return deps.engine.buildSide(player, cards, options: sideOptions(deps: deps))
    }

    /// Mana the player's current deck costs to field (`pvpManaCost`).
    public static func pvpManaCost(_ state: GameState, deps: Deps) -> Int {
        StateOps.deckMana(state, deps: deps)
    }

    /// Fisher–Yates with the seeded rng (`shuffle`), on a copy.
    public static func shuffle<T>(rng: RandomSource, _ arr: [T]) -> [T] {
        var a = arr
        var i = a.count - 1
        while i > 0 {
            let j = rng.int(i + 1)
            a.swapAt(i, j)
            i -= 1
        }
        return a
    }
}
