import Foundation
import EvokerCore

/// Runs a fight for a `FightRequest` through the game functions and builds the `BattlePresentation` the battle
/// screen plays (the web's pre-battle `fight()` closures + `ctx.replace('battle', ...)` of `prebattle.js`,
/// `arena.js`, `arena-pieces.js`, `league.js`, the replay re-run of `pvp-view.js` and the Card Lab's `runLabFight`).
enum FightRunner {
    /// The sides as fought, rebuilt from the battleStart snapshot (ids, stages, levels and the engine's numbers).
    static func sides(from events: [BattleEvent]) -> (attacker: FighterSide, defender: FighterSide)? {
        for e in events {
            if case .battleStart(_, let a, let d) = e {
                return (side(a), side(d))
            }
        }
        return nil
    }

    private static func side(_ s: SideSnapshot) -> FighterSide {
        let player = FighterPlayer(name: s.player.name, hp: s.player.hp, maxHp: s.player.maxHp, hpMax: nil, portrait: s.player.portrait,
                                   avatar: nil, level: s.player.level, baseMaxHp: s.player.baseMaxHp, tribeBonus: s.player.tribeBonus)
        let cards: [BattleCard?] = s.cards.map { c in
            guard let c = c else { return nil }
            return BattleCard(instanceId: c.instanceId, cardId: c.cardId, name: c.name, tribe: c.tribe, rarity: c.rarity, mana: c.mana,
                              stage: c.stage, level: c.level, attack: Double(c.attack), maxHp: Double(c.maxHp), hp: Double(c.hp),
                              abilityValue: c.abilityValue, dirs: c.dirs, ability: c.ability, buffs: nil)
        }
        return FighterSide(player: player, cards: cards)
    }

    /// `battle.js canSkip`: PvP, replays and portal quests always; main-line quests from the quest-3 boss on.
    static func skipAllowed(mode: FightMode, line: String?, n: Int?) -> Bool {
        if mode != .quest { return true }
        if let l = line, l != "main" { return true }
        return (n ?? 0) >= 3
    }

    /// `boss-intro.js isShowdown`: a node marked `showdown`, or the last quest of a section / of a portal line.
    static func isShowdown(deps: Deps, line: String, n: Int) -> Bool {
        guard let q = deps.quests else { return false }
        if let node = q.quest(line, n), node.showdown == true { return true }
        if line == "main" {
            return q.sections.contains { $0.to == n }
        }
        guard let portal = q.portals.first(where: { $0.id == line }), let last = portal.nodes.last else { return false }
        return last.n == n
    }

    /// `bossTitle`: "Boss Fight n", "Showdown!" for a chapter's last boss.
    static func bossTitle(deps: Deps, line: String, n: Int) -> String {
        isShowdown(deps: deps, line: line, n: n) ? Strings.showdown : Strings.bossFightN(n)
    }

    /// `pvp-view.js withFightXp`: the card / player xp the result lists for piece and league fights.
    static func fightXp(sim: SimPlayer, power: Double, won: Bool, deps: Deps, event: DailyEventId?) -> (cardXp: Int, playerXp: Int) {
        let cardXp = PlayerOps.cardFightXp(enemyDeckMana: OpponentOps.simDeckMana(sim, deps: deps), won: won, infiniteWisdom: event == .infiniteWisdom)
        let playerXp = PlayerOps.playerFightXp(opponentLevel: Int(JSMath.round(Double(sim.level) * power)), won: won)
        return (cardXp, playerXp)
    }

    /// Run the fight of a request through the store and build its presentation. Throws what the game function
    /// threw; nil when the request cannot be fulfilled (a missing opponent).
    @MainActor
    static func run(_ request: FightRequest, model: AppModel) throws -> BattlePresentation? {
        guard let state = model.store.state else { return nil }
        let deps = model.deps
        let ev = model.event
        let me = state.player
        let speed = state.settings.speed
        // prebattle.js deckSnapshot(state): the deck before the fight, for the result's XP bars
        let deckBefore = DeckCardSnapshot.deck(of: state)
        switch request {
        case .questBoss(let line, let n):
            let bossCardId = state.quests.active?.boss?.boss.cardId
            let info: BossResult = try model.store.update { s, d, t in
                let r = try QuestOps.fightBoss(s, deps: d, now: t, event: ev)
                return (state: r.state, info: r.info)
            }
            guard let battle = info.battle, let sides = sides(from: battle.events) else { return nil }
            let reward = info.reward
            let gold = reward?.type == .gold ? (reward?.gold ?? 0) : 0
            let gems = (reward?.type == .gems ? (reward?.gems ?? 0) : 0) + info.gems
            let rewards = FightRewardsSummary(gold: gold, gems: gems, tournamentPoints: 0, leaguePoints: 0, cardXp: info.cardXp, playerXp: info.playerXp,
                                              reward: reward, bonusGold: info.bonusGold, piece: nil)
            // battle.js themeFor: portal lines → swamp, main-line bosses from quest 31 → lava, else the valley
            let theme = line != "main" ? "swamp" : (n >= 31 ? "lava" : "valley")
            return BattlePresentation(mode: .quest, title: bossTitle(deps: deps, line: line, n: n), events: battle.events, result: battle.result,
                                      attacker: sides.attacker, defender: sides.defender, attackerName: me.name,
                                      defenderName: info.lineup?.player.name ?? sides.defender.player.name ?? "Boss",
                                      attackerAvatar: me.avatar, defenderAvatar: 0, rewards: rewards, levelUps: info.levelUps,
                                      levelUpDetails: info.levelUpDetails, cardLevelUps: info.cardLevelUps, cardXp: info.cardXp,
                                      skipAllowed: skipAllowed(mode: .quest, line: line, n: n), speed: speed, completion: .questMap(line: line),
                                      deckBefore: deckBefore, defenderPortrait: info.lineup?.boss.cardId ?? bossCardId, theme: theme)
        case .arena(let offerIndex):
            let info: ArenaResult = try model.store.update { s, d, t in
                let r = try ArenaOps.fightArena(s, deps: d, now: t, offerIndex: offerIndex, event: ev)
                return (state: r.state, info: r.info)
            }
            guard let sides = sides(from: info.battle.events) else { return nil }
            let rewards = FightRewardsSummary(gold: info.rewards.gold, gems: 0, tournamentPoints: info.rewards.tournamentPoints,
                                              leaguePoints: info.rewards.leaguePoints, cardXp: info.rewards.cardXp, playerXp: info.rewards.playerXp)
            return BattlePresentation(mode: .arena, title: info.opponent.name, events: info.battle.events, result: info.battle.result,
                                      attacker: sides.attacker, defender: sides.defender, attackerName: me.name, defenderName: info.opponent.name,
                                      attackerAvatar: me.avatar, defenderAvatar: info.opponent.avatar, rewards: rewards, levelUps: info.levelUps,
                                      levelUpDetails: info.levelUps.map { LevelUpMath.detail(forLevel: $0, state: model.store.state) },
                                      cardLevelUps: info.cardLevelUps, cardXp: info.rewards.cardXp, skipAllowed: true, speed: speed,
                                      completion: .arena(tab: .arena), deckBefore: deckBefore,
                                      defenderPortrait: avatarCardId(info.opponent.avatar, names: deps.names))
        case .pieces(let huntIndex):
            guard huntIndex < state.pieces.count, let holderId = state.pieces[huntIndex].holderId,
                  let sim = OpponentOps.getSim(state, simId: holderId) else { return nil }
            let hunt = state.pieces[huntIndex]
            let info: PiecesFightResult = try model.store.update { s, d, t in
                let r = try PieceOps.fightHolder(s, deps: d, now: t, index: huntIndex, event: ev)
                return (state: r.state, info: r.info)
            }
            guard let sides = sides(from: info.battle.events) else { return nil }
            let xp = fightXp(sim: sim, power: 1, won: info.won, deps: deps, event: ev)
            var piece: Reward? = nil
            if info.won {
                piece = Reward(type: info.completed ? .card : .piece, cardId: info.cardId ?? hunt.cardId, uid: info.uid, huntIndex: huntIndex, completed: info.completed)
            }
            let rewards = FightRewardsSummary(gold: 0, gems: 0, tournamentPoints: info.tournamentPoints, leaguePoints: info.leaguePoints,
                                              cardXp: xp.cardXp, playerXp: xp.playerXp, reward: nil, bonusGold: 0, piece: piece)
            return BattlePresentation(mode: .pieces, title: sim.name, events: info.battle.events, result: info.battle.result,
                                      attacker: sides.attacker, defender: sides.defender, attackerName: me.name, defenderName: sim.name,
                                      attackerAvatar: me.avatar, defenderAvatar: sim.avatar, rewards: rewards, levelUps: info.levelUps,
                                      levelUpDetails: info.levelUps.map { LevelUpMath.detail(forLevel: $0, state: model.store.state) },
                                      cardLevelUps: info.cardLevelUps, cardXp: xp.cardXp, skipAllowed: true, speed: speed,
                                      completion: .arena(tab: .pieces), deckBefore: deckBefore,
                                      defenderPortrait: avatarCardId(sim.avatar, names: deps.names))
        case .league(let simId):
            guard let sim = OpponentOps.getSim(state, simId: simId) else { return nil }
            let power = state.sim.league?.power ?? 1
            let info: LeagueFightResult = try model.store.update { s, d, t in
                let r = try LeagueOps.fightLeague(s, deps: d, now: t, simId: simId, event: ev)
                return (state: r.state, info: r.info)
            }
            guard let sides = sides(from: info.battle.events) else { return nil }
            let xp = fightXp(sim: sim, power: power, won: info.won, deps: deps, event: ev)
            let rewards = FightRewardsSummary(gold: 0, gems: 0, tournamentPoints: 0, leaguePoints: info.points, cardXp: xp.cardXp, playerXp: xp.playerXp)
            return BattlePresentation(mode: .league, title: sim.name, events: info.battle.events, result: info.battle.result,
                                      attacker: sides.attacker, defender: sides.defender, attackerName: me.name, defenderName: sim.name,
                                      attackerAvatar: me.avatar, defenderAvatar: sim.avatar, rewards: rewards, levelUps: info.levelUps,
                                      levelUpDetails: info.levelUps.map { LevelUpMath.detail(forLevel: $0, state: model.store.state) },
                                      cardLevelUps: info.cardLevelUps, cardXp: xp.cardXp, skipAllowed: true, speed: speed, completion: .league,
                                      deckBefore: deckBefore, defenderPortrait: avatarCardId(sim.avatar, names: deps.names))
        case .replay(let index):
            return replay(index: index, model: model)
        case .lab:
            return nil
        }
    }

    /// `pvp-view.js replaySide`: rebuild a saved replay side as an engine FighterSide (the stored maxHp already
    /// includes the tribe bonus, so it is not applied again).
    static func replaySide(_ side: ReplaySide, deps: Deps) -> FighterSide {
        var entries: [SideEntry?] = []
        for (i, c) in side.cards.enumerated() {
            if let c = c, deps.db.get(c.cardId) != nil {
                entries.append(.ref(CardRef(uid: "replay-\(i)", cardId: c.cardId, stage: c.stage, level: max(1, c.level), evolveQuality: 1)))
            } else {
                entries.append(nil)
            }
        }
        while entries.count < 5 { entries.append(nil) }
        var opts = OpponentOps.sideOptions(deps: deps)
        opts.tribeBonus = false
        let player = FighterPlayer(name: side.name, hp: side.maxHp, maxHp: side.maxHp, avatar: side.avatar)
        return deps.engine.buildSide(player, Array(entries.prefix(5)), options: opts)
    }

    /// `rerunReplay` + the battle hand-off of `arena.js watch`.
    @MainActor
    static func replay(index: Int, model: AppModel) -> BattlePresentation? {
        guard let state = model.store.state, index >= 0, index < state.replays.count else { return nil }
        let rep = state.replays[index]
        let deps = model.deps
        let attacker = replaySide(rep.attacker, deps: deps)
        let defender = replaySide(rep.defender, deps: deps)
        let outcome = deps.engine.simulateBattle(BattleConfig(attacker: attacker, defender: defender, seed: rep.seed))
        return BattlePresentation(mode: .replay, title: rep.defender.name, events: outcome.events, result: outcome.result,
                                  attacker: attacker, defender: defender, attackerName: rep.attacker.name, defenderName: rep.defender.name,
                                  attackerAvatar: rep.attacker.avatar, defenderAvatar: rep.defender.avatar, rewards: FightRewardsSummary(),
                                  levelUps: [], levelUpDetails: [], cardLevelUps: [], cardXp: 0, skipAllowed: true,
                                  speed: state.settings.speed, completion: .replays,
                                  defenderPortrait: avatarCardId(rep.defender.avatar, names: deps.names))
    }

    /// A lab slot: a card at a stage / level.
    struct LabSlot: Hashable {
        var cardId: String
        var stage: Int
        var level: Int
    }

    /// `lab-model.js runLabFight`: both rows through the engine with the lab HP; nothing in the save changes.
    @MainActor
    static func lab(own: [LabSlot?], opp: [LabSlot?], hp: Int, seed: UInt32, model: AppModel) -> (presentation: BattlePresentation, outcome: BattleOutcome)? {
        let deps = model.deps
        let opts = OpponentOps.sideOptions(deps: deps)
        func entries(_ slots: [LabSlot?], _ side: String) -> [SideEntry?] {
            var out: [SideEntry?] = []
            for (i, s) in slots.enumerated() {
                if let s = s, deps.db.get(s.cardId) != nil {
                    out.append(.ref(CardRef(uid: "lab-\(side)-\(i)", cardId: s.cardId, stage: s.stage, level: max(1, s.level), evolveQuality: 1)))
                } else {
                    out.append(nil)
                }
            }
            while out.count < 5 { out.append(nil) }
            return Array(out.prefix(5))
        }
        let attacker = deps.engine.buildSide(FighterPlayer(name: "You", hp: hp, maxHp: hp), entries(own, "own"), options: opts)
        let defender = deps.engine.buildSide(FighterPlayer(name: "Lab opponent", hp: hp, maxHp: hp), entries(opp, "opp"), options: opts)
        let outcome = deps.engine.simulateBattle(BattleConfig(attacker: attacker, defender: defender, seed: seed))
        let p = BattlePresentation(mode: .lab, title: Strings.cardLab, events: outcome.events, result: outcome.result, attacker: attacker,
                                   defender: defender, attackerName: "You", defenderName: "Lab opponent", attackerAvatar: model.store.state?.player.avatar ?? 0,
                                   defenderAvatar: 0, rewards: FightRewardsSummary(), levelUps: [], levelUpDetails: [], cardLevelUps: [], cardXp: 0,
                                   skipAllowed: true, speed: model.store.state?.settings.speed ?? 1, completion: .lab)
        return (p, outcome)
    }
}
