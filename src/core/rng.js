'use strict';

/**
 * Seeded pseudo-random number generator (mulberry32).
 * The only source of randomness allowed in engine, economy and AI code.
 *
 * @typedef {object} Rng
 * @property {number} seed            the seed this generator was created with
 * @property {() => number} next      float in [0, 1)
 * @property {(n: number) => number} int   integer in [0, n)  (0 when n <= 0)
 * @property {<T>(arr: T[]) => T} pick     uniformly chosen element (undefined for an empty array)
 * @property {(p: number) => boolean} chance  true with probability p (0..1)
 */

/**
 * Create a mulberry32 generator.
 * @param {number} seed  any integer (floats are truncated, negative values allowed)
 * @returns {Rng}
 */
export function mulberry32(seed) {
  let a = (Number(seed) || 0) >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    seed: Number(seed) || 0,
    next,
    int: (n) => (n > 0 ? Math.floor(next() * n) : 0),
    pick: (arr) => (arr && arr.length ? arr[Math.floor(next() * arr.length)] : undefined),
    chance: (p) => next() < p,
  };
}
