import Foundation

/// Extension buff types (`src/engine/effects/extensions.js`; original-engine.md §8, ability-encoding.md §3) for
/// cards added after the 2016 client and for the help-text caps. They share the handler signature of
/// Handlers.swift and sit in the phase list where their semantics need them. Set-targeting buffs (`scope` +
/// `filter` + `pick`) are resolved by the dispatcher, which calls the handler once per chosen card; the ONCE types
/// are called a single time with target none. Randomness only through `S.rng`.
enum Extensions {
    /// Does a card have an ability besides its normal attack (and the implicit die)?
    static func hasAbilityBuffs(_ card: EngineCard) -> Bool {
        card.buffs.contains { $0.type != .attack && $0.type != .die }
    }

    /// Is the card "offensive" (has a normal attack with at least one direction)?
    static func isOffensive(_ card: EngineCard) -> Bool {
        card.buffs.contains { $0.type == .attack && BattleState.roundEvents.contains($0.event) && !$0.directions.isEmpty }
    }

    /// Percent of a buff (strengthPercent, else strength).
    static func pctOf(_ buff: EngineBuff) -> Double {
        buff.strengthPercent ?? (buff.strength ?? 0)
    }

    /// `bonus_attack`: an extra attack with strengthPercent of the card's attack (origAttack with baseAttack) in
    /// the buff's directions (Schemer, Warg Rider, Flameling, Goblin Patriarch: `onDeath` / `self`).
    static func bonusAttack(_ S: EngineState, _ card: EngineCard, _ target: HandlerTarget, _ player: EnginePlayer, _ opponent: EnginePlayer,
                            _ buff: EngineBuff, _ out: EventList, _ ev: EngineEvent?) {
        guard !card.noBuffsAllowed else { return }
        Handlers.attack(S, card, target, player, opponent, buff, out, ev)
    }

    /// `kill` (round mode, `round_eq N`, scope + pick + count resolved by the dispatcher): the chosen card is marked
    /// dead (ignores invulnerable) and `onDeath` is pushed.
    static func kill(_ S: EngineState, _ card: EngineCard, _ target: HandlerTarget, _ player: EnginePlayer, _ opponent: EnginePlayer,
                     _ buff: EngineBuff, _ out: EventList, _ ev: EngineEvent?) {
        guard !card.noBuffsAllowed, case .card(let t) = target, !t.died else { return }
        let remaining = Swift.max(0, t.hp - t.takenDamage)
        t.takenDamage = Swift.max(t.takenDamage, t.hp)
        S.emitCardDamage(t, remaining, .kill, from: card, effect: buff.type)
        S.markDead(t, out)
    }

    /// `resurrect_allies` (Moon Dragon, `onDeath` / `self`, ONCE): every own card that died this round, itself
    /// included, returns to full health; a card is never revived twice (`resurrected` flag).
    static func resurrectAllies(_ S: EngineState, _ card: EngineCard, _ target: HandlerTarget, _ player: EnginePlayer, _ opponent: EnginePlayer,
                                _ buff: EngineBuff, _ out: EventList, _ ev: EngineEvent?) {
        guard !card.noBuffsAllowed, !card.resurrectAlliesUsed else { return }
        card.resurrectAlliesUsed = true
        for i in 1...Slots.count {
            guard let c = S.cards[card.playerId][i], c.died, !c.resurrected else { continue }
            c.takenDamage = 0
            c.died = false
            c.resurrected = true
            S.emit(.revive(side: c.side, slot: c.uiSlot, hp: Slots.toInt(c.shownHp), attack: Slots.toInt(c.attack), source: card.source(buff.type.rawValue)))
        }
    }

    /// `swap_stats_random` (Goblin Thieves, round 1): the chosen card swaps its attack and hp (orig values too).
    static func swapStatsRandom(_ S: EngineState, _ card: EngineCard, _ target: HandlerTarget, _ player: EnginePlayer, _ opponent: EnginePlayer,
                                _ buff: EngineBuff, _ out: EventList, _ ev: EngineEvent?) {
        guard !card.noBuffsAllowed, case .card(let v) = target else { return }
        let a = v.origAttack
        v.origAttack = v.origHp
        v.origHp = a
        v.attack = v.origAttack
        v.hp = v.origHp
        v.uiMaxHp = v.hp
        S.emit(.swap(side: v.side, slot: v.uiSlot, attack: Slots.toInt(v.attack), hp: Slots.toInt(v.shownHp), maxHp: Slots.toInt(v.hp),
                     source: card.source(buff.type.rawValue)))
    }

    /// `wheel` (Wheel of Fortune, per card of the scope): healed by strength (50 %) or damaged by strength (50 %;
    /// invulnerable blocks, pushes onDamage). One roll per card.
    static func wheel(_ S: EngineState, _ card: EngineCard, _ target: HandlerTarget, _ player: EnginePlayer, _ opponent: EnginePlayer,
                      _ buff: EngineBuff, _ out: EventList, _ ev: EngineEvent?) {
        guard !card.noBuffsAllowed, case .card(let c) = target else { return }
        let s = buff.strength ?? 0
        if S.rng.chance(0.5) {
            c.takenDamage -= s
            if s != 0 { S.emitHeal(c.ref, amount: s, hp: c.shownHp, from: card, effect: buff.type) }
            if s > 0 { out.push(EngineEvent(.onHeal, from: card, to: c, value: s)) }
        } else if c.invulnerable {
            if s > 0 { S.emitCardDamage(c, 0, .ability, from: card, effect: buff.type, blocked: true) }
        } else {
            c.takenDamage += s
            if s > 0 { noteDamage(c, by: card) }
            out.push(EngineEvent(.onDamage, from: card, to: c, player: player, opponent: opponent, value: s))
            if s != 0 { S.emitCardDamage(c, s, .ability, from: card, effect: buff.type) }
        }
    }

    /// `gamble` (Wizard Apprentice, per card of the scope): one roll per (card, round): with probability
    /// strengthPercent % the spell fails and the targets lose 25 % attack this round, otherwise they gain 25 %.
    static func gamble(_ S: EngineState, _ card: EngineCard, _ target: HandlerTarget, _ player: EnginePlayer, _ opponent: EnginePlayer,
                       _ buff: EngineBuff, _ out: EventList, _ ev: EngineEvent?) {
        guard !card.noBuffsAllowed, case .card(let t) = target else { return }
        let key = "gamble:\(card.playerId):\(card.id):\(S.round)"
        let failed: Bool
        if let memo = S.memo[key] {
            failed = memo
        } else {
            failed = S.rng.chance(pctOf(buff) / 100)
            S.memo[key] = failed
            S.emit(.gamble(side: card.side, slot: card.uiSlot, failed: failed, source: card.source(buff.type.rawValue)))
        }
        let delta = JSMath.round(t.attack * 0.25) * (failed ? -1 : 1)
        if delta == 0 { return }
        t.attack = Swift.max(0, t.attack + delta)
        S.emitBuff(t.ref, .attack, delta: delta, permanent: false, from: card, effect: buff.type.rawValue)
    }

    /// `heal_boost_percent` (Djinn, ONCE): the side's card heals this round are multiplied by (1 + pct / 100); several Djinns add.
    static func healBoostPercent(_ S: EngineState, _ card: EngineCard, _ target: HandlerTarget, _ player: EnginePlayer, _ opponent: EnginePlayer,
                                 _ buff: EngineBuff, _ out: EventList, _ ev: EngineEvent?) {
        guard !card.noBuffsAllowed else { return }
        let p = S.player(card.playerId)
        p.healBoost = p.healBoost + pctOf(buff)
    }

    /// `reduce_ability_attack_percent` (Medusa / Dark Mage, per card of the scope): the target loses pct % of its attack this round.
    static func reduceAbilityAttackPercent(_ S: EngineState, _ card: EngineCard, _ target: HandlerTarget, _ player: EnginePlayer, _ opponent: EnginePlayer,
                                           _ buff: EngineBuff, _ out: EventList, _ ev: EngineEvent?) {
        guard !card.noBuffsAllowed, case .card(let t) = target else { return }
        let delta = -JSMath.round(t.attack * pctOf(buff) / 100)
        if delta == 0 { return }
        t.attack = Swift.max(0, t.attack + delta)
        S.emitBuff(t.ref, .attack, delta: delta, permanent: false, from: card, effect: buff.type.rawValue)
    }

    /// Targets of the Thief of Time pattern: odd rounds front + own neighbours, even rounds the enemy diagonals.
    static func stunTargets(_ S: EngineState, _ card: EngineCard) -> [EngineCard] {
        let dirs: [OriginalDirection] = S.round % 2 == 1 ? [.front, .left, .right] : [.frontLeft, .frontRight]
        let own = S.cards[card.playerId]
        let opp = S.cards[Slots.otherId(card.playerId)]
        return dirs.compactMap { d in
            if case .card(let c) = Slots.target(card.id, d, own, opp) { return c }
            return nil
        }
    }

    /// `stun_pattern`, suppress part (ONCE, right after `no_buff`): `no_buff` on every pattern target (so, like it,
    /// NOT blocked by the source's noBuffsAllowed).
    static func stunPatternSuppress(_ S: EngineState, _ card: EngineCard, _ target: HandlerTarget, _ player: EnginePlayer, _ opponent: EnginePlayer,
                                    _ buff: EngineBuff, _ out: EventList, _ ev: EngineEvent?) {
        for t in stunTargets(S, card) { Handlers.noBuff(S, card, .card(t), player, opponent, buff, out, ev) }
    }

    /// `stun_pattern`, daze part (ONCE, right after `no_damage`): `no_damage` on every pattern target.
    static func stunPatternDaze(_ S: EngineState, _ card: EngineCard, _ target: HandlerTarget, _ player: EnginePlayer, _ opponent: EnginePlayer,
                                _ buff: EngineBuff, _ out: EventList, _ ev: EngineEvent?) {
        for t in stunTargets(S, card) { Handlers.noDamage(S, card, .card(t), player, opponent, buff, out, ev) }
    }
}
