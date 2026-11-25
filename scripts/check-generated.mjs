// The first step of `pnpm check`: when the change touches the crates or a generated file, runs
// `pnpm generate` and fails if that changed anything. The files are then current: commit them.
//
// The generated files are the ones `.gitattributes` marks `linguist-generated`.
import { execFileSync, spawnSync } from 'node:child_process'
import console from 'node:console'
import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 })
    .split('\0')
    .filter(Boolean)

/** Path -> text, on either line ending; a missing file has no text. */
function snapshot() {
  const files = new Set(
    git('ls-files', '-z', '--cached', '--others', '--exclude-standard', 'packages'),
  )
  const generated = []
  const attributes = execFileSync('git', ['check-attr', '-z', '--stdin', 'linguist-generated'], {
    input: [...files].join('\0'),
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  }).split('\0')
  for (let i = 0; i + 2 < attributes.length; i += 3) {
    if (attributes[i + 2] === 'set') generated.push(attributes[i])
  }
  return new Map(
    generated.map((file) => [
      file,
      existsSync(file) ? readFileSync(file, 'utf8').replaceAll('\r\n', '\n') : undefined,
    ]),
  )
}

/** Exits with 1 when a generated file was stale in a change against `base`. */
export function checkGenerated(base) {
  let changed
  try {
    const [mergeBase] = git('merge-base', base, 'HEAD').map((sha) => sha.trim())
    changed = [
      ...git('diff', '-z', '--name-only', '--no-renames', mergeBase),
      ...git('ls-files', '-z', '--others', '--exclude-standard'),
    ]
  } catch {
    console.error(`pnpm check: unknown base "${base}". Pass the branch this change goes into.`)
    process.exit(1)
  }
  const before = snapshot()
  if (!changed.some((file) => /^(crates\/|Cargo\.)/.test(file) || before.has(file))) return

  console.log('pnpm check: regenerating, the change touches the crates or a generated file')
  const { status } = spawnSync('pnpm generate', { stdio: 'inherit', shell: true })
  if (status !== 0) process.exit(status ?? 1)
  const after = snapshot()
  const stale = [...new Set([...before.keys(), ...after.keys()])].filter(
    (file) => before.get(file) !== after.get(file),
  )
  if (stale.length === 0) return
  console.error(
    `\npnpm check: stale generated files, now regenerated. Commit them and check again:\n` +
      stale.map((file) => `  ${file}`).join('\n'),
  )
  process.exit(1)
}
