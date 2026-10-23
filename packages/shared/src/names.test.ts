import { describe, expect, it } from 'vitest'
import { REALM_NAME_MAX_LENGTH, RESIDENT_NAME_MAX_LENGTH } from './balance.js'
import { foundingProblem, nameProblem } from './names.js'

describe('names', () => {
  it('takes a name trimmed, not empty and at most the max length', () => {
    expect(nameProblem('Ironvale', 30)).toBeUndefined()
    expect(nameProblem('  Ironvale  ', 8)).toBeUndefined()
    expect(nameProblem('', 30)).toBe('needs a name')
    expect(nameProblem('   ', 30)).toBe('needs a name')
    expect(nameProblem(undefined, 30)).toBe('needs a name')
    expect(nameProblem('x'.repeat(9), 8)).toBe('at most 8 characters')
  })

  it('checks both names given at founding', () => {
    expect(foundingProblem('Ironvale', 'Brann')).toBeUndefined()
    expect(foundingProblem('', 'Brann')).toBe('Realm name: needs a name')
    expect(foundingProblem('x'.repeat(REALM_NAME_MAX_LENGTH + 1), 'Brann')).toMatch(/^Realm name/)
    expect(foundingProblem('Ironvale', ' ')).toBe('Leader name: needs a name')
    expect(foundingProblem('Ironvale', 'y'.repeat(RESIDENT_NAME_MAX_LENGTH + 1))).toMatch(
      /^Leader name/,
    )
  })
})
