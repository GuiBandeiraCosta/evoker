import Foundation

/// Quest map: main quest + portals, minion waves, boss line-ups and rewards (game-design §4): a literal port of
/// `Evoker Web/src/game/quests.js`. Quest definitions come from `deps.quests` (data/quests.json).
public enum QuestOps {
    public static let minWaves = 2
    public static let maxWaves = 5
    public static let minWaveSize = 2

    /// [fromQuest, toQuest] of the quality bands of the main line and of a portal (MAIN_BANDS / PORTAL_BANDS).
    public static let mainBands: [(Int, Int)] = Constants.questBands.filter { $0.scope == "main" }.map { ($0.from, $0.to) }
    public static let portalBands: [(Int, Int)] = Constants.questBands.filter { $0.scope == "portal" }.map { ($0.from, $0.to) }

    /// The ranger's quest-map lines of the first session (GUIDE_LINES).
    public enum GuideLines {
        public static let follow = "Don't let it end like this! Follow him to his lair...."
        public static let afterHim = "I think he went this way! After him!"
        public static let tough = "That card is tough! You need a stronger deck."
        public static let rune = "A rune has been branded onto the Shaman's hand. Who sent him to burn your town?"
        public static let toArena = "We must go to the Arena to complete cards!"
        public static let arenaSouth = "I can see the Arena in the south!"
        public static let finishClubSwinger = "Time to finish the Club Swinger!"
    }

    /// A quest line definition ('main' or a portal id) (`questLine`).
    public static func questLine(deps: Deps, lineId: String) -> QuestLine? {
        deps.quests?.line(lineId)
    }

    /// A quest node, 1-based (`getQuest`).
    public static func getQuest(deps: Deps, lineId: String, n: Int) -> QuestNode? {
        deps.quests?.quest(lineId, n)
    }

    /// Progress record of a line, with defaults when missing (`lineProgress`).
    public static func lineProgress(_ state: GameState, lineId: String) -> LineProgress {
        if lineId == "main" { return state.quests.main }
        return state.quests.portals[lineId] ?? LineProgress(unlocked: 1, done: 0, firstWins: [])
    }

    static func setLineProgress(_ state: GameState, lineId: String, _ rec: LineProgress) -> GameState {
        var s = state
        if lineId == "main" { s.quests.main = rec } else { s.quests.portals[lineId] = rec }
        return s
    }

    public static func questStatus(_ state: GameState, lineId: String, n: Int) -> QuestStatus {
        let p = lineProgress(state, lineId: lineId)
        if n < p.unlocked { return .done }
        if n == p.unlocked { return .current }
        return .locked
    }

    /// Which portal is open by the 7-day rotation that starts at the save's creation (`portalSchedule`).
    public static func portalSchedule(deps: Deps, createdAt: Int64, now: Int64) -> PortalSchedule? {
        let portals = deps.quests?.portals ?? []
        if portals.isEmpty { return nil }
        let days = deps.quests?.portalRotationDays ?? 7
        let period = Int64(days == 0 ? 7 : days) * JSDate.dayMs
        let k = max(0, JSMath.floorInt(Double(now - createdAt) / Double(period)))
        let index = k % portals.count
        let startedAt = createdAt + Int64(k) * period
        return PortalSchedule(portalId: portals[index].id, index: index, startedAt: startedAt, endsAt: startedAt + period,
                              remainingMs: max(0, startedAt + period - now))
    }

    /// Band position (0..1) of a quest inside its quality band (`bandPosition`).
    public static func bandPosition(lineId: String, n: Int) -> Double {
        let bands = lineId == "main" ? mainBands : portalBands
        let b = bands.first { n >= $0.0 && n <= $0.1 } ?? bands[bands.count - 1]
        return b.1 == b.0 ? 1 : Double(n - b.0) / Double(b.1 - b.0)
    }

    /// Split a quest's figures into 2–5 waves of (normally) 2–4 minions, each a random band card id (`generateWaves`).
    public static func generateWaves(rng: RandomSource, deps: Deps, quest: QuestNode) -> [[String?]] {
        let figures = max(minWaves * minWaveSize, quest.figures)
        let nWaves = max(minWaves, min(maxWaves, JSMath.ceilInt(Double(figures) / Double(RewardOps.maxWaveSize))))
        var sizes = Array(repeating: figures / nWaves, count: nWaves)
        for i in 0..<(figures % nWaves) { sizes[i] += 1 }
        return sizes.map { size in
            var ids: [String?] = []
            for _ in 0..<size {
                let def = RewardOps.pickBandCard(rng: rng, db: deps.db, band: quest.band)
                ids.append(def?.id)
            }
            return ids
        }
    }

    /// Start (or restart) a quest: builds the minion waves (`startQuest`). Only an unlocked quest can be started.
    public static func startQuest(_ state: GameState, deps: Deps, now: Int64, line: String, n: Int) throws -> (state: GameState, active: ActiveQuest) {
        guard let quest = getQuest(deps: deps, lineId: line, n: n) else { throw GameError("No such quest") }
        if questStatus(state, lineId: line, n: n) == .locked { throw GameError("Quest locked") }
        let t = StateOps.takeRng(state, deps: deps)
        let waves = generateWaves(rng: t.rng, deps: deps, quest: quest)
        let active = ActiveQuest(line: line, n: n, waves: waves, waveIndex: 0, waveDone: 0, figuresDone: 0,
                                 figuresTotal: waves.reduce(0) { $0 + $1.count }, bossReady: false, boss: nil, startedAt: now)
        var s = t.state
        s.quests.active = active
        return (s, active)
    }

    /// Abandon the active quest (`leaveQuest`).
    public static func leaveQuest(_ state: GameState) -> GameState {
        var s = state
        s.quests.active = nil
        return s
    }

    /// Quest progress 0..100 (`questProgressPct`).
    public static func questProgressPct(_ active: ActiveQuest?) -> Int {
        guard let a = active, a.figuresTotal != 0 else { return 0 }
        return JSMath.roundInt(Double(a.figuresDone) / Double(a.figuresTotal) * 100)
    }

    /// Per-tap numbers of a quest node (`questTapInfo`).
    public static func questTapInfo(_ quest: QuestNode) -> QuestTapInfo {
        let stamina = quest.staminaPerTap
        return QuestTapInfo(stamina: stamina, gold: quest.goldPerFigure,
                            xp: quest.xpPerTap ?? stamina * Constants.xpPerStamina, figures: quest.figures,
                            burstChance: quest.burstChance ?? Constants.questTapBurst.chance, endGold: quest.endGold ?? 0)
    }

    /// Tap the next minion (`tapMinion`): costs the quest's stamina per tap and pays flat gold (with an occasional
    /// burst) and player xp; a wave end may drop a card; when stamina is short nothing changes and `needsPotion`
    /// describes the Drink-potion dialog.
    public static func tapMinion(_ state: GameState, deps: Deps, now: Int64, event: DailyEventId?) throws -> (state: GameState, info: TapResult) {
        guard let active = state.quests.active else { throw GameError("No active quest") }
        let idle = TapResult(needsPotion: nil, reward: nil, waveCleared: false, bossReady: false, pct: 0, minion: nil, stamina: 0, gold: 0,
                             tapGold: 0, burst: 0, perfect: false, xp: 0, levelUps: [], levelUpDetails: [], soulCard: nil)
        if active.bossReady {
            var r = idle
            r.bossReady = true
            r.pct = 100
            r.minion = nil
            return (state, r)
        }
        guard let quest = getQuest(deps: deps, lineId: active.line, n: active.n) else { throw GameError("No such quest") }
        let info = questTapInfo(quest)
        let np = PlayerOps.needsPotion(state, kind: .stamina, amount: info.stamina, event: event)
        if np.needed {
            var r = idle
            r.needsPotion = np
            r.bossReady = false
            r.pct = questProgressPct(active)
            r.minion = nil
            return (state, r)
        }
        var s = try PlayerOps.spendStamina(state, amount: info.stamina)
        let wave: [String?] = active.waves[js: active.waveIndex] ?? []
        let minion: String? = (wave[js: active.waveDone] ?? nil).flatMap { $0.isEmpty ? nil : $0 }
        var next = active
        next.waveDone = active.waveDone + 1
        next.figuresDone = active.figuresDone + 1
        let last = next.figuresDone >= active.figuresTotal
        let tg = StateOps.takeRng(s, deps: deps)
        s = tg.state
        let tapGold = RewardOps.rollTapGold(rng: tg.rng, quest: quest, last: last, event: event)
        s = PlayerOps.addGold(s, amount: tapGold.gold)
        let px = PlayerOps.addPlayerXp(s, deps: deps, amount: info.xp)
        s = px.state
        var reward: Reward? = tapGold.burst != 0 ? Reward(type: .gold, gold: tapGold.burst, burst: true) : nil
        let soul = try soulDrop(s, deps: deps, quest: quest, figuresDone: next.figuresDone)
        s = soul.state
        var waveCleared = false
        if next.waveDone >= wave.count {
            waveCleared = true
            let t = StateOps.takeRng(s, deps: deps)
            s = t.state
            // the tutorial quests of a tutorial game drop no random cards; other saves roll as usual
            let scripted = quest.waveCards == false && StateOps.unlocksByQuest(state)
            let rolled: Reward = scripted ? .none : RewardOps.rollWaveReward(rng: t.rng, deps: deps, quest: quest)
            if rolled.type != .none {
                let ap = try RewardOps.applyReward(s, deps: deps, now: now, reward: rolled)
                s = ap.state
                reward = ap.reward
            }
            next.waveIndex = next.waveIndex + 1
            next.waveDone = 0
            if next.waveIndex >= active.waves.count { next.bossReady = true }
        }
        s.quests.active = next
        let result = TapResult(needsPotion: nil, reward: reward, waveCleared: waveCleared, bossReady: next.bossReady, pct: questProgressPct(next),
                               minion: minion, stamina: info.stamina, gold: tapGold.gold, tapGold: tapGold.tap, burst: tapGold.burst,
                               perfect: tapGold.perfect, xp: px.info.xp, levelUps: px.info.levelUps, levelUpDetails: px.info.levelUpDetails,
                               soulCard: soul.reward)
        return (s, result)
    }

    /// The scripted soul-card drop of a tutorial quest (`soulDrop`): the card goes straight into the first open
    /// empty deck slot; only a save that does not own the card yet gets it.
    public static func soulDrop(_ state: GameState, deps: Deps, quest: QuestNode, figuresDone: Int) throws -> (state: GameState, reward: Reward?) {
        guard let drop = quest.soulDrop, drop.tap == figuresDone, deps.db.get(drop.cardId) != nil else { return (state, nil) }
        if state.cards.contains(where: { $0.cardId == drop.cardId }) { return (state, nil) }
        let r = try CollectionOps.addCard(state, deps: deps, cardId: drop.cardId, force: true)
        var s = r.state
        let slot = (0..<5).first { (s.deck[$0] ?? "").isEmpty && StateOps.slotUnlocked(s, slot: $0) }
        if let slot = slot { s.deck[slot] = r.info.uid }
        return (s, Reward(type: .card, cardId: drop.cardId, stage: 0, level: 1, soul: true, uid: r.info.uid, slot: slot ?? -1))
    }

    /// Boss line-up (`bossLineup`): the fixed boss card (or a random band card) at a band level in the middle slot
    /// plus `quest.bossCards` band cards at matching levels (the ids of `bossCardIds` first, then random ones).
    public static func bossLineup(quest: QuestNode, rng: RandomSource, db: CardsDb, stats: StatsProviding, lineId: String = "main") -> BossLineup {
        let t = bandPosition(lineId: lineId, n: quest.n)
        let (lo, hi) = quest.band.levelRange
        let (s0, s1) = quest.band.stageRange
        func levelAt(_ def: CardDef, _ stage: Int, _ jitter: Int) -> Int {
            let cap = stats.capFor(def, stage: stage)
            if let bl = quest.bossLevel {
                return max(1, min(cap, bl == 0 ? 1 : bl))
            }
            let base = Double(lo) + Double(hi - lo) * t + Double(jitter)
            return max(1, min(cap, JSMath.roundInt(base)))
        }
        var bossDef: CardDef? = nil
        if let id = quest.boss, !id.isEmpty { bossDef = db.get(id) }
        if bossDef == nil { bossDef = RewardOps.pickBandCard(rng: rng, db: db, band: quest.band) }
        // a catalog without any card cannot happen in the game; the web would throw here
        let def = bossDef ?? CardDef(id: "", name: "", tribe: .neutral, rarity: .common, mana: 0, dirs: [], base: CardBase(attack: 0, hp: 1, ability: nil), caps: [1, 1, 1, 1, 1])
        let hasFixedBoss = quest.boss.map { !$0.isEmpty } ?? false
        let bossStage = max(0, min(4, hasFixedBoss ? quest.bossStage : s1))
        let boss = LineupCard(uid: "boss", cardId: def.id, stage: bossStage, level: levelAt(def, bossStage, 0), evolveQuality: 1, isBoss: true)
        var cards: [LineupCard?] = [nil, nil, nil, nil, nil]
        let bossSlot: Int = {
            if let bs = quest.bossSlot, bs >= 0, bs < 5 { return bs }
            return 2
        }()
        cards[bossSlot] = boss
        let free = [1, 3, 0, 4, 2].filter { $0 != bossSlot }
        let order: [Int]
        if let slots = quest.bossSlots, !slots.isEmpty {
            order = slots + free.filter { !slots.contains($0) }
        } else {
            order = free
        }
        let count = max(0, min(4, quest.bossCards ?? 4))
        let fixed = quest.bossCardIds ?? []
        var i = 0
        while i < count {
            defer { i += 1 }
            var fixedDef: CardDef? = nil
            if let fid = fixed[js: i], !fid.isEmpty { fixedDef = db.get(fid) }
            guard let slot = order[js: i] else { continue }
            if let fd = fixedDef {
                // scripted (tutorial) line-ups: the listed card at the boss's stage and level, no randomness
                var stage = bossStage
                if let stages = quest.bossCardStages, let st = stages[js: i] { stage = max(0, min(4, st)) }
                cards[slot] = LineupCard(uid: "boss-\(i)", cardId: fd.id, stage: stage, level: levelAt(fd, stage, 0), evolveQuality: 1)
                continue
            }
            guard let pick = RewardOps.pickBandCard(rng: rng, db: db, band: quest.band) else { continue }
            let stage = s0 + rng.int(max(1, s1 - s0 + 1))
            let jitter = rng.int(5) - 2
            cards[slot] = LineupCard(uid: "boss-\(i)", cardId: pick.id, stage: stage, level: levelAt(pick, stage, jitter), evolveQuality: 1)
        }
        let name: String
        if let bn = quest.bossName, !bn.isEmpty { name = bn } else { name = def.name + String(repeating: "+", count: bossStage) }
        return BossLineup(boss: boss, player: LineupPlayer(name: name, hp: quest.bossHp, maxHp: quest.bossHp, level: quest.n), cards: cards)
    }

    /// Build (and store) the boss line-up for the active quest (`prepareBoss`).
    public static func prepareBoss(_ state: GameState, deps: Deps, now: Int64) throws -> (state: GameState, lineup: BossLineup, quest: QuestNode) {
        guard let active = state.quests.active, active.bossReady else { throw GameError("The minions are not beaten yet") }
        guard let quest = getQuest(deps: deps, lineId: active.line, n: active.n) else { throw GameError("No such quest") }
        if let boss = active.boss { return (state, boss, quest) }
        let t = StateOps.takeRng(state, deps: deps)
        let lineup = bossLineup(quest: quest, rng: t.rng, db: deps.db, stats: deps.stats, lineId: active.line)
        var s = t.state
        var next = active
        next.boss = lineup
        s.quests.active = next
        return (s, lineup, quest)
    }

    /// Engine config for the boss fight of the active quest (`bossBattleConfig`).
    public static func bossBattleConfig(_ state: GameState, deps: Deps, lineup: BossLineup, seed: UInt32) -> BattleConfig {
        let attacker = OpponentOps.buildPlayerSide(state, deps: deps)
        let bossPlayer = FighterPlayer(name: lineup.player.name, hp: lineup.player.hp, maxHp: lineup.player.maxHp, level: lineup.player.level)
        let cards: [SideEntry?] = lineup.cards.map { $0.map { SideEntry.ref($0.ref) } }
        let defender = deps.engine.buildSide(bossPlayer, cards, options: OpponentOps.sideOptions(deps: deps))
        return BattleConfig(attacker: attacker, defender: defender, seed: seed)
    }

    /// Run the boss fight of the active quest and resolve it (`fightBoss`).
    public static func fightBoss(_ state: GameState, deps: Deps, now: Int64, event: DailyEventId?) throws -> (state: GameState, info: BossResult) {
        let v = CollectionOps.validateDeck(state, deps: deps)
        if !v.ok { throw GameError(v.reason ?? "Invalid deck") }
        let pb = try prepareBoss(state, deps: deps, now: now)
        let t = StateOps.takeRng(pb.state, deps: deps)
        let cfg = bossBattleConfig(t.state, deps: deps, lineup: pb.lineup, seed: t.seed)
        let battle = deps.engine.simulateBattle(cfg)
        let res = try resolveBoss(t.state, deps: deps, now: now, result: battle.result, lineup: pb.lineup, event: event)
        var info = res.info
        info.battle = battle
        info.lineup = pb.lineup
        info.seed = t.seed
        return (res.state, info)
    }

    /// Apply a boss fight result (`resolveBoss`): on a win the next quest unlocks, the deck cards get xp and the
    /// boss reward is granted; the first win of main Q2 / Q4 / Q7 opens a deck slot, the last quest of a portal
    /// also pays 1000 gold. Quest boss fights give no player xp. On a loss the minions must be beaten again.
    public static func resolveBoss(_ state: GameState, deps: Deps, now: Int64, result: BattleResult, lineup: BossLineup?, event: DailyEventId?) throws -> (state: GameState, info: BossResult) {
        guard let active = state.quests.active else { throw GameError("No active quest") }
        guard let quest = getQuest(deps: deps, lineId: active.line, n: active.n), let line = questLine(deps: deps, lineId: active.line) else {
            throw GameError("No such quest")
        }
        let lu = lineup ?? active.boss
        let won = result.winner == .attacker
        let enemyMana = lu?.cards.compactMap { $0 }.reduce(0) { $0 + (deps.db.get($1.cardId)?.mana ?? 0) } ?? 0
        let cardXp = PlayerOps.cardFightXp(enemyDeckMana: enemyMana, won: won, infiniteWisdom: event == .infiniteWisdom)
        let dx = CollectionOps.addDeckXp(state, deps: deps, xp: cardXp)
        var s = dx.state
        let playerXp = PlayerOps.questBossPlayerXp
        let px = PlayerOps.addPlayerXp(s, deps: deps, amount: playerXp)
        s = px.state
        if !won {
            var reset = active
            reset.waveIndex = 0
            reset.waveDone = 0
            reset.figuresDone = 0
            reset.bossReady = false
            reset.boss = nil
            s.quests.active = reset
            return (s, BossResult(won: false, reward: nil, unlocked: nil, firstWin: false, playerXp: playerXp, cardXp: cardXp,
                                  levelUps: px.info.levelUps, levelUpDetails: px.info.levelUpDetails, cardLevelUps: dx.levelUps,
                                  gems: px.info.gems, deckSlots: nil, bonusGold: 0, quest: quest))
        }
        let prog = lineProgress(s, lineId: active.line)
        let firstWin = !prog.firstWins.contains(active.n)
        var unlocked: Int? = nil
        var rec = prog
        if firstWin {
            rec.firstWins = prog.firstWins + [active.n]
            rec.done = prog.done + 1
            s.player.questsDone = s.player.questsDone + 1
        }
        if active.n == prog.unlocked && active.n < line.nodes.count {
            rec.unlocked = active.n + 1
            unlocked = rec.unlocked
        }
        s = setLineProgress(s, lineId: active.line, rec)
        var deckSlots: Int? = nil
        if firstWin {
            let us = StateOps.unlockSlotsForQuest(s, lineId: active.line, n: active.n)
            s = us.state
            deckSlots = us.slots
        }
        var bonusGold = 0
        if active.line != "main" && active.n == line.nodes.count {
            bonusGold = PlayerOps.goldWithEvent(Constants.portalFinalGold, event: event)
            s = PlayerOps.addGold(s, amount: bonusGold)
        }
        let t = StateOps.takeRng(s, deps: deps)
        s = t.state
        let rolled = RewardOps.rollBossReward(rng: t.rng, deps: deps, line: line, quest: quest, firstWin: firstWin, event: event)
        let ap = try RewardOps.applyReward(s, deps: deps, now: now, reward: rolled)
        s = ap.state
        s.quests.active = nil
        return (s, BossResult(won: true, reward: ap.reward, unlocked: unlocked, firstWin: firstWin, playerXp: playerXp, cardXp: cardXp,
                              levelUps: px.info.levelUps, levelUpDetails: px.info.levelUpDetails, cardLevelUps: dx.levelUps,
                              gems: px.info.gems, deckSlots: deckSlots, bonusGold: bonusGold, quest: quest))
    }

    /// Nodes of a line with their status, for the map (`mapNodes`).
    public static func mapNodes(_ state: GameState, deps: Deps, lineId: String) -> [MapNode] {
        guard let line = questLine(deps: deps, lineId: lineId) else { return [] }
        return line.nodes.map { MapNode(n: $0.n, status: questStatus(state, lineId: lineId, n: $0.n), quest: $0) }
    }

    /// The ranger's line on the main quest map during the first session (`guideLine`), or nil.
    public static func guideLine(_ state: GameState, lastLoss: Bool = false) -> String? {
        if !StateOps.inTutorial(state) { return nil }
        guard let tut = state.tutorial.r3 else { return nil }
        let wins = state.quests.main.firstWins
        func won(_ n: Int) -> Bool { wins.contains(n) }
        func lost(_ n: Int) -> Bool { tut.lost.contains(n) || (lastLoss && nextMain(wins) == n) }
        func owns(_ cardId: String) -> Bool { state.cards.contains { $0.cardId == cardId } }
        func inDeck(_ cardId: String) -> Bool {
            state.deck.contains { uid in
                guard let u = uid, !u.isEmpty else { return false }
                return state.cards.contains { $0.uid == u && $0.cardId == cardId }
            }
        }
        if !won(1) { return GuideLines.follow }
        if !won(2) {
            if lost(2) { return inDeck("throat-cutter") ? nil : GuideLines.tough }
            return GuideLines.afterHim
        }
        if won(5) && !won(6) { return GuideLines.rune }
        if won(6) && !won(7) { return GuideLines.toArena }
        if won(7) && !won(8) { return GuideLines.arenaSouth }
        if won(8) && !won(9) && !owns("club-swinger") { return GuideLines.finishClubSwinger }
        return nil
    }

    /// First main quest not won yet (`nextMain`).
    static func nextMain(_ wins: [Int]) -> Int {
        var n = 1
        while wins.contains(n) { n += 1 }
        return n
    }
}
