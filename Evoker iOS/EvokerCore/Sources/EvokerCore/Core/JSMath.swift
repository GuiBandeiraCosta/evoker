import Foundation

/// JavaScript number semantics the ports depend on (docs/PLAN.md §3.1). The web engine and game layer compute in
/// IEEE doubles with `Math.round` / `Math.floor` / `Math.imul` / `>>> 0` / `| 0`; every Swift port must use these
/// helpers instead of Swift's own rounding so that the golden tests (recorded from the web code) keep matching.
public enum JSMath {
    /// `Math.round(x)`: rounds half towards +∞ (`Math.round(2.5) === 3`, `Math.round(-2.5) === -2`).
    /// Swift's `rounded()` rounds half away from zero, which differs for negative halves.
    @inlinable public static func round(_ x: Double) -> Double {
        if !x.isFinite { return x }
        let f = x.rounded(.down)
        return (x - f) >= 0.5 ? f + 1 : f
    }

    /// `Math.round(x)` as an `Int` (callers guarantee a finite value in range).
    @inlinable public static func roundInt(_ x: Double) -> Int {
        Int(round(x))
    }

    /// `Math.floor(x)` as an `Int`.
    @inlinable public static func floorInt(_ x: Double) -> Int {
        Int(x.rounded(.down))
    }

    /// `Math.ceil(x)` as an `Int`.
    @inlinable public static func ceilInt(_ x: Double) -> Int {
        Int(x.rounded(.up))
    }

    /// `x | 0`: ToInt32 (truncation towards zero, then wrap to 32 bits).
    @inlinable public static func toInt32(_ x: Double) -> Int32 {
        if !x.isFinite { return 0 }
        let t = x.rounded(.towardZero)
        let m = t.truncatingRemainder(dividingBy: 4294967296)
        var u = m < 0 ? m + 4294967296 : m
        if u >= 2147483648 { u -= 4294967296 }
        return Int32(u)
    }

    /// `x >>> 0`: ToUint32.
    @inlinable public static func toUInt32(_ x: Double) -> UInt32 {
        UInt32(bitPattern: toInt32(x))
    }

    /// `Math.imul(a, b)`: 32-bit wrapping multiply of the ToInt32 of both operands.
    @inlinable public static func imul(_ a: UInt32, _ b: UInt32) -> UInt32 {
        a &* b
    }

    /// `Number(x) || 0` for an optional.
    @inlinable public static func num(_ x: Double?) -> Double {
        guard let x, x.isFinite else { return 0 }
        return x
    }

    /// `Number(x) || 0` for an optional integer.
    @inlinable public static func num(_ x: Int?) -> Int {
        x ?? 0
    }

    /// `Math.max(0, x)`.
    @inlinable public static func max0(_ x: Double) -> Double { Swift.max(0, x) }
    @inlinable public static func max0(_ x: Int) -> Int { Swift.max(0, x) }

    /// Clamp an integer into `lo...hi`.
    @inlinable public static func clamp(_ x: Int, _ lo: Int, _ hi: Int) -> Int {
        Swift.min(hi, Swift.max(lo, x))
    }

    /// Clamp a double into `lo...hi`.
    @inlinable public static func clamp(_ x: Double, _ lo: Double, _ hi: Double) -> Double {
        Swift.min(hi, Swift.max(lo, x))
    }

    /// JS `%` on non-negative integers is the plain remainder; this keeps negative operands JS-like too
    /// (the sign of the result follows the dividend, as in JS and Swift).
    @inlinable public static func mod(_ a: Int, _ b: Int) -> Int {
        a % b
    }
}

/// Date helpers with the web's semantics (`state.js utcDay / utcDayStart`, ms epochs as `Int64`).
public enum JSDate {
    public static let dayMs: Int64 = 24 * 60 * 60 * 1000

    /// Civil date (UTC) of a day number since 1970-01-01 (Howard Hinnant's algorithm).
    static func civil(fromDays z0: Int64) -> (year: Int64, month: Int64, day: Int64) {
        let z = z0 + 719468
        let era = (z >= 0 ? z : z - 146096) / 146097
        let doe = z - era * 146097
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
        let y = yoe + era * 400
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        let mp = (5 * doy + 2) / 153
        let d = doy - (153 * mp + 2) / 5 + 1
        let m = mp < 10 ? mp + 3 : mp - 9
        return (m <= 2 ? y + 1 : y, m, d)
    }

    /// Day number since 1970-01-01 of a civil date (UTC).
    static func days(fromCivil y0: Int64, _ m: Int64, _ d: Int64) -> Int64 {
        let y = m <= 2 ? y0 - 1 : y0
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let mp = m > 2 ? m - 3 : m + 9
        let doy = (153 * mp + 2) / 5 + d - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146097 + doe - 719468
    }

    private static func pad(_ v: Int64, _ width: Int) -> String {
        let s = String(v)
        return s.count >= width ? s : String(repeating: "0", count: width - s.count) + s
    }

    /// `new Date(now).toISOString().slice(0, 10)`: the UTC calendar day of a ms epoch.
    public static func utcDay(_ now: Int64) -> String {
        let days = Int64((Double(now) / Double(dayMs)).rounded(.down))
        let c = civil(fromDays: days)
        return "\(pad(c.year, 4))-\(pad(c.month, 2))-\(pad(c.day, 2))"
    }

    /// `Math.floor(now / DAY_MS) * DAY_MS`.
    public static func utcDayStart(_ now: Int64) -> Int64 {
        Int64((Double(now) / Double(dayMs)).rounded(.down)) * dayMs
    }

    /// `Date.parse(day + 'T00:00:00Z')`, or nil for a malformed day string.
    public static func parseDay(_ day: String) -> Int64? {
        let parts = day.split(separator: "-")
        guard parts.count == 3, let y = Int64(parts[0]), let m = Int64(parts[1]), let d = Int64(parts[2]),
              (1...12).contains(m), (1...31).contains(d) else { return nil }
        return days(fromCivil: y, m, d) * dayMs
    }

    /// `shop.js previousDay`.
    public static func previousDay(_ day: String) -> String {
        guard let t = parseDay(day) else { return day }
        return utcDay(t - dayMs)
    }

    /// `store.js shiftDay`: shift a 'YYYY-MM-DD' day string by a number of ms ('' stays '').
    public static func shiftDay(_ day: String, _ deltaMs: Int64) -> String {
        guard !day.isEmpty, let t = parseDay(day) else { return day }
        return utcDay(t + deltaMs)
    }
}
