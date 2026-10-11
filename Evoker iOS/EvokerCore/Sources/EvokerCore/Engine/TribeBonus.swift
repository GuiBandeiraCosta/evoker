import Foundation

/// Race ("tribe") bonus of the original simulator (`src/engine/tribe-bonus.js`, original-engine.md §6): evaluated
/// once per side at the start of round 1. Exactly one main race present and more cards of it than neutral cards
/// → the player's hp × 1.2. The engine works on the raw race names the web keeps (an unknown name such as the
/// original client tests' "Orks" counts as its own race), the typed overloads serve the UI.
public enum TribeBonus {
    /// Max-hp multiplier granted by the race bonus (original client: `hp * 1.2`).
    public static let multiplier = 1.2

    /// `tribeOf(card)`: the lower-cased name, "neutral" for a missing one.
    public static func tribeOf(_ name: String?) -> String {
        guard let name, !name.isEmpty else { return "neutral" }
        return name.lowercased()
    }

    /// `hasTribeBonus(cards)` on race names (nil = an empty slot).
    public static func hasTribeBonus(names: [String?]) -> Bool {
        var counts: [String: Int] = [:]
        var order: [String] = []
        var neutral = 0
        for name in names {
            guard let name else { continue }
            let t = tribeOf(name)
            if t == "neutral" {
                neutral += 1
            } else {
                if counts[t] == nil { order.append(t) }
                counts[t, default: 0] += 1
            }
        }
        if counts.count != 1 { return false }
        let count = counts[order[0]] ?? 0
        return count > neutral
    }

    /// `bonusTribe(cards)` on race names: the name that earns the bonus, or nil.
    public static func bonusTribeName(names: [String?]) -> String? {
        if !hasTribeBonus(names: names) { return nil }
        for name in names {
            guard let name else { continue }
            let t = tribeOf(name)
            if t != "neutral" { return t }
        }
        return nil
    }

    /// `hasTribeBonus(cards)` for typed tribes (nil = an empty slot).
    public static func hasTribeBonus(_ tribes: [Tribe?]) -> Bool {
        hasTribeBonus(names: tribes.map { $0?.rawValue })
    }

    /// `bonusTribe(cards)` for typed tribes.
    public static func bonusTribe(_ tribes: [Tribe?]) -> Tribe? {
        bonusTribeName(names: tribes.map { $0?.rawValue }).map { Tribe(lenient: $0) }
    }

    /// The race name of a battle card as the web engine sees it (`card.tribe || card.race || 'neutral'`).
    public static func raceName(_ card: BattleCard) -> String {
        tribeOf(card.tribeName ?? card.tribe?.rawValue)
    }

    /// `hasTribeBonus(cards)` on battle cards (buildSide / the engine's raw sides).
    public static func hasTribeBonus(cards: [BattleCard?]) -> Bool {
        hasTribeBonus(names: cards.map { $0.map(raceName) })
    }

    /// The race name of a card snapshot (`tribeName` wins over the typed tribe).
    public static func raceName(_ snapshot: CardSnapshot) -> String {
        tribeOf(snapshot.tribeName ?? snapshot.tribe.rawValue)
    }
}
