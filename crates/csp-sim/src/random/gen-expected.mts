// Writes expected.json from the frozen TypeScript. Run from the repo root:
//   apps/server/node_modules/.bin/tsx crates/csp-sim/src/random/gen-expected.mts crates/csp-sim/src/random/expected.json
import { writeFileSync } from 'node:fs'
import { mulberry32, hash as strHash } from '../../../../../apps/server/src/residents.ts'
import { hash } from '../../../../../apps/server/src/terrain-gen.ts'
const bits = (x: number) => { const b = new DataView(new ArrayBuffer(8)); b.setFloat64(0, x); return b.getBigUint64(0).toString(16).padStart(16, '0') }
const seeds = [1, 7, 31, 2 ** 31 - 1, -5, 0, -1, 2 ** 32 - 1, 0.5, -0.5, 2 ** 31, 2 ** 53, 1e20, -1e20, NaN, Infinity, 123456789.75]
const streams = seeds.map((s) => { const r = mulberry32(s); return { seed: bits(s), values: Array.from({ length: 50 }, () => bits(r())) } })
let st = 12345
const rnd = () => ((st = (Math.imul(st, 1664525) + 1013904223) | 0) >>> 0) / 4294967296
const pool = [0, 1, -1, 0.5, -0.5, 2 ** 31, 2 ** 32 - 1, -(2 ** 31), 2 ** 32, 2 ** 40 + 3, 1e15, -7.9, NaN, Infinity]
const arg = () => { const k = rnd(); if (k < 0.3) return pool[Math.floor(rnd() * pool.length)]; if (k < 0.6) return Math.floor(rnd() * 1000) - 200; if (k < 0.8) return (rnd() - 0.5) * 1e4; return Math.floor((rnd() - 0.5) * 2 ** 34) }
const hashes = Array.from({ length: 200 }, () => { const x = arg(), y = arg(), s = arg(); return { x: bits(x), y: bits(y), seed: bits(s), out: bits(hash(x, y, s)) } })
const strs = ['', 'a', 'city12', '1234:b7', '42:1000:horse3:strike', 'é', 'Köln', 'naïve ☃', '😀x', 'x\u0000y']
const strings = strs.map((t) => ({ text: t, out: strHash(t) }))
writeFileSync(process.argv[2], JSON.stringify({ streams, hashes, strings }, null, 1))
