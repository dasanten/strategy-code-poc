import { describe, expect, it } from 'vitest'
import { temperamentLine } from './temperament-view.js'

describe('an NPC city’s temperament', () => {
  it('reads as a line on its card, and as nothing for a city without one', () => {
    expect(temperamentLine('merchant')).toBe('Temperament: merchant')
    expect(temperamentLine('militarist')).toBe('Temperament: militarist')
    expect(temperamentLine('settler')).toBe('Temperament: settler')
    expect(temperamentLine(undefined)).toBeUndefined()
  })
})
