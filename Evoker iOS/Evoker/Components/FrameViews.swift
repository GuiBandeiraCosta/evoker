import SwiftUI
import EvokerCore

/// Panels, plates and buttons on the original sprites (`css/main.css` .panel / .panel-inset / .plate / .btn,
/// `src/ui/components/buttons.js`): nine-slice frames from assets/orig/ui/frames over a dark fill.

/// Presses scale the button a little (`.btn:active`).
struct PressScaleStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .brightness(configuration.isPressed ? -0.05 : 0)
            .animation(.easeOut(duration: Theme.fast), value: configuration.isPressed)
    }
}

/// `.plate`: small_white frame on #151617, bold text.
struct Plate<Content: View>: View {
    var gold: Bool = false
    @ViewBuilder let content: () -> Content

    init(gold: Bool = false, @ViewBuilder content: @escaping () -> Content) {
        self.gold = gold
        self.content = content
    }

    var body: some View {
        content()
            .padding(.vertical, 4)
            .padding(.horizontal, 12)
            .background(Color(hex: 0x151617))
            .overlay(NineSlice(gold ? Theme.Frames.smallYellow : Theme.Frames.smallWhite))
    }
}

/// `.panel`: the hud_nineframe metal frame over a dark fill.
struct Panel<Content: View>: View {
    var fill: Color = Color(hex: 0x161719, alpha: 0.94)
    @ViewBuilder let content: () -> Content

    init(fill: Color = Color(hex: 0x161719, alpha: 0.94), @ViewBuilder content: @escaping () -> Content) {
        self.fill = fill
        self.content = content
    }

    var body: some View {
        content()
            .background(fill)
            .overlay(NineSlice(Theme.Frames.hudNineframe))
            .shadow(color: .black.opacity(0.55), radius: 8, x: 0, y: 3)
    }
}

/// `.panel-inset`: the thin ironframe over a near-black fill.
struct InsetPanel<Content: View>: View {
    var fill: Color = Color(hex: 0x08090a, alpha: 0.9)
    @ViewBuilder let content: () -> Content

    init(fill: Color = Color(hex: 0x08090a, alpha: 0.9), @ViewBuilder content: @escaping () -> Content) {
        self.fill = fill
        self.content = content
    }

    var body: some View {
        content()
            .background(fill)
            .overlay(NineSlice(Theme.Frames.ironframe))
    }
}

/// `header_framer_big` / `_small` plate with centred text (options header, set titles, league sub-heads).
struct HeaderPlate: View {
    let text: String
    var big: Bool = true
    var color: Color = Theme.text
    var fontSize: CGFloat = 34

    var body: some View {
        Text(text)
            .font(Theme.font(fontSize))
            .foregroundColor(color)
            .shadow(color: .black.opacity(0.9), radius: 1, x: 0, y: 2)
            .lineLimit(1)
            .frame(maxWidth: .infinity)
            .frame(height: big ? 61 : 43)
            .background(StretchedSprite(big ? "header_framer_big" : "header_framer_small"))
    }
}

/// `.btn`: the steel button (button_default frame + fill), with the green / danger / inactive variants.
struct SteelButton<Label: View>: View {
    var variant: ButtonVariant = .steel
    var size: ButtonSize = .md
    var fullWidth: Bool = false
    var disabled: Bool = false
    let action: () -> Void
    @ViewBuilder let label: () -> Label

    init(variant: ButtonVariant = .steel, size: ButtonSize = .md, fullWidth: Bool = false, disabled: Bool = false,
         action: @escaping () -> Void, @ViewBuilder label: @escaping () -> Label) {
        self.variant = variant
        self.size = size
        self.fullWidth = fullWidth
        self.disabled = disabled
        self.action = action
        self.label = label
    }

    private var frame: (String, EdgeInsets) {
        if disabled { return Theme.Frames.buttonInactive }
        switch variant {
        case .steel: return Theme.Frames.buttonDefault
        case .green: return Theme.Frames.buttonGreen
        case .red: return Theme.Frames.buttonDanger
        case .grey: return Theme.Frames.buttonInactive
        }
    }

    private var minHeight: CGFloat {
        switch size {
        case .sm: return 46
        case .md: return 60
        case .lg: return 74
        }
    }

    private var padX: CGFloat {
        switch size {
        case .sm: return 16
        case .md: return 26
        case .lg: return 40
        }
    }

    var fontSize: CGFloat {
        switch size {
        case .sm: return 22
        case .md: return 28
        case .lg: return 34
        }
    }

    var body: some View {
        Button(action: action) {
            label()
                .font(Theme.font(fontSize))
                .foregroundColor(disabled ? Color.white.opacity(0.55) : Theme.text)
                .shadow(color: .black.opacity(0.8), radius: 1, x: 0, y: 2)
                .lineLimit(1)
                .padding(.horizontal, padX)
                .frame(minHeight: minHeight)
                .frame(maxWidth: fullWidth ? .infinity : nil)
                .background(NineSlice(frame))
                .contentShape(Rectangle())
        }
        .buttonStyle(PressScaleStyle())
        .disabled(disabled)
    }
}

extension SteelButton where Label == Text {
    init(_ title: String, variant: ButtonVariant = .steel, size: ButtonSize = .md, fullWidth: Bool = false, disabled: Bool = false, action: @escaping () -> Void) {
        self.init(variant: variant, size: size, fullWidth: fullWidth, disabled: disabled, action: action, label: { Text(title) })
    }
}

/// `.btn.btn-icon`: a square steel plate with an original sprite.
struct IconButton: View {
    let sprite: String
    var size: ButtonSize = .md
    var variant: ButtonVariant = .steel
    /// Share of the plate the sprite takes (the menubar icons carry a transparent margin: 1.0).
    var iconScale: CGFloat = 0.62
    var mirrored: Bool = false
    var disabled: Bool = false
    let action: () -> Void

    private var side: CGFloat {
        switch size {
        case .sm: return 56
        case .md: return 76
        case .lg: return 92
        }
    }

    private var frame: (String, EdgeInsets) {
        if disabled { return Theme.Frames.buttonInactive }
        switch variant {
        case .steel: return Theme.Frames.buttonDefault
        case .green: return Theme.Frames.buttonGreen
        case .red: return Theme.Frames.buttonDanger
        case .grey: return Theme.Frames.buttonInactive
        }
    }

    var body: some View {
        Button(action: action) {
            ZStack {
                NineSlice(frame)
                Sprite(sprite)
                    .frame(width: side * iconScale, height: side * iconScale)
                    .scaleEffect(x: mirrored ? -1 : 1, y: 1)
                    .shadow(color: .black.opacity(0.7), radius: 1, x: 0, y: 2)
            }
            .frame(width: side, height: side)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressScaleStyle())
        .disabled(disabled)
    }
}

/// Paging arrows of list headers (`arrowButton`): back_icon_active, mirrored for right.
struct ArrowButton: View {
    enum Direction { case left, right }
    let direction: Direction
    let action: () -> Void

    var body: some View {
        IconButton(sprite: "back_icon_active", size: .md, iconScale: 0.54, mirrored: direction == .right, action: action)
    }
}

/// The flaming "Attack!" bar (`attackBar`): attackbuttonornament01 behind the attackbutton01 plate.
struct AttackBarView: View {
    var label: String = Strings.attack
    var disabled: Bool = false
    let action: () -> Void
    @State private var flame: Bool = false

    var body: some View {
        ZStack {
            Sprite("attackbuttonornament01")
                .frame(width: 600, height: 221)
                .opacity(flame ? 1 : 0.92)
                .scaleEffect(flame ? 1.03 : 1)
                .allowsHitTesting(false)
            Button(action: action) {
                Text(label)
                    .font(Theme.font(40))
                    .foregroundColor(disabled ? Color.white.opacity(0.6) : Theme.text)
                    .shadow(color: .black.opacity(0.8), radius: 1, x: 0, y: 2)
                    .padding(.bottom, 2)
                    .frame(width: 248, height: 122)
                    .background(StretchedSprite("attackbutton01"))
                    .saturation(disabled ? 0.3 : 1)
                    .brightness(disabled ? -0.2 : 0)
                    .contentShape(Rectangle())
            }
            .buttonStyle(PressScaleStyle())
            .disabled(disabled)
        }
        .frame(height: 160)
        .onAppear {
            withAnimation(.easeInOut(duration: 1.3).repeatForever(autoreverses: true)) { flame = true }
        }
    }
}

/// Tab bar on the hud_bigbutton04 plates (`tabBar`), used by generic tab rows.
struct TabBarView: View {
    let tabs: [(id: String, label: String)]
    let active: String
    let onSelect: (String) -> Void

    var body: some View {
        HStack(spacing: 8) {
            ForEach(tabs, id: \.id) { tab in
                Button(action: { onSelect(tab.id) }) {
                    Text(tab.label)
                        .font(Theme.font(24))
                        .foregroundColor(tab.id == active ? Theme.text : Theme.muted)
                        .shadow(color: .black.opacity(0.8), radius: 1, x: 0, y: 2)
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: 60)
                        .background(NineSlice(tab.id == active ? Theme.Frames.bigbutton04 : Theme.Frames.bigbutton04Inactive))
                        .contentShape(Rectangle())
                }
                .buttonStyle(PressScaleStyle())
            }
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 12)
    }
}

/// The blue attack button of the PvP lists (`pvp-widgets.js attackButton`): button_default plate + icon_pvp swords.
struct PvpAttackButton: View {
    var disabled: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                NineSlice(Theme.Frames.buttonDefault)
                Sprite("icon_pvp_active")
                    .frame(width: 100, height: 86)
                    .shadow(color: .black.opacity(0.7), radius: 1, x: 0, y: 2)
            }
            .frame(width: 100, height: 86)
            .saturation(disabled ? 0 : 1)
            .brightness(disabled ? -0.2 : 0)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressScaleStyle())
        .disabled(disabled)
    }
}

/// The small info button (`pvp-widgets.js infoButton`): hud_smallbutton with info_icon.
struct InfoButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                NineSlice(Theme.Frames.smallbutton)
                Sprite("info_icon")
                    .frame(width: 24, height: 44)
                    .shadow(color: .black.opacity(0.8), radius: 1, x: 0, y: 1)
            }
            .frame(width: 74, height: 68)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressScaleStyle())
    }
}

/// `.portrait`: a card-art avatar in the hud_player02 frame (`pvp-widgets.js portrait`).
struct PortraitView: View {
    @EnvironmentObject private var model: AppModel
    let avatar: Int
    var size: CGFloat = 84
    var defaultPlayer: Bool = false

    var body: some View {
        ZStack {
            Color(hex: 0x0a0b0c)
            if !defaultPlayer, let def = avatarDef {
                CardArt(def: def, stage: 0)
            } else {
                Sprite("default_player", contentMode: .fill)
            }
        }
        .frame(width: size, height: size)
        .clipped()
        .overlay(NineSlice(Theme.Frames.playerFrame))
    }

    private var avatarDef: CardDef? {
        guard let names = model.deps.names, !names.avatars.isEmpty else { return nil }
        let n = names.avatars.count
        let i = ((avatar % n) + n) % n
        return model.db.get(names.avatars[i])
    }
}

/// `pvp-widgets.js cardThumb`: a card's art in a thin rarity-coloured frame (the strongest card of an opponent).
struct CardThumb: View {
    let def: CardDef?
    var stage: Int = 0

    var body: some View {
        ZStack {
            Color(hex: 0x050506)
            if let d = def {
                CardArt(def: d, stage: stage)
            } else {
                Sprite("cardslot_question01_thumb", contentMode: .fill)
            }
        }
        .overlay(Rectangle().stroke(def.map { Theme.rarityThumb($0.rarity) } ?? Theme.rarity(.common), lineWidth: 4))
        .shadow(color: .black.opacity(0.7), radius: 4, x: 0, y: 3)
    }
}

/// A gem price "123 <gem>" (`.gem-price`).
struct GemPrice: View {
    let amount: Int
    var fontSize: CGFloat = 24
    var iconSize: CGFloat = 26
    var color: Color = Theme.text

    var body: some View {
        HStack(spacing: 6) {
            Text(fmtNumber(amount)).font(Theme.num(fontSize)).foregroundColor(color)
            Sprite("hud_gemiconsingle").frame(width: iconSize, height: iconSize)
        }
    }
}

/// `tokenImage`: the token sprite of a pack; the portal packs draw the CSS triangle (sand / violet).
struct TokenImage: View {
    let kind: TokenKind
    var size: CGFloat = 52

    var body: some View {
        if kind.isPortal {
            ZStack {
                Triangle()
                    .fill(LinearGradient(colors: kind == .portalHigh ? [Color(hex: 0xf1d5ff), Color(hex: 0xa04fd6), Color(hex: 0x4b1670)] : [Color(hex: 0xfff4dc), Color(hex: 0xd8b98a), Color(hex: 0x8a6a3e)], startPoint: .topLeading, endPoint: .bottomTrailing))
                Triangle()
                    .fill(kind == .portalHigh ? Color.white : Color(hex: 0x3b2a16))
                    .frame(width: size * 0.32, height: size * 0.34)
                    .offset(y: size * 0.13)
            }
            .frame(width: size, height: size)
        } else {
            Sprite(tokenSprite(kind)).frame(width: size, height: size)
        }
    }
}

struct Triangle: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: rect.midX, y: rect.minY + rect.height * 0.04))
        p.addLine(to: CGPoint(x: rect.minX + rect.width * 0.97, y: rect.minY + rect.height * 0.92))
        p.addLine(to: CGPoint(x: rect.minX + rect.width * 0.03, y: rect.minY + rect.height * 0.92))
        p.closeSubpath()
        return p
    }
}

/// Positions a fixed-size child inside a `ZStack(alignment: .topLeading)` at stage coordinates.
extension View {
    func at(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> some View {
        self.frame(width: w, height: h).offset(x: x, y: y)
    }

    /// `.hidden` style helper: show / hide without changing the layout.
    @ViewBuilder
    func visible(_ shown: Bool) -> some View {
        if shown { self } else { self.hidden() }
    }
}
