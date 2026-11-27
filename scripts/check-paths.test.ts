import { describe, expect, it } from 'vitest'
// @ts-expect-error: a plain module of `pnpm check`, with no types.
import { checkedPart, headerOf, missingPaths, pathsIn } from './check-paths.mjs'

describe('the path check of `pnpm check` (T124.5)', () => {
  it('passes on the repo as it is', () => {
    expect(missingPaths()).toEqual([])
  })

  it('fails when a doc names a path that does not exist', () => {
    const docs = [['docs/some.md', 'See `docs/gone.md` and `crates/csp-sim/src/world.rs:12`.']]
    expect(missingPaths({ docs, code: [] })).toEqual([['docs/some.md', 'docs/gone.md']])
  })

  it('fails when a module header names a deleted file, and reads only the header', () => {
    const code = [
      [
        'crates/csp-sim/src/x.rs',
        '//! Walls (`apps/server/src/walls.ts`, `gone-rule.ts`).\n\nuse a;\n// `docs/later.md`\n',
      ],
      ['apps/web/src/y.ts', "import { a } from 'b'\n\n// The map (`apps/web/src/nope.ts`).\nconst a = 1\n"],
    ]
    expect(missingPaths({ docs: [], code })).toEqual([
      ['crates/csp-sim/src/x.rs', 'apps/server/src/walls.ts'],
      ['apps/web/src/y.ts', 'apps/web/src/nope.ts'],
      ['crates/csp-sim/src/x.rs', 'gone-rule.ts'],
    ])
  })

  it('counts a path git ignores as there', () => {
    const docs = [['docs/some.md', 'Built into `packages/lang-wasm/generated/`.']]
    expect(missingPaths({ docs, code: [] })).toEqual([])
  })

  it('takes only repo paths, not globs, placeholders or words with a slash', () => {
    expect(
      pathsIn('`docs/a.md#x` `crates/*/src` `wiki/<id>.tsx` `and/or` `apps/web/` `@csp/balance`'),
    ).toEqual(['docs/a.md', 'apps/web/'])
  })

  it('leaves out the log of past work and replaced ADRs', () => {
    const tasks = 'rules `docs/x.md`\n## Epics\n`docs/y.md`'
    expect(pathsIn(checkedPart('docs/tasks.md', tasks))).toEqual(['docs/x.md', 'docs/y.md'])
    expect(checkedPart('docs/log.md', '`apps/server`')).toBe('')
    expect(checkedPart('docs/adr/0001-x.md', '# X\n\nStatus: superseded by ADR 0030.\n`a/b`')).toBe(
      '',
    )
  })

  it('reads a header before and after the imports', () => {
    expect(headerOf("// one\nimport a from 'a'\n/* two */\nconst x = 1\n// three\n")).toBe(
      '// one\n/* two */',
    )
  })
})
