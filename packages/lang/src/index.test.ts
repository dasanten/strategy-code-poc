import { describe, expect, it } from 'vitest'
import { checkScript, LANGUAGE_VERSION } from './index.js'

describe('lang', () => {
  it('exposes the language version', () => {
    expect(LANGUAGE_VERSION).toBe(1)
  })

  it('accepts any script until the parser exists', () => {
    expect(checkScript('let x = 1')).toEqual([])
  })
})
