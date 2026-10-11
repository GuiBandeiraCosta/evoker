import Foundation
import CoreGraphics
import EvokerCore

/// The client's post-battle timings (port of the constants of `src/ui/screens/battle-result-model.js`).
enum BattleResultTiming {
    /// fx_wonlost (ms): banner zoom, glow start, glow expansion, blur echo, fade; the flow continues at glowStart + glow.
    static let bannerZoom = 900.0
    static let bannerGlowStart = 660.0
    static let bannerGlow = 3000.0
    static let bannerBlur = 1200.0
    static let bannerFade = 2100.0
    static let bannerMs = bannerGlowStart + bannerGlow
    /// Card XP sequence (bosscardresult): one card per second, 500 ms fade, 150 ms bar tween.
    static let xpStaggerMs = 1000.0
    static let xpFadeMs = 500.0
    static let xpBarMs = 150.0
    /// reward_comp: animation speed, earliest tap that stops the animation.
    static let rewardSpeed = 1.2
    static let rewardTapAfterMs = 2000.0
    /// new_card_notify_comp: slide in (1200 ms), hold 3 s, slide out (1200 ms).
    static let setPlateIn = 1200.0
    static let setPlateHold = 3000.0
    static let setPlateOut = 1200.0
    /// The full card with the puzzle overlay after a card piece (ms, or until tapped).
    static let pieceCardMs = 1500.0
    /// comp_levelup_card: each step of the chain.
    static let levelUpStepMs = 500.0
    /// Fade to black after the result (battle.js VEIL_MS).
    static let veilMs = 350.0
    /// Stage px per client unit (720 / 320) and the stage centre.
    static let unit: CGFloat = 2.25
    static let cx: CGFloat = 360
    static let cy: CGFloat = 640
}

/// One loot step of a fight: a reward of rewards.js shape, `bonus` = the last portal quest's 1000 gold.
struct LootItem: Hashable {
    let reward: Reward
    let bonus: Bool
}

/// The pure part of the post-battle flow (port of `src/ui/screens/battle-result-model.js`): the loot of a fight
/// with its animation / sprite / sounds, the card XP bar entries and their layout, the card level-up rows and the
/// pieces of a hunt.
enum BattleResultModel {
    /// Keyframe animation per reward type (reward_comp): `rewardAnimName`.
    static func rewardAnimName(_ reward: Reward) -> String? {
        switch reward.type {
        case .gold: return "goldreward"
        case .gems: return "gemreward"
        case .potion: return reward.potion == .mana ? "manapotion" : "staminapotion"
        case .token: return "gemreward"
        case .card: return reward.converted == true ? "goldreward" : "cardreward"
        case .piece: return "cardreward"
        case .none: return nil
        }
    }

    /// The reward object reward_comp shows in the middle of its animation (`rewardIcon`): the coin pile, gem
    /// heap, potion, token. reward_token_1 = the gold hexagon (Archmage), _2 = the silver square (Summoner),
    /// _3 = the bronze disc (Neophyte); the portal tokens were server images: drawn as the shop's triangle (nil).
    static func rewardIcon(_ reward: Reward) -> String? {
        switch reward.type {
        case .gold: return "reward_gold"
        case .gems: return "reward_gems"
        case .potion: return reward.potion == .mana ? "reward_manapotion" : "reward_staminapotions"
        case .token:
            guard let kind = reward.token, !kind.isPortal else { return nil }
            switch kind {
            case .archmage: return "reward_token_1"
            case .summoner: return "reward_token_2"
            default: return "reward_token_3"
            }
        case .card: return reward.converted == true ? "reward_gold" : nil
        case .piece, .none: return nil
        }
    }

    /// Name of a token reward: "Neophyte token", or the portal's own token name ("Empyrean token") — `tokenName`.
    static func tokenName(_ reward: Reward, deps: Deps?) -> String {
        guard let kind = reward.token else { return "Neophyte token" }
        if kind.isPortal {
            if let d = deps, let portalId = reward.portalId, let line = QuestOps.questLine(deps: d, lineId: portalId),
               let info = line.tokens?.info(kind), !info.name.isEmpty {
                return info.name
            }
            return kind == .portalHigh ? "Grand portal token" : "Portal token"
        }
        switch kind {
        case .summoner: return "Summoner token"
        case .archmage: return "Archmage token"
        default: return "Neophyte token"
        }
    }

    /// Reward sounds (reward_comp playRewardAnimation / playRewardTakenAnimation) — `rewardSounds`.
    static func rewardSounds(_ reward: Reward) -> (show: String?, taken: String?) {
        switch reward.type {
        case .gold: return ("quest_reward_gold", "quest_reward_collect")
        case .gems: return ("quest_reward_gem", "quest_reward_collect")
        case .potion: return ("quest_reward_potion", "quest_reward_collect")
        case .token: return ("quest_reward_token", "quest_reward_collect")
        case .card: return (reward.converted == true ? "quest_reward_card_autosell" : "quest_reward_card", "quest_reward_collect")
        case .piece: return ("quest_reward_card", "quest_reward_collect")
        case .none: return (nil, nil)
        }
    }

    /// The loot of a fight for the reward step (`lootOf`): the fight's own reward (quest boss), else the piece /
    /// completed card of a piece fight, else the gold, else the gems of the fight; nil when nothing.
    static func lootOf(_ p: BattlePresentation) -> Reward? {
        if let r = p.rewards.reward, r.type != .none { return r }
        if let r = p.rewards.piece, r.type != .none { return r }
        if p.rewards.gold > 0 { return .gold(p.rewards.gold) }
        if p.rewards.gems > 0 { return .gems(p.rewards.gems) }
        return nil
    }

    /// Every loot step of a fight, in order (`lootList`): the fight's reward, then the last portal quest's 1000
    /// gold bonus as its own coin step.
    static func lootList(_ p: BattlePresentation) -> [LootItem] {
        var out: [LootItem] = []
        if let main = lootOf(p) { out.append(LootItem(reward: main, bonus: false)) }
        if p.rewards.bonusGold > 0 { out.append(LootItem(reward: .gold(p.rewards.bonusGold), bonus: true)) }
        return out
    }

    // MARK: card XP

    /// One XP bar state: level, xp towards the next level, the need, at the cap, fill ratio.
    struct XpBar: Hashable {
        let level: Int
        let xp: Int
        let need: Int
        let max: Bool
        let ratio: Double
    }

    struct XpEntry: Hashable {
        let uid: String
        let cardId: String
        let stage: Int
        let name: String
        let from: XpBar
        let to: XpBar
        let levelled: Bool
        let levelUp: CardLevelUp?
    }

    private static func bar(_ def: CardDef, deps: Deps, level: Int, xp: Int, cap: Int, stage: Int) -> XpBar {
        let atMax = level >= cap
        let need = atMax ? 0 : deps.stats.cardXpToNext(def, level: level, stage: stage)
        let ratio: Double = (atMax || need <= 0) ? 0 : Swift.max(0, Swift.min(1, Double(xp) / Double(need)))
        return XpBar(level: level, xp: atMax ? 0 : xp, need: need, max: atMax, ratio: ratio)
    }

    /// XP bar entries of the deck cards: level and XP before and after the fight (`xpEntries`).
    static func xpEntries(before: [DeckCardSnapshot], state: GameState?, deps: Deps, levelUps: [CardLevelUp]) -> [XpEntry] {
        var out: [XpEntry] = []
        for b in before {
            guard let def = deps.db.get(b.cardId) else { continue }
            let now = state?.cards.first { $0.uid == b.uid }
            let afterStage = now?.stage ?? b.stage
            let afterLevel = now?.level ?? b.level
            let afterXp = now?.xp ?? b.xp
            let cap = CollectionOps.capFor(deps: deps, def: def, stage: afterStage)
            let capBefore = CollectionOps.capFor(deps: deps, def: def, stage: b.stage)
            let lu = levelUps.first { $0.uid == b.uid }
            let from = bar(def, deps: deps, level: b.level, xp: b.xp, cap: capBefore, stage: b.stage)
            let to = bar(def, deps: deps, level: afterLevel, xp: afterXp, cap: cap, stage: afterStage)
            let levelled = to.level > from.level
            out.append(XpEntry(uid: b.uid, cardId: b.cardId, stage: afterStage, name: def.name, from: from, to: to, levelled: levelled,
                               levelUp: lu ?? (levelled ? CardLevelUp(uid: b.uid, from: from.level, to: to.level) : nil)))
        }
        return out
    }

    /// The deck before the fight, reconstructed from the save after it when the presentation carries no snapshot:
    /// the level before comes from the card level-ups, the xp before = xp after + the thresholds crossed − the
    /// fight's card xp (exact unless the card hit its cap, where the engine zeroes the pool).
    static func reconstructedDeckBefore(state: GameState, deps: Deps, cardXp: Int, levelUps: [CardLevelUp]) -> [DeckCardSnapshot] {
        var out: [DeckCardSnapshot] = []
        for uid in state.deck {
            guard let u = uid, let inst = state.cards.first(where: { $0.uid == u }), let def = deps.db.get(inst.cardId) else { continue }
            let lu = levelUps.first { $0.uid == u }
            let fromLevel = lu?.from ?? inst.level
            var pool = inst.xp
            if let l = lu, l.to > l.from {
                for level in l.from..<l.to { pool += deps.stats.cardXpToNext(def, level: level, stage: inst.stage) }
            }
            pool = Swift.max(0, pool - Swift.max(0, cardXp))
            out.append(DeckCardSnapshot(uid: u, cardId: inst.cardId, stage: inst.stage, level: fromLevel, xp: pool, evolveQuality: inst.evolveQuality))
        }
        return out
    }

    /// Label of an XP bar ("Level #level#" / "Level #level# (MAX)").
    static func levelText(_ bar: XpBar) -> String {
        bar.max ? "Level \(bar.level) (MAX)" : "Level \(bar.level)"
    }

    /// Position of card entry i (0-based) of the result screen (scene_pvp_result_layout): rows at -120, -60, 0,
    /// 60, 120 client units from the centre; entries 1, 3, 5 have the card left (-100) and the bar right of it,
    /// entries 2 and 4 the card right (+100) and the bar left of it. Card centre in stage px (y of the 1280 design).
    struct EntryLayout: Hashable {
        let x: CGFloat
        let y: CGFloat
        let right: Bool
    }

    static func entryLayout(_ i: Int) -> EntryLayout {
        let right = i % 2 == 1
        let x = (BattleResultTiming.cx + (right ? 100 : -100) * BattleResultTiming.unit).rounded()
        let y = (BattleResultTiming.cy + (-120 + 60 * CGFloat(i)) * BattleResultTiming.unit).rounded()
        return EntryLayout(x: x, y: y, right: right)
    }

    // MARK: card level-up popup

    enum LevelUpRowKind: String {
        case level, attack, hp, skill

        /// hud_experienceicon01 / hud_fighticon02 / hud_healthicon01 / hud_specialskill01.
        var icon: String {
            switch self {
            case .level: return "hud_experienceicon01"
            case .attack: return "hud_fighticon02"
            case .hp: return "hud_healthicon01"
            case .skill: return "hud_specialskill01"
            }
        }
    }

    struct LevelUpRow: Hashable {
        let kind: LevelUpRowKind
        let from: Double
        let to: Double
    }

    /// Rows of the card level-up popup: level, attack, HP and (when the card has an ability value) skill
    /// (`levelUpRows`).
    static func levelUpRows(deps: Deps, cardId: String, stage: Int, evolveQuality: Double, from: Int, to: Int) -> [LevelUpRow] {
        guard let def = deps.db.get(cardId) else { return [LevelUpRow(kind: .level, from: Double(from), to: Double(to))] }
        let a = deps.stats.statsAt(def, stage: stage, level: from, evolveQuality: evolveQuality)
        let b = deps.stats.statsAt(def, stage: stage, level: to, evolveQuality: evolveQuality)
        var rows = [
            LevelUpRow(kind: .level, from: Double(from), to: Double(to)),
            LevelUpRow(kind: .attack, from: Double(a.attack), to: Double(b.attack)),
            LevelUpRow(kind: .hp, from: Double(a.hp), to: Double(b.hp)),
        ]
        if let aa = a.ability, let bb = b.ability, aa != 0 || bb != 0 {
            rows.append(LevelUpRow(kind: .skill, from: aa, to: bb))
        }
        return rows
    }

    /// Pieces of the hunt a piece reward went to (`pieceProgress`): the overlay of the full card, or nil.
    struct PieceProgress: Hashable {
        let owned: Int
        let total: Int
    }

    static func pieceProgress(state: GameState?, reward: Reward) -> PieceProgress? {
        guard let hunts = state?.pieces, let cardId = reward.cardId else { return nil }
        var hunt: PieceHunt? = nil
        if let i = reward.huntIndex, i >= 0, i < hunts.count, hunts[i].cardId == cardId {
            hunt = hunts[i]
        } else {
            hunt = hunts.first { $0.cardId == cardId }
        }
        guard let h = hunt, h.total > 0 else { return nil }
        return PieceProgress(owned: Swift.max(0, Swift.min(h.total, h.owned)), total: h.total)
    }

    /// The number formatting of the result screens (`fmt`: thousands separators).
    static func fmt(_ n: Double) -> String {
        let v = n.rounded(.towardZero) == n ? n : (n * 10).rounded() / 10
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.groupingSeparator = ","
        f.maximumFractionDigits = v == v.rounded(.towardZero) ? 0 : 1
        return f.string(from: NSNumber(value: v)) ?? String(Int(v))
    }

    static func fmt(_ n: Int) -> String { fmt(Double(n)) }
}
