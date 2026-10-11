import Foundation

/// Engine-internal state and helpers: the data model of `src/engine/battle.js` (internal cards, players, buffs,
/// events) and `src/engine/effects/helpers.js` (slot geometry of the original simulator, UI-log emitters, per-card
/// view helpers). Everything mutable is a `final class` so that identity comparisons (`===`, `damagedBy`, the open
/// attack-event group) behave exactly like the JS objects. Numbers are `Double` like in JS; the log gets `Int`s.

/// Internal buff shape (battle-state.js `normaliseBuff` output): every strength a plain number, directions in
/// original names, the event defaulting to `always`. A class so `getBuff` returns the object identity the JS
/// handlers compare.
final class EngineBuff {
    let type: BuffType
    let strength: Double?
    let strengthPercent: Double?
    let cap: Double?
    let directions: [OriginalDirection]
    let scope: BuffScope?
    let filter: BuffFilter?
    let pick: PickRule?
    let count: Int?
    let event: BuffEvent
    let eventData: EventData?
    let nextRound: Bool
    let emptyReduction: Double?
    let baseAttack: Bool
    let unreflectable: Bool
    let triggerDirection: OriginalDirection?
    let damagedBySelf: Bool
    let strengthFromEvent: Bool

    init(normalised b: Buff) {
        type = b.type
        strength = EngineBuff.number(b.strength)
        strengthPercent = EngineBuff.number(b.strengthPercent)
        cap = EngineBuff.number(b.cap)
        directions = b.directions
        scope = b.scope
        filter = b.filter
        pick = b.pick
        count = b.count
        event = b.event
        eventData = b.eventData
        nextRound = b.nextRound == true
        emptyReduction = b.emptyReduction.map { Double($0) }
        baseAttack = b.baseAttack == true
        unreflectable = b.unreflectable == true
        triggerDirection = b.triggerDirection
        damagedBySelf = b.damagedBySelf == true
        strengthFromEvent = b.strengthFromEvent == true
    }

    private init(copying o: EngineBuff, strength: Double?) {
        type = o.type
        self.strength = strength
        strengthPercent = o.strengthPercent
        cap = o.cap
        directions = o.directions
        scope = o.scope
        filter = o.filter
        pick = o.pick
        count = o.count
        event = o.event
        eventData = o.eventData
        nextRound = o.nextRound
        emptyReduction = o.emptyReduction
        baseAttack = o.baseAttack
        unreflectable = o.unreflectable
        triggerDirection = o.triggerDirection
        damagedBySelf = o.damagedBySelf
        strengthFromEvent = o.strengthFromEvent
    }

    /// `{ ...buff, strength }` (battle.js `buffForEvent`).
    func withStrength(_ value: Double) -> EngineBuff {
        EngineBuff(copying: self, strength: value)
    }

    private static func number(_ v: ValueRef?) -> Double? {
        guard let v else { return nil }
        if case .number(let d) = v { return d.isFinite ? d : 0 }
        return 0
    }

    /// `Number(buff.eventData)`: null → 0, a round number → itself, a string tag → NaN.
    var eventDataNumber: Double {
        switch eventData {
        case nil: return 0
        case .round(let n)?: return Double(n)
        case .tag?: return .nan
        }
    }
}

/// Internal card (original-engine.md §1 + the port's additions: `suppressedBy`, `damagedBy`, `uiMaxHp`, `pub`).
final class EngineCard {
    /// Internal 1-based slot from the player's own left.
    let id: Int
    let playerId: Int
    let cardId: String?
    let name: String?
    /// Lower-cased race name (`card.tribe || card.race || 'neutral'`).
    let race: String
    var origHp: Double
    var hp: Double
    var origAttack: Double
    var attack: Double
    var takenDamage: Double
    let buffs: [EngineBuff]
    var died = false
    var resurrected = false
    var invulnerable = false
    var noBuffsAllowed = false
    weak var suppressedBy: EngineCard?
    var resurrectAlliesUsed = false
    /// Cards that damaged this card this round (extension field `damagedBySelf`).
    var damagedBy = Set<ObjectIdentifier>()
    /// The max hp the UI was last told about (maxHp buff events carry the differences).
    var uiMaxHp: Double
    /// The public fields of the card (snapshots copy them).
    let pub: BattleCard

    init(id: Int, playerId: Int, cardId: String?, name: String?, race: String, maxHp: Double, hp: Double, attack: Double, buffs: [EngineBuff], pub: BattleCard) {
        self.id = id
        self.playerId = playerId
        self.cardId = cardId
        self.name = name
        self.race = race
        self.origHp = maxHp
        self.hp = maxHp
        self.origAttack = attack
        self.attack = attack
        self.takenDamage = Swift.max(0, maxHp - hp)
        self.buffs = buffs
        self.uiMaxHp = maxHp
        self.pub = pub
    }

    var side: Side { playerId == 1 ? .attacker : .defender }
    /// UI (0-based, facing) slot: attacker `id - 1`, defender `5 - id`.
    var uiSlot: Int { playerId == 1 ? id - 1 : Slots.count - id }
    var ref: EventRef { EventRef(side: side, slot: uiSlot) }
    /// Health shown to the UI: current health capped at the max.
    var shownHp: Double { Swift.min(hp, hp - takenDamage) }

    func source(_ effect: String) -> EventSource {
        EventSource(side: side, slot: uiSlot, effect: effect)
    }

    /// Public snapshot (battleStart / death events): the public fields with the current numbers.
    var snapshot: CardSnapshot {
        CardSnapshot(instanceId: pub.instanceId, cardId: pub.cardId, name: pub.name, tribe: pub.tribe ?? .neutral, rarity: pub.rarity,
                     mana: pub.mana, stage: pub.stage, level: pub.level, attack: Slots.toInt(attack), hp: Slots.toInt(shownHp),
                     maxHp: Slots.toInt(hp), abilityValue: pub.abilityValue, dirs: pub.dirs ?? [], ability: pub.ability, tribeName: pub.tribeName)
    }
}

/// Internal player (original-engine.md §1 + `healBoost`, `uiMaxHp`, `pub`).
final class EnginePlayer {
    let id: Int
    let key: Side
    let name: String
    let portrait: Int
    var origHp: Double
    var hp: Double
    var takenDamage: Double
    /// nil = undefined (a raw side): the engine applies the race bonus itself.
    var tribeBonus: Bool?
    var healBoost: Double = 0
    var uiMaxHp: Double
    let pub: FighterPlayer

    init(id: Int, name: String, portrait: Int, maxHp: Double, hp: Double, tribeBonus: Bool?, pub: FighterPlayer) {
        self.id = id
        self.key = id == 1 ? .attacker : .defender
        self.name = name
        self.portrait = portrait
        self.origHp = maxHp
        self.hp = maxHp
        self.takenDamage = Swift.max(0, maxHp - hp)
        self.tribeBonus = tribeBonus
        self.uiMaxHp = maxHp
        self.pub = pub
    }

    var side: Side { key }
    var ref: EventRef { EventRef(side: key, slot: nil) }
    /// `hp - takenDamage` (may be negative).
    var currentHp: Double { hp - takenDamage }
}

/// An engine event pushed between handlers (`{ type, from, to, player?, opponent?, value? }`).
final class EngineEvent {
    let type: EngineEventType
    let from: EngineCard
    let to: EngineCard
    let player: EnginePlayer?
    let opponent: EnginePlayer?
    /// `Number(ev.value) || 0`.
    let value: Double

    init(_ type: EngineEventType, from: EngineCard, to: EngineCard, player: EnginePlayer? = nil, opponent: EnginePlayer? = nil, value: Double = 0) {
        self.type = type
        self.from = from
        self.to = to
        self.player = player
        self.opponent = opponent
        self.value = value
    }
}

/// The engine events produced during one phase pass (`out` of the handlers), shared by reference like the JS array.
final class EventList {
    var items: [EngineEvent] = []
    func push(_ ev: EngineEvent) { items.append(ev) }
    var isEmpty: Bool { items.isEmpty }
}

/// What a handler receives as `target`: a card, an empty slot (passed as its direction), or nothing (JS null).
enum HandlerTarget {
    case card(EngineCard)
    case emptySlot(OriginalDirection)
    case none

    var card: EngineCard? {
        if case .card(let c) = self { return c }
        return nil
    }
}

/// Result of the original `target(slot, direction, own, opp)`: a card, an empty slot, or off the board (`none`).
enum SlotTarget {
    case card(EngineCard)
    case empty
    case offBoard
}

/// `{ side, slot }` of a card (slot 0-based) or a player (slot nil) in the event log.
struct EventRef {
    let side: Side
    let slot: Int?
}

/// A `nextRound` effect waiting for the next round's phase of its type (battle.js `S.queue`).
struct QueuedEffect {
    let playerId: Int
    let card: EngineCard
    let buff: EngineBuff
    let ev: EngineEvent
}

/// The lazy attack-event group of `logHit`: one attack event per (card, buff, triggering event), opened on the
/// first hit with damage > 0; later hits append to its targets.
final class AttackGroup {
    let card: EngineCard
    let buff: EngineBuff
    let ev: EngineEvent?
    var eventIndex: Int?
    var attack: Double = 0
    var bonus = false
    var targets: [AttackTarget] = []

    init(card: EngineCard, buff: EngineBuff, ev: EngineEvent?) {
        self.card = card
        self.buff = buff
        self.ev = ev
    }
}

/// Slot geometry of the original simulator (helpers.js): each player's cards are indexed 1..5 from the player's
/// own left; `front` of slot i is the opponent's slot 6 - i. The public log keeps the UI convention (0-based
/// facing slots: attacker `id - 1`, defender `5 - id`).
enum Slots {
    static let count = 5

    static func otherId(_ playerId: Int) -> Int { playerId == 1 ? 2 : 1 }

    static func sideOf(_ playerId: Int) -> Side { playerId == 1 ? .attacker : .defender }

    /// Internal 1-based slot id of a UI slot for a player.
    static func internalSlot(playerId: Int, slot: Int) -> Int { playerId == 1 ? slot + 1 : count - slot }

    /// `target(slot i, direction, own, opp)` of the original simulator (original-engine.md §2).
    static func target(_ i: Int, _ direction: OriginalDirection, _ own: [EngineCard?], _ opp: [EngineCard?]) -> SlotTarget {
        func wrap(_ c: EngineCard?) -> SlotTarget { c.map { SlotTarget.card($0) } ?? .empty }
        switch direction {
        case .left: return i - 1 < 1 ? .offBoard : wrap(own[i - 1])
        case .right: return i + 1 > count ? .offBoard : wrap(own[i + 1])
        case .front: return wrap(opp[count + 1 - i])
        case .frontLeft: return i - 1 < 1 ? .offBoard : wrap(opp[count + 1 - (i - 1)])
        case .frontRight: return i + 1 > count ? .offBoard : wrap(opp[count + 1 - (i + 1)])
        case .selfSlot: return wrap(own[i])
        }
    }

    /// Log value of an engine number: integral in practice (the engine rounds every amount), truncated otherwise.
    static func toInt(_ x: Double) -> Int {
        if let i = Int(exactly: x) { return i }
        if !x.isFinite { return 0 }
        return Int(x.rounded(.towardZero))
    }
}

/// The engine state `S` of battle.js: rng, UI log, players (1 and 2), cards (`cards[playerId][1...5]`), the
/// next-round queue, the pick / gamble memos, the open attack group and the direction being dispatched.
final class EngineState {
    var round = 1
    let maxRounds: Int
    let options: BattleOptions
    let rng: RandomSource
    var events: [BattleEvent] = []
    /// Players 1 and 2 (index `id - 1`).
    let players: [EnginePlayer]
    /// `cards[playerId][id]`, index 0 of both dimensions unused.
    var cards: [[EngineCard?]]
    var queueCurrent: [QueuedEffect] = []
    var queueNext: [QueuedEffect] = []
    var picks: [String: [EngineCard]] = [:]
    var memo: [String: Bool] = [:]
    var openAttack: AttackGroup?
    var direction: OriginalDirection?
    var deaths = Deaths()

    init(maxRounds: Int, options: BattleOptions, rng: RandomSource, players: [EnginePlayer], cards: [[EngineCard?]]) {
        self.maxRounds = maxRounds
        self.options = options
        self.rng = rng
        self.players = players
        self.cards = cards
    }

    func player(_ id: Int) -> EnginePlayer { players[id - 1] }

    // MARK: Emitters (helpers.js)

    func emit(_ ev: BattleEvent) { events.append(ev) }

    func emitStatus(_ target: EngineCard, _ status: CardStatus, from: EngineCard, effect: BuffType) {
        emit(.status(side: target.side, slot: target.uiSlot, status: status, on: true, source: from.source(effect.rawValue)))
    }

    func emitCardDamage(_ card: EngineCard, _ amount: Double, _ cause: DamageCause, from: EngineCard?, effect: BuffType, blocked: Bool = false) {
        emit(.damage(side: card.side, slot: card.uiSlot, amount: Slots.toInt(amount), hp: Slots.toInt(card.shownHp), cause: cause, blocked: blocked,
                     source: from?.source(effect.rawValue)))
    }

    func emitPlayerDamage(_ player: EnginePlayer, _ amount: Double, _ cause: DamageCause, from: EngineCard?, effect: BuffType) {
        emit(.damage(side: player.side, slot: nil, amount: Slots.toInt(amount), hp: Slots.toInt(player.currentHp), cause: cause, blocked: false,
                     source: from?.source(effect.rawValue)))
    }

    func emitHeal(_ ref: EventRef, amount: Double, hp: Double, from: EngineCard?, effect: BuffType) {
        emit(.heal(side: ref.side, slot: ref.slot, amount: Slots.toInt(amount), hp: Slots.toInt(hp), source: from?.source(effect.rawValue)))
    }

    func emitBuff(_ ref: EventRef, _ stat: BuffStat, delta: Double, permanent: Bool, from: EngineCard?, effect: String) {
        emit(.buff(side: ref.side, slot: ref.slot, stat: stat, delta: Slots.toInt(delta), permanent: permanent, source: from?.source(effect)))
    }

    /// Bring the UI's idea of a card's max hp in line with the engine (a maxHp buff for the difference).
    func syncCardMaxHp(_ card: EngineCard, from: EngineCard?, effect: String) {
        let delta = card.hp - card.uiMaxHp
        if delta == 0 { return }
        card.uiMaxHp = card.hp
        emitBuff(card.ref, .maxHp, delta: delta, permanent: false, from: from, effect: effect)
    }

    /// Same for a player's max hp.
    func syncPlayerMaxHp(_ player: EnginePlayer, from: EngineCard?, effect: String) {
        let delta = player.hp - player.uiMaxHp
        if delta == 0 { return }
        player.uiMaxHp = player.hp
        emitBuff(player.ref, .maxHp, delta: delta, permanent: false, from: from, effect: effect)
    }

    /// Mark a card dead (die phase / kill): `died`, the `onDeath` event, the death count and the log entry.
    func markDead(_ card: EngineCard, _ out: EventList) {
        card.died = true
        out.push(EngineEvent(.onDeath, from: card, to: card))
        deaths[card.side] += 1
        emit(.death(side: card.side, slot: card.uiSlot, card: card.snapshot))
    }

    /// Living cards (not died) of a player in slot order.
    func livingCards(_ playerId: Int) -> [EngineCard] {
        var out: [EngineCard] = []
        for i in 1...Slots.count {
            if let c = cards[playerId][i], !c.died { out.append(c) }
        }
        return out
    }

    // MARK: Snapshots (battle.js)

    /// The slots of a side in UI order (nil for an empty slot).
    func uiCards(_ playerId: Int) -> [EngineCard?] {
        (0..<Slots.count).map { cards[playerId][Slots.internalSlot(playerId: playerId, slot: $0)] }
    }

    /// Public snapshot of a side (battleStart event), in UI slot order.
    func sideSnapshot(_ playerId: Int) -> SideSnapshot {
        let p = player(playerId)
        let ps = PlayerSnapshot(name: p.name, portrait: p.portrait, hp: Slots.toInt(p.currentHp), maxHp: Slots.toInt(p.hp),
                                baseMaxHp: p.pub.baseMaxHp, tribeBonus: p.tribeBonus == true, level: p.pub.level)
        return SideSnapshot(player: ps, cards: uiCards(playerId).map { $0?.snapshot })
    }

    /// Per-slot current health (0 for empty / dead) of a side, UI order: the original per-round snapshot.
    func hpSnapshot(_ playerId: Int) -> [Int] {
        uiCards(playerId).map { c in c.map { Slots.toInt($0.hp - $0.takenDamage) } ?? 0 }
    }
}

/// Remember that `by` damaged `card` this round (extension field `damagedBySelf`).
func noteDamage(_ card: EngineCard, by: EngineCard) {
    card.damagedBy.insert(ObjectIdentifier(by))
}
