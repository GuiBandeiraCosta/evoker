import Foundation
import Combine
import UIKit
import SpriteKit
import EvokerCore

/// Battle playback (port of `playBattle` of `src/ui/battle-player.js`): plays the timed steps of
/// `Timeline.fromEvents` one after the other as SKAction sequences on a driver node, applies `BoardModel.reduce`
/// per step for the numbers, honours the 1x / 2x speed (1x = the original pacing, STEP_MS) and `skip()` jumps to
/// `BoardModel.final` instantly. Sounds go through `BattleSoundChannel` (original names, seeded variants).
///
/// Effect → sprite / sound table: see the header of battle-player.js; this file follows it step by step.
///
/// A fight the engine ends on a player's HP plays every step of its last round in order, exactly as logged —
/// the attacks after the killing blow are drawn too and the bars go negative on the hits themselves. Then the
/// finale (`StepTiming.finale`): the board holds, a white starburst, and the result banner. The cards left on
/// both rows stay (user's choice 2026-10-10).
final class BattlePlayer: ObservableObject {
    enum State: Equatable {
        case idle, playing, endedPlayed, endedSkipped
        var ended: Bool { self == .endedPlayed || self == .endedSkipped }
    }

    @Published private(set) var state: State = .idle

    let steps: [PlaybackStep]
    /// The board after every event: the skip target, the finale's end values and the summary.
    let final: BoardModel
    /// Index of the lethal-blow step (-1 when the fight does not end on a player's HP).
    let lethal: Int
    private(set) var model: BoardModel
    private(set) var speed: Double
    private var roundTime: Double = 1
    private var cancelled = false
    private var finished = false
    private var skipped = false

    private weak var board: BattleBoard?
    private let scene: SKScene
    let fx: BattleFX
    let sounds: BattleSoundChannel
    /// Every timer of the fight runs as an action on this node, so skip() removes them all at once.
    private let driver = SKNode()

    var onRound: ((Int) -> Void)?
    var onEnd: ((BoardModel, Bool) -> Void)?
    var onStep: ((PlaybackStep) -> Void)?

    private static let sides: [Side] = [.attacker, .defender]

    init(board: BattleBoard & SKScene, events: [BattleEvent], speed: Double, audio: AudioPlaying?) {
        self.board = board
        self.scene = board
        self.steps = Timeline.fromEvents(events, speed: 1)
        self.model = BoardModel.initial(events: events)
        self.final = BoardModel.final(events: events)
        self.lethal = Timeline.lethalStep(events, steps: nil)
        self.speed = speed > 0 ? speed : 1
        var seed: UInt32 = 0
        for e in events { if case .battleStart(let s, _, _) = e { seed = s; break } }
        let channel = BattleSoundChannel(seed: seed, audio: audio)
        self.sounds = channel
        // the closures below capture `self` lazily through a box so that `fx` can be built before `self` exists
        let box = PlayerBox()
        self.fx = BattleFX(board: board, scaled: { ms in box.player?.scaled(ms) ?? max(0.001, ms / 1000) }, pick: { list in
            channel.pick(list) ?? list.first ?? 0
        })
        box.player = self
        driver.name = "battle-driver"
        scene.addChild(driver)
    }

    /// Breaks the initialisation cycle between the player and its fx closures.
    private final class PlayerBox {
        weak var player: BattlePlayer?
    }

    // MARK: timing

    /// ms at 1x → seconds at the current speed and round (`scaled`).
    func scaled(_ ms: Double) -> TimeInterval {
        max(1, (ms * roundTime / speed).rounded()) / 1000
    }

    /// Fire-and-forget timer in raw ms (`later`), cancelled on skip.
    func later(_ ms: Double, _ fn: @escaping () -> Void) {
        driver.run(.sequence([.wait(forDuration: max(0.001, ms / 1000)), .run { [weak self] in
            guard let self = self, !self.cancelled else { return }
            fn()
        }]))
    }

    func setSpeed(_ n: Double) {
        speed = n > 0 ? n : 1
    }

    // MARK: board updates

    private func card(_ side: Side, _ slot: Int) -> BattleCardNode? { board?.card(side, slot) }

    private func updateCard(_ side: Side, _ slot: Int) {
        guard slot >= 0, slot < 5, let m = model[side].cards[slot], let node = card(side, slot) else { return }
        node.setHp(m.hp, maxHp: m.maxHp)
        node.setAttack(m.attack)
    }

    private func updatePlayer(_ side: Side) {
        board?.playerBar(side)?.set(hp: model[side].player.hp, maxHp: model[side].player.maxHp)
    }

    private func tribeOf(_ side: Side, _ slot: Int?) -> Tribe {
        guard let s = slot, s >= 0, s < 5, let c = model[side].cards[s] else { return .neutral }
        return c.tribe
    }

    private func sideWiped(_ side: Side) -> Bool {
        model[side].cards.allSatisfy { $0 == nil || $0!.dead }
    }

    private func reduce(_ ev: BattleEvent) { model.reduce(ev) }

    // MARK: hits, heals, statuses (applyDamageHit / applyHeal / applyStatusFx)

    private func applyDamageHit(_ ev: BattleEvent, once: BattleSoundChannel.Once, set: BattleSounds.TribeSet?) {
        guard case .damage(let side, let slot, let amount, _, let cause, let blocked, let source) = ev else { return }
        reduce(ev)
        if slot == nil {
            updatePlayer(side)
            if amount > 0 {
                fx.floatNum(side, nil, "-\(plainNumber(amount))", .damage)
                fx.flashBar(side)
                fx.playerBurst(side)
                once.play("player", BattleSounds.list(.playerHit))
            }
            return
        }
        let s = slot!
        let c = fx.targetCenter(side, s)
        updateCard(side, s)
        if blocked {
            fx.floatNum(side, s, "blocked", .blocked, at: c)
            fx.flashCard(side, s, [.glowSphere], seconds: scaled(500))
            fx.sprite("defended_icon", at: CGPoint(x: c.x, y: c.y - 10), w: 91, h: 79, anim: .pop, dur: 650)
            fx.sprite("invulnerable_effec_04", at: c, w: 240, anim: .flash, dur: 450)
            once.play("blocked", BattleSounds.list(.invulnerable))
            return
        }
        switch cause {
        case .reflect:
            // bounced back: the reflecting card (source) flares, the beam returns to the hit card
            if let src = source, let srcSlot = src.slot {
                let from = fx.targetCenter(src.side, srcSlot)
                fx.sprite("shockwave01", at: from, w: 230, anim: .burst, dur: 550)
                fx.beam(from: from, to: c, name: "beam", dur: 300, w: 80)
            }
            fx.sprite("hud_explosion01", at: c, w: 200, anim: .pop, dur: 420, delay: 120)
            once.play("reflect", BattleSounds.list(.reflect))
        case .attack:
            fx.hitBurst(c)
            once.play("impact", (set ?? BattleSounds.tribeSet(.neutral)).impact)
        case .kill:
            fx.sprite("hud_explosion03", at: c, w: 300, anim: .pop, dur: 600, rot: 20)
            fx.sprite("attacked_icon", at: c, w: 91, h: 79, anim: .pop, dur: 700, delay: 80)
            once.play("kill", BattleSounds.list(.kill))
        case .poison:
            fx.sprite("dust", at: c, w: 230, anim: .burst, dur: 700, tint: BattleColors.hex(0x5ad13a))
            once.play("poison", BattleSounds.list(.poison))
        case .ability, .death:
            fx.sprite("hud_explosion03", at: c, w: 260, anim: .pop, dur: 480, rot: -25)
            fx.sprite("blast2", at: c, w: 150, h: 110, anim: .burst, dur: 450)
            once.play("ability", BattleSounds.list(.abilityImpact))
        }
        fx.flashCard(side, s, [.shake, .flashRed], seconds: scaled(450))
        fx.floatNum(side, s, "-\(plainNumber(amount))", .damage, at: c)
    }

    private func applyHeal(_ ev: BattleEvent, once: BattleSoundChannel.Once) {
        guard case .heal(let side, let slot, let amount, _, _) = ev else { return }
        reduce(ev)
        if amount <= 0 { return }
        if slot == nil {
            updatePlayer(side)
            fx.floatNum(side, nil, "+\(plainNumber(amount))", .heal)
            fx.sprite("white_glow", at: fx.barTroughCenter(side), w: 560, h: 170, anim: .flash, dur: 600, tint: BattleColors.hex(0x3fd23f))
            once.play("healAffect", BattleSounds.list(.healAffect))
            return
        }
        let s = slot!
        let c = fx.targetCenter(side, s)
        updateCard(side, s)
        fx.sprite("white_glow", at: c, w: 240, anim: .burst, dur: 800, tint: BattleColors.hex(0x56e04a))
        fx.sprite("invulnerable_effec_02", at: c, w: 150, anim: .rise, dur: 900, rot: 180, tint: BattleColors.hex(0x9dff8a))
        fx.flashCard(side, s, [.glowHeal], seconds: scaled(700))
        fx.floatNum(side, s, "+\(plainNumber(amount))", .heal, at: c)
        once.play("healAffect", BattleSounds.list(.healAffect))
    }

    private func applyStatusFx(_ side: Side, _ slot: Int, _ status: CardStatus) {
        let c = fx.targetCenter(side, slot)
        if status == .dazed || status == .stunned {
            fx.cardFx(side, slot, "stun_effect08", anim: .pulse, tint: BattleColors.hex(0xff3b30), alpha: 0.8, key: "daze")
            fx.sprite("fx_glow04", at: c, w: 220, anim: .flash, dur: 500, tint: BattleColors.hex(0xff5040))
        }
        if status == .suspended || status == .stunned {
            fx.cardFx(side, slot, "fx_glow01", w: 104, h: 104, anim: .spin, alpha: 0.9, key: "suspend")
            fx.cardFx(side, slot, "Spell_Circle2", w: 66, h: 66, anim: .spinRev, tint: BattleColors.hex(0x9ae8ff), key: "suspend2")
            fx.sprite("fx_glow01", at: c, w: 200, anim: .flash, dur: 600)
        }
        if status == .indestructible {
            fx.invulnAura(side, slot)
            fx.sprite("invulnerable_effec_04", at: c, w: 260, anim: .flash, dur: 520)
            fx.sprite("glowingcard", at: c, w: 150, h: 200, anim: .flash, dur: 420, alpha: 0.45)
        }
    }

    private func statusIcon(_ status: CardStatus) -> BattleCardNode.StatusIcon? {
        switch status {
        case .dazed: return .daze
        case .stunned: return .stun
        case .suspended: return .suspend
        case .indestructible: return nil
        }
    }

    private func clearStatuses() {
        for side in BattlePlayer.sides {
            for i in 0..<5 {
                if let c = card(side, i) { c.setStatus(nil); c.clearFx() }
            }
        }
    }

    private func rollRound(_ n: Int) {
        guard let scene = board as? BattleScene else { return }
        let ms = max(1, (250 / speed).rounded())
        scene.roundLabel.roll(to: "ROUND \(n)", seconds: ms / 1000)
    }

    // MARK: steps

    private func wait(_ seconds: TimeInterval) -> SKAction { .wait(forDuration: max(0.001, seconds)) }

    private func run(_ fn: @escaping () -> Void) -> SKAction {
        .run { [weak self] in
            guard let self = self, !self.cancelled else { return }
            fn()
        }
    }

    func start() {
        guard state == .idle else { return }
        state = .playing
        playStep(0)
    }

    private func playStep(_ i: Int) {
        if cancelled { return }
        guard i < steps.count else { afterSteps(); return }
        let step = steps[i]
        let durMs = Timeline.stepDuration(kind: step.kind, baseMs: step.baseMs, factor: step.factor, speed: speed)
        let dur = Double(durMs) / 1000
        onStep?(step)
        let once = sounds.once()
        var actions: [SKAction] = []

        switch step.payload {
        case .start(_, _, _, let bonus):
            actions.append(run { [self] in
                for ev in step.events { reduce(ev) }
                for side in BattlePlayer.sides { updatePlayer(side); for s in 0..<5 { updateCard(side, s) } }
            })
            if !bonus.isEmpty {
                actions.append(contentsOf: tribeBonusActions(bonus, dur: dur))
            } else {
                actions.append(wait(dur))
            }

        case .round(let n):
            actions.append(run { [self] in
                if let first = step.events.first { reduce(first) }
                for side in BattlePlayer.sides { for s in 0..<5 { updateCard(side, s) } }
                roundTime = Timeline.roundFactor(n)
                clearStatuses()
                rollRound(n)
                onRound?(n)
                sounds.play(.nextRound)
            })
            actions.append(wait(dur))

        case .status(let side, let slot, let status, let on, let source):
            actions.append(run { [self] in
                if let c = card(side, slot) {
                    if on {
                        if let icon = statusIcon(status) { c.setStatus(icon) }
                        applyStatusFx(side, slot, status)
                    } else {
                        c.setStatus(nil)
                        c.clearFx()
                    }
                }
                if let src = source, let srcSlot = src.slot, !(src.side == side && srcSlot == slot) {
                    fx.flashCard(src.side, srcSlot, [.glowBuff], seconds: dur)
                    fx.sprite("spell", at: fx.targetCenter(src.side, srcSlot), w: 150, anim: .pop, dur: 500)
                }
                if on {
                    if status == .indestructible { sounds.play(.invulnerable) }
                    else {
                        sounds.play(.curse)
                        later(scaled(150) * 1000) { [weak self] in self?.sounds.play(.curseAffect) }
                    }
                }
            })
            actions.append(wait(dur))

        case .buff(let side, let slot, let stat, let delta, _, _):
            actions.append(run { [self] in
                for ev in step.events { reduce(ev) }
                let onCard = slot != nil
                let c: CGPoint? = onCard ? fx.targetCenter(side, slot) : nil
                switch stat {
                case .attack:
                    let up = delta >= 0
                    if let s = slot, let center = c {
                        updateCard(side, s)
                        fx.flashCard(side, s, [up ? .glowBuff : .glowDebuff], seconds: dur)
                        fx.buffArrows(center, up ? "card_arrowred01" : "card_arrowblue01", up: up)
                        fx.sprite("fx_glow03", at: center, w: 220, anim: .flash, dur: 500, tint: up ? BattleColors.hex(0xffcc33) : BattleColors.hex(0xa64ddb))
                    }
                    let label = "\(delta >= 0 ? "+" : "")\(plainNumber(delta))"
                    // a lowered attack is no damage: the violet attack-debuff number (sword icon), not the red hit
                    fx.floatNum(side, slot, label, up ? .buff : .debuff, atk: true, at: c)
                    sounds.play(up ? .raiseAttack : .curse)
                case .maxHp:
                    guard let s = slot, let center = c else {
                        // the per-round re-application of a player's max-HP raise nets to 0: nothing to show
                        updatePlayer(side)
                        if delta != 0 {
                            fx.floatNum(side, nil, "\(delta > 0 ? "+" : "")\(plainNumber(delta))", delta > 0 ? .heal : .debuff)
                            sounds.play(.heal)
                        }
                        return
                    }
                    updateCard(side, s)
                    fx.flashCard(side, s, [.glowHeal], seconds: dur)
                    fx.buffArrows(center, "card_arrow01", up: delta >= 0)
                    fx.sprite("fx_glow03", at: center, w: 220, anim: .flash, dur: 500, tint: BattleColors.hex(0x3fd23f))
                    fx.floatNum(side, s, "\(delta >= 0 ? "+" : "")\(plainNumber(delta))", delta >= 0 ? .heal : .debuff, at: center)
                    sounds.play(.heal)
                }
            })
            actions.append(wait(dur))

        case .attack(let side, let slot, let attack, let targets, let hits):
            let set = BattleSounds.tribeSet(tribeOf(side, slot))
            actions.append(run { [self] in
                if let first = step.events.first {
                    reduce(first)
                    var bonus = false
                    if case .attack(_, _, _, let b, _) = first { bonus = b }
                    if var atk = model[side].cards[slot], !bonus, atk.attack != attack {
                        atk.attack = attack
                        model[side].cards[slot] = atk
                        updateCard(side, slot)
                    }
                }
                let from = fx.targetCenter(side, slot)
                fx.flashCard(side, slot, [.glowAttack], seconds: dur)
                fx.sprite("fx_glow03", at: from, w: 170, anim: .flash, dur: 320)
                sounds.play(set.windup)
            })
            if targets.isEmpty && hits.isEmpty {
                actions.append(wait(dur))
            } else {
                // server sample: wind-up 0-400, missile 200-700, impact (burst, shake, HP tween) at 700, "-N" at 800
                let windup = (dur * 200 / 1500 * 1000).rounded() / 1000
                let flight = (dur * 500 / 1500 * 1000).rounded() / 1000
                actions.append(wait(windup))
                actions.append(run { [self] in
                    let from = fx.targetCenter(side, slot)
                    for t in targets { fx.bullet(from: from, to: fx.aimPoint(side, slot, t), seconds: flight) }
                    if !targets.isEmpty { sounds.play(set.missile) }
                })
                actions.append(wait(flight))
                actions.append(run { [self] in
                    for hit in hits { applyDamageHit(hit, once: once, set: set) }
                })
                actions.append(wait(max(0.001, dur - windup - flight)))
            }

        case .damage(let cause, let source, let hits):
            if let src = source, let srcSlot = src.slot {
                let beamSeconds = (dur * 0.35 * 1000).rounded() / 1000
                actions.append(run { [self] in
                    fx.flashCard(src.side, srcSlot, [.glowAttack], seconds: dur)
                    let from = fx.targetCenter(src.side, srcSlot)
                    fx.sprite("spell", at: from, w: 150, anim: .pop, dur: 500)
                    if cause == .ability || cause == .death {
                        for hit in hits {
                            if let hs = hit.side { fx.beam(from: from, to: fx.targetCenter(hs, hit.slot), name: "flash1", dur: beamSeconds * 1000 + 120, w: 90) }
                        }
                        sounds.play(.bolt)
                    }
                })
                actions.append(wait(beamSeconds))
                actions.append(run { [self] in
                    for hit in hits { applyDamageHit(hit, once: once, set: nil) }
                })
                actions.append(wait(dur - beamSeconds))
            } else {
                actions.append(run { [self] in
                    for hit in hits { applyDamageHit(hit, once: once, set: nil) }
                })
                actions.append(wait(dur))
            }

        case .heal(let source, let heals):
            actions.append(run { [self] in
                if let src = source, let srcSlot = src.slot {
                    fx.flashCard(src.side, srcSlot, [.glowHeal], seconds: dur)
                    fx.sprite("fx_glow02", at: fx.targetCenter(src.side, srcSlot), w: 210, anim: .flash, dur: 600, tint: BattleColors.hex(0x7dff6a))
                }
                sounds.play(.heal)
                for ev in heals { applyHeal(ev, once: once) }
            })
            actions.append(wait(dur))

        case .death(let deaths):
            actions.append(run { [self] in
                for ev in deaths {
                    guard case .death(let side, let slot, _) = ev else { continue }
                    reduce(ev)
                    let c = fx.targetCenter(side, slot)
                    if let node = card(side, slot) {
                        node.setStatus(nil)
                        node.clearFx()
                        node.resetVisual()
                        if !fx.shatter(side, slot, seconds: dur) { node.dissolve(seconds: dur) }
                    }
                    fx.sprite("hud_explosion03", at: c, w: 280, anim: .pop, dur: 450, rot: 25)
                    fx.sprite("sparks", at: c, w: 240, anim: .rise, dur: 900, delay: 80, tint: BattleColors.hex(0xffc040))
                    fx.sprite("dust", at: CGPoint(x: c.x, y: c.y + 20), w: 260, anim: .burst, dur: 900, delay: 120, tint: BattleColors.hex(0xffb060))
                    if sideWiped(side) { fx.sprite("fx_alldieskull01", at: fx.rowCenter(side), w: 292, h: 249, anim: .pop, dur: 950, delay: 200) }
                }
                sounds.play(.death)
            })
            actions.append(wait(dur))
            actions.append(run { [self] in
                for ev in deaths {
                    guard case .death(let side, let slot, _) = ev else { continue }
                    detachCard(side, slot)
                }
            })

        case .revive(let side, let slot, _, _):
            actions.append(run { [self] in
                if let first = step.events.first { reduce(first) }
                attachCard(side, slot)
                if let node = card(side, slot) {
                    node.resetVisual()
                    node.reviveFlash(seconds: 1.2)
                }
                updateCard(side, slot)
                let c = fx.targetCenter(side, slot)
                fx.sprite("big_glow", at: c, w: 340, anim: .burst, dur: 900)
                fx.sprite("lens_flare", at: c, w: 170, anim: .pop, dur: 800, delay: 100)
                fx.sprite("fx_glow03", at: c, w: 260, anim: .flash, dur: 600, delay: 200)
                fx.floatNum(side, slot, "Revived!", .heal, at: c)
                sounds.play(.revive)
            })
            actions.append(wait(dur))

        case .roundEnd, .end:
            actions.append(run { [self] in
                if let first = step.events.first { reduce(first) }
                for side in BattlePlayer.sides { updatePlayer(side) }
            })
            actions.append(wait(dur))

        case .misc(let event):
            actions.append(run { [self] in
                for ev in step.events { reduce(ev) }
                switch event {
                case .swap(let side, let slot, _, _, _, _):
                    updateCard(side, slot)
                    fx.floatNum(side, slot, "swap!", .buff)
                case .gamble(let side, let slot, let failed, _):
                    fx.floatNum(side, slot, failed ? "Spell failed" : "Spell!", failed ? .damage : .buff)
                default:
                    break
                }
            })
            actions.append(wait(dur))
        }

        actions.append(.run { [weak self] in self?.playStep(i + 1) })
        driver.run(.sequence(actions), withKey: "step")
    }

    /// The tribe-bonus moment before round 1: the bonus side's frame shows its glowing tribe icon, "TRIBE BONUS"
    /// crossfades over the HP number while it counts up by exactly 20 % (fight_bonus).
    private func tribeBonusActions(_ list: [TribeBonusMoment], dur: TimeInterval) -> [SKAction] {
        let lead = (dur * 0.1 * 1000).rounded() / 1000
        let countMs = (dur * 0.75 * 1000).rounded() / 1000
        var actions: [SKAction] = []
        actions.append(run { [self] in
            sounds.play(.bonus)
            for b in list {
                board?.playerBar(b.side)?.set(hp: b.from, maxHp: b.from)
                board?.playerBar(b.side)?.setBonusPulse(true, seconds: dur)
                fx.bonusText(at: fx.barTroughCenter(b.side), seconds: dur)
                let fc = fx.frameCenter(b.side)
                // the web passes the already-scaled step duration (+200) and sprite() scales it once more
                fx.sprite("fx_glow03", at: fc, w: 200, anim: .hold, dur: dur * 1000 + 200, tint: BattleColors.bonusGold)
                fx.tribeIcon(at: fc, tribe: b.tribe, seconds: dur + 0.2)
            }
        })
        actions.append(wait(lead))
        let count = SKAction.customAction(withDuration: max(0.001, countMs)) { [weak self] _, elapsed in
            guard let self = self, !self.cancelled else { return }
            let k = max(0, min(1, Double(elapsed) / max(0.001, countMs)))
            for b in list {
                let v = Int((Double(b.from) + Double(b.to - b.from) * k).rounded())
                self.board?.playerBar(b.side)?.set(hp: v, maxHp: v)
            }
        }
        actions.append(count)
        actions.append(run { [self] in
            for b in list {
                updatePlayer(b.side)
                board?.playerBar(b.side)?.setBonusPulse(false, seconds: 0)
            }
        })
        actions.append(wait(max(0.001, dur - countMs - lead)))
        return actions
    }

    // MARK: cards leaving and returning

    private func detachCard(_ side: Side, _ slot: Int) {
        guard let node = card(side, slot) else { return }
        node.resetVisual()
        node.isDetached = true
        node.removeFromParent()
    }

    private func attachCard(_ side: Side, _ slot: Int) {
        guard let node = card(side, slot), let scene = board as? BattleScene else { return }
        if node.parent == nil { scene.world.addChild(node) }
        node.isDetached = false
    }

    // MARK: end, finale, skip

    /// Jump the board to the final state (skip): the cards alive at the end stay, as when the fight plays out.
    private func applyFinal() {
        for side in BattlePlayer.sides {
            for i in 0..<5 {
                guard let m = final[side].cards[i], let node = card(side, i) else { continue }
                node.resetVisual()
                if m.dead { detachCard(side, i); continue }
                attachCard(side, i)
                node.setHp(m.hp, maxHp: m.maxHp, animated: false)
                node.setAttack(m.attack)
            }
            board?.playerBar(side)?.set(hp: final[side].player.hp, maxHp: final[side].player.maxHp)
            board?.playerBar(side)?.setBonusPulse(false, seconds: 0)
        }
        if let scene = board as? BattleScene, final.rounds > 0 { scene.roundLabel.show("ROUND \(final.rounds)") }
        fx.clear()
    }

    private func afterSteps() {
        if cancelled { return }
        if lethal >= 0 {
            // the whole last round was drawn; now the starburst, then the banner
            let hold = scaled(Double(StepTiming.finale.lead + StepTiming.finale.hold))
            let burst = scaled(Double(StepTiming.finale.burst))
            driver.run(.sequence([
                wait(hold),
                run { [self] in
                    fx.clear()
                    for side in BattlePlayer.sides { board?.playerBar(side)?.set(hp: final[side].player.hp, maxHp: final[side].player.maxHp) }
                    fx.starburst(at: board?.layout.stageCenter ?? CGPoint(x: 360, y: 640))
                },
                wait(burst),
                .run { [weak self] in self?.end() },
            ]), withKey: "step")
        } else {
            end()
        }
    }

    private func end() {
        if finished { return }
        finished = true
        state = skipped ? .endedSkipped : .endedPlayed
        let layer = board?.fxLayer
        layer?.run(.sequence([.wait(forDuration: 1.6), .run { [weak layer] in layer?.removeAllChildren() }]))
        onEnd?(final, skipped)
    }

    /// Jump to the final state instantly.
    func skip() {
        if finished { return }
        cancelled = true
        skipped = true
        sounds.muted = true
        driver.removeAllActions()
        applyFinal()
        end()
    }

    /// Stop without applying anything (screen left).
    func destroy() {
        cancelled = true
        sounds.muted = true
        driver.removeAllActions()
        driver.removeFromParent()
        fx.clear()
        finished = true
    }
}
