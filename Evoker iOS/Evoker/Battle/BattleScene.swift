import Foundation
import UIKit
import SpriteKit
import EvokerCore

/// The SpriteKit battle board (port of `src/ui/screens/battle.js` minus the result flow): the backdrop, the top
/// bands with the opponent portrait, name and ROUND n, the two HP bars, the two card rows on their recesses, the
/// bottom band with the player's name and the "?" frame, the entry sequence (bands slide in, bars grow, cards
/// fade in, "Loading..." strip, lightning) and the `BattlePlayer` that then plays the event log. Skip fight,
/// the speed button, the "?" button and the result flow are SwiftUI overlays (`BattleScreen`).
///
/// Coordinates: the scene tracks the view (`scaleMode = .resizeFill`); everything lives in `world`, a node
/// anchored at the top-left corner and scaled so that the stage is 720 units wide (`BattleLayout`).
final class BattleScene: SKScene, BattleBoard {
    /// "Loading..." strip after Attack! (ms at 1x); comp_fight_v3 fadeInHud; fx_lightning eight 80 ms steps.
    static let loadingMs = 1500.0
    static let hudInMs = 1000.0
    static let lightningMs = 560.0

    let presentation: BattlePresentation
    let assets: AssetCatalog
    let textures: BattleTextureCache
    private weak var audio: AudioPlaying?
    private let db: CardsDb
    private(set) var layout: BattleLayout
    /// Playback speed (1 or 2); the player reads it live.
    private(set) var playbackSpeed: Double

    let world = SKNode()
    let fxLayer = SKNode()
    private(set) var roundLabel: RoundLabelNode!
    private(set) var player: BattlePlayer?
    private var cards: [Side: [BattleCardNode?]] = [.attacker: [nil, nil, nil, nil, nil], .defender: [nil, nil, nil, nil, nil]]
    private var bars: [Side: PlayerHPBarNode] = [:]
    private let topBlock = SKNode()
    private let bottomBlock = SKNode()
    private let rowsNode = SKNode()
    private var loading: LoadingStripNode?
    private var built = false
    private var started = false
    private var skipRequested = false

    /// Round 1 started: the screen fades "Skip fight" in.
    var onRoundOne: (() -> Void)?
    /// The fight ended (played or skipped): the screen shows the result flow.
    var onFightEnded: ((BoardModel, Bool) -> Void)?

    var skView: SKView? { view }

    init(presentation: BattlePresentation, assets: AssetCatalog, audio: AudioPlaying?, db: CardsDb) {
        self.presentation = presentation
        self.assets = assets
        self.textures = BattleTextureCache(assets: assets)
        self.audio = audio
        self.db = db
        self.playbackSpeed = presentation.speed >= 2 ? 2 : 1
        self.layout = BattleLayout(size: CGSize(width: BattleLayout.stageWidth, height: BattleLayout.designHeight))
        super.init(size: CGSize(width: BattleLayout.stageWidth, height: BattleLayout.designHeight))
        scaleMode = .resizeFill
        backgroundColor = presentation.battleTheme.baseColor
        anchorPoint = CGPoint(x: 0, y: 0)
    }

    required init?(coder aDecoder: NSCoder) { fatalError("init(coder:) is not supported") }

    // MARK: lifecycle

    override func didMove(to view: SKView) {
        super.didMove(to: view)
        applyWorldTransform()
        ensureBuilt()
    }

    override func didChangeSize(_ oldSize: CGSize) {
        super.didChangeSize(oldSize)
        applyWorldTransform()
        ensureBuilt()
    }

    /// Scale the world so the stage is 720 units wide, anchored at the top-left corner.
    private func applyWorldTransform() {
        guard size.width > 0 else { return }
        let s = size.width / BattleLayout.stageWidth
        world.setScale(s)
        world.position = CGPoint(x: 0, y: size.height)
    }

    private func makeLayout() -> BattleLayout {
        let s = max(0.0001, size.width / BattleLayout.stageWidth)
        let logical = CGSize(width: BattleLayout.stageWidth, height: size.height / s)
        // UIView.safeAreaInsets is main-actor isolated; didMove / didChangeSize run on the main thread
        let presentingView = view
        let insets = MainActor.assumeIsolated { presentingView?.safeAreaInsets ?? UIEdgeInsets.zero }
        return BattleLayout(size: logical, safeTop: insets.top / s, safeBottom: insets.bottom / s, top: .defender)
    }

    private func ensureBuilt() {
        guard !built, size.width > 0, size.height > 0, view != nil else { return }
        built = true
        layout = makeLayout()
        buildBoard()
        audio?.music(BattleSounds.music(for: presentation.mode))
        runEntry()
    }

    // MARK: BattleBoard

    func card(_ side: Side, _ slot: Int) -> BattleCardNode? {
        guard slot >= 0, slot < BattleLayout.slotCount else { return nil }
        return cards[side]?[slot]
    }

    func playerBar(_ side: Side) -> PlayerHPBarNode? { bars[side] }

    // MARK: building

    /// The battleStart snapshot, or one derived from the fighter sides when the log has none.
    private func sideSnapshot(_ side: Side) -> SideSnapshot {
        for e in presentation.events {
            if case .battleStart(_, let a, let d) = e { return side == .attacker ? a : d }
        }
        let fighter = side == .attacker ? presentation.attacker : presentation.defender
        let p = fighter.player
        let hp = p.maxHp ?? p.hpMax ?? p.hp ?? 1500
        let snaps: [CardSnapshot?] = fighter.cards.map { (bc: BattleCard?) -> CardSnapshot? in
            guard let c = bc else { return nil }
            let atk = Int((c.attack ?? 0).rounded(.towardZero))
            let maxHp = Int((c.maxHp ?? c.hp ?? 1).rounded(.towardZero))
            return CardSnapshot(instanceId: c.instanceId, cardId: c.cardId, name: c.name, tribe: c.tribe ?? .neutral, rarity: c.rarity, mana: c.mana,
                                stage: c.stage, level: c.level, attack: atk, hp: Int((c.hp ?? c.maxHp ?? 1).rounded(.towardZero)), maxHp: maxHp,
                                abilityValue: c.abilityValue, dirs: c.dirs ?? [], ability: c.ability)
        }
        return SideSnapshot(player: PlayerSnapshot(name: p.name ?? "", portrait: p.portraitIndex, hp: hp, maxHp: hp, baseMaxHp: p.baseMaxHp, tribeBonus: p.tribeBonus ?? false, level: p.level), cards: snaps)
    }

    /// The opponent's picture: `defenderPortrait` as a sprite stem, else as a card id (the avatar card art the
    /// menus draw for a player, the boss card of a quest), then the client's default player icon.
    private func portraitImage() -> UIImage? {
        if let stem = presentation.defenderPortrait {
            if let img = assets.image(stem) { return img }
            if let def = db.get(stem) { return assets.cardArt(def, stage: 0) }
        }
        let n = presentation.defenderAvatar
        for stem in ["avatar_\(n)", "avatar\(n)", "player_icon_\(n)", "default_player"] {
            if let img = assets.image(stem) { return img }
        }
        return nil
    }

    private func buildBoard() {
        addChild(world)
        let L = layout
        let oppSnap = sideSnapshot(.defender)
        let meSnap = sideSnapshot(.attacker)
        let oppName = presentation.defenderName.isEmpty ? (oppSnap.player.name.isEmpty ? "Opponent" : oppSnap.player.name) : presentation.defenderName
        let myName = presentation.attackerName.isEmpty ? (meSnap.player.name.isEmpty ? "You" : meSnap.player.name) : presentation.attackerName

        // ---- backdrop ----
        let backdrop = buildBackdrop()
        backdrop.zPosition = 0
        world.addChild(backdrop)

        // ---- top block: bands, portrait, name, ROUND ----
        topBlock.zPosition = 5
        topBlock.addChild(BandNode(frame: L.roundBand, cache: textures))
        topBlock.addChild(BandNode(frame: L.nameBand, cache: textures))
        let portrait = PortraitFrameNode(frame: L.portraitFrame, portrait: portraitImage(), cache: textures)
        portrait.zPosition = 1
        topBlock.addChild(portrait)
        let oppLabel = ShadowLabelNode(text: oppName, fontName: textures.boldFont, fontSize: 34, color: BattleColors.text)
        oppLabel.horizontalAlignmentMode = .left
        oppLabel.position = BattleLayout.sk(L.oppNameAnchor)
        oppLabel.fit(maxWidth: L.oppNameMaxWidth)
        oppLabel.zPosition = 1
        topBlock.addChild(oppLabel)
        roundLabel = RoundLabelNode(anchor: L.roundLabelAnchor, fontName: textures.boldFont)
        roundLabel.zPosition = 1
        topBlock.addChild(roundLabel)
        world.addChild(topBlock)

        // ---- HP bars ----
        for side in [Side.defender, Side.attacker] {
            let snap = side == .defender ? oppSnap : meSnap
            let bar = PlayerHPBarNode(geometry: L.playerBar(for: side), cache: textures)
            let maxHp = snap.player.maxHp > 0 ? snap.player.maxHp : max(1, snap.player.hp)
            bar.set(hp: snap.player.hp, maxHp: maxHp)
            bar.zPosition = 4
            bars[side] = bar
            world.addChild(bar)
        }

        // ---- rows: recesses and cards ----
        rowsNode.zPosition = 3
        for side in [Side.defender, Side.attacker] {
            let snap = side == .defender ? oppSnap : meSnap
            var list: [BattleCardNode?] = []
            for slot in 0..<BattleLayout.slotCount {
                let recess = battleSprite("cardslot01", size: BattleLayout.cardSize, cache: textures, fallback: UIColor(white: 0, alpha: 0.45))
                recess.alpha = 0.96
                recess.position = BattleLayout.sk(L.slotRecessCenter(side: side, slot: slot))
                rowsNode.addChild(recess)
                let cs = slot < snap.cards.count ? snap.cards[slot] : nil
                guard let c = cs else { list.append(nil); continue }
                let def = c.cardId.flatMap { db.get($0) }
                let node = BattleCardNode(snapshot: c, def: def, side: side, slot: slot, row: L.row(of: side), barOffset: L.cardBarOffset(side: side), cache: textures)
                node.position = BattleLayout.sk(L.cardCenter(side: side, slot: slot))
                node.zPosition = 1
                world.addChild(node)
                list.append(node)
            }
            cards[side] = list
        }
        world.addChild(rowsNode)

        // ---- bottom block: name band, help frame ----
        bottomBlock.zPosition = 5
        bottomBlock.addChild(BandNode(frame: L.playerBand, cache: textures))
        let myLabel = ShadowLabelNode(text: myName, fontName: textures.boldFont, fontSize: 36, color: BattleColors.text)
        myLabel.horizontalAlignmentMode = .right
        myLabel.position = BattleLayout.sk(L.myNameAnchor)
        myLabel.fit(maxWidth: L.myNameMaxWidth)
        myLabel.zPosition = 1
        bottomBlock.addChild(myLabel)
        let help = HelpFrameNode(frame: L.helpFrame, cache: textures)
        help.zPosition = 1
        bottomBlock.addChild(help)
        world.addChild(bottomBlock)

        // ---- effects over everything ----
        fxLayer.zPosition = 20
        world.addChild(fxLayer)
    }

    /// Sky gradient, painted horizon (or the arena painting), dark vignette (`.battle-bg`).
    private func buildBackdrop() -> SKNode {
        let L = layout
        let theme = presentation.battleTheme
        let root = SKNode()
        let H = L.size.height
        let base = SKSpriteNode(color: theme.baseColor, size: CGSize(width: BattleLayout.stageWidth, height: H))
        base.anchorPoint = CGPoint(x: 0, y: 1)
        root.addChild(base)
        if let stem = theme.paintingSprite, let tex = textures.texture(stem) {
            // the arena painting (800 × 1280 at the top centre), scaled to cover the stage
            let ts = tex.size()
            let k = max(BattleLayout.stageWidth / max(1, ts.width), H / max(1, ts.height))
            let painting = SKSpriteNode(texture: tex, size: CGSize(width: ts.width * k, height: ts.height * k))
            painting.anchorPoint = CGPoint(x: 0.5, y: 1)
            painting.position = CGPoint(x: BattleLayout.stageWidth / 2, y: 0)
            painting.zPosition = 0.1
            root.addChild(painting)
        } else {
            let sky = SKSpriteNode(texture: BattleScene.gradientTexture(theme.gradient), size: CGSize(width: BattleLayout.stageWidth, height: H))
            sky.anchorPoint = CGPoint(x: 0, y: 1)
            sky.zPosition = 0.1
            root.addChild(sky)
            if let stem = theme.horizonSprite, let img = assets.image(stem) {
                // the painted horizon strip between the rows (design rows 476..766), aspect fill
                let tex = textures.texture(key: "bg:\(stem)", image: img)
                let stripSize = CGSize(width: BattleLayout.stageWidth, height: 290)
                let crop = SKCropNode()
                crop.maskNode = SKSpriteNode(color: .white, size: stripSize)
                crop.position = BattleLayout.sk(CGPoint(x: 360, y: L.y(476) + 145))
                let ts = tex.size()
                let k = max(stripSize.width / max(1, ts.width), stripSize.height / max(1, ts.height))
                let strip = SKSpriteNode(texture: tex, size: CGSize(width: ts.width * k, height: ts.height * k))
                strip.alpha = theme.horizonAlpha
                crop.addChild(strip)
                crop.zPosition = 0.2
                root.addChild(crop)
            }
        }
        let vignette = SKSpriteNode(texture: BattleScene.gradientTexture([
            (0, UIColor(white: 0, alpha: 0.4)), (0.16, UIColor(white: 0, alpha: 0)), (0.78, UIColor(white: 0, alpha: 0)), (1, UIColor(white: 0, alpha: 0.45)),
        ]), size: CGSize(width: BattleLayout.stageWidth, height: H))
        vignette.anchorPoint = CGPoint(x: 0, y: 1)
        vignette.zPosition = 0.3
        root.addChild(vignette)
        return root
    }

    /// A vertical gradient as a texture (stop fraction from the top → colour).
    private static func gradientTexture(_ stops: [(CGFloat, UIColor)], height: Int = 256) -> SKTexture {
        let size = CGSize(width: 4, height: CGFloat(height))
        let renderer = UIGraphicsImageRenderer(size: size)
        let image = renderer.image { ctx in
            let cg = ctx.cgContext
            let colors = stops.map { $0.1.cgColor } as CFArray
            let locations = stops.map { $0.0 }
            if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: locations) {
                cg.drawLinearGradient(gradient, start: CGPoint(x: 0, y: 0), end: CGPoint(x: 0, y: size.height), options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
            }
        }
        return SKTexture(image: image)
    }

    // MARK: entry (comp_fight_v3 fadeInHud, "Loading...", lightning), then the fight

    /// ms at 1x → seconds at the chosen speed (the screen's `scaled`).
    private func scaled(_ ms: Double) -> TimeInterval { max(1, (ms / playbackSpeed).rounded()) / 1000 }

    private func after(_ seconds: TimeInterval, _ fn: @escaping () -> Void) {
        run(.sequence([.wait(forDuration: max(0.001, seconds)), .run(fn)]))
    }

    private func runEntry() {
        let hudIn = scaled(BattleScene.hudInMs)
        let slide = BattleLayout.hudBlockHeight
        topBlock.position = CGPoint(x: 0, y: slide)
        let downIn = SKAction.move(to: .zero, duration: hudIn)
        downIn.timingMode = .easeOut
        topBlock.run(downIn)
        bottomBlock.position = CGPoint(x: 0, y: -slide)
        let upIn = SKAction.move(to: .zero, duration: hudIn)
        upIn.timingMode = .easeOut
        bottomBlock.run(upIn)
        for (_, bar) in bars { bar.growIn(seconds: hudIn) }
        for (_, list) in cards {
            for node in list.compactMap({ $0 }) {
                node.alpha = 0
                node.run(.fadeIn(withDuration: 0.5))
            }
        }
        let strip = LoadingStripNode(frame: layout.loadingStrip, cache: textures)
        strip.zPosition = 30
        world.addChild(strip)
        loading = strip
        after(scaled(BattleScene.loadingMs)) { [weak self] in
            guard let self = self else { return }
            if self.skipRequested { self.startFight(); return }
            let bolt = LightningNode(center: self.layout.lightningCenter, cache: self.textures, seconds: self.scaled(BattleScene.lightningMs))
            bolt.zPosition = 29
            self.world.addChild(bolt)
            self.audio?.sfx(BattleSounds.lightning)
            self.after(self.scaled(BattleScene.lightningMs * 0.6)) { [weak self] in self?.startFight() }
        }
    }

    private func startFight() {
        guard !started else { return }
        started = true
        loading?.close()
        loading = nil
        if presentation.events.isEmpty {
            roundLabel.show("ROUND -")
            after(0.3) { [weak self] in
                guard let self = self else { return }
                self.onFightEnded?(BoardModel.final(events: []), false)
            }
            return
        }
        let p = BattlePlayer(board: self, events: presentation.events, speed: playbackSpeed, audio: audio)
        p.onRound = { [weak self] n in
            if n == 1 { self?.onRoundOne?() }
        }
        p.onEnd = { [weak self] summary, skipped in
            guard let self = self else { return }
            let won = summary.winner == .attacker
            self.audio?.sfx(won ? BattleSounds.list(.victory)[0] : BattleSounds.list(.defeat)[0])
            self.roundLabel.fadeAway()
            self.onFightEnded?(summary, skipped)
        }
        player = p
        p.start()
        if skipRequested { p.skip() }
    }

    // MARK: controls

    /// Skip to the result (before the fight starts the request is remembered).
    func skip() {
        if let p = player { p.skip(); return }
        skipRequested = true
    }

    func setSpeed(_ n: Double) {
        playbackSpeed = n >= 2 ? 2 : 1
        player?.setSpeed(playbackSpeed)
    }

    /// Stop everything (screen left).
    func teardown() {
        removeAllActions()
        player?.destroy()
        player = nil
        fxLayer.removeAllChildren()
    }
}
