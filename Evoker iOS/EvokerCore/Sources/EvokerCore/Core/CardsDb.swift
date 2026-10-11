import Foundation

/// Card catalog access (`src/core/cards-db.js`): an indexed, read-only view over `cards.json` with lookups,
/// filters and text search. The catalog order of `all` is the file order (the goldens depend on it).
public final class CardsDb {
    public let version: Int
    private let cards: [CardDef]
    private let byId: [String: CardDef]
    private let blobs: [String: String]

    /// `createCardsDb(json)`; throws on a missing or duplicate id.
    public init(cards: [CardDef], version: Int = 1) throws {
        var map: [String: CardDef] = [:]
        var blobs: [String: String] = [:]
        for card in cards {
            if card.id.isEmpty { throw GameError("createCardsDb: card without id") }
            if map[card.id] != nil { throw GameError("createCardsDb: duplicate card id \"\(card.id)\"") }
            map[card.id] = card
            let parts = [card.name, card.id, card.tribe.rawValue, card.rarity.rawValue, card.set] + (card.sets ?? []) + [card.sourceText] + card.categories
            blobs[card.id] = CardsDb.normalizeText(parts.joined(separator: " "))
        }
        self.version = version
        self.cards = cards
        self.byId = map
        self.blobs = blobs
    }

    /// Load `{version, cards: [...]}` JSON.
    public convenience init(json data: Data) throws {
        struct File: Decodable { let version: Int?; let cards: [CardDef] }
        let f = try JSONDecoder().decode(File.self, from: data)
        try self.init(cards: f.cards, version: f.version ?? 1)
    }

    public var size: Int { cards.count }

    public func get(_ id: String) -> CardDef? { byId[id] }
    public func has(_ id: String) -> Bool { byId[id] != nil }
    /// Every card, catalog order.
    public func all() -> [CardDef] { cards }
    public func byRarity(_ rarity: Rarity) -> [CardDef] { cards.filter { $0.rarity == rarity } }
    public func byTribe(_ tribe: Tribe) -> [CardDef] { cards.filter { $0.tribe == tribe } }
    /// Cards whose `set` or extra `sets` include it.
    public func bySet(_ set: String) -> [CardDef] { cards.filter { $0.inSet(set) } }

    /// Every whitespace-separated token must match the card's search blob.
    public func search(_ text: String) -> [CardDef] {
        let tokens = CardsDb.normalizeText(text).split(whereSeparator: { $0 == " " || $0 == "\n" || $0 == "\t" }).map(String.init).filter { !$0.isEmpty }
        if tokens.isEmpty { return cards }
        return cards.filter { card in
            let blob = blobs[card.id] ?? ""
            return tokens.allSatisfy { blob.contains($0) }
        }
    }

    /// Lower-cased, accent-stripped text (`normalizeText`).
    static func normalizeText(_ text: String) -> String {
        Slug.stripDiacritics(text.lowercased())
    }
}

/// `slugify(name)`: the canonical card id of a card name (cards-db.js).
public enum Slug {
    /// `String(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')`.
    public static func slugify(_ name: String) -> String {
        let stripped = stripDiacritics(name.lowercased())
        var out = ""
        var pendingDash = false
        for scalar in stripped.unicodeScalars {
            let v = scalar.value
            let ok = (v >= 97 && v <= 122) || (v >= 48 && v <= 57)
            if ok {
                if pendingDash, !out.isEmpty { out += "-" }
                pendingDash = false
                out.unicodeScalars.append(scalar)
            } else {
                pendingDash = true
            }
        }
        return out
    }

    /// NFD decomposition with the combining marks U+0300–U+036F removed (exactly the web's regex).
    public static func stripDiacritics(_ text: String) -> String {
        let decomposed = text.decomposedStringWithCanonicalMapping
        var out = String.UnicodeScalarView()
        for u in decomposed.unicodeScalars where !(u.value >= 0x300 && u.value <= 0x36F) {
            out.append(u)
        }
        return String(out)
    }
}
