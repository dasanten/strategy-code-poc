import type { TerrainMap, WorldState } from '@csp/shared'

/**
 * The shape of saved world state (ADR 0006). Any change to `WorldState` that an older save
 * would not match bumps this and adds a migration below, with a test in saves.test.ts.
 * Deploys never reset the world, with one recorded exception (`RESET_BEFORE`).
 */
export const WORLD_FORMAT_VERSION = 8

/**
 * Saves older than this format are from the disc-shaped map. The world was reset once when the
 * map became a torus (ADR 0006, "Exception: the one reset"): such a world is thrown away and a
 * new one created, while accounts stay. Never raise this again.
 */
export const RESET_BEFORE = 6

/** What a migration step may look at besides the save itself. */
export interface MigrationContext {
  /** The world's stored terrain. */
  terrain: TerrainMap
}

export type MigrationStep = (state: unknown, ctx: MigrationContext) => unknown

/**
 * `migrations[n]` turns a version-n save into version n + 1. Steps start at `RESET_BEFORE`;
 * the steps for disc-shaped worlds went with the reset.
 */
export const migrations: Record<number, MigrationStep> = {
  // Goods got weight and a place: residents carry some (nothing yet), and piles lie on the ground.
  6: (state) => {
    const s = state as { residents: object[] }
    return { ...s, residents: s.residents.map((r) => ({ ...r, carried: {} })), piles: [] }
  },
  // Residents got orders; everyone starts idle.
  7: (state) => {
    const s = state as { residents: object[] }
    return { ...s, residents: s.residents.map((r) => ({ ...r, order: null })) }
  },
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
