// A step of `pnpm check` (T124.5): every repo path written in backticks in the docs agents read
// and in the module headers of the code exists, so no doc or comment sends a reader to a file
// that is gone. A path is a backticked word with a `/` whose first folder is one of the repo's
// own (`ROOTS`); a glob or placeholder (`*`, `<id>`, `{…}`) is not one. A path git ignores (a
// build output) counts as there. In a crate's header a TypeScript file named alone (`x.ts`) is
// checked too: no tracked file may be missing that name. Exempt: the ADRs whose status says
// another replaced them, the docs of what was (`HISTORY`), and in `docs/tasks.md` the log of past
// work before its epic table.
import { execFileSync } from 'node:child_process'
import console from 'node:console'
import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/** The repo's top-level folders: a backticked path starting with one is a repo path. */
export const ROOTS = [
  '.cargo',
  '.claude',
  '.config',
  '.github',
  'apps',
  'art',
  'crates',
  'deploy',
  'docs',
  'packages',
  'scripts',
]

/** The backticked repo paths in `text`, without a trailing `:line`, `#anchor` or `::item`. */
export function pathsIn(text) {
  const found = []
  for (const [, raw] of text.matchAll(/`([^`\n]+)`/g)) {
    const path = raw
      .trim()
      .replace(/::.*$/, '')
      .replace(/#.*$/, '')
      .replace(/:\d+(-\d+)?$/, '')
    if (!/^[\w.@-]+(\/[\w.@-]+)+\/?$/.test(path)) continue
    if (!ROOTS.includes(path.split('/')[0])) continue
    found.push(path)
  }
  return found
}

/**
 * A module's header: the comments it opens with, before or right after its imports and before
 * its first line of code.
 */
export function headerOf(text) {
  const lines = text.split(/\r?\n/)
  const header = []
  let inImport = false
  let inBlock = false
  for (const line of lines) {
    const t = line.trim()
    if (inBlock) {
      header.push(t)
      if (t.includes('*/')) inBlock = false
      continue
    }
    if (inImport) {
      if (/from\s+['"][^'"]+['"]|^['"][^'"]+['"];?$/.test(t) || /^\}\s*;?$/.test(t)) {
        inImport = false
      }
      continue
    }
    if (t === '' || t.startsWith('#!')) continue
    if (t.startsWith('//')) {
      header.push(t)
      continue
    }
    if (t.startsWith('/*')) {
      header.push(t)
      if (!t.includes('*/')) inBlock = true
      continue
    }
    if (/^(import|export \* from|export \{[^}]*\} from)\b/.test(t)) {
      if (!/from\s+['"][^'"]+['"]|^import\s+['"][^'"]+['"]/.test(t)) inImport = true
      continue
    }
    if (/^#!?\[/.test(t)) continue
    break
  }
  return header.join('\n')
}

/**
 * Docs that record what was, so the files they name may be gone: the decision to rewrite the
 * server (it names the TypeScript it deleted) and the proposal it came from.
 */
export const HISTORY = [
  'docs/log.md',
  'docs/adr/0030-rust-backend.md',
  'docs/proposals/rust-rewrite.md',
]

/** The part of a doc that is checked: all of it, but for the exempt parts. */
export function checkedPart(file, text) {
  if (HISTORY.includes(file)) return ''
  if (file.startsWith('docs/adr/') && isReplaced(text)) return ''
  if (file === 'docs/tasks.md') {
    const epics = text.search(/^## Epics/m)
    return epics < 0 ? text : text.slice(epics)
  }
  return text
}

/** Whether an ADR says, in its first lines, that another decision or the rewrite replaced it. */
export function isReplaced(text) {
  const head = text.split(/\r?\n/).slice(0, 6).join('\n')
  return /\b(superseded|replaced|overtaken)\b/i.test(head)
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 })

/** The docs and the code whose paths are checked, as the repo tracks them. */
function files() {
  const tracked = git('ls-files', '-z').split('\0').filter(Boolean)
  const generated = new Set(
    git('ls-files', '-z', '--', ':(attr:linguist-generated)').split('\0').filter(Boolean),
  )
  const docs = tracked.filter(
    (f) =>
      ['CLAUDE.md', 'CONTEXT.md', 'README.md'].includes(f) ||
      (f.startsWith('docs/') && f.endsWith('.md')) ||
      (/^\.claude\/(skills|commands)\//.test(f) && f.endsWith('.md')),
  )
  const code = tracked.filter(
    (f) =>
      !generated.has(f) &&
      !f.includes('/fixtures/') &&
      (/^crates\/.*\.rs$/.test(f) || /^(apps|packages|scripts)\/.*\.(ts|tsx|mts|mjs|js)$/.test(f)),
  )
  return { docs, code }
}

/**
 * The TypeScript files a header names by their file name alone (`orders.ts`): since the rewrite
 * a crate's header that names one names the TypeScript server's, unless the client has one.
 */
export function bareScriptsIn(text) {
  return [...text.matchAll(/`([\w.-]+\.(?:ts|tsx|mts))`/g)].map(([, name]) => name)
}

/** `[file, path]` for every path named that is neither in the tree nor ignored by git. */
export function missingPaths({ docs, code } = trackedTexts()) {
  const names = new Set(git('ls-files', '-z').split('\0').map((f) => f.split('/').pop()))
  const named = [
    ...docs.map(([f, text]) => [f, checkedPart(f, text)]),
    ...code.map(([f, text]) => [f, headerOf(text)]),
  ].flatMap(([file, text]) => pathsIn(text).map((path) => [file, path]))
  const bare = code
    .filter(([f]) => f.endsWith('.rs'))
    .flatMap(([f, text]) => bareScriptsIn(headerOf(text)).map((name) => [f, name]))
    .filter(([, name]) => !names.has(name))
  const absent = [...new Set(named.map(([, p]) => p))].filter((p) => !existsSync(p))
  const ignored = new Set(absent.length === 0 ? [] : ignoredOf(absent))
  return [...named.filter(([, p]) => !existsSync(p) && !ignored.has(p)), ...bare]
}

/** The paths of `paths` that git ignores. */
function ignoredOf(paths) {
  try {
    return execFileSync('git', ['check-ignore', '--no-index', '--stdin'], {
      input: paths.join('\n'),
      encoding: 'utf8',
    })
      .split(/\r?\n/)
      .filter(Boolean)
  } catch {
    return [] // exit 1: none of them is ignored
  }
}

/** The tracked docs and code whose paths are checked, each `[file, text]`. */
function trackedTexts() {
  const { docs, code } = files()
  const read = (f) => [f, readFileSync(f, 'utf8')]
  return { docs: docs.map(read), code: code.map(read) }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const missing = missingPaths()
  if (missing.length > 0) {
    for (const [file, path] of missing) console.error(`${file}: \`${path}\` does not exist`)
    console.error(`pnpm check: ${missing.length} paths named in docs or headers do not exist`)
    process.exit(1)
  }
  console.log('pnpm check: every path named in the docs and module headers exists')
}
