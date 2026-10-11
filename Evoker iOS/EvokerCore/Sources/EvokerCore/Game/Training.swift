import Foundation

/// Card training by sacrifice (game-design §2.4): a literal port of `Evoker Web/src/game/training.js`. The trained
/// card gains the sacrificed cards' xp; the gold price is the client's enhance price of the sacrifice stack.
public enum TrainingOps {
    public static let maxSacrifices = Constants.maxSacrificeCards
    public static let trainerXp = Constants.trainerXp

    /// XP one sacrificed instance gives (`sacrificeValue`); trainer cards give a fixed xp.
    public static func sacrificeValue(deps: Deps, inst: CardInstance) -> Int {
        if let fixed = trainerXp[inst.cardId], fixed != 0 { return fixed }
        guard let def = deps.db.get(inst.cardId) else { return 0 }
        return deps.stats.sacrificeXp(def, stage: inst.stage, level: inst.level)
    }

    /// Gold price of sacrificing one instance (`sacrificePrice` → stats.enhancePrice).
    public static func sacrificePrice(deps: Deps, inst: CardInstance) -> Int {
        guard let def = deps.db.get(inst.cardId) else { return 0 }
        return deps.stats.enhancePrice(def, level: inst.level)
    }

    /// Gold cost of a training session: the sum of the sacrificed cards' prices (`trainingCost`).
    public static func trainingCost(deps: Deps, insts: [CardInstance]) -> Int {
        insts.reduce(0) { $0 + sacrificePrice(deps: deps, inst: $1) }
    }

    /// Validate and price a training session without applying it (`previewTraining`).
    public static func previewTraining(_ state: GameState, deps: Deps, trainUid: String, sacrificeUids: [String], allowDeck: Bool = false) -> TrainingPreview {
        func bad(_ reason: String) -> TrainingPreview {
            TrainingPreview(ok: false, reason: reason, xp: 0, gold: 0, levelFrom: 0, levelTo: 0, cap: 0)
        }
        guard let target = StateOps.getCard(state, uid: trainUid) else { return bad("Pick a card to train") }
        guard let def = deps.db.get(target.cardId) else { return bad("Pick a card to train") }
        let cap = CollectionOps.capFor(deps: deps, def: def, stage: target.stage)
        if sacrificeUids.isEmpty { return bad("Pick cards to sacrifice") }
        if sacrificeUids.count > maxSacrifices { return bad("At most \(maxSacrifices) cards can be sacrificed at once") }
        if Set(sacrificeUids).count != sacrificeUids.count { return bad("Duplicate sacrifice") }
        if target.level >= cap { return bad("This card is already at its level cap") }
        var xp = 0
        var stack: [CardInstance] = []
        for uid in sacrificeUids {
            if uid == trainUid { return bad("A card cannot be sacrificed to itself") }
            guard let c = StateOps.getCard(state, uid: uid) else { return bad("No such card " + uid) }
            if !allowDeck && CollectionOps.isInDeck(state, uid: uid) { return bad("Cards in the active deck cannot be sacrificed") }
            xp += sacrificeValue(deps: deps, inst: c)
            stack.append(c)
        }
        let gold = trainingCost(deps: deps, insts: stack)
        if state.player.gold < gold {
            return TrainingPreview(ok: false, reason: "Not enough gold", xp: xp, gold: gold, levelFrom: target.level, levelTo: target.level, cap: cap)
        }
        let sim = CollectionOps.addCardXp(state, deps: deps, uid: trainUid, xp: xp)
        let after = StateOps.getCard(sim.state, uid: trainUid)?.level ?? target.level
        return TrainingPreview(ok: true, reason: nil, xp: xp, gold: gold, levelFrom: target.level, levelTo: after, cap: cap)
    }

    /// Apply a training session (`train`): removes the sacrificed cards, pays gold, adds xp to the trained card.
    public static func train(_ state: GameState, deps: Deps, trainUid: String, sacrificeUids: [String], allowDeck: Bool = false) throws -> (state: GameState, info: TrainingResult) {
        let pv = previewTraining(state, deps: deps, trainUid: trainUid, sacrificeUids: sacrificeUids, allowDeck: allowDeck)
        if !pv.ok { throw GameError(pv.reason ?? "Invalid training") }
        var s = try PlayerOps.spendGold(state, amount: pv.gold)
        for uid in sacrificeUids { s = CollectionOps.removeCard(s, uid: uid) }
        let r = CollectionOps.addCardXp(s, deps: deps, uid: trainUid, xp: pv.xp)
        return (r.state, TrainingResult(xp: pv.xp, gold: pv.gold, levelUps: r.levelUps))
    }
}
