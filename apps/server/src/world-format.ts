import {
  AVERAGE_HORSE_STATS,
  HORSE_START_AGE_MAX,
  HORSE_START_AGE_MIN,
  TICKS_PER_GAME_YEAR,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { leaveTradeOrg } from './caravans.js'
import { grantHorses } from './horse-grant.js'

/**
 * The shape of saved world state (ADR 0006). Any change to `WorldState` that an older save
 * would not match bumps this and adds a migration below, with a test in saves.test.ts.
 * Deploys never reset the world, with two recorded exceptions (`RESET_BEFORE`).
 */
export const WORLD_FORMAT_VERSION = 54

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
  // Horses get stats and an age (`CONTEXT.md`: Horse stats). Those from before are average in
  // every stat, and as old as the middle of a new horse's age range.
  43: (state) => {
    const world = structuredClone(state) as WorldState
    const age = (HORSE_START_AGE_MIN + HORSE_START_AGE_MAX) / 2
    for (const h of world.horses) {
      h.stats = { ...AVERAGE_HORSE_STATS }
      h.bornAt = world.tick - Math.round(age * TICKS_PER_GAME_YEAR)
    }
    return world
  },
  // Breeding is a resident's order (`CONTEXT.md`: Breeding): stables no longer breed on their
  // own, so the progress they kept goes. Nobody tends their horses yet; the foal starts over.
  44: (state) => {
    const world = structuredClone(state) as WorldState
    for (const b of world.buildings) delete (b as { breeding?: number }).breeding
    return world
  },
  // Residents can ride horses (`CONTEXT.md`: Riding), a new `riding` field. Nobody rode before,
  // so the step leaves the world as it is.
  45: (state) => state,
  // Queues (`CONTEXT.md`: Queue): the steps a resident works through (`Resident.queue`). Older
  // residents work through none, so the step leaves them as they are.
  46: (state) => state,
  // The Horse grant (`CONTEXT.md`: Horse grant): a one-time gift of two horses to every Player realm
  // with a living Leader and none left. It runs once, here, not as a tick rule.
  47: (state, ctx) => {
    const world = structuredClone(state) as WorldState
    grantHorses(world, ctx.terrain)
    return world
  },
  // Outpost storages belong to a realm (`CONTEXT.md`: Outpost storage, `Building.realmId`). A
  // storage of no city from before has no record of the city it last belonged to, so it stays
  // ownerless and the step leaves the world as it is.
  48: (state) => state,
  // Scripts see exactly their script views (`CONTEXT.md`: Script view; ADR 0011), and a breaking
  // change to one goes in the realm log of each Player whose scripts read the field. None was
  // told of yet, so the server tells them of the switch to views itself at its next start.
  49: (state) => ({ ...(state as object), scriptViewChanges: 0 }),
  // Number script params (`CONTEXT.md`: Script parameter): a picked value may be a whole number
  // as well as an id (`ScriptParamValue`). Values from before are all ids, so the step leaves
  // them as they are.
  50: (state) => state,
  // Breeding progress belongs to the two horses in the stable (`CONTEXT.md`: Breeding,
  // `Building.breedings`), no longer only to the breeder's order. A breeding under way keeps its
  // progress: its stable now keeps it for the pair too.
  51: (state) => {
    const world = structuredClone(state) as WorldState
    for (const r of world.residents) {
      const o = r.order
      if (o?.kind !== 'breed' || o.progress < 1) continue
      const stable = world.buildings.find((b) => b.id === o.stableId)
      if (!stable) continue
      ;(stable.breedings ??= []).push({
        horseIds: [o.horseIds[0], o.horseIds[1]],
        progress: o.progress,
      })
    }
    return world
  },
  // The Horse offer (`CONTEXT.md`: Horse offer) is kept with the Player (`horseOffersClaimed`).
  // Nobody could claim it before, so every existing Player starts unclaimed, whether or not they
  // have horses or got the Horse grant.
  52: (state) => ({ ...(state as object), horseOffersClaimed: [] }),
  // Residents ride carriages as passengers (`CONTEXT.md`: Passenger), a new `aboard` field.
  // Nobody was aboard before, so the step leaves the world as it is.
  53: (state) => state,
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
