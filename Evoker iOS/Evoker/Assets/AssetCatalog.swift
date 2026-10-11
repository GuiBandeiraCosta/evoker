import Foundation
import UIKit
import EvokerCore

/// The single place that resolves art, sound and font names to files (docs/PLAN.md §8). Every component asks the
/// catalog; nothing else touches `GameAssets/`. Swap the folder (same manifest keys) or the implementation to
/// change the look.
///
/// `GameAssets/manifest.json` (written by Tools/build-assets.mjs):
/// ```
/// { "version": 1,
///   "cards": { "<cardId>": { "0": "cards/Adept.jpg", "1": "cards/Adept+.jpg", ... } },
///   "ui": { "<stem>": "ui/<stem>.png" },           // original client sprites (assets/orig/ui) + assets/ui fallbacks
///   "bg": { "<stem>": "bg/<file>" },
///   "sfx": { "<stem>": "sfx/<stem>.mp3" },
///   "fonts": { "standard": "fonts/proximanova-light.ttf", "bold": "fonts/proximanova-sbold.ttf",
///              "thin": "fonts/07713_CGTimesBold.ttf", "googleBold": "fonts/Roboto-Bold.ttf" },
///   "map": { ... }, "minions": { ... }, "portraits": { ... }, "animations": { "<name>": "animations/<name>.json" } }
/// ```
protocol AssetCatalog: AnyObject {
    /// A UI sprite / background / minion / portrait by stem (e.g. "hud_coinsicon01", "arena", "village_normal_bg").
    func image(_ name: String) -> UIImage?
    /// The art of a card at a fusion stage; falls back to the stage-0 art, then to a generated placeholder.
    func cardArt(_ card: CardDef, stage: Int) -> UIImage
    /// A sound file by stem ("ui_button_circular", "music_fight_cue1").
    func soundURL(_ stem: String) -> URL?
    /// The registered PostScript name of a font role (fonts are registered at launch).
    func fontName(_ role: FontRole) -> String
    /// Raw data of a non-image asset by manifest path ("animations/levelup.json").
    func data(_ path: String) -> Data?
    /// Does the catalog know this sprite stem?
    func hasImage(_ name: String) -> Bool
}

/// The client's font roles (`ev_styles`): STANDARD = Proxima Nova Light, BOLD = Proxima Nova Semibold,
/// THIN = CG Times Bold (ornamental titles), GOOGLEBOLD = Roboto Bold.
enum FontRole: String, CaseIterable {
    case standard, bold, thin, googleBold
}
