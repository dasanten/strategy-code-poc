import {
  TICKS_PER_GAME_HOUR,
  computeTerritory,
  type Territory,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'

/**
 * Keeps the world's territory (`CONTEXT.md`: Territory), recomputed once a game hour. It is
 * derived from the world, never saved: after a restart it is worked out again on the first tick.
 * Territory is shown only, so being up to a game hour old matters to no rule.
 */
export class TerritoryTracker {
  current: Territory | null = null

  /** Recomputes the territory when a game hour has passed since the last time; true if it did. */
  update(world: WorldState, terrain: TerrainMap): boolean {
    if (this.current && world.tick - this.current.tick < TICKS_PER_GAME_HOUR) return false
    this.current = computeTerritory(world, terrain.size)
    return true
  }
}
