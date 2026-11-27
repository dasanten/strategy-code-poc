import { describe, expect, it } from 'vitest'
import { SKILL_LABELS } from '../residents/Residents.js'
import { SKILL_NAMES } from './world.js'

describe('the skills the client lists', () => {
  it('are every skill, Seafaring too (`CONTEXT.md`: Skill, Seafaring; bug #1629)', () => {
    expect(SKILL_NAMES).toContain('seafaring')
    expect([...SKILL_NAMES].sort()).toEqual(Object.keys(SKILL_LABELS).sort())
  })
})
