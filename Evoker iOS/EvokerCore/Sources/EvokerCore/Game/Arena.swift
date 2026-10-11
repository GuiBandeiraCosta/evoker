import Foundation

/// Arena (game-design §5): three opponents (easy / normal / hard), replaced after every fight and every 30
/// minutes. A literal port of `Evoker Web/src/game/arena.js`.
public enum ArenaOps {
    public static let offerRotationMs: Int64 = Int64(Constants.ArenaRules.offerRotationMinutes) * 60 * 1000
    /// Offer difficulties (DIFFICULTIES).
    public static let difficulties: [Constants.ArenaDifficulty] = Constants.ArenaRules.difficulties

    /// Make sure three arena offers exist (`ensureOffers`): generated when missing, stale or expired.
    public static func ensureOffers(_ state: GameState, deps: Deps, now: Int64) -> (state: GameState, info: ArenaOffers) {
        var s = OpponentOps.ensurePool(state, deps: deps, now: now).state
        let arena = s.sim.arena
        let stale = arena.offers.count != difficulties.count || now >= arena.rerollAt || arena.offers.contains { OpponentOps.getSim(s, simId: $0.simId) == nil }
        if !stale { return (s, ArenaOffers(offers: arena.offers, rerollAt: arena.rerollAt)) }
        s = rollOffers(s, deps: deps, now: now)
        return (s, ArenaOffers(offers: s.sim.arena.offers, rerollAt: s.sim.arena.rerollAt))
    }

    /// Generate three fresh offers and arm the 30-minute timer (`rollOffers`).
    public static func rollOffers(_ state: GameState, deps: Deps, now: Int64) -> GameState {
        let t = StateOps.takeRng(state, deps: deps)
        var offers: [ArenaOffer] = []
        var used: [String] = []
        for d in difficulties {
            guard let sim = OpponentOps.pickSims(t.state, rng: t.rng, count: 1, min: d.levelOffset.0, max: d.levelOffset.1, exclude: used).first else { continue }
            used.append(sim.id)
            offers.append(ArenaOffer(difficulty: d.id, color: d.color, simId: sim.id, power: d.power, level: sim.level, name: sim.name, avatar: sim.avatar))
        }
        var s = t.state
        s.sim.arena = ArenaState(offers: offers, rerollAt: now + offerRotationMs)
        return s
    }

    /// Fight one of the three arena offers (`fightArena`): gold `enemyDeckMana × 6` (×2 on a win), 10 TP per win,
    /// card and player xp, league points; the offers are rerolled afterwards.
    public static func fightArena(_ state: GameState, deps: Deps, now: Int64, offerIndex: Int, event: DailyEventId?) throws -> (state: GameState, info: ArenaResult) {
        let eo = ensureOffers(state, deps: deps, now: now)
        guard let offer = eo.info.offers[js: offerIndex] else { throw GameError("No such opponent") }
        guard let sim = OpponentOps.getSim(eo.state, simId: offer.simId) else { throw GameError("No such opponent") }
        let fight = try PvpOps.runPvpFight(eo.state, deps: deps, now: now, sim: sim, power: offer.power, event: event, mode: .arena)
        var s = fight.state
        let gold = PlayerOps.goldWithEvent(fight.info.enemyDeckMana * Constants.ArenaRules.goldPerEnemyMana * (fight.info.won ? Constants.ArenaRules.winGoldMult : 1), event: event)
        s = PlayerOps.addGold(s, amount: gold)
        let tp = fight.info.won ? PvpOps.tpPerWin : 0
        s.player.tournamentPoints = s.player.tournamentPoints + tp
        s = rollOffers(s, deps: deps, now: now)
        let lp = LeagueOps.addLeaguePoints(s, deps: deps, now: now, source: .arena, won: fight.info.won, event: event, difficulty: offer.difficulty, oppLevel: offer.level)
        s = lp.state
        let rewards = ArenaRewards(gold: gold, tournamentPoints: tp, cardXp: fight.info.cardXp, playerXp: fight.info.playerXp, leaguePoints: lp.points)
        return (s, ArenaResult(battle: fight.info.battle, won: fight.info.won, rewards: rewards, levelUps: fight.info.levelUps,
                               cardLevelUps: fight.info.cardLevelUps, opponent: OpponentOps.simInfo(sim, deps: deps)))
    }

    /// Info popup for an offer (`offerInfo`).
    public static func offerInfo(_ state: GameState, deps: Deps, offerIndex: Int) -> SimInfo? {
        guard let offer = state.sim.arena.offers[js: offerIndex], let sim = OpponentOps.getSim(state, simId: offer.simId) else { return nil }
        var info = OpponentOps.simInfo(sim, deps: deps)
        info.difficulty = offer.difficulty
        info.color = offer.color
        info.power = offer.power
        return info
    }
}
