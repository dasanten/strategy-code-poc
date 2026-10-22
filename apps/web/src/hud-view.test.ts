import { describe, expect, it } from 'vitest'
import type { Building } from '@csp/shared'
import { DRAWERS, isWide, keyGoods, toggleDrawer, type OpenDrawer } from './hud-view.js'

describe('drawers', () => {
  it('has a drawer for every tool on the rail, once each', () => {
    const labels = DRAWERS.map((d) => d.label)
    for (const tool of [
      'Residents',
      'Armies',
      'Contracts',
      'Alliance',
      'Standing',
      'Scripts',
      'Realm log',
    ])
      expect(labels).toContain(tool)
    expect(new Set(DRAWERS.map((d) => d.id)).size).toBe(DRAWERS.length)
  })

  it('opens the clicked drawer when none is open', () => {
    expect(toggleDrawer(undefined, 'armies')).toBe('armies')
  })

  it('closes the open drawer when its button is clicked again', () => {
    expect(toggleDrawer('armies', 'armies')).toBeUndefined()
  })

  it('keeps one drawer open at a time: another button swaps it', () => {
    let open: OpenDrawer = undefined
    open = toggleDrawer(open, 'residents')
    open = toggleDrawer(open, 'realmLog')
    expect(open).toBe('realmLog')
    open = toggleDrawer(open, 'residents')
    expect(open).toBe('residents')
  })

  it('makes only the Scripts drawer wide', () => {
    expect(DRAWERS.filter((d) => isWide(d.id)).map((d) => d.id)).toEqual(['scripts'])
  })
})

describe('key goods of the home city', () => {
  const building = (b: Partial<Building>): Building => ({
    id: Math.random().toString(36),
    kind: 'storage',
    cityId: 'home',
    x: 0,
    y: 0,
    ...b,
  })

  it('adds up the storages and warehouses of the city', () => {
    const goods = keyGoods(
      [
        building({ stock: { food: 10, wood: 4, iron: 3 } }),
        building({ kind: 'warehouse', stock: { food: 5, coins: 20 } }),
      ],
      'home',
    )
    expect(goods).toEqual({ food: 15, wood: 4, stone: 0, coins: 20 })
  })

  it("leaves out other cities, construction sites and stables' horse food", () => {
    const goods = keyGoods(
      [
        building({ cityId: 'other', stock: { food: 9 } }),
        building({ site: { delivered: {}, work: 0 } as Building['site'], stock: { wood: 9 } }),
        building({ kind: 'stable', stock: { food: 9 } }),
      ],
      'home',
    )
    expect(goods).toEqual({ food: 0, wood: 0, stone: 0, coins: 0 })
  })

  it('shows nothing when the realm has no home city', () => {
    expect(keyGoods([building({ stock: { food: 3 } })], null).food).toBe(0)
  })
})
