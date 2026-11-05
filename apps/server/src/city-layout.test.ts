import {
  CITY_GRID_BLOCK,
  CITY_LAYOUTS,
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
  terrainAt,
  tileIndex,
  wallMap,
  wrap,
  type Building,
  type BuildingKind,
  type City,
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
    const terrain = plains(200)
    const world = createWorld(terrain)
    const city = foundNpcCity(world, terrain, kind, 20, 20, mulberry32(7))
    const home = npcHome(world, city)!
    const houses = world.buildings.filter((b) => b.kind === 'house' && b.cityId === city.id)
    expect(houses).toHaveLength(kind.houses)
    for (const h of houses) expectFollows(world, city, home, 'house', h, terrain.size)
    // The whole ring, so it knows its wall as rings (`wallRings`) and builds by it.
    const walls = world.buildings.filter((b) => b.kind === 'wall' || b.kind === 'gate')
    expect(walls.filter((b) => b.cityId === city.id)).toHaveLength(walls.length)
    expect(wallRings(world, city, home, terrain.size)?.inner).toBe(Math.floor(kind.size / 2))
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('puts houses, storages, workshops and stables in spots of its blocks', () => {
    const { world, terrain, city, home } = village()
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
    const { world, terrain, city, home } = village()
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
    const { world, terrain, city, home } = village()
    const size = terrain.size
    const plan = planOf(world, city, home, size)
    for (let dy = -WALL - NPC_WALL_STEP; dy <= WALL + NPC_WALL_STEP; dy++) {
      expect(plan.street(home.x, home.y + dy)).toBe(true)
    }
  })

  it('leaves a lane through a gate wherever it stands', () => {
    const { world, terrain, city, home } = village()
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
    const { world, terrain, city, home } = village()
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

  it('grows out through a new wall, and nobody is walled in', () => {
    const { world, terrain, city, home } = village()
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
    const { world, terrain, city, home } = village()
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

/** The Grid's plan for a city with no layout yet. */
function planOfGrid(world: WorldState, city: City, home: Building, size: number) {
  const rings = wallRings(world, city, home, size)
  return layoutPlan(world, { ...city, layout: 'grid' }, home, rings?.newGate, size)!
}
