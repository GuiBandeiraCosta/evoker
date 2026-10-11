import Foundation

/// The battle board model of the playback (`src/ui/battle/model.js`, pure): built from the battleStart snapshot
/// and advanced event by event, exactly as the engine reported it. `final` is what "Skip fight" jumps to.
extension BoardModel {
    /// The board model derived from the battleStart snapshot (`initialModel`).
    public static func initial(events: [BattleEvent]) -> BoardModel {
        var start: (attacker: SideSnapshot, defender: SideSnapshot)?
        for ev in events {
            if case .battleStart(_, let a, let d) = ev { start = (a, d); break }
        }
        func side(_ s: SideSnapshot?) -> BoardSide {
            var cards: [BoardCard?] = []
            for i in 0..<5 {
                let c: CardSnapshot? = (s != nil && i < s!.cards.count) ? s!.cards[i] : nil
                cards.append(c.map { BoardCard(cardId: $0.cardId, name: $0.name, tribe: $0.tribe, hp: $0.hp, maxHp: $0.maxHp, attack: $0.attack, baseAttack: $0.attack, dead: false) })
            }
            let hp = s?.player.hp ?? 0
            let maxHp = (s?.player.maxHp ?? 0) != 0 ? s!.player.maxHp : (hp != 0 ? hp : 1)
            return BoardSide(player: BoardPlayer(name: s?.player.name ?? "", hp: hp, maxHp: maxHp), cards: cards)
        }
        return BoardModel(round: 0, winner: nil, ended: false, rounds: 0, attacker: side(start?.attacker), defender: side(start?.defender), deaths: Deaths())
    }

    /// Apply one event to the model (`reduceEvent`).
    public mutating func reduce(_ event: BattleEvent) {
        switch event {
        case .roundStart(let round, _, _):
            self.round = round
            // per-round attack boosts end with the round (the engine resets attack to origAttack at round start)
            for side in [Side.attacker, Side.defender] {
                for i in self[side].cards.indices {
                    if let base = self[side].cards[i]?.baseAttack { self[side].cards[i]?.attack = base }
                }
            }
        case .buff(let side, let slot, let stat, let delta, let permanent, _):
            if stat == .attack, let slot, let card = self.card(side, slot) {
                var c = card
                c.attack = Swift.max(0, c.attack + delta)
                if permanent { c.baseAttack = Swift.max(0, c.baseAttack + delta) }
                self[side].cards[slot] = c
            }
            if stat == .maxHp {
                if slot == nil {
                    self[side].player.maxHp = Swift.max(1, self[side].player.maxHp + delta)
                    self[side].player.hp = Swift.min(self[side].player.maxHp, self[side].player.hp + delta)
                } else if let slot, var c = self.card(side, slot) {
                    c.maxHp = Swift.max(1, c.maxHp + delta)
                    c.hp += delta
                    self[side].cards[slot] = c
                }
            }
        case .damage(let side, let slot, _, let hp, _, _, _):
            setHp(side, slot, hp)
        case .heal(let side, let slot, _, let hp, _):
            setHp(side, slot, hp)
        case .swap(let side, let slot, let attack, let hp, let maxHp, _):
            if var c = self.card(side, slot) {
                c.attack = attack
                c.baseAttack = attack
                c.hp = hp
                c.maxHp = maxHp
                self[side].cards[slot] = c
            }
        case .death(let side, let slot, _):
            if var c = self.card(side, slot) {
                c.dead = true
                self[side].cards[slot] = c
                deaths[side] += 1
            }
        case .revive(let side, let slot, let hp, let attack, _):
            if var c = self.card(side, slot) {
                c.dead = false
                c.hp = hp
                c.attack = attack
                c.baseAttack = attack
                if c.hp > c.maxHp { c.maxHp = c.hp }
                self[side].cards[slot] = c
            }
        case .roundEnd(let round, let a, let d, _):
            attacker.player.hp = a
            defender.player.hp = d
            self.round = round
        case .battleEnd(let winner, let rounds, let a, let d, _):
            self.winner = winner
            self.rounds = rounds
            ended = true
            attacker.player.hp = a
            defender.player.hp = d
        case .battleStart, .status, .attack, .gamble:
            break
        }
    }

    private func card(_ side: Side, _ slot: Int) -> BoardCard? {
        let cards = self[side].cards
        guard slot >= 0 && slot < cards.count else { return nil }
        return cards[slot]
    }

    private mutating func setHp(_ side: Side, _ slot: Int?, _ hp: Int) {
        if let slot {
            if var c = card(side, slot) {
                c.hp = hp
                self[side].cards[slot] = c
            }
        } else {
            self[side].player.hp = hp
        }
    }

    /// The board after every event: what "Skip fight" jumps to (`finalState`).
    public static func final(events: [BattleEvent]) -> BoardModel {
        var model = initial(events: events)
        for ev in events { model.reduce(ev) }
        return model
    }
}
