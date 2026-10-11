import Foundation

/// Battle playback timeline (`src/ui/battle/timeline.js`, pure): groups the engine's event log into timed steps for
/// the battle scene.
///  - `fromEvents(events, speed)`: steps with their duration; steps of round n carry `factor` = roundFactor(n)
///  - `tribeBonuses(battleStart)`: the sides whose HP the tribe bonus raised (+20 %)
///  - `lethalStep(events)`: the step the lethal-blow finale replaces
public enum Timeline {
    /// Base duration (ms at speed 1x) per step kind (`STEP_MS`).
    public static let stepMs = StepTiming.stepMs
    /// Speed-up per round of the original server timelines (`ROUND_FACTOR`).
    public static let roundFactorBase = StepTiming.roundFactor
    /// Floor of the per-round factor (`MIN_ROUND_FACTOR`).
    public static let minRoundFactor = StepTiming.minRoundFactor
    /// The lethal-blow finale timings (`FINALE`).
    public static let finale = StepTiming.finale

    /// Time factor of a round (`roundFactor`: 1 for round 1, 0.9 for round 2, ...).
    public static func roundFactor(_ round: Int) -> Double {
        let n = Swift.max(1, round == 0 ? 1 : round)
        return Swift.max(minRoundFactor, JSMath.pow(roundFactorBase, Double(n - 1)))
    }

    /// Duration of a step at a playback speed (`stepDuration`): max(1, round(base × factor / speed)).
    public static func stepDuration(kind: StepKind, baseMs: Int?, factor: Double?, speed: Double) -> Int {
        var base = Double(baseMs ?? stepMs[kind] ?? stepMs[.misc]!)
        if let factor, factor.isFinite { base *= factor }
        let s = speed > 0 ? speed : 1
        return Swift.max(1, JSMath.roundInt(base / s))
    }

    /// Duration of a built step at a playback speed.
    public static func stepDuration(_ step: PlaybackStep, speed: Double = 1) -> Int {
        stepDuration(kind: step.kind, baseMs: step.baseMs, factor: step.factor, speed: speed)
    }

    /// A max-HP change of a player (raise_player_hp), not of a card.
    static func isPlayerMaxHp(_ ev: BattleEvent) -> Bool {
        if case .buff(_, let slot, let stat, _, _, _) = ev { return stat == .maxHp && slot == nil }
        return false
    }

    static func sameSource(_ a: EventSource?, _ b: EventSource?) -> Bool {
        guard let a, let b else { return false }
        let ea: String? = a.effect.isEmpty ? nil : a.effect
        let eb: String? = b.effect.isEmpty ? nil : b.effect
        return a.side == b.side && a.slot == b.slot && ea == eb
    }

    /// The engine logs a reflector's death before the damage it reflects (damage -> death -> damage/reflect from the
    /// dead card). Move each death past the reflect damages its card sources right after it, so the bounce joins
    /// the attack step and the dissolve follows (`orderDeathsAfterReflects`).
    public static func orderDeathsAfterReflects(_ list: [BattleEvent]) -> [BattleEvent] {
        var out = list
        var i = 0
        while i < out.count {
            let ev = out[i]
            guard case .death(let side, let slot, _) = ev else { i += 1; continue }
            var j = i + 1
            while j < out.count, case .damage(_, _, _, _, let cause, _, let source) = out[j], cause == .reflect,
                  let source, source.side == side, source.slot == slot {
                j += 1
            }
            if j == i + 1 { i += 1; continue }
            out.remove(at: i)
            out.insert(ev, at: j - 1)
            i = j - 1
            i += 1
        }
        return out
    }

    /// Build the playback timeline from an event log (`fromEvents`). Consecutive damage events of an attack are
    /// folded into the attack step; consecutive ability damages, heals (same source) and deaths are grouped so they
    /// animate together.
    public static func fromEvents(_ events: [BattleEvent], speed: Double = 1) -> [PlaybackStep] {
        let list = orderDeathsAfterReflects(events)
        var steps: [PlaybackStep] = []
        var factor = 1.0
        var i = 0
        while i < list.count {
            let ev = list[i]
            let kind: StepKind
            let payload: StepPayload
            var covered: [BattleEvent] = [ev]
            var baseMs: Int?
            switch ev {
            case .battleStart(let seed, let attacker, let defender):
                let bonus = tribeBonuses(ev)
                kind = .start
                payload = .start(attacker: attacker, defender: defender, seed: seed, bonus: bonus)
                if !bonus.isEmpty { baseMs = stepMs[.bonus] }
            case .roundStart(let round, _, _):
                factor = roundFactor(round)
                kind = .round
                payload = .round(round)
            case .status(let side, let slot, let status, let on, let source):
                kind = .status
                payload = .status(side: side, slot: slot, status: status, on: on, source: source)
            case .buff(let side, let slot, let stat, let delta, let permanent, let source):
                var total = delta
                if isPlayerMaxHp(ev) {
                    // the engine re-applies the player max-HP raises every round start (-x for the old raise, +x for the
                    // new one): one step with the net change, silent when nothing changed
                    while i + 1 < list.count, isPlayerMaxHp(list[i + 1]), list[i + 1].side == side {
                        i += 1
                        covered.append(list[i])
                        if case .buff(_, _, _, let d, _, _) = list[i] { total += d }
                    }
                    if total == 0 { baseMs = 1 }
                }
                kind = .buff
                payload = .buff(side: side, slot: slot, stat: stat, delta: total, permanent: permanent, source: source)
            case .attack(let side, let slot, let attack, _, let targets):
                var hits: [BattleEvent] = []
                while i + 1 < list.count, case .damage(_, _, _, _, let cause, _, _) = list[i + 1], cause == .attack || cause == .reflect {
                    i += 1
                    hits.append(list[i])
                }
                kind = .attack
                payload = .attack(side: side, slot: slot, attack: attack, targets: targets, hits: hits)
                covered = [ev] + hits
                if targets.isEmpty && hits.isEmpty { baseMs = 200 }
            case .damage(_, _, _, _, let cause, _, let source):
                var hits: [BattleEvent] = [ev]
                while i + 1 < list.count, case .damage(_, _, _, _, let c2, _, let s2) = list[i + 1], c2 == cause, sameSource(s2, source) {
                    i += 1
                    hits.append(list[i])
                }
                kind = .damage
                payload = .damage(cause: cause, source: source, hits: hits)
                covered = hits
            case .heal(_, _, _, _, let source):
                var heals: [BattleEvent] = [ev]
                while i + 1 < list.count, case .heal(_, _, _, _, let s2) = list[i + 1], sameSource(s2, source) {
                    i += 1
                    heals.append(list[i])
                }
                kind = .heal
                payload = .heal(source: source, heals: heals)
                covered = heals
            case .death:
                var deaths: [BattleEvent] = [ev]
                while i + 1 < list.count, case .death = list[i + 1] {
                    i += 1
                    deaths.append(list[i])
                }
                kind = .death
                payload = .death(deaths: deaths)
                covered = deaths
            case .revive(let side, let slot, let hp, let attack, _):
                kind = .revive
                payload = .revive(side: side, slot: slot, hp: hp, attack: attack)
            case .roundEnd(let round, let a, let d, _):
                kind = .roundEnd
                payload = .roundEnd(round: round, attackerHp: a, defenderHp: d)
            case .battleEnd(let winner, let rounds, let a, let d, let endedBy):
                kind = .end
                payload = .end(winner: winner, rounds: rounds, attackerHp: a, defenderHp: d, endedBy: endedBy)
            case .swap, .gamble:
                kind = .misc
                payload = .misc(ev)
            }
            let stepFactor: Double? = (kind != .start && kind != .end && factor != 1) ? factor : nil
            let dur = stepDuration(kind: kind, baseMs: baseMs, factor: stepFactor, speed: speed)
            steps.append(PlaybackStep(kind: kind, payload: payload, durationMs: dur, baseMs: baseMs, factor: stepFactor, events: covered))
            i += 1
        }
        return steps
    }

    /// The tribe-bonus moment of a fight start (`tribeBonuses`): for every side whose player HP the race bonus
    /// raised, the HP before and after (+20 %) and the tribe that earned it. The snapshot carries `tribeBonus` and,
    /// for sides built by buildSide(), `baseMaxHp`; otherwise the base is derived from the multiplier.
    public static func tribeBonuses(_ start: BattleEvent) -> [TribeBonusMoment] {
        guard case .battleStart(_, let attacker, let defender) = start else { return [] }
        var out: [TribeBonusMoment] = []
        for (side, s) in [(Side.attacker, attacker), (Side.defender, defender)] {
            let p = s.player
            guard p.tribeBonus else { continue }
            let to = p.maxHp
            let from: Int = (p.baseMaxHp ?? 0) > 0 ? p.baseMaxHp! : JSMath.roundInt(Double(to) / TribeBonus.multiplier)
            guard to > from else { continue }
            let names: [String?] = s.cards.compactMap { $0 }.map { TribeBonus.raceName($0) }
            let tribe = Tribe(lenient: TribeBonus.bonusTribeName(names: names) ?? "neutral")
            out.append(TribeBonusMoment(side: side, from: from, to: to, tribe: tribe))
        }
        return out
    }

    /// Index of the step that would drop a losing player's HP to 0 or below (the finale replaces it and every step
    /// after it), or -1 when the fight does not end on a player's HP (`lethalStep`).
    public static func lethalStep(_ events: [BattleEvent], steps: [PlaybackStep]? = nil) -> Int {
        guard let end = events.first(where: { if case .battleEnd = $0 { return true } else { return false } }),
              case .battleEnd(_, _, _, _, let endedBy) = end, endedBy == .playerHp else { return -1 }
        let final = BoardModel.final(events: events)
        let lethal = [Side.attacker, Side.defender].filter { final[$0].player.hp <= 0 }
        if lethal.isEmpty { return -1 }
        let list = steps ?? fromEvents(events)
        var scratch = BoardModel.initial(events: events)
        for (i, step) in list.enumerated() {
            if step.kind == .end { return -1 }
            for ev in step.events { scratch.reduce(ev) }
            if lethal.contains(where: { scratch[$0].player.hp <= 0 }) { return i }
        }
        return -1
    }

    /// The HP shown during the finale count-down (`countdownValue`): ease-in from `from` to `to` (k = 0..1).
    public static func countdownValue(from: Int, to: Int, k: Double) -> Int {
        let t = Swift.max(0, Swift.min(1, k.isFinite ? k : 0))
        return JSMath.roundInt(Double(from) + Double(to - from) * t * t)
    }
}
