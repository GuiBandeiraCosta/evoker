import Foundation
import UIKit
import SpriteKit
import QuartzCore
import EvokerCore

/// What the effect primitives need from the scene (`PlayerRoots` of fx.js).
protocol BattleBoard: AnyObject {
    var layout: BattleLayout { get }
    /// Positioned container the effects are drawn in (world coordinates, z over the cards).
    var fxLayer: SKNode { get }
    var textures: BattleTextureCache { get }
    /// The presenting view (needed to render a card into a texture for the death shatter).
    var skView: SKView? { get }
    func card(_ side: Side, _ slot: Int) -> BattleCardNode?
    func playerBar(_ side: Side) -> PlayerHPBarNode?
}

/// The one-shot sprite animations of `css/battle-fx.css` (`.fx-sprite.<anim> > .fx-img`), approximated with
/// SKAction keyframes.
enum FxAnim {
    case burst, pop, flash, rise, ring, hold, drop, spin

    /// The first keyframe (CSS `animation-fill-mode: both` holds it during the delay).
    func prepare(_ n: SKNode) {
        switch self {
        case .burst: n.alpha = 0; n.setScale(0.3)
        case .pop: n.alpha = 0; n.setScale(0.2)
        case .flash: n.alpha = 0; n.setScale(0.6)
        case .rise: n.alpha = 0; n.setScale(0.7); n.position = CGPoint(x: 0, y: -24)
        case .ring: n.alpha = 1; n.setScale(0.2)
        case .hold: n.alpha = 0; n.setScale(0.9)
        case .drop: n.alpha = 0; n.setScale(1.4); n.position = CGPoint(x: 0, y: 560)
        case .spin: break
        }
    }

    private static func eased(_ a: SKAction) -> SKAction { a.timingMode = .easeOut; return a }
    private static func fade(_ to: CGFloat, _ d: TimeInterval) -> SKAction { eased(.fadeAlpha(to: to, duration: d)) }
    private static func scale(_ to: CGFloat, _ d: TimeInterval) -> SKAction { eased(.scale(to: to, duration: d)) }

    /// The keyframes over `d` seconds.
    func action(seconds d: TimeInterval) -> SKAction {
        switch self {
        case .burst:
            return .sequence([
                .group([FxAnim.scale(1, d * 0.3), FxAnim.fade(1, d * 0.3)]),
                .group([FxAnim.scale(1.5, d * 0.7), FxAnim.fade(0, d * 0.7)]),
            ])
        case .pop:
            return .sequence([
                .group([FxAnim.scale(1.15, d * 0.35), FxAnim.fade(1, d * 0.35)]),
                FxAnim.scale(1, d * 0.35),
                .group([FxAnim.scale(1.05, d * 0.3), FxAnim.fade(0, d * 0.3)]),
            ])
        case .flash:
            return .sequence([
                .group([FxAnim.scale(1, d * 0.2), FxAnim.fade(1, d * 0.2)]),
                .group([FxAnim.scale(1.25, d * 0.8), FxAnim.fade(0, d * 0.8)]),
            ])
        case .rise:
            let move = SKAction.moveBy(x: 0, y: 114, duration: d)
            move.timingMode = .easeOut
            return .group([
                .sequence([FxAnim.fade(1, d * 0.25), FxAnim.fade(0, d * 0.75)]),
                move,
                FxAnim.scale(1.1, d),
            ])
        case .ring:
            return .group([FxAnim.scale(2.4, d), FxAnim.fade(0, d)])
        case .hold:
            return .sequence([
                .group([FxAnim.fade(1, d * 0.15), FxAnim.scale(1, d * 0.15)]),
                .wait(forDuration: d * 0.7),
                .group([FxAnim.fade(0, d * 0.15), FxAnim.scale(1.05, d * 0.15)]),
            ])
        case .drop:
            let move = SKAction.move(to: .zero, duration: d * 0.6)
            move.timingMode = .easeOut
            return .sequence([.group([move, FxAnim.scale(1, d * 0.6), FxAnim.fade(1, d * 0.6)]), .wait(forDuration: d * 0.4)])
        case .spin:
            return .repeatForever(.rotate(byAngle: -2 * .pi, duration: max(0.01, d)))
        }
    }
}

/// Style of a floating number (`.fx-float.<cls>`).
enum FloatStyle {
    case damage, heal, buff, debuff, blocked

    var color: UIColor {
        switch self {
        case .damage: return BattleColors.floatDamage
        case .heal: return BattleColors.floatHeal
        case .buff: return BattleColors.floatBuff
        case .debuff: return BattleColors.floatDebuff
        case .blocked: return BattleColors.floatBlocked
        }
    }

    /// Damage / heal / debuff numbers pop 100 ms after the impact.
    var delayed: Bool { self == .damage || self == .heal || self == .debuff }
}

/// The geometry helpers and effect primitives of one fight (fx.js `createFx`): sprites in the fx layer, overlays
/// inside a card, the golden aura, beams and bullets, floating numbers, card / bar flashes, the hit bursts and
/// the death shatter. Created once per fight by `BattlePlayer`, which owns the timers, the speed and the model.
final class BattleFX {
    private weak var board: BattleBoard?
    /// ms at 1x → seconds at the current speed and round (the player's `scaled`).
    let scaled: (Double) -> TimeInterval
    /// A seeded pick among values (sprite rotation variants).
    let pick: ([CGFloat]) -> CGFloat

    /// Floating-text layout (stage px, fx.js): a second number on the same target while the first is still up
    /// moves aside / up; numbers on a player sit right (then left) of the HP label.
    private static let floatStackDx: CGFloat = 18
    private static let floatStackDy: CGFloat = 44
    private static let floatPlayerDx: CGFloat = 200
    private static let floatGrow: CGFloat = 1.3
    private static let floatMargin: CGFloat = 10

    /// Floating numbers still on screen per target ('side:slot' → end times), to stack instead of overlapping.
    private var floatsLive: [String: [TimeInterval]] = [:]

    init(board: BattleBoard, scaled: @escaping (Double) -> TimeInterval, pick: @escaping ([CGFloat]) -> CGFloat) {
        self.board = board
        self.scaled = scaled
        self.pick = pick
    }

    private var layout: BattleLayout? { board?.layout }
    private var textures: BattleTextureCache? { board?.textures }

    // MARK: geometry

    func card(_ side: Side, _ slot: Int?) -> BattleCardNode? {
        guard let s = slot else { return nil }
        return board?.card(side, s)
    }

    func isPlayer(_ slot: Int?) -> Bool { slot == nil }

    /// Centre of a card (its slot: slots never move), or of the HP bar for a player.
    func targetCenter(_ side: Side, _ slot: Int?) -> CGPoint {
        layout?.targetCenter(side: side, slot: slot) ?? CGPoint(x: 360, y: 640)
    }

    func aimPoint(_ side: Side, _ slot: Int, _ target: AttackTarget) -> CGPoint {
        layout?.aimPoint(side: side, slot: slot, target: target) ?? targetCenter(target.side, target.slot)
    }

    func rowCenter(_ side: Side) -> CGPoint {
        layout?.rowCenter(side: side) ?? CGPoint(x: 360, y: 640)
    }

    func barTroughCenter(_ side: Side) -> CGPoint {
        layout?.playerBar(for: side).troughCenter ?? CGPoint(x: 374, y: 640)
    }

    func frameCenter(_ side: Side) -> CGPoint {
        layout?.frameCenter(for: side) ?? CGPoint(x: 74, y: 201)
    }

    // MARK: primitives

    /// Spawn a sprite effect in the fx layer: `pos` is the centre (stage px), `w`/`h` the size, `rot` the CSS
    /// rotation in degrees, `dur` and `delay` in ms at 1x.
    @discardableResult
    func sprite(_ name: String, at pos: CGPoint, w: CGFloat = 120, h: CGFloat? = nil, anim: FxAnim = .burst, dur: Double = 600,
                delay: Double = 0, rot: CGFloat = 0, tint: UIColor? = nil, alpha: CGFloat = 1) -> SKNode? {
        guard let board = board else { return nil }
        let size = CGSize(width: w, height: h ?? w)
        let container = SKNode()
        container.position = BattleLayout.sk(pos)
        container.zRotation = -rot * .pi / 180
        container.alpha = alpha
        let node = battleSprite(name, size: size, cache: board.textures, fallback: (tint ?? .white).withAlphaComponent(0.5))
        if let s = node as? SKSpriteNode {
            if BattleSprites.isAdditive(name) { s.blendMode = .add }
            if let t = tint { s.color = t; s.colorBlendFactor = 1 }
        }
        anim.prepare(node)
        container.addChild(node)
        board.fxLayer.addChild(container)
        let d = scaled(dur)
        let wait = scaled(delay)
        node.run(.sequence([.wait(forDuration: wait), anim.action(seconds: d)]))
        container.run(.sequence([.wait(forDuration: d + wait + 0.08), .removeFromParent()]))
        return container
    }

    /// Overlay a sprite inside a card (clipped by the card). Persistent unless `ttl` (ms at 1x) is given.
    func cardFx(_ side: Side, _ slot: Int, _ name: String, w: CGFloat? = nil, h: CGFloat? = nil, anim: BattleCardNode.FxAnim = .none,
                dur: Double = 450, ttl: Double? = nil, tint: UIColor? = nil, alpha: CGFloat = 1, key: String? = nil) {
        guard let c = card(side, slot) else { return }
        let size: CGSize? = (w != nil || h != nil) ? CGSize(width: w ?? BattleCardNode.size.width, height: h ?? BattleCardNode.size.height) : nil
        c.addFx(key: key, name: name, size: size, anim: anim, tint: tint, alpha: alpha, seconds: scaled(dur))
        if let t = ttl, let k = key {
            c.run(.sequence([.wait(forDuration: scaled(t)), .run { [weak c] in c?.clearFxLayer(key: k) }]), withKey: "fx-ttl-\(k)")
        }
    }

    func clearCardFx(_ side: Side, _ slot: Int) {
        card(side, slot)?.clearFx()
    }

    /// Invulnerable: the golden aura around the card (persistent until the status ends).
    func invulnAura(_ side: Side, _ slot: Int) {
        card(side, slot)?.showInvulnAura(seconds: scaled(450))
    }

    /// A beam sprite anchored at `from`, growing towards `to` (beam.png's bright head leads).
    func beam(from: CGPoint, to: CGPoint, name: String = "beam", dur: Double = 420, w: CGFloat = 110) {
        guard let board = board else { return }
        let dx = to.x - from.x
        let dy = to.y - from.y
        let len = max(60, hypot(dx, dy))
        let node: SKSpriteNode
        if let t = board.textures.texture(name) {
            node = SKSpriteNode(texture: t, size: CGSize(width: w, height: len))
            if BattleSprites.isAdditive(name) { node.blendMode = .add }
        } else {
            node = SKSpriteNode(color: UIColor(white: 1, alpha: 0.7), size: CGSize(width: max(6, w * 0.15), height: len))
            node.blendMode = .add
        }
        node.anchorPoint = CGPoint(x: 0.5, y: 1)
        node.position = BattleLayout.sk(from)
        node.zRotation = atan2(-dy, dx) + .pi / 2
        node.yScale = 0.001
        let d = scaled(dur)
        let grow = SKAction.scaleY(to: 1, duration: d * 0.55)
        grow.timingMode = .easeOut
        node.run(.sequence([grow, .fadeOut(withDuration: d * 0.45), .wait(forDuration: 0.08), .removeFromParent()]))
        board.fxLayer.addChild(node)
    }

    /// The original attack projectile: beam.png drawn small (a golden bullet with a short red trail, bright head
    /// leading) that travels from `from` to `to` in `seconds`.
    func bullet(from: CGPoint, to: CGPoint, seconds: TimeInterval, w: CGFloat = 150, h: CGFloat = 220, delay: Double = 0) {
        guard let board = board else { return }
        let dx = to.x - from.x
        let dy = to.y - from.y
        let container = SKNode()
        container.position = BattleLayout.sk(from)
        container.zRotation = atan2(-dy, dx) + .pi / 2
        let node: SKNode
        if let t = board.textures.texture("beam") {
            node = SKSpriteNode(texture: t, size: CGSize(width: w, height: h))
        } else {
            let s = SKShapeNode(ellipseOf: CGSize(width: 14, height: 34))
            s.fillColor = BattleColors.hex(0xffd36a)
            s.strokeColor = .clear
            s.glowWidth = 6
            node = s
        }
        node.alpha = 0
        node.setScale(0.7)
        container.addChild(node)
        board.fxLayer.addChild(container)
        let wait = scaled(delay)
        let move = SKAction.move(to: BattleLayout.sk(to), duration: seconds)
        move.timingMode = .easeIn
        node.run(.sequence([.wait(forDuration: wait), .group([.fadeIn(withDuration: seconds * 0.12), .scale(to: 1, duration: seconds)])]))
        container.run(.sequence([.wait(forDuration: wait), move, .wait(forDuration: 0.06), .removeFromParent()]))
    }

    /// Where floating numbers appear: over the target card (`at` = that centre when already measured); on a
    /// player's HP bar to the right of the HP label, the next one to the left, then stacked above.
    private func floatPos(_ side: Side, _ slot: Int?, k: Int, at: CGPoint?) -> CGPoint {
        if isPlayer(slot) {
            let c = barTroughCenter(side)
            let half = layout?.playerBar(for: side).troughHalfWidth ?? 280
            let dx = min(BattleFX.floatPlayerDx, max(0, half - 60))
            return CGPoint(x: c.x + (k % 2 == 1 ? -dx : dx), y: c.y - CGFloat(k / 2) * BattleFX.floatStackDy)
        }
        let c = at ?? targetCenter(side, slot)
        let dx: CGFloat = k > 0 ? (k % 2 == 1 ? -BattleFX.floatStackDx : BattleFX.floatStackDx) : 0
        return CGPoint(x: c.x + dx, y: c.y - 10 - CGFloat(k) * BattleFX.floatStackDy)
    }

    /// The client's "attack_card" text: pops in 200 ms, holds 200 ms, grows to 2x while fading 500 ms (700 ms),
    /// 100 ms after the impact. `atk` adds the sword icon in front of the number.
    func floatNum(_ side: Side, _ slot: Int?, _ text: String, _ style: FloatStyle, atk: Bool = false, at: CGPoint? = nil) {
        guard let board = board else { return }
        let wait = style.delayed ? scaled(100) : 0
        let anim = scaled(700)
        let life = anim + wait
        let key = "\(side.rawValue):\(slot.map { String($0) } ?? "p")"
        let now = CACurrentMediaTime()
        var live = (floatsLive[key] ?? []).filter { $0 > now }
        let pos = floatPos(side, slot, k: live.count, at: at)
        live.append(now + life)
        floatsLive[key] = live

        let player = isPlayer(slot)
        var fontSize: CGFloat = player ? 52 : 48
        if style == .debuff { fontSize = 38 }
        if style == .blocked { fontSize = 22 }
        let label = ShadowLabelNode(text: style == .blocked ? text.uppercased() : text, fontName: board.textures.boldFont, fontSize: fontSize, color: style.color)
        let container = SKNode()
        var width = label.textWidth
        let height = max(label.textHeight, fontSize)
        if atk {
            let iconSize = fontSize * 0.8
            let icon = battleSprite("hud_fighticon02", size: CGSize(width: iconSize, height: iconSize), cache: board.textures, fallback: BattleColors.attack)
            width += iconSize + fontSize * 0.08
            icon.position = CGPoint(x: -width / 2 + iconSize / 2, y: -fontSize * 0.06)
            label.horizontalAlignmentMode = .left
            label.position = CGPoint(x: -width / 2 + iconSize + fontSize * 0.08, y: 0)
            container.addChild(icon)
        }
        container.addChild(label)
        // keep the text inside the stage at its grown size
        let W = BattleLayout.stageWidth
        let H = layout?.size.height ?? BattleLayout.designHeight
        let halfW = width * BattleFX.floatGrow / 2 + BattleFX.floatMargin
        let halfH = height * BattleFX.floatGrow / 2 + BattleFX.floatMargin / 2
        let x = halfW * 2 >= W ? W / 2 : max(halfW, min(W - halfW, pos.x))
        let y = max(halfH, min(H - halfH, pos.y))
        container.position = BattleLayout.sk(CGPoint(x: x, y: y))
        container.zPosition = 3
        container.alpha = 0
        board.fxLayer.addChild(container)
        container.run(.sequence([
            .wait(forDuration: wait),
            .fadeIn(withDuration: anim * 0.28),
            .wait(forDuration: anim * 0.29),
            .group([.scale(to: 2, duration: anim * 0.43), .fadeOut(withDuration: anim * 0.43)]),
            .wait(forDuration: 0.08),
            .removeFromParent(),
        ]))
    }

    /// Three arrows rising (or sinking) over a card centred at `c`.
    func buffArrows(_ c: CGPoint, _ name: String, up: Bool) {
        for i in 0..<3 {
            sprite(name, at: CGPoint(x: c.x - 34 + CGFloat(i) * 34, y: c.y + (up ? 20 : -20)), w: 30, h: 36, anim: .rise, dur: 900, delay: Double(i) * 80, rot: up ? 0 : 180)
        }
    }

    enum CardReaction { case shake, flashRed, glowAttack, glowHeal, glowBuff, glowDebuff, glowSphere }

    /// Card reaction classes for `seconds` (`flashCard`).
    func flashCard(_ side: Side, _ slot: Int, _ reactions: [CardReaction], seconds: TimeInterval) {
        guard let c = card(side, slot) else { return }
        for r in reactions {
            switch r {
            case .shake: c.shake()
            case .flashRed: c.flashRed()
            case .glowAttack: c.glow(.attack, seconds: seconds)
            case .glowHeal: c.glow(.heal, seconds: seconds)
            case .glowBuff: c.glow(.buff, seconds: seconds)
            case .glowDebuff: c.glow(.debuff, seconds: seconds)
            case .glowSphere: c.glow(.sphere, seconds: seconds)
            }
        }
    }

    func flashBar(_ side: Side) {
        board?.playerBar(side)?.hitFlash(seconds: scaled(600))
    }

    /// Impact burst of a plain attack hit on a card.
    func hitBurst(_ c: CGPoint) {
        sprite("attack_explosion", at: c, w: 270, h: 280, anim: .burst, dur: 520)
        sprite("hud_explosion01", at: c, w: 230, anim: .pop, dur: 420, rot: pick([0, 25, 50, 75]))
        sprite("impact_wave", at: CGPoint(x: c.x, y: c.y + 72), w: 200, h: 70, anim: .ring, dur: 520)
        sprite("hud_explosion02", at: c, w: 230, anim: .rise, dur: 650, delay: 60)
    }

    /// A hit on a player: a red glowing strip across the whole HP bar with red sparks rising from it.
    func playerBurst(_ side: Side) {
        guard let board = board else { return }
        let c = barTroughCenter(side)
        let w = (layout?.playerBar(for: side).troughSize.width ?? 540) + 60
        let strip = SKShapeNode(rectOf: CGSize(width: w, height: 96), cornerRadius: 48)
        strip.fillColor = BattleColors.hex(0xff3c32, alpha: 0.6)
        strip.strokeColor = BattleColors.hex(0xff5a50, alpha: 0.55)
        strip.lineWidth = 3
        strip.glowWidth = 14
        strip.blendMode = .add
        strip.position = BattleLayout.sk(c)
        strip.alpha = 0
        strip.yScale = 0.5
        board.fxLayer.addChild(strip)
        let d = scaled(700)
        strip.run(.sequence([
            .group([.fadeIn(withDuration: d * 0.15), .scaleY(to: 1, duration: d * 0.15)]),
            .fadeAlpha(to: 0.9, duration: d * 0.45),
            .group([.fadeOut(withDuration: d * 0.4), .scaleY(to: 1.05, duration: d * 0.4)]),
            .wait(forDuration: 0.06),
            .removeFromParent(),
        ]))
        sprite("sparks", at: CGPoint(x: c.x + 120, y: c.y + 10), w: 240, h: 200, anim: .rise, dur: 800, tint: BattleColors.hex(0xff4a30))
    }

    /// Death: the card shatters into two dark halves flying apart with golden sparks (~1 s); the card itself is
    /// hidden at once. Returns false when the card cannot be rendered (no view): the caller dissolves it instead.
    func shatter(_ side: Side, _ slot: Int, seconds: TimeInterval) -> Bool {
        guard let board = board, let c = card(side, slot), let view = board.skView, c.parent != nil, !c.body.isHidden else { return false }
        // SKView is a UIView (main-actor isolated); SKAction blocks run on the main thread, so the hop is safe
        let body = c.body
        guard let tex = MainActor.assumeIsolated({ view.texture(from: body) }) else { return false }
        let size = BattleCardNode.size
        let hw = size.width / 2
        let hh = size.height / 2
        let cut = hh - 0.38 * size.height
        let center = BattleLayout.sk(layout?.cardCenter(side: side, slot: slot) ?? CGPoint(x: 360, y: 640))
        let deg = CGFloat.pi / 180
        let halves: [(points: [CGPoint], near: CGPoint, far: CGPoint, nearRot: CGFloat, farRot: CGFloat)] = [
            ([CGPoint(x: -hw, y: hh), CGPoint(x: hw, y: hh), CGPoint(x: hw, y: cut), CGPoint(x: -hw, y: -cut)], CGPoint(x: -4, y: 6), CGPoint(x: -46, y: 70), 3 * deg, 16 * deg),
            ([CGPoint(x: -hw, y: -cut), CGPoint(x: hw, y: cut), CGPoint(x: hw, y: -hh), CGPoint(x: -hw, y: -hh)], CGPoint(x: 4, y: -6), CGPoint(x: 46, y: -70), -3 * deg, -14 * deg),
        ]
        for h in halves {
            let path = CGMutablePath()
            path.addLines(between: h.points)
            path.closeSubpath()
            let mask = SKShapeNode(path: path)
            mask.fillColor = .white
            mask.strokeColor = .clear
            let crop = SKCropNode()
            crop.maskNode = mask
            let piece = SKSpriteNode(texture: tex, size: size)
            piece.color = .black
            piece.colorBlendFactor = 0.72
            crop.addChild(piece)
            crop.position = center
            crop.zPosition = 1
            board.fxLayer.addChild(crop)
            let first = SKAction.group([.move(to: CGPoint(x: center.x + h.near.x, y: center.y + h.near.y), duration: seconds * 0.25), .rotate(toAngle: h.nearRot, duration: seconds * 0.25)])
            let second = SKAction.group([
                .move(to: CGPoint(x: center.x + h.far.x, y: center.y + h.far.y), duration: seconds * 0.75),
                .rotate(toAngle: h.farRot, duration: seconds * 0.75),
                .fadeOut(withDuration: seconds * 0.75),
            ])
            second.timingMode = .easeOut
            crop.run(.sequence([first, second, .wait(forDuration: 0.06), .removeFromParent()]))
        }
        c.hideForShatter()
        return true
    }

    /// "TRIBE BONUS" crossfading over the HP number (`.fx-bonus-text`), `seconds` = the step duration.
    func bonusText(at c: CGPoint, seconds: TimeInterval) {
        guard let board = board else { return }
        let label = ShadowLabelNode(text: "TRIBE BONUS", fontName: board.textures.boldFont, fontSize: 30, color: .white)
        label.position = BattleLayout.sk(c)
        label.zPosition = 3
        label.alpha = 0
        board.fxLayer.addChild(label)
        let d = seconds
        label.run(.sequence([
            .fadeAlpha(to: 0.95, duration: d * 0.2), .fadeAlpha(to: 0.35, duration: d * 0.25),
            .fadeAlpha(to: 0.9, duration: d * 0.25), .fadeAlpha(to: 0, duration: d * 0.3),
            .wait(forDuration: 0.06), .removeFromParent(),
        ]))
    }

    /// The glowing tribe emblem in a side's frame (`.fx-tribe-icon`, fxHold over `seconds`).
    func tribeIcon(at c: CGPoint, tribe: Tribe, seconds: TimeInterval) {
        guard let board = board else { return }
        let container = SKNode()
        container.position = BattleLayout.sk(c)
        container.zPosition = 2
        let glow = battleSprite("white_glow", size: CGSize(width: 130, height: 130), cache: board.textures, fallback: BattleColors.bonusGold.withAlphaComponent(0.5))
        if let s = glow as? SKSpriteNode { s.blendMode = .add; s.color = BattleColors.hex(0xffd64a); s.colorBlendFactor = 1 }
        glow.alpha = 0.8
        container.addChild(glow)
        let icon = battleSprite(BattleSprites.tribeEmblem(tribe), size: CGSize(width: 72, height: 72), cache: board.textures, fallback: BattleColors.tribe(tribe))
        icon.zPosition = 1
        container.addChild(icon)
        FxAnim.hold.prepare(container)
        container.run(.sequence([FxAnim.hold.action(seconds: seconds), .wait(forDuration: 0.06), .removeFromParent()]))
        board.fxLayer.addChild(container)
    }

    /// The finale's white starburst (battle-player.js `playFinale`).
    func starburst(at c: CGPoint) {
        sprite("invulnerable_effec_04", at: c, w: 640, anim: .flash, dur: 500)
        sprite("white_glow", at: c, w: 560, h: 540, anim: .flash, dur: 420)
    }

    /// Remove every effect at once (skip, finale, teardown).
    func clear() {
        board?.fxLayer.removeAllChildren()
        floatsLive.removeAll()
    }
}
