import Foundation
import CoreGraphics
import EvokerCore

/// Board geometry of the battle scene (port of the numbers of `css/screens/battle.css` and the geometry helpers of
/// `src/ui/battle/fx.js`). Everything is expressed in the web's **stage space**: 720 units wide, y growing
/// downwards from the top-left corner, the original 720 × 1280 design centred inside the safe area of the device
/// (comp_fight_layout placed everything relative to the screen centre: enemy row above, own row below, bands and
/// portraits at ∓180…210 client units, 65 units = 146 px between slots). `BattleLayout.sk(_:)` flips a stage point
/// into the scene's world node, which is anchored at the top-left corner with y pointing up (SpriteKit).
struct BattleLayout {
    // MARK: constants (stage px)

    static let stageWidth: CGFloat = 720
    static let designHeight: CGFloat = 1280
    /// Stage px per client unit (720 / 320).
    static let clientUnit: CGFloat = 2.25
    static let cardSize = CGSize(width: 116, height: 164)
    /// The thin HP bar outside a battle card (`.battle-slot .card-wrap .card-hpbar`) and its gap to the card.
    static let cardBarSize = CGSize(width: 116, height: 20)
    static let cardBarGap: CGFloat = 5
    static let cardBarCaps: (left: CGFloat, right: CGFloat) = (11, 12)
    /// Slot pitch: 116 px card + 30 px gap (65 client units).
    static let slotPitch: CGFloat = 146
    static let slotCount = 5
    static let slotHeight: CGFloat = 183
    static let bandHeight: CGFloat = 54
    static let playerBarIconSize: CGFloat = 52
    /// The 3-slice trough of a player's HP bar (`.orig-hp .bar.tall`): 548 × 32 with 18 / 20 px caps.
    static let playerTroughSize = CGSize(width: 548, height: 32)
    static let playerTroughCaps: (left: CGFloat, right: CGFloat) = (18, 20)
    static let portraitFrameSize = CGSize(width: 120, height: 122)
    /// The 75 × 75 hole of hud_player01 / hud_player02 inside their frame.
    static let portraitHole = CGRect(x: 23, y: 24, width: 75, height: 75)
    static let helpFrameSize = CGSize(width: 122, height: 122)
    static let skipButtonSize = CGSize(width: 214, height: 76)
    static let speedButtonSize = CGSize(width: 52, height: 38)
    static let loadingStripHeight: CGFloat = 148
    static let lightningSize = CGSize(width: 900, height: 186)
    /// A diagonal shot through an empty edge slot ends this far inside the HP bar's ends (fx.js AIM_BAR_INSET).
    static let aimBarInset: CGFloat = 24
    /// Height of the top / bottom HUD blocks (`.battle-top`, `.battle-bottom`), the distance they slide in from.
    static let hudBlockHeight: CGFloat = 290

    enum Row { case top, bottom }

    // MARK: instance

    /// Logical scene size (720 × height).
    let size: CGSize
    let safeTop: CGFloat
    let safeBottom: CGFloat
    /// The side drawn in the top row (the opponent).
    let top: Side
    /// Where the 1280-tall design's y = 0 sits: the design is centred in the safe area.
    let offsetY: CGFloat

    init(size: CGSize, safeTop: CGFloat = 0, safeBottom: CGFloat = 0, top: Side = .defender) {
        self.size = size
        self.safeTop = safeTop
        self.safeBottom = safeBottom
        self.top = top
        let available = max(0, size.height - safeTop - safeBottom)
        self.offsetY = safeTop + (available - BattleLayout.designHeight) / 2
    }

    /// A design y (of the 1280-tall web stage) in this layout.
    func y(_ designY: CGFloat) -> CGFloat { designY + offsetY }

    /// Stage point → world node coordinates (anchor top-left, y up).
    static func sk(_ p: CGPoint) -> CGPoint { CGPoint(x: p.x, y: -p.y) }

    /// Scale from stage units to view points for a view of this width.
    static func scale(forViewWidth width: CGFloat) -> CGFloat { width / stageWidth }

    var stageCenter: CGPoint { CGPoint(x: 360, y: y(640)) }

    func row(of side: Side) -> Row { side == top ? .top : .bottom }
    func side(of row: Row) -> Side { row == .top ? top : top.other }

    // MARK: top block (ROUND band, name band, portrait)

    var roundBand: CGRect { CGRect(x: 0, y: y(140), width: BattleLayout.stageWidth, height: BattleLayout.bandHeight) }
    var nameBand: CGRect { CGRect(x: 0, y: y(208), width: BattleLayout.stageWidth, height: BattleLayout.bandHeight) }
    var portraitFrame: CGRect { CGRect(x: 14, y: y(140), width: BattleLayout.portraitFrameSize.width, height: BattleLayout.portraitFrameSize.height) }
    /// "ROUND n": right-aligned 60 px inside the band's right edge.
    var roundLabelAnchor: CGPoint { CGPoint(x: 660, y: roundBand.midY) }
    /// The opponent's name: left-aligned at 150 px, 20 px of right margin.
    var oppNameAnchor: CGPoint { CGPoint(x: 150, y: nameBand.midY) }
    var oppNameMaxWidth: CGFloat { 720 - 150 - 20 }

    // MARK: bottom block (player band, help frame, controls)

    var playerBand: CGRect { CGRect(x: 0, y: y(1018), width: BattleLayout.stageWidth, height: BattleLayout.bandHeight) }
    var helpFrame: CGRect { CGRect(x: 720 - 14 - BattleLayout.helpFrameSize.width, y: y(1014), width: BattleLayout.helpFrameSize.width, height: BattleLayout.helpFrameSize.height) }
    /// The player's name: right-aligned 150 px inside the band's right edge.
    var myNameAnchor: CGPoint { CGPoint(x: 570, y: playerBand.midY) }
    var myNameMaxWidth: CGFloat { 570 - 20 }
    var skipButton: CGRect { CGRect(x: 27, y: y(1077), width: BattleLayout.skipButtonSize.width, height: BattleLayout.skipButtonSize.height) }
    var speedButton: CGRect { CGRect(x: 27 + BattleLayout.skipButtonSize.width + 15, y: y(1086), width: BattleLayout.speedButtonSize.width, height: BattleLayout.speedButtonSize.height) }

    // MARK: middle (loading strip, lightning, finale)

    var loadingStrip: CGRect { CGRect(x: 0, y: y(566), width: BattleLayout.stageWidth, height: BattleLayout.loadingStripHeight) }
    var lightningCenter: CGPoint { stageCenter }

    // MARK: rows and slots

    /// Top of a row's slots (`.battle-row.top` 380, `.battle-row.bottom` 715).
    func slotTop(_ row: Row) -> CGFloat { row == .top ? y(380) : y(715) }

    func slotX(_ slot: Int) -> CGFloat { 360 + CGFloat(slot - 2) * BattleLayout.slotPitch }

    /// Centre of the card drawn in a slot: top row = bar (20) + gap (5) + half a card below the slot top; bottom row
    /// = the card first, the wrap bottom-aligned in the 183 px slot.
    func cardCenter(side: Side, slot: Int) -> CGPoint {
        let r = row(of: side)
        let top = slotTop(r)
        let cy: CGFloat = r == .top
            ? top + BattleLayout.cardBarSize.height + BattleLayout.cardBarGap + BattleLayout.cardSize.height / 2
            : top + BattleLayout.slotHeight - BattleLayout.cardBarSize.height - BattleLayout.cardBarGap - BattleLayout.cardSize.height / 2
        return CGPoint(x: slotX(slot), y: cy)
    }

    /// Centre of the empty recess (cardslot01) of a slot.
    func slotRecessCenter(side: Side, slot: Int) -> CGPoint {
        let r = row(of: side)
        let top = slotTop(r)
        let cy: CGFloat = r == .top ? top + 19 + BattleLayout.cardSize.height / 2 : top + BattleLayout.cardSize.height / 2
        return CGPoint(x: slotX(slot), y: cy)
    }

    /// Centre of the thin HP bar of a card (above the card in the top row, below it in the bottom row).
    func cardBarCenter(side: Side, slot: Int) -> CGPoint {
        let c = cardCenter(side: side, slot: slot)
        let dy = BattleLayout.cardSize.height / 2 + BattleLayout.cardBarGap + BattleLayout.cardBarSize.height / 2
        return CGPoint(x: c.x, y: row(of: side) == .top ? c.y - dy : c.y + dy)
    }

    /// The card bar's offset from the card centre in world (SpriteKit) coordinates.
    func cardBarOffset(side: Side) -> CGPoint {
        let dy = BattleLayout.cardSize.height / 2 + BattleLayout.cardBarGap + BattleLayout.cardBarSize.height / 2
        return CGPoint(x: 0, y: row(of: side) == .top ? dy : -dy)
    }

    func rowCenter(side: Side) -> CGPoint { cardCenter(side: side, slot: 2) }

    // MARK: player HP bars

    struct PlayerBar {
        /// Centre of the heart icon.
        let iconCenter: CGPoint
        /// Centre of the 3-slice trough.
        let troughCenter: CGPoint
        let troughSize: CGSize
        var troughHalfWidth: CGFloat { troughSize.width / 2 }
        /// The fill spans the trough between its caps.
        var fillWidth: CGFloat { troughSize.width - BattleLayout.playerTroughCaps.left - BattleLayout.playerTroughCaps.right }
        /// Left x of the fill relative to the trough centre.
        var fillLeft: CGFloat { -troughHalfWidth + BattleLayout.playerTroughCaps.left }
    }

    /// `.battle-hp-row.opp` at 299, `.battle-hp-row.me` at 929 (72 px side margins): the icon 52 × 52 on the left
    /// overlapping the trough by 24 px, the trough vertically centred on the icon.
    func playerBar(for side: Side) -> PlayerBar {
        let rowTop = row(of: side) == .top ? y(299) : y(929)
        let iconCenter = CGPoint(x: 72 + BattleLayout.playerBarIconSize / 2, y: rowTop + BattleLayout.playerBarIconSize / 2)
        let troughLeft: CGFloat = 72 + BattleLayout.playerBarIconSize - 24
        let troughCenter = CGPoint(x: troughLeft + BattleLayout.playerTroughSize.width / 2, y: rowTop + BattleLayout.playerBarIconSize / 2)
        return PlayerBar(iconCenter: iconCenter, troughCenter: troughCenter, troughSize: BattleLayout.playerTroughSize)
    }

    /// Centre of the frame the tribe-bonus emblem glows in: the portrait frame for the top side, the "?" frame for
    /// the bottom side (battle.js `frames`).
    func frameCenter(for side: Side) -> CGPoint {
        row(of: side) == .top ? CGPoint(x: portraitFrame.midX, y: portraitFrame.midY) : CGPoint(x: helpFrame.midX, y: helpFrame.midY)
    }

    // MARK: fx geometry (fx.js)

    /// Centre of a card, or of its slot once the card has left the board (the slots never move), or of the
    /// player's HP bar for a player target (slot nil).
    func targetCenter(side: Side, slot: Int?) -> CGPoint {
        guard let s = slot, s >= 0, s < BattleLayout.slotCount else { return playerBar(for: side).troughCenter }
        return cardCenter(side: side, slot: s)
    }

    /// Column offset of an attack direction for the attacker's row (the defender's row is mirrored).
    private static func directionColumn(_ dir: String?) -> Int? {
        switch dir {
        case "front": return 0
        case "frontLeft": return -1
        case "frontRight": return 1
        default: return nil
        }
    }

    /// Where an attack projectile flies (fx.js `aimPoint`). A hit on a card goes to that card. A hit on the player
    /// through an empty slot keeps the direction of the card's arrow: it passes over the empty slot and carries on
    /// to the height of the player's HP bar, clamped to the bar's ends.
    func aimPoint(side: Side, slot: Int, target: AttackTarget) -> CGPoint {
        guard target.slot == nil, let column = BattleLayout.directionColumn(target.dir) else {
            return targetCenter(side: target.side, slot: target.slot)
        }
        let col = slot + (side == .attacker ? column : -column)
        guard col >= 0, col < BattleLayout.slotCount else { return targetCenter(side: target.side, slot: nil) }
        let from = targetCenter(side: side, slot: slot)
        let via = cardCenter(side: target.side, slot: col)
        let bar = playerBar(for: target.side)
        let dy = via.y - from.y
        let k: CGFloat = dy != 0 ? max(1, (bar.troughCenter.y - from.y) / dy) : 1
        var end = CGPoint(x: from.x + (via.x - from.x) * k, y: from.y + dy * k)
        let half = bar.troughHalfWidth - BattleLayout.aimBarInset
        if half > 0 { end.x = max(bar.troughCenter.x - half, min(bar.troughCenter.x + half, end.x)) }
        return end
    }
}
