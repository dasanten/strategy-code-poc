import {
  CITY_GRID_BLOCK,
  CITY_LAYOUTS,
  CITY_RING_STEP,
  FOOTPRINT,
  NPC_TOWN,
  NPC_VILLAGE,
  NPC_WALL_STEP,
  Terrain,
  buildingAt,
  buildProblem,
  footprintTiles,
  isPassableTerrain,
  mayStep,
  middleOf,
  terrainAt,
  tileIndex,
  townHallOf,
  wallMap,
  wrap,
  type Building,
  type BuildingKind,
  type City,
  type CityLayout,
  type NpcCitySize,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { joinRealm } from './capture.js'
import { foundCity } from './cities.js'
import { cityLayoutsSound, layoutPlan, pickLayout } from './city-layout.js'
import { checkInvariants } from './invariants.js'
import { npcHome } from './npc-behaviour.js'
import { foundNpcCity } from './npc-cities.js'
import { fillHouses, plains, storageOf, village, WALL } from './npc-growth.fixture.js'
import { houseTile, newWall, nextProject, wallRings } from './npc-growth.js'
import { mulberry32 } from './residents.js'
import { foundStartingCity, newId } from './starting-city.js'
import { endRealm } from './survival.js'
import { foundTradingPost } from './trading-posts.js'
import { migrateWorld, migrations } from './world-format.js'
import { createWorld } from './world.js'

/** What the city's layout says now, for a city with a plan for its wall. */
function planOf(world: WorldState, city: City, home: Building, size: number) {
  const rings = wallRings(world, city, home, size)
  return layoutPlan(world, city, home, rings?.newGate, size)!
}

/** Expects a building of `kind` at (x, y) to follow the city's layout. */
function expectFollows(
  world: WorldState,
  city: City,
  home: Building,
  kind: BuildingKind,
  t: { x: number; y: number },
  size: number,
) {
  const plan = planOf(world, city, home, size)
  expect(plan.spot(kind, t.x, t.y)).toBe(true)
  for (const [x, y] of footprintTiles({ kind, ...t }, size)) expect(plan.street(x, y)).toBe(false)
}

/** Puts up a building where it stands, finished, as the city's. */
function put(world: WorldState, city: City, kind: BuildingKind, x: number, y: number): Building {
  const b: Building = { id: newId(world, 'b'), kind, cityId: city.id, x, y }
  world.buildings.push(b)
  return b
}

/**
 * Whether someone of the city can walk from `from` to a tile beyond its walls, eight ways as
 * residents step, through its gate.
 */
function canWalkOut(
  world: WorldState,
  terrain: TerrainMap,
  city: City,
  from: { x: number; y: number },
  out: number,
  home: Building,
): boolean {
  const size = terrain.size
  const walls = wallMap(world, terrain)
  const seen = new Set([tileIndex(size, from.x, from.y)])
  const todo = [from]
  while (todo.length > 0) {
    const t = todo.pop()!
    if (Math.max(Math.abs(t.x - home.x), Math.abs(t.y - home.y)) > out) return true
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as [number, number][]) {
      const x = wrap(t.x + dx, size)
      const y = wrap(t.y + dy, size)
      const i = tileIndex(size, x, y)
      if (seen.has(i) || !isPassableTerrain(terrainAt(terrain, x, y))) continue
      if (!mayStep(walls, city.id, tileIndex(size, t.x, t.y), i, false)) continue
      seen.add(i)
      todo.push({ x, y })
    }
  }
  return false
}

/** A new city of `kind` that picked `layout`, which goes by the world's seed. */
function newCity(layout: CityLayout, kind: NpcCitySize) {
  for (let seed = 1; ; seed++) {
    const terrain = plains(200)
    const world = createWorld(terrain, seed)
    const city = foundNpcCity(world, terrain, kind, 20, 20, mulberry32(7))
    if (city.layout === layout) return { world, terrain, city, home: npcHome(world, city)! }
  }
}

/** Expects a new city's houses to follow its layout, and its whole wall to be part of it. */
function expectSoundNewCity(
  { world, terrain, city, home }: ReturnType<typeof newCity>,
  kind: NpcCitySize,
) {
  const houses = world.buildings.filter((b) => b.kind === 'house' && b.cityId === city.id)
  expect(houses).toHaveLength(kind.houses)
  for (const h of houses) expectFollows(world, city, home, 'house', h, terrain.size)
  // The whole ring, so it knows its wall as rings (`wallRings`) and builds by it.
  const walls = world.buildings.filter((b) => b.kind === 'wall' || b.kind === 'gate')
  expect(walls.filter((b) => b.cityId === city.id)).toHaveLength(walls.length)
  expect(wallRings(world, city, home, terrain.size)?.inner).toBe(Math.floor(kind.size / 2))
  expect(checkInvariants(world, terrain)).toEqual([])
}

describe('picking a city layout', () => {
  it('a seed gives a stable pick, one of the layouts', () => {
    for (const id of ['city1', 'city2', 'city99']) {
      expect(pickLayout(7, id)).toBe(pickLayout(7, id))
      expect(CITY_LAYOUTS).toContain(pickLayout(7, id))
    }
  })

  it('an NPC city gets one when it comes to be, a trading post none', () => {
    const terrain = plains(400)
    const world = createWorld(terrain)
    const city = foundNpcCity(world, terrain, NPC_VILLAGE, 20, 20, mulberry32(7))
    expect(city.layout).toBe(pickLayout(world.seed, city.id))
    const post = foundTradingPost(world, terrain, 200, 200, undefined, mulberry32(8))
    expect(post.tradeOrg).toBe('post')
    expect(post.layout).toBeUndefined()
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('a daughter gets one when its town hall founds it, a Player’s city none', () => {
    const terrain = plains(200)
    const world = createWorld(terrain)
    const hall = (x: number): Building => ({
      id: newId(world, 'b'),
      kind: 'townHall',
      cityId: null,
      x,
      y: 20,
    })
    expect(foundCity(world, hall(20), null).layout).toBeDefined()
    expect(foundCity(world, hall(40), 'r1').layout).toBeUndefined()
  })

  it('a self-managed city gets one when its Leader dies, and loses it when it joins a realm', () => {
    const terrain = plains(400)
    const world = createWorld(terrain)
    const realm = foundStartingCity(world, terrain, 1)
    const city = world.cities.find((c) => c.realmId === realm.id)!
    expect(city.layout).toBeUndefined()
    endRealm(world, realm, terrain.size)
    expect(city.layout).toBe(pickLayout(world.seed, city.id))
    expect(cityLayoutsSound.check(world, terrain)).toEqual([])
    const npc = foundNpcCity(world, terrain, NPC_VILLAGE, 200, 200, mulberry32(7))
    joinRealm(world, npc, realm.id, terrain.size)
    expect(npc.layout).toBeUndefined()
    expect(cityLayoutsSound.check(world, terrain)).toEqual([])
  })

  it('catches a layout on the wrong city, and an NPC city without one', () => {
    const { world, terrain, city } = village()
    delete city.layout
    expect(cityLayoutsSound.check(world, terrain)).toHaveLength(1)
    city.layout = 'grid'
    city.tradeOrg = 'post'
    expect(cityLayoutsSound.check(world, terrain)).toHaveLength(1)
  })
})

describe('the Grid layout', () => {
  it.each([
    ['village', NPC_VILLAGE],
    ['town', NPC_TOWN],
  ])('a new %s’s houses stand in its blocks, and its wall stays part of it', (_, kind) => {
    expectSoundNewCity(newCity('grid', kind), kind)
  })

  it('puts houses, storages, workshops and stables in spots of its blocks', () => {
    const { world, terrain, city, home } = village('grid')
    const size = terrain.size
    const rings = wallRings(world, city, home, size)
    for (const kind of ['house', 'storage', 'smelter', 'mint', 'smithy', 'stable'] as const) {
      const t = houseTile(world, city, home, terrain, rings, kind)!
      expect(t).toBeDefined()
      expectFollows(world, city, home, kind, t, size)
    }
  })

  it('every kind that goes by the layout fits a block whole', () => {
    for (const kind of ['house', 'storage', 'smelter', 'mint', 'smithy', 'stable'] as const) {
      expect(FOOTPRINT[kind]).toBeLessThanOrEqual(CITY_GRID_BLOCK)
    }
  })

  it('skips a spot that doesn’t fit', () => {
    const { world, terrain, city, home } = village('grid')
    const rings = wallRings(world, city, home, terrain.size)
    const first = houseTile(world, city, home, terrain, rings)!
    terrain.tiles[tileIndex(terrain.size, first.x, first.y)] = Terrain.Mountain
    const next = houseTile(world, city, home, terrain, rings)!
    expect(next).not.toEqual(first)
    expectFollows(world, city, home, 'house', next, terrain.size)
    // Something standing there goes the same way.
    terrain.tiles[tileIndex(terrain.size, first.x, first.y)] = Terrain.Plains
    put(world, city, 'wall', first.x + 1, first.y + 1)
    expect(houseTile(world, city, home, terrain, rings)).toEqual(next)
  })

  it('keeps the way out of its gate free', () => {
    const { world, terrain, city, home } = village('grid')
    const size = terrain.size
    const plan = planOf(world, city, home, size)
    for (let dy = -WALL - NPC_WALL_STEP; dy <= WALL + NPC_WALL_STEP; dy++) {
      expect(plan.street(home.x, home.y + dy)).toBe(true)
    }
  })

  it('leaves a lane through a gate wherever it stands', () => {
    const { world, terrain, city, home } = village('grid')
    const size = terrain.size
    const gate = world.buildings.find((b) => b.kind === 'gate' && b.cityId === city.id)!
    // A gate on the east side, as a Player may have built one: a row through it.
    Object.assign(gate, { x: home.x + WALL, y: home.y + 2 })
    world.buildings.find((b) => b.x === home.x + WALL && b.y === home.y + 2 && b !== gate)!.x =
      home.x
    const plan = planOf(world, city, home, size)
    for (let dx = -WALL + 1; dx <= WALL + NPC_WALL_STEP; dx++) {
      expect(plan.street(home.x + dx, home.y + 2)).toBe(true)
    }
  })

  it('a migrated city loses nothing and follows the layout around what stands', () => {
    const { world, terrain, city, home } = village('grid')
    delete city.layout
    // A house as a city put it before layouts, on what is now a street.
    const plan = planOfGrid(world, city, home, terrain.size)
    const lane = { x: home.x, y: home.y - 3 }
    expect(plan.street(lane.x, lane.y)).toBe(true)
    const old = put(world, city, 'house', lane.x, lane.y)
    const before = structuredClone(world.buildings)
    const migrated = migrateWorld(structuredClone(world), 92, { terrain }, migrations, 93)
    expect(migrated.buildings).toEqual(before)
    expect(migrated.residents).toEqual(world.residents)
    const moved = migrated.cities.find((c) => c.id === city.id)!
    expect(moved.layout).toBe(pickLayout(world.seed, city.id))
    expect(buildingAt(migrated, old.x, old.y)?.id).toBe(old.id)
    expect(checkInvariants(migrated, terrain)).toEqual([])
    const movedHome = npcHome(migrated, moved)!
    const rings = wallRings(migrated, moved, movedHome, terrain.size)
    const t = houseTile(migrated, moved, movedHome, terrain, rings)!
    expectFollows(migrated, moved, movedHome, 'house', t, terrain.size)
  })

  it('the migration leaves Players’ cities and the Trade Organization’s without one', () => {
    const terrain = plains(400)
    const world = createWorld(terrain)
    const realm = foundStartingCity(world, terrain, 1)
    const city = world.cities.find((c) => c.realmId === realm.id)!
    const post = foundTradingPost(world, terrain, 200, 200, undefined, mulberry32(8))
    const migrated = migrateWorld(structuredClone(world), 92, { terrain }, migrations, 93)
    expect(migrated.cities.find((c) => c.id === city.id)!.layout).toBeUndefined()
    expect(migrated.cities.find((c) => c.id === post.id)!.layout).toBeUndefined()
  })
})

describe.each(CITY_LAYOUTS)('whichever layout: %s', (layout) => {
  it('a daughter with just its town hall finds room for its storage, then a house', () => {
    const terrain = plains(200)
    const world = createWorld(terrain)
    const hall: Building = {
      id: newId(world, 'b'),
      kind: 'townHall',
      cityId: null,
      x: 100,
      y: 100,
    }
    world.buildings.push(hall)
    const city = foundCity(world, hall, null)
    city.layout = layout
    const storage = houseTile(world, city, hall, terrain, undefined, 'storage')!
    expect(storage).toBeDefined()
    expectFollows(world, city, hall, 'storage', storage, terrain.size)
    put(world, city, 'storage', storage.x, storage.y)
    const home = npcHome(world, city)!
    const house = houseTile(world, city, home, terrain, undefined)!
    expect(house).toBeDefined()
    expectFollows(world, city, home, 'house', house, terrain.size)
  })

  it('grows out through a new wall, and nobody is walled in', () => {
    const { world, terrain, city, home } = village(layout)
    const size = terrain.size
    let rings = wallRings(world, city, home, size)!
    expect(rings.inner).toBe(WALL)
    let house = 0
    let broke = false
    // House after house until it has broken out through its wall and filled the new one.
    for (; house < 400; house++) {
      rings = wallRings(world, city, home, size)!
      const t = houseTile(world, city, home, terrain, rings)
      if (!t) break
      expectFollows(world, city, home, 'house', t, size)
      expect(buildProblem(world, t.x, t.y, 'house', terrain)).toBeUndefined()
      const b = put(world, city, 'house', t.x, t.y)
      const ring = Math.max(Math.abs(b.x - home.x), Math.abs(b.y - home.y))
      broke ||= ring >= WALL
    }
    expect(broke).toBe(true)
    rings = wallRings(world, city, home, size)!
    expect(rings).toMatchObject({ inner: WALL, outer: WALL + NPC_WALL_STEP, expanding: true })
    // The new wall goes up, its gate in line with the old one and free.
    const tiles = newWall(world, home, terrain, rings)
    const gates = tiles.filter((t) => t.kind === 'gate')
    expect(gates).toEqual([
      expect.objectContaining({ x: home.x, y: home.y + WALL + NPC_WALL_STEP }),
    ])
    for (const t of tiles) put(world, city, t.kind, t.x, t.y)
    const inside = { x: home.x, y: home.y + 2 }
    expect(canWalkOut(world, terrain, city, inside, WALL + NPC_WALL_STEP, home)).toBe(true)
    // The old wall comes down: the city holds, and it goes on building inside the new wall.
    world.buildings = world.buildings.filter(
      (b) =>
        !(
          (b.kind === 'wall' || b.kind === 'gate') &&
          Math.max(Math.abs(b.x - home.x), Math.abs(b.y - home.y)) === WALL
        ),
    )
    rings = wallRings(world, city, home, size)!
    expect(rings.inner).toBe(WALL + NPC_WALL_STEP)
    expect(canWalkOut(world, terrain, city, inside, WALL + NPC_WALL_STEP, home)).toBe(true)
    const next = houseTile(world, city, home, terrain, rings)
    if (next) expectFollows(world, city, home, 'house', next, size)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('still has its project go to the edge with no room inside', () => {
    const { world, terrain, city, home } = village(layout)
    const size = terrain.size
    fillHouses(world, city, home)
    storageOf(world, city).stock = { food: 400, wood: 100 }
    // Rock on every spot inside the wall.
    const plan = planOf(world, city, home, size)
    for (let dy = -(WALL - 1); dy <= WALL - 1; dy++) {
      for (let dx = -(WALL - 1); dx <= WALL - 1; dx++) {
        const x = home.x + dx
        const y = home.y + dy
        if (plan.street(x, y) || buildingAt(world, x, y)) continue
        terrain.tiles[tileIndex(size, x, y)] = Terrain.Mountain
      }
    }
    const p = nextProject(world, city, home, terrain) as { x: number; y: number }
    expect(p).toMatchObject({ kind: 'build', building: 'house' })
    expectFollows(world, city, home, 'house', p, size)
    const ring = Math.max(Math.abs(p.x - home.x), Math.abs(p.y - home.y))
    expect(ring).toBeGreaterThan(WALL - 2)
    expect(ring).toBeLessThan(WALL + NPC_WALL_STEP)
  })
})

describe('the Rings layout', () => {
  const hallOf = (world: WorldState, city: City, size: number) =>
    middleOf(townHallOf(world, city)!, size)

  /** How far the middle of a footprint lies from the middle of the town hall. */
  const farOf = (
    hall: { x: number; y: number },
    kind: BuildingKind,
    t: { x: number; y: number },
  ) => {
    const middle = (FOOTPRINT[kind] - 1) / 2
    return Math.hypot(t.x + middle - hall.x, t.y + middle - hall.y)
  }

  /** Which circle that is: 1 between the first lane and the second. */
  const circleOf = (far: number) => Math.floor(far / CITY_RING_STEP)

  /** Puts up `n` more houses where the city says, and gives them back. */
  function build(
    world: WorldState,
    terrain: TerrainMap,
    city: City,
    home: Building,
    n: number,
  ): Building[] {
    const out: Building[] = []
    for (let i = 0; i < n; i++) {
      const rings = wallRings(world, city, home, terrain.size)
      const t = houseTile(world, city, home, terrain, rings)!
      expect(t).toBeDefined()
      expect(buildProblem(world, t.x, t.y, 'house', terrain)).toBeUndefined()
      expectFollows(world, city, home, 'house', t, terrain.size)
      out.push(put(world, city, 'house', t.x, t.y))
    }
    return out
  }

  /** The tiles reached from `from` along streets, side to side, within `reach` of it. */
  function alongStreets(
    plan: ReturnType<typeof planOf>,
    from: { x: number; y: number },
    reach: number,
  ): Set<string> {
    const seen = new Set([`${from.x},${from.y}`])
    const todo = [from]
    while (todo.length > 0) {
      const t = todo.pop()!
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as [number, number][]) {
        const n = { x: t.x + dx, y: t.y + dy }
        const k = `${n.x},${n.y}`
        if (seen.has(k) || !plan.street(n.x, n.y)) continue
        if (Math.max(Math.abs(n.x - from.x), Math.abs(n.y - from.y)) > reach) continue
        seen.add(k)
        todo.push(n)
      }
    }
    return seen
  }

  it.each([
    ['village', NPC_VILLAGE],
    ['town', NPC_TOWN],
  ])('a new %s’s houses stand on its circles, and its wall stays part of it', (_, kind) => {
    expectSoundNewCity(newCity('rings', kind), kind)
  })

  it('puts houses in circles round the town hall, with lanes free between them', () => {
    const { world, terrain, city, home } = village('rings')
    const hall = hallOf(world, city, terrain.size)
    const houses = build(world, terrain, city, home, 60)
    for (const h of houses) {
      const far = farOf(hall, 'house', h)
      // Its middle lies on the line halfway between two lanes, not just anywhere between them.
      const line = (circleOf(far) + 0.5) * CITY_RING_STEP
      expect(circleOf(far)).toBeGreaterThan(0)
      expect(Math.abs(far - line)).toBeLessThanOrEqual(Math.SQRT1_2)
      // No tile of it on a lane, counted without the plan.
      for (const [x, y] of footprintTiles(h, terrain.size)) {
        const d = Math.hypot(x - hall.x, y - hall.y)
        const off = Math.abs(d - Math.round(d / CITY_RING_STEP) * CITY_RING_STEP)
        expect(off).toBeGreaterThan(Math.SQRT1_2)
      }
    }
    expect(new Set(houses.map((h) => circleOf(farOf(hall, 'house', h)))).size).toBeGreaterThan(1)
  })

  it('goes all the way round: the first circle closes up', () => {
    const { world, terrain, city, home } = village('rings')
    const hall = hallOf(world, city, terrain.size)
    const houses = build(world, terrain, city, home, 60)
    const first = houses.filter((h) => circleOf(farOf(hall, 'house', h)) === 1)
    const side = (h: Building) =>
      Math.floor(((Math.atan2(h.y + 0.5 - hall.y, h.x + 0.5 - hall.x) + Math.PI) / Math.PI) * 4)
    expect(new Set(first.map(side)).size).toBe(8)
    // Nothing more fits on that circle: the rest of it is the way to the gate.
    const plan = planOf(world, city, home, terrain.size)
    const ground = (x: number, y: number) =>
      plan.spot('house', x, y) &&
      circleOf(farOf(hall, 'house', { x, y })) === 1 &&
      footprintTiles({ kind: 'house', x, y }, terrain.size).every(
        ([tx, ty]) => !plan.street(tx, ty) && !buildingAt(world, tx, ty),
      )
    const left: { x: number; y: number }[] = []
    for (let y = hall.y - 2 * CITY_RING_STEP; y <= hall.y + 2 * CITY_RING_STEP; y++) {
      for (let x = hall.x - 2 * CITY_RING_STEP; x <= hall.x + 2 * CITY_RING_STEP; x++) {
        if (ground(x, y)) left.push({ x, y })
      }
    }
    expect(left).toEqual([])
  })

  it.each(['house', 'storage', 'smelter', 'mint', 'smithy', 'stable'] as const)(
    'has room for a %s all the way round every circle',
    (kind) => {
      const { world, terrain, city, home } = village('rings')
      const size = terrain.size
      const hall = hallOf(world, city, size)
      const plan = planOf(world, city, home, size)
      const middle = (FOOTPRINT[kind] - 1) / 2
      const sides = new Map<number, Set<number>>()
      const reach = 4 * CITY_RING_STEP
      for (let y = hall.y - reach; y <= hall.y + reach; y++) {
        for (let x = hall.x - reach; x <= hall.x + reach; x++) {
          if (!plan.spot(kind, x, y)) continue
          const tiles = footprintTiles({ kind, x, y }, size)
          if (tiles.some(([tx, ty]) => plan.street(tx, ty))) continue
          const circle = circleOf(farOf(hall, kind, { x, y }))
          const angle = Math.atan2(y + middle - hall.y, x + middle - hall.x)
          if (!sides.has(circle)) sides.set(circle, new Set())
          sides.get(circle)!.add(Math.floor(((angle + Math.PI) / Math.PI) * 4) % 8)
        }
      }
      for (const circle of [1, 2, 3]) expect(sides.get(circle)?.size).toBe(8)
    },
  )

  it('puts houses, workshops and stables on its circles', () => {
    const { world, terrain, city, home } = village('rings')
    const size = terrain.size
    const hall = hallOf(world, city, size)
    const rings = wallRings(world, city, home, size)
    for (const kind of ['house', 'smelter', 'mint', 'smithy', 'stable'] as const) {
      const t = houseTile(world, city, home, terrain, rings, kind)!
      expect(t).toBeDefined()
      expectFollows(world, city, home, kind, t, size)
      expect(circleOf(farOf(hall, kind, t))).toBeGreaterThan(0)
    }
  })

  it('puts a storage inside the first lane while there is room, then on its circles', () => {
    const { world, terrain, city, home } = village('rings')
    const size = terrain.size
    const hall = hallOf(world, city, size)
    const placed: number[] = []
    for (let i = 0; i < 30; i++) {
      const rings = wallRings(world, city, home, size)
      const t = houseTile(world, city, home, terrain, rings, 'storage')!
      expect(t).toBeDefined()
      expectFollows(world, city, home, 'storage', t, size)
      placed.push(circleOf(farOf(hall, 'storage', t)))
      put(world, city, 'storage', t.x, t.y)
    }
    expect(placed[0]).toBe(0)
    expect(placed.some((circle) => circle > 0)).toBe(true)
  })

  it('a lake by the town hall leaves a daughter room for its storage on the other sides', () => {
    const terrain = plains(200)
    const world = createWorld(terrain)
    const hall: Building = {
      id: newId(world, 'b'),
      kind: 'townHall',
      cityId: null,
      x: 100,
      y: 100,
    }
    world.buildings.push(hall)
    const city = foundCity(world, hall, null)
    city.layout = 'rings'
    const middle = hallOf(world, city, terrain.size)
    // Water all along its north and its east.
    for (let y = middle.y - 8; y <= middle.y + 8; y++) {
      for (let x = middle.x - 8; x <= middle.x + 8; x++) {
        if (y < middle.y - 1 || x > middle.x + 1) {
          terrain.tiles[tileIndex(terrain.size, x, y)] = Terrain.Lake
        }
      }
    }
    const t = houseTile(world, city, hall, terrain, undefined, 'storage')!
    expect(t).toBeDefined()
    expect(buildProblem(world, t.x, t.y, 'storage', terrain)).toBeUndefined()
    expectFollows(world, city, hall, 'storage', t, terrain.size)
  })

  it('keeps a way free from its gate to the middle, and leaves the far side alone', () => {
    const { world, terrain, city, home } = village('rings')
    const size = terrain.size
    const hall = hallOf(world, city, size)
    const plan = planOf(world, city, home, size)
    const gate = world.buildings.find((b) => b.kind === 'gate' && b.cityId === city.id)!
    expect(gate.x).toBe(hall.x)
    expect(gate.y).toBeGreaterThan(hall.y)
    // On out past the gate too, to where the next one goes.
    for (let y = hall.y; y <= gate.y + NPC_WALL_STEP; y++) {
      expect(plan.street(gate.x, y)).toBe(true)
    }
    // Between the lanes on the far side of the town hall, a circle runs on unbroken.
    const line = 1.5 * CITY_RING_STEP
    expect(plan.street(hall.x, hall.y - Math.floor(line))).toBe(false)
    expect(plan.street(hall.x - Math.floor(line), hall.y)).toBe(false)
  })

  it('lays the way from a gate out of line with the middle straight in, then along to it', () => {
    const { world, terrain, city, home } = village('rings')
    const size = terrain.size
    const hall = hallOf(world, city, size)
    const gate = world.buildings.find((b) => b.kind === 'gate' && b.cityId === city.id)!
    // A gate on the east side, as a Player may have built one.
    const swap = world.buildings.find((b) => b.x === home.x + WALL && b.y === home.y + 2)!
    swap.x = gate.x
    swap.y = gate.y
    Object.assign(gate, { x: home.x + WALL, y: home.y + 2 })
    const plan = planOf(world, city, home, size)
    for (let x = hall.x; x <= gate.x + NPC_WALL_STEP; x++) {
      expect(plan.street(x, gate.y)).toBe(true)
    }
    const down = Math.sign(hall.y - gate.y)
    for (let y = gate.y; y !== hall.y; y += down) expect(plan.street(hall.x, y)).toBe(true)
    expect(alongStreets(plan, gate, 40).has(`${hall.x},${hall.y}`)).toBe(true)
  })

  it('joins every lane to its gate, side to side, so a road can run along them', () => {
    const { world, terrain, city, home } = village('rings')
    const size = terrain.size
    const hall = hallOf(world, city, size)
    const plan = planOf(world, city, home, size)
    const gate = world.buildings.find((b) => b.kind === 'gate' && b.cityId === city.id)!
    const reached = alongStreets(plan, gate, 60)
    for (let y = hall.y - 25; y <= hall.y + 25; y++) {
      for (let x = hall.x - 25; x <= hall.x + 25; x++) {
        if (plan.street(x, y)) expect(reached.has(`${x},${y}`)).toBe(true)
      }
    }
  })

  it('a lake leaves a gap in a circle, which goes on beyond it', () => {
    const { world, terrain, city, home } = village('rings')
    const size = terrain.size
    const hall = hallOf(world, city, size)
    // A pond on the first circle, north-east of the town hall.
    const pond = { x: hall.x + 6, y: hall.y - 5 }
    const water = (x: number, y: number) => Math.hypot(x - pond.x, y - pond.y) <= 2.5
    for (let y = pond.y - 3; y <= pond.y + 3; y++) {
      for (let x = pond.x - 3; x <= pond.x + 3; x++) {
        if (water(x, y)) terrain.tiles[tileIndex(size, x, y)] = Terrain.Lake
      }
    }
    const houses = build(world, terrain, city, home, 60)
    for (const h of houses) {
      for (const [x, y] of footprintTiles(h, size)) expect(water(x, y)).toBe(false)
    }
    // The circle stands on both sides of it, no nearer the town hall or further out for it.
    const first = houses.filter((h) => circleOf(farOf(hall, 'house', h)) === 1)
    const angle = (h: Building) => Math.atan2(h.y + 0.5 - pond.y, h.x + 0.5 - pond.x)
    expect(first.some((h) => h.x < pond.x && h.y < pond.y && angle(h) < 0)).toBe(true)
    expect(first.some((h) => h.x > pond.x && h.y > pond.y)).toBe(true)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('a lake over a whole circle sends it on to the next, and the lanes stay where they are', () => {
    const { world, terrain, city, home } = village('rings')
    const size = terrain.size
    const hall = hallOf(world, city, size)
    const before = planOf(world, city, home, size)
    const lanes: boolean[] = []
    for (let y = hall.y - 20; y <= hall.y + 20; y++) {
      for (let x = hall.x - 20; x <= hall.x + 20; x++) {
        lanes.push(before.street(x, y))
        const d = Math.hypot(x - hall.x, y - hall.y)
        if (d > CITY_RING_STEP && d < 2 * CITY_RING_STEP && !buildingAt(world, x, y)) {
          terrain.tiles[tileIndex(size, x, y)] = Terrain.Lake
        }
      }
    }
    const houses = build(world, terrain, city, home, 10)
    for (const h of houses) expect(circleOf(farOf(hall, 'house', h))).toBeGreaterThan(1)
    const after = planOf(world, city, home, size)
    let i = 0
    for (let y = hall.y - 20; y <= hall.y + 20; y++) {
      for (let x = hall.x - 20; x <= hall.x + 20; x++) {
        expect(after.street(x, y)).toBe(lanes[i++])
      }
    }
  })
})

/** The Grid's plan for a city with no layout yet. */
function planOfGrid(world: WorldState, city: City, home: Building, size: number) {
  const rings = wallRings(world, city, home, size)
  return layoutPlan(world, { ...city, layout: 'grid' }, home, rings?.newGate, size)!
}
