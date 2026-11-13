import { describe, expect, it } from 'vitest'
import { TICKS_PER_GAME_DAY } from '@csp/balance'
import type { Building } from '@csp/shared-types'
import { centreBeside, tileToScreen } from './map/camera.js'
import {
  DIPLOMACY_TABS,
  DRAWERS,
  DRAWER_WIDTH,
  NO_DRAWER,
  MIN_OPEN_MAP,
  drawerWidth,
  goodsLabel,
  goodsOldText,
  goodsPickCities,
  goodsPickOf,
  RAIL_GROUPS,
  railGroups,
  rememberGoodsPick,
  rememberedDrawerWidth,
  rememberedGoodsPick,
  isWide,
  keyGoods,
  openDiplomacy,
  showsTab,
  withOpen,
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
      'Diplomacy',
      'Cities',
      'Scripts',
      'Realm log',
    ])
      expect(labels).toContain(tool)
    expect(new Set(DRAWERS.map((d) => d.id)).size).toBe(DRAWERS.length)
  })

  it('puts every drawer in exactly one group, in rail order', () => {
    const groups = railGroups()
    expect(groups.map((g) => g.id)).toEqual(RAIL_GROUPS.map((g) => g.id))
    expect(groups.flatMap((g) => g.drawers.map((d) => d.id))).toEqual(DRAWERS.map((d) => d.id))
    expect(Object.fromEntries(groups.map((g) => [g.label, g.drawers.map((d) => d.label)]))).toEqual(
      {
        People: ['Residents', 'Horses', 'Armies'],
        Diplomacy: ['Diplomacy'],
        Realm: ['Cities', 'Waypoints', 'Scripts', 'Realm log'],
      },
    )
  })

  it('has one Diplomacy drawer, with a tab each for its five parts', () => {
    expect(DRAWERS.filter((d) => d.group === 'diplomacy').map((d) => d.id)).toEqual(['diplomacy'])
    expect(DIPLOMACY_TABS.map((t) => t.label)).toEqual([
      'Contracts',
      'Demands',
      'Direct offers',
      'Alliance',
      'Standing',
    ])
  })

  it('starts the Diplomacy drawer on its first tab', () => {
    expect(withOpen(NO_DRAWER, 'diplomacy')).toEqual({ open: 'diplomacy', tab: 'contracts' })
  })

  it("lands a notice's Open on its tab, whatever was open before", () => {
    const demands = openDiplomacy('demands')
    expect(demands).toEqual({ open: 'diplomacy', tab: 'demands' })
    expect(showsTab(demands, 'demands')).toBe(true)
    expect(showsTab(demands, 'directOffers')).toBe(false)
    const offers = openDiplomacy('directOffers')
    expect(showsTab(offers, 'directOffers')).toBe(true)
    expect(showsTab(offers, 'demands')).toBe(false)
  })

  it('remembers the Diplomacy tab while the drawer is closed or another is open', () => {
    let drawers = openDiplomacy('standing')
    drawers = withOpen(drawers, undefined)
    expect(showsTab(drawers, 'standing')).toBe(false)
    drawers = withOpen(drawers, toggleDrawer(drawers.open, 'residents'))
    drawers = withOpen(drawers, toggleDrawer(drawers.open, 'diplomacy'))
    expect(drawers).toEqual({ open: 'diplomacy', tab: 'standing' })
    expect(showsTab(drawers, 'standing')).toBe(true)
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

  it('centres a resident picked in the drawer in the map left free beside the drawer and card', () => {
    // The Residents drawer covers 428 px on the left, the card 372 px on the right, of 1280.
    const view = { width: 1280, height: 800 }
    const cover = showBeside(view.width, 428, 372)
    expect(cover.closeDrawer).toBe(false)
    const cam = centreBeside(2806, 3427, cover, 24, 5760)
    // The resident's tile shows in the middle of 428..908, not of the whole screen.
    const [sx, sy] = tileToScreen(cam, view, 5760, 2806.5, 3427.5)
    expect(sx).toBeCloseTo(668, 6)
    expect(sy).toBe(400)
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
    expect(keyGoods({ buildings, lastSeen: [], cities }, 'r1', null).totals).toEqual({
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
    expect(keyGoods({ buildings, lastSeen: [], cities }, 'r1', 'home').totals).toEqual({
      food: 15,
      wood: 0,
      stone: 0,
      coins: 1,
    })
    expect(keyGoods({ buildings, lastSeen: [], cities }, 'r1', 'second').totals.food).toBe(7)
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
    expect(keyGoods({ buildings, lastSeen: [], cities }, 'r1', null).totals).toEqual(nothing)
    const fromHome = { buildings: buildings.slice(3), lastSeen: [], cities }
    expect(keyGoods(fromHome, 'r1', 'home').totals).toEqual(nothing)
  })

  describe('storages out of sight', () => {
    const seen = (seenAt: number, b: Partial<Building>) => ({ ...building(b), seenAt })
    const inSight = [building({ stock: { food: 10 } })]

    it('counts an outpost storage out of sight as last seen, and marks the total', () => {
      const lastSeen = [seen(100, { cityId: null, realmId: 'r1', stock: { food: 5, wood: 2 } })]
      const held = keyGoods({ buildings: inSight, lastSeen, cities }, 'r1', null)
      expect(held.totals).toEqual({ food: 15, wood: 2, stone: 0, coins: 0 })
      expect(held.old).toEqual({ oldestSeenAt: 100, all: false })
    })

    it('is exact and unmarked with everything in sight', () => {
      const held = keyGoods({ buildings: inSight, lastSeen: [], cities }, 'r1', null)
      expect(held.totals.food).toBe(10)
      expect(held.old).toBeNull()
      expect(goodsOldText(held.old, 500)).toBeNull()
    })

    it('shows a picked city out of sight as last seen, marked, all of it', () => {
      const lastSeen = [seen(100, { cityId: 'second', stock: { food: 7 } })]
      const held = keyGoods({ buildings: inSight, lastSeen, cities }, 'r1', 'second')
      expect(held.totals.food).toBe(7)
      expect(held.old).toEqual({ oldestSeenAt: 100, all: true })
    })

    it('leaves the other cities out of a picked one, and does not mark it for them', () => {
      const lastSeen = [seen(100, { cityId: 'second', stock: { food: 7 } })]
      const held = keyGoods({ buildings: inSight, lastSeen, cities }, 'r1', 'home')
      expect(held.totals.food).toBe(10)
      expect(held.old).toBeNull()
    })

    it("doesn't count a storage no longer the realm's", () => {
      // Its city has since been seen to be someone else's; the outpost was someone else's when seen.
      const taken = [city('home', 'r1'), city('second', 'r2')]
      const lastSeen = [
        seen(100, { cityId: 'second', stock: { food: 7 } }),
        seen(100, { cityId: null, realmId: 'r2', stock: { food: 9 } }),
      ]
      const held = keyGoods({ buildings: inSight, lastSeen, cities: taken }, 'r1', null)
      expect(held.totals.food).toBe(10)
      expect(held.old).toBeNull()
    })

    it("doesn't count a site or a stable out of sight", () => {
      const site = { delivered: {}, work: 0 } as Building['site']
      const lastSeen = [
        seen(100, { site, stock: { wood: 9 } }),
        seen(100, { kind: 'stable', stock: { food: 9 } }),
      ]
      const held = keyGoods({ buildings: inSight, lastSeen, cities }, 'r1', null)
      expect(held.totals).toEqual({ food: 10, wood: 0, stone: 0, coins: 0 })
      expect(held.old).toBeNull()
    })

    it('counts a storage in sight once, as it is now, not also as remembered', () => {
      const now = building({ stock: { food: 10 } })
      const lastSeen = [{ ...now, seenAt: 100, stock: { food: 3 } }]
      const held = keyGoods({ buildings: [now], lastSeen, cities }, 'r1', null)
      expect(held.totals.food).toBe(10)
      expect(held.old).toBeNull()
    })

    it('marks a storage last seen with nothing in it', () => {
      const held = keyGoods({ buildings: inSight, lastSeen: [seen(100, {})], cities }, 'r1', null)
      expect(held.totals.food).toBe(10)
      expect(held.old).toEqual({ oldestSeenAt: 100, all: false })
    })

    it('says how old it is by the oldest, in words', () => {
      const lastSeen = [
        seen(TICKS_PER_GAME_DAY, { stock: { food: 1 } }),
        seen(TICKS_PER_GAME_DAY * 3, { stock: { food: 1 } }),
      ]
      const { old } = keyGoods({ buildings: inSight, lastSeen, cities }, 'r1', null)
      const text = goodsOldText(old, TICKS_PER_GAME_DAY * 4)
      expect(text).toBe('Part of this is as last seen, the oldest 3 days ago')
      const alone = keyGoods({ buildings: [], lastSeen, cities }, 'r1', null)
      expect(goodsOldText(alone.old, TICKS_PER_GAME_DAY * 4)).toBe(
        'All of this is as last seen, the oldest 3 days ago',
      )
      expect(goodsLabel(null, cities, text)).toBe(
        'Goods in the entire realm. Part of this is as last seen, the oldest 3 days ago',
      )
    })
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
