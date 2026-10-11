import Foundation
import UIKit
import EvokerCore

/// Backdrop themes of the battle screen (battle.js THEMES / themeFor, css/screens/battle.css `.battle-bg`;
/// colours sampled in assets/bg/README.md): sky, horizon strip, ground.
enum BattleTheme: String {
    case valley, sunset, swamp, lava

    /// `themeFor(mode, extra)`: PvP → the original arena painting; portal lines → swamp; main-line bosses from
    /// quest 31 → lava; everything else the green valley.
    static func derive(mode: FightMode, line: String?, questNumber: Int?) -> BattleTheme {
        if BattlePresentation.isPvpMode(mode) { return .sunset }
        if let l = line, l != "main" { return .swamp }
        if let n = questNumber, n >= 31 { return .lava }
        return .valley
    }

    /// Gradient stops of the sky / ground (fraction of the stage height → colour).
    var gradient: [(CGFloat, UIColor)] {
        switch self {
        case .valley: return [(0, BattleColors.hex(0x354353)), (0.36, BattleColors.hex(0x396648)), (0.44, BattleColors.hex(0x244a22)), (0.5, BattleColors.hex(0x193917)), (1, BattleColors.hex(0x0d2410))]
        case .sunset: return [(0, BattleColors.hex(0xc65326)), (0.4, BattleColors.hex(0x9a6026)), (1, BattleColors.hex(0x7d3219))]
        case .swamp: return [(0, BattleColors.hex(0x584a3a)), (0.36, BattleColors.hex(0x436130)), (0.44, BattleColors.hex(0x35501f)), (0.5, BattleColors.hex(0x2a3e14)), (1, BattleColors.hex(0x11200a))]
        case .lava: return [(0, BattleColors.hex(0x3d2315)), (0.4, BattleColors.hex(0x5a2a12)), (0.48, BattleColors.hex(0xc1922e)), (0.6, BattleColors.hex(0x7a3a12)), (1, BattleColors.hex(0x2a1208))]
        }
    }

    /// The painted horizon strip (sprite stem in the catalog's bg group), nil for the arena painting.
    var horizonSprite: String? {
        switch self {
        case .valley: return "horizon-valley"
        case .swamp: return "horizon-swamp"
        case .lava: return "fight_cardbackground01"
        case .sunset: return nil
        }
    }

    var horizonAlpha: CGFloat { self == .lava ? 0.85 : 1 }

    /// The full backdrop painting (the PvP arena).
    var paintingSprite: String? { self == .sunset ? "arena" : nil }

    /// Background colour behind the painting.
    var baseColor: UIColor { self == .sunset ? BattleColors.hex(0x3a1a0c) : BattleColors.background }
}

extension BattlePresentation {
    /// Modes whose fights are PvP-like: arena music, loot shown either way, "Proceed" (battle.js PVP_MODES).
    static func isPvpMode(_ mode: FightMode) -> Bool {
        switch mode {
        case .arena, .pieces, .league, .replay, .lab: return true
        case .quest: return false
        }
    }

    var isPvp: Bool { BattlePresentation.isPvpMode(mode) }

    /// The quest line of a quest fight (from the completion), nil otherwise.
    var questLine: String? {
        if case .questMap(let line) = completion { return line }
        return nil
    }

    /// The backdrop theme: the explicit id, or derived from the mode and line (the quest number is not carried,
    /// so the lava theme needs `theme: "lava"` from the pre-battle screen).
    var battleTheme: BattleTheme {
        if let t = theme, let known = BattleTheme(rawValue: t) { return known }
        return BattleTheme.derive(mode: mode, line: questLine, questNumber: nil)
    }

    /// Result kind for the human player (battle-result-model.js `resultKind`; the attacker is the human).
    var resultKind: BattleResultKind {
        switch result.winner {
        case .draw: return .draw
        case .attacker: return .victory
        case .defender: return .defeat
        }
    }
}

/// 'victory' | 'defeat' | 'draw'.
enum BattleResultKind: String {
    case victory, defeat, draw

    var title: String {
        switch self {
        case .victory: return "Victory"
        case .defeat: return "Defeat"
        case .draw: return "Draw"
        }
    }

    /// hud_victory / hud_defeat / hud_drawd (fx_wonlost).
    var bannerSprite: String {
        switch self {
        case .victory: return "hud_victory"
        case .defeat: return "hud_defeat"
        case .draw: return "hud_drawd"
        }
    }
}
