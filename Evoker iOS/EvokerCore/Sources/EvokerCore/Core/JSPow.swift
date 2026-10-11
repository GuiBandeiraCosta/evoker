import Foundation

/// `Math.pow` / `x ** y` exactly as V8 12.4 (node 22) computes it: `base::ieee754::pow`, V8's port of fdlibm's
/// `__ieee754_pow` (src/base/ieee754.cc), including the one expression V8 groups differently from fdlibm.
/// The C library `pow` of the host (UCRT on Windows, libm on Darwin/Linux) is correctly rounded on inputs
/// where fdlibm is off by one ulp (`2 ** 1.5`, `8 ** 1.5`, ...), and the stat formulas of `stats.js` round
/// values that sit exactly on `.5` boundaries (`600 x 1.15^2`, ...), so the web's numbers can only be
/// reproduced bit for bit with the web's own algorithm. Used by `Stats` and the playback `roundFactor`.
extension JSMath {
    // fdlibm constants (e_pow.c)
    private static let bp: [Double] = [1.0, 1.5]
    private static let dpH: [Double] = [0.0, 5.84962487220764160156e-01]
    private static let dpL: [Double] = [0.0, 1.35003920212974897128e-08]
    private static let two53 = 9007199254740992.0
    private static let huge = 1.0e300
    private static let tiny = 1.0e-300
    private static let L1 = 5.99999999999994648725e-01
    private static let L2 = 4.28571428578550184252e-01
    private static let L3 = 3.33333329818377432918e-01
    private static let L4 = 2.72728123808534006489e-01
    private static let L5 = 2.30660745775561754067e-01
    private static let L6 = 2.06975017800338417784e-01
    private static let P1 = 1.66666666666666019037e-01
    private static let P2 = -2.77777777770155933842e-03
    private static let P3 = 6.61375632143793436117e-05
    private static let P4 = -1.65339022054652515390e-06
    private static let P5 = 4.13813679705723846039e-08
    private static let lg2 = 6.93147180559945286227e-01
    private static let lg2H = 6.93147182464599609375e-01
    private static let lg2L = -1.90465429995776804525e-09
    private static let ovt = 8.0085662595372944372e-17
    private static let cp = 9.61796693925975554329e-01
    private static let cpH = 9.61796700954437255859e-01
    private static let cpL = -7.02846165095275826516e-09
    private static let ivln2 = 1.44269504088896338700e+00
    private static let ivln2H = 1.44269502162933349609e+00
    private static let ivln2L = 1.92596299112661746887e-08

    @inline(__always) private static func highWord(_ d: Double) -> Int32 {
        Int32(bitPattern: UInt32(truncatingIfNeeded: d.bitPattern >> 32))
    }
    @inline(__always) private static func lowWord(_ d: Double) -> UInt32 {
        UInt32(truncatingIfNeeded: d.bitPattern)
    }
    @inline(__always) private static func withHighWord(_ d: Double, _ hi: Int32) -> Double {
        Double(bitPattern: (UInt64(UInt32(bitPattern: hi)) << 32) | (d.bitPattern & 0xFFFF_FFFF))
    }
    @inline(__always) private static func withLowWord(_ d: Double, _ lo: UInt32) -> Double {
        Double(bitPattern: (d.bitPattern & 0xFFFF_FFFF_0000_0000) | UInt64(lo))
    }
    @inline(__always) private static func fromWords(_ hi: Int32, _ lo: UInt32) -> Double {
        Double(bitPattern: (UInt64(UInt32(bitPattern: hi)) << 32) | UInt64(lo))
    }

    /// `Math.pow(x, y)` with V8's bit-exact result (fdlibm algorithm, IEEE double arithmetic only).
    public static func pow(_ x: Double, _ y: Double) -> Double {
        let hx = highWord(x)
        let lx = lowWord(x)
        let hy = highWord(y)
        let ly = lowWord(y)
        var ix = hx & 0x7fff_ffff
        let iy = hy & 0x7fff_ffff

        // y == 0: x**0 = 1
        if (iy | Int32(bitPattern: ly)) == 0 { return 1.0 }
        // x == 1: 1**y = 1 even if y is NaN
        if hx == 0x3ff0_0000 && lx == 0 { return 1.0 }
        // NaN operands
        if ix > 0x7ff0_0000 || (ix == 0x7ff0_0000 && lx != 0) || iy > 0x7ff0_0000 || (iy == 0x7ff0_0000 && ly != 0) {
            return (x + 0.0) + (y + 0.0)
        }

        // determine if y is an odd int when x < 0: 0 = not an integer, 1 = odd int, 2 = even int
        var yisint: Int32 = 0
        if hx < 0 {
            if iy >= 0x4340_0000 {
                yisint = 2
            } else if iy >= 0x3ff0_0000 {
                let k = (iy >> 20) - 0x3ff
                if k > 20 {
                    let shift = UInt32(52 - k)
                    let j = ly >> shift
                    if (j << shift) == ly { yisint = 2 - Int32(j & 1) }
                } else if ly == 0 {
                    let shift = Int32(20 - k)
                    let j = iy >> shift
                    if (j << shift) == iy { yisint = 2 - (j & 1) }
                }
            }
        }

        // special value of y
        if ly == 0 {
            if iy == 0x7ff0_0000 { // y is +-inf
                if ((ix &- 0x3ff0_0000) | Int32(bitPattern: lx)) == 0 {
                    return y - y // (+-1)**+-inf is NaN (ES6)
                } else if ix >= 0x3ff0_0000 {
                    return hy >= 0 ? y : 0.0
                } else {
                    return hy < 0 ? -y : 0.0
                }
            }
            if iy == 0x3ff0_0000 { // y is +-1
                return hy < 0 ? 1.0 / x : x
            }
            if hy == 0x4000_0000 { return x * x } // y is 2
            if hy == 0x3fe0_0000, hx >= 0 { return x.squareRoot() } // y is 0.5, x >= +0
        }

        var ax = abs(x)
        // special value of x
        if lx == 0 {
            if ix == 0x7ff0_0000 || ix == 0 || ix == 0x3ff0_0000 {
                var z = ax // x is +-0, +-inf, +-1
                if hy < 0 { z = 1.0 / z }
                if hx < 0 {
                    if ((ix &- 0x3ff0_0000) | yisint) == 0 {
                        z = (z - z) / (z - z) // (-1)**non-int is NaN
                    } else if yisint == 1 {
                        z = -z // (x<0)**odd = -(|x|**odd)
                    }
                }
                return z
            }
        }

        var n: Int32 = (hx >> 31) &+ 1
        // (x<0)**(non-int) is NaN
        if (n | yisint) == 0 { return (x - x) / (x - x) }

        var s = 1.0 // sign of the result: -1 for (-ve)**(odd int)
        if (n | (yisint &- 1)) == 0 { s = -1.0 }

        var t1: Double
        var t2: Double
        var t: Double
        var u: Double
        var v: Double
        var w: Double
        var pH: Double
        var pL: Double
        var z: Double
        var r: Double
        var j: Int32
        var k: Int32

        // |y| is huge
        if iy > 0x41e0_0000 { // |y| > 2**31
            if iy > 0x43f0_0000 { // |y| > 2**64, must o/uflow
                if ix <= 0x3fef_ffff { return hy < 0 ? huge * huge : tiny * tiny }
                if ix >= 0x3ff0_0000 { return hy > 0 ? huge * huge : tiny * tiny }
            }
            // over/underflow if x is not close to one
            if ix < 0x3fef_ffff { return hy < 0 ? s * huge * huge : s * tiny * tiny }
            if ix > 0x3ff0_0000 { return hy > 0 ? s * huge * huge : s * tiny * tiny }
            // now |1-x| is tiny <= 2**-20: log(x) by x-x^2/2+x^3/3-x^4/4
            t = ax - 1.0
            w = (t * t) * (0.5 - t * (0.3333333333333333333333 - t * 0.25))
            u = ivln2H * t
            v = t * ivln2L - w * ivln2
            t1 = withLowWord(u + v, 0)
            t2 = v - (t1 - u)
        } else {
            n = 0
            // take care of subnormal numbers
            if ix < 0x0010_0000 {
                ax *= two53
                n -= 53
                ix = highWord(ax)
            }
            n += (ix >> 20) - 0x3ff
            j = ix & 0x000f_ffff
            // determine the interval
            ix = j | 0x3ff0_0000 // normalize ix
            if j <= 0x3988E {
                k = 0 // |x| < sqrt(3/2)
            } else if j < 0xBB67A {
                k = 1 // |x| < sqrt(3)
            } else {
                k = 0
                n += 1
                ix -= 0x0010_0000
            }
            ax = withHighWord(ax, ix)

            // compute ss = s_h + s_l = (x-1)/(x+1) or (x-1.5)/(x+1.5)
            let ki = Int(k)
            u = ax - bp[ki]
            v = 1.0 / (ax + bp[ki])
            let ss = u * v
            let sH = withLowWord(ss, 0)
            // t_h = ax + bp[k] High
            var tH = fromWords(((ix >> 1) | 0x2000_0000) &+ 0x0008_0000 &+ (k << 18), 0)
            var tL = ax - (tH - bp[ki])
            let sL = v * ((u - sH * tH) - sH * tL)
            // compute log(ax)
            var s2 = ss * ss
            r = s2 * s2 * (L1 + s2 * (L2 + s2 * (L3 + s2 * (L4 + s2 * (L5 + s2 * L6)))))
            r += sL * (sH + ss)
            s2 = sH * sH
            tH = withLowWord(3.0 + s2 + r, 0)
            tL = r - ((tH - 3.0) - s2)
            // u + v = ss * (1 + ...)
            u = sH * tH
            v = sL * tH + tL * ss
            // 2/(3log2) * (ss + ...)
            pH = withLowWord(u + v, 0)
            pL = v - (pH - u)
            let zH = cpH * pH // cp_h + cp_l = 2/(3*log2)
            let zL = cpL * pH + pL * cp + dpL[ki]
            // log2(ax) = (ss + ..) * 2/(3*log2) = n + dp_h + z_h + z_l
            t = Double(n)
            t1 = withLowWord(((zH + zL) + dpH[ki]) + t, 0)
            t2 = zL - (((t1 - t) - dpH[ki]) - zH)
        }

        // split up y into y1 + y2 and compute (y1 + y2) * (t1 + t2)
        let y1 = withLowWord(y, 0)
        pL = (y - y1) * t1 + y * t2
        pH = y1 * t1
        z = pL + pH
        j = highWord(z)
        let i32 = Int32(bitPattern: lowWord(z))
        if j >= 0x4090_0000 { // z >= 1024
            if ((j &- 0x4090_0000) | i32) != 0 { // z > 1024
                return s * huge * huge // overflow
            } else if pL + ovt > z - pH {
                return s * huge * huge // overflow
            }
        } else if (j & 0x7fff_ffff) >= 0x4090_cc00 { // z <= -1075
            if ((j &- Int32(bitPattern: 0xc090_cc00)) | i32) != 0 { // z < -1075
                return s * tiny * tiny // underflow
            } else if pL <= z - pH {
                return s * tiny * tiny // underflow
            }
        }
        // compute 2**(p_h + p_l)
        let i = j & 0x7fff_ffff
        k = (i >> 20) - 0x3ff
        n = 0
        if i > 0x3fe0_0000 { // if |z| > 0.5, set n = [z + 0.5]
            n = j &+ (0x0010_0000 >> (k + 1))
            k = ((n & 0x7fff_ffff) >> 20) - 0x3ff // new k for n
            t = fromWords(n & ~(0x000f_ffff >> k), 0)
            n = ((n & 0x000f_ffff) | 0x0010_0000) >> (20 - k)
            if j < 0 { n = -n }
            pH -= t
        }
        t = withLowWord(pL + pH, 0)
        u = t * lg2H
        v = (pL - (t - pH)) * lg2 + t * lg2L
        z = u + v
        w = v - (z - u)
        t = z * z
        t1 = z - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))))
        // V8 groups this differently from fdlibm (`base::Divide(z * t1, (t1 - two) - (w + z * w))`): keep its result.
        r = (z * t1) / ((t1 - 2.0) - (w + z * w))
        z = 1.0 - (r - z)
        j = highWord(z)
        j = j &+ (n << 20)
        if (j >> 20) <= 0 {
            z = Foundation.scalbn(z, Int(n)) // subnormal output
        } else {
            z = withHighWord(z, j)
        }
        return s * z
    }
}
