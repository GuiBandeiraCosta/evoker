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

    init(id: UUID = UUID(), mode: FightMode, title: String, events: [BattleEvent], result: BattleResult, attacker: FighterSide, defender: FighterSide,
         attackerName: String, defenderName: String, attackerAvatar: Int = 0, defenderAvatar: Int = 0, rewards: FightRewardsSummary = FightRewardsSummary(),
         levelUps: [Int] = [], levelUpDetails: [LevelUpDetail] = [], cardLevelUps: [CardLevelUp] = [], cardXp: Int = 0, skipAllowed: Bool = true,
         speed: Int = 1, completion: BattleCompletion) {
        self.id = id; self.mode = mode; self.title = title; self.events = events; self.result = result; self.attacker = attacker; self.defender = defender
        self.attackerName = attackerName; self.defenderName = defenderName; self.attackerAvatar = attackerAvatar; self.defenderAvatar = defenderAvatar
        self.rewards = rewards; self.levelUps = levelUps; self.levelUpDetails = levelUpDetails; self.cardLevelUps = cardLevelUps; self.cardXp = cardXp
        self.skipAllowed = skipAllowed; self.speed = speed; self.completion = completion
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
