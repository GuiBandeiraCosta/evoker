import Foundation

/// A row of the PRIZES screen (league.js prizeTables).
public struct PrizeTableRow: Hashable, Sendable {
    public var rank: String
    public var text: String
    public init(rank: String, text: String) { self.rank = rank; self.text = text }
}

public struct PrizeTable: Sendable {
    public var tier: Constants.LeagueTierDef
    public var rows: [PrizeTableRow]
    public init(tier: Constants.LeagueTierDef, rows: [PrizeTableRow]) { self.tier = tier; self.rows = rows }
}

/// League (game-design §6): a league per UTC day with 49 simulated players earning points along deterministic
/// curves, three tiers, prizes, promotion. A literal port of `Evoker Web/src/game/league.js`.
public enum LeagueOps {
    public static let leagueSize = Constants.LeagueRules.players
    public static let simCount = Constants.LeagueRules.players - 1
    public static let pointsPerWin = Constants.LeagueRules.pointsPerWin
    public static let maxFightsPerOpponent = Constants.LeagueRules.maxFightsPerOpponent
    public static let promoteTop = Constants.LeagueRules.promote
    public static let leagueVersion = 3
    public static let tierColors = Constants.LeagueRules.tierColors
    public static let rulesText = Constants.LeagueRules.rulesText
    /// Tiers (TIERS; `strength` is the web's `power`).
    public static let tiers: [Constants.LeagueTierDef] = Constants.LeagueRules.tiers

    /// Share of simulated players that never fight in a league (INACTIVE_SHARE).
    static let inactiveShare = 0.28
    /// Share of active simulated players that only fight league fights (PURE_LEAGUE_SHARE).
    static let pureLeagueShare = 0.5

    /// Tier definition for a tier id (`tierById`; 'platinum' maps to Gold, unknown → Bronze).
    public static func tierById(_ tierId: String?) -> Constants.LeagueTierDef {
        let id = tierId == "platinum" ? "gold" : (tierId ?? "")
        return tiers.first { $0.id.rawValue == id } ?? tiers[0]
    }

    public static func tierDef(_ tier: LeagueTier) -> Constants.LeagueTierDef {
        tiers.first { $0.id == tier } ?? tiers[0]
    }

    /// The tier after a finished league (`nextTier`): the top 3 with points go one up (Gold stays Gold), everybody else to Bronze.
    public static func nextTier(_ tier: LeagueTier, rank: Int?, points: Int) -> LeagueTier {
        let i = tier.index
        if points > 0, let r = rank, r <= promoteTop { return tiers[min(tiers.count - 1, i + 1)].id }
        return tiers[0].id
    }

    /// The league the player is in or enters next (`leagueTierOf`), old saves mapped.
    public static func leagueTierOf(_ state: GameState) -> LeagueTier {
        if let t = state.sim.leagueTier { return t }
        if let l = state.sim.league { return l.tier }
        return tiers[0].id
    }

    /// Has the player confirmed the enter popup? (`hasJoined`; old saves that played a league count as joined.)
    public static func hasJoined(_ state: GameState) -> Bool {
        if let j = state.sim.leagueJoined { return j }
        if let l = state.sim.league, l.v != leagueVersion { return true }
        return !state.sim.leagueHistory.isEmpty
    }

    /// Confirm the enter popup (`joinLeague`).
    public static func joinLeague(_ state: GameState) -> GameState {
        var s = state
        s.sim.leagueJoined = true
        s.sim.leagueTier = leagueTierOf(state)
        return s
    }

    /// Prize band of a rank in a tier (`prizeBand`), nil outside the bands or without a rank.
    public static func prizeBand(_ tier: LeagueTier, rank: Int?) -> Constants.PrizeBand? {
        guard let r = rank, r >= 1 else { return nil }
        let bands = Constants.LeagueRules.prizes[tierDef(tier).id] ?? []
        return bands.first { r >= $0.from && r <= $0.to }
    }

    /// Prize items of a rank, in the order the list shows them (`prizeItems`).
    public static func prizeItems(_ tier: LeagueTier, rank: Int?) -> [PrizeItem] {
        guard let b = prizeBand(tier, rank: rank) else { return [] }
        var out: [PrizeItem] = []
        if let c = b.card { out.append(PrizeItem(kind: .card, amount: 1, rarity: c)) }
        if b.mana != 0 { out.append(PrizeItem(kind: .mana, amount: b.mana)) }
        if b.stamina != 0 { out.append(PrizeItem(kind: .stamina, amount: b.stamina)) }
        if b.gems != 0 { out.append(PrizeItem(kind: .gems, amount: b.gems)) }
        return out
    }

    /// Prize text of a band like the PRIZES screen (`prizeText`).
    public static func prizeText(_ band: Constants.PrizeBand) -> String {
        var parts: [String] = []
        if let c = band.card { parts.append("1 \(c.rawValue) card") }
        if band.mana != 0 { parts.append("\(band.mana) mana potion" + (band.mana == 1 ? "" : "s")) }
        if band.stamina != 0 { parts.append("\(band.stamina) stamina potion" + (band.stamina == 1 ? "" : "s")) }
        if band.gems != 0 { parts.append("\(band.gems) gems") }
        return parts.joined(separator: ", ")
    }

    /// Rows of the PRIZES screen, Gold first (`prizeTables`).
    public static func prizeTables() -> [PrizeTable] {
        tiers.reversed().map { tier in
            let bands = Constants.LeagueRules.prizes[tier.id] ?? []
            return PrizeTable(tier: tier, rows: bands.map { b in
                PrizeTableRow(rank: b.from == b.to ? String(b.from) : "\(b.from)-\(b.to)", text: prizeText(b))
            })
        }
    }

    /// Activity profile of a simulated player for one league (`simProfile`).
    public static func simProfile(rng: RandomSource, tier: Constants.LeagueTierDef) -> SimProfile {
        let pic = rng.chance(0.4)
        if rng.chance(inactiveShare) { return SimProfile(w: 0, x: 0, k: 1, pic: pic) }
        let total = tier.simTop * (0.03 + 0.97 * JSMath.pow(rng.next(), 2.4))
        let k = JSMath.round((0.6 + 1.2 * rng.next()) * 100) / 100
        if rng.chance(pureLeagueShare) {
            return SimProfile(w: max(1, JSMath.roundInt(total / Double(pointsPerWin))), x: 0, k: k, pic: pic)
        }
        let share = 0.45 + 0.5 * rng.next()
        let w = JSMath.floorInt((total * share) / Double(pointsPerWin))
        return SimProfile(w: w, x: max(1, JSMath.roundInt(total - Double(w * pointsPerWin))), k: k, pic: pic)
    }

    /// Points a simulated player has at a time (`simPoints`); old leagues store a wins-per-day rate instead.
    public static func simPoints(_ league: League, simId: String, now: Int64) -> Int {
        let span = max(1, league.endsAt - league.startedAt)
        let t = min(now, league.endsAt)
        let fraction = max(0, min(1, Double(t - league.startedAt) / Double(span)))
        let mult = league.doublePoints ? 2 : 1
        if let p = league.profiles[simId] {
            let g = JSMath.pow(fraction, p.k == 0 ? 1 : p.k)
            return (JSMath.floorInt(Double(p.w) * g + 1e-9) * pointsPerWin + JSMath.floorInt(Double(p.x) * g + 1e-9)) * mult
        }
        let rate = league.rates?[simId] ?? 0
        return JSMath.floorInt(rate * fraction) * pointsPerWin * mult
    }

    /// Create today's league in the player's tier (`createLeague`).
    public static func createLeague(_ state: GameState, deps: Deps, now: Int64, event: DailyEventId?, keepPoints: Int = 0, keepFights: [String: Int] = [:]) -> GameState {
        var s = OpponentOps.ensurePool(state, deps: deps, now: now).state
        let t = StateOps.takeRng(s, deps: deps)
        s = t.state
        let tier = tierDef(leagueTierOf(s))
        let sims = OpponentOps.pickSims(s, rng: t.rng, count: simCount, min: -3, max: 5)
        var profiles: [String: SimProfile] = [:]
        for sim in sims { profiles[sim.id] = simProfile(rng: t.rng, tier: tier) }
        let startedAt = JSDate.utcDayStart(now)
        var fights: [String: Int] = [:]
        for (id, n) in keepFights where profiles[id] != nil { fights[id] = n }
        let league = League(v: leagueVersion, day: JSDate.utcDay(now), startedAt: startedAt, endsAt: startedAt + JSDate.dayMs, tier: tier.id,
                            power: tier.strength, simIds: sims.map { $0.id }, profiles: profiles, fights: fights, points: keepPoints,
                            doublePoints: event == .doubleLeaguePoints, settled: false, rates: nil)
        s.sim.league = league
        s.sim.leagueTier = tier.id
        return s
    }

    /// Rank rows by points (`rankRows`): ties share a rank (1, 2, 2, 4), players without points have no rank ("-");
    /// within a tie the human comes first, then by name.
    public static func rankRows(_ rows: [LeagueRow]) -> [LeagueRow] {
        var sorted = rows.sorted { a, b in
            if a.points != b.points { return a.points > b.points }
            if a.isPlayer != b.isPlayer { return a.isPlayer }
            return JSString.localeCompare(a.name, b.name) < 0
        }
        var rank = 0
        for i in sorted.indices {
            if i == 0 || sorted[i].points != sorted[i - 1].points { rank = i + 1 }
            sorted[i].rank = sorted[i].points > 0 ? rank : nil
            sorted[i].rankText = sorted[i].rank.map(String.init) ?? "-"
        }
        return sorted
    }

    static func rowsFor(_ state: GameState, league: League, now: Int64) -> [LeagueRow] {
        let tier = tierDef(league.tier)
        var rows: [LeagueRow] = league.simIds.map { id in
            let sim = OpponentOps.getSim(state, simId: id)
            let prof = league.profiles[id]
            let used = league.fights[id] ?? 0
            return LeagueRow(id: id, name: sim?.name ?? id, avatar: sim?.avatar ?? 0, picture: prof.map { $0.pic } ?? true,
                             level: sim?.level ?? 0, points: simPoints(league, simId: id, now: now), isPlayer: false,
                             fightsLeft: max(0, maxFightsPerOpponent - used))
        }
        rows.append(LeagueRow(id: "player", name: state.player.name, avatar: state.player.avatar, picture: true, level: state.player.level,
                              points: league.points, isPlayer: true, fightsLeft: 0))
        var ranked = rankRows(rows)
        let active = league.day == JSDate.utcDay(now) && now < league.endsAt && !league.settled
        for i in ranked.indices {
            ranked[i].rewards = prizeItems(tier.id, rank: ranked[i].rank)
            ranked[i].markRank = ranked[i].rank.map { $0 <= promoteTop } ?? false
            ranked[i].fightable = active && !ranked[i].isPlayer && ranked[i].fightsLeft > 0
        }
        return ranked
    }

    /// Final standings of a league (at its end time) and the player's row (`finalStandings`).
    public static func finalStandings(_ state: GameState, league: League) -> FinalStandings {
        let rows = rowsFor(state, league: league, now: league.endsAt)
        let me = rows.first { $0.isPlayer } ?? LeagueRow(id: "player", name: state.player.name, avatar: state.player.avatar, picture: true,
                                                        level: state.player.level, points: league.points, isPlayer: true, fightsLeft: 0)
        // A player without points has no rank; "Your Rank" then shows the first place below everybody who scored.
        let place = me.rank ?? (rows.filter { $0.points > 0 }.count + 1)
        return FinalStandings(rows: rows, rank: me.rank, place: place, me: me)
    }

    /// Prize of a rank as totals (`prizeFor`).
    public static func prizeFor(rank: Int?, tier: LeagueTier = .bronze) -> LeaguePrize {
        let b = prizeBand(tier, rank: rank)
        var potions: [PotionKind] = []
        for _ in 0..<(b?.mana ?? 0) { potions.append(.mana) }
        for _ in 0..<(b?.stamina ?? 0) { potions.append(.stamina) }
        return LeaguePrize(gems: b?.gems ?? 0, potions: potions, card: b?.card, mana: b?.mana ?? 0, stamina: b?.stamina ?? 0)
    }

    /// Grant a prize card of a rarity (`grantPrizeCard`): a random card of that rarity, level 1.
    static func grantPrizeCard(_ state: GameState, deps: Deps, rarity: Rarity) -> (state: GameState, cardId: String?) {
        let pool = CollectionOps.cardsOfRarity(deps.db, rarity: rarity, setIds: nil)
        if pool.isEmpty { return (state, nil) }
        let t = StateOps.takeRng(state, deps: deps)
        guard let def = t.rng.pick(pool) else { return (state, nil) }
        let added: (state: GameState, info: AddCardResult) = (try? CollectionOps.addCard(t.state, deps: deps, cardId: def.id))
            ?? (state: t.state, info: AddCardResult(uid: nil, converted: false, gold: 0))
        return (added.state, def.id)
    }

    /// Settle a finished league (`settleLeague`): the prize, Tournament Points (= points / 10), promotion /
    /// relegation, history, and the pending result for the finish popup.
    public static func settleLeague(_ state: GameState, league: League, deps: Deps) -> (state: GameState, prizes: LeaguePrizes) {
        let fs = finalStandings(state, league: league)
        let tier = tierDef(league.tier)
        let points = league.points
        let prize = prizeFor(rank: fs.rank, tier: tier.id)
        var s = PlayerOps.addGems(state, amount: prize.gems)
        if prize.mana != 0 { s = PlayerOps.addPotions(s, kind: .mana, count: prize.mana) }
        if prize.stamina != 0 { s = PlayerOps.addPotions(s, kind: .stamina, count: prize.stamina) }
        var cardId: String? = nil
        if let c = prize.card {
            let g = grantPrizeCard(s, deps: deps, rarity: c)
            s = g.state
            cardId = g.cardId
        }
        let tp = points / Constants.LeagueRules.tournamentPointsDiv
        s.player.tournamentPoints = s.player.tournamentPoints + tp
        let next = nextTier(tier.id, rank: fs.rank, points: points)
        let prizes = LeaguePrizes(day: league.day, tier: tier.id, rank: fs.place, ranked: fs.rank != nil, points: points, gems: prize.gems,
                                  potions: prize.potions, mana: prize.mana, stamina: prize.stamina, card: prize.card, cardId: cardId,
                                  cardPending: false, tournamentPoints: tp, nextTier: next, promoted: next.index > tier.id.index)
        var settled = league
        settled.settled = true
        s.sim.leagueScore = s.sim.leagueScore + points
        s.sim.leagueTier = next
        s.sim.league = settled
        s.sim.leagueHistory = Array(([prizes] + s.sim.leagueHistory).prefix(30))
        s.sim.leaguePending = prizes
        var fields: [String: JSONValue] = (try? JSONValue.of(prizes))?.objectValue ?? [:]
        fields["type"] = .string("league")
        s = StateOps.addNotice(s, Notice(fields))
        return (s, prizes)
    }

    /// Confirm the finish popup (`collectLeagueResult`): clears the pending result, granting a card prize that is still pending.
    public static func collectLeagueResult(_ state: GameState, deps: Deps) -> (state: GameState, result: LeaguePrizes?) {
        guard let pending = state.sim.leaguePending else { return (state, nil) }
        var s = state
        var result = pending
        if pending.cardPending, let c = pending.card {
            let g = grantPrizeCard(s, deps: deps, rarity: c)
            s = g.state
            result.cardId = g.cardId
            result.cardPending = false
        }
        s.sim.leaguePending = nil
        return (s, result)
    }

    /// Open the League tab (`openLeague`): settles an earlier day's league, upgrades an old-format league of today
    /// and joins today's league.
    public static func openLeague(_ state: GameState, deps: Deps, now: Int64, event: DailyEventId?) -> (state: GameState, info: OpenLeagueResult) {
        var s = OpponentOps.ensurePool(state, deps: deps, now: now).state
        if s.sim.leagueJoined == nil { s.sim.leagueJoined = hasJoined(s) }
        var prizes: LeaguePrizes? = nil
        let league = s.sim.league
        let today = JSDate.utcDay(now)
        if let l = league, l.day != today {
            if !l.settled {
                let r = settleLeague(s, league: l, deps: deps)
                s = r.state
                prizes = r.prizes
            }
            s = createLeague(s, deps: deps, now: now, event: event)
        } else if league == nil {
            s = createLeague(s, deps: deps, now: now, event: event)
        } else if let l = league, l.v != leagueVersion {
            let ev: DailyEventId? = event ?? (l.doublePoints ? .doubleLeaguePoints : nil)
            s = createLeague(s, deps: deps, now: now, event: ev, keepPoints: l.points, keepFights: l.fights)
        }
        return (s, OpenLeagueResult(league: s.sim.league!, prizes: prizes))
    }

    /// Live standings for the current league (`standings`).
    public static func standings(_ state: GameState, deps: Deps, now: Int64) -> [LeagueRow] {
        guard let league = state.sim.league else { return [] }
        return rowsFor(state, league: league, now: min(now, league.endsAt))
    }

    /// Can the player fight this opponent now? (`canFightLeague`)
    public static func canFightLeague(_ state: GameState, simId: String, now: Int64) -> CanFightLeague {
        guard let league = state.sim.league, league.day == JSDate.utcDay(now), !league.settled else {
            return CanFightLeague(ok: false, code: .ended, reason: "The league has ended", fightsLeft: 0)
        }
        if !league.simIds.contains(simId) { return CanFightLeague(ok: false, code: .notMember, reason: "Not in this league", fightsLeft: 0) }
        let left = maxFightsPerOpponent - (league.fights[simId] ?? 0)
        if left <= 0 { return CanFightLeague(ok: false, code: .foughtOut, reason: "You already fought this player \(maxFightsPerOpponent) times", fightsLeft: 0) }
        return CanFightLeague(ok: true, code: nil, reason: nil, fightsLeft: left)
    }

    /// Points a won fight is worth now (`pointsFor`): ×2 on a Double League Points day; arena / piece-hunt points
    /// scale with the level gap within 0.6–1.6.
    public static func pointsFor(_ league: League?, source: LeaguePointSource, event: DailyEventId?, difficulty: Difficulty? = nil, oppLevel: Int? = nil, myLevel: Int? = nil) -> Int {
        var base = Constants.LeagueRules.sourcePoints[source.rawValue] ?? 0
        if source == .arena, let d = difficulty, let p = Constants.LeagueRules.arenaPoints[d] { base = p }
        if source != .league, let opp = oppLevel, let my = myLevel {
            let (lo, hi) = Constants.LeagueRules.stakeRange
            base = JSMath.roundInt(Double(base) * min(hi, max(lo, 1 + Constants.LeagueRules.stakeLevelStep * Double(opp - my))))
        }
        let double = (league?.doublePoints ?? false) || event == .doubleLeaguePoints
        return base * (double ? 2 : 1)
    }

    /// League points an Arena / piece-hunt win against this opponent would add right now (`leagueStake`), or 0.
    public static func leagueStake(_ state: GameState, source: LeaguePointSource, difficulty: Difficulty? = nil, oppLevel: Int? = nil, event: DailyEventId?) -> Int {
        if !StateOps.isUnlocked(state, .league) || !hasJoined(state) { return 0 }
        return pointsFor(state.sim.league, source: source, event: event, difficulty: difficulty, oppLevel: oppLevel, myLevel: state.player.level)
    }

    /// Fight a league opponent (`fightLeague`): costs deck mana, 150 points per win (300 on Double Points days).
    public static func fightLeague(_ state: GameState, deps: Deps, now: Int64, simId: String, event: DailyEventId?) throws -> (state: GameState, info: LeagueFightResult) {
        let check = canFightLeague(state, simId: simId, now: now)
        if !check.ok { throw GameError(check.reason ?? "Cannot fight") }
        guard let sim = OpponentOps.getSim(state, simId: simId) else { throw GameError("No such player") }
        guard let league = state.sim.league else { throw GameError("The league has ended") }
        let fight = try PvpOps.runPvpFight(state, deps: deps, now: now, sim: sim, power: league.power, event: event, mode: .league)
        var s = fight.state
        let points = fight.info.won ? pointsFor(league, source: .league, event: event) : 0
        var next = league
        next.fights[simId] = (league.fights[simId] ?? 0) + 1
        next.points = league.points + points
        s.sim.league = next
        return (s, LeagueFightResult(battle: fight.info.battle, won: fight.info.won, points: points, levelUps: fight.info.levelUps,
                                     cardLevelUps: fight.info.cardLevelUps, opponent: OpponentOps.simInfo(sim, deps: deps)))
    }

    /// League points from fights outside the League tab (`addLeaguePoints`): only for a player who unlocked and
    /// joined the league; today's league is created (settling an older one) first when needed.
    public static func addLeaguePoints(_ state: GameState, deps: Deps, now: Int64, source: LeaguePointSource, won: Bool, event: DailyEventId?, difficulty: Difficulty? = nil, oppLevel: Int? = nil) -> (state: GameState, points: Int) {
        if !won || !StateOps.isUnlocked(state, .league) || !hasJoined(state) { return (state, 0) }
        var s = state
        let league = s.sim.league
        if league == nil || league!.day != JSDate.utcDay(now) || league!.settled || league!.v != leagueVersion {
            s = openLeague(s, deps: deps, now: now, event: event).state
        }
        guard let lg = s.sim.league else { return (s, 0) }
        let points = pointsFor(lg, source: source, event: event, difficulty: difficulty, oppLevel: oppLevel, myLevel: s.player.level)
        if points == 0 { return (s, 0) }
        var next = lg
        next.points = lg.points + points
        s.sim.league = next
        return (s, points)
    }
}
