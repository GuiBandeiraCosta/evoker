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

/// What a screen asks the music player for when it opens (`screenMusic(id, params)` of audio.js).
struct MusicCue: Equatable {
    var name: String
    var loop: Bool = true
    /// Track to start when a one-shot cue ends (the shop: `music_buybooster`, then `atmo_menu`).
    var next: String? = nil
    /// Crossfade in seconds; nil = the player's default (0.5 s).
    var fade: TimeInterval? = nil
}

/// Music per screen (`screenMusic` of audio.js). The battle scene sets its own cues; `cue(for:)` returns nil for
/// the screens whose mount leaves the current music alone (the web's `null`: pre-battle, booster, help, lab).
enum ScreenMusic {
    static func cue(for route: Route) -> MusicCue? {
        switch route {
        case .title: return MusicCue(name: "music_intro")
        case .questMap: return MusicCue(name: "atmo_map_far")
        case .quest(let line, let n): return MusicCue(name: AudioNames.questAmbience(line: line, quest: n))
        case .bossIntro: return MusicCue(name: "music_bossannounce", loop: false, fade: 0)
        case .shop: return MusicCue(name: "music_buybooster", loop: false, next: "atmo_menu")
        case .arena, .league, .cards, .cardDetail, .collections, .character: return MusicCue(name: "atmo_menu")
        case .prebattle, .battle, .boosterOpen, .help, .lab: return nil
        }
    }

    /// The music name alone (the earlier contract); nil = keep playing / the battle's own cues.
    static func name(for route: Route) -> String? { cue(for: route)?.name }
}
