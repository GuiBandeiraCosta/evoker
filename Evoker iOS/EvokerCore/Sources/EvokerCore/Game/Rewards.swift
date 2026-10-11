import Foundation

/// Shared reward rolls (quest waves, bosses) and the function that applies any reward to the save: a literal
/// port of `Evoker Web/src/game/rewards.js`.
public enum RewardOps {
    /// Most minions in one wave (the boss gold is QUEST_GOLD.bossMult waves of this size).
    public static let maxWaveSize = 4
    /// End-of-wave drop odds (WAVE_ODDS).
    public static let waveOdds = (card: Constants.waveRewards.card, none: Constants.waveRewards.nothing)
    /// Boss reward roll (BOSS_ODDS).
    public static let bossOdds = Constants.bossRewards
    public static let bossGemsRange = Constants.bossGemsRange

    /// Pick a random card definition from a quality band (`pickBandCard`); trainer cards never drop.
    public static func pickBandCard(rng: RandomSource, db: CardsDb, band: QuestBand) -> CardDef? {
        var rarities = band.rarities
        while !rarities.isEmpty {
            let i = rng.int(rarities.count)
            let r = rarities.remove(at: i)
            let pool = db.byRarity(r).filter { !$0.isTrainer }
            if !pool.isEmpty { return rng.pick(pool) }
        }
        let all = db.all().filter { !$0.isTrainer }
        return all.isEmpty ? nil : rng.pick(all)
    }

    /// Gold of one minion tap (`rollTapGold`): the quest's flat gold per tap, with probability `burstChance` a
    /// burst of 4.5× on top; the last tap adds `endGold`; Golden Day ×1.5.
    public static func rollTapGold(rng: RandomSource, quest: QuestNode, last: Bool = false, event: DailyEventId? = nil) -> TapGold {
        let tapBase = max(0, quest.goldPerFigure)
        let chance: Double = quest.burstChance ?? Constants.questTapBurst.chance
        var burstBase = (chance > 0 && rng.next() < chance) ? JSMath.roundInt(Double(tapBase) * Constants.questTapBurst.mult) : 0
        if last, let end = quest.endGold, end != 0 { burstBase += end }
        let tap = PlayerOps.goldWithEvent(tapBase, event: event)
        let burst = burstBase != 0 ? PlayerOps.goldWithEvent(burstBase, event: event) : 0
        return TapGold(gold: tap + burst, tap: tap, burst: burst, perfect: true)
    }

    /// Roll the drop after a minion wave (`rollWaveReward`): 20 % a whole card of the band, else nothing.
    public static func rollWaveReward(rng: RandomSource, deps: Deps, quest: QuestNode) -> Reward {
        let roll = rng.next()
        if roll < waveOdds.card {
            guard let def = pickBandCard(rng: rng, db: deps.db, band: quest.band) else { return .none }
            let stage = quest.band.stages?.first ?? 0
            return Reward(type: .card, cardId: def.id, stage: stage, level: 1)
        }
        return .none
    }

    /// Candidate card ids for a piece drop of a line at a rarity (`pieceCandidates`).
    public static func pieceCandidates(deps: Deps, line: QuestLine, rarity: Rarity) -> [String] {
        let setIds = line.cards
        let order: [Rarity] = [.legendary, .heroic, .rare, .uncommon]
        let start = max(0, order.firstIndex(of: rarity) ?? -1)
        var i = start
        while i < order.count {
            let inSet = CollectionOps.cardsOfRarity(deps.db, rarity: order[i], setIds: setIds).map { $0.id }
            if !inSet.isEmpty { return inSet }
            i += 1
        }
        return CollectionOps.cardsOfRarity(deps.db, rarity: rarity, setIds: nil).map { $0.id }
    }

    /// Roll the boss reward (`rollBossReward`): 45 % gold, 25 % token, 15 % card piece, 10 % potion, 5 % gems;
    /// scripted first-win rewards (soul card, `firstWinReward`, portal node 25's high token) come first.
    public static func rollBossReward(rng: RandomSource, deps: Deps, line: QuestLine, quest: QuestNode, firstWin: Bool, event: DailyEventId?) -> Reward {
        let isPortal = line.id != "main"
        if let rc = quest.rewardCard, !rc.isEmpty, firstWin, deps.db.get(rc) != nil {
            return Reward(type: .card, cardId: rc, stage: 0, level: 1, soul: true)
        }
        if let fw = quest.firstWinReward, firstWin, fw.type != .piece || (fw.cardId.flatMap { deps.db.get($0) } != nil) {
            var r = fw
            if let g = fw.gold { r.gold = PlayerOps.goldWithEvent(g, event: event) }
            return r
        }
        if isPortal && quest.highTokenFirstWin == true && firstWin {
            return Reward(type: .token, count: 1, token: .portalHigh, portalId: line.id)
        }
        let pieceOk = isPortal ? quest.n >= Constants.portalPieceFromNode : quest.pieceRarity != nil
        let gold = Reward(type: .gold, gold: PlayerOps.goldWithEvent(quest.goldPerFigure * maxWaveSize * Constants.questGoldBossMult, event: event))
        var oddsGold = bossOdds.gold, oddsPiece = bossOdds.piece
        if !pieceOk { oddsGold += oddsPiece; oddsPiece = 0 }
        let roll = rng.next()
        var acc = oddsGold
        if roll < acc { return gold }
        acc += bossOdds.token
        if roll < acc {
            if isPortal { return Reward(type: .token, count: 1, token: quest.token == "high" ? .portalHigh : .portalLow, portalId: line.id) }
            return Reward(type: .token, count: 1, token: quest.mainTokenKind ?? .neophyte)
        }
        acc += oddsPiece
        if roll < acc {
            let cands = pieceCandidates(deps: deps, line: line, rarity: quest.pieceRarity ?? .rare)
            if let id = rng.pick(cands) { return Reward(type: .piece, cardId: id) }
            return gold
        }
        acc += bossOdds.potion
        if roll < acc { return Reward(type: .potion, potion: rng.chance(0.5) ? .stamina : .mana, count: 1) }
        let (lo, hi) = bossGemsRange
        return Reward(type: .gems, gems: lo + rng.int(hi - lo + 1))
    }

    /// Apply a reward to the save (`applyReward`); the returned reward is annotated (uid, converted, gold, hunt…).
    public static func applyReward(_ state: GameState, deps: Deps, now: Int64, reward: Reward?) throws -> (state: GameState, reward: Reward) {
        guard let reward = reward else { return (state, .none) }
        switch reward.type {
        case .gold: return (PlayerOps.addGold(state, amount: reward.gold ?? 0), reward)
        case .gems: return (PlayerOps.addGems(state, amount: reward.gems ?? 0), reward)
        case .potion: return (PlayerOps.addPotions(state, kind: reward.potion ?? .stamina, count: reward.count ?? 1), reward)
        case .token: return (PlayerOps.addTokens(state, kind: reward.token ?? .neophyte, count: reward.count ?? 1, portalId: reward.portalId), reward)
        case .card:
            let r = try CollectionOps.addCard(state, deps: deps, cardId: reward.cardId ?? "", stage: reward.stage ?? 0, level: reward.level ?? 1)
            var out = reward
            out.uid = r.info.uid
            out.converted = r.info.converted
            out.gold = r.info.gold
            return (r.state, out)
        case .piece:
            let r = try PieceOps.addPiece(state, deps: deps, now: now, cardId: reward.cardId ?? "")
            var out = reward
            out.huntIndex = r.info.index
            out.completed = r.info.completed
            out.uid = r.info.uid
            out.full = r.info.full
            return (r.state, out)
        case .none: return (state, .none)
        }
    }

    /// Human-readable summary of a reward (`describeReward`).
    public static func describeReward(_ reward: Reward?, db: CardsDb?) -> String {
        guard let reward = reward, reward.type != .none else { return "Nothing this time" }
        let name: (String?) -> String = { id in
            guard let id = id else { return "" }
            return db?.get(id)?.name ?? id
        }
        switch reward.type {
        case .gold: return "\(reward.gold ?? 0) gold"
        case .gems: return "\(reward.gems ?? 0) gems"
        case .potion:
            let n = reward.count ?? 1
            return "\(n) \(reward.potion?.rawValue ?? "") potion" + (n > 1 ? "s" : "")
        case .token:
            let n = reward.count ?? 1
            let label: String
            switch reward.token {
            case .neophyte?: label = "Neophyte"
            case .summoner?: label = "Summoner"
            case .archmage?: label = "Archmage"
            case .portalLow?: label = "portal (low)"
            case .portalHigh?: label = "portal (high)"
            case nil: label = ""
            }
            return "\(n) \(label) token"
        case .card:
            return reward.converted == true ? name(reward.cardId) + " (collection full: sold for \(reward.gold ?? 0) gold)" : name(reward.cardId)
        case .piece:
            return reward.full == true ? "Card piece of " + name(reward.cardId) + " (all piece slots are full)" : "Card piece: " + name(reward.cardId)
        case .none: return ""
        }
    }
}
