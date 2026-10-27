import type { TerrainMap, WorldState } from '@csp/shared'
import { leaveTradeOrg } from './caravans.js'

/**
 * The shape of saved world state (ADR 0006). Any change to `WorldState` that an older save
 * would not match bumps this and adds a migration below, with a test in saves.test.ts.
 * Deploys never reset the world, with two recorded exceptions (`RESET_BEFORE`).
 */
export const WORLD_FORMAT_VERSION = 43

/**
 * Saves older than this format are thrown away and a new world created, while accounts stay
 * (ADR 0006). The world was reset twice before anyone played for real: once when the map became
 * a torus (before format 6), and once for the 4× finer grid with buildings covering several
 * tiles (before format 37, "Exception: the second reset"). Never raise this again.
 */
export const RESET_BEFORE = 37

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
export const migrations: Record<number, MigrationStep> = {
  // A captured trading post leaves the Trade Organization (`CONTEXT.md`: Trading post); posts
  // captured before that still counted as the Trade Org's.
  37: (state) => {
    const world = structuredClone(state) as WorldState
    for (const c of world.cities)
      if (c.tradeOrg === 'post' && c.realmId !== null) leaveTradeOrg(world, c)
    return world
  },
  // Realms get a realm name (`CONTEXT.md`: Realm name). Realms from before have none and go by
  // their Leader's name until the Player names them, so the step leaves them as they are.
  38: (state) => state,
  // Last seen (`CONTEXT.md`): every Player starts with an empty memory. It is not filled from
  // explored terrain, which would hand them buildings and prices they never saw.
  39: (state) => ({ ...(state as object), lastSeen: {} }),
  // Walls can be built along a line (`CONTEXT.md`: Wall / Gate), a new order kind. Orders from
  // before are all road lines, which keep their shape, so the step leaves them as they are.
  40: (state) => state,
  // Store and fetch orders (`CONTEXT.md`: Store, Fetch) and how a resident's last one ended
  // (`orderEnded`). Older residents hold neither, so the step leaves them as they are.
  41: (state) => state,
  // Script parameters (`CONTEXT.md`: Script parameter): the values picked for a resident's
  // (`Resident.scriptParams`). Older residents have none picked, so their params read null and
  // the defaults fall back to the nearest place; the step leaves them as they are.
  42: (state) => state,
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
