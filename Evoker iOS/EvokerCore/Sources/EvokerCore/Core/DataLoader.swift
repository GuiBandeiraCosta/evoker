import Foundation

/// Loads the data files shipped in the package (`Sources/EvokerCore/Data/*.json`, copied from `Evoker Web/data`
/// by Tools/sync-data.mjs) from the package resource bundle (`Bundle.module`), with a source-tree fallback for
/// environments without a generated resource bundle.
public enum DataLoader {
    public struct MissingFile: Error, CustomStringConvertible {
        public let name: String
        public var description: String { "EvokerCore data file not found: \(name).json" }
    }

    /// URL of `Data/<name>.json`.
    public static func url(_ name: String) throws -> URL {
        if let u = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Data") { return u }
        if let u = Bundle.module.url(forResource: name, withExtension: "json") { return u }
        let here = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        let fallback = here.appendingPathComponent("Data").appendingPathComponent(name + ".json")
        if FileManager.default.fileExists(atPath: fallback.path) { return fallback }
        throw MissingFile(name: name)
    }

    /// Raw bytes of `Data/<name>.json`.
    public static func data(_ name: String) throws -> Data {
        try Data(contentsOf: try url(name))
    }

    /// `data/cards.json` as a catalog (`createCardsDb`).
    public static func loadCardsDb() throws -> CardsDb {
        try CardsDb(json: try data("cards"))
    }

    /// `data/quests.json`.
    public static func loadQuests() throws -> QuestsData {
        try JSONDecoder().decode(QuestsData.self, from: try data("quests"))
    }

    /// `data/names.json`.
    public static func loadNames() throws -> NamesData {
        try JSONDecoder().decode(NamesData.self, from: try data("names"))
    }

    /// `data/abilities.json`: card id → ability (nil for cards without one).
    public static func loadAbilities() throws -> [String: AbilityDef?] {
        try JSONDecoder().decode([String: AbilityDef?].self, from: try data("abilities"))
    }

    /// `data/abilities.json` as a raw JSON tree (for `Abilities.validateRaw`).
    public static func loadAbilitiesJSON() throws -> JSONValue {
        try JSONValue.parse(try data("abilities"))
    }
}
