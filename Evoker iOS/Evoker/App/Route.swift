import Foundation
import EvokerCore

/// The screens of the game (architecture.md §8.3) as a value the router pushes onto a `NavigationStack` path.
/// One-shot presentation data (a boss intro to play, a battle to show) is keyed by id and kept in `AppModel`
/// so routes stay `Hashable`.
enum Route: Hashable {
    case title
    /// `line` nil = the main map; `feed` = the landing feed.
    case questMap(line: String? = nil, feed: Bool = false)
    case quest(line: String, n: Int)
    case bossIntro(line: String, n: Int)
    case prebattle(FightRequest)
    /// The id of a `BattlePresentation` stored in `AppModel.pendingBattles`.
    case battle(id: UUID)
    case cards(tab: CardsTab = .deck)
    case cardDetail(CardDetailTarget)
    case collections(set: String? = nil)
    case arena(tab: ArenaTab = .arena)
    case league
    case shop(gems: Bool = false)
    case boosterOpen(booster: TokenKind, portalId: String? = nil)
    case character(tab: CharacterTab = .profile)
    case help(topic: String)
    case lab
}

enum CardsTab: String, Hashable { case deck, training, fusion }
enum ArenaTab: String, Hashable { case arena, pieces, replays }
enum CharacterTab: String, Hashable { case profile, daily, settings }

/// What the card-detail screen shows: an owned card, or a catalog card at a stage / level.
enum CardDetailTarget: Hashable {
    case owned(uid: String)
    case catalog(cardId: String, stage: Int, level: Int)
}

/// Which fight the pre-battle screen prepares (replaces the web's `fight` / `onDone` closures).
enum FightRequest: Hashable {
    /// The boss of the active quest (`line`, `n` are informational; the active quest is in the save).
    case questBoss(line: String, n: Int)
    case arena(offerIndex: Int)
    case pieces(huntIndex: Int)
    case league(simId: String)
    case replay(index: Int)
    /// Card Lab: any line-ups, no save change.
    case lab(seed: UInt32)
}

/// The bottom navigation ids (`chrome.navTarget`).
enum NavItem: String, CaseIterable, Hashable {
    case league, arena, quest, cards, shop
}
