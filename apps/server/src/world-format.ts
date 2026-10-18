import type { WorldState } from '@csp/shared'

/**
 * The shape of saved world state (ADR 0006). Any change to `WorldState` that an older save
 * would not match bumps this and adds a migration below, with a test in world-format.test.ts.
 * Deploys never reset the world.
 */
export const WORLD_FORMAT_VERSION = 1

/** `migrations[n]` turns a version-n save into version n + 1. */
export const migrations: Record<number, (state: unknown) => unknown> = {
  // 1: (state) => ({ ...(state as object), newField: 'default' }),
}

export class WorldFormatError extends Error {}

/** Brings a save written in format `version` up to the current format. */
export function migrateWorld(
  state: unknown,
  version: number,
  steps: Record<number, (state: unknown) => unknown> = migrations,
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
    s = step(s)
  }
  return s as WorldState
}
