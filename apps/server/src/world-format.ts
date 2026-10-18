import { MAX_HEALTH, type TerrainMap, type WorldState } from '@csp/shared'
import { placeResourceNodes } from './node-gen.js'
import { mulberry32, newResident } from './residents.js'
import { nearestFreeTile } from './world.js'

/**
 * The shape of saved world state (ADR 0006). Any change to `WorldState` that an older save
 * would not match bumps this and adds a migration below, with a test in saves.test.ts.
 * Deploys never reset the world.
 */
export const WORLD_FORMAT_VERSION = 4

/** What a migration step may look at besides the save itself. */
export interface MigrationContext {
  /** The world's stored terrain. */
  terrain: TerrainMap
}

export type MigrationStep = (state: unknown, ctx: MigrationContext) => unknown

/** `migrations[n]` turns a version-n save into version n + 1. */
export const migrations: Record<number, MigrationStep> = {
  // Terrain moved out of the save into its own table, and the 32×24 grid became the disc.
  // Units keep their places relative to each other, around the disc's centre.
  1: (state, { terrain }) => {
    const { tick, seed, width, height, units } = state as WorldStateV1
    const centre = Math.floor(terrain.diameter / 2)
    const occupied = new Set<string>()
    const moved = units.map((u) => {
      const [x, y] = nearestFreeTile(
        terrain,
        occupied,
        centre - Math.floor(width / 2) + u.x,
        centre - Math.floor(height / 2) + u.y,
      )
      occupied.add(`${x},${y}`)
      return { ...u, x, y }
    })
    return { tick, seed, units: moved }
  },
  // Resource nodes arrived; an existing world gets the ones a new world with its seed would.
  2: (state, { terrain }) => {
    const s = state as { seed: number }
    return { ...s, nodes: placeResourceNodes(terrain, s.seed) }
  },
  // The placeholder units became residents: same id, side and place, health from their hit
  // points (10 was full), and new random stats and age.
  3: (state) => {
    const { units, ...rest } = state as { tick: number; seed: number; units: UnitV1[] }
    const residents = units.map((u, i) => ({
      ...newResident(mulberry32(rest.seed * 31 + i), {
        id: u.id,
        owner: u.owner,
        x: u.x,
        y: u.y,
        tick: rest.tick,
      }),
      health: Math.max(0, Math.min(MAX_HEALTH, Math.round((u.hp / 10) * MAX_HEALTH))),
    }))
    return { ...rest, residents }
  },
}

/** A placeholder unit, as saved in formats 1 to 3. */
interface UnitV1 {
  id: string
  owner: string
  x: number
  y: number
  hp: number
}

/** World state as saved in format 1. */
interface WorldStateV1 {
  tick: number
  seed: number
  width: number
  height: number
  tiles: string[]
  units: UnitV1[]
}

export class WorldFormatError extends Error {}

/** Brings a save written in format `version` up to the current format. */
export function migrateWorld(
  state: unknown,
  version: number,
  ctx: MigrationContext,
  steps: Record<number, MigrationStep> = migrations,
  current = WORLD_FORMAT_VERSION,
): WorldState {
  if (version > current) {
    throw new WorldFormatError(
      `the saved world is format ${version}, newer than this server (${current}); deploy a newer server`,
    )
  }
  let s = state
  for (let v = version; v < current; v++) {
    const step = steps[v]
    if (!step) throw new WorldFormatError(`no migration from world format ${v} to ${v + 1}`)
    s = step(s, ctx)
  }
  return s as WorldState
}
