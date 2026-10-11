import Foundation
import XCTest
@testable import EvokerCore

/// Shared helpers of the golden tests: fixture loading, the real data, canonical JSON comparison with a useful
/// first-difference message. Golden files are produced by `Tools/gen-goldens.mjs` from the web code.
enum Golden {
    /// The test bundle's Golden folder (SwiftPM resource).
    static func url(_ name: String) -> URL {
        if let u = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Golden") { return u }
        // Fallback for environments where the resource bundle is not generated: the source folder.
        let here = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        return here.appendingPathComponent("Golden").appendingPathComponent(name + ".json")
    }

    static func data(_ name: String) throws -> Data {
        try Data(contentsOf: url(name))
    }

    static func json(_ name: String) throws -> JSONValue {
        try JSONValue.parse(try data(name))
    }

    static func load<T: Decodable>(_ name: String, as type: T.Type) throws -> T {
        try JSONDecoder().decode(T.self, from: try data(name))
    }
}

/// The real data files shipped in the package (Sources/EvokerCore/Data).
enum RealData {
    static func url(_ name: String) -> URL {
        if let u = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Data") { return u }
        let here = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        return here.appendingPathComponent("../../Sources/EvokerCore/Data").appendingPathComponent(name + ".json")
    }

    static let db: CardsDb = {
        let data = try! Data(contentsOf: RealData.url("cards"))
        return try! CardsDb(json: data)
    }()

    static let quests: QuestsData = {
        try! JSONDecoder().decode(QuestsData.self, from: try! Data(contentsOf: RealData.url("quests")))
    }()

    static let names: NamesData = {
        try! JSONDecoder().decode(NamesData.self, from: try! Data(contentsOf: RealData.url("names")))
    }()
}

/// Canonical JSON comparison.
enum Canon {
    /// Canonical text of any Encodable value.
    static func text<T: Encodable>(_ value: T) throws -> String {
        try JSONValue.of(value).canonical()
    }

    /// First path at which two JSON trees differ ("events[12].targets[0].damage: 50 != 60"), or nil when equal
    /// (null-valued object members are ignored on both sides).
    static func firstDifference(_ a: JSONValue, _ b: JSONValue, path: String = "$") -> String? {
        switch (a, b) {
        case (.object(let oa), .object(let ob)):
            let ka = Set(oa.filter { !$0.value.isNull }.keys), kb = Set(ob.filter { !$0.value.isNull }.keys)
            for k in ka.union(kb).sorted() {
                guard let va = oa[k], !va.isNull else { return "\(path).\(k): missing on the Swift side (web has \(ob[k]!.canonical()))" }
                guard let vb = ob[k], !vb.isNull else { return "\(path).\(k): extra on the Swift side (\(va.canonical()))" }
                if let d = firstDifference(va, vb, path: "\(path).\(k)") { return d }
            }
            return nil
        case (.array(let aa), .array(let ab)):
            if aa.count != ab.count { return "\(path): array length \(aa.count) != \(ab.count)" }
            for (i, (x, y)) in zip(aa, ab).enumerated() {
                if let d = firstDifference(x, y, path: "\(path)[\(i)]") { return d }
            }
            return nil
        case (.number(let x), .number(let y)):
            return x == y ? nil : "\(path): \(JSONValue.format(x)) != \(JSONValue.format(y))"
        default:
            return a == b ? nil : "\(path): \(a.canonical()) != \(b.canonical())"
        }
    }

    /// Assert two trees are equal, reporting the first difference (Swift side first, web/expected second).
    static func assertEqual(_ actual: JSONValue, _ expected: JSONValue, _ label: String, file: StaticString = #filePath, line: UInt = #line) {
        if let d = firstDifference(actual, expected) {
            XCTFail("\(label): \(d)", file: file, line: line)
        }
    }
}

/// Projection of an event log to the subset the goldens compare (the web generator applies the same projection):
/// card snapshots keep cardId, name, tribe, attack, hp, maxHp; player snapshots keep name, hp, maxHp, baseMaxHp,
/// tribeBonus; everything else is kept as is.
enum EventProjection {
    static func project(_ events: JSONValue) -> JSONValue {
        guard case .array(let list) = events else { return events }
        return .array(list.map(projectEvent))
    }

    static func projectEvent(_ ev: JSONValue) -> JSONValue {
        guard case .object(var o) = ev else { return ev }
        if let t = o["t"]?.stringValue {
            if t == "battleStart" {
                for side in ["attacker", "defender"] {
                    if case .object(var s)? = o[side] {
                        if case .object(let p)? = s["player"] { s["player"] = .object(p.filter { ["name", "hp", "maxHp", "baseMaxHp", "tribeBonus"].contains($0.key) }) }
                        if case .array(let cards)? = s["cards"] { s["cards"] = .array(cards.map(projectCard)) }
                        o[side] = .object(s)
                    }
                }
            } else if t == "death", let card = o["card"] {
                o["card"] = projectCard(card)
            }
        }
        return .object(o)
    }

    static func projectCard(_ card: JSONValue) -> JSONValue {
        guard case .object(let c) = card else { return card }
        return .object(c.filter { ["cardId", "name", "tribe", "attack", "hp", "maxHp"].contains($0.key) && !$0.value.isNull })
    }
}
