import Foundation

/// The pure helpers of `Evoker Web/src/ui/store.js`: clock shifting for the daily features (the debug `addDays`).
public enum StoreHelpers {
    /// Shift every clock in the save by `deltaMs` (negative = the save looks older) (`shiftClocks`), so that daily
    /// features (regen, portal rotation, league day, daily rewards, raids, the arena offers) can be tested.
    public static func shiftClocks(_ state: GameState, deltaMs: Int64) -> GameState {
        let d = deltaMs
        func ts(_ v: Int64) -> Int64 { v > 0 ? v + d : v }
        var s = state
        s.createdAt = ts(state.createdAt)
        s.lastSeen = ts(state.lastSeen)
        s.player.regenAt = ts(state.player.regenAt)
        s.daily.lastClaim = JSDate.shiftDay(state.daily.lastClaim, d)
        s.daily.potionDealDay = JSDate.shiftDay(state.daily.potionDealDay, d)
        s.pieces = state.pieces.map { h in
            var next = h
            next.raidDay = JSDate.shiftDay(h.raidDay, d)
            return next
        }
        s.sim.day = JSDate.shiftDay(state.sim.day, d)
        s.sim.arena.rerollAt = ts(state.sim.arena.rerollAt)
        if var league = state.sim.league {
            league.day = JSDate.shiftDay(league.day, d)
            league.startedAt = ts(league.startedAt)
            league.endsAt = ts(league.endsAt)
            s.sim.league = league
        }
        if var active = state.quests.active {
            if let st = active.startedAt { active.startedAt = ts(st) }
            s.quests.active = active
        }
        return s
    }

    /// Shift the save so that `days` real days appear to have passed (`addDays` + the debug API's `daily.dayShift`
    /// bump, so the daily event follows the shifted clock). The app runs `AppFlow.onOpen` afterwards.
    public static func addDays(_ state: GameState, days: Int) -> GameState {
        var s = shiftClocks(state, deltaMs: -Int64(days) * JSDate.dayMs)
        s.daily.dayShift = (state.daily.dayShift ?? 0) + days
        return s
    }
}

/// The app's open-save flow (`Evoker Web/src/app.js onOpen`).
public enum AppFlow {
    /// What happens when a save is (re)opened (`onOpen`): regen, the daily reward, league settlement, piece raids;
    /// returns the notices to show (the save's own notices are drained).
    public static func onOpen(_ state: GameState, deps: Deps, now: Int64) -> (state: GameState, info: OnOpenResult) {
        var s = PlayerOps.applyRegen(state, now: now)
        var notices: [Notice] = []
        let daily = ShopOps.claimDaily(s, now: now)
        s = daily.state
        if daily.info.claimed, let reward = daily.info.reward {
            var fields: [String: JSONValue] = [:]
            if let v = reward.day { fields["day"] = .number(Double(v)) }
            if let v = reward.stamina { fields["stamina"] = .number(Double(v)) }
            if let v = reward.mana { fields["mana"] = .number(Double(v)) }
            if let v = reward.gems { fields["gems"] = .number(Double(v)) }
            if let v = reward.tokens { fields["tokens"] = .string(v.rawValue) }
            if let v = reward.count { fields["count"] = .number(Double(v)) }
            notices.append(Notice(type: "daily", fields))
        }
        if let league = s.sim.league, !league.settled, league.day != JSDate.utcDay(now) {
            s = LeagueOps.settleLeague(s, league: league, deps: deps).state
        }
        let raids = PieceOps.dailyRaids(s, deps: deps, now: now)
        s = raids.state
        notices.append(contentsOf: s.notices)
        s.notices = []
        return (StateOps.touch(s, now: now), OnOpenResult(notices: notices))
    }
}
