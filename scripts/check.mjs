// `pnpm check [base]` (ADR 0013): the generated files are current, lint, typecheck, and the tests
// the change affects. `base` is the branch the change goes into (default origin/dev).
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { checkGenerated } from './check-generated.mjs'

const base = process.argv[2] ?? 'origin/dev'

function run(command) {
  const { status } = spawnSync(command, { stdio: 'inherit', shell: true })
  if (status !== 0) process.exit(status ?? 1)
}

checkGenerated(base)
run('pnpm exec eslint . --cache --cache-location node_modules/.cache/eslint/')
run('pnpm typecheck')
run(`node scripts/check-tests.mjs "${base}"`)
