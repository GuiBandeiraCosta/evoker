import Foundation
import EvokerCore

/// Launch options used only by the UI tests (EvokerUITests) and the simulator smoke run on CI. A normal launch
/// passes none of them, so the app behaves exactly as before.
///
///   -uitest                 use a throw-away save folder (never the player's save) and no music
///   -uitest-preset NAME     "title"  : no save (the first-launch title screen)
///                           "fresh"  : a new game, session started (quest map)
///                           "mid"    : level 12, every feature open, 12 extra cards, gems / gold / tokens
///   -uitest-route NAME      push a screen after boot: cards, cards-training, cards-fusion, arena, pieces,
///                           replays, league, shop, character, settings, collections, help, lab, quest1,
///                           prebattle-quest1
enum UITestHooks {
    static var arguments: [String] { ProcessInfo.processInfo.arguments }

    static var enabled: Bool { arguments.contains("-uitest") }

    static func value(after flag: String) -> String? {
        let args = arguments
        guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }
        return args[i + 1]
    }

    /// A fresh, empty save folder for this launch.
    static func scratchSaveDirectory() -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("evoker-uitest-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true, attributes: nil)
        return dir
    }

    /// Cards the "mid" preset adds (a spread of tribes, rarities and abilities; all exist in cards.json).
    static let midCards: [String] = [
        "throat-cutter", "pouch-tearer", "bone-breaker", "falconer", "pikeman", "archer",
        "ogre", "dwarf-king", "phoenix", "griffin", "argonaut", "siren",
    ]

    /// Apply the preset and the route once the model has booted.
    @MainActor
    static func apply(to model: AppModel) {
        guard enabled else { return }
        let preset = value(after: "-uitest-preset") ?? "fresh"
        // "title": no save at all (the first-launch title screen)
        if preset == "title" { return }
        let store = model.store
        _ = store.newGame(name: "Tester")
        if preset == "mid" {
            let debug = store.debug
            debug.setLevel(12)
            try? debug.unlockAllFeaturesOnly()
            for id in midCards { _ = try? debug.addCard(id, stage: 0, level: 3) }
            debug.giveGems(5000)
            debug.giveGold(20000)
            debug.giveTokens(.neophyte, 3)
            debug.givePotions(stamina: 3, mana: 3)
            debug.refill()
        }
        model.startSession()
        model.router.path = []
        if let name = value(after: "-uitest-route"), let route = route(named: name) {
            model.router.go(route)
        }
    }

    static func route(named name: String) -> Route? {
        switch name {
        case "cards": return .cards(tab: .deck)
        case "cards-training": return .cards(tab: .training)
        case "cards-fusion": return .cards(tab: .fusion)
        case "arena": return .arena(tab: .arena)
        case "pieces": return .arena(tab: .pieces)
        case "replays": return .arena(tab: .replays)
        case "league": return .league
        case "shop": return .shop()
        case "character": return .character(tab: .profile)
        case "settings": return .character(tab: .settings)
        case "daily": return .character(tab: .daily)
        case "collections": return .collections()
        case "help": return .help(topic: "quest")
        case "lab": return .lab
        case "quest1": return .quest(line: "main", n: 1)
        case "feed": return .questMap(feed: true)
        default: return nil
        }
    }
}

extension DebugActions {
    /// Open every feature and deck slot without adding the whole catalog (the web's unlockAll adds every card at
    /// its cap, which makes the UI tests' screens unreadable).
    func unlockAllFeaturesOnly() throws {
        try store.updateState { s, _, _ in
            var next = s
            var main = next.quests.main
            main.firstWins = Array(Set(main.firstWins + Array(1...10))).sorted()
            main.unlocked = max(main.unlocked, 11)
            main.done = max(main.done, 10)
            next.quests.main = main
            next.player.deckSlots = 5
            // the unlock popups and the name prompt were "seen", so they do not cover the screens under test
            let seen = ["fusion", "arena", "training", "league", "cardslot3", "cardslot4", "cardslot5"]
            next.tutorial.seen = Array(Set(next.tutorial.seen + seen)).sorted()
            if var r3 = next.tutorial.r3 { r3.named = true; next.tutorial.r3 = r3 }
            return next
        }
    }
}
