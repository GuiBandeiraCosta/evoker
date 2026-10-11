import Foundation

/// The playback contract between EvokerCore (`Playback/Timeline.swift`, `Playback/BoardModel.swift`, pure and
/// tested) and the SpriteKit battle scene (`Evoker/Battle`), a port of `src/ui/battle/timeline.js` and `model.js`.

public enum StepKind: String, Codable, Sendable, Hashable {
    case start, bonus, round, status, buff, attack, damage, heal, death, revive, roundEnd, end, misc
}

/// Base duration (ms at speed 1x) of every step type: the time until the next step starts (timeline.js STEP_MS).
public enum StepTiming {
    public static let stepMs: [StepKind: Int] = [
        .start: 200, .bonus: 1300, .round: 100, .status: 700, .buff: 700, .attack: 1500, .damage: 1200,
        .heal: 1000, .death: 900, .revive: 1000, .roundEnd: 0, .end: 300, .misc: 300,
    ]
    /// Speed-up per round of the original server timelines: round n runs at roundFactor^(n-1) of round 1.
    public static let roundFactor = 0.9
    /// Floor of the per-round factor.
    public static let minRoundFactor = 0.3
    /// The lethal-blow finale: hold, white starburst, banner (ms at 1x). `countMs` is the original's count-down.
    public static let finale = (lead: 250, hold: 450, burst: 200, countMs: 1800)
}

/// The tribe-bonus moment of a fight start: the HP before and after (+20 %) and the tribe that earned it.
public struct TribeBonusMoment: Codable, Hashable, Sendable {
    public var side: Side
    public var from: Int
    public var to: Int
    public var tribe: Tribe
    public init(side: Side, from: Int, to: Int, tribe: Tribe) { self.side = side; self.from = from; self.to = to; self.tribe = tribe }
}

/// The data of one step (timeline.js `fromEvents` step shapes).
public enum StepPayload: Hashable, Sendable {
    case start(attacker: SideSnapshot, defender: SideSnapshot, seed: UInt32, bonus: [TribeBonusMoment])
    case round(Int)
    case status(side: Side, slot: Int, status: CardStatus, on: Bool, source: EventSource?)
    /// A player max-HP step (slot nil) folds the engine's per-round re-application into one net delta.
    case buff(side: Side, slot: Int?, stat: BuffStat, delta: Int, permanent: Bool, source: EventSource?)
    /// `hits` are the damage events folded into the attack (attack + reflect damages).
    case attack(side: Side, slot: Int, attack: Int, targets: [AttackTarget], hits: [BattleEvent])
    /// Consecutive ability damages of the same source.
    case damage(cause: DamageCause, source: EventSource?, hits: [BattleEvent])
    /// Consecutive heals of the same source.
    case heal(source: EventSource?, heals: [BattleEvent])
    /// Consecutive deaths.
    case death(deaths: [BattleEvent])
    case revive(side: Side, slot: Int, hp: Int, attack: Int)
    case roundEnd(round: Int, attackerHp: Int, defenderHp: Int)
    case end(winner: Winner, rounds: Int, attackerHp: Int, defenderHp: Int, endedBy: EndedBy)
    case misc(BattleEvent)
}

/// One timed step of the playback.
public struct PlaybackStep: Hashable, Sendable {
    public var kind: StepKind
    public var payload: StepPayload
    /// Duration at the requested speed (ms), `stepDuration(step, speed)`.
    public var durationMs: Int
    /// Base duration override (ms at 1x) when the step is not the plain STEP_MS of its kind.
    public var baseMs: Int?
    /// Round time factor (nil = 1).
    public var factor: Double?
    /// The raw events the step covers (applied to the board model when the step plays).
    public var events: [BattleEvent]

    public init(kind: StepKind, payload: StepPayload, durationMs: Int, baseMs: Int? = nil, factor: Double? = nil, events: [BattleEvent]) {
        self.kind = kind; self.payload = payload; self.durationMs = durationMs; self.baseMs = baseMs; self.factor = factor; self.events = events
    }
}

/// The board model of the playback (model.js): built from the battleStart snapshot and advanced event by event.
public struct BoardCard: Hashable, Sendable {
    public var cardId: String?
    public var name: String?
    public var tribe: Tribe
    public var hp: Int
    public var maxHp: Int
    public var attack: Int
    public var baseAttack: Int
    public var dead: Bool

    public init(cardId: String?, name: String?, tribe: Tribe, hp: Int, maxHp: Int, attack: Int, baseAttack: Int, dead: Bool = false) {
        self.cardId = cardId; self.name = name; self.tribe = tribe; self.hp = hp; self.maxHp = maxHp; self.attack = attack; self.baseAttack = baseAttack; self.dead = dead
    }
}

public struct BoardPlayer: Hashable, Sendable {
    public var name: String
    public var hp: Int
    public var maxHp: Int
    public init(name: String, hp: Int, maxHp: Int) { self.name = name; self.hp = hp; self.maxHp = maxHp }
}

public struct BoardSide: Hashable, Sendable {
    public var player: BoardPlayer
    public var cards: [BoardCard?]
    public init(player: BoardPlayer, cards: [BoardCard?]) { self.player = player; self.cards = cards }
}

public struct BoardModel: Hashable, Sendable {
    public var round: Int
    public var winner: Winner?
    public var ended: Bool
    public var rounds: Int
    public var attacker: BoardSide
    public var defender: BoardSide
    public var deaths: Deaths

    public init(round: Int = 0, winner: Winner? = nil, ended: Bool = false, rounds: Int = 0, attacker: BoardSide, defender: BoardSide, deaths: Deaths = Deaths()) {
        self.round = round; self.winner = winner; self.ended = ended; self.rounds = rounds; self.attacker = attacker; self.defender = defender; self.deaths = deaths
    }

    public subscript(side: Side) -> BoardSide {
        get { side == .attacker ? attacker : defender }
        set { if side == .attacker { attacker = newValue } else { defender = newValue } }
    }
}
