import { describe, expect, it } from 'vitest'
import { moodLine } from './stance-view.js'

describe('an NPC city’s stance', () => {
  it('reads as a mood line on its card, and as nothing for a city without one', () => {
    expect(moodLine('grow')).toBe('Mood: growing')
    expect(moodLine('fortify')).toBe('Mood: arming')
    expect(moodLine('trade')).toBe('Mood: busy trading')
    expect(moodLine('expand')).toBe('Mood: looking to expand')
    expect(moodLine('retaliate', 'Mara')).toBe('Mood: retaliating against Mara')
    expect(moodLine('retaliate')).toBe('Mood: retaliating')
    expect(moodLine(undefined)).toBeUndefined()
  })
})
