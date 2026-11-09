import * as shared from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { balance } from './constants.js'
import * as exported from './index.js'

/**
 * Until the cutover the TypeScript game is the spec (ADR 0030): the JSON Rust writes must hold
 * the very numbers `packages/shared` has. Deleted with `packages/shared`.
 */
describe('balance.json against packages/shared', () => {
  const table = balance as unknown as Record<string, unknown>
  // What the Rust export adds to the table of `balance.ts`: numbers of other shared modules.
  const own = new Set(['TERRAIN', 'TICKS_PER_GAME_YEAR'])

  it('holds every number of the game with the same value', () => {
    const shown = shared as Record<string, unknown>
    const problems: string[] = []
    for (const [key, value] of Object.entries(table)) {
      if (own.has(key)) continue
      if (!(key in shown)) problems.push(`${key}: not in @csp/shared`)
      else if (JSON.stringify(value) !== JSON.stringify(shown[key]))
        problems.push(`${key}: JSON ${JSON.stringify(value)}, shared ${JSON.stringify(shown[key])}`)
    }
    expect(problems).toEqual([])
  })

  it('holds the terrain codes of the Terrain object', () => {
    expect(balance.TERRAIN).toEqual({ ...shared.Terrain })
  })

  it('exports every number by name', () => {
    for (const [key, value] of Object.entries(table))
      expect((exported as Record<string, unknown>)[key]).toBe(value)
  })
})
