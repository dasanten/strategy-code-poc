import {
  MAX_HEALTH,
  MAX_HUNGER,
  NODE_TERRAINS,
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
    return world.residents
      .filter((r) => !isWalkable(terrain, r.x, r.y))
      .map((r) => ({
        invariant: this.name,
        message: `resident ${r.id} stands on impassable terrain at (${r.x}, ${r.y})`,
        entityIds: [r.id],
      }))
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
