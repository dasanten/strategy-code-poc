import {
  AVERAGE_HORSE_STATS,
  HORSE_START_AGE_MAX,
  HORSE_START_AGE_MIN,
  TICKS_PER_GAME_YEAR,
  inCityArea,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { leaveTradeOrg } from './caravans.js'
import { grantHorses } from './horse-grant.js'
import { paramTarget } from './script-params.js'

/**
 * The shape of saved world state (ADR 0006). Any change to `WorldState` that an older save
 * would not match bumps this and adds a migration below, with a test in saves.test.ts.
 * Deploys never reset the world, with two recorded exceptions (`RESET_BEFORE`).
 */
export const WORLD_FORMAT_VERSION = 64

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
  // Work takes its workplace as the param `workplace` (`CONTEXT.md`: Default script, Started
  // directly; ADR 0014), no longer from memory. A resident working by a script of their Player's
  // gets the workplace its memory names as that param, so they work on; the memory keeps it too,
  // as Work still writes it there. A script with no such param drops it on its next run.
  54: (state) => {
    const world = structuredClone(state) as WorldState
    for (const r of world.residents) {
      const s = r.script
      const id = s?.memory.workplaceId
      if (!s || s.scriptId <= 0 || typeof id !== 'string') continue
      if (!world.buildings.some((b) => b.id === id)) continue
      const picked = ((r.scriptParams ??= {})[s.scriptId] ??= {})
      picked.workplace ??= id
    }
    return world
  },
  // Tear down, Breed horses and Feed the stable take their target as a param too: `building`,
  // and `stable` for both (`CONTEXT.md`: Default script, Started directly). A resident running
  // one by a script of their Player's gets the building or stable its memory names as that
  // param, when it is one of their realm's a param can name; the memory keeps it too, which the
  // defaults still read. A script with no such param drops it on its next run.
  55: (state) => {
    const world = structuredClone(state) as WorldState
    for (const r of world.residents) {
      const s = r.script
      if (!s || s.scriptId <= 0 || r.owner === null) continue
      const give = (name: string, type: 'building' | 'storage', id: unknown) => {
        if (typeof id !== 'string' || !paramTarget(world, r.owner!, type, id)) return
        const picked = ((r.scriptParams ??= {})[s.scriptId] ??= {})
        picked[name] ??= id
      }
      give('building', 'building', s.memory.buildingId)
      give('stable', 'storage', s.memory.stableId)
    }
    return world
  },
  // Build takes the site it joins as the param `site`, Haul its carriage as the param `carriage`
  // (`CONTEXT.md`: Default script, Started directly; ADR 0014). A resident building or hauling by
  // a script of their Player's gets the unfinished site (`memory.siteId`) or the carriage
  // (`memory.carriageId`) its memory names as that param, where the param can hold it (one of
  // their realm's); the memory keeps them too, as both defaults still read them there. A script
  // with no such param drops it on its next run.
  56: (state) => {
    const world = structuredClone(state) as WorldState
    for (const r of world.residents) {
      const s = r.script
      if (!s || s.scriptId <= 0 || r.owner === null) continue
      const { siteId, carriageId } = s.memory
      const site =
        typeof siteId === 'string' &&
        paramTarget(world, r.owner, 'building', siteId)?.is === 'building' &&
        world.buildings.some((b) => b.id === siteId && b.site)
      const carriage =
        typeof carriageId === 'string' &&
        paramTarget(world, r.owner, 'storage', carriageId)?.is === 'carriage'
      if (!site && !carriage) continue
      const picked = ((r.scriptParams ??= {})[s.scriptId] ??= {})
      if (site) picked.site ??= siteId
      if (carriage) picked.carriage ??= carriageId
    }
    return world
  },
  // A construction site belongs to the realm whose resident laid it out, until it is finished
  // (`CONTEXT.md`: Construction site; `Building.realmId`). Who laid out a site already there
  // isn't known: each gets the realm of a resident building it, else of the city it stands in
  // (the one a farm or stable was laid out for, or whose area it is in), else none.
  57: (state, { terrain }) => {
    const world = structuredClone(state) as WorldState
    for (const b of world.buildings) {
      if (!b.site) continue
      const builder = world.residents.find(
        (r) => r.owner !== null && (r.order as { siteId?: unknown } | null)?.siteId === b.id,
      )
      const city =
        world.cities.find((c) => c.id === b.cityId) ??
        world.cities.find((c) => inCityArea(world, c, b.x, b.y, terrain.size))
      const realm = builder?.owner ?? city?.realmId ?? null
      if (realm !== null) b.realmId = realm
    }
    return world
  },
  // A running script keeps its last runtime error and the steps it used (`CONTEXT.md`:
  // Debugging a script). Scripts from before have neither until they next run, so the step
  // leaves them as they are.
  58: (state) => state,
  // Script logs (`CONTEXT.md`: Script log, `Resident.scriptLog`). Nothing was logged before, so
  // every resident starts with none and the step leaves them as they are.
  59: (state) => state,
  // A resident keeps who last struck them and when (`CONTEXT.md`: Combat, Under attack;
  // `Resident.struck`). Who struck whom before isn't known, so every resident starts as never
  // struck and the step leaves them as they are.
  60: (state) => state,
  // A struck resident's defence script keeps what it interrupted aside (`CONTEXT.md`: Defence
  // script; `Resident.interrupted`). Blows before gave built-in orders, so no resident has
  // anything interrupted and the step leaves them as they are.
  61: (state) => state,
  // A resident may keep a defence script the Player picked (`CONTEXT.md`: Defence script;
  // `Resident.defenceScriptId`), absent for the Defend default. Nobody picked one before, so the
  // step leaves every resident as they are.
  62: (state) => state,
  // A running script may wait on its resident's order (`CONTEXT.md`: Running a script, Waiting;
  // `RunningScript.waitingSince`). No script could wait before, so every one runs every tick and
  // the step leaves them as they are.
  63: (state) => state,
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
