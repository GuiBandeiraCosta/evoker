import Foundation

/// The only source of randomness allowed in the engine, the economy and the AI (web: `src/core/rng.js`).
/// A reference type on purpose: the web passes one generator object through several functions and every call
/// advances the same stream, so the Swift port must share state the same way.
public protocol RandomSource: AnyObject {
    /// The seed this generator was created with (`Number(seed) || 0`, as the web stores it).
    var seed: UInt32 { get }
    /// Float in [0, 1).
    func next() -> Double
    /// Integer in [0, n) (0 when n <= 0).
    func int(_ n: Int) -> Int
    /// Uniformly chosen element (nil for an empty array).
    func pick<T>(_ arr: [T]) -> T?
    /// True with probability p (0..1).
    func chance(_ p: Double) -> Bool
}

/// mulberry32, bit-exact with `src/core/rng.js`.
public final class Mulberry32: RandomSource {
    public let seed: UInt32
    private var a: UInt32

    /// `mulberry32(seed)`: any integer seed (negative values wrap like `>>> 0`).
    public init(_ seed: UInt32) {
        self.seed = seed
        self.a = seed
    }

    /// Convenience for the web's `Number(seed) || 0` on a signed value.
    public convenience init(signed seed: Int64) {
        self.init(UInt32(truncatingIfNeeded: seed))
    }

    public func next() -> Double {
        a = a &+ 0x6d2b79f5
        var t = a
        t = JSMath.imul(t ^ (t >> 15), t | 1)
        t ^= t &+ JSMath.imul(t ^ (t >> 7), t | 61)
        return Double(t ^ (t >> 14)) / 4294967296
    }

    public func int(_ n: Int) -> Int {
        n > 0 ? JSMath.floorInt(next() * Double(n)) : 0
    }

    public func pick<T>(_ arr: [T]) -> T? {
        guard !arr.isEmpty else { return nil }
        return arr[JSMath.floorInt(next() * Double(arr.count))]
    }

    public func chance(_ p: Double) -> Bool {
        next() < p
    }
}

/// Seed derivations of the web (`state.js mixSeed`, `store.js seedFromNow`, `shop.js dailyEvent` hash).
public enum Seeds {
    /// `mixSeed(seed, step)`: mix the save's seed and the rng step counter into a 32-bit seed.
    public static func mixSeed(_ seed: UInt32, _ step: Int) -> UInt32 {
        let stepBits = UInt32(bitPattern: Int32(truncatingIfNeeded: step))
        var h = seed ^ JSMath.imul(stepBits, 0x9e3779b1)
        h = JSMath.imul(h ^ (h >> 16), 0x85ebca6b)
        h = JSMath.imul(h ^ (h >> 13), 0xc2b2ae35)
        return h ^ (h >> 16)
    }

    /// `seedFromNow(now)`: a 32-bit seed derived from the clock (never 0).
    public static func seedFromNow(_ now: Int64) -> UInt32 {
        let base = JSMath.toUInt32(Double(now).rounded(.down))
        var h = base ^ 0x9e3779b9
        h = JSMath.imul(h ^ (h >> 16), 0x45d9f3b)
        h = JSMath.imul(h ^ (h >> 16), 0x45d9f3b)
        h = h ^ (h >> 16)
        return h == 0 ? 1 : h
    }

    /// `shop.js dailyEvent`: index of the daily event for a UTC day number (`Math.floor(now / DAY_MS)`).
    public static func dailyEventIndex(dayNumber: Int, count: Int) -> Int {
        let day = UInt32(bitPattern: Int32(truncatingIfNeeded: dayNumber))
        var h = JSMath.imul(day ^ 0x5bd1e995, 0x9e3779b1)
        h = h ^ (h >> 15)
        return Int(h % UInt32(count))
    }

    /// `battle/assets.js createPicker`: the LCG that cycles sound variants of a fight, seeded with the battle seed.
    public final class VariantPicker {
        private var s: UInt32
        public init(seed: UInt32) {
            self.s = seed == 0 ? 0x9e3779b9 : seed
        }
        public func pick<T>(_ list: [T]) -> T? {
            guard !list.isEmpty else { return nil }
            s = JSMath.imul(s, 1664525) &+ 1013904223
            return list[Int((s >> 8) % UInt32(list.count))]
        }
    }
}
