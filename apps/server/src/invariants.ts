import type { TerrainMap, WorldState } from '@csp/shared'
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
    return world.units
      .filter((u) => !isWalkable(terrain, u.x, u.y))
      .map((u) => ({
        invariant: this.name,
        message: `unit ${u.id} stands on impassable terrain at (${u.x}, ${u.y})`,
        entityIds: [u.id],
      }))
  },
}

export const oneUnitPerTile: Invariant = {
  name: 'one-unit-per-tile',
  check(world) {
    const byTile = new Map<string, string[]>()
    for (const u of world.units) {
      const key = `${u.x},${u.y}`
      byTile.set(key, [...(byTile.get(key) ?? []), u.id])
    }
    return [...byTile]
      .filter(([, ids]) => ids.length > 1)
      .map(([tile, ids]) => ({
        invariant: this.name,
        message: `units ${ids.join(', ')} share tile (${tile})`,
        entityIds: ids,
      }))
  },
}

export const worldInvariants: Invariant[] = [nothingOnImpassableTerrain, oneUnitPerTile]

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
