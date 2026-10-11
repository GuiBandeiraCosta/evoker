import Foundation

/// `data/quests.json`: the main quest line (100 nodes) and the portals (8 × 25 nodes).
public struct QuestsData: Codable, Sendable {
    public let version: Int
    public let notes: String?
    public let sections: [QuestSection]
    public let main: QuestLine
    public let portalRotationDays: Int
    public let portals: [QuestLine]

    public init(version: Int = 1, notes: String? = nil, sections: [QuestSection] = [], main: QuestLine, portalRotationDays: Int = 7, portals: [QuestLine] = []) {
        self.version = version; self.notes = notes; self.sections = sections; self.main = main
        self.portalRotationDays = portalRotationDays; self.portals = portals
    }

    enum CodingKeys: String, CodingKey { case version, notes, sections, main, portalRotationDays, portals }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = c.int(.version, default: 1)
        notes = c.stringOrNil(.notes)
        sections = c.array(QuestSection.self, .sections)
        main = try c.decode(QuestLine.self, forKey: .main)
        portalRotationDays = c.int(.portalRotationDays, default: 7)
        portals = c.array(QuestLine.self, .portals)
    }

    /// `questLine(deps, lineId)`.
    public func line(_ lineId: String) -> QuestLine? {
        if lineId == "main" { return main }
        return portals.first { $0.id == lineId }
    }

    /// `getQuest(deps, lineId, n)` (1-based).
    public func quest(_ lineId: String, _ n: Int) -> QuestNode? {
        guard let line = line(lineId), n >= 1, n <= line.nodes.count else { return nil }
        return line.nodes[n - 1]
    }
}

public struct QuestSection: Codable, Hashable, Sendable {
    public let index: Int
    public let name: String
    public let from: Int
    public let to: Int
}

public struct PortalTokenInfo: Codable, Hashable, Sendable {
    public let name: String
    public let gems: Int?
}

public struct PortalTokens: Codable, Hashable, Sendable {
    public let low: PortalTokenInfo
    public let high: PortalTokenInfo

    /// The token info of a token kind ("portalLow" → low).
    public func info(_ kind: TokenKind) -> PortalTokenInfo? {
        switch kind {
        case .portalLow: return low
        case .portalHigh: return high
        default: return nil
        }
    }
}

public struct QuestLine: Codable, Sendable {
    public let id: String
    public let name: String
    /// The set's card ids (main: the 17 main-set cards; portals: the 8-card set).
    public let cards: [String]
    public let gemReward: Int
    public let estimatedCards: Bool?
    /// Portal token names ("Infinite Void token", "Empyrean token").
    public let tokens: PortalTokens?
    public let wiki: String?
    public let nodes: [QuestNode]

    public init(id: String, name: String, cards: [String], gemReward: Int, estimatedCards: Bool? = nil, tokens: PortalTokens? = nil, wiki: String? = nil, nodes: [QuestNode]) {
        self.id = id; self.name = name; self.cards = cards; self.gemReward = gemReward; self.estimatedCards = estimatedCards
        self.tokens = tokens; self.wiki = wiki; self.nodes = nodes
    }

    enum CodingKeys: String, CodingKey { case id, name, cards, gemReward, estimatedCards, tokens, wiki, nodes }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = c.string(.name, default: id)
        cards = c.array(String.self, .cards)
        gemReward = c.int(.gemReward)
        estimatedCards = c.boolOrNil(.estimatedCards)
        tokens = c.optionalValue(PortalTokens.self, .tokens)
        wiki = c.stringOrNil(.wiki)
        nodes = c.array(QuestNode.self, .nodes)
    }

    public var isMain: Bool { id == "main" }
}

public struct QuestBand: Codable, Hashable, Sendable {
    public let rarities: [Rarity]
    /// [lo, hi] card level range.
    public let levels: [Int]
    /// [s0, s1] fusion stage range (nil = [0, 0]).
    public let stages: [Int]?

    public init(rarities: [Rarity], levels: [Int], stages: [Int]? = nil) {
        self.rarities = rarities; self.levels = levels; self.stages = stages
    }

    public var levelRange: (lo: Int, hi: Int) { (levels.first ?? 1, levels.count > 1 ? levels[1] : (levels.first ?? 1)) }
    public var stageRange: (s0: Int, s1: Int) {
        guard let s = stages, !s.isEmpty else { return (0, 0) }
        return (s[0], s.count > 1 ? s[1] : s[0])
    }
}

public struct SoulDrop: Codable, Hashable, Sendable {
    public let tap: Int
    public let cardId: String
}

/// One quest node. Fields present only on some nodes are optional (see the key census in docs/PLAN.md).
public struct QuestNode: Codable, Sendable {
    public let n: Int
    public let section: Int?
    public let sectionName: String?
    /// Fixed boss card id (nil = a random band card).
    public let boss: String?
    public let bossStage: Int
    public let bossHp: Int
    /// Extra cards next to the boss (nil = 4).
    public let bossCards: Int?
    public let band: QuestBand
    public let staminaPerTap: Int
    public let figures: Int
    public let stamina: Int?
    public let wikiStamina: Int?
    /// Gold of one "Perfect!" tap.
    public let goldPerFigure: Int
    /// Main line: "neophyte" | "summoner" | "archmage"; portals: "low" | "high".
    public let token: String
    public let pieceRarity: Rarity?
    public let bossCardIds: [String]?
    public let bossName: String?
    public let rewardCard: String?
    public let endGold: Int?
    public let burstChance: Double?
    public let waveCards: Bool?
    public let soulDrop: SoulDrop?
    public let bossLevel: Int?
    public let firstWinReward: Reward?
    public let bossSlots: [Int]?
    public let showdown: Bool?
    public let bossCardStages: [Int]?
    public let bossSlot: Int?
    public let estimated: Bool?
    public let estimatedFields: [String]?
    public let highTokenFirstWin: Bool?
    public let xpPerTap: Int?

    enum CodingKeys: String, CodingKey {
        case n, section, sectionName, boss, bossStage, bossHp, bossCards, band, staminaPerTap, figures, stamina, wikiStamina,
             goldPerFigure, token, pieceRarity, bossCardIds, bossName, rewardCard, endGold, burstChance, waveCards, soulDrop,
             bossLevel, firstWinReward, bossSlots, showdown, bossCardStages, bossSlot, estimated, estimatedFields, highTokenFirstWin, xpPerTap
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        n = c.int(.n)
        section = c.intOrNil(.section)
        sectionName = c.stringOrNil(.sectionName)
        boss = c.stringOrNil(.boss)
        bossStage = c.int(.bossStage)
        bossHp = c.int(.bossHp)
        bossCards = c.intOrNil(.bossCards)
        band = c.lenient(QuestBand.self, .band, default: QuestBand(rarities: [.common], levels: [1, 1]))
        staminaPerTap = c.int(.staminaPerTap)
        figures = c.int(.figures)
        stamina = c.intOrNil(.stamina)
        wikiStamina = c.intOrNil(.wikiStamina)
        goldPerFigure = c.int(.goldPerFigure)
        token = c.string(.token)
        pieceRarity = c.optionalValue(Rarity.self, .pieceRarity)
        bossCardIds = c.optionalValue([String].self, .bossCardIds)
        bossName = c.stringOrNil(.bossName)
        rewardCard = c.stringOrNil(.rewardCard)
        endGold = c.intOrNil(.endGold)
        burstChance = c.doubleOrNil(.burstChance)
        waveCards = c.boolOrNil(.waveCards)
        soulDrop = c.optionalValue(SoulDrop.self, .soulDrop)
        bossLevel = c.intOrNil(.bossLevel)
        firstWinReward = c.optionalValue(Reward.self, .firstWinReward)
        bossSlots = c.optionalValue([Int].self, .bossSlots)
        showdown = c.boolOrNil(.showdown)
        bossCardStages = c.optionalValue([Int].self, .bossCardStages)
        bossSlot = c.intOrNil(.bossSlot)
        estimated = c.boolOrNil(.estimated)
        estimatedFields = c.optionalValue([String].self, .estimatedFields)
        highTokenFirstWin = c.boolOrNil(.highTokenFirstWin)
        xpPerTap = c.intOrNil(.xpPerTap)
    }

    /// The main-line token kind of this node (nil for portal nodes, whose token is "low" / "high").
    public var mainTokenKind: TokenKind? { TokenKind(rawValue: token) }
    /// Portal nodes: the portal token kind of this node.
    public var portalTokenKind: TokenKind { token == "high" ? .portalHigh : .portalLow }
}

/// `data/names.json`: simulated player names and the avatar card ids.
public struct NamesData: Codable, Sendable {
    public let version: Int
    public let names: [String]
    /// 12 card ids used as portraits (index = `avatar`).
    public let avatars: [String]

    public init(version: Int = 1, names: [String], avatars: [String]) {
        self.version = version; self.names = names; self.avatars = avatars
    }

    enum CodingKeys: String, CodingKey { case version, names, avatars }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = c.int(.version, default: 1)
        names = c.array(String.self, .names)
        avatars = c.array(String.self, .avatars)
    }
}
