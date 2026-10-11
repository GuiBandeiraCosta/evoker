import SwiftUI
import UIKit
import EvokerCore

/// Design tokens of `css/tokens.css` and the 720 x 1280 stage of `src/ui/components/stage.js`: every screen is laid
/// out in stage units and `StageCanvas` scales that canvas to the device width (the web's `fitStage`).
enum Stage {
    static let width: CGFloat = 720
    static let height: CGFloat = 1280
    /// topbar_bg strip with the 94 px resource bars (`--hud-h`).
    static let hudHeight: CGFloat = 118
    /// hud_bottombg01 strip with the 109 px buttons (`--nav-h`).
    static let navHeight: CGFloat = 136
    /// The web's body height between HUD and nav on a 1280 stage (screens with fixed layouts assume it).
    static let bodyHeight: CGFloat = height - hudHeight - navHeight
}

/// What `StageCanvas` measured: the scale (device points per stage unit), the logical size the canvas has at that
/// scale and the device safe areas converted to stage units.
struct StageMetrics {
    var scale: CGFloat = 1
    var size: CGSize = CGSize(width: Stage.width, height: Stage.height)
    var safeTop: CGFloat = 0
    var safeBottom: CGFloat = 0
}

private struct StageMetricsKey: EnvironmentKey {
    static let defaultValue = StageMetrics()
}

extension EnvironmentValues {
    /// The current stage metrics (`StageCanvas` sets them).
    var stage: StageMetrics {
        get { self[StageMetricsKey.self] }
        set { self[StageMetricsKey.self] = newValue }
    }
}

/// Name of the coordinate space of the logical stage (drag and drop measures in it).
let stageCoordinateSpace = "evoker-stage"

/// Scales a fixed 720-unit-wide design canvas to the device width like the web stage (`stage.js fitStage`): the
/// canvas keeps the device aspect (its logical height grows on tall phones), so backgrounds stretch to the safe
/// areas and only designs that need it letterbox themselves.
struct StageCanvas<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        GeometryReader { geo in
            let scale: CGFloat = max(0.05, geo.size.width / Stage.width)
            let logical = CGSize(width: Stage.width, height: geo.size.height / scale)
            let metrics = StageMetrics(scale: scale, size: logical, safeTop: geo.safeAreaInsets.top / scale, safeBottom: geo.safeAreaInsets.bottom / scale)
            content()
                .environment(\.stage, metrics)
                .frame(width: logical.width, height: logical.height)
                .coordinateSpace(name: stageCoordinateSpace)
                .scaleEffect(scale, anchor: .topLeading)
                .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
                .clipped()
        }
        .ignoresSafeArea()
        .background(Color.black.ignoresSafeArea())
    }
}

extension Color {
    /// A colour from a `0xRRGGBB` literal (the tokens of css/tokens.css).
    init(hex: UInt32, alpha: Double = 1) {
        let r = Double((hex >> 16) & 0xff) / 255
        let g = Double((hex >> 8) & 0xff) / 255
        let b = Double(hex & 0xff) / 255
        self.init(.sRGB, red: r, green: g, blue: b, opacity: alpha)
    }
}

/// The colours, fonts, frames and texts sizes of `css/tokens.css` (the original client's `ev_styles` palette).
enum Theme {
    // MARK: Slate / stone
    static let bg = Color(hex: 0x1b1d1f)
    static let panel = Color(hex: 0x1a1b1d)
    static let panelLight = Color(hex: 0x2a2d31)
    static let panelDark = Color(hex: 0x141617)
    static let panelInset = Color(hex: 0x0d0e10)
    static let stoneEdge = Color(hex: 0x3d4246)
    static let stoneEdgeDark = Color(hex: 0x0a0b0c)

    // MARK: Buttons
    static let steelHi = Color(hex: 0x4f7f9b)
    static let steelLo = Color(hex: 0x2b4a60)
    static let greenHi = Color(hex: 0x5fbf4a)
    static let greenLo = Color(hex: 0x2d7a24)
    static let redHi = Color(hex: 0xc84a3c)
    static let redLo = Color(hex: 0x7a2219)

    // MARK: Text
    static let text = Color.white
    static let headline = Color(hex: 0xe6e6e6)
    static let muted = Color(hex: 0xc8c7c7)
    static let gold = Color(hex: 0xd2a154)
    static let orange = Color(hex: 0xff8014)
    static let tan = Color(hex: 0xf4d59f)
    static let tutorialGold = Color(hex: 0xfffd72)
    static let bossName = Color(hex: 0xfaaa32)
    static let enhanceYellow = Color(hex: 0xffc553)
    static let evolveBlue = Color(hex: 0x73beed)
    static let sellGreen = Color(hex: 0x71d703)
    static let darkblue = Color(hex: 0x1f2f3c)
    static let green = Color(hex: 0x378f0b)
    static let yellow = Color(hex: 0xfed00f)

    // MARK: Resources / stats
    static let xpBar = Color(hex: 0xffd556)
    static let stamina = Color(hex: 0xff832f)
    static let mana = Color(hex: 0x24d8ff)
    static let hp = Color(hex: 0x39b432)
    static let rating = Color(hex: 0xc1d353)
    static let attack = Color(hex: 0xff3b30)
    static let star = Color(hex: 0xffd556)
    static let quest = Color(hex: 0xa64ddb)
    static let gem = Color(hex: 0x73beed)
    static let goldCoin = Color(hex: 0xffcf35)
    static let ability = Color(hex: 0xff8014)

    // MARK: Tiers
    static let tierBronze = Color(hex: 0xd47a42)
    static let tierSilver = Color(hex: 0xe3e3e3)
    static let tierGold = Color(hex: 0xffcf35)

    static func tier(_ t: LeagueTier) -> Color {
        switch t {
        case .bronze: return tierBronze
        case .silver: return tierSilver
        case .gold: return tierGold
        }
    }

    /// Rarity text colours (`--r-*`).
    static func rarity(_ r: Rarity) -> Color {
        switch r {
        case .common: return Color(hex: 0xc8c7c7)
        case .standard: return Color(hex: 0xf3f3f3)
        case .uncommon: return Color(hex: 0x91dc52)
        case .rare: return Color(hex: 0x7ab0f2)
        case .heroic: return Color(hex: 0xc059bf)
        case .legendary: return Color(hex: 0xfdfab1)
        case .ultimate: return Color(hex: 0xff0000)
        }
    }

    /// Darker rarity frames of the small thumbs (`--rt-*`).
    static func rarityThumb(_ r: Rarity) -> Color {
        switch r {
        case .common: return Color(hex: 0xc8c7c7)
        case .standard: return Color(hex: 0xf3f3f3)
        case .uncommon: return Color(hex: 0x4f9a2a)
        case .rare: return Color(hex: 0x2e6fd0)
        case .heroic: return Color(hex: 0x8c2ea8)
        case .legendary: return Color(hex: 0xe2a326)
        case .ultimate: return Color(hex: 0xc81414)
        }
    }

    /// Tribe colours (`--t-*`).
    static func tribe(_ t: Tribe) -> Color {
        switch t {
        case .dwarf: return Color(hex: 0x45c23f)
        case .elf: return Color(hex: 0x3b8bff)
        case .orc: return Color(hex: 0xff3b30)
        case .neutral: return Color(hex: 0xff9f1c)
        }
    }

    /// Arena difficulty colours of the offer rows (`pvp-view.js offerColor`).
    static func difficulty(_ color: String) -> Color {
        switch color {
        case "green": return Color(hex: 0x8bd630)
        case "red": return Color(hex: 0xee3b1f)
        default: return Color(hex: 0xf5c93a)
        }
    }

    // MARK: Fonts (the client's STANDARD = Proxima Nova Light, BOLD = Proxima Nova Semibold, THIN = CG Times Bold)

    /// Bold UI text (`--fw-bold`, Proxima Nova Semibold).
    static func font(_ size: CGFloat) -> Font { Font.evoker(.bold, size: size) }
    /// Light copy (`--fw-light`, Proxima Nova Light).
    static func light(_ size: CGFloat) -> Font { Font.evoker(.standard, size: size) }
    /// Ornamental titles (CG Times Bold).
    static func title(_ size: CGFloat) -> Font { Font.evoker(.thin, size: size) }
    /// Numbers (`.num`): the bold face with tabular digits.
    static func num(_ size: CGFloat) -> Font { Font.evoker(.bold, size: size).monospacedDigit() }

    // MARK: Nine-slice frames (assets/orig/ui/frames/*.png, slice widths of frames.json)

    enum Frames {
        static let hudNineframe = ("hud_nineframe", EdgeInsets(top: 16, leading: 16, bottom: 16, trailing: 16))
        static let ironframe = ("ironframe", EdgeInsets(top: 10, leading: 10, bottom: 10, trailing: 10))
        static let glowGold = ("glowgold", EdgeInsets(top: 26, leading: 26, bottom: 26, trailing: 26))
        static let glowBlue = ("glowblue", EdgeInsets(top: 26, leading: 26, bottom: 26, trailing: 26))
        static let glowRed = ("glowred", EdgeInsets(top: 26, leading: 26, bottom: 26, trailing: 26))
        static let smallWhite = ("small_white", EdgeInsets(top: 12, leading: 12, bottom: 12, trailing: 12))
        static let smallYellow = ("small_yellow", EdgeInsets(top: 12, leading: 12, bottom: 12, trailing: 12))
        static let buttonDefault = ("button_default", EdgeInsets(top: 30, leading: 30, bottom: 30, trailing: 30))
        static let buttonGreen = ("button_green", EdgeInsets(top: 30, leading: 30, bottom: 30, trailing: 30))
        static let buttonDanger = ("button_danger", EdgeInsets(top: 30, leading: 30, bottom: 30, trailing: 30))
        static let buttonInactive = ("button_inactive", EdgeInsets(top: 30, leading: 30, bottom: 30, trailing: 30))
        static let quadbutton = ("quadbutton", EdgeInsets(top: 24, leading: 24, bottom: 24, trailing: 24))
        static let quadbuttonShop = ("quadbutton_shop", EdgeInsets(top: 24, leading: 24, bottom: 24, trailing: 24))
        static let bigbutton03 = ("bigbutton03", EdgeInsets(top: 24, leading: 24, bottom: 24, trailing: 24))
        static let bigbutton03Inactive = ("bigbutton03_inactive", EdgeInsets(top: 24, leading: 24, bottom: 24, trailing: 24))
        static let bigbutton04 = ("bigbutton04", EdgeInsets(top: 24, leading: 24, bottom: 24, trailing: 24))
        static let bigbutton04Inactive = ("bigbutton04_inactive", EdgeInsets(top: 24, leading: 24, bottom: 24, trailing: 24))
        static let backbutton = ("backbutton", EdgeInsets(top: 20, leading: 20, bottom: 20, trailing: 20))
        static let smallbutton = ("smallbutton", EdgeInsets(top: 22, leading: 22, bottom: 22, trailing: 22))
        static let menubarButton = ("menubar_button", EdgeInsets(top: 24, leading: 24, bottom: 24, trailing: 24))
        static let resourcebar = ("resourcebar", EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
        static let moneybar = ("moneybar", EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
        static let progressbar = ("progressbar", EdgeInsets(top: 0, leading: 18, bottom: 0, trailing: 20))
        static let progressbarKnob = ("progressbar_knob", EdgeInsets(top: 0, leading: 30, bottom: 0, trailing: 20))
        static let popupBg = ("popup_bg", EdgeInsets(top: 30, leading: 30, bottom: 30, trailing: 30))
        static let popupHeader = ("popup_header_grey", EdgeInsets(top: 24, leading: 24, bottom: 24, trailing: 24))
        static let ligaTimer = ("liga_timer_bg", EdgeInsets(top: 12, leading: 12, bottom: 12, trailing: 12))
        static let playerFrame = ("hud_player02", EdgeInsets(top: 30, leading: 30, bottom: 30, trailing: 30))
        static let packFrame = ("pack-frame", EdgeInsets(top: 46, leading: 46, bottom: 46, trailing: 46))
        static let discountBg = ("discount_bg", EdgeInsets(top: 14, leading: 14, bottom: 14, trailing: 14))
        static let ornamentTop = ("ornament_top", EdgeInsets(top: 40, leading: 60, bottom: 40, trailing: 60))
    }

    // MARK: Motion
    static let fast: Double = 0.12
    static let medium: Double = 0.22
    static let slow: Double = 0.4
}

/// `dom.js fmt`: an integer with thousands separators ("12,345"); non-finite → "-".
func fmtNumber(_ n: Int) -> String {
    let neg = n < 0
    var digits = Array(String(abs(n)))
    var out: [Character] = []
    var count = 0
    while let c = digits.popLast() {
        if count > 0 && count % 3 == 0 { out.append(",") }
        out.append(c)
        count += 1
    }
    let s = String(out.reversed())
    return neg ? "-" + s : s
}

func fmtNumber(_ d: Double) -> String {
    guard d.isFinite else { return "-" }
    return fmtNumber(Int(JSMath.round(d)))
}

/// `card.js plainNumber`: digits without separators, as the fight screens print them.
func plainNumber(_ n: Int) -> String { String(n) }

/// `dom.js pad`: zero-padded integer.
func padNumber(_ n: Int, _ width: Int = 2) -> String {
    let s = String(max(0, n))
    return s.count >= width ? s : String(repeating: "0", count: width - s.count) + s
}

/// `card.js rarityLabel`: "Uncommon".
func rarityLabel(_ r: Rarity) -> String {
    r.rawValue.prefix(1).uppercased() + r.rawValue.dropFirst()
}

/// `card.js cardNameWithPlus`: "Werewolf Dwarf++".
func cardNameWithPlus(_ name: String, stage: Int) -> String {
    name + String(repeating: "+", count: max(0, min(4, stage)))
}

/// `booster-view.js capitalize`.
func capitalized(_ s: String) -> String {
    guard let first = s.first else { return s }
    return String(first).uppercased() + s.dropFirst()
}

// MARK: - Sprites through the asset catalog (`dom.js sprite`, `card.js sprite`)

/// An original client sprite by stem, scaled to fit the frame it is given (the equivalent of the web's `img.sprite`).
struct Sprite: View {
    @EnvironmentObject private var model: AppModel
    let name: String
    var contentMode: ContentMode = .fit

    init(_ name: String, contentMode: ContentMode = .fit) {
        self.name = name
        self.contentMode = contentMode
    }

    var body: some View {
        if let img = model.assets.image(name) {
            Image(uiImage: img).resizable().aspectRatio(contentMode: contentMode)
        } else {
            Color.clear
        }
    }
}

/// A sprite stretched to fill its frame (`background-size: 100% 100%`).
struct StretchedSprite: View {
    @EnvironmentObject private var model: AppModel
    let name: String

    init(_ name: String) { self.name = name }

    var body: some View {
        if let img = model.assets.image(name) {
            Image(uiImage: img).resizable(resizingMode: .stretch)
        } else {
            Color.clear
        }
    }
}

/// A stitched nine-slice frame (assets/orig/ui/frames) stretched over its frame (`border-image ... stretch`).
struct NineSlice: View {
    @EnvironmentObject private var model: AppModel
    let name: String
    let insets: EdgeInsets

    init(_ frame: (String, EdgeInsets)) {
        self.name = frame.0
        self.insets = frame.1
    }

    init(_ name: String, insets: EdgeInsets) {
        self.name = name
        self.insets = insets
    }

    var body: some View {
        if let img = model.assets.image(name) {
            Image(uiImage: img).resizable(capInsets: insets, resizingMode: .stretch)
        } else {
            RoundedRectangle(cornerRadius: 6).stroke(Theme.stoneEdge, lineWidth: 3)
        }
    }
}

/// The art of a card at a fusion stage through the catalog (stage art falls back to the base art, then the
/// placeholder), filling its frame like `object-fit: cover`.
struct CardArt: View {
    @EnvironmentObject private var model: AppModel
    let def: CardDef
    var stage: Int = 0

    var body: some View {
        GeometryReader { geo in
            Image(uiImage: model.assets.cardArt(def, stage: stage))
                .resizable()
                .aspectRatio(contentMode: .fill)
                .frame(width: geo.size.width, height: geo.size.height)
                .clipped()
        }
    }
}
