import Foundation
import EvokerCore

/// Everything the battle screen needs to play a fight and show its result (the web's `battle` screen params:
/// `{ events, result, attacker, defender, rewards, levelUps, cardLevelUps, onDone }`). Built by the pre-battle
/// screen from the typed fight results, stored in `AppModel.pendingBattles` and referenced by `Route.battle(id:)`.
struct BattlePresentation: Identifiable {
    let id: UUID
    let mode: FightMode
    let title: String
    let events: [BattleEvent]
    let result: BattleResult
    /// The sides as fought (for the card faces: ids, stages, levels, art).
    let attacker: FighterSide
    let defender: FighterSide
    /// Names and portraits of the two players (the attacker is the human).
    let attackerName: String
    let defenderName: String
    let attackerAvatar: Int
    let defenderAvatar: Int
    /// Loot and progression to show after the banner.
    let rewards: FightRewardsSummary
    let levelUps: [Int]
    let levelUpDetails: [LevelUpDetail]
    let cardLevelUps: [CardLevelUp]
    /// Card XP each deck card received (0 for a replay / lab fight).
    let cardXp: Int
    /// "Skip fight" is offered (from the main-line quest-3 boss on; always in PvP, portals, replays, lab).
    let skipAllowed: Bool
    /// Playback speed from the settings (1 or 2).
    let speed: Int
    /// Where to go when the result flow ends (the pre-battle's `onDone`).
    let completion: BattleCompletion
    /// The deck's cards before the fight (prebattle.js `deckSnapshot`), for the post-fight XP bars; empty = the
    /// result view reconstructs the "before" values from the save after the fight and `cardXp` / `cardLevelUps`.
    let deckBefore: [DeckCardSnapshot]
    /// Sprite stem of the defender's portrait (a boss portrait); nil = the avatar sprite of `defenderAvatar`.
    let defenderPortrait: String?
    /// Backdrop theme id (battle.js THEMES: valley, sunset, swamp, lava); nil = derived from the mode and line.
    let theme: String?

    init(id: UUID = UUID(), mode: FightMode, title: String, events: [BattleEvent], result: BattleResult, attacker: FighterSide, defender: FighterSide,
         attackerName: String, defenderName: String, attackerAvatar: Int = 0, defenderAvatar: Int = 0, rewards: FightRewardsSummary = FightRewardsSummary(),
         levelUps: [Int] = [], levelUpDetails: [LevelUpDetail] = [], cardLevelUps: [CardLevelUp] = [], cardXp: Int = 0, skipAllowed: Bool = true,
         speed: Int = 1, completion: BattleCompletion, deckBefore: [DeckCardSnapshot] = [], defenderPortrait: String? = nil, theme: String? = nil) {
        self.id = id; self.mode = mode; self.title = title; self.events = events; self.result = result; self.attacker = attacker; self.defender = defender
        self.attackerName = attackerName; self.defenderName = defenderName; self.attackerAvatar = attackerAvatar; self.defenderAvatar = defenderAvatar
        self.rewards = rewards; self.levelUps = levelUps; self.levelUpDetails = levelUpDetails; self.cardLevelUps = cardLevelUps; self.cardXp = cardXp
        self.skipAllowed = skipAllowed; self.speed = speed; self.completion = completion
        self.deckBefore = deckBefore; self.defenderPortrait = defenderPortrait; self.theme = theme
    }
}

/// One deck card as it was before a fight (prebattle.js `deckSnapshot`): level and XP for the result's XP bars.
struct DeckCardSnapshot: Hashable {
    let uid: String
    let cardId: String
    let stage: Int
    let level: Int
    let xp: Int
    let evolveQuality: Double

    init(uid: String, cardId: String, stage: Int, level: Int, xp: Int, evolveQuality: Double = 1) {
        self.uid = uid; self.cardId = cardId; self.stage = stage; self.level = level; self.xp = xp; self.evolveQuality = evolveQuality
    }

    init(_ inst: CardInstance) {
        self.init(uid: inst.uid, cardId: inst.cardId, stage: inst.stage, level: inst.level, xp: inst.xp, evolveQuality: inst.evolveQuality)
    }

    /// The deck cards of a save in slot order (`deckSnapshot(state)`).
    static func deck(of state: GameState) -> [DeckCardSnapshot] {
        state.deck.compactMap { uid -> DeckCardSnapshot? in
            guard let u = uid, let inst = state.cards.first(where: { $0.uid == u }) else { return nil }
            return DeckCardSnapshot(inst)
        }
    }
}

/// What happens after the result popup (the web's `onDone(info)` per mode).
enum BattleCompletion: Hashable {
    /// Back to the quest map (shows unlock popups and the level-up dialogs owed).
    case questMap(line: String)
    case arena(tab: ArenaTab)
    case league
    case replays
    case lab
}
