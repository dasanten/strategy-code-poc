import {
  BUILD_MATERIALS,
  NPC_RESIDENTS_PER_NEEDS_STEP,
  NPC_WALL_STEP,
  NPC_WALL_TILES_PER_TRIP,
  TICKS_PER_GAME_DAY,
  footprintTiles,
  isBigNpcCity,
  isAt,
  middleOf,
  npcCityStock,
  npcReserve,
  townHallOf,
  wrapDelta,
  type Building,
  type CityLayout,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { layoutPlan, streetsOwed } from './city-layout.js'
import { checkInvariants } from './invariants.js'
import { bigCity, unhurriedWalking } from './npc-big-city.fixture.js'
import { village } from './npc-growth.fixture.js'
import { newWall, nextProject, npcBuilders, wallRings } from './npc-growth.js'
import { innerWall, innerWallLeavesAWay, innerWallProject } from './npc-inner-wall.js'
import { newId } from './starting-city.js'
import { Walking } from './walking.js'
import { stepWorld } from './world.js'

type Staged = ReturnType<typeof bigCity>

/**
 * The big city with nothing left to want but its inner ring: it has its stable, and the Wood above
 * its reserve for the whole ring.
 */
function ready(layout: CityLayout): Staged {
  const staged = bigCity(layout)
  const { world, city, home } = staged
  world.buildings.push({
    id: newId(world, 'b'),
    kind: 'stable',
    cityId: city.id,
    x: home.x + 30,
    y: home.y + 30,
  })
  home.stock!.wood = (npcReserve(world, city).wood ?? 0) + 500
  return staged
}

const ringsOf = ({ world, terrain, city, home }: Staged) => wallRings(world, city, home, terrain.size)!

function ringOf({ world, terrain, city, home }: Staged) {
  const rings = wallRings(world, city, home, terrain.size)!
  return innerWall(world, city, home, terrain, rings.gate!, rings.newGate)
}

/** Puts up the ring as it stands in the plan. */
function finishRing(staged: Staged): Building[] {
  const { world, city } = staged
  const built = ringOf(staged).map(
    (t): Building => ({ id: newId(world, 'b'), kind: t.kind, cityId: city.id, x: t.x, y: t.y }),
  )
  world.buildings.push(...built)
  return built
}

/** The tiles someone starting at (x, y) reaches on foot within a box round it, not through `shut`. */
function flood(
  from: { x: number; y: number },
  shut: { x: number; y: number }[],
  reach: number,
): Set<string> {
  const blocked = new Set(shut.map((t) => `${t.x},${t.y}`))
  const seen = new Set([`${from.x},${from.y}`])
  const todo = [from]
  while (todo.length > 0) {
    const { x, y } = todo.pop()!
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ] as [number, number][]) {
      const k = `${nx},${ny}`
      if (seen.has(k) || blocked.has(k)) continue
      if (Math.abs(nx - from.x) > reach || Math.abs(ny - from.y) > reach) continue
      seen.add(k)
      todo.push({ x: nx, y: ny })
    }
  }
  return seen
}

/** Whether the tiles close round the town hall and storage, with no way out past them. */
function closesRoundHallAndStorage(staged: Staged, tiles: { x: number; y: number }[]): boolean {
  const { world, terrain, city, home } = staged
  const hall = townHallOf(world, city)!
  const reach = 12
  const inside = flood(middleOf(hall, terrain.size), tiles, reach)
  const held = [...footprintTiles(hall, terrain.size), ...footprintTiles(home, terrain.size)]
  if (!held.every(([x, y]) => inside.has(`${x},${y}`))) return false
  const mid = middleOf(hall, terrain.size)
  return [...inside].every((k) => {
    const [x, y] = k.split(',').map(Number) as [number, number]
    return Math.abs(x - mid.x) < reach && Math.abs(y - mid.y) < reach
  })
}

const LAYOUTS: CityLayout[] = ['grid', 'rings', 'mainStreet', 'quarters']

describe("a big NPC city's inner ring", () => {
  it.each(['grid', 'rings'] as const)(
    'has room in a full %s city: closed round its town hall and storage, on its streets',
    (layout) => {
      const staged = ready(layout)
      const { world, terrain, city, home } = staged
      const tiles = ringOf(staged)
      expect(tiles.length).toBeGreaterThan(0)
      expect(closesRoundHallAndStorage(staged, tiles)).toBe(true)
      const plan = layoutPlan(world, city, home, ringsOf(staged).newGate, terrain.size)!
      for (const t of tiles) expect(plan.street(t.x, t.y)).toBe(true)
    },
  )

  it.each(LAYOUTS)('holds its town hall and storage in a %s city, with one gate, built last', (l) => {
    const staged = ready(l)
    const tiles = ringOf(staged)
    expect(tiles.filter((t) => t.kind === 'gate')).toHaveLength(1)
    expect(tiles.at(-1)!.kind).toBe('gate')
    // Whatever gaps it has, nothing it plans stands on the town hall or the storage.
    const { world, terrain, city, home } = staged
    const hall = townHallOf(world, city)!
    const held = new Set(
      [...footprintTiles(hall, terrain.size), ...footprintTiles(home, terrain.size)].map(String),
    )
    for (const t of tiles) expect(held.has(`${t.x},${t.y}`)).toBe(false)
  })

  it.each(['grid', 'rings'] as const)(
    'has its gate in line with the outer gate in a %s city, so no new street opens',
    (layout) => {
      const staged = ready(layout)
      const { world, terrain, city, home } = staged
      const rings = ringsOf(staged)
      const gate = ringOf(staged).at(-1)!
      expect(gate.x).toBe(rings.gate!.x)
      expect(gate.y).toBeLessThan(rings.gate!.y)
      const streets = (() => {
        const plan = layoutPlan(world, city, home, rings.newGate, terrain.size)!
        const out: boolean[] = []
        for (let dy = -30; dy <= 30; dy++) {
          for (let dx = -30; dx <= 30; dx++) out.push(plan.street(home.x + dx, home.y + dy))
        }
        return out
      })
      const before = streets()
      finishRing(staged)
      expect(streets()).toEqual(before)
    },
  )

  it.each(['grid', 'rings'] as const)(
    'leaves its streets to stop at it in a %s city: none owed on a tile of the ring',
    (layout) => {
      const staged = ready(layout)
      const { world, terrain, city, home } = staged
      const built = finishRing(staged)
      const owed = streetsOwed(world, city, home, ringsOf(staged).newGate, terrain)
      const tiles = new Set(built.map((b) => `${b.x},${b.y}`))
      for (const [x, y] of owed) expect(tiles.has(`${x},${y}`)).toBe(false)
    },
  )

  it('stays the shape it was begun, with the gate it was given', () => {
    const staged = ready('grid')
    const first = ringOf(staged)
    const { world, city } = staged
    const t = first[0]!
    world.buildings.push({ id: newId(world, 'b'), kind: 'wall', cityId: city.id, x: t.x, y: t.y })
    // Something new stands on the planned gate: it goes on the nearest free tile instead.
    const gate = first.at(-1)!
    world.buildings.push({
      id: newId(world, 'b'),
      kind: 'house',
      cityId: city.id,
      x: gate.x,
      y: gate.y,
    })
    const again = ringOf(staged)
    expect(again.filter((x) => x.kind === 'gate')).toHaveLength(1)
    expect(again.find((x) => x.kind === 'gate')).not.toMatchObject({ x: gate.x, y: gate.y })
    expect(new Set(again.map((x) => `${x.x},${x.y}`))).toContain(`${t.x},${t.y}`)
    // A house is two tiles along the ring here: they are the gap.
    expect(again.length).toBe(first.length - 2)
  })
})

describe('when a city builds its inner ring', () => {
  it('a big city takes it on once nothing else is wanted', () => {
    const staged = ready('grid')
    const { world, terrain, city, home } = staged
    const project = nextProject(world, city, home, terrain)
    expect(project).toMatchObject({ kind: 'build', building: 'wall' })
    const tiles = new Set(ringOf(staged).map((t) => `${t.x},${t.y}`))
    expect(project!.kind === 'build' && tiles.has(`${project.x},${project.y}`)).toBe(true)
  })

  it('nothing comes of it below the big city number', () => {
    const staged = ready('grid')
    const { world, city } = staged
    const rest = world.residents.filter((r) => r.cityId === city.id).slice(2 * NPC_RESIDENTS_PER_NEEDS_STEP - 1)
    const gone = new Set(rest)
    world.residents = world.residents.filter((r) => !gone.has(r))
    expect(isBigNpcCity(world, city)).toBe(false)
    const rings = ringsOf(staged)
    expect(innerWallProject(world, city, staged.home, staged.terrain, rings, 2)).toBeUndefined()
  })

  it('a village never does, with all the wood in the world', () => {
    const { world, terrain, city, home } = village()
    home.stock = { ...npcReserve(world, city), wood: 100_000, stone: 100_000 }
    const rings = wallRings(world, city, home, terrain.size)!
    expect(innerWallProject(world, city, home, terrain, rings, 2)).toBeUndefined()
    const project = nextProject(world, city, home, terrain)
    if (project?.kind === 'build') expect(['wall', 'gate']).not.toContain(project.building)
  })

  /** The Wood its builders take on a trip for walls. */
  const trip = (world: WorldState, city: Staged['city']) =>
    (BUILD_MATERIALS.wall?.wood ?? 0) * NPC_WALL_TILES_PER_TRIP * npcBuilders(world, city)

  it('takes on a tile only from materials above its reserve', () => {
    const staged = ready('grid')
    const { world, terrain, city, home } = staged
    const rings = ringsOf(staged)
    const reserve = npcReserve(world, city).wood ?? 0
    const builders = npcBuilders(world, city)
    home.stock!.wood = reserve + trip(world, city) - 1
    expect(innerWallProject(world, city, home, terrain, rings, builders)).toBeUndefined()
    home.stock!.wood = reserve + trip(world, city)
    expect(innerWallProject(world, city, home, terrain, rings, builders)).toBeDefined()
  })

  it('waits while anything is short', () => {
    const staged = ready('grid')
    const { world, terrain, city, home } = staged
    const rings = ringsOf(staged)
    home.stock!.coins = 0
    expect(npcReserve(world, city).coins).toBeGreaterThan(0)
    expect(innerWallProject(world, city, home, terrain, rings, 2)).toBeUndefined()
  })

  it('waits while its outer wall moves out', () => {
    const staged = ready('grid')
    const { world, terrain, city, home } = staged
    world.buildings.push({
      id: newId(world, 'b'),
      kind: 'house',
      cityId: city.id,
      x: home.x + 40,
      y: home.y,
    })
    const rings = ringsOf(staged)
    expect(rings.expanding).toBe(true)
    expect(innerWallProject(world, city, home, terrain, rings, 2)).toBeUndefined()
  })

  it('is done once every tile stands', () => {
    const staged = ready('rings')
    const { world, terrain, city, home } = staged
    finishRing(staged)
    expect(innerWallProject(world, city, home, terrain, ringsOf(staged), 2)).toBeUndefined()
  })

  it('a city with no outer gate has none to line up with, and builds none', () => {
    const staged = ready('grid')
    const { world, terrain, city, home } = staged
    world.buildings = world.buildings.filter((b) => !(b.kind === 'gate' && b.cityId === city.id))
    const rings = ringsOf(staged)
    expect(rings.gate).toBeUndefined()
    expect(innerWallProject(world, city, home, terrain, rings, 2)).toBeUndefined()
  })
})

describe('its outer wall with an inner ring standing', () => {
  const outer = Math.floor(45 / 2)

  it('is still read as the only ring', () => {
    const staged = ready('grid')
    const before = ringsOf(staged)
    finishRing(staged)
    expect(ringsOf(staged)).toEqual(before)
    expect(before).toMatchObject({ inner: outer, outer, expanding: false })
  })

  it('still grows: the new wall goes up, the old comes down, the ring stays', () => {
    const staged = ready('rings')
    const { world, terrain, city, home } = staged
    const ring = new Set(finishRing(staged).map((b) => b.id))
    // Houses out beyond the wall east and south, the farms leaving the new gate alone on its side,
    // so the new wall stays part of the city without the old one.
    for (const [dx, dy] of [
      [8, 0],
      [15, 0],
      [outer + 1, 0],
      [2, 8],
      [2, 15],
      [2, outer + 1],
    ] as [number, number][]) {
      world.buildings.push({
        id: newId(world, 'b'),
        kind: 'house',
        cityId: city.id,
        x: home.x + dx,
        y: home.y + dy,
      })
    }
    let rings = ringsOf(staged)
    expect(rings).toMatchObject({ inner: outer, outer: outer + NPC_WALL_STEP, expanding: true })
    const project = nextProject(world, city, home, terrain)
    expect(project?.kind === 'build' && Math.abs(wrapDelta(home.y, project.y, terrain.size))).toBe(
      outer + NPC_WALL_STEP,
    )
    for (const t of newWall(world, home, terrain, rings)) {
      world.buildings.push({
        id: newId(world, 'b'),
        kind: t.kind,
        cityId: city.id,
        x: t.x,
        y: t.y,
      })
    }
    rings = ringsOf(staged)
    expect(rings).toMatchObject({ inner: outer, outer: outer + NPC_WALL_STEP })
    for (let i = 0; i < 300; i++) {
      const next = nextProject(world, city, home, terrain)
      if (next?.kind !== 'tearDown') break
      expect(ring.has(next.buildingId)).toBe(false)
      world.buildings = world.buildings.filter((b) => b.id !== next.buildingId)
    }
    expect(world.buildings.filter((b) => ring.has(b.id))).toHaveLength(ring.size)
    expect(ringsOf(staged)).toMatchObject({ inner: outer + NPC_WALL_STEP, expanding: false })
  })
})

describe('getting to the storage through it', () => {
  /** Walks a resident on from where they stand until they are at the storage, or the time is up. */
  function walksHome(
    world: WorldState,
    terrain: TerrainMap,
    home: Building,
    from: { x: number; y: number },
  ): boolean {
    const r = world.residents[0]!
    Object.assign(r, { x: from.x, y: from.y, order: { kind: 'walkTo', target: { x: home.x, y: home.y } } })
    delete r.script
    const walking = new Walking(terrain)
    for (let t = 0; t < 400; t++) {
      stepWorld(world, terrain, walking)
      if (isAt(r, home, terrain.size)) return true
      if (r.order?.kind !== 'walkTo') {
        r.order = { kind: 'walkTo', target: { x: home.x, y: home.y } }
        delete r.script
      }
    }
    return false
  }

  it.each(['grid', 'rings'] as const)(
    'one of its people outside the ring on the far side reaches the storage in a %s village',
    (layout) => {
      const { world, terrain, city, home } = village(layout)
      const rings = wallRings(world, city, home, terrain.size)!
      const tiles = innerWall(world, city, home, terrain, rings.gate!, rings.newGate)
      expect(tiles.at(-1)!.kind).toBe('gate')
      for (const t of tiles) {
        world.buildings.push({
          id: newId(world, 'b'),
          kind: t.kind,
          cityId: city.id,
          x: t.x,
          y: t.y,
        })
      }
      expect(checkInvariants(world, terrain)).toEqual([])
      expect(walksHome(world, terrain, home, { x: home.x, y: home.y - 11 })).toBe(true)
      expect(checkInvariants(world, terrain)).toEqual([])
    },
  )
})

describe('the invariant', () => {
  it('catches a ring closed with no gate, and is happy with a gate or a gap', () => {
    const staged = ready('grid')
    const { world, terrain } = staged
    const built = finishRing(staged)
    expect(innerWallLeavesAWay.check(world, terrain)).toEqual([])
    const gate = built.find((b) => b.kind === 'gate')!
    gate.kind = 'wall'
    const found = innerWallLeavesAWay.check(world, terrain)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ invariant: 'inner-wall-leaves-a-way' })
    world.buildings = world.buildings.filter((b) => b !== gate)
    expect(innerWallLeavesAWay.check(world, terrain)).toEqual([])
  })
})

describe('a big city building it for real', () => {
  it.each(['grid', 'rings'] as const)(
    'finishes its ring in a %s city from what it has above its reserve, its gate last',
    { tags: ['slow'], timeout: 1_800_000 },
    (layout) => {
      const staged = ready(layout)
      const { world, terrain, city } = staged
      const walking = unhurriedWalking(terrain)
      const want = ringOf(staged).map((t) => `${t.x},${t.y}`)
      const standing = () =>
        world.buildings.filter(
          (b) => (b.kind === 'wall' || b.kind === 'gate') && !b.site && want.includes(`${b.x},${b.y}`),
        )
      const rings = ringsOf(staged)
      const wood = BUILD_MATERIALS.wall?.wood ?? 0
      for (let t = 0; t < 14 * TICKS_PER_GAME_DAY && standing().length < want.length; t++) {
        stepWorld(world, terrain, walking)
        // Its gate last: the way stays open.
        if (world.tick % 60 === 0 && standing().length < want.length - 1) {
          expect(standing().some((b) => b.kind === 'gate')).toBe(false)
        }
        // A tile is only ever taken on with Wood above the reserve, whatever else uses it.
        const plan = world.cityPlans[city.id]
        const p = plan?.project
        if (plan?.plannedAt === world.tick && p?.kind === 'build' && want.includes(`${p.x},${p.y}`)) {
          const above = (npcCityStock(world, city).wood ?? 0) - (npcReserve(world, city).wood ?? 0)
          expect(above).toBeGreaterThanOrEqual(-wood)
        }
        if (world.tick % TICKS_PER_GAME_DAY === 0) expect(checkInvariants(world, terrain)).toEqual([])
      }
      expect(standing()).toHaveLength(want.length)
      expect(standing().filter((b) => b.kind === 'gate')).toHaveLength(1)
      expect(ringsOf(staged)).toEqual({ ...rings, gate: expect.anything() })
    },
  )
})
