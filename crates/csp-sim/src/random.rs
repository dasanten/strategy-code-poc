//! Random numbers and hashes, ported bit for bit from the frozen TypeScript (ADR 0030): a world
//! generated or stepped from the same seed must be the same world in Rust.
//!
//! Sources: `mulberry32` and the string `hash` in `apps/server/src/residents.ts`, the lattice
//! `hash(x, y, seed)` in `apps/server/src/terrain-gen.ts`, `newId` in `starting-city.ts`.
//!
//! JavaScript semantics relied on, made explicit:
//! - `Math.imul(a, b)`: both arguments go through `ToInt32`, the product is taken modulo 2^32 and
//!   read as a signed 32-bit integer, i.e. `i32::wrapping_mul`.
//! - `x | 0` and every bitwise operator (`^`, `|`, `>>>`) first apply `ToInt32` to a number: NaN
//!   and the infinities give 0, otherwise truncate toward zero and reduce modulo 2^32 into the
//!   signed range. See [`to_int32`].
//! - `a + b` on two numbers is an `f64` add; `(seed + 0x6d2b79f5) | 0` is therefore the wrapping
//!   `i32` add whenever `seed` is already an `i32` (it is, after `seed |= 0`).
//! - `x >>> n` shifts the `u32` view of `x` (logical shift); the result is a non-negative number.
//!   `x >>> 0` just reinterprets the `i32` as `u32`.
//! - `/ 4294967296` divides by 2^32 in `f64`; exact, since a `u32` is exactly representable.

/// `ToInt32` of a JavaScript number, as done by `x | 0`.
pub fn to_int32(x: f64) -> i32 {
    if !x.is_finite() {
        return 0; // NaN, +Infinity, -Infinity -> 0
    }
    // Truncate toward zero, then reduce modulo 2^32. `%` on f64 is an exact fmod, so every
    // integer-valued input (up to 1e308) is handled without rounding.
    let m = x.trunc() % 4_294_967_296.0;
    let m = if m < 0.0 { m + 4_294_967_296.0 } else { m };
    // m is in [0, 2^32); `as u32` is exact, `as i32` wraps into the signed range.
    m as u32 as i32
}

/// `Math.imul(a, b)` on two `i32`s: wrapping 32-bit multiplication.
#[inline]
fn imul(a: i32, b: i32) -> i32 {
    a.wrapping_mul(b)
}

/// `h ^ (h >>> n)` with JavaScript meaning: `>>>` shifts the `u32` view, `^` works on `i32`.
#[inline]
fn xorshift(h: i32, n: u32) -> i32 {
    h ^ (((h as u32) >> n) as i32)
}

/// The generator returned by `mulberry32(seed)`: state `seed`, advanced on every call.
#[derive(Debug, Clone)]
pub struct Mulberry32 {
    seed: i32,
}

impl Mulberry32 {
    /// `mulberry32(seed)`. `seed` is a JavaScript number; `seed |= 0` on the first call applies
    /// `ToInt32` (fractions truncate, negatives and large values wrap, NaN/∞ give 0). Doing it
    /// once here is the same, because later calls see an `i32` already.
    pub fn new(seed: f64) -> Self {
        Self { seed: to_int32(seed) }
    }

    /// One call of the returned closure: a number in [0, 1) with 32 bits of resolution.
    #[allow(clippy::should_implement_trait)] // an infinite generator, not an Iterator
    pub fn next(&mut self) -> f64 {
        // seed |= 0 : already an i32.
        // seed = (seed + 0x6d2b79f5) | 0 : wrapping i32 add.
        self.seed = self.seed.wrapping_add(0x6d2b_79f5);
        let seed = self.seed;
        // let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        let mut t = imul(xorshift(seed, 15), 1 | seed);
        // t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t   (the `+` is an f64 add, then `^`
        // applies ToInt32; the sum of two i32 is below 2^32 in magnitude, so that is the
        // wrapping add)
        t = t.wrapping_add(imul(xorshift(t, 7), 61 | t)) ^ t;
        // ((t ^ (t >>> 14)) >>> 0) / 4294967296
        f64::from(xorshift(t, 14) as u32) / 4_294_967_296.0
    }
}

/// `hash(x, y, seed)` of `terrain-gen.ts`: the integer hash of a lattice point, in [0, 1).
///
/// Arguments are JavaScript numbers; `Math.imul` applies `ToInt32` to each, so negatives,
/// fractions (truncated) and large values (wrapped) behave exactly as in TypeScript.
pub fn hash(x: f64, y: f64, seed: f64) -> f64 {
    // Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9)
    // (0x9e3779b9 > i32::MAX: Math.imul reads it as ToInt32, i.e. as the i32 bit pattern.)
    let mut h = imul(to_int32(x), 0x27d4_eb2d)
        ^ imul(to_int32(y), 0x1656_67b1)
        ^ imul(to_int32(seed), 0x9e37_79b9_u32 as i32);
    // h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
    h = imul(xorshift(h, 15), 0x85eb_ca6b_u32 as i32);
    // h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
    h = imul(xorshift(h, 13), 0xc2b2_ae35_u32 as i32);
    // ((h ^ (h >>> 16)) >>> 0) / 4294967296
    f64::from(xorshift(h, 16) as u32) / 4_294_967_296.0
}

/// The string `hash` of `residents.ts` (FNV-1a over UTF-16 code units): picks names and
/// phases from ids. Returns the `u32` that `h >>> 0` gives.
pub fn hash_str(text: &str) -> u32 {
    let mut h = 0x811c_9dc5_u32 as i32;
    // text.charCodeAt(i) is a UTF-16 code unit, so astral characters count as two.
    for unit in text.encode_utf16() {
        // h = Math.imul(h ^ unit, 0x01000193)
        h = imul(h ^ i32::from(unit), 0x0100_0193);
    }
    h as u32 // h >>> 0
}

/// `newId(world, prefix)` of `starting-city.ts`: `${prefix}${world.nextId++}`. It draws no
/// random number; the counter is the world's `nextId`.
pub fn new_id(prefix: &str, next_id: &mut u64) -> String {
    let id = format!("{prefix}{next_id}");
    *next_id += 1;
    id
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn expected() -> Value {
        serde_json::from_str(include_str!("random/expected.json")).expect("expected.json")
    }

    /// An `f64` written as 16 hex digits of its bits by `gen-expected.mts`.
    fn bits(v: &Value) -> u64 {
        u64::from_str_radix(v.as_str().expect("hex string"), 16).expect("hex")
    }

    fn num(v: &Value) -> f64 {
        f64::from_bits(bits(v))
    }

    #[test]
    fn mulberry32_streams_match_javascript_bit_for_bit() {
        let e = expected();
        let streams = e["streams"].as_array().unwrap();
        assert!(streams.len() >= 9);
        for s in streams {
            let seed = num(&s["seed"]);
            let mut rng = Mulberry32::new(seed);
            for (i, want) in s["values"].as_array().unwrap().iter().enumerate() {
                assert_eq!(rng.next().to_bits(), bits(want), "seed {seed}, value {i}");
            }
        }
    }

    #[test]
    fn lattice_hash_matches_javascript_bit_for_bit() {
        let e = expected();
        let rows = e["hashes"].as_array().unwrap();
        assert_eq!(rows.len(), 200);
        for r in rows {
            let (x, y, s) = (num(&r["x"]), num(&r["y"]), num(&r["seed"]));
            assert_eq!(hash(x, y, s).to_bits(), bits(&r["out"]), "hash({x}, {y}, {s})");
        }
    }

    #[test]
    fn string_hash_matches_javascript() {
        let e = expected();
        for r in e["strings"].as_array().unwrap() {
            let text = r["text"].as_str().unwrap();
            assert_eq!(u64::from(hash_str(text)), r["out"].as_u64().unwrap(), "{text:?}");
        }
    }

    #[test]
    fn to_int32_follows_javascript() {
        assert_eq!(to_int32(0.5), 0);
        assert_eq!(to_int32(-0.5), 0);
        assert_eq!(to_int32(-1.9), -1);
        assert_eq!(to_int32(4_294_967_295.0), -1);
        assert_eq!(to_int32(2_147_483_648.0), i32::MIN);
        assert_eq!(to_int32(-2_147_483_649.0), i32::MAX);
        assert_eq!(to_int32(f64::NAN), 0);
        assert_eq!(to_int32(f64::INFINITY), 0);
        assert_eq!(to_int32(2f64.powi(53)), 0);
        assert_eq!(to_int32(1e20), 1_661_992_960);
    }

    #[test]
    fn new_id_counts_up() {
        let mut next = 7;
        assert_eq!(new_id("b", &mut next), "b7");
        assert_eq!(new_id("horse", &mut next), "horse8");
        assert_eq!(next, 9);
    }
}
