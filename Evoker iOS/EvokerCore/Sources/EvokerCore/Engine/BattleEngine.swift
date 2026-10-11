import Foundation

/// The battle engine (`src/engine/battle.js`): a literal port of the original client's simulator
/// (exploration/apk/lua/game.fightsimulatorv2.txt, main.#18; spec: original-engine.md). Pure and deterministic for
/// a given seed; never mutates its input.
///
/// Round loop (original-engine.md §5):
///   round = 1
///   while not over() and round <= 20:
///     round 1: race bonus; resetRound(1); resetRound(2)
///     for phase in PHASES: processPhase(1, phase); processPhase(2, phase)       -- round mode
///     while events: for phase in PHASES: processPhase(1/2, phase, events); die(1); die(2)  -- event loop
///     cleanup(1); cleanup(2)
///
/// Slot mapping (Helpers.swift): internal 1-based slots from each player's own left, UI 0-based facing slots:
/// attacker ui = id - 1, defender ui = 5 - id. Processing order "player 1 slots 1..5 then player 2 slots 1..5"
/// is therefore attacker 0..4 then defender 4..0 in UI slots.
public struct BattleEngine: BattleSimulating {
    public static let defaultMaxRounds = 20

    public init() {}

    /// `simulateBattle(cfg)`.
    public func simulateBattle(_ cfg: BattleConfig) -> BattleOutcome {
        Engine.simulate(cfg)
    }

    /// `buildSide(playerLike, cardsBySlot, options)`.
    public func buildSide(_ player: FighterPlayer, _ cards: [SideEntry?], options: SideOptions) -> FighterSide {
        BattleState.buildSide(player, cards, options: options)
    }

    /// `toBattleCard(cardInstance, cardDef, computeStats)`.
    public func toBattleCard(_ ref: CardRef, _ cardDef: CardDef, computeStats: ComputeStats?) -> BattleCard {
        BattleState.toBattleCard(ref, cardDef, computeStats: computeStats)
    }
}

/// The round loop, buff matching and dispatch of battle.js.
enum Engine {
    /// Safety cap on event-loop passes within one round (the original has none; a ping-pong of onDamage buffs would hang it).
    static let eventLoopCap = 1000

    // MARK: State

    /// Internal card from a public BattleCard (original-engine.md §1).
    static func internCard(_ card: BattleCard, playerId: Int, id: Int) -> EngineCard {
        let attack = Swift.max(0, JSMath.round(JSMath.num(card.attack)))
        let maxHp = Swift.max(1, JSMath.round(BattleState.orDefault(card.maxHp ?? card.hp, 1)))
        let hp: Double
        if let h = card.hp, h.isFinite { hp = JSMath.round(h) } else { hp = maxHp }
        let dirs = BattleState.normaliseDirs(card.dirs)
        let odirs = BattleState.toOriginalDirs(dirs)
        let buffs: [EngineBuff]
        if let raw = card.buffs {
            let value = JSMath.num(card.abilityValue)
            buffs = raw.map { EngineBuff(normalised: BattleState.normaliseBuff($0, abilityValue: value, cardDirs: odirs)) }
        } else {
            buffs = BattleState.resolveBuffs(entry: card.ability, stage: card.stage ?? 0, abilityValue: card.abilityValue, cardDirs: dirs)
                .map { EngineBuff(normalised: $0) }
        }
        let race = TribeBonus.raceName(card)
        var pub = card
        pub.buffs = nil
        pub.instanceId = card.instanceId ?? card.cardId
        pub.dirs = dirs
        pub.tribe = Tribe(lenient: race)
        pub.tribeName = Tribe(rawValue: race) == nil ? race : nil
        return EngineCard(id: id, playerId: playerId, cardId: card.cardId, name: card.name ?? card.cardId, race: race, maxHp: maxHp, hp: hp,
                          attack: attack, buffs: buffs, pub: pub)
    }

    /// Internal player + card list from a FighterSide.
    static func internSide(_ side: FighterSide, playerId: Int) -> (player: EnginePlayer, cards: [EngineCard?]) {
        let p = side.player
        let rawMax: Double? = (p.maxHp ?? p.hpMax ?? p.hp).map { Double($0) }
        let maxHp = Swift.max(1, JSMath.round(BattleState.orDefault(rawMax, 1500)))
        let hp: Double = p.hp.map { JSMath.round(Double($0)) } ?? maxHp
        var cards: [EngineCard?] = Array(repeating: nil, count: Slots.count + 1)
        for slot in 0..<Slots.count where slot < side.cards.count {
            if let c = side.cards[slot] {
                let id = Slots.internalSlot(playerId: playerId, slot: slot)
                cards[id] = internCard(c, playerId: playerId, id: id)
            }
        }
        let name = (p.name?.isEmpty == false) ? p.name! : Slots.sideOf(playerId).rawValue
        let player = EnginePlayer(id: playerId, name: name, portrait: p.portrait ?? 0, maxHp: maxHp, hp: hp, tribeBonus: p.tribeBonus, pub: p)
        return (player, cards)
    }

    // MARK: Buff matching

    /// `getBuff(card, type, 'round', round)`: the first buff of the card with the type whose round condition holds.
    static func getRoundBuff(_ card: EngineCard, _ type: BuffType, round: Int) -> EngineBuff? {
        let data = Double(round)
        for b in card.buffs where b.type == type {
            let n = b.eventDataNumber
            let ok: Bool
            switch b.event {
            case .always: ok = true
            case .round_eq: ok = data == n
            case .round_ge: ok = data >= n
            case .round_le: ok = data <= n
            case .round_odd: ok = round % 2 == 1
            case .round_even: ok = round % 2 == 0
            default: ok = false
            }
            if ok { return b }
        }
        return nil
    }

    /// `getBuff(card, type, 'event', event)` (original-engine.md §4): buff.event == event.type and eventData nil
    /// (any card) / "opponent_cards" / "self" / "own_cards"; extensions: `triggerDirection` (the event's `to` card
    /// must be the card in that direction) and `damagedBySelf` (this card must have damaged the event's `to` card).
    static func getEventBuff(_ S: EngineState, _ card: EngineCard, _ type: BuffType, _ ev: EngineEvent) -> EngineBuff? {
        for b in card.buffs where b.type == type {
            guard b.event.rawValue == ev.type.rawValue else { continue }
            var ok = false
            switch b.eventData {
            case nil: ok = true
            case .tag("opponent_cards")?: ok = ev.to.playerId != card.playerId
            case .tag("self")?: ok = ev.to === card
            case .tag("own_cards")?: ok = ev.to.playerId == card.playerId && ev.to !== card
            default: ok = false
            }
            if ok, let dir = b.triggerDirection {
                let t = Slots.target(card.id, dir, S.cards[card.playerId], S.cards[Slots.otherId(card.playerId)])
                if case .card(let c) = t { ok = c === ev.to } else { ok = false }
            }
            if ok, b.damagedBySelf { ok = ev.to.damagedBy.contains(ObjectIdentifier(card)) }
            if ok { return b }
        }
        return nil
    }

    /// Does a card pass a buff `filter` ({tribe, offensive, excludeSelf, hasAbility})?
    static func matchesFilter(_ c: EngineCard, _ selfCard: EngineCard, _ f: BuffFilter?) -> Bool {
        guard let f else { return true }
        if f.excludeSelf == true && c === selfCard { return false }
        if let tribe = f.tribe, c.race != tribe.rawValue { return false }
        if f.offensive == true && !Extensions.isOffensive(c) { return false }
        if f.hasAbility == true && !Extensions.hasAbilityBuffs(c) { return false }
        return true
    }

    /// Deterministic pick of `count` cards from a pool (random via the seeded rng, highest/lowest attack with ties to the first slot).
    static func pickFrom(_ S: EngineState, _ pool: [EngineCard], _ pick: PickRule, _ count: Int) -> [EngineCard] {
        var chosen: [EngineCard] = []
        var rest = pool
        var k = 0
        while k < count && !rest.isEmpty {
            let v: EngineCard
            switch pick {
            case .random: v = S.rng.pick(rest)!
            case .lowest_attack: v = rest.dropFirst().reduce(rest[0]) { a, c in c.attack < a.attack ? c : a }
            case .highest_attack: v = rest.dropFirst().reduce(rest[0]) { a, c in c.attack > a.attack ? c : a }
            }
            chosen.append(v)
            rest = rest.filter { $0 !== v }
            k += 1
        }
        return chosen
    }

    /// Target set of a scope buff (ability-encoding.md §2.7): own_cards | opponent_cards | all_cards | each_side (one
    /// pick per side), narrowed by `filter`, chosen by `pick` + `count`. Picks are memoised per (card, round, scope)
    /// so sibling buffs (Bouncer's no_buff + no_damage) hit the same cards.
    static func scopeTargets(_ S: EngineState, _ card: EngineCard, _ buff: EngineBuff) -> [EngineCard] {
        let own = card.playerId
        let opp = Slots.otherId(own)
        var pools: [[EngineCard]]
        switch buff.scope {
        case .own_cards?: pools = [S.livingCards(own)]
        case .opponent_cards?: pools = [S.livingCards(opp)]
        case .all_cards?: pools = [S.livingCards(1) + S.livingCards(2)]
        case .each_side?: pools = [S.livingCards(own), S.livingCards(opp)]
        case nil: return []
        }
        pools = pools.map { pool in pool.filter { matchesFilter($0, card, buff.filter) } }
        guard let pick = buff.pick else { return pools.flatMap { $0 } }
        let key = "\(card.playerId):\(card.id):\(S.round):\(buff.scope!.rawValue)"
        if let memo = S.picks[key] { return memo }
        let count = Swift.max(1, buff.count ?? 0)
        let chosen = pools.flatMap { pickFrom(S, $0, pick, count) }
        S.picks[key] = chosen
        return chosen
    }

    /// `hasAttack(card, round)`: an `attack` buff that can still fire now or later (original-engine.md §5).
    /// Damaging abilities do not count.
    static func hasAttack(_ card: EngineCard, round: Int) -> Bool {
        for b in card.buffs where b.type == .attack {
            let n = b.eventDataNumber
            switch b.event {
            case .always, .round_ge, .round_odd, .round_even: return true
            case .round_le: if Double(round) <= n { return true }
            case .round_eq: if Double(round) <= n { return true }
            default: break
            }
        }
        return false
    }

    // MARK: Phases

    /// Run one matched buff: resolve its directions (or scope) to targets and call the handler per target
    /// (`none` skipped, an empty slot passed as the direction), or once with target none.
    static func dispatch(_ S: EngineState, _ phase: Phase, _ card: EngineCard, _ buff: EngineBuff, _ ev: EngineEvent?, _ ownPlayer: EnginePlayer,
                         _ ownOpponent: EnginePlayer, _ out: EventList) {
        S.openAttack = nil
        guard Phases.handlerKeys.contains(phase.handler) else { return }
        let dirs = buff.directions
        // event mode + directions: player / opponent come from the event (the attacker's), as in the original
        let useEvent = ev != nil && !dirs.isEmpty
        let player = (useEvent ? ev?.player : nil) ?? ownPlayer
        let opponent = (useEvent ? ev?.opponent : nil) ?? ownOpponent
        S.direction = nil
        if Phases.onceTypes.contains(buff.type) {
            Handlers.run(phase.handler, S, card, .none, player, opponent, buff, out, ev)
            return
        }
        if buff.scope != nil {
            for t in scopeTargets(S, card, buff) { Handlers.run(phase.handler, S, card, .card(t), player, opponent, buff, out, ev) }
            return
        }
        if dirs.isEmpty {
            Handlers.run(phase.handler, S, card, .none, player, opponent, buff, out, ev)
            return
        }
        let own = S.cards[card.playerId]
        let opp = S.cards[Slots.otherId(card.playerId)]
        let trigger = ev != nil && Phases.targetlessTypes.contains(buff.type)
        for d in dirs {
            let target: HandlerTarget
            switch Slots.target(card.id, d, own, opp) {
            case .offBoard: continue
            case .empty: target = .emptySlot(d)
            case .card(let c): target = .card(c)
            }
            if trigger {
                guard case .card(let c) = target, c === ev!.to else { continue }
            }
            if buff.filter != nil, case .card(let c) = target, !matchesFilter(c, card, buff.filter) { continue }
            S.direction = d
            Handlers.run(phase.handler, S, card, target, player, opponent, buff, out, ev)
        }
    }

    /// The buff as the handler should see it for an event: `strengthFromEvent` takes the event's value.
    static func buffForEvent(_ buff: EngineBuff, _ ev: EngineEvent?) -> EngineBuff {
        guard buff.strengthFromEvent, let ev else { return buff }
        return buff.withStrength(ev.value)
    }

    /// `processPhase(playerId, type, eventsIn, eventsOut)`: slots 1..5 of the player; round mode when `eventsIn`
    /// is nil (buffs matched against the round), else event mode (every event against every card). The `die`
    /// phase runs for every card in round mode (implicit die buff).
    static func processPhase(_ S: EngineState, _ playerId: Int, _ phase: Phase, _ eventsIn: [EngineEvent]?, _ out: EventList) {
        let player = S.player(playerId)
        let opponent = S.player(Slots.otherId(playerId))
        guard let eventsIn else {
            if phase.type == .die {
                for i in 1...Slots.count {
                    if let c = S.cards[playerId][i] {
                        Handlers.die(S, c, .card(c), player, opponent, dieBuff, out, nil)
                    }
                }
                return
            }
            // queued next-round effects of this type for this player (extension), before the normal slot pass
            if !S.queueCurrent.isEmpty {
                var mine: [QueuedEffect] = []
                var rest: [QueuedEffect] = []
                for q in S.queueCurrent {
                    if q.playerId == playerId && q.buff.type == phase.type { mine.append(q) } else { rest.append(q) }
                }
                if !mine.isEmpty {
                    S.queueCurrent = rest
                    for q in mine {
                        guard S.cards[playerId][q.card.id] === q.card else { continue }
                        dispatch(S, phase, q.card, q.buff, q.ev, player, opponent, out)
                    }
                }
            }
            for i in 1...Slots.count {
                guard let c = S.cards[playerId][i] else { continue }
                guard let buff = getRoundBuff(c, phase.type, round: S.round) else { continue }
                dispatch(S, phase, c, buff, nil, player, opponent, out)
            }
            return
        }
        for i in 1...Slots.count {
            guard let c = S.cards[playerId][i] else { continue }
            for ev in eventsIn {
                guard let matched = getEventBuff(S, c, phase.type, ev) else { continue }
                let buff = buffForEvent(matched, ev)
                if buff.nextRound {
                    S.queueNext.append(QueuedEffect(playerId: playerId, card: c, buff: buff, ev: ev))
                    continue
                }
                dispatch(S, phase, c, buff, ev, player, opponent, out)
            }
        }
    }

    /// The implicit `{ type: 'die', directions: ['self'] }` buff of the die phase.
    static let dieBuff = EngineBuff(normalised: Buff(type: .die, directions: [.selfSlot], event: .always))

    /// Round reset (original `resetRound`): hp = origHp (players and cards), attack = origAttack, flags off.
    static func resetRound(_ S: EngineState, _ playerId: Int) {
        let p = S.player(playerId)
        p.hp = p.origHp
        p.healBoost = 0
        for i in 1...Slots.count {
            guard let c = S.cards[playerId][i] else { continue }
            c.noBuffsAllowed = false
            c.suppressedBy = nil
            c.attack = c.origAttack
            c.hp = c.origHp
            c.invulnerable = false
            c.damagedBy = []
        }
    }

    /// Original `cleanup`: remove died cards from their slots, clamp negative takenDamage to 0.
    static func cleanup(_ S: EngineState, _ playerId: Int) {
        for i in 1...Slots.count {
            guard let c = S.cards[playerId][i] else { continue }
            if c.died { S.cards[playerId][i] = nil }
            if c.takenDamage < 0 { c.takenDamage = 0 }
        }
    }

    /// Original `over()`: a player at <= 0, or nobody able to attack any more.
    static func over(_ S: EngineState) -> Bool {
        if S.player(1).currentHp <= 0 || S.player(2).currentHp <= 0 { return true }
        for pid in [1, 2] {
            for i in 1...Slots.count {
                if let c = S.cards[pid][i], hasAttack(c, round: S.round) { return false }
            }
        }
        return true
    }

    /// Does the engine apply the race bonus itself for this side? buildSide() already applied it (and set a boolean
    /// `tribeBonus`) for the sides the game builds; raw sides (tests) get the original rule here. `options.raceBonus`
    /// forces it on/off.
    static func engineRaceBonus(_ S: EngineState, _ playerId: Int) -> Bool {
        let opt = S.options.raceBonus
        if opt == false { return false }
        if opt != true && S.player(playerId).tribeBonus != nil { return false }
        return TribeBonus.hasTribeBonus(names: S.cards[playerId].map { $0?.race })
    }

    /// Round-1 race bonus (original-engine.md §6): hp = round(hp * 1.2), origHp = hp.
    static func raceBonus(_ S: EngineState, _ playerId: Int) {
        guard engineRaceBonus(S, playerId) else { return }
        let p = S.player(playerId)
        p.hp = JSMath.round(p.hp * TribeBonus.multiplier)
        p.origHp = p.hp
        p.tribeBonus = true
        S.syncPlayerMaxHp(p, from: nil, effect: "race_bonus")
    }

    /// After the raise_hp / raise_player_hp phases: tell the UI about max hp that silently went back to normal.
    static func syncMaxHps(_ S: EngineState, _ phaseType: BuffType) {
        if phaseType == .raise_hp {
            for pid in [1, 2] {
                for i in 1...Slots.count {
                    if let c = S.cards[pid][i] { S.syncCardMaxHp(c, from: nil, effect: phaseType.rawValue) }
                }
            }
        } else if phaseType == .raise_player_hp {
            for pid in [1, 2] { S.syncPlayerMaxHp(S.player(pid), from: nil, effect: phaseType.rawValue) }
        }
    }

    /// One full round (original `main.#18.#14` loop body).
    static func playRound(_ S: EngineState) {
        S.emit(.roundStart(round: S.round, attackerHp: Slots.toInt(S.player(1).currentHp), defenderHp: Slots.toInt(S.player(2).currentHp)))
        if S.round == 1 {
            raceBonus(S, 1)
            raceBonus(S, 2)
        }
        resetRound(S, 1)
        resetRound(S, 2)
        S.queueCurrent = S.queueNext
        S.queueNext = []
        var events = EventList()
        for phase in Phases.list {
            processPhase(S, 1, phase, nil, events)
            processPhase(S, 2, phase, nil, events)
            syncMaxHps(S, phase.type)
        }
        var passes = 0
        while !events.isEmpty && passes < eventLoopCap {
            passes += 1
            let next = EventList()
            for phase in Phases.list {
                processPhase(S, 1, phase, events.items, next)
                processPhase(S, 2, phase, events.items, next)
            }
            processPhase(S, 1, Phases.diePhase, nil, next)
            processPhase(S, 2, Phases.diePhase, nil, next)
            events = next
        }
        S.queueCurrent = []
        cleanup(S, 1)
        cleanup(S, 2)
        S.emit(.roundEnd(round: S.round, attackerHp: Slots.toInt(S.player(1).currentHp), defenderHp: Slots.toInt(S.player(2).currentHp),
                         cards: RoundHpSnapshot(attacker: S.hpSnapshot(1), defender: S.hpSnapshot(2))))
    }

    // MARK: Public

    /// Simulate a whole battle (`simulateBattle`).
    static func simulate(_ cfg: BattleConfig) -> BattleOutcome {
        let options = cfg.options
        let maxRounds = Swift.max(0, options.maxRounds ?? BattleEngine.defaultMaxRounds)
        let seed = cfg.seed
        let s1 = internSide(cfg.attacker, playerId: 1)
        let s2 = internSide(cfg.defender, playerId: 2)
        let S = EngineState(maxRounds: maxRounds, options: options, rng: Mulberry32(seed), players: [s1.player, s2.player],
                            cards: [[], s1.cards, s2.cards])
        S.emit(.battleStart(seed: seed, attacker: S.sideSnapshot(1), defender: S.sideSnapshot(2)))

        while !over(S) && S.round <= maxRounds {
            playRound(S)
            S.round += 1
        }
        let rounds = S.round - 1
        let h1 = S.player(1).currentHp
        let h2 = S.player(2).currentHp
        let winner: Winner = h1 < h2 ? .defender : (h2 < h1 ? .attacker : .draw)
        let endedBy: EndedBy
        if h1 <= 0 || h2 <= 0 {
            endedBy = .playerHp
        } else if rounds >= maxRounds && !over(S) {
            endedBy = .maxRounds
        } else {
            endedBy = .noAttack
        }
        let result = BattleResult(winner: winner, rounds: rounds, attackerHp: Slots.toInt(h1), defenderHp: Slots.toInt(h2), deaths: S.deaths, endedBy: endedBy)
        S.emit(.battleEnd(winner: winner, rounds: rounds, attackerHp: Slots.toInt(h1), defenderHp: Slots.toInt(h2), endedBy: endedBy))
        return BattleOutcome(events: S.events, result: result)
    }
}
