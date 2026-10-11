import SwiftUI
import UIKit
import EvokerCore

/// The client's palette as SwiftUI colours: css/tokens.css (the web design tokens) and the `ev_styles` colours of
/// docs/design/apk-assets.md. `UIColor(Palette.x)` gives the UIKit / SpriteKit colour.
enum Palette {
    // MARK: Slate / stone (the hex-stone textures of topbar_bg / hud_bottombg01)
    static let bg = color(0x1b1d1f)
    static let panel = color(0x1a1b1d)
    static let panelLight = color(0x2a2d31)
    static let panelDark = color(0x141617)
    static let panelInset = color(0x0d0e10)
    static let stoneEdge = color(0x3d4246)
    static let stoneEdgeDark = color(0x0a0b0c)
    static let bevelHi = Color.white.opacity(0.14)
    static let bevelLo = Color.black.opacity(0.6)

    // MARK: Steel-blue buttons (button_default_fill) and the green / danger variants
    static let steelHi = color(0x4f7f9b)
    static let steelLo = color(0x2b4a60)
    static let steelEdge = Color(red: 190 / 255, green: 225 / 255, blue: 245 / 255).opacity(0.55)
    static let steelText = Color.white
    static let greenHi = color(0x5fbf4a)
    static let greenLo = color(0x2d7a24)
    static let redHi = color(0xc84a3c)
    static let redLo = color(0x7a2219)

    // MARK: Text (ev_styles: white, headlinegrey, beige, playerGold, brightOrange, common grey)
    static let text = Color.white
    static let headline = color(0xe6e6e6)
    static let muted = color(0xc8c7c7)
    /// `--gold` / ev_styles playerGold.
    static let gold = color(0xd2a154)
    static let playerGold = gold
    /// `--orange` / ev_styles brightOrange.
    static let orange = color(0xff8014)
    static let brightOrange = orange
    /// `--tan` / ev_styles beige.
    static let tan = color(0xf4d59f)
    static let beige = tan
    static let tutorialGold = color(0xfffd72)
    static let bossName = color(0xfaaa32)
    static let enhanceYellow = color(0xffc553)
    static let evolveBlue = color(0x73beed)
    static let sellGreen = color(0x71d703)
    static let darkblue = color(0x1f2f3c)
    static let green = color(0x378f0b)
    static let yellow = color(0xfed00f)

    // MARK: Resources and stats (ev_styles: xp, stamina, mana, health, rating)
    static let xp = color(0xffd556)
    static let stamina = color(0xff832f)
    static let mana = color(0x24d8ff)
    static let health = color(0x39b432)
    static let rating = color(0xc1d353)
    static let attack = color(0xff3b30)
    static let star = color(0xffd556)
    /// `--c-quest` / `--c-xp` (violet quest progress bar, hud_progressbarviolet).
    static let quest = color(0xa64ddb)
    static let gem = color(0x73beed)
    /// `--c-gold` (the coin icon colour; also ev_styles gold).
    static let coinGold = color(0xffcf35)
    static let ability = color(0xff8014)

    // MARK: Rarity text colours (ev_styles) and the darker frames of the small card thumbs
    static let rarityCommon = color(0xc8c7c7)
    static let rarityStandard = color(0xf3f3f3)
    static let rarityUncommon = color(0x91dc52)
    static let rarityRare = color(0x7ab0f2)
    static let rarityHeroic = color(0xc059bf)
    static let rarityLegendary = color(0xfdfab1)
    static let rarityUltimate = color(0xff0000)
    static let frameUncommon = color(0x4f9a2a)
    static let frameRare = color(0x2e6fd0)
    static let frameHeroic = color(0x8c2ea8)
    static let frameLegendary = color(0xe2a326)
    static let frameUltimate = color(0xc81414)

    // MARK: League tiers (ev_styles: bronze, silver, gold; platinum is the web's)
    static let tierBronze = color(0xd47a42)
    static let tierSilver = color(0xe3e3e3)
    static let tierGold = color(0xffcf35)
    static let tierPlatinum = color(0x9fe3f5)

    // MARK: Tribes
    static let tribeDwarf = color(0x45c23f)
    static let tribeElf = color(0x3b8bff)
    static let tribeOrc = color(0xff3b30)
    static let tribeNeutral = color(0xff9f1c)

    // MARK: Battle status overlays
    static let statusDaze = color(0xff3b30)
    static let statusStun = color(0xff5a3c)
    static let statusSuspend = color(0x24d8ff)
    static let statusSphere = Color(red: 190 / 255, green: 230 / 255, blue: 1).opacity(0.75)

    // MARK: Lookups

    /// Rarity text colour (`--r-<rarity>`).
    static func rarity(_ rarity: Rarity) -> Color {
        switch rarity {
        case .common: return rarityCommon
        case .standard: return rarityStandard
        case .uncommon: return rarityUncommon
        case .rare: return rarityRare
        case .heroic: return rarityHeroic
        case .legendary: return rarityLegendary
        case .ultimate: return rarityUltimate
        }
    }

    /// Thumb frame colour (`--rt-<rarity>`; common and standard have no coloured frame: stone edge / light grey).
    static func rarityFrame(_ rarity: Rarity) -> Color {
        switch rarity {
        case .common: return stoneEdge
        case .standard: return muted
        case .uncommon: return frameUncommon
        case .rare: return frameRare
        case .heroic: return frameHeroic
        case .legendary: return frameLegendary
        case .ultimate: return frameUltimate
        }
    }

    /// Tribe colour (`--t-<tribe>`).
    static func tribe(_ tribe: Tribe) -> Color {
        switch tribe {
        case .dwarf: return tribeDwarf
        case .elf: return tribeElf
        case .orc: return tribeOrc
        case .neutral: return tribeNeutral
        }
    }

    /// Tribe colour for UIKit / SpriteKit code that does not import SwiftUI (the card placeholder, SKLabelNodes).
    static func uiTribe(_ tribe: Tribe) -> UIColor {
        switch tribe {
        case .dwarf: return uiColor(0x45c23f)
        case .elf: return uiColor(0x3b8bff)
        case .orc: return uiColor(0xff3b30)
        case .neutral: return uiColor(0xff9f1c)
        }
    }

    /// Rarity text colour for UIKit / SpriteKit.
    static func uiRarity(_ rarity: Rarity) -> UIColor {
        switch rarity {
        case .common: return uiColor(0xc8c7c7)
        case .standard: return uiColor(0xf3f3f3)
        case .uncommon: return uiColor(0x91dc52)
        case .rare: return uiColor(0x7ab0f2)
        case .heroic: return uiColor(0xc059bf)
        case .legendary: return uiColor(0xfdfab1)
        case .ultimate: return uiColor(0xff0000)
        }
    }

    /// League tier colour (`--tier-<tier>`).
    static func tier(_ tier: LeagueTier) -> Color {
        switch tier {
        case .bronze: return tierBronze
        case .silver: return tierSilver
        case .gold: return tierGold
        }
    }

    /// A colour from a 0xRRGGBB value.
    static func color(_ hex: UInt32, opacity: Double = 1) -> Color {
        Color(red: Double((hex >> 16) & 0xff) / 255, green: Double((hex >> 8) & 0xff) / 255, blue: Double(hex & 0xff) / 255, opacity: opacity)
    }

    /// A UIKit / SpriteKit colour from a 0xRRGGBB value.
    static func uiColor(_ hex: UInt32, alpha: CGFloat = 1) -> UIColor {
        UIColor(red: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: alpha)
    }
}
