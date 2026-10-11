import Foundation

/// Small JavaScript-semantics helpers shared by the game modules (ports of idioms of `Evoker Web/src/game/*.js`).
enum JSString {
    /// ICU root collation order of the ASCII characters (node 22: `[...chars].sort((a, b) => a.localeCompare(b))`):
    /// whitespace, then the punctuation and symbols in CLDR order (`_` and `-` BEFORE `'`, unlike ASCII), digits,
    /// letters (upper and lower case share a primary weight).
    private static let icuAsciiOrder: [UInt32: Int] = {
        let order = "\t\n\u{0B}\u{0C}\r _-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$0123456789abcdefghijklmnopqrstuvwxyz"
        var map: [UInt32: Int] = [:]
        for (i, u) in order.unicodeScalars.enumerated() {
            map[u.value] = i
            if u.value >= 97 && u.value <= 122 { map[u.value - 32] = i }   // 'A'...'Z' share the primary of 'a'...'z'
        }
        return map
    }()

    /// Primary collation weight of a scalar: the ICU order for ASCII, everything else after it by code point.
    private static func primary(_ u: Unicode.Scalar) -> Int {
        icuAsciiOrder[u.value] ?? (1000 + Int(u.value))
    }

    /// `String.prototype.localeCompare` with the default (root) collation as the web calls it on card and simulated
    /// player names (collection.js sortCards, league.js rankRows): the characters compare by their ICU primary
    /// weight first (letters case-insensitively, punctuation in CLDR order, a shorter prefix first); on a full tie
    /// the first case difference decides, lowercase first (tertiary strength). Exact for the ASCII names of the
    /// data; non-ASCII scalars (none in the data) sort after ASCII by code point.
    static func localeCompare(_ a: String, _ b: String) -> Int {
        let ua = Array(a.unicodeScalars), ub = Array(b.unicodeScalars)
        let n = min(ua.count, ub.count)
        for i in 0..<n {
            let pa = primary(ua[i]), pb = primary(ub[i])
            if pa != pb { return pa < pb ? -1 : 1 }
        }
        if ua.count != ub.count { return ua.count < ub.count ? -1 : 1 }
        for i in 0..<n where ua[i] != ub[i] {
            // same letter, different case: lowercase first (ICU tertiary order), unlike ASCII order
            return ua[i].properties.isLowercase ? -1 : 1
        }
        return 0
    }

    /// `String(value).slice(0, n)` on UTF-16 code units (JavaScript string indexing).
    static func slice(_ s: String, _ n: Int) -> String {
        if s.utf16.count <= n { return s }
        return String(decoding: Array(s.utf16.prefix(n)), as: UTF16.self)
    }

    /// `String.prototype.trim()`.
    static func trim(_ s: String) -> String {
        s.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

/// JavaScript truthiness and `Number()` coercion of raw JSON values (used by the save migration on the raw save).
enum JSValue {
    /// JavaScript truthiness of a JSON value (`undefined` = nil).
    static func truthy(_ v: JSONValue?) -> Bool {
        guard let v = v else { return false }
        switch v {
        case .null: return false
        case .bool(let b): return b
        case .number(let d): return d != 0 && !d.isNaN
        case .string(let s): return !s.isEmpty
        case .array, .object: return true
        }
    }

    /// `Number(value)`; nil = NaN (`undefined`, objects, non-numeric strings).
    static func number(_ v: JSONValue?) -> Double? {
        guard let v = v else { return nil }
        switch v {
        case .null: return 0
        case .bool(let b): return b ? 1 : 0
        case .number(let d): return d
        case .string(let s):
            let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
            if t.isEmpty { return 0 }
            return Double(t)
        case .array(let a):
            // Number([]) = 0, Number([x]) = Number(x), else NaN
            if a.isEmpty { return 0 }
            if a.count == 1 { return number(a[0]) }
            return nil
        case .object: return nil
        }
    }
}

extension Array {
    /// `arr[i]` with JavaScript's out-of-range semantics (`undefined` = nil).
    subscript(js index: Int) -> Element? {
        index >= 0 && index < count ? self[index] : nil
    }
}
