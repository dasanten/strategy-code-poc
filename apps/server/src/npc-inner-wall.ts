import {
  BUILD_MATERIALS,
  NPC_BIG_CITY_RESIDENTS,
  NPC_INNER_WALL_REACH,
  NPC_VILLAGE,
  NPC_WALL_TILES_PER_TRIP,
  cityResidents,
  footprintTiles,
  isPassableTerrain,
  middleOf,
  npcCityStock,
  npcReserve,
  terrainAt,
  tileIndex,
  townHallOf,
  wrap,
  wrapDelta,
  type Building,
  type City,
  type Good,
  type Stock,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { CIRCLE_REACH, layoutPlan, type LayoutPlan } from './city-layout.js'
import type { Invariant, InvariantViolation } from './invariants.js'
import { shortGoods } from './npc-chain.js'
import { Ground } from './placing.js'

/*
 * A big NPC city's inner ring of wall (`CONTEXT.md`: Bigger projects; ADR 0029): round its town hall
 * and storage, with a gate its own pass through, from materials above its reserve. Its outer wall
 * goes on growing as before: `wallRings` only ever reads the outer one (`outerWalls`).
 */

/**
 * Where an NPC city's outer wall stands at its nearest, tiles from its home along the farther
 * direction: a village's. What stands nearer is its inner ring.
 */
const OUTER_WALL_NEAREST = Math.floor(NPC_VILLAGE.size / 2)

/** A tile relative to some middle: how far along the farther direction. */
const ringOf = (dx: number, dy: number) => Math.max(Math.abs(dx), Math.abs(dy))

/** How far a tile is from a city's home along the farther direction. */
const fromHome = (home: { x: number; y: number }, x: number, y: number, size: number) =>
  ringOf(wrapDelta(home.x, x, size), wrapDelta(home.y, y, size))

/**
 * The walls of a city's outer wall among `walls`, for `wallRings`: those at the distance an outer
 * wall stands, the inner ring left out. A city with none there (a Player's walls, in a city that
 * became self-managed) has only what it has.
 */
export function outerWalls<T extends { x: number; y: number }>(
  walls: T[],
  home: { x: number; y: number },
  size: number,
): T[] {
  const outer = walls.filter((b) => fromHome(home, b.x, b.y, size) >= OUTER_WALL_NEAREST)
  return outer.length > 0 ? outer : walls
}

/** A tile of the inner ring: what goes there, and whether it is finished or begun. */
export interface InnerWallTile {
  kind: 'wall' | 'gate'
  x: number
  y: number
  done: boolean
  site?: Building
}

/** A shape the ring can take, relative to the middle of the town hall. */
interface Shape {
  inside(dx: number, dy: number): boolean
  tiles: [dx: number, dy: number][]
}

/** A square with `d` tiles from its middle to each side, the wall on the outermost tiles. */
function square(d: number): Shape {
  const tiles: [number, number][] = []
  for (let dy = -d; dy <= d; dy++) {
    for (let dx = -d; dx <= d; dx++) if (ringOf(dx, dy) === d) tiles.push([dx, dy])
  }
  return { inside: (dx, dy) => ringOf(dx, dy) < d, tiles }
}

/** A circle of radius `r`, its tiles joining side to side as a circular lane's do (`CIRCLE_REACH`). */
function circle(r: number): Shape {
  const tiles: [number, number][] = []
  for (let dy = -r - 1; dy <= r + 1; dy++) {
    for (let dx = -r - 1; dx <= r + 1; dx++) {
      if (Math.abs(Math.hypot(dx, dy) - r) <= CIRCLE_REACH) tiles.push([dx, dy])
    }
  }
  return { inside: (dx, dy) => Math.hypot(dx, dy) < r - CIRCLE_REACH, tiles }
}

/** The shapes the ring can take, the smallest first. */
function shapes(): Shape[] {
  const out: Shape[] = []
  for (let d = 2; d <= NPC_INNER_WALL_REACH; d++) out.push(square(d), circle(d))
  return out
}

/** What a shape would cost a city, or undefined when it can't stand there. */
interface Fit {
  shape: Shape
  /** Tiles of it that are wall or gate already: a ring begun stays where it is. */
  begun: number
  /** Tiles of it something stands on, or that take no wall: gaps in it. */
  gaps: number
  /** Tiles of it its layout doesn't keep free for a street: ground its next buildings could want. */
  offStreet: number
}

/**
 * How a shape fits a city with the middle of its town hall at `anchor`: it has to hold the town hall
 * and the storage (`home`) and stay nearer the home than its outer wall.
 */
function fit(
  shape: Shape,
  anchor: { x: number; y: number },
  held: [number, number][],
  home: Building,
  walls: Map<number, Building>,
  ground: Ground,
  plan: LayoutPlan | undefined,
): Fit | undefined {
  const size = ground.terrain.size
  const holdsAll = held.every(([x, y]) =>
    shape.inside(wrapDelta(anchor.x, x, size), wrapDelta(anchor.y, y, size)),
  )
  if (!holdsAll) return undefined
  let begun = 0
  let gaps = 0
  let offStreet = 0
  for (const [dx, dy] of shape.tiles) {
    const x = wrap(anchor.x + dx, size)
    const y = wrap(anchor.y + dy, size)
    if (fromHome(home, x, y, size) >= OUTER_WALL_NEAREST) return undefined
    if (walls.has(tileIndex(size, x, y))) begun++
    else if (!ground.fits('wall', x, y)) gaps++
    else if (plan && !plan.street(x, y)) offStreet++
  }
  return { shape, begun, gaps, offStreet }
}

/**
 * The tiles of the city's inner ring, the walls on round from its gate and the gate last, so the way
 * in stays open while it goes up. Each is finished, begun, or free for it; tiles that can take none
 * (something stands there, Mountain) are left out, and the ring has a gap there, as any wall of an NPC
 * city has. It takes the shape round the town hall that leaves fewest gaps, on the tiles its layout
 * keeps for streets where it can (`CONTEXT.md`: City layout): in a Grid along the lanes round the
 * town hall, in Rings on the first lane. Its gate stands as near the outer gate as it can, in line
 * with it, so the street through the one goes on through the other. None for a city with no town
 * hall, or where no shape fits.
 */
export function innerWall(
  world: WorldState,
  city: City,
  home: Building,
  terrain: TerrainMap,
  outerGate: Building,
  newGate: { dx: number; dy: number },
): InnerWallTile[] {
  const size = terrain.size
  const hall = townHallOf(world, city)
  if (!hall) return []
  const anchor = middleOf(hall, size)
  const walls = new Map<number, Building>()
  for (const b of world.buildings) {
    if (b.kind !== 'wall' && b.kind !== 'gate') continue
    if (fromHome(home, b.x, b.y, size) < OUTER_WALL_NEAREST) walls.set(tileIndex(size, b.x, b.y), b)
  }
  const ground = new Ground(world, terrain)
  const plan = layoutPlan(world, city, home, newGate, size)
  const held = [...footprintTiles(hall, size), ...footprintTiles(home, size)]
  let best: Fit | undefined
  for (const shape of shapes()) {
    const f = fit(shape, anchor, held, home, walls, ground, plan)
    if (!f) continue
    if (
      !best ||
      f.begun > best.begun ||
      (f.begun === best.begun &&
        (f.gaps < best.gaps ||
          (f.gaps === best.gaps &&
            (f.offStreet < best.offStreet ||
              (f.offStreet === best.offStreet && f.shape.tiles.length < best.shape.tiles.length)))))
    ) {
      best = f
    }
  }
  if (!best) return []
  const tiles = best.shape.tiles.flatMap(([dx, dy]) => {
    const x = wrap(anchor.x + dx, size)
    const y = wrap(anchor.y + dy, size)
    const here = walls.get(tileIndex(size, x, y))
    if (!here && !ground.fits('wall', x, y)) return []
    return [{ x, y, dx, dy, here }]
  })
  const toGate = (t: { x: number; y: number }) =>
    Math.hypot(wrapDelta(outerGate.x, t.x, size), wrapDelta(outerGate.y, t.y, size))
  const gate =
    tiles.find((t) => t.here?.kind === 'gate') ??
    tiles.filter((t) => !t.here).sort((a, b) => toGate(a) - toGate(b))[0]
  const out = tiles.map((t) => {
    const turn = gate
      ? Math.atan2(t.dy, t.dx) - Math.atan2(gate.dy, gate.dx)
      : Math.atan2(t.dy, t.dx)
    return {
      kind: (t === gate ? 'gate' : 'wall') as 'wall' | 'gate',
      x: t.x,
      y: t.y,
      done: !!t.here && !t.here.site,
      ...(t.here?.site ? { site: t.here } : {}),
      order: t === gate ? Infinity : (turn + 4 * Math.PI) % (2 * Math.PI),
    }
  })
  return out.sort((a, b) => a.order - b.order).map(({ order: _order, ...t }) => t)
}

/** Whether a city's stock holds all of `goods` above its reserve. */
function holdsAboveReserve(world: WorldState, city: City, goods: Stock): boolean {
  const stock = npcCityStock(world, city)
  const reserve = npcReserve(world, city)
  return (Object.entries(goods) as [Good, number][]).every(
    ([good, n]) => (stock[good] ?? 0) - (reserve[good] ?? 0) >= n,
  )
}

/**
 * The next tile of a big NPC city's inner ring to build (`CONTEXT.md`: Bigger projects), if it is
 * time for one: its outer wall has its gate and isn't moving out, nothing is short of its reserve, and
 * it holds above that reserve what `builders` take on a trip for walls (`NPC_WALL_TILES_PER_TRIP`).
 * While it doesn't, the ring waits as it stands, a begun tile too.
 */
export function innerWallProject(
  world: WorldState,
  city: City,
  home: Building,
  terrain: TerrainMap,
  rings: {
    expanding: boolean
    gate: Building | undefined
    newGate: { dx: number; dy: number }
  },
  builders: number,
): { kind: 'build'; building: 'wall' | 'gate'; x: number; y: number } | undefined {
  if (city.tradeOrg || rings.expanding || !rings.gate) return undefined
  if (cityResidents(world, city).length < NPC_BIG_CITY_RESIDENTS) return undefined
  if (shortGoods(world, city).length > 0) return undefined
  const tiles = innerWall(world, city, home, terrain, rings.gate, rings.newGate)
  const next = tiles.find((t) => t.site) ?? tiles.find((t) => !t.done)
  if (!next) return undefined
  const trips = NPC_WALL_TILES_PER_TRIP * builders
  const goods: Stock = {}
  for (const [good, n] of Object.entries(BUILD_MATERIALS[next.kind] ?? {}) as [Good, number][]) {
    goods[good] = n * trips
  }
  if (!holdsAboveReserve(world, city, goods)) return undefined
  return { kind: 'build', building: next.kind, x: next.x, y: next.y }
}

/** How far from its home someone stands who has come out past the farthest an inner ring can stand. */
const PAST_THE_RING = OUTER_WALL_NEAREST - 1

/**
 * An inner ring never cuts an NPC city's people off from its storage (`CONTEXT.md`: Bigger projects;
 * ADR 0004): from the storage there is a way past it on foot, through its gate or a gap. Its gate goes
 * up last for that, so a ring with no way through has lost it some other way.
 */
export const innerWallLeavesAWay: Invariant = {
  name: 'inner-wall-leaves-a-way',
  check(world, terrain) {
    const out: InvariantViolation[] = []
    const size = terrain.size
    for (const city of world.cities) {
      if (city.realmId !== null || city.tradeOrg) continue
      const home = world.buildings.find(
        (b) => b.cityId === city.id && b.kind === 'storage' && !b.site,
      )
      if (!home) continue
      const walls = world.buildings.filter(
        (b) =>
          b.cityId === city.id &&
          (b.kind === 'wall' || b.kind === 'gate') &&
          !b.site &&
          fromHome(home, b.x, b.y, size) < OUTER_WALL_NEAREST,
      )
      if (walls.length === 0) continue
      const blocked = new Set(
        walls.filter((b) => b.kind === 'wall').map((b) => tileIndex(size, b.x, b.y)),
      )
      if (!wayPast(home, blocked, terrain)) {
        out.push({
          invariant: this.name,
          message: `${city.id}'s inner ring has no way through it to its storage`,
          entityIds: [city.id, home.id],
        })
      }
    }
    return out
  },
}

/** Whether someone at `home` can walk past the walls in `blocked`, out to `PAST_THE_RING`. */
function wayPast(home: Building, blocked: Set<number>, terrain: TerrainMap): boolean {
  const size = terrain.size
  const start = tileIndex(size, home.x, home.y)
  const seen = new Set([start])
  const todo = [{ x: home.x, y: home.y }]
  while (todo.length > 0) {
    const { x, y } = todo.pop()!
    if (fromHome(home, x, y, size) >= PAST_THE_RING) return true
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ] as [number, number][]) {
      const tx = wrap(nx, size)
      const ty = wrap(ny, size)
      const t = tileIndex(size, tx, ty)
      if (seen.has(t) || blocked.has(t) || !isPassableTerrain(terrainAt(terrain, tx, ty))) continue
      seen.add(t)
      todo.push({ x: tx, y: ty })
    }
  }
  return false
}
