// The test step of `pnpm check` (ADR 0013): runs only the test files that import, directly or
// not, a file changed since <base>, and says what it ran. A change to a file in the Vitest config's
// `forceRerunTriggers` runs the whole suite. Tests tagged `slow` are skipped even when affected.
// `pnpm test` stays the full suite; CI runs that.
//
// Usage: node scripts/check-tests.mjs [base]   (base defaults to origin/dev)
import { execFileSync } from 'node:child_process'
import console from 'node:console'
import process from 'node:process'
import { startVitest } from 'vitest/node'

const base = process.argv[2] ?? 'origin/dev'

try {
  execFileSync('git', ['rev-parse', '--verify', '--quiet', `${base}^{commit}`], { stdio: 'ignore' })
} catch {
  console.error(`pnpm check: unknown base "${base}". Pass the branch this change goes into.`)
  process.exit(1)
}

const vitest = await startVitest([], {
  changed: base,
  watch: false,
  passWithNoTests: true,
  tagsFilter: ['!slow'],
})
const modules = vitest.state.getTestModules()
const ran = modules.length
const slow = modules
  .flatMap((module) => [...module.children.allTests()])
  .filter((test) => test.tags.includes('slow')).length
const total = (await vitest.globTestSpecifications()).length
await vitest.close()

console.log(
  `\npnpm check: ran ${ran} of ${total} test files, affected by changes against ${base};` +
    ` skipped ${slow} slow ${slow === 1 ? 'test' : 'tests'} (CI runs them).`,
)
