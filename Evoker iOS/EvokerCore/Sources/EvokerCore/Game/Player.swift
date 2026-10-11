import Foundation

/// Character: xp, level-ups and their rewards, stat points, regeneration, potions, currencies and tokens
/// (game-design §3, §7): a literal port of `Evoker Web/src/game/player.js`.
public enum PlayerOps {
    public static let maxLevel = Constants.maxPlayerLevel
    public static let statPointsPerLevel = Constants.statPointsPerLevel
    public static let hpPerPoint = Constants.statPointValue.hp
    public static let staminaPerPoint = Constants.statPointValue.stamina
    public static let manaPerPoint = Constants.statPointValue.mana
    public static let regenMs = Constants.regenIntervalMs
    public static let questBossPlayerXp = Constants.BattleXp.player.questBoss

    /// Regenerate 1 stamina and 1 mana per full real minute since `regenAt`, up to the max (`applyRegen`). Full
    /// bars still advance `regenAt` so time is never "banked".
    public static func applyRegen(_ state: GameState, now: Int64) -> GameState {
        let p = state.player
        let from = p.regenAt != 0 ? p.regenAt : now
        if now <= from { return state }
        let ticks = (now - from) / regenMs
        if ticks <= 0 { return state }
        var s = state
        s.player.stamina = min(p.staminaMax, p.stamina + Int(ticks))
        s.player.mana = min(p.manaMax, p.mana + Int(ticks))
        s.player.regenAt = from + ticks * regenMs
        return s
    }

    /// Player xp of one PvP fight (`playerFightXp`): round((1.5 + 0.5 × level) × (4 on a win)).
    public static func playerFightXp(opponentLevel: Int, won: Bool) -> Int {
        let b = Constants.BattleXp.player
        let xp = b.base + b.perOpponentLevel * Double(max(0, opponentLevel))
        return JSMath.roundInt(won ? xp * b.winMult : xp)
    }

    /// Card xp per deck card for one fight (`cardFightXp`): round((10 + enemyMana / 2) × 1.5 on a win × 2 on Infinite Wisdom).
    public static func cardFightXp(enemyDeckMana: Int, won: Bool, infiniteWisdom: Bool) -> Int {
        let c = Constants.BattleXp.card
        var xp = c.base + Double(enemyDeckMana) / c.enemyManaDiv
        if won { xp *= c.winMult }
        if infiniteWisdom { xp *= c.wisdomMult }
        return JSMath.roundInt(xp)
    }

    /// Rewards of reaching `level` (`levelUpRewards`): gold = 50 × level (L4: 150), plus one extra repeating every
    /// 5 levels (gems, stamina potion, stamina potion, mana potion, Neophyte token).
    public static func levelUpRewards(level: Int) -> LevelUpRewards {
        let L = level
        var out = LevelUpRewards(level: L, gold: 0, gems: 0, potions: [], tokens: [])
        if L < 2 { return out }
        let R = Constants.LevelUpRewardsTable.self
        out.gold = R.goldOverrides[L] ?? R.goldPerLevel * L
        let extra = R.cycle[(L - 2) % R.cycle.count]
        switch extra {
        case .gems: out.gems = L == 2 ? R.firstGems : R.gems
        case .potion(let kind): out.potions.append(kind)
        case .token(let kind): out.tokens.append(kind)
        }
        return out
    }

    /// Grant the rewards of a level-up to a player record (`grantLevelRewards`).
    static func grantLevelRewards(_ p: inout PlayerState, _ r: LevelUpRewards) {
        p.gold += r.gold
        p.gems += r.gems
        for kind in r.potions {
            if kind == .mana { p.manaPotions += 1 } else { p.staminaPotions += 1 }
        }
        for id in r.tokens {
            switch id {
            case .neophyte: p.tokens.neophyte += 1
            case .summoner: p.tokens.summoner += 1
            case .archmage: p.tokens.archmage += 1
            case .portalLow, .portalHigh: break   // never in the cycle (the web would corrupt the bag object)
            }
        }
    }

    /// Add player xp and apply every level-up (`addPlayerXp`): +12 stat points, stamina and mana refilled to
    /// their max, and the level's rewards added.
    public static func addPlayerXp(_ state: GameState, deps: Deps, amount: Int) -> (state: GameState, info: XpResult) {
        let xp = max(0, amount)
        var p = state.player
        var levelUps: [Int] = []
        var details: [LevelUpDetail] = []
        var gold = 0, gems = 0
        if p.level >= maxLevel { return (state, XpResult(levelUps: [], levelUpDetails: [], gold: 0, gems: 0, xp: 0)) }
        p.xp += xp
        while p.level < maxLevel {
            guard let need = deps.stats.playerXpToNext(level: p.level) else { break }
            if p.xp < need { break }
            p.xp -= need
            p.level += 1
            p.statPoints += statPointsPerLevel
            p.stamina = max(p.stamina, p.staminaMax)
            p.mana = max(p.mana, p.manaMax)
            let rewards = levelUpRewards(level: p.level)
            grantLevelRewards(&p, rewards)
            gold += rewards.gold
            gems += rewards.gems
            levelUps.append(p.level)
            details.append(LevelUpDetail(level: p.level, rewards: rewards, statPoints: statPointsPerLevel,
                                         unlocked: StateOps.featuresUnlockedAt(level: p.level, state: state)))
        }
        if p.level >= maxLevel { p.xp = 0 }
        var s = state
        s.player = p
        return (s, XpResult(levelUps: levelUps, levelUpDetails: details, gold: gold, gems: gems, xp: xp))
    }

    /// What a point allocation would give, without applying it (`previewStatPoints`).
    public static func previewStatPoints(_ state: GameState, alloc: StatAlloc) -> StatPointsPreview {
        let p = state.player
        let s = max(0, alloc.stamina), m = max(0, alloc.mana), h = max(0, alloc.hp)
        let spent = s + m + h
        return StatPointsPreview(ok: spent <= p.statPoints, spent: spent, pointsLeft: p.statPoints - spent,
                                 hpMax: p.hpMax + h * hpPerPoint, staminaMax: p.staminaMax + s * staminaPerPoint,
                                 manaMax: p.manaMax + m * manaPerPoint)
    }

    /// Spend unspent stat points (`spendStatPoints`); the current stamina and mana grow with their max.
    public static func spendStatPoints(_ state: GameState, alloc: StatAlloc) throws -> GameState {
        let pv = previewStatPoints(state, alloc: alloc)
        if pv.spent == 0 { return state }
        if !pv.ok { throw GameError("Not enough stat points") }
        let p = state.player
        var s = state
        s.player.statPoints = pv.pointsLeft
        s.player.staminaMax = pv.staminaMax
        s.player.stamina = p.stamina + (pv.staminaMax - p.staminaMax)
        s.player.manaMax = pv.manaMax
        s.player.mana = p.mana + (pv.manaMax - p.manaMax)
        s.player.hpMax = pv.hpMax
        return s
    }

    /// The clock the daily event follows (`eventClock`): the real clock moved forward by `daily.dayShift` days.
    public static func eventClock(_ state: GameState?, now: Int64) -> Int64 {
        let shift = Int64(state?.daily.dayShift ?? 0)
        return now + shift * JSDate.dayMs
    }

    /// Apply the Golden Day event (`goldWithEvent`): +50 % gold.
    public static func goldWithEvent(_ gold: Int, event: DailyEventId?) -> Int {
        JSMath.roundInt(event == .goldenDay ? Double(gold) * 1.5 : Double(gold))
    }

    /// Gem price of a potion bought from the Drink-potion dialog (`potionPrice`).
    public static func potionPrice(event: DailyEventId?) -> Int {
        event == .drinkingContest ? Constants.potionPriceGemsEvent : Constants.potionPriceGems
    }

    /// Decision helper for the "Drink potion" dialog (`needsPotion`).
    public static func needsPotion(_ state: GameState, kind: PotionKind, amount: Int, event: DailyEventId?) -> NeedsPotion {
        let p = state.player
        let have = kind == .mana ? p.mana : p.stamina
        let potions = kind == .mana ? p.manaPotions : p.staminaPotions
        let price = potionPrice(event: event)
        let missing = max(0, amount - have)
        return NeedsPotion(needed: missing > 0, kind: kind, have: have, missing: missing, hasPotion: potions > 0,
                           potions: potions, price: price, canBuy: p.gems >= price)
    }

    /// Use one potion: refill the bar to its max (`drinkPotion`).
    public static func drinkPotion(_ state: GameState, kind: PotionKind) throws -> GameState {
        let p = state.player
        var s = state
        if kind == .mana {
            if p.manaPotions <= 0 { throw GameError("No mana potion") }
            s.player.manaPotions = p.manaPotions - 1
            s.player.mana = p.manaMax
            return s
        }
        if p.staminaPotions <= 0 { throw GameError("No stamina potion") }
        s.player.staminaPotions = p.staminaPotions - 1
        s.player.stamina = p.staminaMax
        return s
    }

    /// Buy a potion for gems and drink it immediately (`buyAndDrinkPotion`).
    public static func buyAndDrinkPotion(_ state: GameState, kind: PotionKind, event: DailyEventId?) throws -> GameState {
        let price = potionPrice(event: event)
        if state.player.gems < price { throw GameError("Not enough gems") }
        var s = state
        s.player.gems = state.player.gems - price
        if kind == .mana { s.player.mana = s.player.manaMax } else { s.player.stamina = s.player.staminaMax }
        return s
    }

    /// Add potions to the inventory (`addPotions`).
    public static func addPotions(_ state: GameState, kind: PotionKind, count: Int) -> GameState {
        var s = state
        if kind == .mana { s.player.manaPotions = state.player.manaPotions + count } else { s.player.staminaPotions = state.player.staminaPotions + count }
        return s
    }

    /// Spend stamina (`spendStamina`); throws when short.
    public static func spendStamina(_ state: GameState, amount: Int) throws -> GameState {
        if state.player.stamina < amount { throw GameError("Not enough stamina") }
        var s = state
        s.player.stamina = state.player.stamina - amount
        return s
    }

    /// Spend mana (`spendMana`); throws when short.
    public static func spendMana(_ state: GameState, amount: Int) throws -> GameState {
        if state.player.mana < amount { throw GameError("Not enough mana") }
        var s = state
        s.player.mana = state.player.mana - amount
        return s
    }

    /// Add gold, never negative (`addGold`).
    public static func addGold(_ state: GameState, amount: Int) -> GameState {
        var s = state
        s.player.gold = max(0, state.player.gold + amount)
        return s
    }

    /// Spend gold (`spendGold`); throws when short.
    public static func spendGold(_ state: GameState, amount: Int) throws -> GameState {
        if state.player.gold < amount { throw GameError("Not enough gold") }
        var s = state
        s.player.gold = state.player.gold - amount
        return s
    }

    /// Add gems, never negative (`addGems`).
    public static func addGems(_ state: GameState, amount: Int) -> GameState {
        var s = state
        s.player.gems = max(0, state.player.gems + amount)
        return s
    }

    /// Spend gems (`spendGems`); throws when short.
    public static func spendGems(_ state: GameState, amount: Int) throws -> GameState {
        if state.player.gems < amount { throw GameError("Not enough gems") }
        var s = state
        s.player.gems = state.player.gems - amount
        return s
    }

    /// Add booster tokens (`addTokens`); `portalId` is required for the portal kinds (a missing one lands in the
    /// "undefined" bag like the web).
    public static func addTokens(_ state: GameState, kind: TokenKind, count: Int, portalId: String?) -> GameState {
        var s = state
        switch kind {
        case .neophyte: s.player.tokens.neophyte = state.player.tokens.neophyte + count
        case .summoner: s.player.tokens.summoner = state.player.tokens.summoner + count
        case .archmage: s.player.tokens.archmage = state.player.tokens.archmage + count
        case .portalLow:
            let key = portalId ?? "undefined"
            s.player.tokens.portalLow[key] = (state.player.tokens.portalLow[key] ?? 0) + count
        case .portalHigh:
            let key = portalId ?? "undefined"
            s.player.tokens.portalHigh[key] = (state.player.tokens.portalHigh[key] ?? 0) + count
        }
        return s
    }

    /// Number of tokens of a kind (`tokenCount`).
    public static func tokenCount(_ state: GameState, kind: TokenKind, portalId: String?) -> Int {
        state.player.tokens.count(kind, portalId: portalId)
    }

    /// Change the player's name (trimmed, max 20) and/or avatar (0..11) (`editProfile`).
    public static func editProfile(_ state: GameState, name: String?, avatar: Int?) -> GameState {
        var s = state
        if let n = name {
            let t = JSString.trim(n)
            if !t.isEmpty { s.player.name = JSString.slice(t, 20) }
        }
        if let a = avatar, a >= 0, a < 12 { s.player.avatar = a }
        return s
    }
}
