import {
  MAX_HEALTH,
  MAX_HUNGER,
  NODE_TERRAINS,
  Terrain,
  isInsideWalls,
  isWallTile,
  STAT_NAMES,
  terrainAt,
  trainedCap,
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

/** Nothing stands on impassable terrain or outside the disc. */
export const nothingOnImpassableTerrain: Invariant = {
  name: 'nothing-on-impassable-terrain',
  check(world, terrain) {
    const things = [...world.residents, ...world.horses, ...world.carriages, ...world.buildings]
    return things
      .filter((t) => !isWalkable(terrain, t.x, t.y))
      .map((t) => ({
        invariant: this.name,
        message: `${t.id} stands on impassable terrain at (${t.x}, ${t.y})`,
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

export const worldInvariants: Invariant[] = [
  nothingOnImpassableTerrain,
  trainedWithinCap,
  healthAndHungerInRange,
  realmsHaveLeaders,
  buildingsInPlace,
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
