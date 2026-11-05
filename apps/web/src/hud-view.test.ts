import { describe, expect, it } from 'vitest'
import type { Building } from '@csp/shared'
import {
  DRAWERS,
  DRAWER_WIDTH,
  MIN_OPEN_MAP,
  drawerWidth,
  goodsLabel,
  goodsPickCities,
  goodsPickOf,
  rememberGoodsPick,
  rememberedDrawerWidth,
  rememberedGoodsPick,
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
      'Waypoints',
      'Armies',
      'Contracts',
      'Demands',
      'Direct offers',
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

describe('goods in the top bar', () => {
  const building = (b: Partial<Building>): Building => ({
    id: Math.random().toString(36),
    kind: 'storage',
    cityId: 'home',
    x: 0,
    y: 0,
    ...b,
  })
  const city = (id: string, realmId: string | null, name = id) => ({ id, name, realmId })
  const cities = [city('home', 'r1'), city('second', 'r1'), city('theirs', 'r2'), city('npc', null)]

  it('adds up every storage of the realm for the entire realm, outpost storages included', () => {
    const buildings = [
      building({ stock: { food: 10, wood: 4, iron: 3 } }),
      building({ kind: 'warehouse', stock: { food: 5, coins: 20 } }),
      building({ cityId: 'second', stock: { stone: 2, food: 1 } }),
      building({ cityId: null, realmId: 'r1', stock: { food: 100 } }),
    ]
    expect(keyGoods({ buildings, cities }, 'r1', null)).toEqual({
      food: 116,
      wood: 4,
      stone: 2,
      coins: 20,
    })
  })

  it('adds up only the picked city, without the outpost storages', () => {
    const buildings = [
      building({ stock: { food: 10, coins: 1 } }),
      building({ kind: 'warehouse', stock: { food: 5 } }),
      building({ cityId: 'second', stock: { food: 7 } }),
      building({ cityId: null, realmId: 'r1', stock: { food: 100 } }),
    ]
    expect(keyGoods({ buildings, cities }, 'r1', 'home')).toEqual({
      food: 15,
      wood: 0,
      stone: 0,
      coins: 1,
    })
    expect(keyGoods({ buildings, cities }, 'r1', 'second').food).toBe(7)
  })

  it("leaves out others' storages, construction sites and stables' horse food", () => {
    const site = { delivered: {}, work: 0 } as Building['site']
    const buildings = [
      building({ cityId: 'theirs', stock: { food: 9 } }),
      building({ cityId: 'npc', stock: { food: 9 } }),
      building({ cityId: null, realmId: 'r2', stock: { food: 9 } }),
      building({ site, stock: { wood: 9 } }),
      building({ cityId: null, realmId: 'r1', site, stock: { wood: 9 } }),
      building({ kind: 'stable', stock: { food: 9 } }),
    ]
    const nothing = { food: 0, wood: 0, stone: 0, coins: 0 }
    expect(keyGoods({ buildings, cities }, 'r1', null)).toEqual(nothing)
    expect(keyGoods({ buildings: buildings.slice(3), cities }, 'r1', 'home')).toEqual(nothing)
  })

  it('offers the cities of the realm the Player knows, by name', () => {
    const known = [city('b', 'r1', 'Zeltdorf'), city('a', 'r1', 'Aue'), city('c', 'r2', 'Mitte')]
    expect(goodsPickCities(known, 'r1').map((c) => c.name)).toEqual(['Aue', 'Zeltdorf'])
  })

  it('keeps a city of the realm picked', () => {
    expect(goodsPickOf('second', goodsPickCities(cities, 'r1'))).toBe('second')
  })

  it("goes back to the entire realm for a remembered city no longer the realm's", () => {
    const lost = [city('home', 'r1'), city('second', 'r2')]
    expect(goodsPickOf('second', goodsPickCities(lost, 'r1'))).toBeNull()
    expect(goodsPickOf('gone', goodsPickCities(lost, 'r1'))).toBeNull()
    expect(goodsPickOf(null, goodsPickCities(lost, 'r1'))).toBeNull()
  })

  it('says what is shown', () => {
    expect(goodsLabel(null, cities)).toBe('Goods in the entire realm')
    expect(goodsLabel('second', cities)).toBe('Goods in second')
  })

  it('remembers the pick per browser, and shows the entire realm without one', () => {
    const kept = new Map<string, string>()
    const storage = () => ({
      getItem: (k: string) => kept.get(k) ?? null,
      setItem: (k: string, v: string) => void kept.set(k, v),
      removeItem: (k: string) => void kept.delete(k),
    })
    expect(rememberedGoodsPick(storage)).toBeNull()
    rememberGoodsPick('second', storage)
    expect(rememberedGoodsPick(storage)).toBe('second')
    rememberGoodsPick(null, storage)
    expect(rememberedGoodsPick(storage)).toBeNull()
  })

  it('shows the entire realm when the browser lets nothing be kept', () => {
    const off = () => {
      throw new Error('storage is off')
    }
    expect(rememberedGoodsPick(off)).toBeNull()
    expect(() => rememberGoodsPick('second', off)).not.toThrow()
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
