import Foundation

/// Stat formulas (`src/core/stats.js`): stat growth per stage / level (architecture.md §3.2), XP curves, sell value,
/// fusion cost, sacrifice XP and the evolve bonus (game-design.md §2–3). Pure functions, memoised per card like the
/// web's WeakMap; every power uses `JSMath.pow` (V8's `Math.pow`) so the rounded numbers equal the web's bit for bit.
public struct Stats: StatsProviding {
    public init() {}

    private static let statKeys: [StatKey] = [.attack, .hp, .ability]

    /// Per-card memo of unscaled stat values and fallback scales (the web's module-level WeakMap).
    private final class Cache {
        struct Entry {
            var raw: [String: Double] = [:]
            var scale: [StatKey: Double] = [:]
        }
        private var perCard: [CardDef: Entry] = [:]
        private let lock = NSLock()

        func withEntry<T>(_ card: CardDef, _ body: (inout Entry) -> T) -> T {
            lock.lock()
            defer { lock.unlock() }
            var entry = perCard[card] ?? Entry()
            let result = body(&entry)
            perCard[card] = entry
            return result
        }
    }

    private static let cache = Cache()

    /// True when `stat` is a flat (non-growing) stat of the card (Scrapmaster's attack 1, Blood Spitter's
    /// self-damage 100, Bone Dragon's per-stage attack) — `isFlatStat`.
    public static func isFlatStat(_ card: CardDef, _ stat: StatKey) -> Bool {
        if stat == .ability && card.abilityFlat == true { return true }
        return card.flat?.contains(stat) ?? false
    }

    private static func rarityDef(_ rarity: Rarity) -> Constants.RarityDef {
        Constants.rarity(rarity)
    }

    /// `assertStage`: the web throws a RangeError for a stage outside 0...4 (programmer error).
    private static func assertStage(_ stage: Int) {
        precondition(stage >= 0 && stage <= Constants.maxStage, "Invalid fusion stage \(stage)")
    }

    /// Ratios of a stat's known cap values to the rarity's median multiplier table (`knownRatios`): flat, percent and
    /// base-0 stats have no ratio; a wiki cap below the stage's level-1 value is bad data and is skipped.
    static func knownRatios(_ card: CardDef, _ stat: StatKey) -> [Double] {
        guard let base = card.base.value(stat), base > 0, !isFlatStat(card, stat), !(stat == .ability && card.isPercentAbility) else { return [] }
        let growth = card.growth.values(stat)
        let table = rarityDef(card.rarity).growth
        var out: [Double] = []
        for (s, v) in growth.enumerated() {
            guard let v, v.isFinite, s < table.count, v >= base * JSMath.pow(Constants.fusionResetFactor, Double(s)) else { continue }
            out.append(v / (base * table[s]))
        }
        return out
    }

    /// Scale applied to the rarity multiplier when a cap value is unknown (`fallbackScale`): the median of the stat's
    /// own known ratios, else of the card's other growing stats, else 1. Memoised under "scale|<stat>".
    private static func fallbackScale(_ card: CardDef, _ stat: StatKey, _ entry: inout Cache.Entry) -> Double {
        if let scale = entry.scale[stat] { return scale }
        var ratios = knownRatios(card, stat)
        if ratios.isEmpty {
            ratios = statKeys.filter { $0 != stat }.flatMap { knownRatios(card, $0) }
        }
        let scale: Double
        if !ratios.isEmpty {
            let sorted = ratios.sorted { $0 < $1 }
            let mid = sorted.count >> 1
            scale = sorted.count % 2 == 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
        } else {
            scale = 1
        }
        entry.scale[stat] = scale
        return scale
    }

    /// Level cap of a card at a fusion stage (card.caps wins over the rarity table) — `capFor`.
    public static func capFor(_ card: CardDef, stage: Int) -> Int {
        assertStage(stage)
        if stage < card.caps.count { return card.caps[stage] }
        return rarityDef(card.rarity).caps[stage]
    }

    /// Unscaled stat value (before the evolve bonus), computed per architecture.md §3.2 (`computeRaw`).
    private static func computeRaw(_ card: CardDef, _ stat: StatKey, _ stage: Int, _ level: Int, _ entry: inout Cache.Entry) -> Double {
        let base = card.base.value(stat) ?? 0
        let isAbility = stat == .ability
        let growth = card.growth.values(stat)
        let stageGrowth: Double? = stage < growth.count ? growth[stage] : nil
        // Flat stats never grow with the level; they may still change per fusion stage when the wiki lists a stage value.
        if isFlatStat(card, stat) {
            if let v = stageGrowth, v.isFinite { return v }
            return base
        }
        let isPercent = isAbility && card.isPercentAbility
        let cap = capFor(card, stage: stage)
        let lvl = Swift.min(Swift.max(1, level), cap)
        let t: Double = cap > 1 ? Double(lvl - 1) / Double(cap - 1) : 0
        var capValue: Double
        if let v = stageGrowth, v.isFinite {
            capValue = v
        } else {
            // Unknown cap: the rarity's median multiplier, scaled to the card's own known checkpoints (percentages unscaled).
            capValue = base * rarityDef(card.rarity).growth[stage] * (isPercent ? 1 : fallbackScale(card, stat, &entry))
        }
        // Base 0 (Cursed Stag, Bouncer attack): grow from 0 to the stage's cap value when the wiki lists one.
        if base == 0 { return capValue > 0 ? JSMath.round(capValue * JSMath.pow(t, Constants.growthExponent)) : 0 }
        // Percentages restart each stage at the base percentage: the ×1.15 fusion reset only applies to point values.
        let start = isPercent ? base : base * JSMath.pow(Constants.fusionResetFactor, Double(stage))
        if start > capValue { capValue = start * Constants.badCapFactor }
        let raw = start + (capValue - start) * JSMath.pow(t, Constants.growthExponent)
        return isPercent ? JSMath.round(raw * 10) / 10 : JSMath.round(raw)
    }

    /// Value of a stat for a card at a fusion stage and level (`statAt`); nil when the card has no such stat.
    public static func statAt(_ card: CardDef, _ stat: StatKey, stage: Int, level: Int, evolveQuality: Double = 1) -> Double? {
        guard card.base.value(stat) != nil else { return nil }
        assertStage(stage)
        let key = "\(stat.rawValue)|\(stage)|\(level)"
        let raw: Double = cache.withEntry(card) { entry in
            if let v = entry.raw[key] { return v }
            let v = computeRaw(card, stat, stage, level, &entry)
            entry.raw[key] = v
            return v
        }
        if evolveQuality == 1 || isFlatStat(card, stat) { return raw }
        let scaled = raw * evolveQuality
        return stat == .ability && card.isPercentAbility ? JSMath.round(scaled * 10) / 10 : JSMath.round(scaled)
    }

    /// Card XP needed to go from `level` to `level + 1` (`cardXpToNext`): max(20, round(40 × mana × level^1.5 / 10)),
    /// and for an unfused Common or Standard card at least CARD_XP_CURVE.low (105 for level 1, 180 from level 2).
    public static func cardXpToNext(_ card: CardDef, level: Int, stage: Int = 0) -> Int {
        let c = Constants.cardXpCurve
        let l = Double(Swift.max(1, level))
        let curve = Swift.max(c.min, JSMath.roundInt(((c.k * Double(card.mana)) * JSMath.pow(l, c.exp)) / c.div))
        if !c.lowRarities.contains(card.rarity) || stage > 0 { return curve }
        return Swift.max(curve, c.low[Swift.min(Int(l.rounded(.down)), c.low.count) - 1])
    }

    /// Player XP needed to go from `level` to `level + 1` (`playerXpToNext`): round(50 × level^0.875), levels 1–4
    /// from the low table; nil (Infinity) at the level cap.
    public static func playerXpToNext(level: Int) -> Int? {
        if level >= Constants.maxPlayerLevel { return nil }
        let c = Constants.playerXpCurve
        let lv = Swift.max(1, level)
        if lv <= c.low.count { return c.low[lv - 1] }
        return JSMath.roundInt(c.k * JSMath.pow(Double(Swift.max(1, level)), c.exp))
    }

    /// Gold obtained by selling a card (`sellValue`): k × mana × (base + level + perFusion × stage) by rarity.
    public static func sellValue(_ card: CardDef, stage: Int, level: Int) -> Int {
        assertStage(stage)
        let sell = rarityDef(card.rarity).sell
        return JSMath.roundInt((sell.k * Double(card.mana)) * Double(sell.base + Swift.max(1, level) + sell.perFusion * stage))
    }

    /// Gold cost of fusing two cards of `rarity` at `stage` into stage + 1 (`fusionCost`; stage 0...3).
    public static func fusionCost(rarity: Rarity, stage: Int) -> Int {
        precondition(stage >= 0 && stage < Constants.maxStage, "Cannot fuse from stage \(stage)")
        return rarityDef(rarity).fusionCosts[stage]
    }

    /// XP granted by sacrificing a card (`sacrificeXp`): 25 × mana × (level + 2) × rarityFactor; trainers fixed.
    public static func sacrificeXp(_ card: CardDef, stage: Int, level: Int) -> Int {
        assertStage(stage)
        if let fixed = Constants.trainerXp[card.id] { return fixed }
        let s = Constants.sacrifice
        return JSMath.roundInt(((s.k * Double(card.mana)) * Double(Swift.max(1, level) + s.levelOffset)) * rarityDef(card.rarity).sacrificeFactor)
    }

    /// Gold price of sacrificing one card in a training session (`enhancePrice`, the client's getEnhancePrice):
    /// ceil((mana × 25 + (level − 1) × 50) × (1 + raritySellFactor / 10) × 2), in the client's operation order.
    public static func enhancePrice(_ card: CardDef, level: Int) -> Int {
        let c = Constants.EnhancePrice.self
        let sellFactor = c.raritySellFactor[card.rarity] ?? 1
        var price = Double(card.mana) * c.costManaFactor
        price = price + Double(Swift.max(1, level == 0 ? 1 : level) - 1) * c.costLevelFactor
        price = price * (1 + sellFactor / c.costRarityDivisor)
        price = price * c.rarityEnhanceFactor
        return JSMath.ceilInt(price)
    }

    /// Evolve bonus of a fusion (`evolveQuality`): base + span × avg(level / cap), rounded to 4 decimals (round 5: always 1).
    public static func evolveQuality(_ l1: Int, _ cap1: Int, _ l2: Int, _ cap2: Int) -> Double {
        let r1 = Swift.min(1, Swift.max(0, Double(l1) / Double(cap1)))
        let r2 = Swift.min(1, Swift.max(0, Double(l2) / Double(cap2)))
        let q = Constants.evolveBonus.base + Constants.evolveBonus.span * ((r1 + r2) / 2)
        return JSMath.round(q * 10000) / 10000
    }

    // MARK: StatsProviding

    public func statAt(_ card: CardDef, _ stat: StatKey, stage: Int, level: Int, evolveQuality: Double) -> Double? {
        Stats.statAt(card, stat, stage: stage, level: level, evolveQuality: evolveQuality)
    }

    public func capFor(_ card: CardDef, stage: Int) -> Int {
        Stats.capFor(card, stage: stage)
    }

    public func cardXpToNext(_ card: CardDef, level: Int, stage: Int) -> Int {
        Stats.cardXpToNext(card, level: level, stage: stage)
    }

    public func playerXpToNext(level: Int) -> Int? {
        Stats.playerXpToNext(level: level)
    }

    public func sellValue(_ card: CardDef, stage: Int, level: Int) -> Int {
        Stats.sellValue(card, stage: stage, level: level)
    }

    public func fusionCost(rarity: Rarity, stage: Int) -> Int {
        Stats.fusionCost(rarity: rarity, stage: stage)
    }

    public func sacrificeXp(_ card: CardDef, stage: Int, level: Int) -> Int {
        Stats.sacrificeXp(card, stage: stage, level: level)
    }

    public func enhancePrice(_ card: CardDef, level: Int) -> Int {
        Stats.enhancePrice(card, level: level)
    }

    public func evolveQuality(_ l1: Int, _ cap1: Int, _ l2: Int, _ cap2: Int) -> Double {
        Stats.evolveQuality(l1, cap1, l2, cap2)
    }
}
