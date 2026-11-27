// A step of `pnpm check` (T124.4): no ADR number in `docs/adr/` is used twice, every ADR has its
// line in `docs/adr/README.md`, and every line there links an ADR that exists.
import console from 'node:console'
import { readdirSync, readFileSync } from 'node:fs'
import process from 'node:process'

const dir = 'docs/adr'

/** The problems with `docs/adr`, given its file names and the index's text. */
export function adrProblems(files, index) {
  const problems = []
  const adrs = files.filter((file) => /^\d{4}-.+\.md$/.test(file))
  const byNumber = new Map()
  for (const file of adrs) {
    const number = file.slice(0, 4)
    byNumber.set(number, [...(byNumber.get(number) ?? []), file])
  }
  for (const [number, named] of byNumber) {
    if (named.length > 1) {
      problems.push(
        `ADR ${number} is used twice: ${named.join(', ')}; give one the next free number`,
      )
    }
  }
  const linked = new Set([...index.matchAll(/\]\((\d{4}-[^)]+\.md)\)/g)].map((m) => m[1]))
  for (const file of adrs) {
    if (!linked.has(file)) problems.push(`${dir}/README.md has no line for ${file}`)
  }
  for (const file of linked) {
    if (!adrs.includes(file)) problems.push(`${dir}/README.md links ${file}, which doesn't exist`)
  }
  return problems
}

/** Exits with 1 when `docs/adr` has a problem. */
export function checkAdrs() {
  const problems = adrProblems(readdirSync(dir), readFileSync(`${dir}/README.md`, 'utf8'))
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem)
    process.exit(1)
  }
}
