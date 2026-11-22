import { describe, expect, it } from 'vitest'
import { TICKS_PER_GAME_DAY } from '@csp/balance'
import type { Building } from '@csp/shared-types'
import { centreBeside, tileToScreen } from './map/camera.js'
import {
  DIPLOMACY_TABS,
  FOLDED,
  SIDEBAR_GROUPS,
  SIDE_TABS,
  SIDE_WIDTH,
  MIN_OPEN_MAP,
  foldOrUnfold,
  goodsLabel,
  goodsOldText,
  goodsPickCities,
  goodsPickOf,
  isScreen,
  keyGoods,
  openDiplomacy,
  rememberGoodsPick,
  rememberedGoodsPick,
  rememberedSideWidth,
  rememberedSidebar,
  showBeside,
  showsTab,
  sideWidth,
  sidebarGroups,
  sidebarToKeep,
  toggleTab,
  withOpen,
  type OpenTab,
} from './hud-view.js'

describe('the sidebar', () => {
  it('has a tab for every drawer the tool rail had, once each', () => {
    const labels = SIDE_TABS.map((t) => t.label)
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
    expect(new Set(SIDE_TABS.map((t) => t.id)).size).toBe(SIDE_TABS.length)
  })

  it('puts every tab in exactly one group, in the tool rail order', () => {
    const groups = sidebarGroups()
    expect(groups.map((g) => g.id)).toEqual(SIDEBAR_GROUPS.map((g) => g.id))
    expect(groups.flatMap((g) => g.tabs.map((t) => t.id))).toEqual(SIDE_TABS.map((t) => t.id))
    expect(Object.fromEntries(groups.map((g) => [g.label, g.tabs.map((t) => t.label)]))).toEqual({
      People: ['Residents', 'Horses', 'Armies'],
      Diplomacy: ['Diplomacy'],
      Realm: ['Cities', 'Waypoints', 'Scripts', 'Realm log'],
    })
  })

  it('has one Diplomacy tab, with a tab of its own for each of its five parts', () => {
    expect(SIDE_TABS.filter((t) => t.group === 'diplomacy').map((t) => t.id)).toEqual(['diplomacy'])
    expect(DIPLOMACY_TABS.map((t) => t.label)).toEqual([
      'Contracts',
      'Demands',
      'Direct offers',
      'Alliance',
      'Standing',
    ])
  })

  it('starts folded, and the Diplomacy tab on its first tab', () => {
    expect(FOLDED.open).toBeUndefined()
    expect(withOpen(FOLDED, 'diplomacy')).toMatchObject({ open: 'diplomacy', tab: 'contracts' })
  })

  it("lands a notice's Open on its tab, whatever was open before", () => {
    const demands = openDiplomacy(withOpen(FOLDED, 'cities'), 'demands')
    expect(demands).toMatchObject({ open: 'diplomacy', tab: 'demands' })
    expect(showsTab(demands, 'demands')).toBe(true)
    expect(showsTab(demands, 'directOffers')).toBe(false)
    const offers = openDiplomacy(FOLDED, 'directOffers')
    expect(showsTab(offers, 'directOffers')).toBe(true)
    expect(showsTab(offers, 'demands')).toBe(false)
  })

  it('remembers the Diplomacy tab while folded or another tab is open', () => {
    let sidebar = openDiplomacy(FOLDED, 'standing')
    sidebar = withOpen(sidebar, undefined)
    expect(showsTab(sidebar, 'standing')).toBe(false)
    sidebar = withOpen(sidebar, toggleTab(sidebar.open, 'residents'))
    sidebar = withOpen(sidebar, toggleTab(sidebar.open, 'diplomacy'))
    expect(sidebar).toMatchObject({ open: 'diplomacy', tab: 'standing' })
    expect(showsTab(sidebar, 'standing')).toBe(true)
  })

  it('opens the clicked tab while folded', () => {
    expect(toggleTab(undefined, 'armies')).toBe('armies')
  })

  it("folds when the open tab's button is clicked again", () => {
    expect(toggleTab('armies', 'armies')).toBeUndefined()
  })

  it('keeps one tab open at a time: another button swaps it', () => {
    let open: OpenTab = undefined
    open = toggleTab(open, 'residents')
    open = toggleTab(open, 'realmLog')
    expect(open).toBe('realmLog')
    open = toggleTab(open, 'residents')
    expect(open).toBe('residents')
  })

  it('folds to its strip with the fold button, and unfolds to the tab open last', () => {
    const open = withOpen(FOLDED, 'waypoints')
    const folded = foldOrUnfold(open)
    expect(folded.open).toBeUndefined()
    expect(foldOrUnfold(folded).open).toBe('waypoints')
    // Escape or the open tab's button fold it as well; it still unfolds to that tab.
    expect(foldOrUnfold(withOpen(withOpen(FOLDED, 'cities'), undefined)).open).toBe('cities')
    // Never opened: it unfolds to the first tab.
    expect(foldOrUnfold(FOLDED).open).toBe('residents')
  })

  it('opens a screen of its own only for Scripts, the script workshop', () => {
    expect(SIDE_TABS.filter((t) => isScreen(t.id)).map((t) => t.id)).toEqual(['scripts'])
  })

  it('goes back to the map when the workshop is left, never unfolding to it', () => {
    const before = withOpen(FOLDED, 'cities')
    const workshop = withOpen(before, 'scripts')
    expect(workshop).toMatchObject({ open: 'scripts', last: 'cities' })
    const left = withOpen(workshop, undefined)
    expect(left.open).toBeUndefined()
    expect(foldOrUnfold(left).open).toBe('cities')
    // A browser that kept the workshop as the tab to unfold to (before it was a screen).
    expect(rememberedSidebar(JSON.stringify({ open: null, last: 'scripts' })).last).toBe(
      'residents',
    )
  })

  describe('across a reload', () => {
    it('comes back open on the tab it was open on', () => {
      const kept = sidebarToKeep(withOpen(FOLDED, 'realmLog'))
      expect(rememberedSidebar(kept)).toMatchObject({ open: 'realmLog', last: 'realmLog' })
    })

    it('comes back folded, unfolding to the tab open last', () => {
      const kept = sidebarToKeep(withOpen(withOpen(FOLDED, 'horses'), undefined))
      const sidebar = rememberedSidebar(kept)
      expect(sidebar.open).toBeUndefined()
      expect(foldOrUnfold(sidebar).open).toBe('horses')
    })

    it('starts folded on a phone, where a tab covers the map', () => {
      const kept = sidebarToKeep(withOpen(FOLDED, 'cities'))
      expect(rememberedSidebar(kept, true)).toMatchObject({ open: undefined, last: 'cities' })
    })

    it('starts folded with nothing kept, or nonsense', () => {
      expect(rememberedSidebar(null)).toEqual(FOLDED)
      expect(rememberedSidebar('{')).toEqual(FOLDED)
      expect(rememberedSidebar('"residents"')).toEqual(FOLDED)
      expect(rememberedSidebar('{"open":"gone","last":"gone"}')).toEqual(FOLDED)
    })
  })

  it('centres a resident picked in the sidebar in the map left free beside it and the card', () => {
    // The Residents tab covers 428 px on the left, the card 372 px on the right, of 1280.
    const view = { width: 1280, height: 800 }
    const cover = showBeside(view.width, 428, 372)
    expect(cover.closeDrawer).toBe(false)
    const cam = centreBeside(2806, 3427, cover, 24, 5760)
    // The resident's tile shows in the middle of 428..908, not of the whole screen.
    const [sx, sy] = tileToScreen(cam, view, 5760, 2806.5, 3427.5)
    expect(sx).toBeCloseTo(668, 6)
    expect(sy).toBe(400)
  })

  it('shows a place between the open sidebar and the card', () => {
    expect(showBeside(1280, 0, 0)).toEqual({ left: 0, right: 0, closeDrawer: false })
    expect(showBeside(1280, 428, 0)).toEqual({ left: 428, right: 0, closeDrawer: false })
    expect(showBeside(1024, 428, 372)).toEqual({ left: 428, right: 372, closeDrawer: false })
    const room = 1024 - 428 - MIN_OPEN_MAP
    expect(showBeside(1024, 428, room)).toEqual({ left: 428, right: room, closeDrawer: false })
    // Folded, the strip alone covers the map's left edge.
    expect(showBeside(1280, 56, 372, 56)).toEqual({ left: 56, right: 372, closeDrawer: false })
  })

  it('folds a sidebar that leaves too little map, and uses the whole screen if need be', () => {
    // Sidebar and card leave 100 px: folded to the strip there is room beside the card.
    expect(showBeside(900, 428, 372)).toEqual({ left: 0, right: 372, closeDrawer: true })
    expect(showBeside(900, 428, 372, 56)).toEqual({ left: 56, right: 372, closeDrawer: true })
    // A phone: the tab covers the map, and the card nearly all of it.
    expect(showBeside(375, 375, 0)).toEqual({ left: 0, right: 0, closeDrawer: true })
    expect(showBeside(375, 375, 351)).toEqual({ left: 0, right: 0, closeDrawer: true })
    // Folded already and a card that leaves too little: the whole screen.
    expect(showBeside(375, 0, 351)).toEqual({ left: 0, right: 0, closeDrawer: false })
    expect(showBeside(500, 56, 351, 56)).toEqual({ left: 0, right: 0, closeDrawer: false })
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
      building({ cityId: null, realmId: 'r1', stock: { food: 100, coal: 6 } }),
    ]
    expect(keyGoods({ buildings, lastSeen: [], cities }, 'r1', null).totals).toEqual({
      food: 116,
      wood: 4,
      stone: 2,
      coal: 6,
      steel: 0,
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
      coal: 0,
      steel: 0,
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
    const nothing = { food: 0, wood: 0, stone: 0, coal: 0, steel: 0, coins: 0 }
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
      expect(held.totals).toEqual({ food: 15, wood: 2, stone: 0, coal: 0, steel: 0, coins: 0 })
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
      expect(held.totals).toEqual({ food: 10, wood: 0, stone: 0, coal: 0, steel: 0, coins: 0 })
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

describe('sidebar width', () => {
  it('keeps a dragged width within the limits', () => {
    expect(sideWidth(SIDE_WIDTH.min - 100)).toBe(SIDE_WIDTH.min)
    expect(sideWidth(SIDE_WIDTH.max + 100)).toBe(SIDE_WIDTH.max)
    expect(sideWidth(450.6)).toBe(451)
    expect(sideWidth(Number.NaN)).toBe(SIDE_WIDTH.initial)
  })

  it('starts at the initial width the limits allow', () => {
    expect(SIDE_WIDTH.initial).toBeGreaterThanOrEqual(SIDE_WIDTH.min)
    expect(SIDE_WIDTH.initial).toBeLessThanOrEqual(SIDE_WIDTH.max)
  })

  it('falls back to the initial width without a remembered one', () => {
    expect(rememberedSideWidth(null)).toBe(SIDE_WIDTH.initial)
    expect(rememberedSideWidth('wide')).toBe(SIDE_WIDTH.initial)
    expect(rememberedSideWidth('500')).toBe(500)
    expect(rememberedSideWidth('9999')).toBe(SIDE_WIDTH.max)
  })
})
