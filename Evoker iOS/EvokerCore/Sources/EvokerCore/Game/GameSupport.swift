import Foundation

/// Small JavaScript-semantics helpers shared by the game modules (ports of idioms of `Evoker Web/src/game/*.js`).
enum JSString {
    /// `String.prototype.localeCompare` with the default (root) collation as the web calls it on card and player
    /// names: letters compare case-insensitively first (primary strength); on a tie the lowercase form sorts
    /// first (tertiary strength). Every name in the data is plain ASCII, where this equals ICU's root collation
    /// for the characters that occur (letters, spaces, apostrophes, hyphens).
    static func localeCompare(_ a: String, _ b: String) -> Int {
        let la = Array(a.lowercased().unicodeScalars), lb = Array(b.lowercased().unicodeScalars)
        let n = min(la.count, lb.count)
        for i in 0..<n where la[i] != lb[i] {
            return la[i].value < lb[i].value ? -1 : 1
        }
        if la.count != lb.count { return la.count < lb.count ? -1 : 1 }
        let ua = Array(a.unicodeScalars), ub = Array(b.unicodeScalars)
        let m = min(ua.count, ub.count)
        for i in 0..<m where ua[i] != ub[i] {
            // same letter, different case: lowercase first (ICU tertiary order), unlike ASCII order
            let aLower = ua[i].properties.isLowercase
            return aLower ? -1 : 1
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
