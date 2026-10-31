import { describe, expect, it } from 'vitest'
import type { Building } from '@csp/shared'
import {
  DRAWERS,
  DRAWER_WIDTH,
  MIN_OPEN_MAP,
  drawerWidth,
  rememberedDrawerWidth,
  isWide,
  keyGoods,
  showBeside,
  toggleDrawer,
  type OpenDrawer,
} from './hud-view.js'

describe('drawers', () => {
  it('has a drawer for every tool on the rail, once each', () => {
    const labels = DRAWERS.map((d) => d.label)
    for (const tool of [
      'Residents',
      'Horses',
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

  it('shows a place between the open drawer and the card', () => {
    expect(showBeside(1280, 0, 0)).toEqual({ left: 0, right: 0, closeDrawer: false })
    expect(showBeside(1280, 428, 0)).toEqual({ left: 428, right: 0, closeDrawer: false })
    expect(showBeside(1024, 428, 372)).toEqual({ left: 428, right: 372, closeDrawer: false })
    const room = 1024 - 428 - MIN_OPEN_MAP
    expect(showBeside(1024, 428, room)).toEqual({ left: 428, right: room, closeDrawer: false })
  })

  it('closes a drawer that leaves too little map, and uses the whole screen if need be', () => {
    // Drawer and card leave 100 px: without the drawer there is room beside the card.
    expect(showBeside(900, 428, 372)).toEqual({ left: 0, right: 372, closeDrawer: true })
    // A phone: the drawer covers the map, and the card nearly all of it.
    expect(showBeside(375, 375, 0)).toEqual({ left: 0, right: 0, closeDrawer: true })
    expect(showBeside(375, 375, 351)).toEqual({ left: 0, right: 0, closeDrawer: true })
    // No drawer open and a card that leaves too little: the whole screen.
    expect(showBeside(375, 0, 351)).toEqual({ left: 0, right: 0, closeDrawer: false })
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

describe('drawer width', () => {
  it('keeps a dragged width within the limits', () => {
    expect(drawerWidth(DRAWER_WIDTH.min - 100)).toBe(DRAWER_WIDTH.min)
    expect(drawerWidth(DRAWER_WIDTH.max + 100)).toBe(DRAWER_WIDTH.max)
    expect(drawerWidth(450.6)).toBe(451)
    expect(drawerWidth(Number.NaN)).toBe(DRAWER_WIDTH.initial)
  })

  it('starts at the initial width the limits allow', () => {
    expect(DRAWER_WIDTH.initial).toBeGreaterThanOrEqual(DRAWER_WIDTH.min)
    expect(DRAWER_WIDTH.initial).toBeLessThanOrEqual(DRAWER_WIDTH.max)
  })

  it('falls back to the initial width without a remembered one', () => {
    expect(rememberedDrawerWidth(null)).toBe(DRAWER_WIDTH.initial)
    expect(rememberedDrawerWidth('wide')).toBe(DRAWER_WIDTH.initial)
    expect(rememberedDrawerWidth('500')).toBe(500)
    expect(rememberedDrawerWidth('9999')).toBe(DRAWER_WIDTH.max)
  })
})
