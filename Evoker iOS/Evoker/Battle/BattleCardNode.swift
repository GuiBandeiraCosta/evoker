import Foundation
import UIKit
import SpriteKit
import EvokerCore

/// A battle card face (port of `renderCard(view, { size: 'battle', side, hpBar: true })` of
/// `src/ui/components/card.js` with the sizes of `css/cards.css`): 116 × 164, the stage art under the tinted
/// rarity frame (cardframe_<rarity>), the stats strip (cardstatsoverlay_small: sword / star over heart / anvil) on
/// the edge away from the enemy, the direction arrows on the edge facing the enemy, the status overlay, and the
/// thin HP bar outside the card. Also hosts the card reactions of `css/battle-fx.css` (shake, red flash, glows,
/// dissolve, revive) and the in-card effect layers of `fx.js` (cardFx, the invulnerable aura).
final class BattleCardNode: SKNode {
    enum StatusIcon { case daze, stun, suspend }
    enum Glow { case attack, heal, buff, debuff, sphere }

    let side: Side
    let slot: Int
    let row: BattleLayout.Row
    let snapshot: CardSnapshot
    let def: CardDef?
    private let cache: BattleTextureCache

    /// The card itself, centred on this node (the aura and the HP bar live outside it).
    let body = SKNode()
    let hpBar: CardHPBarNode
    private let artCrop = SKCropNode()
    private let fxCrop = SKCropNode()
    private let auraBack = SKNode()
    private let auraFront = SKNode()
    private let glowRing: SKShapeNode
    private let statusLayer = SKNode()
    private let redFlash: SKSpriteNode
    private let attackCell: StatCell
    private let levelCell: StatCell
    private let hpCell: StatCell
    private let abilityCell: StatCell

    private(set) var hp: Int
    private(set) var maxHp: Int
    private(set) var attack: Int
    /// True while the card is off the board (dead and detached).
    var isDetached = false

    static let size = BattleLayout.cardSize
    private static let half = CGSize(width: BattleLayout.cardSize.width / 2, height: BattleLayout.cardSize.height / 2)

    init(snapshot: CardSnapshot, def: CardDef?, side: Side, slot: Int, row: BattleLayout.Row, barOffset: CGPoint, cache: BattleTextureCache) {
        self.snapshot = snapshot
        self.def = def
        self.side = side
        self.slot = slot
        self.row = row
        self.cache = cache
        self.hp = snapshot.hp
        self.maxHp = snapshot.maxHp
        self.attack = snapshot.attack
        let size = BattleCardNode.size
        let bar = CardHPBarNode(cache: cache)
        bar.position = barOffset
        hpBar = bar
        let ring = SKShapeNode(rectOf: CGSize(width: size.width + 6, height: size.height + 6), cornerRadius: 5)
        ring.fillColor = .clear
        ring.lineWidth = 3
        ring.glowWidth = 10
        ring.isHidden = true
        ring.zPosition = -1
        glowRing = ring
        let flash = SKSpriteNode(color: BattleColors.hex(0xff321e), size: size)
        flash.alpha = 0
        flash.zPosition = 4.5
        redFlash = flash
        let font = cache.boldFont
        attackCell = StatCell(icon: "hud_fighticon02", color: BattleColors.attack, align: .left, fontName: font, cache: cache)
        levelCell = StatCell(icon: "hud_experienceicon01", color: BattleColors.star, align: .right, fontName: font, cache: cache)
        hpCell = StatCell(icon: "hud_healthicon01", color: BattleColors.hp, align: .left, fontName: font, cache: cache)
        abilityCell = StatCell(icon: "hud_specialskill01", color: BattleColors.ability, align: .right, fontName: font, cache: cache)
        super.init()

        let rarity = snapshot.rarity ?? def?.rarity ?? .common
        let tribe = snapshot.tribe

        // --- art (aspect fill, clipped to the card) ---
        let artMask = SKSpriteNode(color: .white, size: size)
        artCrop.maskNode = artMask
        artCrop.zPosition = 0
        let tribeBack = SKSpriteNode(color: BattleColors.tribe(tribe).withAlphaComponent(0.35), size: size)
        artCrop.addChild(tribeBack)
        let dark = SKSpriteNode(color: BattleColors.hex(0x0b0c0d, alpha: 0.6), size: size)
        dark.zPosition = 0.1
        artCrop.addChild(dark)
        if let d = def {
            let tex = cache.cardArt(d, stage: snapshot.stage ?? 0)
            let ts = tex.size()
            let scale = max(size.width / max(1, ts.width), size.height / max(1, ts.height))
            let art = SKSpriteNode(texture: tex, size: CGSize(width: ts.width * scale, height: ts.height * scale))
            art.zPosition = 0.2
            artCrop.addChild(art)
        }
        body.addChild(artCrop)

        // --- in-card effects (clipped) ---
        let fxMask = SKSpriteNode(color: .white, size: size)
        fxCrop.maskNode = fxMask
        fxCrop.zPosition = 2
        body.addChild(fxCrop)

        // --- stats strip on the edge away from the enemy ---
        let strip = SKNode()
        strip.zPosition = 2.5
        let stripName = row == .bottom ? "cardstatsoverlay_small" : "cardstatsoverlay_small_top"
        let stripBack = battleSprite(stripName, size: CGSize(width: size.width, height: 44), cache: cache, fallback: UIColor(white: 0, alpha: 0.62))
        stripBack.position = CGPoint(x: 0, y: row == .bottom ? -BattleCardNode.half.height + 22 : BattleCardNode.half.height - 22)
        strip.addChild(stripBack)
        let row1: CGFloat = row == .bottom ? -53 : 70
        let row2: CGFloat = row == .bottom ? -71 : 52
        attackCell.position = CGPoint(x: -50, y: row1)
        levelCell.position = CGPoint(x: 50, y: row1)
        hpCell.position = CGPoint(x: -50, y: row2)
        abilityCell.position = CGPoint(x: 50, y: row2)
        for c in [attackCell, levelCell, hpCell, abilityCell] { strip.addChild(c) }
        body.addChild(strip)

        // --- the tinted bevel frame over art and strip ---
        let frame = battleSprite(BattleSprites.cardFrame(rarity), size: size, cache: cache, fallback: .clear)
        if frame is SKShapeNode {
            // no frame sprite: a bevel line in the rarity colour
            let ring = SKShapeNode(rectOf: size, cornerRadius: 3)
            ring.strokeColor = BattleColors.rarity(rarity)
            ring.lineWidth = 3
            ring.fillColor = .clear
            ring.zPosition = 4
            body.addChild(ring)
        } else {
            frame.zPosition = 4
            body.addChild(frame)
        }
        body.addChild(redFlash)

        // --- direction arrows ---
        let arrows = SKNode()
        arrows.zPosition = 5
        let stage = snapshot.stage ?? 0
        let healDirs: [CatalogDirection] = def.map { Abilities.healDirs($0.ability, stage: stage) } ?? []
        let effectDirs: [CatalogDirection] = def.map { Abilities.effectDirs($0.ability, stage: stage) } ?? []
        let buffDirs = effectDirs.filter { !healDirs.contains($0) }
        BattleCardNode.buildArrows(into: arrows, dirs: snapshot.dirs, healDirs: healDirs, buffDirs: buffDirs, row: row, cache: cache)
        body.addChild(arrows)

        statusLayer.zPosition = 6
        body.addChild(statusLayer)

        auraBack.zPosition = -2
        auraFront.zPosition = 3
        addChild(auraBack)
        addChild(glowRing)
        addChild(body)
        addChild(auraFront)
        addChild(hpBar)

        // initial numbers
        levelCell.set(snapshot.level.map { plainNumber($0) })
        // the engine reports 0 for cards without an ability value: the original shows no anvil chip at all then
        let hasAbilityValue = (def?.base.ability != nil) || ((snapshot.abilityValue ?? 0) > 0)
        abilityCell.set(hasAbilityValue ? snapshot.abilityValue.map { plainNumber($0) } : nil)
        setHp(hp, maxHp: maxHp, animated: false)
        setAttack(attack)
    }

    required init?(coder aDecoder: NSCoder) { fatalError("init(coder:) is not supported") }

    // MARK: numbers (card.js updateCardHp / updateCardAttack)

    /// HP band value (plain digits, may go below 0) and the outside bar.
    func setHp(_ hp: Int, maxHp: Int, animated: Bool = true) {
        self.hp = hp
        self.maxHp = maxHp
        hpCell.set(plainNumber(hp))
        hpBar.set(ratio: CGFloat(max(0, hp)) / CGFloat(max(1, maxHp)), animated: animated)
    }

    func setAttack(_ attack: Int) {
        self.attack = attack
        attackCell.set(plainNumber(max(0, attack)))
    }

    // MARK: status icons (card.js setCardStatus)

    func setStatus(_ status: StatusIcon?) {
        statusLayer.removeAllChildren()
        guard let s = status else { return }
        if s == .daze || s == .stun {
            let ring = SKShapeNode(circleOfRadius: 26)
            ring.strokeColor = BattleColors.hex(0xff3b30)
            ring.lineWidth = 5
            ring.glowWidth = 3
            ring.fillColor = UIColor(white: 0, alpha: 0.25)
            let slash = SKShapeNode(rect: CGRect(x: -22, y: -3, width: 44, height: 6), cornerRadius: 3)
            slash.fillColor = BattleColors.hex(0xff3b30)
            slash.strokeColor = .clear
            slash.zRotation = .pi / 4
            ring.addChild(slash)
            ring.setScale(0.3)
            ring.alpha = 0
            ring.run(.group([.scale(to: 1, duration: 0.4), .fadeIn(withDuration: 0.4)]))
            statusLayer.addChild(ring)
        }
        if s == .suspend || s == .stun {
            let group = SKNode()
            for r in [26.0, 14.0] {
                let ring = SKShapeNode(circleOfRadius: CGFloat(r))
                ring.strokeColor = BattleColors.hex(0x24d8ff)
                ring.lineWidth = 4
                ring.glowWidth = 2
                ring.fillColor = .clear
                group.addChild(ring)
            }
            let tick = SKShapeNode(rect: CGRect(x: -2, y: 14, width: 4, height: 12), cornerRadius: 2)
            tick.fillColor = BattleColors.hex(0x24d8ff)
            tick.strokeColor = .clear
            group.addChild(tick)
            group.setScale(0.3)
            group.alpha = 0
            group.run(.group([.scale(to: 1, duration: 0.4), .fadeIn(withDuration: 0.4)]))
            group.run(.repeatForever(.rotate(byAngle: -2 * .pi, duration: 2.4)))
            statusLayer.addChild(group)
        }
    }

    // MARK: in-card effects (fx.js cardFx / clearCardFx / invulnAura)

    enum FxAnim { case none, pulse, spin, spinRev }

    /// Overlay a sprite inside the card (clipped). One layer per `key`.
    func addFx(key: String?, name: String, size: CGSize? = nil, anim: FxAnim, tint: UIColor? = nil, alpha: CGFloat = 1, seconds: TimeInterval) {
        if let k = key { fxCrop.children.filter { $0.name == "fx-\(k)" }.forEach { $0.removeFromParent() } }
        let s = size ?? BattleCardNode.size
        let node = battleSprite(name, size: s, cache: cache, fallback: (tint ?? .white).withAlphaComponent(0.4))
        if let sprite = node as? SKSpriteNode {
            if BattleSprites.isAdditive(name) { sprite.blendMode = .add }
            if let t = tint { sprite.color = t; sprite.colorBlendFactor = 1 }
        }
        node.name = key.map { "fx-\($0)" }
        node.alpha = 0
        node.setScale(0.6)
        let inAction = SKAction.group([.fadeAlpha(to: alpha, duration: seconds), .scale(to: 1, duration: seconds)])
        inAction.timingMode = .easeOut
        var loop: SKAction? = nil
        switch anim {
        case .none: break
        case .pulse:
            loop = .repeatForever(.sequence([
                .group([.fadeAlpha(to: alpha * 0.7, duration: 0.8), .scale(to: 0.96, duration: 0.8)]),
                .group([.fadeAlpha(to: alpha, duration: 0.8), .scale(to: 1.03, duration: 0.8)]),
            ]))
        case .spin:
            node.run(.repeatForever(.rotate(byAngle: -2 * .pi, duration: 5)))
        case .spinRev:
            node.run(.repeatForever(.rotate(byAngle: 2 * .pi, duration: 3.5)))
        }
        if let l = loop { node.run(.sequence([inAction, l])) } else { node.run(inAction) }
        fxCrop.addChild(node)
    }

    /// Remove one keyed in-card effect layer (a `ttl` expiring).
    func clearFxLayer(key: String) {
        fxCrop.children.filter { $0.name == "fx-\(key)" }.forEach { $0.removeFromParent() }
    }

    /// Remove every in-card effect, the aura and the invulnerable ring.
    func clearFx() {
        fxCrop.removeAllChildren()
        auraBack.removeAllChildren()
        auraFront.removeAllChildren()
        if glowKind == nil { glowRing.isHidden = true }
        invulnerable = false
    }

    private var invulnerable = false

    /// Invulnerable: a golden glow around the card — the glowingcard halo and newcardglow rays behind it, a golden
    /// wash over the art, parks sparkles twinkling and invulnerable_effec_02 streaks rising over it. Persistent
    /// until the status ends (clearFx).
    func showInvulnAura(seconds: TimeInterval) {
        auraBack.removeAllChildren()
        auraFront.removeAllChildren()
        invulnerable = true
        let size = BattleCardNode.size
        // back: halo + rays
        let halo = battleSprite("glowingcard", size: CGSize(width: size.width + 30, height: size.height + 32), cache: cache, fallback: BattleColors.invulnGlow.withAlphaComponent(0.5))
        halo.alpha = 0
        halo.run(.sequence([.fadeAlpha(to: 0.85, duration: seconds), .repeatForever(.sequence([
            .group([.fadeAlpha(to: 1, duration: 0.7), .scale(to: 1.04, duration: 0.7)]),
            .group([.fadeAlpha(to: 0.85, duration: 0.7), .scale(to: 1, duration: 0.7)]),
        ]))]))
        auraBack.addChild(halo)
        let rays = battleSprite("newcardglow", size: CGSize(width: size.width + 96, height: size.height + 112), cache: cache, fallback: .clear)
        rays.alpha = 0
        rays.zPosition = -0.5
        rays.run(.sequence([.fadeAlpha(to: 0.7, duration: seconds), .repeatForever(.sequence([
            .group([.fadeAlpha(to: 1, duration: 1.1), .scale(to: 1.04, duration: 1.1)]),
            .group([.fadeAlpha(to: 0.7, duration: 1.1), .scale(to: 0.97, duration: 1.1)]),
        ]))]))
        auraBack.addChild(rays)
        // front: sparkles twinkling, streaks rising along the edges
        for (i, s2) in [false, true].enumerated() {
            let sparkles = battleSprite("parks", size: CGSize(width: size.width + 44, height: size.height + 52), cache: cache, fallback: .clear)
            sparkles.alpha = 0
            if let sp = sparkles as? SKSpriteNode { sp.blendMode = .add }
            if s2 { sparkles.zRotation = .pi; sparkles.setScale(0.86) }
            let twinkle = SKAction.sequence([.fadeAlpha(to: 1, duration: 0.48), .fadeAlpha(to: 0.35, duration: 0.48), .fadeAlpha(to: 0, duration: 0.64)])
            let delay = i == 0 ? 0.0 : 0.8
            sparkles.run(.sequence([.wait(forDuration: delay), .repeatForever(twinkle)]))
            auraFront.addChild(sparkles)
        }
        for (i, x) in [-(size.width / 2 + 2), size.width / 2 + 2].enumerated() {
            let streak = battleSprite("invulnerable_effec_02", size: CGSize(width: 44, height: size.height + 12), cache: cache, fallback: .clear)
            if let sp = streak as? SKSpriteNode { sp.blendMode = .add; sp.color = BattleColors.hex(0xfff3c0); sp.colorBlendFactor = 1 }
            streak.zRotation = .pi
            streak.position = CGPoint(x: x, y: -18)
            streak.alpha = 0
            let rise = SKAction.sequence([
                .run { streak.position = CGPoint(x: x, y: -18) },
                .group([.moveBy(x: 0, y: 52, duration: 1.3), .sequence([.fadeAlpha(to: 1, duration: 0.33), .wait(forDuration: 0.64), .fadeAlpha(to: 0, duration: 0.33)])]),
            ])
            streak.run(.sequence([.wait(forDuration: i == 0 ? 0 : 0.65), .repeatForever(rise)]))
            auraFront.addChild(streak)
        }
        // a light golden tint over the art only: the stats strip stays readable
        addFx(key: "invuln", name: "white_glow", anim: .pulse, tint: BattleColors.hex(0xffd75a), alpha: 0.14, seconds: seconds)
        // the card's own ring (`.card.invuln`)
        glowRing.strokeColor = BattleColors.invulnRing
        glowRing.isHidden = false
        auraBack.alpha = 0
        auraFront.alpha = 0
        auraBack.setScale(1.25)
        auraFront.setScale(1.25)
        let inAction = SKAction.group([.fadeIn(withDuration: seconds), .scale(to: 1, duration: seconds)])
        inAction.timingMode = .easeOut
        auraBack.run(inAction)
        auraFront.run(inAction.copy() as! SKAction)
    }

    // MARK: reactions (css/battle-fx.css)

    private var glowKind: Glow? = nil

    /// A coloured glow around the card for `seconds` (`.card.glow-*`).
    func glow(_ kind: Glow, seconds: TimeInterval) {
        glowKind = kind
        switch kind {
        case .attack: glowRing.strokeColor = UIColor(red: 1, green: 0.95, blue: 0.75, alpha: 1)
        case .heal: glowRing.strokeColor = BattleColors.hp
        case .buff: glowRing.strokeColor = BattleColors.star
        case .debuff: glowRing.strokeColor = BattleColors.xpViolet
        case .sphere: glowRing.strokeColor = BattleColors.hex(0xffe27a)
        }
        glowRing.isHidden = false
        glowRing.removeAction(forKey: "glow")
        glowRing.run(.sequence([.wait(forDuration: seconds), .run { [weak self] in
            guard let self = self else { return }
            self.glowKind = nil
            if self.invulnerable { self.glowRing.strokeColor = BattleColors.invulnRing } else { self.glowRing.isHidden = true }
        }]), withKey: "glow")
    }

    /// `cardShake`: ±6 px and ±2° over 0.35 s.
    func shake() {
        body.removeAction(forKey: "shake")
        let d = 0.07
        let seq = SKAction.sequence([
            .group([.moveTo(x: -6, duration: d), .rotate(toAngle: 2 * .pi / 180, duration: d)]),
            .group([.moveTo(x: 6, duration: d), .rotate(toAngle: -2 * .pi / 180, duration: d)]),
            .group([.moveTo(x: -4, duration: d), .rotate(toAngle: 0, duration: d)]),
            .moveTo(x: 4, duration: d),
            .moveTo(x: 0, duration: d),
        ])
        body.run(seq, withKey: "shake")
    }

    /// `.card.flash-red`: a red wash fading over 0.4 s.
    func flashRed(seconds: TimeInterval = 0.4) {
        redFlash.removeAllActions()
        redFlash.alpha = 0.55
        redFlash.run(.fadeOut(withDuration: seconds))
    }

    /// Death without a shatter texture: the card holds, then fades while shrinking and lifting (`dissolve`).
    func dissolve(seconds: TimeInterval) {
        body.removeAction(forKey: "dissolve")
        hpBar.run(.fadeOut(withDuration: 0.6))
        let out = SKAction.group([.fadeOut(withDuration: seconds * 0.55), .scale(to: 0.88, duration: seconds * 0.55), .moveBy(x: 0, y: 16, duration: seconds * 0.55)])
        out.timingMode = .easeIn
        body.run(.sequence([.wait(forDuration: seconds * 0.45), out]), withKey: "dissolve")
    }

    /// Hide the card at once (the shatter halves replace it); the HP bar fades like `.card-wrap.dying`.
    func hideForShatter() {
        body.isHidden = true
        hpBar.run(.fadeOut(withDuration: 0.6))
    }

    /// `reviveGlow`: a bright flash and a white ring settling over 1.2 s.
    func reviveFlash(seconds: TimeInterval = 1.2) {
        let flash = SKSpriteNode(color: .white, size: BattleCardNode.size)
        flash.alpha = 0.85
        flash.zPosition = 4.6
        flash.blendMode = .add
        body.addChild(flash)
        flash.run(.sequence([.fadeOut(withDuration: seconds * 0.5), .removeFromParent()]))
        glowRing.strokeColor = UIColor(red: 1, green: 1, blue: 0.86, alpha: 1)
        glowRing.isHidden = false
        glowRing.removeAction(forKey: "glow")
        glowRing.run(.sequence([.wait(forDuration: seconds), .run { [weak self] in
            guard let self = self, self.glowKind == nil, !self.invulnerable else { return }
            self.glowRing.isHidden = true
        }]), withKey: "glow")
    }

    /// Back to the plain face: no glow, effects, status or reaction (death, revive, skip).
    func resetVisual() {
        body.removeAllActions()
        body.isHidden = false
        body.alpha = 1
        body.setScale(1)
        body.position = .zero
        body.zRotation = 0
        redFlash.removeAllActions()
        redFlash.alpha = 0
        glowRing.removeAllActions()
        glowKind = nil
        glowRing.isHidden = true
        clearFx()
        setStatus(nil)
        hpBar.removeAllActions()
        hpBar.alpha = 1
    }

    // MARK: arrows (card.js arrowsLayer)

    private enum ArrowKind { case attack, heal, buff }

    private static func buildArrows(into layer: SKNode, dirs: [CatalogDirection], healDirs: [CatalogDirection], buffDirs: [CatalogDirection], row: BattleLayout.Row, cache: BattleTextureCache) {
        var seen = Set<String>()
        for d in dirs {
            layer.addChild(arrow(d, kind: .attack, row: row, cache: cache))
            seen.insert(d.rawValue)
        }
        func add(_ list: [CatalogDirection], _ kind: ArrowKind) {
            for d in list {
                let mapped: CatalogDirection = d == .left ? .ownLeft : (d == .right ? .ownRight : d)
                let key = "\(kind):\(mapped.rawValue)"
                guard mapped == .ownLeft || mapped == .ownRight || mapped == .direct else { continue }
                if seen.contains(key) { continue }
                if mapped == .direct && seen.contains("direct") { continue }
                seen.insert(key)
                layer.addChild(arrow(mapped, kind: kind, row: row, cache: cache))
            }
        }
        add(healDirs, .heal)
        add(buffDirs, .buff)
    }

    /// Arrow sprite (20 × 24) placed and rotated like `css/cards.css` (CSS rotates clockwise, SpriteKit
    /// counter-clockwise, so the sign flips).
    private static func arrow(_ dir: CatalogDirection, kind: ArrowKind, row: BattleLayout.Row, cache: BattleTextureCache) -> SKNode {
        let name: String
        let color: UIColor
        switch kind {
        case .attack: name = "card_arrowred01"; color = BattleColors.attack
        case .heal: name = "card_arrow01"; color = BattleColors.hp
        case .buff: name = "card_arrowblue01"; color = BattleColors.hex(0x4aa8ff)
        }
        let node: SKNode
        if let t = cache.texture(name) {
            node = SKSpriteNode(texture: t, size: CGSize(width: 20, height: 24))
        } else {
            let path = CGMutablePath()
            path.move(to: CGPoint(x: 0, y: 12))
            path.addLine(to: CGPoint(x: 10, y: -12))
            path.addLine(to: CGPoint(x: -10, y: -12))
            path.closeSubpath()
            let tri = SKShapeNode(path: path)
            tri.fillColor = color
            tri.strokeColor = .clear
            node = tri
        }
        let deg = CGFloat.pi / 180
        switch (dir, row) {
        case (.direct, .bottom): node.position = CGPoint(x: 0, y: 67); node.zRotation = 0
        case (.left, .bottom): node.position = CGPoint(x: -43, y: 65); node.zRotation = 45 * deg
        case (.right, .bottom): node.position = CGPoint(x: 43, y: 65); node.zRotation = -45 * deg
        case (.direct, .top): node.position = CGPoint(x: 0, y: -67); node.zRotation = .pi
        case (.left, .top): node.position = CGPoint(x: -43, y: -65); node.zRotation = 135 * deg
        case (.right, .top): node.position = CGPoint(x: 43, y: -65); node.zRotation = -135 * deg
        case (.ownLeft, _): node.position = CGPoint(x: -45, y: 0); node.zRotation = 90 * deg
        case (.ownRight, _): node.position = CGPoint(x: 45, y: 0); node.zRotation = -90 * deg
        }
        return node
    }
}

/// One cell of the stats strip: original icon (15 × 15) + number (13 px semibold, 11 px for 5+ characters).
final class StatCell: SKNode {
    enum Align { case left, right }
    private let icon: SKNode
    private let label: SKLabelNode
    private let align: Align

    init(icon name: String, color: UIColor, align: Align, fontName: String, cache: BattleTextureCache) {
        self.align = align
        icon = battleSprite(name, size: CGSize(width: 15, height: 15), cache: cache, fallback: color)
        let text = SKLabelNode(fontNamed: fontName)
        text.fontSize = 13
        text.fontColor = color
        text.verticalAlignmentMode = .center
        text.horizontalAlignmentMode = align == .left ? .left : .right
        label = text
        super.init()
        addChild(icon)
        addChild(label)
        set(nil)
    }

    required init?(coder aDecoder: NSCoder) { fatalError("init(coder:) is not supported") }

    /// nil hides the cell (`.card-stat.empty`).
    func set(_ text: String?) {
        guard let t = text else { isHidden = true; return }
        isHidden = false
        label.text = t
        label.fontSize = t.count >= 5 ? 11 : 13
        switch align {
        case .left:
            icon.position = CGPoint(x: 7.5, y: 0)
            label.position = CGPoint(x: 18, y: 0)
        case .right:
            label.position = CGPoint(x: 0, y: 0)
            icon.position = CGPoint(x: -label.frame.width - 3 - 7.5, y: 0)
        }
    }
}

/// The thin HP bar outside a battle card: the 3-slice trough at 0.6 scale with the short green line
/// (hud_progressbarred01); the fill animates over 0.45 s (`transition: width .45s`).
final class CardHPBarNode: SKNode {
    private let fill: SKSpriteNode
    private let fillWidth: CGFloat
    private let fillLeft: CGFloat

    init(cache: BattleTextureCache) {
        let size = BattleLayout.cardBarSize
        let caps = BattleLayout.cardBarCaps
        let fw = size.width - caps.left - caps.right
        let fl = -size.width / 2 + caps.left
        fillWidth = fw
        fillLeft = fl
        let line: SKSpriteNode
        if let t = cache.texture("hud_progressbarred01") {
            line = SKSpriteNode(texture: t, size: CGSize(width: fw, height: 4))
        } else {
            line = SKSpriteNode(color: BattleColors.hp, size: CGSize(width: fw, height: 4))
        }
        line.anchorPoint = CGPoint(x: 0, y: 0.5)
        line.position = CGPoint(x: fl, y: -size.height / 2 + 4 + 2)
        fill = line
        super.init()
        let left = battleSprite("hud_progressbar_3sliceleft", size: CGSize(width: caps.left, height: size.height), cache: cache, fallback: BattleColors.stoneDark)
        left.position = CGPoint(x: -size.width / 2 + caps.left / 2, y: 0)
        let middle = battleSprite("hud_progressbar_3slice02", size: CGSize(width: fillWidth, height: size.height), cache: cache, fallback: BattleColors.stoneDark)
        middle.position = CGPoint(x: fillLeft + fillWidth / 2, y: 0)
        let right = battleSprite("hud_progressbar_3sliceright", size: CGSize(width: caps.right, height: size.height), cache: cache, fallback: BattleColors.stoneDark)
        right.position = CGPoint(x: size.width / 2 - caps.right / 2, y: 0)
        addChild(left)
        addChild(middle)
        addChild(right)
        fill.zPosition = 1
        addChild(fill)
    }

    required init?(coder aDecoder: NSCoder) { fatalError("init(coder:) is not supported") }

    func set(ratio: CGFloat, animated: Bool) {
        let w = max(0.001, fillWidth * max(0, min(1, ratio)))
        fill.removeAllActions()
        if animated {
            let a = SKAction.resize(toWidth: w, duration: 0.45)
            a.timingMode = .easeOut
            fill.run(a)
        } else {
            fill.size = CGSize(width: w, height: fill.size.height)
        }
    }
}
