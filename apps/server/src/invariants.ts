import {
  LIFESPAN_MAX,
  LIFESPAN_MIN,
  MAX_HEALTH,
  ageInYears,
  MAX_HUNGER,
  NODE_TERRAINS,
  Terrain,
  isInsideWalls,
  isWallTile,
  STAT_NAMES,
  terrainAt,
  carryCapacity,
  stockWeight,
  trainedCap,
  type Stock,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { isWalkable } from './world.js'

/**
 * A rule the simulation must always keep (ADR 0004). A broken invariant does not crash
 * anything, so it is reported as an error instead.
 */
export interface Invariant {
  name: string
  check(world: WorldState, terrain: TerrainMap): InvariantViolation[]
}

export interface InvariantViolation {
  invariant: string
  message: string
  /** The entities involved, so the report points at them. */
  entityIds: string[]
}

/** Nothing stands on impassable terrain. */
export const nothingOnImpassableTerrain: Invariant = {
  name: 'nothing-on-impassable-terrain',
  check(world, terrain) {
    const things = [
      ...world.residents,
      ...world.horses,
      ...world.carriages,
      ...world.buildings,
      ...world.piles,
    ]
    return things
      .filter((t) => !isWalkable(terrain, t.x, t.y))
      .map((t) => ({
        invariant: this.name,
        message: `${t.id} stands on impassable terrain at (${t.x}, ${t.y})`,
        entityIds: [t.id],
      }))
  },
}

/**
 * Every position is stored as a tile on the map (0 ≤ x, y < size). Coordinates past a side
 * would still find terrain, as the sides join, but two names for one tile hide clashes.
 */
export const positionsOnMap: Invariant = {
  name: 'positions-on-map',
  check(world, terrain) {
    const on = (v: number) => Number.isInteger(v) && v >= 0 && v < terrain.size
    const things = [
      ...world.residents,
      ...world.horses,
      ...world.carriages,
      ...world.buildings,
      ...world.nodes,
      ...world.cities,
      ...world.piles,
    ]
    return things
      .filter((t) => !on(t.x) || !on(t.y))
      .map((t) => ({
        invariant: this.name,
        message: `${t.id} is at (${t.x}, ${t.y}), off the map's tiles`,
        entityIds: [t.id],
      }))
  },
}

/** Every realm has a Player and a living Leader who belongs to it; one realm per Player. */
export const realmsHaveLeaders: Invariant = {
  name: 'realms-have-leaders',
  check(world) {
    const seen = new Set<number>()
    return world.realms.flatMap((realm) => {
      const leader = world.residents.find((r) => r.id === realm.leaderId)
      const problems: string[] = []
      if (!leader || leader.owner !== realm.id) problems.push(`has no Leader ${realm.leaderId}`)
      if (seen.has(realm.userId)) problems.push(`is a second realm of Player ${realm.userId}`)
      seen.add(realm.userId)
      return problems.map((p) => ({
        invariant: this.name,
        message: `realm ${realm.id} ${p}`,
        entityIds: [realm.id],
      }))
    })
  },
}

/**
 * Buildings: one per tile and never on a wall; houses and storages inside their city's walls,
 * farms on Plains; every city's wall on passable terrain; no stock below zero.
 */
export const buildingsInPlace: Invariant = {
  name: 'buildings-in-place',
  check(world, terrain) {
    const out: InvariantViolation[] = []
    const fail = (id: string, message: string) =>
      out.push({ invariant: this.name, message: `${id} ${message}`, entityIds: [id] })
    const cities = new Map(world.cities.map((c) => [c.id, c]))
    const tiles = new Set<string>()
    for (const b of world.buildings) {
      const key = `${b.x},${b.y}`
      if (tiles.has(key)) fail(b.id, `shares tile (${key}) with another building`)
      tiles.add(key)
      const city = cities.get(b.cityId)
      if (!city) fail(b.id, `belongs to no city (${b.cityId})`)
      else if (world.cities.some((c) => isWallTile(c, b.x, b.y))) fail(b.id, 'stands on a wall')
      else if (b.kind !== 'farm' && !isInsideWalls(city, b.x, b.y))
        fail(b.id, 'is outside the walls')
      if (b.kind === 'farm' && terrainAt(terrain, b.x, b.y) !== Terrain.Plains) {
        fail(b.id, 'is a farm off Plains')
      }
      if (Object.values(b.stock ?? {}).some((kg) => kg < 0)) fail(b.id, 'has negative stock')
    }
    for (const c of world.cities) {
      for (let i = 0; i < c.size; i++) {
        for (const [x, y] of [
          [c.x + i, c.y],
          [c.x + i, c.y + c.size - 1],
          [c.x, c.y + i],
          [c.x + c.size - 1, c.y + i],
        ] as const) {
          if (!isWalkable(terrain, x, y))
            fail(c.id, `has wall on impassable terrain at (${x}, ${y})`)
        }
      }
      if (!isWallTile(c, c.gate.x, c.gate.y)) fail(c.id, 'has its gate off the wall')
    }
    for (const k of world.carriages) {
      if (Object.values(k.load).some((kg) => kg < 0)) fail(k.id, 'has a negative load')
    }
    for (const h of world.horses) {
      if (!(h.hunger >= 0 && h.hunger <= MAX_HUNGER)) fail(h.id, `has hunger ${h.hunger}`)
    }
    return out
  },
}

/** Every stat has a positive base and a trained bonus between 0 and its cap. */
export const trainedWithinCap: Invariant = {
  name: 'trained-within-cap',
  check(world) {
    return world.residents.flatMap((r) =>
      STAT_NAMES.filter((s) => {
        const { base, trained } = r.stats[s]
        return !(base > 0 && trained >= 0 && trained <= trainedCap(base))
      }).map((s) => ({
        invariant: this.name,
        message: `resident ${r.id} has ${s} ${r.stats[s].base} + ${r.stats[s].trained} trained (cap ${trainedCap(r.stats[s].base)})`,
        entityIds: [r.id],
      })),
    )
  },
}

/** Health and the hunger meter stay within their ranges. */
export const healthAndHungerInRange: Invariant = {
  name: 'health-and-hunger-in-range',
  check(world) {
    return world.residents
      .filter(
        (r) =>
          !(r.health >= 0 && r.health <= MAX_HEALTH && r.hunger >= 0 && r.hunger <= MAX_HUNGER),
      )
      .map((r) => ({
        invariant: this.name,
        message: `resident ${r.id} has health ${r.health} and hunger ${r.hunger}`,
        entityIds: [r.id],
      }))
  },
}

/**
 * Every resident has a lifespan in range and has not outlived it (`CONTEXT.md`: Aging), and
 * nobody is born after the current tick.
 */
export const agesInRange: Invariant = {
  name: 'ages-in-range',
  check(world) {
    return world.residents.flatMap((r) => {
      const age = ageInYears(r, world.tick)
      const problems: string[] = []
      if (!(r.lifespan >= LIFESPAN_MIN && r.lifespan <= LIFESPAN_MAX))
        problems.push(`has lifespan ${r.lifespan}`)
      if (age >= r.lifespan) problems.push(`is ${age} years old, past their lifespan ${r.lifespan}`)
      if (!(age >= 0)) problems.push(`is born after the current tick (${r.bornAt})`)
      return problems.map((p) => ({
        invariant: this.name,
        message: `resident ${r.id} ${p}`,
        entityIds: [r.id],
      }))
    })
  },
}

/** Every resource node lies on terrain that fits its kind. */
export const nodesOnFittingTerrain: Invariant = {
  name: 'nodes-on-fitting-terrain',
  check(world, terrain) {
    return world.nodes
      .filter((n) => !(NODE_TERRAINS[n.kind] as number[]).includes(terrainAt(terrain, n.x, n.y)))
      .map((n) => ({
        invariant: this.name,
        message: `${n.kind} node ${n.id} lies on unfitting terrain at (${n.x}, ${n.y})`,
        entityIds: [n.id],
      }))
  },
}

/** Nobody carries more than their carry capacity (`CONTEXT.md`: Carry capacity). */
export const carriedWithinCapacity: Invariant = {
  name: 'carried-within-capacity',
  check(world) {
    return world.residents
      .filter((r) => stockWeight(r.carried) > carryCapacity(r, world.tick) + 1e-9)
      .map((r) => ({
        invariant: this.name,
        message: `resident ${r.id} carries ${stockWeight(r.carried)} kg of ${carryCapacity(r, world.tick)} kg`,
        entityIds: [r.id],
      }))
  },
}

/**
 * Goods are never negative wherever they are, only storages among buildings hold any, and a pile
 * is never empty; one pile per tile.
 */
export const goodsInPlace: Invariant = {
  name: 'goods-in-place',
  check(world) {
    const out: InvariantViolation[] = []
    const fail = (id: string, message: string) =>
      out.push({ invariant: this.name, message: `${id} ${message}`, entityIds: [id] })
    const negative = (stock: Stock) => Object.values(stock).some((n) => !(n >= 0))
    for (const r of world.residents) if (negative(r.carried)) fail(r.id, 'carries negative goods')
    for (const b of world.buildings) {
      const holds = Object.values(b.stock ?? {}).some((n) => n > 0)
      if (holds && b.kind !== 'storage') fail(b.id, `is a ${b.kind} holding goods`)
    }
    const tiles = new Set<string>()
    for (const p of world.piles) {
      if (negative(p.goods)) fail(p.id, 'holds negative goods')
      if (!Object.values(p.goods).some((n) => n > 0)) fail(p.id, 'is an empty pile')
      const key = `${p.x},${p.y}`
      if (tiles.has(key)) fail(p.id, `is a second pile on tile (${key})`)
      tiles.add(key)
    }
    return out
  },
}

/**
 * Goods are counted in whole units wherever they are (`Good`); spoilage and eating never leave
 * part of a unit behind.
 */
export const goodsInWholeUnits: Invariant = {
  name: 'goods-in-whole-units',
  check(world) {
    const holders: [string, Stock | undefined][] = [
      ...world.residents.map((r): [string, Stock] => [r.id, r.carried]),
      ...world.buildings.map((b): [string, Stock | undefined] => [b.id, b.stock]),
      ...world.carriages.map((k): [string, Stock] => [k.id, k.load]),
      ...world.piles.map((p): [string, Stock] => [p.id, p.goods]),
    ]
    return holders
      .filter(([, stock]) => Object.values(stock ?? {}).some((n) => !Number.isInteger(n)))
      .map(([id, stock]) => ({
        invariant: this.name,
        message: `${id} holds part of a unit: ${JSON.stringify(stock)}`,
        entityIds: [id],
      }))
  },
}

/**
 * Pick-up and drop orders are done within the tick they start (`resolveCarrying`), so after a
 * tick no resident still holds one.
 */
export const carryOrdersDone: Invariant = {
  name: 'carry-orders-done',
  check(world) {
    return world.residents
      .filter((r) => r.order?.kind === 'pickUp' || r.order?.kind === 'drop')
      .map((r) => ({
        invariant: this.name,
        message: `resident ${r.id} still holds a ${r.order!.kind} order after the tick`,
        entityIds: [r.id],
      }))
  },
}

export const worldInvariants: Invariant[] = [
  nothingOnImpassableTerrain,
  positionsOnMap,
  trainedWithinCap,
  healthAndHungerInRange,
  agesInRange,
  realmsHaveLeaders,
  buildingsInPlace,
  carriedWithinCapacity,
  goodsInPlace,
  goodsInWholeUnits,
  carryOrdersDone,
  nodesOnFittingTerrain,
]

export function checkInvariants(
  world: WorldState,
  terrain: TerrainMap,
  invariants: Invariant[] = worldInvariants,
): InvariantViolation[] {
  return invariants.flatMap((inv) => inv.check(world, terrain))
}

/** Whether this tick's invariants get checked, given the share of ticks to sample. */
export function shouldCheckInvariants(sampleRate: number, rand: () => number = Math.random) {
  return sampleRate >= 1 || rand() < sampleRate
}
