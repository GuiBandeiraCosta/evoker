import Foundation
import SwiftUI
import EvokerCore

/// Launch options used only by the UI tests (EvokerUITests) and the simulator smoke run on CI. A normal launch
/// passes none of them, so the app behaves exactly as before.
///
///   -uitest                 use a throw-away save folder (never the player's save) and no music
///   -uitest-preset NAME     "title"  : no save (the first-launch title screen)
///                           "fresh"  : a new game, session started (quest map)
///                           "mid"    : level 12, every feature open, 13 extra cards (two Throat-Cutters to fuse),
///                                      gems / gold / tokens
///                           "levelup": like "fresh", one minion tap short of level 2
///   -uitest-route NAME      push a screen after boot: cards, cards-training, cards-fusion, arena, pieces,
///                           replays, league, shop, character, settings, collections, help, lab, quest1,
///                           prebattle-quest1 (quest 1 played to its boss)
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
        "throat-cutter", "throat-cutter", "pouch-tearer", "bone-breaker", "falconer", "pikeman", "archer",
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
        if preset == "levelup" {
            // one stamina tap short of level 2 (47 xp needed at level 1, a quest-1 tap gives 2)
            try? store.updateState { s, _, _ in
                var next = s
                next.player.xp = 46
                return next
            }
        }
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
        guard let name = value(after: "-uitest-route") else { return }
        if name == "prebattle-quest1" {
            // quest 1 played to its boss: the pre-battle of the boss fight
            try? store.updateState { s, d, n in try QuestOps.startQuest(s, deps: d, now: n, line: "main", n: 1).state }
            var guardTaps = 0
            while !(store.state?.quests.active?.bossReady ?? true) && guardTaps < 40 {
                try? store.updateState { s, d, n in try QuestOps.tapMinion(s, deps: d, now: n, event: nil).state }
                guardTaps += 1
            }
            model.router.go(.prebattle(.questBoss(line: "main", n: 1)))
            return
        }
        if let route = route(named: name) {
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
        case "booster-neophyte": return .boosterOpen(booster: .neophyte, portalId: nil)
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

/// UI tests only: an invisible text whose accessibility label summarises the save ("deck:3;mana:24;cards:14"), so
/// the tests can assert that a drag really changed the deck (regression for the broken card dragging, 2026-10-11).
struct UITestStateReadout: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        Text(summary)
            .font(.system(size: 2))
            .foregroundColor(.clear)
            .frame(width: 2, height: 2)
            .allowsHitTesting(false)
            .accessibilityIdentifier("uitest-state")
            .accessibilityLabel(summary)
    }

    private var summary: String {
        guard let s = model.store.state else { return "nosave" }
        let deck = s.deck.compactMap { $0 }.count
        let mana = StateOps.deckMana(s, deps: model.deps)
        return "deck:\(deck);mana:\(mana);cards:\(s.cards.count);level:\(s.player.level);gold:\(s.player.gold);gems:\(s.player.gems)"
    }
}
