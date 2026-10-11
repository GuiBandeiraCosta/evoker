import Foundation

/// The PvP fight runner shared by the Arena, Pieces and League tabs: mana check, simulation, card / player xp and
/// the replay record. A literal port of `Evoker Web/src/game/pvp.js`.
public enum PvpOps {
    public static let tpPerWin = Constants.ArenaRules.tournamentPointsPerWin
    public static let maxReplays = Constants.ArenaRules.replaysKept

    /// Can the player start a PvP fight with the current deck? (`canFightPvp`)
    public static func canFightPvp(_ state: GameState, deps: Deps) -> CanFight {
        let v = CollectionOps.validateDeck(state, deps: deps)
        if !v.ok { return CanFight(ok: false, reason: v.reason, mana: v.mana, needsPotion: false) }
        let mana = OpponentOps.pvpManaCost(state, deps: deps)
        if state.player.mana < mana { return CanFight(ok: false, reason: "Not enough mana", mana: mana, needsPotion: true) }
        return CanFight(ok: true, reason: nil, mana: mana, needsPotion: false)
    }

    /// Append a replay record, keeping the last 10 (`recordReplay`).
    public static func recordReplay(_ state: GameState, _ replay: Replay) -> GameState {
        var s = state
        s.replays = Array(([replay] + state.replays).prefix(maxReplays))
        return s
    }

    /// Run one PvP fight against a simulated player (`runPvpFight`): spends deck mana, simulates, grants card xp /
    /// player xp, counts the win and stores a replay. Mode-specific rewards are added by the callers.
    public static func runPvpFight(_ state: GameState, deps: Deps, now: Int64, sim: SimPlayer, power: Double = 1, event: DailyEventId?, mode: FightMode) throws -> (state: GameState, info: PvpFightResult) {
        let check = canFightPvp(state, deps: deps)
        if !check.ok { throw GameError(check.reason ?? "Cannot fight") }
        var s = try PlayerOps.spendMana(state, amount: check.mana)
        let t = StateOps.takeRng(s, deps: deps)
        s = t.state
        let attacker = OpponentOps.buildPlayerSide(s, deps: deps)
        let defender = OpponentOps.buildSimSide(sim, deps: deps, power: power)
        let battle = deps.engine.simulateBattle(BattleConfig(attacker: attacker, defender: defender, seed: t.seed))
        let won = battle.result.winner == .attacker
        let enemyDeckMana = OpponentOps.simDeckMana(sim, deps: deps)
        let infinite = event == .infiniteWisdom
        let cardXp = PlayerOps.cardFightXp(enemyDeckMana: enemyDeckMana, won: won, infiniteWisdom: infinite)
        let dx = CollectionOps.addDeckXp(s, deps: deps, xp: cardXp)
        s = dx.state
        let playerXp = PlayerOps.playerFightXp(opponentLevel: JSMath.roundInt(Double(sim.level) * power), won: won)
        let px = PlayerOps.addPlayerXp(s, deps: deps, amount: playerXp)
        s = px.state
        if won { s.player.battlesWon = s.player.battlesWon + 1 }
        func sideRecord(_ side: FighterSide) -> ReplaySide {
            ReplaySide(name: side.player.name ?? "", maxHp: side.player.maxHp ?? side.player.hp ?? 1500, avatar: side.player.portrait ?? 0,
                       cards: side.cards.map { c in c.map { ReplayCard(cardId: $0.cardId ?? "", stage: $0.stage ?? 0, level: $0.level ?? 1) } })
        }
        s = recordReplay(s, Replay(seed: t.seed, at: now, mode: mode.rawValue, won: won, attacker: sideRecord(attacker), defender: sideRecord(defender), result: battle.result))
        return (s, PvpFightResult(battle: battle, won: won, seed: t.seed, playerXp: playerXp, cardXp: cardXp, levelUps: px.info.levelUps,
                                  cardLevelUps: dx.levelUps, manaSpent: check.mana, enemyDeckMana: enemyDeckMana))
    }
}
