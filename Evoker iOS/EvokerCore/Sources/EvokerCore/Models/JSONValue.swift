import Foundation

/// A JSON tree. Used for the golden tests (canonical comparison with the web's output), for unknown save fields
/// kept through a migration, and for the free-form login notices.
public enum JSONValue: Equatable, Hashable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public var isNull: Bool { if case .null = self { return true } else { return false } }

    public subscript(key: String) -> JSONValue? {
        if case .object(let o) = self { return o[key] }
        return nil
    }

    public subscript(index: Int) -> JSONValue? {
        if case .array(let a) = self, index >= 0, index < a.count { return a[index] }
        return nil
    }

    public var doubleValue: Double? {
        switch self {
        case .number(let d): return d
        case .string(let s): return Double(s)
        case .bool(let b): return b ? 1 : 0
        default: return nil
        }
    }

    public var intValue: Int? {
        guard let d = doubleValue, d.isFinite else { return nil }
        return Int(d.rounded(.towardZero))
    }

    public var stringValue: String? {
        if case .string(let s) = self { return s }
        return nil
    }

    public var boolValue: Bool? {
        switch self {
        case .bool(let b): return b
        case .number(let d): return d != 0
        case .string(let s): return !s.isEmpty
        case .null: return false
        default: return nil
        }
    }

    public var arrayValue: [JSONValue]? {
        if case .array(let a) = self { return a }
        return nil
    }

    public var objectValue: [String: JSONValue]? {
        if case .object(let o) = self { return o }
        return nil
    }

    // MARK: Canonical text (sorted keys, no whitespace, integral numbers without a fraction)

    /// Canonical JSON text: object keys sorted, no whitespace, integral numbers printed as integers (the form
    /// both the web golden generator and the Swift tests produce). `dropNullKeys` removes object members whose
    /// value is null (array elements keep their nulls).
    public func canonical(dropNullKeys: Bool = true) -> String {
        var out = ""
        write(to: &out, dropNullKeys: dropNullKeys)
        return out
    }

    private func write(to out: inout String, dropNullKeys: Bool) {
        switch self {
        case .null: out += "null"
        case .bool(let b): out += b ? "true" : "false"
        case .number(let d): out += JSONValue.format(d)
        case .string(let s): JSONValue.writeString(s, to: &out)
        case .array(let a):
            out += "["
            for (i, v) in a.enumerated() {
                if i > 0 { out += "," }
                v.write(to: &out, dropNullKeys: dropNullKeys)
            }
            out += "]"
        case .object(let o):
            out += "{"
            var first = true
            for key in o.keys.sorted(by: { $0.unicodeScalars.lexicographicallyPrecedes($1.unicodeScalars) }) {
                let v = o[key]!
                if dropNullKeys, v.isNull { continue }
                if !first { out += "," }
                first = false
                JSONValue.writeString(key, to: &out)
                out += ":"
                v.write(to: &out, dropNullKeys: dropNullKeys)
            }
            out += "}"
        }
    }

    /// Number formatting shared with `JSON.stringify`: integral values without a fraction.
    public static func format(_ d: Double) -> String {
        if !d.isFinite { return "null" }
        if d == d.rounded(.towardZero), abs(d) < 1e15 {
            return String(Int64(d))
        }
        return String(d)
    }

    static func writeString(_ s: String, to out: inout String) {
        out += "\""
        for u in s.unicodeScalars {
            switch u {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            case "\u{08}": out += "\\b"
            case "\u{0C}": out += "\\f"
            default:
                if u.value < 0x20 {
                    out += String(format: "\\u%04x", u.value)
                } else {
                    out.unicodeScalars.append(u)
                }
            }
        }
        out += "\""
    }
}

extension JSONValue: Codable {
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null; return }
        if let b = try? c.decode(Bool.self) { self = .bool(b); return }
        if let i = try? c.decode(Int64.self) { self = .number(Double(i)); return }
        if let d = try? c.decode(Double.self) { self = .number(d); return }
        if let s = try? c.decode(String.self) { self = .string(s); return }
        if let a = try? c.decode([JSONValue].self) { self = .array(a); return }
        if let o = try? c.decode([String: JSONValue].self) { self = .object(o); return }
        throw DecodingError.dataCorruptedError(in: c, debugDescription: "Unsupported JSON value")
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let b): try c.encode(b)
        case .number(let d):
            if d == d.rounded(.towardZero), abs(d) < 9.0e15 { try c.encode(Int64(d)) } else { try c.encode(d) }
        case .string(let s): try c.encode(s)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }
}

extension JSONValue {
    /// Parse JSON text.
    public static func parse(_ data: Data) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: data)
    }

    public static func parse(_ text: String) throws -> JSONValue {
        try parse(Data(text.utf8))
    }

    /// The JSON tree of any Encodable value (through JSONEncoder).
    public static func of<T: Encodable>(_ value: T) throws -> JSONValue {
        let data = try JSONEncoder().encode(value)
        return try parse(data)
    }

    /// Decode a typed value from this tree.
    public func decode<T: Decodable>(_ type: T.Type) throws -> T {
        let data = try JSONEncoder().encode(self)
        return try JSONDecoder().decode(T.self, from: data)
    }
}

// MARK: - Lenient decoding helpers (the web's migrate() fills defaults and coerces numbers)

public extension KeyedDecodingContainer {
    /// A value, or `def` when the key is missing, null, or of an unexpected type.
    func lenient<T: Decodable>(_ type: T.Type, _ key: Key, default def: T) -> T {
        (try? decodeIfPresent(T.self, forKey: key)) ?? def
    }

    /// An optional value (missing, null and type mismatches all give nil).
    func optionalValue<T: Decodable>(_ type: T.Type, _ key: Key) -> T? {
        try? decodeIfPresent(T.self, forKey: key)
    }

    /// `Number(x)` semantics for an integer field: accepts an integer, a double (truncated) or a numeric string.
    func int(_ key: Key, default def: Int = 0) -> Int {
        intOrNil(key) ?? def
    }

    func intOrNil(_ key: Key) -> Int? {
        if let i = try? decodeIfPresent(Int.self, forKey: key) { return i }
        if let d = try? decodeIfPresent(Double.self, forKey: key), d.isFinite { return Int(d.rounded(.towardZero)) }
        if let s = try? decodeIfPresent(String.self, forKey: key), let d = Double(s), d.isFinite { return Int(d.rounded(.towardZero)) }
        return nil
    }

    func int64(_ key: Key, default def: Int64 = 0) -> Int64 {
        int64OrNil(key) ?? def
    }

    func int64OrNil(_ key: Key) -> Int64? {
        if let i = try? decodeIfPresent(Int64.self, forKey: key) { return i }
        if let d = try? decodeIfPresent(Double.self, forKey: key), d.isFinite { return Int64(d.rounded(.towardZero)) }
        if let s = try? decodeIfPresent(String.self, forKey: key), let d = Double(s), d.isFinite { return Int64(d.rounded(.towardZero)) }
        return nil
    }

    func double(_ key: Key, default def: Double = 0) -> Double {
        doubleOrNil(key) ?? def
    }

    func doubleOrNil(_ key: Key) -> Double? {
        if let d = try? decodeIfPresent(Double.self, forKey: key), d.isFinite { return d }
        if let i = try? decodeIfPresent(Int64.self, forKey: key) { return Double(i) }
        if let s = try? decodeIfPresent(String.self, forKey: key), let d = Double(s), d.isFinite { return d }
        return nil
    }

    func uint32(_ key: Key, default def: UInt32 = 0) -> UInt32 {
        guard let d = doubleOrNil(key) else { return def }
        return JSMath.toUInt32(d)
    }

    func string(_ key: Key, default def: String = "") -> String {
        stringOrNil(key) ?? def
    }

    func stringOrNil(_ key: Key) -> String? {
        if let s = try? decodeIfPresent(String.self, forKey: key) { return s }
        if let d = try? decodeIfPresent(Double.self, forKey: key) { return JSONValue.format(d) }
        return nil
    }

    func bool(_ key: Key, default def: Bool = false) -> Bool {
        boolOrNil(key) ?? def
    }

    func boolOrNil(_ key: Key) -> Bool? {
        if let b = try? decodeIfPresent(Bool.self, forKey: key) { return b }
        if let d = try? decodeIfPresent(Double.self, forKey: key) { return d != 0 }
        return nil
    }

    func array<T: Decodable>(_ type: T.Type, _ key: Key) -> [T] {
        (try? decodeIfPresent([T].self, forKey: key)) ?? []
    }

    /// An array that may contain nulls (`[null, "c1", ...]`).
    func optionalArray<T: Decodable>(_ type: T.Type, _ key: Key) -> [T?] {
        (try? decodeIfPresent([T?].self, forKey: key)) ?? []
    }

    func dictionary<T: Decodable>(_ type: T.Type, _ key: Key) -> [String: T] {
        (try? decodeIfPresent([String: T].self, forKey: key)) ?? [:]
    }

    func has(_ key: Key) -> Bool {
        contains(key)
    }
}

/// Error thrown by game functions where the web throws `new Error(message)`.
public struct GameError: Error, Equatable, CustomStringConvertible, Sendable {
    public let message: String
    public init(_ message: String) { self.message = message }
    public var description: String { message }
}
