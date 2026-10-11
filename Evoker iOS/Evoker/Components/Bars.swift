import SwiftUI
import EvokerCore

/// Bars on the original sprites (`src/ui/components/bars.js`): the dark inset with the coloured hud_progressbar*
/// line (xp yellow, stamina orange, mana blue, hp green, quest violet), the 3-slice track of the tall bars, the
/// HP bar with hud_healthicon01, the "Mana needed" bar with hud_manaicon01 and the pinocle marker, the card
/// level bar with hud_experienceicon01.

enum BarKind {
    case xp, hp, mana, stamina, quest, gold

    var color: Color {
        switch self {
        case .xp: return Theme.xpBar
        case .hp: return Theme.hp
        case .mana: return Theme.mana
        case .stamina: return Theme.stamina
        case .quest: return Theme.quest
        case .gold: return Theme.goldCoin
        }
    }

    /// The line sprite (named after the wrong colours in the sheet, see main.css).
    var sprite: String {
        switch self {
        case .xp: return "hud_progressbarviolet02"
        case .hp: return "hud_progressbarred02"
        case .mana: return "hud_progressbarblue02"
        case .stamina: return "hud_progressbaryellow01"
        case .quest: return "hud_progressbargreen02"
        case .gold: return "hud_progressbarviolet03"
        }
    }
}

enum BarStyle {
    /// 22 px dark inset, the fill is the whole height.
    case inset
    /// The fill is a thin line at the bottom (HUD style), no track.
    case line
    /// The 3-slice track (32 px) with a 6 px line at the bottom.
    case tall
    /// The 3-slice track with the round knob at the left end (the quest bar).
    case knob
}

/// `ratio(value, max)` clamped to 0..1.
func barRatio(_ value: Double, _ max: Double) -> Double {
    guard max > 0, max.isFinite else { return 0 }
    return Swift.max(0, Swift.min(1, value / max))
}

/// Generic progress bar (`progressBar`).
struct ProgressBarView: View {
    var value: Double
    var max: Double
    var kind: BarKind = .hp
    var label: String? = nil
    var style: BarStyle = .inset
    var height: CGFloat? = nil
    var labelSize: CGFloat? = nil

    private var ratio: CGFloat { CGFloat(barRatio(value, max)) }

    private var barHeight: CGFloat {
        if let h = height { return h }
        switch style {
        case .inset: return 22
        case .line: return 5
        case .tall, .knob: return 32
        }
    }

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            ZStack(alignment: .leading) {
                switch style {
                case .inset:
                    RoundedRectangle(cornerRadius: 3)
                        .fill(LinearGradient(colors: [Color(hex: 0x0b0c0d), Color(hex: 0x16181a)], startPoint: .top, endPoint: .bottom))
                        .overlay(RoundedRectangle(cornerRadius: 3).stroke(Color(hex: 0x0a0b0c), lineWidth: 1))
                    StretchedSprite(kind.sprite)
                        .background(kind.color)
                        .frame(width: Swift.max(0, w * ratio))
                        .shadow(color: kind.color.opacity(0.7), radius: 3)
                        .clipShape(RoundedRectangle(cornerRadius: 3))
                case .line:
                    StretchedSprite(kind.sprite)
                        .background(kind.color)
                        .frame(width: Swift.max(0, w * ratio))
                        .shadow(color: kind.color.opacity(0.8), radius: 2)
                case .tall, .knob:
                    NineSlice(style == .knob ? Theme.Frames.progressbarKnob : Theme.Frames.progressbar)
                    let inset: CGFloat = style == .knob ? 18 : 8
                    StretchedSprite(kind.sprite)
                        .background(kind.color)
                        .frame(width: Swift.max(0, (w - inset - 10) * ratio), height: 6)
                        .shadow(color: kind.color.opacity(0.8), radius: 3)
                        .offset(x: inset, y: barHeight / 2 - 8)
                }
                if let label = label, !label.isEmpty {
                    Text(label)
                        .font(Theme.font(labelSize ?? (style == .inset || style == .line ? 16 : 22)))
                        .foregroundColor(Theme.text)
                        .shadow(color: .black.opacity(0.95), radius: 1, x: 0, y: 1)
                        .lineLimit(1)
                        .frame(width: w, height: barHeight, alignment: .center)
                        .offset(y: style == .tall || style == .knob ? -3 : 0)
                }
            }
            .frame(width: w, height: barHeight)
        }
        .frame(height: barHeight)
        .animation(.easeOut(duration: Theme.slow), value: value)
    }
}

/// Player HP bar with the green heart (`hpBar`).
struct HPBarView: View {
    var cur: Int
    var max: Int

    var body: some View {
        HStack(spacing: 6) {
            Sprite("hud_healthicon01").frame(width: 48, height: 48)
            ProgressBarView(value: Double(Swift.max(0, cur)), max: Double(max), kind: .hp, label: "\(fmtNumber(cur)) / \(fmtNumber(max))", style: .tall)
        }
        .padding(.vertical, 4)
        .padding(.horizontal, 16)
    }
}

/// "Mana needed: 22 / 61" bar (`manaNeededBar` as the pre-battle and deck screens draw it): the blue line is the
/// mana the player has, the pinocle marker the deck's cost, both of the maximum; the label turns red when the
/// deck needs more than the player has.
struct ManaNeededBarView: View {
    var needed: Int
    var have: Int
    var max: Int

    var body: some View {
        let top = Swift.max(have, max, 1)
        HStack(spacing: 0) {
            Sprite("hud_manaicon01")
                .frame(width: 52, height: 52)
                .shadow(color: .black.opacity(0.9), radius: 1, x: 0, y: 2)
                .zIndex(1)
            GeometryReader { geo in
                let w = geo.size.width
                let pct = CGFloat(barRatio(Double(needed), Double(top)))
                ZStack(alignment: .leading) {
                    ProgressBarView(value: Double(have), max: Double(top), kind: .mana, label: nil, style: .tall)
                    Sprite("hud_progressbar_pinocle01")
                        .frame(width: 24, height: 67)
                        .offset(x: 8 + (w - 18) * pct - 12, y: -16)
                        .shadow(color: .black.opacity(0.9), radius: 1, x: 0, y: 1)
                    Text(Strings.manaNeeded(needed, top))
                        .font(Theme.font(22))
                        .foregroundColor(needed > have ? Theme.attack : Theme.text)
                        .shadow(color: .black, radius: 0, x: 1, y: 1)
                        .shadow(color: .black, radius: 0, x: -1, y: -1)
                        .shadow(color: .black.opacity(0.95), radius: 3)
                        .frame(width: w, height: 32)
                        .offset(y: -1)
                }
                .frame(width: w, height: 32)
            }
            .frame(height: 32)
            .padding(.leading, -22)
        }
        .padding(.vertical, 6)
    }
}

/// Card level bar (`levelBar`): star + "Level n / max" (the fill = xp towards the next level).
struct LevelBarView: View {
    var level: Int
    var levelCap: Int
    var xp: Int = 0
    var xpToNext: Int = 0
    /// Detail-card size (star 46, bar 28, label 20).
    var big: Bool = false

    var body: some View {
        let atCap = levelCap > 0 && level >= levelCap
        let value = atCap ? 1.0 : (xpToNext > 0 ? barRatio(Double(xp), Double(xpToNext)) : 0)
        let label = levelCap > 0 ? "Level \(level) / \(levelCap)" : "Level \(level)"
        HStack(spacing: 0) {
            Sprite("hud_experienceicon01")
                .frame(width: big ? 46 : 22, height: big ? 46 : 22)
                .shadow(color: .black.opacity(0.9), radius: 1, x: 0, y: 1)
                .zIndex(1)
                .padding(.trailing, big ? -10 : -5)
                .padding(.leading, big ? -8 : 0)
            ZStack(alignment: .bottomLeading) {
                RoundedRectangle(cornerRadius: big ? 3 : 2)
                    .fill(Color(hex: 0x08090a, alpha: 0.88))
                    .overlay(RoundedRectangle(cornerRadius: big ? 3 : 2).stroke(Color.black.opacity(0.9), lineWidth: 1))
                GeometryReader { geo in
                    Rectangle()
                        .fill(Theme.xpBar)
                        .frame(width: geo.size.width * CGFloat(value), height: big ? 5 : 3)
                        .shadow(color: Theme.xpBar.opacity(0.7), radius: 3)
                        .frame(width: geo.size.width, height: geo.size.height, alignment: .bottomLeading)
                }
                Text(label)
                    .font(big ? Theme.light(20) : Theme.font(10.5))
                    .foregroundColor(Color(hex: 0xf3f3f3))
                    .shadow(color: .black.opacity(0.95), radius: 1, x: 0, y: 1)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .frame(height: big ? 28 : 15)
        }
        .frame(height: big ? 36 : 20)
    }
}

/// Quest progress bar ("50%", violet, knobbed track).
struct QuestBarView: View {
    var percent: Int

    var body: some View {
        ProgressBarView(value: Double(percent), max: 100, kind: .quest, label: "\(percent)%", style: .knob, height: 36, labelSize: 26)
    }
}
