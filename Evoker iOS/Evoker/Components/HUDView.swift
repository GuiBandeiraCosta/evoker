import SwiftUI
import EvokerCore

/// Top HUD ported from the 1.7.4 client's status bar (`src/ui/components/hud.js`): the "?" help button (alone on
/// the big menubar plate on the main tabs; next to the back arrow on the narrow backbutton plate on pushed
/// screens), the resource bar (Lvl + star + level, XP line, stamina / mana with their potion counts) that opens
/// the profile, the money bar (gold, gems, the green plus) that opens the gem packs.
struct HUDData {
    var level: Int = 1
    var xp: Int = 0
    var xpToNext: Int = 100
    var stamina: Int = 0
    var staminaMax: Int = 50
    var staminaPotions: Int = 0
    var mana: Int = 0
    var manaMax: Int = 50
    var manaPotions: Int = 0
    var gold: Int = 0
    var gems: Int = 0

    /// `store.js hudData`.
    init(state: GameState, stats: StatsProviding) {
        let p = state.player
        level = p.level
        xp = p.xp
        xpToNext = stats.playerXpToNext(level: p.level) ?? max(1, p.xp)
        stamina = p.stamina
        staminaMax = p.staminaMax
        staminaPotions = p.staminaPotions
        mana = p.mana
        manaMax = p.manaMax
        manaPotions = p.manaPotions
        gold = p.gold
        gems = p.gems
    }

    /// `chrome.js emptyHud`: before any save exists.
    init() {}
}

struct HUDView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.stage) private var stage
    var data: HUDData
    var showBack: Bool
    var onBack: (() -> Void)?
    var onHelp: () -> Void
    var onProfile: () -> Void
    var onShop: () -> Void
    /// Gold shown instead of the save's (the quest screen counts the HUD up with the taps).
    var goldOverride: Int? = nil

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color(hex: 0x1b1d1f)
            StretchedSprite("topbar_bg")
                .frame(height: Stage.hudHeight)
                .frame(maxHeight: .infinity, alignment: .bottom)
            ZStack(alignment: .topLeading) {
                if showBack {
                    Button(action: { model.sfx("ui_button_circular"); onBack?() }) {
                        Sprite("back")
                            .frame(width: 48, height: 62)
                            .shadow(color: .black.opacity(0.7), radius: 1, x: 0, y: 2)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(PressScaleStyle())
                    .at(21, 26, 48, 62)
                    Button(action: { model.sfx("ui_button_circular"); onHelp() }) {
                        ZStack {
                            NineSlice(Theme.Frames.backbutton)
                            Sprite("help_icon_active").frame(width: 40, height: 54).shadow(color: .black.opacity(0.7), radius: 1, x: 0, y: 2)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(PressScaleStyle())
                    .at(81, 6, 72, 106)
                } else {
                    Button(action: { model.sfx("ui_button_circular"); onHelp() }) {
                        ZStack {
                            NineSlice(Theme.Frames.menubarButton)
                            Sprite("help_icon_active").frame(width: 48, height: 65).shadow(color: .black.opacity(0.7), radius: 1, x: 0, y: 2)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(PressScaleStyle())
                    .at(28, 5, 106, 109)
                }
                resourceBar
                    .scaleEffect(1.125, anchor: .topLeading)
                    .at(155, 6, 308, 94)
                moneyBar
                    .scaleEffect(1.125, anchor: .topLeading)
                    .at(505, 6, 190, 94)
            }
            .frame(width: Stage.width, height: Stage.hudHeight, alignment: .topLeading)
            .offset(y: stage.safeTop)
        }
        .frame(width: Stage.width, height: Stage.hudHeight + stage.safeTop)
        .shadow(color: .black.opacity(0.6), radius: 4, x: 0, y: 2)
        .zIndex(10)
    }

    /// resourcebar_frame + fill: "Lvl" + level, the XP line, stamina and mana with their potion counts.
    private var resourceBar: some View {
        Button(action: { model.sfx("ui_button_circular"); onProfile() }) {
            ZStack(alignment: .topLeading) {
                StretchedSprite("resourcebar")
                Text("Lvl").font(Theme.font(17)).foregroundColor(Theme.text).shadow(color: .black.opacity(0.9), radius: 1, x: 0, y: 1)
                    .at(16, 25, 40, 18)
                Text("\(data.level)").font(Theme.num(26)).foregroundColor(Theme.text).shadow(color: .black.opacity(0.9), radius: 1, x: 0, y: 1)
                    .at(86, 12, 60, 26)
                ProgressBarView(value: Double(data.xp), max: Double(data.xpToNext), kind: .xp, style: .line)
                    .at(74, 39, 212, 5)
                resource(kind: .stamina, potions: data.staminaPotions, value: data.stamina, max: data.staminaMax, x: 20, width: 140, valX: 58, barX: 48, barW: 74)
                resource(kind: .mana, potions: data.manaPotions, value: data.mana, max: data.manaMax, x: 162, width: 132, valX: 54, barX: 42, barW: 76)
            }
            .frame(width: 308, height: 94)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func resource(kind: BarKind, potions: Int, value: Int, max: Int, x: CGFloat, width: CGFloat, valX: CGFloat, barX: CGFloat, barW: CGFloat) -> some View {
        let text = "\(fmtNumber(value))/\(fmtNumber(max))"
        let long = text.count == 6
        let xlong = text.count >= 7
        let low = max > 0 && Double(value) / Double(max) < 0.1
        return ZStack(alignment: .topLeading) {
            Text("\(potions)").font(Theme.num(17)).foregroundColor(kind.color).shadow(color: .black.opacity(0.9), radius: 1, x: 0, y: 1)
                .frame(minWidth: 14)
                .offset(x: 3, y: 9)
            Text(text)
                .font(Theme.num(xlong ? 17 : (long ? 19 : 21)))
                .foregroundColor(low ? kind.color : Theme.text)
                .shadow(color: .black.opacity(0.9), radius: 1, x: 0, y: 1)
                .lineLimit(1)
                .fixedSize()
                .offset(x: valX - (xlong ? 6 : 0), y: xlong ? 5 : (long ? 4 : 3))
            ProgressBarView(value: Double(value), max: Double(max), kind: kind, style: .line)
                .at(barX, 18, barW, 5)
        }
        .frame(width: width, height: 34, alignment: .topLeading)
        .offset(x: x, y: 56)
    }

    /// moneybar_frame + fill: gold and gems; the whole bar opens the gem packs (the green plus).
    private var moneyBar: some View {
        Button(action: { model.sfx("ui_button_circular"); onShop() }) {
            ZStack(alignment: .topLeading) {
                StretchedSprite("moneybar")
                VStack(spacing: 0) {
                    Text(fmtNumber(goldOverride ?? data.gold)).font(Theme.num(26)).foregroundColor(Theme.text).shadow(color: .black.opacity(0.9), radius: 1, x: 0, y: 1)
                        .frame(width: 100, height: 34, alignment: .trailing)
                    Text(fmtNumber(data.gems)).font(Theme.num(26)).foregroundColor(Theme.text).shadow(color: .black.opacity(0.9), radius: 1, x: 0, y: 1)
                        .frame(width: 100, height: 34, alignment: .trailing)
                }
                .offset(x: 12, y: 13)
            }
            .frame(width: 190, height: 94)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
