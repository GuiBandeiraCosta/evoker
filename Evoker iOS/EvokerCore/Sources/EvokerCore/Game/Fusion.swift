import Foundation

/// Fusion (game-design §2.5): two instances of the same card at the same stage (< 4) → stage + 1, level 1, with
/// the Evolve Bonus stored on the result. A literal port of `Evoker Web/src/game/fusion.js`.
public enum FusionOps {
    public static let maxStage = Constants.maxStage

    /// Validate and price a fusion (`canFuse`).
    public static func canFuse(_ state: GameState, deps: Deps, uidA: String, uidB: String, allowDeck: Bool = false) -> FusionCheck {
        func bad(_ reason: String) -> FusionCheck {
            FusionCheck(ok: false, reason: reason, cost: 0, quality: 0, warning: nil, stage: 0)
        }
        if uidA.isEmpty || uidB.isEmpty || uidA == uidB { return bad("Pick two different cards") }
        guard let a = StateOps.getCard(state, uid: uidA), let b = StateOps.getCard(state, uid: uidB) else { return bad("No such card") }
        if a.cardId != b.cardId { return bad("Only two identical cards can be fused") }
        if a.stage != b.stage { return bad("Both cards must be at the same fusion stage") }
        if a.stage >= maxStage { return bad("This card is already at the maximum fusion stage") }
        guard let def = deps.db.get(a.cardId) else { return bad("No such card") }
        let cost = deps.stats.fusionCost(rarity: def.rarity, stage: a.stage)
        let capA = CollectionOps.capFor(deps: deps, def: def, stage: a.stage), capB = CollectionOps.capFor(deps: deps, def: def, stage: b.stage)
        let quality = deps.stats.evolveQuality(a.level, capA, b.level, capB)
        // never set while EVOLVE_BONUS keeps q at 1; kept for a bonus with a span
        let warning: String? = quality < 1 && (a.level < capA || b.level < capB) ? "A card below its level cap gives a weaker result" : nil
        if !allowDeck && (CollectionOps.isInDeck(state, uid: uidA) || CollectionOps.isInDeck(state, uid: uidB)) {
            return FusionCheck(ok: false, reason: "Cards in the active deck cannot be fused", cost: cost, quality: quality, warning: warning, stage: a.stage + 1)
        }
        if state.player.gold < cost {
            return FusionCheck(ok: false, reason: "Not enough gold", cost: cost, quality: quality, warning: warning, stage: a.stage + 1)
        }
        return FusionCheck(ok: true, reason: nil, cost: cost, quality: quality, warning: warning, stage: a.stage + 1)
    }

    /// Fuse two cards (`fuse`): both inputs are consumed and a new instance is created at stage + 1, level 1. With
    /// `allowDeck`, a fused deck card hands its slot to the result (A's slot first).
    public static func fuse(_ state: GameState, deps: Deps, uidA: String, uidB: String, allowDeck: Bool = false) throws -> (state: GameState, info: FusionResult) {
        let v = canFuse(state, deps: deps, uidA: uidA, uidB: uidB, allowDeck: allowDeck)
        if !v.ok { throw GameError(v.reason ?? "Cannot fuse") }
        guard let a = StateOps.getCard(state, uid: uidA) else { throw GameError("No such card") }
        let slotA = state.deck.firstIndex { $0 == uidA } ?? -1
        let slotB = state.deck.firstIndex { $0 == uidB } ?? -1
        let slot = slotA >= 0 ? slotA : slotB
        var s = try PlayerOps.spendGold(state, amount: v.cost)
        s = CollectionOps.removeCard(CollectionOps.removeCard(s, uid: uidA), uid: uidB)
        let r = try CollectionOps.addCard(s, deps: deps, cardId: a.cardId, stage: v.stage, level: 1, evolveQuality: v.quality, force: true)
        var next = r.state
        let uid = r.info.uid ?? ""
        if slot >= 0 {
            next.deck[slot] = uid
        }
        return (next, FusionResult(uid: uid, quality: v.quality, cost: v.cost, stage: v.stage, slot: slot))
    }

    /// Pairs of instances in the collection that could be fused (`fusionCandidates`, for the Fusion tab).
    public static func fusionCandidates(_ state: GameState, deps: Deps) -> [FusionCandidate] {
        var order: [String] = []
        var groups: [String: FusionCandidate] = [:]
        for c in state.cards {
            if c.stage >= maxStage || CollectionOps.isInDeck(state, uid: c.uid) { continue }
            let key = c.cardId + "#" + String(c.stage)
            if groups[key] == nil {
                groups[key] = FusionCandidate(cardId: c.cardId, stage: c.stage, uids: [])
                order.append(key)
            }
            groups[key]!.uids.append(c.uid)
        }
        return order.compactMap { groups[$0] }.filter { $0.uids.count >= 2 && deps.db.get($0.cardId) != nil }
    }
}
