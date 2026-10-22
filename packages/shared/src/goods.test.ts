import { describe, expect, it } from 'vitest'
import { OWN_FOOD } from './balance.js'
import { putAwayUnits } from './goods.js'

describe('putAwayUnits', () => {
  it('puts away all but their own food', () => {
    expect(putAwayUnits('food', OWN_FOOD + 7)).toBe(7)
  })

  it('puts away no Food when they carry only their own food or less', () => {
    expect(putAwayUnits('food', OWN_FOOD)).toBe(0)
    expect(putAwayUnits('food', 1)).toBe(0)
  })

  it('puts away all of other goods', () => {
    expect(putAwayUnits('wood', 12)).toBe(12)
    expect(putAwayUnits('coins', 3)).toBe(3)
  })
})
