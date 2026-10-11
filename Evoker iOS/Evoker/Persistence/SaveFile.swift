import Foundation
import EvokerCore

/// Save files of the Options screen (`Evoker Web/src/ui/screens/save-file.js`): validation of an imported save
/// with the web's messages, the pretty JSON of an export and its file name. Pure; `SaveTransfer.swift` wraps it
/// in SwiftUI and `GameStore.importJSON` runs it before decoding.
enum SaveFile {
    /// What the import confirmation names (`"<name>" (level N, M cards)`).
    struct Summary: Equatable {
        let name: String
        let level: Int
        let cards: Int
    }

    /// `validateSave(save)`: the checks and the messages of the web, in the same order.
    static func validate(_ json: JSONValue) -> Result<Summary, SaveImportError> {
        guard case .object(let save) = json else {
            return .failure(SaveImportError("Not an Evoker save file."))
        }
        guard let version = integer(save["version"]), version >= 1 else {
            return .failure(SaveImportError("The save file has no version number."))
        }
        if version > GameState.saveVersion {
            return .failure(SaveImportError("The save file is from a newer version (\(version))."))
        }
        guard let playerValue = save["player"], case .object(let player) = playerValue else {
            return .failure(SaveImportError("The save file has no player."))
        }
        guard let level = integer(player["level"]), level >= 1 else {
            return .failure(SaveImportError("The player level is invalid."))
        }
        guard let nameValue = player["name"], case .string(let name) = nameValue else {
            return .failure(SaveImportError("The player name is invalid."))
        }
        guard let cardsValue = save["cards"], case .array(let cards) = cardsValue else {
            return .failure(SaveImportError("The card collection is missing."))
        }
        for card in cards {
            guard case .object(let fields) = card,
                  let uid = fields["uid"], case .string(_) = uid,
                  let cardId = fields["cardId"], case .string(_) = cardId else {
                return .failure(SaveImportError("A card entry is malformed."))
            }
        }
        // `save.deck !== undefined && !Array.isArray(save.deck)`: a present key (null included) must be an array
        if let deck = save["deck"] {
            guard case .array(_) = deck else {
                return .failure(SaveImportError("The deck is malformed."))
            }
        }
        return .success(Summary(name: name.isEmpty ? "Evoker" : name, level: level, cards: cards.count))
    }

    /// `parseSaveFile(text)`: JSON parse, then `validate`.
    static func parse(_ data: Data) -> Result<Summary, SaveImportError> {
        guard let json = try? JSONValue.parse(data) else {
            return .failure(SaveImportError("The file is not valid JSON."))
        }
        return validate(json)
    }

    /// `serializeSave(state)` of save-file.js (`JSON.stringify(state, null, 2)`): the pretty JSON of an export.
    /// Keys are sorted (the web writes them in insertion order; every parser treats both the same).
    static func exportData(_ state: GameState) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(state)
    }

    /// `saveFileName(now)`: "evoker-save-2026-10-07.json".
    static func fileName(now: Int64) -> String {
        return "evoker-save-\(JSDate.utcDay(now)).json"
    }

    /// `Number.isInteger(x)`: an integral JSON number (strings and booleans do not count); values beyond the
    /// safe integer range are rejected rather than trapped on.
    private static func integer(_ value: JSONValue?) -> Int? {
        guard let v = value, case .number(let d) = v, d.isFinite, d == d.rounded(.towardZero), d.magnitude < 9.0e15 else { return nil }
        return Int(d)
    }
}

/// An import refusal with the web's wording (save-file.js validateSave / parseSaveFile).
struct SaveImportError: LocalizedError, Equatable {
    let message: String

    init(_ message: String) {
        self.message = message
    }

    var errorDescription: String? { message }
}
