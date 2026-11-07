// Writes every exported constant of packages/shared/src/balance.ts to
// crates/csp-sim/fixtures/balance.json, as the golden file the Rust balance table is tested
// against (ADR 0030, T84.4). Functions are not data and are left out; keys keep the order the
// module exports them in, so a rerun on unchanged numbers changes nothing.
//
// Run from the repo root: corepack pnpm --filter @csp/server exec tsx --conditions=source ../../scripts/dump-balance.mts
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as balance from '../packages/shared/src/balance.js'

const out: Record<string, unknown> = {}
for (const [name, value] of Object.entries(balance)) {
  if (typeof value === 'function') continue
  out[name] = value
}

const target = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../crates/csp-sim/fixtures/balance.json',
)
mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, JSON.stringify(out, null, 2) + '\n')
console.log(`${Object.keys(out).length} constants written to ${target}`)
