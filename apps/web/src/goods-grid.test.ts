import { describe, expect, it } from 'vitest'
import { GOODS, OWN_FOOD } from '@csp/shared'
import {
  GOOD_ART,
  GOOD_FILES,
  GOOD_LABELS,
  carriedItems,
  goodsAmount,
  goodsItems,
} from './goods-grid.js'

describe('goods icons', () => {
  it('has an SVG icon and a name for every good kind', () => {
    for (const good of GOODS) {
      expect(GOOD_FILES[GOOD_ART[good]]?.trimStart().startsWith('<svg'), good).toBe(true)
      expect(GOOD_LABELS[good], good).toBeTruthy()
    }
  })

  it('draws each good with its own icon', () => {
    expect(new Set(GOODS.map((g) => GOOD_ART[g])).size).toBe(GOODS.length)
  })
})

describe('goodsItems', () => {
  it('lists a load in the usual order of goods, zero amounts left out', () => {
    expect(goodsItems({ iron: 2, wood: 12, stone: 0, food: 3 })).toEqual([
      { good: 'food', amount: 3 },
      { good: 'wood', amount: 12 },
      { good: 'iron', amount: 2 },
    ])
  })

  it('is empty for nothing at all', () => {
    expect(goodsItems(undefined)).toEqual([])
    expect(goodsItems({ coins: 0 })).toEqual([])
  })
})

describe('goodsAmount', () => {
  it('shows whole units rounded down, and a last bit below one to a tenth', () => {
    expect(goodsAmount(12)).toBe('12')
    expect(goodsAmount(4.7)).toBe('4')
    expect(goodsAmount(0.56)).toBe('0.5')
    expect(goodsAmount(0.04)).toBe('0')
  })
})

describe('carriedItems', () => {
  it('shows own food apart and only Food beyond it as a cell', () => {
    expect(carriedItems({ food: OWN_FOOD + 3, wood: 5 })).toEqual({
      items: [
        { good: 'food', amount: 3 },
        { good: 'wood', amount: 5 },
      ],
      ownFood: OWN_FOOD,
    })
  })

  it('keeps all Food as own food while there is no more than that', () => {
    expect(carriedItems({ food: OWN_FOOD - 1, coins: 0 })).toEqual({
      items: [],
      ownFood: OWN_FOOD - 1,
    })
  })

  it('has own food 0 for a resident carrying none', () => {
    expect(carriedItems({ stone: 2 })).toEqual({
      items: [{ good: 'stone', amount: 2 }],
      ownFood: 0,
    })
    expect(carriedItems(undefined)).toEqual({ items: [], ownFood: 0 })
  })
})
