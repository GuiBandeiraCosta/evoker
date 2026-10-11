import Foundation
import EvokerCore

/// The sound player every screen and the battle scene use (`src/ui/audio.js`). Names are the file stems of
/// `GameAssets/sfx` (docs/dev/audio.md of the web game lists them).
protocol AudioPlaying: AnyObject {
    /// Play a one-shot effect (no-op when sound is off or the file is missing).
    func sfx(_ name: String)
    /// Switch the music loop (nil = silence); the same name keeps the current loop playing.
    func music(_ name: String?)
    /// Apply the save's settings (master switch, volumes).
    func apply(_ settings: Settings)
    /// Pause / resume (app background).
    func suspend()
    func resume()
}

/// Music per screen (`screenMusic` of audio.js). The battle scene sets its own cues.
enum ScreenMusic {
    static func name(for route: Route) -> String? {
        switch route {
        case .title: return "music_intro"
        case .questMap, .quest, .cards, .cardDetail, .collections, .arena, .league, .shop, .character, .help, .lab: return "atmo_menu"
        case .bossIntro: return "music_bossannounce"
        case .prebattle: return "atmo_map_far"
        case .battle: return nil
        case .boosterOpen: return "music_buybooster"
        }
    }
}
