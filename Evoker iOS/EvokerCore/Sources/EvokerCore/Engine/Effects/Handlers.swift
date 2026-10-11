import Foundation

/// The 18 buff handlers of the original simulator (`src/engine/effects/handlers.js`, main.#0 .. main.#17 of
/// game.fightsimulatorv2; spec: original-engine.md §3), ported literally, plus the dispatch of the registry.
///
/// Handler signature: (S, card, target, player, opponent, buff, out, ev)
///   S        engine state (UI log, rng, players, cards)
///   card     the acting card
///   target   a card, an empty slot (its direction) or none (buff without directions / scope)
///   player   the acting card's player in round mode; in event mode, for buffs with directions, the
///            triggering event's `player` (the attacker's player)
///   opponent the other player (same rule)
///   buff     the matched buff
///   out      engine events produced by this handler (onDamage / onDeath / onHeal)
///   ev       the triggering event in event mode, else nil
enum Handlers {
    /// `HANDLERS[key](...)`: run the registry entry (nothing for a key without handler).
    static func run(_ key: HandlerKey, _ S: EngineState, _ card: EngineCard, _ target: HandlerTarget, _ player: EnginePlayer,
                    _ opponent: EnginePlayer, _ buff: EngineBuff, _ out: EventList, _ ev: EngineEvent?) {
        switch key {
        case .stunPatternSuppress: Extensions.stunPatternSuppress(S, card, target, player, opponent, buff, out, ev)
        case .stunPatternDaze: Extensions.stunPatternDaze(S, card, target, player, opponent, buff, out, ev)
        case .type(let type):
            switch type {
            case .no_buff: noBuff(S, card, target, player, opponent, buff, out, ev)
            case .heal: heal(S, card, target, player, opponent, buff, out, ev)
            case .raise_attack: raiseAttack(S, card, target, player, opponent, buff, out, ev)
            case .raise_hp: raiseHp(S, card, target, player, opponent, buff, out, ev)
            case .raise_player_hp: raisePlayerHp(S, card, target, player, opponent, buff, out, ev)
            case .heal_player: healPlayer(S, card, target, player, opponent, buff, out, ev)
            case .increment_attack: incrementAttack(S, card, target, player, opponent, buff, out, ev)
            case .invulnerable: invulnerable(S, card, target, player, opponent, buff, out, ev)
            case .no_damage: noDamage(S, card, target, player, opponent, buff, out, ev)
            case .attack: attack(S, card, target, player, opponent, buff, out, ev)
            case .resurrect: resurrect(S, card, target, player, opponent, buff, out, ev)
            case .die: die(S, card, target, player, opponent, buff, out, ev)
            case .reflect_damage: reflectDamage(S, card, target, player, opponent, buff, out, ev)
            case .reflect_damage_to_player: reflectDamageToPlayer(S, card, target, player, opponent, buff, out, ev)
            case .deal_damage_to_opponent_player: dealDamageToOpponentPlayer(S, card, target, player, opponent, buff, out, ev)
            case .deal_damage_to_player: dealDamageToPlayer(S, card, target, player, opponent, buff, out, ev)
            case .deal_damage_to_all_opponent_cards: dealDamageToAllOpponentCards(S, card, target, player, opponent, buff, out, ev)
            case .self_damage: selfDamage(S, card, target, player, opponent, buff, out, ev)
            case .bonus_attack: Extensions.bonusAttack(S, card, target, player, opponent, buff, out, ev)
            case .kill: Extensions.kill(S, card, target, player, opponent, buff, out, ev)
            case .resurrect_allies: Extensions.resurrectAllies(S, card, target, player, opponent, buff, out, ev)
            case .swap_stats_random: Extensions.swapStatsRandom(S, card, target, player, opponent, buff, out, ev)
            case .wheel: Extensions.wheel(S, card, target, player, opponent, buff, out, ev)
            case .gamble: Extensions.gamble(S, card, target, player, opponent, buff, out, ev)
            case .heal_boost_percent: Extensions.healBoostPercent(S, card, target, player, opponent, buff, out, ev)
            case .reduce_ability_attack_percent: Extensions.reduceAbilityAttackPercent(S, card, target, player, opponent, buff, out, ev)
            case .stun_pattern, .none: break
            }
        }
    }

    /// Number of directions of a buff (the original divides by `#directions`; scope / direction-less buffs count as 1).
    static func nDirs(_ buff: EngineBuff) -> Double {
        buff.directions.isEmpty ? 1 : Double(buff.directions.count)
    }

    /// Damage cause for the UI log: ability damage triggered by a death is shown as `death`.
    static func causeOf(_ ev: EngineEvent?) -> DamageCause {
        ev?.type == .onDeath ? .death : .ability
    }

    /// Flat strength, or the percent of the target's (base) attack when the buff carries `strengthPercent`.
    static func percentOrFlat(_ buff: EngineBuff, _ card: EngineCard) -> Double {
        guard let pct = buff.strengthPercent else { return buff.strength ?? 0 }
        let base = buff.baseAttack ? card.origAttack : card.attack
        return JSMath.round(base * pct / 100)
    }

    // MARK: Statuses

    /// `no_buff`: target.noBuffsAllowed = true. NOT blocked by the source's own noBuffsAllowed.
    static func noBuff(_ S: EngineState, _ card: EngineCard, _ target: HandlerTarget, _ player: EnginePlayer, _ opponent: EnginePlayer,
                       _ buff: EngineBuff, _ out: EventList, _ ev: EngineEvent?) {
        guard case .card(let t) = target else { return }
        t.noBuffsAllowed = true
        t.suppressedBy = card
        S.emitStatus(t, .suspended, from: card, effect: buff.type)
    }

    /// `invulnerable`: target.invulnerable = true (per round).
    static func invulnerable(_ S: EngineState, _ card: EngineCard, _ target: HandlerTarget, _ player: EnginePlayer, _ opponent: EnginePlayer,
                             _ buff: EngineBuff, _ out: EventList, _ ev: EngineEvent?) {
        guard !card.noBuffsAllowed, case .card(let t) = target else { return }
        t.invulnerable = true
        S.emitStatus(t, .indestructible, from: card, effect: buff.type)
    }

    /// `no_damage`: target.attack = 0 (per round). Logged as `stunned` when the same card also suppressed the target this round.
    static func noDamage(_ S: EngineState, _ card: EngineCard, _ target: HandlerTarget, _ player: EnginePlayer, _ opponent: EnginePlayer,
                         _ buff: EngineBuff, _ out: EventList, _ ev: EngineEvent?) {
        guard !card.noBuffsAllowed, case .card(let t) = target else { return }
        t.attack = 0
        let stunned = t.noBuffsAllowed && t.suppressedBy === card
        S.emitStatus(t, stunned ? .stunned : .dazed, from: card, effect: buff.type)
    }

    // MARK: Buffs

    /// `raise_attack`: target.attack = max(0, attack + round(strength / #directions)) (per round).
    static func raiseAttack(_ S: EngineState, _ card: EngineCard, _ target: HandlerTarget, _ player: EnginePlayer, _ opponent: EnginePlayer,
                            _ buff: EngineBuff, _ out: EventList, _ ev: EngineEvent?) {
        guard !card.noBuffsAllowed, case .card(let t) = target else { return }
        let amount = JSMath.round(percentOrFlat(buff, t) / nDirs(buff))
        t.attack = Swift.max(0, t.attack + amount)
        S.emitBuff(t.ref, .attack, delta: amount, permanent: false, from: card, effect: buff.type.rawValue)
    }

    /// `raise_hp`: target.hp = max(0, hp + round(strength / #directions)) (per round).
    static func raiseHp(_ S: EngineState, _ card: EngineCard, _ target: HandlerTarget, _ player: EnginePlayer, _ opponent: EnginePlayer,
                        _ buff: EngineBuff, _ out: EventList, _ ev: EngineEvent?) {
        guard !card.noBuffsAllowed, case .card(let t) = target else { return }
        let amount = JSMath.round((buff.strength ?? 0) / nDirs(buff))
        t.hp = Swift.max(0, t.hp + amount)
        S.syncCardMaxHp(t, from: card, effect: buff.type.rawValue)
    }

    /// `raise_player_hp`: player.hp = max(0, hp + strength) (per round, not split).
    static func raisePlayerHp(_ S: EngineState, _ card: EngineCard, _ target: HandlerTarget, _ player: EnginePlayer, _ opponent: EnginePlayer,
                              _ buff: EngineBuff, _ out: EventList, _ ev: EngineEvent?) {
        guard !card.noBuffsAllowed else { return }
        let s = buff.strength ?? 0
        player.hp = Swift.max(0, player.hp + s)
        S.syncPlayerMaxHp(player, from: card, effect: buff.type.rawValue)
    }

    /// `increment_attack`: permanent: origAttack = max(0, origAttack + strength); attack += strength. Not split.
    static func incrementAttack(_ S: EngineState, _ card: EngineCard, _ target: HandlerTarget, _ player: EnginePlayer, _ opponent: EnginePlayer,
                                _ buff: EngineBuff, _ out: EventList, _ ev: EngineEvent?) {
        guard !card.noBuffsAllowed, case .card(let t) = target else { return }
        let s = percentOrFlat(buff, t)
        t.origAttack = Swift.max(0, t.origAttack + s)
        t.attack = t.attack + s
        S.emitBuff(t.ref, .attack, delta: s, permanent: true, from: card, effect: buff.type.rawValue)
    }

    // MARK: Heals

    /// `heal`: card target, not died: takenDamage -= round(strength / #directions) (may go below 0; clamped at round end). Pushes `onHeal`.
    static func heal(_ S: EngineState, _ card: EngineCard, _ target: HandlerTarget, _ player: EnginePlayer, _ opponent: EnginePlayer,
                     _ buff: EngineBuff, _ out: EventList, _ ev: EngineEvent?) {
        guard !card.noBuffsAllowed, case .card(let t) = target, !t.died else { return }
        let boost = 1 + (S.player(card.playerId).healBoost / 100)
        let amount = JSMath.round((buff.strength ?? 0) * boost / nDirs(buff))
        t.takenDamage -= amount
        if amount != 0 { S.emitHeal(t.ref, amount: amount, hp: t.shownHp, from: card, effect: buff.type) }
        if amount > 0 { out.push(EngineEvent(.onHeal, from: card, to: t, value: amount)) }
    }

    /// `heal_player`: player.takenDamage = max(0, takenDamage - strength).
    static func healPlayer(_ S: EngineState, _ card: EngineCard, _ target: HandlerTarget, _ player: EnginePlayer, _ opponent: EnginePlayer,
                           _ buff: EngineBuff, _ out: EventList, _ ev: EngineEvent?) {
        guard !card.noBuffsAllowed else { return }
        let before = player.takenDamage
        player.takenDamage = Swift.max(0, before - (buff.strength ?? 0))
        let amount = before - player.takenDamage
        if amount != 0 { S.emitHeal(player.ref, amount: amount, hp: player.currentHp, from: card, effect: buff.type) }
    }

    // MARK: Attack

    /// Append a target to the attack event of the current (card, buff, event) group, opening the event on the
    /// first visible hit. Hits for 0 damage (dazed attacker) are not shown.
    static func logHit(_ S: EngineState, _ card: EngineCard, _ buff: EngineBuff, _ ev: EngineEvent?, at ref: EventRef, damage: Double,
                       blocked: Bool, direction: OriginalDirection?) {
        var group = S.openAttack
        if group == nil || group!.card !== card || group!.buff !== buff || group!.ev !== ev {
            let g = AttackGroup(card: card, buff: buff, ev: ev)
            S.openAttack = g
            group = g
        }
        guard let g = group, damage > 0 else { return }
        if g.eventIndex == nil {
            g.attack = card.attack
            g.bonus = buff.type != .attack || ev != nil
            g.eventIndex = S.events.count
            S.events.append(.attack(side: card.side, slot: card.uiSlot, attack: Slots.toInt(g.attack), bonus: g.bonus, targets: []))
        }
        g.targets.append(AttackTarget(side: ref.side, slot: ref.slot, damage: Slots.toInt(damage), blocked: blocked, dir: direction?.rawValue))
        if let index = g.eventIndex {
            S.events[index] = .attack(side: card.side, slot: card.uiSlot, attack: Slots.toInt(g.attack), bonus: g.bonus, targets: g.targets)
        }
    }

    /// `attack` (also `bonus_attack`): dmg = round(attack / #directions); on an empty slot the opponent player takes
    /// round((attack - emptyReduction) / #directions). Invulnerable targets block the hit. Pushes an `onDamage`
    /// event for every card hit (unless `unreflectable`). Not blocked by noBuffsAllowed.
    /// Extensions: `strengthPercent` (of `origAttack` with `baseAttack`) scales the attack (bonus attacks).
    static func attack(_ S: EngineState, _ card: EngineCard, _ target: HandlerTarget, _ player: EnginePlayer, _ opponent: EnginePlayer,
                       _ buff: EngineBuff, _ out: EventList, _ ev: EngineEvent?) {
        let n = nDirs(buff)
        let atk = buff.baseAttack ? card.origAttack : card.attack
        let base: Double
        if let pct = buff.strengthPercent { base = atk * pct / 100 } else { base = atk }
        let dmg = JSMath.round(base / n)
        var edmg = dmg
        if let reduction = buff.emptyReduction { edmg = JSMath.round((base - reduction) / n) }
        var direction = S.direction
        if direction == nil, case .emptySlot(let d) = target { direction = d }
        if case .card(let t) = target {
            if t.invulnerable {
                logHit(S, card, buff, ev, at: t.ref, damage: dmg, blocked: true, direction: direction)
                if dmg > 0 { S.emitCardDamage(t, 0, .attack, from: card, effect: buff.type, blocked: true) }
                return
            }
            t.takenDamage += dmg
            if dmg > 0 { noteDamage(t, by: card) }
            if !buff.unreflectable { out.push(EngineEvent(.onDamage, from: card, to: t, player: player, opponent: opponent, value: dmg)) }
            logHit(S, card, buff, ev, at: t.ref, damage: dmg, blocked: false, direction: direction)
            if dmg > 0 { S.emitCardDamage(t, dmg, .attack, from: card, effect: buff.type) }
            return
        }
        opponent.takenDamage = opponent.takenDamage + edmg
        logHit(S, card, buff, ev, at: opponent.ref, damage: edmg, blocked: false, direction: direction)
        if edmg > 0 { S.emitPlayerDamage(opponent, edmg, .attack, from: card, effect: buff.type) }
    }

    // MARK: Reflects

    /// `reflect_damage` (event mode): for an onDamage event aimed at this card, the attacker takes the same amount (min cap).
    static func reflectDamage(_ S: EngineState, _ card: EngineCard, _ target: HandlerTarget, _ player: EnginePlayer, _ opponent: EnginePlayer,
                              _ buff: EngineBuff, _ out: EventList, _ ev: EngineEvent?) {
        guard !card.noBuffsAllowed, let ev, ev.type == .onDamage, ev.to === card else { return }
        var value = ev.value
        if let cap = buff.cap { value = Swift.min(value, cap) }
        if ev.from.invulnerable {
            if value > 0 { S.emitCardDamage(ev.from, 0, .reflect, from: card, effect: buff.type, blocked: true) }
            return
        }
        ev.from.takenDamage = ev.from.takenDamage + value
        if value > 0 {
            noteDamage(ev.from, by: card)
            S.emitCardDamage(ev.from, value, .reflect, from: card, effect: buff.type)
        }
    }

    /// `reflect_damage_to_player` (event mode): the attacker's player takes the damage value (min cap). No target
    /// check in the client: the data uses eventData `self`.
    static func reflectDamageToPlayer(_ S: EngineState, _ card: EngineCard, _ target: HandlerTarget, _ player: EnginePlayer, _ opponent: EnginePlayer,
                                      _ buff: EngineBuff, _ out: EventList, _ ev: EngineEvent?) {
        guard !card.noBuffsAllowed, let ev, ev.type == .onDamage else { return }
        let p = ev.player ?? S.player(Slots.otherId(card.playerId))
        var value = ev.value
        if let cap = buff.cap { value = Swift.min(value, cap) }
        p.takenDamage = p.takenDamage + value
        if value > 0 { S.emitPlayerDamage(p, value, .reflect, from: card, effect: buff.type) }
    }

    // MARK: Damage

    /// `deal_damage_to_all_opponent_cards`: every opponent card takes strength (invulnerable blocks); pushes onDamage per card unless `unreflectable`. Not split.
    static func dealDamageToAllOpponentCards(_ S: EngineState, _ card: EngineCard, _ target: HandlerTarget, _ player: EnginePlayer, _ opponent: EnginePlayer,
                                             _ buff: EngineBuff, _ out: EventList, _ ev: EngineEvent?) {
        guard !card.noBuffsAllowed else { return }
        let s = buff.strength ?? 0
        for i in 1...Slots.count {
            guard let c = S.cards[opponent.id][i] else { continue }
            if c.invulnerable {
                if s > 0 { S.emitCardDamage(c, 0, causeOf(ev), from: card, effect: buff.type, blocked: true) }
                continue
            }
            c.takenDamage = c.takenDamage + s
            if s > 0 { noteDamage(c, by: card) }
            if !buff.unreflectable { out.push(EngineEvent(.onDamage, from: card, to: c, player: player, opponent: opponent, value: s)) }
            if s != 0 { S.emitCardDamage(c, s, causeOf(ev), from: card, effect: buff.type) }
        }
    }

    /// `self_damage`: card.takenDamage += strength.
    static func selfDamage(_ S: EngineState, _ card: EngineCard, _ target: HandlerTarget, _ player: EnginePlayer, _ opponent: EnginePlayer,
                           _ buff: EngineBuff, _ out: EventList, _ ev: EngineEvent?) {
        guard !card.noBuffsAllowed else { return }
        let s = buff.strength ?? 0
        card.takenDamage = card.takenDamage + s
        if s != 0 { S.emitCardDamage(card, s, causeOf(ev), from: card, effect: buff.type) }
    }

    /// `deal_damage_to_opponent_player`: opponent.takenDamage += strength.
    static func dealDamageToOpponentPlayer(_ S: EngineState, _ card: EngineCard, _ target: HandlerTarget, _ player: EnginePlayer, _ opponent: EnginePlayer,
                                           _ buff: EngineBuff, _ out: EventList, _ ev: EngineEvent?) {
        guard !card.noBuffsAllowed else { return }
        let s = buff.strength ?? 0
        opponent.takenDamage = opponent.takenDamage + s
        if s != 0 { S.emitPlayerDamage(opponent, s, causeOf(ev), from: card, effect: buff.type) }
    }

    /// `deal_damage_to_player`: own player.takenDamage += strength (Minor Demon, Arch Demon).
    static func dealDamageToPlayer(_ S: EngineState, _ card: EngineCard, _ target: HandlerTarget, _ player: EnginePlayer, _ opponent: EnginePlayer,
                                   _ buff: EngineBuff, _ out: EventList, _ ev: EngineEvent?) {
        guard !card.noBuffsAllowed else { return }
        let s = buff.strength ?? 0
        player.takenDamage = player.takenDamage + s
        if s != 0 { S.emitPlayerDamage(player, s, causeOf(ev), from: card, effect: buff.type) }
    }

    // MARK: Death / life

    /// `die`: card target not yet dead with hp <= takenDamage -> died, push onDeath. Not blocked by noBuffsAllowed.
    static func die(_ S: EngineState, _ card: EngineCard, _ target: HandlerTarget, _ player: EnginePlayer, _ opponent: EnginePlayer,
                    _ buff: EngineBuff, _ out: EventList, _ ev: EngineEvent?) {
        guard case .card(let t) = target, !t.died else { return }
        if t.hp <= t.takenDamage { S.markDead(t, out) }
    }

    /// `resurrect`: acts on the card itself, once per fight: takenDamage = 0, died = false.
    static func resurrect(_ S: EngineState, _ card: EngineCard, _ target: HandlerTarget, _ player: EnginePlayer, _ opponent: EnginePlayer,
                          _ buff: EngineBuff, _ out: EventList, _ ev: EngineEvent?) {
        guard !card.noBuffsAllowed, !card.resurrected else { return }
        card.takenDamage = 0
        card.died = false
        card.resurrected = true
        S.emit(.revive(side: card.side, slot: card.uiSlot, hp: Slots.toInt(card.shownHp), attack: Slots.toInt(card.attack), source: card.source(buff.type.rawValue)))
    }
}
