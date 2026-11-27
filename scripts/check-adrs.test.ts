import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { adrProblems } from './check-adrs.mjs'

const index = (...files: string[]) =>
  files.map((file) => `- [x](${file}) Title: in force.`).join('\n')

describe('the ADR check', () => {
  it('passes on docs/adr as it is', () => {
    expect(
      adrProblems(readdirSync('docs/adr'), readFileSync('docs/adr/README.md', 'utf8')),
    ).toEqual([])
  })

  it('fails on a number used twice', () => {
    const files = ['0001-a.md', '0002-b.md', '0002-c.md']
    expect(adrProblems(files, index(...files))).toEqual([
      'ADR 0002 is used twice: 0002-b.md, 0002-c.md; give one the next free number',
    ])
  })

  it('fails on an ADR missing from the index, and on a line for one that is gone', () => {
    expect(
      adrProblems(['0001-a.md', '0002-b.md', 'README.md'], index('0001-a.md', '0003-c.md')),
    ).toEqual([
      'docs/adr/README.md has no line for 0002-b.md',
      "docs/adr/README.md links 0003-c.md, which doesn't exist",
    ])
  })
})
