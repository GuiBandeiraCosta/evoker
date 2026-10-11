import Foundation

/// Human-readable summary of an event log (`summariseBattle` of battle.js): for console logs and tests.
public struct BattleSummary: Hashable, Sendable {
    public var winner: Winner?
    public var rounds: Int
    public var attackerHp: Int?
    public var defenderHp: Int?
    public var deaths: Deaths
    public var lines: [String]
}

public enum Summaries {
    /// `summariseBattle(events)`.
    public static func summarise(_ events: [BattleEvent]) -> BattleSummary {
        var lines: [String] = []
        var deaths = Deaths()
        var end: (winner: Winner, rounds: Int, attackerHp: Int, defenderHp: Int)?
        func who(_ side: Side, _ slot: Int?) -> String {
            slot.map { "\(side.rawValue)[\($0)]" } ?? "\(side.rawValue) player"
        }
        for e in events {
            switch e {
            case .battleStart(let seed, _, _):
                lines.append("battle start (seed \(seed))")
            case .roundStart(let round, _, _):
                lines.append("-- round \(round)")
            case .status(let side, let slot, let status, _, _):
                lines.append("\(who(side, slot)) \(status.rawValue)")
            case .buff(let side, let slot, let stat, let delta, let permanent, _):
                lines.append("\(who(side, slot)) \(stat.rawValue) \(delta >= 0 ? "+" : "")\(delta)\(permanent ? " (permanent)" : "")")
            case .attack(let side, let slot, _, _, let targets):
                let list = targets.map { t in "\(who(t.side, t.slot)) for \(t.damage)\(t.blocked ? " (blocked)" : "")" }.joined(separator: ", ")
                lines.append("\(who(side, slot)) attacks \(list.isEmpty ? "nothing" : list)")
            case .damage(let side, let slot, let amount, let hp, let cause, let blocked, _):
                lines.append("\(who(side, slot)) takes \(amount) (\(cause.rawValue)\(blocked ? ", blocked" : "")) -> \(hp)")
            case .heal(let side, let slot, let amount, let hp, _):
                lines.append("\(who(side, slot)) heals \(amount) -> \(hp)")
            case .death(let side, let slot, let card):
                deaths[side] += 1
                lines.append("\(who(side, slot)) \(card.name ?? card.cardId ?? "card") dies")
            case .revive(let side, let slot, let hp, let attack, _):
                lines.append("\(who(side, slot)) revives at \(hp) hp, attack \(attack)")
            case .swap(let side, let slot, let attack, let hp, _, _):
                lines.append("\(who(side, slot)) swaps stats -> attack \(attack), hp \(hp)")
            case .gamble(let side, let slot, let failed, _):
                lines.append("\(who(side, slot)) gamble \(failed ? "failed" : "succeeded")")
            case .roundEnd(let round, let a, let d, _):
                lines.append("round \(round) end: attacker \(a) / defender \(d)")
            case .battleEnd(let winner, let rounds, let a, let d, _):
                end = (winner, rounds, a, d)
                lines.append("battle end: \(winner.rawValue) after \(rounds) rounds (\(a) vs \(d))")
            }
        }
        return BattleSummary(winner: end?.winner, rounds: end?.rounds ?? 0, attackerHp: end?.attackerHp, defenderHp: end?.defenderHp,
                             deaths: deaths, lines: lines)
    }

    /// The lines of `summariseBattle(events)`.
    public static func lines(_ events: [BattleEvent]) -> [String] {
        summarise(events).lines
    }
}
