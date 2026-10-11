import Foundation
import EvokerCore

/// Pure helpers of the Cards screen (`src/ui/screens/cards-helpers.js`): the slider geometry and sort order, the
/// deck summary, the training and fusion selections with the client's warnings, and the set-collection paging.
enum CardsMode: String {
    case training, deck, fusion

    /// Modes in the order of the client's mode stripe (training left, deck middle, fusion right).
    static let order: [CardsMode] = [.training, .deck, .fusion]

    var title: String {
        switch self {
        case .deck: return Strings.yourDeck
        case .training: return Strings.cardTraining
        case .fusion: return Strings.fuseCards
        }
    }

    /// `normalizeMode`: 'training' and 'fusion' as given, everything else is the deck mode.
    init(tab: CardsTab) {
        switch tab {
        case .training: self = .training
        case .fusion: self = .fusion
        case .deck: self = .deck
        }
    }

    var feature: Feature? {
        switch self {
        case .training: return .training
        case .fusion: return .fusion
        case .deck: return nil
        }
    }

    var help: String {
        switch self {
        case .training: return "training"
        case .deck: return "cards"
        case .fusion: return "fusion"
        }
    }
}

/// Geometry of the card slider in stage px (client units × 2.25): card i sits at angle p = offset + i × step.
enum SliderGeometry {
    static let step: Double = 20
    static let radius: Double = 640
    static let cardScale: Double = 1.6125
    static let start: Double = 30
    static let hide: Double = 66
    static let unit: Double = 2.25
    /// Stage px per degree when the slider is swiped (one card width per card step).
    static let degPerPx: Double = step / 219

    struct Pose {
        var x: Double
        var y: Double
        var scale: Double
        var z: Int
        var visible: Bool
    }

    /// `sliderPose`: pose of a slider card at angle p (degrees from the front).
    static func pose(_ p: Double) -> Pose {
        let rad = { (deg: Double) -> Double in deg * Double.pi / 180 }
        let s = cos(rad(p * 1.3)) * 0.9
        let visible = abs(p) <= hide && s > 0.05
        let yUnits = (-50 * (1 - 2 * s) - 55) * 1.15 + 9
        return Pose(x: sin(rad(p)) * radius, y: yUnits * unit, scale: max(0, s) * 1.15 * cardScale, z: max(0, Int((s * 100).rounded())), visible: visible)
    }

    /// `sliderLimits`: scroll range of a slider with n cards.
    static func limits(_ n: Int) -> (min: Double, max: Double) {
        let mx = start
        let mn = min(mx, -start - Double(max(0, n - 1)) * step)
        return (mn, mx)
    }

    /// `offsetFor`: offset that brings card `index` to the front.
    static func offset(for index: Int) -> Double {
        -Double(index) * step
    }

    /// `isSwipe`: a move flatter than 1 : 2 scrolls, anything steeper picks the card up.
    static func isSwipe(dx: Double, dy: Double) -> Bool {
        abs(dx) > 2 * abs(dy)
    }
}

/// An entry of the card slider: an owned card or a running card-piece hunt.
enum SliderEntry: Identifiable, Hashable {
    case card(uid: String, face: CardFaceModel)
    case piece(cardId: String, face: CardFaceModel, owned: Int, total: Int)

    var id: String {
        switch self {
        case .card(let uid, _): return "card:" + uid
        case .piece(let cardId, _, _, _): return "piece:" + cardId
        }
    }

    var face: CardFaceModel {
        switch self {
        case .card(_, let f): return f
        case .piece(_, let f, _, _): return f
        }
    }

    var uid: String? {
        if case .card(let uid, _) = self { return uid }
        return nil
    }

    var pieceId: String? {
        if case .piece(let id, _, _, _) = self { return id }
        return nil
    }
}

enum CardsHelpers {
    /// Client race names (German ids) the slider sorts by, descending: Zwerge > Orks > Neutral > Elfen.
    private static func raceKey(_ t: Tribe) -> String {
        switch t {
        case .dwarf: return "Zwerge"
        case .orc: return "Orks"
        case .neutral: return "Neutral"
        case .elf: return "Elfen"
        }
    }

    private struct SortKey {
        var mana: Int
        var tribe: Tribe
        var stage: Int
        var level: Int
        var name: String
    }

    /// `compareSlider`: mana desc, race desc, fusion stage desc, level desc, name asc.
    private static func sliderLess(_ a: SortKey, _ b: SortKey) -> Bool {
        if a.mana != b.mana { return a.mana > b.mana }
        let ra = raceKey(a.tribe), rb = raceKey(b.tribe)
        if ra != rb { return ra > rb }
        if a.stage != b.stage { return a.stage > b.stage }
        if a.level != b.level { return a.level > b.level }
        return a.name.lowercased() < b.name.lowercased()
    }

    /// `fusableUids`: at least two copies of the same card at the same stage below the maximum (deck cards included).
    static func fusableUids(_ state: GameState, deps: Deps) -> [String] {
        var groups: [String: [String]] = [:]
        var order: [String] = []
        for c in state.cards {
            if c.stage >= FusionOps.maxStage || deps.db.get(c.cardId) == nil { continue }
            let key = "\(c.cardId)#\(c.stage)"
            if groups[key] == nil { groups[key] = []; order.append(key) }
            groups[key]?.append(c.uid)
        }
        var out: [String] = []
        for key in order {
            if let g = groups[key], g.count >= 2 { out.append(contentsOf: g) }
        }
        return out
    }

    /// `fuseCount`: number of possible fusions (Σ floor(copies / 2)); drives the "!" badge of the fusion button.
    static func fuseCount(_ state: GameState, deps: Deps) -> Int {
        var groups: [String: Int] = [:]
        for c in state.cards {
            if c.stage >= FusionOps.maxStage || deps.db.get(c.cardId) == nil { continue }
            groups["\(c.cardId)#\(c.stage)", default: 0] += 1
        }
        return groups.values.reduce(0) { $0 + $1 / 2 }
    }

    /// `fusionPartners`: same card and stage as the card(s) in the slots, not in a slot.
    static func fusionPartners(_ state: GameState, slots: [String?]) -> [String] {
        let placed = slots.compactMap { $0 }.compactMap { StateOps.getCard(state, uid: $0) }
        guard let ref = placed.first else { return [] }
        return state.cards.filter { c in
            c.cardId == ref.cardId && c.stage == ref.stage && c.stage < FusionOps.maxStage && !slots.contains(c.uid)
        }.map { $0.uid }
    }

    /// `sliderEntries`: the slider's entries for a mode, sorted like the client.
    static func sliderEntries(_ state: GameState, deps: Deps, mode: CardsMode, trainUid: String?, sacrifices: [String], fuse: [String?]) -> [SliderEntry] {
        var uids: [String]
        switch mode {
        case .training:
            var used = Set(sacrifices)
            if let t = trainUid { used.insert(t) }
            uids = state.cards.filter { !used.contains($0.uid) }.map { $0.uid }
        case .fusion:
            uids = fuse.contains(where: { $0 != nil }) ? fusionPartners(state, slots: fuse) : fusableUids(state, deps: deps)
        case .deck:
            uids = state.cards.filter { !CollectionOps.isInDeck(state, uid: $0.uid) }.map { $0.uid }
        }
        var rows: [(entry: SliderEntry, key: SortKey)] = []
        for uid in uids {
            guard let inst = StateOps.getCard(state, uid: uid), let def = deps.db.get(inst.cardId) else { continue }
            let face = CardFaceModel.fromInstance(inst, def: def, deps: deps)
            rows.append((.card(uid: uid, face: face), SortKey(mana: def.mana, tribe: def.tribe, stage: inst.stage, level: inst.level, name: def.name)))
        }
        if mode != .fusion {
            for hunt in state.pieces {
                guard let def = deps.db.get(hunt.cardId), hunt.owned < hunt.total else { continue }
                let face = CardFaceModel.fromDef(def, stage: 0, level: 1, deps: deps)
                rows.append((.piece(cardId: hunt.cardId, face: face, owned: hunt.owned, total: hunt.total), SortKey(mana: def.mana, tribe: def.tribe, stage: 0, level: 0, name: def.name)))
            }
        }
        return rows.sorted { sliderLess($0.key, $1.key) }.map { $0.entry }
    }

    /// `deckSummary`: slots, deck mana vs max, the player's current mana, the card pool count.
    struct DeckSummary {
        var slots: [CardInstance?]
        var unlocked: [Bool]
        var mana: Int
        var manaMax: Int
        var manaNow: Int
        var manaShort: Bool
        var count: Int
        var poolCount: Int
        var poolLimit: Int
        var poolFull: Bool
    }

    static func deckSummary(_ state: GameState, deps: Deps) -> DeckSummary {
        let slots = StateOps.deckCards(state)
        let mana = slots.reduce(0) { sum, c in sum + (c.flatMap { deps.db.get($0.cardId)?.mana } ?? 0) }
        let manaNow = state.player.mana
        let poolCount = state.cards.count
        return DeckSummary(slots: slots, unlocked: (0..<5).map { StateOps.slotUnlocked(state, slot: $0) }, mana: mana, manaMax: state.player.manaMax,
                           manaNow: manaNow, manaShort: manaNow < mana, count: slots.compactMap { $0 }.count, poolCount: poolCount,
                           poolLimit: Constants.collectionLimit, poolFull: poolCount >= Constants.collectionLimit)
    }

    /// `manaAfterPlace`: deck mana if `uid` were dropped on `slot` (swapping like placeInDeck).
    static func manaAfterPlace(_ state: GameState, deps: Deps, uid: String, slot: Int) -> Int {
        var deck = state.deck
        while deck.count < 5 { deck.append(nil) }
        let prev = deck.firstIndex(of: uid)
        let displaced = deck[slot]
        deck[slot] = uid
        if let p = prev, p != slot {
            deck[p] = (displaced != nil && displaced != uid) ? displaced : nil
        }
        return deck.reduce(0) { sum, u in
            guard let u = u, let c = StateOps.getCard(state, uid: u), let d = deps.db.get(c.cardId) else { return sum }
            return sum + d.mana
        }
    }

    /// `sacrificeEligible`: deck cards may (with the warning at OK), the trained card may not, at most 9 cards.
    static func sacrificeEligible(_ state: GameState, uid: String, trainUid: String?, sacrifices: [String]) -> (ok: Bool, reason: String?) {
        if StateOps.getCard(state, uid: uid) == nil { return (false, "No such card") }
        if uid == trainUid { return (false, "That is the card being trained") }
        if !sacrifices.contains(uid) && sacrifices.count >= TrainingOps.maxSacrifices { return (false, Strings.stackFull) }
        return (true, nil)
    }

    /// `pushSacrifice`: add a uid to the top of the stack.
    static func pushSacrifice(_ sacrifices: [String], uid: String) -> [String] {
        if sacrifices.contains(uid) || sacrifices.count >= TrainingOps.maxSacrifices { return sacrifices }
        return sacrifices + [uid]
    }

    /// `sacrificeWarnings`: "valuable" (Rare and up), "in your deck", "fused".
    static func sacrificeWarnings(_ state: GameState, deps: Deps, uids: [String]) -> [String] {
        var valuable = false, inDeck = false, fused = false
        for uid in uids {
            guard let c = StateOps.getCard(state, uid: uid), let d = deps.db.get(c.cardId) else { continue }
            if (Constants.EnhancePrice.raritySellFactor[d.rarity] ?? 0) >= 4 { valuable = true }
            if CollectionOps.isInDeck(state, uid: uid) { inDeck = true }
            if c.stage >= 1 { fused = true }
        }
        var out: [String] = []
        if valuable { out.append("valuable") }
        if inDeck { out.append("in your deck") }
        if fused { out.append("fused") }
        return out
    }

    /// `sacrificeWarningText`: header line, then "-item" lines.
    static func sacrificeWarningText(_ warnings: [String], count: Int) -> String {
        let head = count > 1 ? "Your sacrifice stack contains cards that are:" : "Your sacrifice stack contains a card that is:"
        return ([head] + warnings.map { "-" + $0 }).joined(separator: "\n")
    }

    /// `trainingMissingText`: message when the training cannot start yet, or nil.
    static func trainingMissingText(trainUid: String?, sacrifices: [String]) -> String? {
        if trainUid == nil && sacrifices.isEmpty { return Strings.trainingMissingBoth }
        if trainUid == nil { return Strings.trainingMissingTrain }
        if sacrifices.isEmpty { return Strings.trainingMissingStack }
        return nil
    }

    struct TrainingSummary {
        var preview: TrainingPreview
        var xp: Int
        var gold: Int
        var canAffordAll: Bool
    }

    /// `trainingSummary`: the preview (deck cards allowed) plus the stack's price even before a trained card sits in the slot.
    static func trainingSummary(_ state: GameState, deps: Deps, trainUid: String?, sacrifices: [String]) -> TrainingSummary {
        let valid = sacrifices.filter { StateOps.getCard(state, uid: $0) != nil }
        let insts = valid.compactMap { StateOps.getCard(state, uid: $0) }
        let perCard = insts.reduce(0) { $0 + TrainingOps.sacrificeValue(deps: deps, inst: $1) }
        let pv = TrainingOps.previewTraining(state, deps: deps, trainUid: trainUid ?? "", sacrificeUids: valid, allowDeck: true)
        let xp = pv.xp > 0 ? pv.xp : perCard
        let gold = pv.gold > 0 ? pv.gold : TrainingOps.trainingCost(deps: deps, insts: insts)
        return TrainingSummary(preview: pv, xp: xp, gold: gold, canAffordAll: state.player.gold >= gold)
    }

    /// `pruneTrainingSelection`: drop uids that no longer exist and keep the stack legal.
    static func pruneTrainingSelection(_ state: GameState, trainUid: String?, sacrifices: [String]) -> (trainUid: String?, sacrifices: [String]) {
        let t: String? = (trainUid != nil && StateOps.getCard(state, uid: trainUid!) != nil) ? trainUid : nil
        var s: [String] = []
        for u in sacrifices where u != t && StateOps.getCard(state, uid: u) != nil && !s.contains(u) && s.count < TrainingOps.maxSacrifices {
            s.append(u)
        }
        return (t, s)
    }

    /// `pruneFusionSlots`: drop slot uids that no longer exist or no longer match the other slot.
    static func pruneFusionSlots(_ state: GameState, slots: [String?]) -> [String?] {
        var out: [String?] = slots.prefix(2).map { u in (u != nil && StateOps.getCard(state, uid: u!) != nil) ? u : nil }
        while out.count < 2 { out.append(nil) }
        if let a = out[0], a == out[1] { out[1] = nil }
        if let a = out[0].flatMap({ StateOps.getCard(state, uid: $0) }), let b = out[1].flatMap({ StateOps.getCard(state, uid: $0) }),
           a.cardId != b.cardId || a.stage != b.stage {
            out[1] = nil
        }
        return out
    }

    /// `fitsFusionSlot`: may a card go into a fusion slot next to what the other slot holds?
    static func fitsFusionSlot(_ state: GameState, uid: String, otherUid: String?) -> Bool {
        guard let c = StateOps.getCard(state, uid: uid), c.stage < FusionOps.maxStage else { return false }
        guard let other = otherUid, other != uid else { return true }
        guard let o = StateOps.getCard(state, uid: other) else { return false }
        return o.cardId == c.cardId && o.stage == c.stage
    }

    struct FusionStatus {
        var ready: Bool
        var ok: Bool
        var reason: String?
        var cost: Int
        var stage: Int
    }

    /// `fusionCheck`: price shown between the slots, OK state.
    static func fusionCheck(_ state: GameState, deps: Deps, slots: [String?]) -> FusionStatus {
        guard slots.count >= 2, let a = slots[0], let b = slots[1] else { return FusionStatus(ready: false, ok: false, reason: Strings.fuseMismatch, cost: 0, stage: 0) }
        let v = FusionOps.canFuse(state, deps: deps, uidA: a, uidB: b, allowDeck: true)
        let ready = v.cost > 0 || v.ok
        return FusionStatus(ready: ready, ok: v.ok, reason: v.ok ? nil : (ready ? v.reason : Strings.fuseMismatch), cost: ready ? v.cost : 0, stage: v.stage)
    }

    /// `collectionPageIndex`: the page of the set collections to show.
    static func collectionPageIndex(count: Int, setId: String?, sets: [SetCollection]) -> Int {
        guard count > 0 else { return 0 }
        guard let id = setId, let i = sets.firstIndex(where: { $0.id == id }) else { return 0 }
        return i
    }

    static func wrapIndex(_ i: Int, count: Int) -> Int {
        guard count > 0 else { return 0 }
        return ((i % count) + count) % count
    }

    /// `bestOwnedInstance`: the owned instance to open from a set tile (highest stage, then level).
    static func bestOwnedInstance(_ state: GameState, cardId: String) -> CardInstance? {
        state.cards.filter { $0.cardId == cardId }.sorted { a, b in
            if a.stage != b.stage { return a.stage > b.stage }
            return a.level > b.level
        }.first
    }

    /// `pieceHuntFor`: the hunt of a catalog card, for the puzzle overlay.
    static func pieceHuntFor(_ state: GameState, cardId: String) -> (owned: Int, total: Int)? {
        guard let hunt = state.pieces.first(where: { $0.cardId == cardId }) else { return nil }
        return (hunt.owned, hunt.total)
    }
}
