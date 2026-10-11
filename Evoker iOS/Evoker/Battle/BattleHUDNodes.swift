import Foundation
import UIKit
import SpriteKit
import EvokerCore

// MARK: - Shared helpers of the battle nodes

/// Texture lookup of the battle scene: every sprite comes from the asset catalog (`SKTexture.sprite(_:assets:)`
/// of the asset package), cached per fight; a missing sprite yields nil and the nodes draw a plain shape instead
/// so the scene never crashes on a renamed file.
final class BattleTextureCache {
    let assets: AssetCatalog
    private var textures: [String: SKTexture] = [:]
    private var missing = Set<String>()

    init(assets: AssetCatalog) {
        self.assets = assets
    }

    /// A UI sprite by stem ("hud_healthicon01"), or nil when the catalog does not have it.
    func texture(_ name: String) -> SKTexture? {
        if let t = textures[name] { return t }
        if missing.contains(name) { return nil }
        if let t = SKTexture.sprite(name, assets: assets) {
            textures[name] = t
            return t
        }
        missing.insert(name)
        return nil
    }

    /// The stage art of a card (the catalog falls back to the base art, then to its placeholder).
    func cardArt(_ def: CardDef, stage: Int) -> SKTexture {
        let key = "card:\(def.id):\(stage)"
        if let t = textures[key] { return t }
        let t = SKTexture(image: assets.cardArt(def, stage: stage))
        textures[key] = t
        return t
    }

    /// A texture from a UIImage (portraits), cached by key.
    func texture(key: String, image: UIImage) -> SKTexture {
        if let t = textures[key] { return t }
        let t = SKTexture(image: image)
        textures[key] = t
        return t
    }

    var boldFont: String { assets.fontName(.bold) }
    var standardFont: String { assets.fontName(.standard) }
}

/// Colours of the battle screen (css/tokens.css, battle-fx.css, cards.css).
enum BattleColors {
    static func hex(_ rgb: UInt32, alpha: CGFloat = 1) -> UIColor {
        UIColor(red: CGFloat((rgb >> 16) & 0xff) / 255, green: CGFloat((rgb >> 8) & 0xff) / 255, blue: CGFloat(rgb & 0xff) / 255, alpha: alpha)
    }

    static let text = UIColor.white
    static let headline = hex(0xe5e5e5)
    static let attack = hex(0xff3b30)
    static let hp = hex(0x39b432)
    static let star = hex(0xffd556)
    static let ability = hex(0xff8014)
    static let mana = hex(0x24d8ff)
    static let xpViolet = hex(0xa64ddb)
    static let floatDamage = hex(0xff1f1a)
    static let floatHeal = hex(0x4be03c)
    static let floatBuff = hex(0xffd556)
    static let floatDebuff = hex(0xdcb2ff)
    static let floatBlocked = hex(0xcfe9ff)
    static let bonusGold = hex(0xffe36a)
    static let invulnRing = hex(0xfff3b0)
    static let invulnGlow = hex(0xffde6e)
    static let stone = hex(0x2a2d31)
    static let stoneDark = hex(0x141617)
    static let background = hex(0x1b1d1f)

    static func tribe(_ tribe: Tribe) -> UIColor {
        switch tribe {
        case .dwarf: return hex(0x45c23f)
        case .elf: return hex(0x3b8bff)
        case .orc: return hex(0xff3b30)
        case .neutral: return hex(0xff9f1c)
        }
    }

    /// Rarity text colours (ev_styles).
    static func rarity(_ rarity: Rarity) -> UIColor {
        switch rarity {
        case .common: return hex(0xc8c7c7)
        case .standard: return hex(0xf3f3f3)
        case .uncommon: return hex(0x91dc52)
        case .rare: return hex(0x7ab0f2)
        case .heroic: return hex(0xc059bf)
        case .legendary: return hex(0xfdfab1)
        case .ultimate: return hex(0xff0000)
        }
    }

    /// Player HP number colour (battle-player.js `hpLabelColor`, comp_progress_bar): light grey (229,229,229)
    /// down to 2/3 of the maximum, then blending into red (255,0,20) at 1/6.
    static func hpLabel(ratio: CGFloat) -> UIColor {
        let r = ratio.isFinite ? ratio : 1
        let f = max(0, min(1, (r - 0.5) * 1.5 + 0.5))
        func mix(_ grey: CGFloat, _ red: CGFloat) -> CGFloat { (red + (grey - red) * f).rounded() / 255 }
        return UIColor(red: mix(229, 255), green: mix(229, 0), blue: mix(229, 20), alpha: 1)
    }
}

/// A number as the original fight screens print it: plain digits, no thousands separator (card.js `plainNumber`).
/// The `Int` overload lives in App/Theme.swift (shared with the menus); this is the `Double` one of the engine's values.
func plainNumber(_ n: Double) -> String { n.isFinite ? String(Int(n.rounded())) : "-" }

/// A label with a dark drop shadow (the web's `text-shadow: 0 2px 2px rgba(0,0,0,.8)`).
final class ShadowLabelNode: SKNode {
    private let shadow: SKLabelNode
    private let label: SKLabelNode

    init(text: String, fontName: String, fontSize: CGFloat, color: UIColor, shadowOffset: CGPoint = CGPoint(x: 0, y: -2)) {
        shadow = SKLabelNode(fontNamed: fontName)
        label = SKLabelNode(fontNamed: fontName)
        super.init()
        for l in [shadow, label] {
            l.text = text
            l.fontSize = fontSize
            l.verticalAlignmentMode = .center
            l.horizontalAlignmentMode = .center
        }
        shadow.fontColor = UIColor(white: 0, alpha: 0.8)
        shadow.position = shadowOffset
        shadow.zPosition = -0.1
        label.fontColor = color
        addChild(shadow)
        addChild(label)
    }

    required init?(coder aDecoder: NSCoder) { fatalError("init(coder:) is not supported") }

    var text: String {
        get { label.text ?? "" }
        set { label.text = newValue; shadow.text = newValue }
    }

    var fontSize: CGFloat {
        get { label.fontSize }
        set { label.fontSize = newValue; shadow.fontSize = newValue }
    }

    var fontColor: UIColor {
        get { label.fontColor ?? .white }
        set { label.fontColor = newValue }
    }

    var horizontalAlignmentMode: SKLabelHorizontalAlignmentMode {
        get { label.horizontalAlignmentMode }
        set { label.horizontalAlignmentMode = newValue; shadow.horizontalAlignmentMode = newValue }
    }

    var verticalAlignmentMode: SKLabelVerticalAlignmentMode {
        get { label.verticalAlignmentMode }
        set { label.verticalAlignmentMode = newValue; shadow.verticalAlignmentMode = newValue }
    }

    /// Width of the rendered text (stage units).
    var textWidth: CGFloat { label.frame.width }
    var textHeight: CGFloat { label.frame.height }

    /// Shrink the font until the text fits `maxWidth`.
    func fit(maxWidth: CGFloat, minSize: CGFloat = 14) {
        while textWidth > maxWidth && fontSize > minSize { fontSize -= 1 }
    }
}

/// A sprite from the cache, or a flat shape of the given colour when the sprite is missing.
func battleSprite(_ name: String, size: CGSize, cache: BattleTextureCache, fallback: UIColor = UIColor(white: 1, alpha: 0.5)) -> SKNode {
    if let t = cache.texture(name) {
        let s = SKSpriteNode(texture: t, size: size)
        return s
    }
    let shape = SKShapeNode(rectOf: size, cornerRadius: min(size.width, size.height) * 0.2)
    shape.fillColor = fallback
    shape.strokeColor = .clear
    return shape
}

// MARK: - Player HP bar (battle.js origHpBar + bars.js hpBar on the original sprites)

/// A player's HP bar: hud_healthicon01 heart, the 3-slice trough (hud_progressbar_3slice left / 02 / right), the
/// green line (hud_progressbarred02) and "cur / max" in plain digits; the number blends from grey to red as the
/// bar empties and may go below zero (overkill) while the fill stops at empty.
final class PlayerHPBarNode: SKNode {
    let geometry: BattleLayout.PlayerBar
    private let fill: SKSpriteNode
    private let label: ShadowLabelNode
    private let trough = SKNode()
    private(set) var hp: Int = 0
    private(set) var maxHp: Int = 1

    init(geometry: BattleLayout.PlayerBar, cache: BattleTextureCache) {
        self.geometry = geometry
        let caps = BattleLayout.playerTroughCaps
        let troughSize = geometry.troughSize
        // trough: left cap, stretched middle, right cap (centred on this node)
        let left = battleSprite("hud_progressbar_3sliceleft", size: CGSize(width: caps.left, height: troughSize.height), cache: cache, fallback: BattleColors.stoneDark)
        left.position = CGPoint(x: -troughSize.width / 2 + caps.left / 2, y: 0)
        let middleWidth = troughSize.width - caps.left - caps.right
        let middle = battleSprite("hud_progressbar_3slice02", size: CGSize(width: middleWidth, height: troughSize.height), cache: cache, fallback: BattleColors.stoneDark)
        middle.position = CGPoint(x: -troughSize.width / 2 + caps.left + middleWidth / 2, y: 0)
        let right = battleSprite("hud_progressbar_3sliceright", size: CGSize(width: caps.right, height: troughSize.height), cache: cache, fallback: BattleColors.stoneDark)
        right.position = CGPoint(x: troughSize.width / 2 - caps.right / 2, y: 0)
        // the green line 6 px tall, 5 px above the trough's bottom, anchored at its left end
        let line: SKSpriteNode
        if let t = cache.texture("hud_progressbarred02") {
            line = SKSpriteNode(texture: t, size: CGSize(width: geometry.fillWidth, height: 6))
        } else {
            line = SKSpriteNode(color: BattleColors.hp, size: CGSize(width: geometry.fillWidth, height: 6))
        }
        line.anchorPoint = CGPoint(x: 0, y: 0.5)
        line.position = CGPoint(x: geometry.fillLeft, y: -troughSize.height / 2 + 5 + 3)
        fill = line
        let text = ShadowLabelNode(text: "", fontName: cache.boldFont, fontSize: 24, color: BattleColors.headline)
        text.position = CGPoint(x: 0, y: 1)
        label = text
        super.init()
        position = BattleLayout.sk(geometry.troughCenter)
        // the heart icon on the left, overlapping the trough
        let icon = battleSprite("hud_healthicon01", size: CGSize(width: BattleLayout.playerBarIconSize, height: BattleLayout.playerBarIconSize), cache: cache, fallback: BattleColors.hp)
        icon.position = CGPoint(x: geometry.iconCenter.x - geometry.troughCenter.x, y: 0)
        icon.zPosition = 3
        // a soft drop shadow under the trough
        let shadow = SKSpriteNode(color: UIColor(white: 0, alpha: 0.5), size: CGSize(width: troughSize.width, height: troughSize.height))
        shadow.position = CGPoint(x: 0, y: -3)
        shadow.zPosition = -1
        trough.addChild(shadow)
        trough.addChild(left)
        trough.addChild(middle)
        trough.addChild(right)
        fill.zPosition = 1
        trough.addChild(fill)
        label.zPosition = 2
        trough.addChild(label)
        addChild(trough)
        addChild(icon)
    }

    required init?(coder aDecoder: NSCoder) { fatalError("init(coder:) is not supported") }

    /// Show `hp / maxHp` (battle-player.js `setPlayerBar`): the fill stops at empty, the number may go negative.
    func set(hp: Int, maxHp: Int) {
        self.hp = hp
        self.maxHp = maxHp
        let m = maxHp > 0 ? maxHp : max(1, hp)
        let ratio = max(0, min(1, CGFloat(max(0, hp)) / CGFloat(m)))
        fill.size = CGSize(width: max(0.001, geometry.fillWidth * ratio), height: fill.size.height)
        label.text = "\(plainNumber(hp)) / \(plainNumber(maxHp))"
        label.fontColor = BattleColors.hpLabel(ratio: maxHp > 0 ? CGFloat(max(0, hp)) / CGFloat(maxHp) : 1)
    }

    /// The bar brightens red for a moment (`.hp-bar-wrap.hit`).
    func hitFlash(seconds: TimeInterval) {
        trough.removeAction(forKey: "hit")
        let overlay = SKSpriteNode(color: BattleColors.hex(0xff3c2a), size: CGSize(width: geometry.troughSize.width + 8, height: geometry.troughSize.height + 8))
        overlay.alpha = 0.5
        overlay.blendMode = .add
        overlay.zPosition = 1.5
        trough.addChild(overlay)
        overlay.run(.sequence([.fadeOut(withDuration: seconds), .removeFromParent()]))
    }

    /// The number crossfades with "TRIBE BONUS" (`.hp-bar-wrap.bonus .bar-label`, 1.3 s).
    func setBonusPulse(_ on: Bool, seconds: TimeInterval) {
        label.removeAction(forKey: "bonus")
        guard on else { label.alpha = 1; return }
        let s = seconds / 1.3
        label.run(.sequence([
            .fadeAlpha(to: 0.25, duration: 0.26 * s), .fadeAlpha(to: 1, duration: 0.325 * s),
            .fadeAlpha(to: 0.35, duration: 0.325 * s), .fadeAlpha(to: 1, duration: 0.39 * s),
        ]), withKey: "bonus")
    }

    /// Entry: the bar grows from its centre (comp_fight_v3 fadeInHud, `hudInBar`).
    func growIn(seconds: TimeInterval) {
        setScale(0.001)
        let a = SKAction.scale(to: 1, duration: seconds)
        a.timingMode = .easeOut
        run(a)
    }
}

// MARK: - Carved stone bands, portrait frames

/// A `seperator_big` band across the stage (`.battle-band`), with a soft drop shadow.
final class BandNode: SKNode {
    init(frame: CGRect, cache: BattleTextureCache) {
        super.init()
        position = BattleLayout.sk(CGPoint(x: frame.midX, y: frame.midY))
        let shadow = SKSpriteNode(color: UIColor(white: 0, alpha: 0.45), size: CGSize(width: frame.width, height: frame.height))
        shadow.position = CGPoint(x: 0, y: -4)
        shadow.zPosition = -1
        addChild(shadow)
        if let t = cache.texture("seperator_big") {
            addChild(SKSpriteNode(texture: t, size: frame.size))
        } else {
            let stone = SKSpriteNode(color: BattleColors.stone, size: frame.size)
            addChild(stone)
            let hi = SKSpriteNode(color: UIColor(white: 1, alpha: 0.14), size: CGSize(width: frame.width, height: 2))
            hi.position = CGPoint(x: 0, y: frame.height / 2 - 1)
            addChild(hi)
            let lo = SKSpriteNode(color: UIColor(white: 0, alpha: 0.6), size: CGSize(width: frame.width, height: 2))
            lo.position = CGPoint(x: 0, y: -frame.height / 2 + 1)
            addChild(lo)
        }
    }

    required init?(coder aDecoder: NSCoder) { fatalError("init(coder:) is not supported") }
}

/// The opponent's portrait in the hud_player01 frame (`.battle-portrait`): hud_player01.png is a 342 × 200 sheet
/// whose frame sits at (205, 78) with a 75 × 75 hole at (23, 24) inside the frame; the asset pipeline may also
/// ship the frame already cut (120 × 122), both are handled.
final class PortraitFrameNode: SKNode {
    init(frame: CGRect, portrait: UIImage?, cache: BattleTextureCache) {
        super.init()
        position = BattleLayout.sk(CGPoint(x: frame.midX, y: frame.midY))
        let hole = BattleLayout.portraitHole
        let holeCenter = CGPoint(x: hole.midX - frame.width / 2, y: -(hole.midY - frame.height / 2))
        // the picture, clipped to the hole
        let crop = SKCropNode()
        let mask = SKSpriteNode(color: .white, size: hole.size)
        crop.maskNode = mask
        crop.position = holeCenter
        let back = SKSpriteNode(color: BattleColors.hex(0x0a0b0c), size: hole.size)
        crop.addChild(back)
        if let img = portrait {
            let tex = cache.texture(key: "portrait:\(ObjectIdentifier(img).hashValue)", image: img)
            let ts = tex.size()
            let scale = max(hole.width / max(1, ts.width), hole.height / max(1, ts.height))
            let pic = SKSpriteNode(texture: tex, size: CGSize(width: ts.width * scale, height: ts.height * scale))
            pic.zPosition = 1
            crop.addChild(pic)
        }
        crop.zPosition = 0
        addChild(crop)
        // the frame over it
        if let sheet = cache.texture("hud_player01") {
            let ss = sheet.size()
            if ss.width >= 300 {
                let rect = CGRect(x: 205 / ss.width, y: 1 - (78 + frame.height) / ss.height, width: frame.width / ss.width, height: frame.height / ss.height)
                let cut = SKTexture(rect: rect, in: sheet)
                let f = SKSpriteNode(texture: cut, size: frame.size)
                f.zPosition = 2
                addChild(f)
            } else {
                let f = SKSpriteNode(texture: sheet, size: frame.size)
                f.zPosition = 2
                addChild(f)
            }
        } else {
            let ring = SKShapeNode(rectOf: CGSize(width: hole.width + 10, height: hole.height + 10), cornerRadius: 6)
            ring.strokeColor = BattleColors.stone
            ring.lineWidth = 6
            ring.fillColor = .clear
            ring.position = holeCenter
            ring.zPosition = 2
            addChild(ring)
        }
    }

    required init?(coder aDecoder: NSCoder) { fatalError("init(coder:) is not supported") }
}

/// The hud_player02 frame at the bottom right (`.battle-help-frame`); the "?" button inside it is SwiftUI.
final class HelpFrameNode: SKNode {
    init(frame: CGRect, cache: BattleTextureCache) {
        super.init()
        position = BattleLayout.sk(CGPoint(x: frame.midX, y: frame.midY))
        let hole = BattleLayout.portraitHole
        let holeCenter = CGPoint(x: hole.midX - frame.width / 2, y: -(hole.midY - frame.height / 2))
        let back = SKSpriteNode(color: BattleColors.hex(0x0a0b0c), size: hole.size)
        back.position = holeCenter
        addChild(back)
        if let t = cache.texture("hud_player02") {
            let f = SKSpriteNode(texture: t, size: frame.size)
            f.zPosition = 1
            addChild(f)
        } else {
            let ring = SKShapeNode(rectOf: CGSize(width: hole.width + 10, height: hole.height + 10), cornerRadius: 6)
            ring.strokeColor = BattleColors.stone
            ring.lineWidth = 6
            ring.fillColor = .clear
            ring.position = holeCenter
            ring.zPosition = 1
            addChild(ring)
        }
    }

    required init?(coder aDecoder: NSCoder) { fatalError("init(coder:) is not supported") }
}

// MARK: - "ROUND n"

/// "ROUND n" in the title band (battle-player.js `rollRound`): absent before round 1, then the number rolls — the
/// old label slides up and out, the new one in from below.
final class RoundLabelNode: SKNode {
    private let fontName: String
    private let crop = SKCropNode()
    private var current: ShadowLabelNode
    private(set) var shown = false
    private(set) var text: String = "ROUND 1"

    init(anchor: CGPoint, fontName: String) {
        self.fontName = fontName
        current = ShadowLabelNode(text: "ROUND 1", fontName: fontName, fontSize: 34, color: BattleColors.text)
        super.init()
        position = BattleLayout.sk(anchor)
        current.horizontalAlignmentMode = .right
        let mask = SKSpriteNode(color: .white, size: CGSize(width: 320, height: BattleLayout.bandHeight))
        mask.anchorPoint = CGPoint(x: 1, y: 0.5)
        crop.maskNode = mask
        crop.addChild(current)
        addChild(crop)
        isHidden = true
    }

    required init?(coder aDecoder: NSCoder) { fatalError("init(coder:) is not supported") }

    /// Show the label at once (first round, skip).
    func show(_ text: String) {
        self.text = text
        crop.removeAllChildren()
        current = ShadowLabelNode(text: text, fontName: fontName, fontSize: 34, color: BattleColors.text)
        current.horizontalAlignmentMode = .right
        crop.addChild(current)
        shown = true
        isHidden = false
        alpha = 1
    }

    /// Roll to a new text over `seconds` (the first call shows it without a roll).
    func roll(to newText: String, seconds: TimeInterval) {
        guard shown else { show(newText); return }
        text = newText
        let old = current
        let incoming = ShadowLabelNode(text: newText, fontName: fontName, fontSize: 34, color: BattleColors.text)
        incoming.horizontalAlignmentMode = .right
        let h: CGFloat = 34 * 1.25
        incoming.position = CGPoint(x: 0, y: -h)
        incoming.alpha = 0
        crop.addChild(incoming)
        current = incoming
        let up = SKAction.moveBy(x: 0, y: h, duration: seconds)
        up.timingMode = .easeOut
        old.run(.sequence([.group([up, .fadeOut(withDuration: seconds)]), .removeFromParent()]))
        let inUp = SKAction.moveBy(x: 0, y: h, duration: seconds)
        inUp.timingMode = .easeOut
        incoming.run(.group([inUp, .fadeIn(withDuration: seconds)]))
    }

    /// Fades out when the fight ends (`.battle-round.fading`, 250 ms).
    func fadeAway() {
        run(.fadeOut(withDuration: 0.25))
    }
}

// MARK: - "Loading..." strip and the lightning (battle.js entry)

/// comp_server_wait: a black band over the middle with the spinning loading.png pentagram and "Loading...".
final class LoadingStripNode: SKNode {
    init(frame: CGRect, cache: BattleTextureCache) {
        super.init()
        position = BattleLayout.sk(CGPoint(x: frame.midX, y: frame.midY))
        let band = SKSpriteNode(color: UIColor(white: 0, alpha: 0.75), size: frame.size)
        addChild(band)
        let spinner = battleSprite("loading", size: CGSize(width: 86, height: 86), cache: cache, fallback: BattleColors.hex(0xb478ff, alpha: 0.8))
        spinner.position = CGPoint(x: 0, y: 18)
        spinner.zPosition = 1
        spinner.run(.repeatForever(.rotate(byAngle: -2 * .pi, duration: 5)))
        addChild(spinner)
        let label = ShadowLabelNode(text: "Loading...", fontName: cache.boldFont, fontSize: 27, color: BattleColors.headline)
        label.position = CGPoint(x: 0, y: -44)
        label.zPosition = 1
        label.alpha = 0
        label.run(.fadeIn(withDuration: 1))
        addChild(label)
        // loadingIn: the band opens as a line, then to full height
        xScale = 0.001
        yScale = 0.001
        let a = SKAction.sequence([.scaleY(to: 1, duration: 0.2), .scaleX(to: 1, duration: 0.3)])
        a.timingMode = .easeOut
        run(a)
    }

    required init?(coder aDecoder: NSCoder) { fatalError("init(coder:) is not supported") }

    /// `.battle-loading.closing`: fade out and go.
    func close() {
        run(.sequence([.fadeOut(withDuration: 0.2), .removeFromParent()]))
    }
}

/// fx_lightning: lightining.png stepping its height every 80 ms, blended screen.
final class LightningNode: SKNode {
    init(center: CGPoint, cache: BattleTextureCache, seconds: TimeInterval) {
        super.init()
        position = BattleLayout.sk(center)
        let bolt: SKNode
        if let t = cache.texture("lightining") {
            let s = SKSpriteNode(texture: t, size: BattleLayout.lightningSize)
            s.blendMode = .screen
            bolt = s
        } else {
            let s = SKSpriteNode(color: UIColor(white: 1, alpha: 0.85), size: CGSize(width: BattleLayout.lightningSize.width, height: 6))
            s.blendMode = .add
            bolt = s
        }
        addChild(bolt)
        let steps: [CGFloat] = [0.25, 0.5, 1, 0.5, 1, 0.5, 0.25, 0.01]
        let dt = seconds / Double(steps.count)
        var seq: [SKAction] = []
        for (i, s) in steps.enumerated() {
            seq.append(.scaleY(to: s, duration: 0))
            if i == steps.count - 1 { seq.append(.fadeOut(withDuration: 0)) }
            seq.append(.wait(forDuration: dt))
        }
        seq.append(.removeFromParent())
        bolt.run(.sequence(seq))
    }

    required init?(coder aDecoder: NSCoder) { fatalError("init(coder:) is not supported") }
}
