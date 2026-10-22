import type { TerrainMap, WorldState } from '@csp/shared'

/**
 * The shape of saved world state (ADR 0006). Any change to `WorldState` that an older save
 * would not match bumps this and adds a migration below, with a test in saves.test.ts.
 * Deploys never reset the world, with two recorded exceptions (`RESET_BEFORE`).
 */
export const WORLD_FORMAT_VERSION = 36

/**
 * Saves older than this format are thrown away and a new world created, while accounts stay
 * (ADR 0006). The world was reset twice before anyone played for real: once when the map became
 * a torus (before format 6), and once for the 4× finer grid with buildings covering several
 * tiles (before format 36, "Exception: the second reset"). Never raise this again.
 */
export const RESET_BEFORE = 36

/** What a migration step may look at besides the save itself. */
export interface MigrationContext {
  /** The world's stored terrain. */
  terrain: TerrainMap
}

export type MigrationStep = (state: unknown, ctx: MigrationContext) => unknown

/**
 * `migrations[n]` turns a version-n save into version n + 1. Steps start at `RESET_BEFORE`;
 * the steps for older worlds went with the resets.
 */
export const migrations: Record<number, MigrationStep> = {}

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
