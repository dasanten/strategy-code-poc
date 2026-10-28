import { describe, expect, it } from 'vitest'
import { LONG_PRESS_MS, TAP_SLOP, longPresses, pressKind } from './gestures'

describe('pressKind', () => {
  it('is a tap when one finger hardly moves and lets go quickly', () => {
    expect(pressKind({ moved: 0, heldMs: 100, fingers: 1 }, true)).toBe('tap')
    expect(pressKind({ moved: TAP_SLOP - 1, heldMs: LONG_PRESS_MS - 1, fingers: 1 }, true)).toBe(
      'tap',
    )
  })

  it('is a drag (a pan) once the finger wanders as far as the slop', () => {
    expect(pressKind({ moved: TAP_SLOP, heldMs: 50, fingers: 1 }, true)).toBe('drag')
    expect(pressKind({ moved: 40, heldMs: 2000, fingers: 1 }, true)).toBe('drag')
  })

  it('is a long-press when a finger rests still long enough', () => {
    expect(pressKind({ moved: 2, heldMs: LONG_PRESS_MS, fingers: 1 }, true)).toBe('long-press')
  })

  it('never makes a tap or long-press out of a pinch, however still', () => {
    expect(pressKind({ moved: 0, heldMs: 50, fingers: 2 }, true)).toBe('drag')
    expect(pressKind({ moved: 0, heldMs: 2000, fingers: 2 }, true)).toBe('drag')
  })

  it('leaves a held mouse press a click: the mouse right-clicks instead', () => {
    expect(pressKind({ moved: 0, heldMs: 2000, fingers: 1 }, false)).toBe('tap')
  })
})

describe('longPresses', () => {
  it('takes long-presses from touch and pen, not the mouse', () => {
    expect(longPresses('touch')).toBe(true)
    expect(longPresses('pen')).toBe(true)
    expect(longPresses('mouse')).toBe(false)
  })
})
