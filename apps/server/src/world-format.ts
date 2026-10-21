import {
  MAX_HEALTH,
  MAX_HUNGER,
  START_HORSES,
  START_STABLE_FOOD,
  wrapDistance,
  type Building,
  type Carriage,
  type City,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { updateCityMembership } from './cities.js'
import { NPC_ORDER_KINDS } from './npc-behaviour.js'
import { placeNpcCities } from './npc-cities.js'
import { nearestCity, walkHomeIfAway } from './survival.js'
import { placeTradeOrgHq } from './trade-org.js'
import { placeTradingPosts } from './trading-posts.js'
import { placeCaravans } from './caravans.js'
import { forgetFormerPlayers, welcomeFormerPlayer } from './standing.js'
import { drawLifespan, hash, mulberry32 } from './residents.js'
import { plainsOutside, ringTiles } from './starting-city.js'

/** A city as saved before format 15: a walled square with one gate in its wall ring. */
interface OldCity {
  id: string
  name: string
  realmId: string | null
  x: number
  y: number
  size: number
  wall: 'wooden'
  gate: { x: number; y: number }
}

/** Whether a tile lay inside an old city's walls. */
const isInsideWalls = (c: OldCity, x: number, y: number) =>
  x > c.x && y > c.y && x < c.x + c.size - 1 && y < c.y + c.size - 1

/**
 * The shape of saved world state (ADR 0006). Any change to `WorldState` that an older save
 * would not match bumps this and adds a migration below, with a test in saves.test.ts.
 * Deploys never reset the world, with one recorded exception (`RESET_BEFORE`).
 */
export const WORLD_FORMAT_VERSION = 34

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
  // Residents got a lifespan, drawn from their id so the same save always migrates the same way.
  8: (state) => {
    const s = state as { residents: { id: string }[] }
    return {
      ...s,
      residents: s.residents.map((r) => ({ ...r, lifespan: drawLifespan(mulberry32(hash(r.id))) })),
    }
  },
  // Players got realm logs; what happened before is not known, so every log starts empty.
  9: (state) => ({ ...(state as object), events: [] }),
  // Residents got a city to live in, for housing and pairing. Everyone so far came with a
  // starting city, so each lives in the nearest city of their realm, or, when their realm has
  // ended, in the nearest city of all.
  10: (state, ctx) => {
    const s = state as { residents: { owner: string | null; x: number; y: number }[] } & {
      cities: OldCity[]
    }
    const nearest = (r: { x: number; y: number }, cities: OldCity[]) =>
      cities
        .map((c) => ({
          c,
          d: wrapDistance(ctx.terrain.size, r, { x: c.x + c.size / 2, y: c.y + c.size / 2 }),
        }))
        .sort((p, q) => p.d - q.d)[0]?.c
    return {
      ...s,
      residents: s.residents.map((r) => {
        const own = s.cities.filter((c) => r.owner !== null && c.realmId === r.owner)
        const city = nearest(r, own.length > 0 ? own : s.cities)
        return { ...r, cityId: city?.id ?? null }
      }),
    }
  },
  // Horses got health, and starting cities a stable (`CONTEXT.md`: Horse, Stable, Starting city).
  // Each city with a farm gets a stable on the next free Plains tile outside its wall, with a
  // little food; the horses inside its walls move in, topped up to `START_HORSES` of its realm.
  11: (state, ctx) => {
    type OldHorse = { id: string; realmId: string | null; x: number; y: number; hunger: number }
    const s = state as {
      horses: OldHorse[]
      cities: OldCity[]
      buildings: Building[]
      nodes: { x: number; y: number }[]
      nextId: number
    }
    let nextId = s.nextId
    const buildings = [...s.buildings]
    const horses = s.horses.map((h) => ({ ...h, health: MAX_HEALTH }))
    for (const c of s.cities) {
      if (!buildings.some((b) => b.cityId === c.id && b.kind === 'farm')) continue
      const taken = new Set([...s.nodes, ...buildings].map((e) => `${e.x},${e.y}`))
      const tile = plainsOutside(ctx.terrain, c).find(([x, y]) => !taken.has(`${x},${y}`))
      if (!tile) continue
      const [x, y] = tile
      const stable: Building = {
        id: `b${nextId++}`,
        kind: 'stable',
        cityId: c.id,
        x,
        y,
        stock: { food: START_STABLE_FOOD },
      }
      buildings.push(stable)
      const inside = horses.filter((h) => isInsideWalls(c, h.x, h.y))
      for (const h of inside) Object.assign(h, { x, y })
      for (let i = inside.length; i < START_HORSES; i++) {
        horses.push({
          id: `horse${nextId++}`,
          realmId: c.realmId,
          x,
          y,
          hunger: MAX_HUNGER,
          health: MAX_HEALTH,
        })
      }
    }
    return { ...s, buildings, horses, nextId }
  },
  // Carriages can be driven, pulled by a hitched horse (`CONTEXT.md`: Carriage, Starting city).
  // A carriage inside a city's walls moves out to that city's stable, where its horses are, and
  // gets a horse of its realm there that pulls no other carriage; every other carriage has none.
  12: (state) => {
    type OldCarriage = Omit<Carriage, 'horseId'>
    const s = state as { carriages: OldCarriage[]; cities: OldCity[]; buildings: Building[] } & {
      horses: { id: string; realmId: string | null; x: number; y: number }[]
    }
    const hitched = new Set<string>()
    const carriages = s.carriages.map((k): Carriage => {
      const city = s.cities.find((c) => isInsideWalls(c, k.x, k.y))
      const stable = s.buildings.find(
        (b) => b.kind === 'stable' && !b.site && city && b.cityId === city.id,
      )
      if (!stable) return { ...k, horseId: null }
      const horse = s.horses.find(
        (h) =>
          h.x === stable.x && h.y === stable.y && h.realmId === k.realmId && !hitched.has(h.id),
      )
      if (horse) hitched.add(horse.id)
      return { ...k, x: stable.x, y: stable.y, horseId: horse?.id ?? null }
    })
    return { ...s, carriages }
  },
  // Haul routes got return goods; the routes already running haul nothing back.
  13: (state) => {
    const s = state as { residents: { order: { kind: string } | null }[] }
    return {
      ...s,
      residents: s.residents.map((r) =>
        r.order?.kind === 'haul' ? { ...r, order: { ...r.order, returnGoods: [] } } : r,
      ),
    }
  },
  // Cities are derived from their buildings (`CONTEXT.md`: City, Town hall, Wall / Gate). Each
  // city gets a town hall on the free tile inside its walls nearest the middle, and its wall
  // ring becomes wall buildings with a gate building where the gate was. Then every city
  // building belongs to the city its chain gives it. A city with no free tile for a town hall
  // dissolves, its residents homeless.
  14: (state, ctx) => {
    type OldResident = { cityId: string | null; order: { kind: string } | null }
    const s = state as {
      cities: OldCity[]
      buildings: Building[]
      residents: OldResident[]
      nodes: { x: number; y: number }[]
      nextId: number
    }
    let nextId = s.nextId
    const buildings = s.buildings.map((b) => ({ ...b }))
    const taken = new Set([...s.nodes, ...buildings].map((e) => `${e.x},${e.y}`))
    const cities: City[] = []
    for (const c of s.cities) {
      const mid = { x: c.x + Math.floor(c.size / 2), y: c.y + Math.floor(c.size / 2) }
      const inside: [number, number][] = []
      for (let y = c.y + 1; y < c.y + c.size - 1; y++) {
        for (let x = c.x + 1; x < c.x + c.size - 1; x++) inside.push([x, y])
      }
      const tile = inside
        .filter(([x, y]) => !taken.has(`${x},${y}`))
        .sort(
          (a, b) => Math.hypot(a[0] - mid.x, a[1] - mid.y) - Math.hypot(b[0] - mid.x, b[1] - mid.y),
        )[0]
      if (!tile) continue
      const hall: Building = {
        id: `b${nextId++}`,
        kind: 'townHall',
        cityId: c.id,
        x: tile[0],
        y: tile[1],
      }
      buildings.push(hall)
      taken.add(`${tile[0]},${tile[1]}`)
      for (const [x, y] of ringTiles(c)) {
        if (taken.has(`${x},${y}`)) continue
        const kind = x === c.gate.x && y === c.gate.y ? 'gate' : 'wall'
        buildings.push({ id: `b${nextId++}`, kind, cityId: c.id, x, y })
        taken.add(`${x},${y}`)
      }
      cities.push({ id: c.id, name: c.name, realmId: c.realmId, townHallId: hall.id })
    }
    const kept = new Set(cities.map((c) => c.id))
    const residents = s.residents.map((r) =>
      r.cityId === null || kept.has(r.cityId)
        ? r
        : { ...r, cityId: null, order: r.order?.kind === 'pair' ? null : r.order },
    )
    const next = { ...s, cities, buildings, residents, nextId }
    updateCityMembership(next as unknown as WorldState, ctx.terrain.size)
    return next
  },
  // Alliances came (`CONTEXT.md`: Alliance); there are none yet.
  15: (state) => ({ ...(state as object), alliances: [] }),
  // NPC cities came (`CONTEXT.md`: NPC city): the live world gets them as a new one would, on
  // Plains, far from every city and out of every Player's sight. The shape stays the same.
  16: (state, ctx) => {
    const world = structuredClone(state) as WorldState
    placeNpcCities(world, ctx.terrain)
    return world
  },
  // Crimes came (`CONTEXT.md`: Crime, Witness); none was noted before, so nobody knows of any.
  17: (state) => ({ ...(state as object), crimes: [] }),
  // Armies came (`CONTEXT.md`: Army); there are none yet.
  18: (state) => ({ ...(state as object), armies: [] }),
  // Cities of dead Leaders became self-managed (`CONTEXT.md`: Self-managed city). Cities of no
  // realm are already NPC cities, run with the residents who live there; homeless residents of
  // no realm join the nearest of them and walk home, and horses and carriages of no realm, which
  // now belong to an NPC city, go to the one nearest them.
  19: (state, ctx) => {
    const world = structuredClone(state) as WorldState
    const size = ctx.terrain.size
    const npc = world.cities.filter((c) => c.realmId === null)
    for (const r of world.residents) {
      if (r.owner !== null || r.cityId !== null) continue
      const city = nearestCity(world, npc, r, size)
      if (!city) continue
      r.cityId = city.id
      if (
        !walkHomeIfAway(world, city, r, size) &&
        r.order &&
        !NPC_ORDER_KINDS.includes(r.order.kind)
      ) {
        r.order = null
      }
    }
    for (const k of [...world.horses, ...world.carriages]) {
      k.cityId = k.realmId === null ? (nearestCity(world, npc, k, size)?.id ?? null) : null
    }
    return world
  },
  // The Trade Org HQ came (`CONTEXT.md`: Trade Org HQ, Warehouse), with a new kind of building
  // and a mark on Trade Org cities: the live world gets it as a new one would, as far from every
  // city as the map allows and out of every Player's sight. Nothing else changes.
  20: (state, ctx) => {
    const world = structuredClone(state) as WorldState
    placeTradeOrgHq(world, ctx.terrain)
    return world
  },
  // Trading posts came (`CONTEXT.md`: Trading post), with a second mark for Trade Org cities: the
  // live world gets one in every region, as a new one would, out of every Player's sight.
  21: (state, ctx) => {
    const world = structuredClone(state) as WorldState
    placeTradingPosts(world, ctx.terrain)
    return world
  },
  // Alliances got an army (`CONTEXT.md`: Alliance army): nothing is handed over yet.
  22: (state) => {
    const world = structuredClone(state) as { alliances: object[] }
    world.alliances = world.alliances.map((a) => ({ ...a, army: [] }))
    return world
  },
  // Mercenary contracts came (`CONTEXT.md`: Mercenary contract); there are none yet.
  23: (state) => ({ ...(state as object), contracts: [] }),
  // Caravans came (`CONTEXT.md`: Caravan): the HQ gets one for every trading post, as a new
  // world would, with a carriage, a horse and a crew of new residents at its goods warehouse.
  24: (state) => {
    const world = { ...structuredClone(state as WorldState), caravans: [] }
    placeCaravans(world)
    return world
  },
  // Standing came (`CONTEXT.md`: Standing): everyone starts neutral toward everyone.
  25: (state) => ({ ...(state as object), standings: [] }),
  // Deliveries came (`CONTEXT.md`: Delivery): none are ordered yet, and no caravan carries one out.
  26: (state) => {
    const world = structuredClone(state) as { caravans: object[] }
    return {
      ...world,
      caravans: world.caravans.map((c) => ({ ...c, job: null })),
      deliveries: [],
    }
  },
  // Persuading a city came (`CONTEXT.md`: Persuading a city); no city has asked anyone yet.
  27: (state) => ({ ...(state as object), joinRequests: [] }),
  // Self-managed cities came to remember their former Player (`CONTEXT.md`: Self-managed city):
  // each one a Leader death left, as the Player's log tells, remembers them from then on, and a
  // Player who already has a new realm gets what is left of that good standing now.
  28: (state) => {
    const world = structuredClone(state) as WorldState
    for (const e of world.events) {
      if (e.kind !== 'selfManaged') continue
      for (const { cityId } of e.cities) {
        const city = world.cities.find((c) => c.id === cityId && c.realmId === null)
        if (city) city.formerPlayer = { userId: e.userId, tick: e.tick }
      }
    }
    for (const realm of world.realms) welcomeFormerPlayer(world, realm)
    forgetFormerPlayers(world)
    return world
  },
  // The Trade Organization's punishments came (`CONTEXT.md`: Trade Org reaction); none are under way.
  29: (state) => ({ ...(state as object), punishments: [] }),
  // Robbed caravans are made good and robberies counted per route (`CONTEXT.md`: Guaranteed
  // carriage): no route was robbed yet, and no caravan's job counts anything robbed.
  30: (state) => {
    const world = structuredClone(state) as { caravans: { job: object | null }[] }
    return {
      ...world,
      caravans: world.caravans.map((c) => ({ ...c, job: c.job && { ...c.job, robbed: 0 } })),
      routeRobberies: {},
    }
  },
  // Admins give directives (`CONTEXT.md`: Admin directive); none are in force yet.
  31: (state) => ({ ...(state as object), directives: [] }),
  // Directives have goals (`CONTEXT.md`: Admin directive); those in force were given without
  // any, so they end only when an admin lifts them, and count no soldiers killed yet.
  32: (state) => {
    const world = state as { directives: object[] }
    return {
      ...world,
      directives: world.directives.map((d) => ({ ...d, goals: [], soldiersKilled: 0 })),
    }
  },
  // Directives can be bought off where an admin allows it (`CONTEXT.md`: Admin directive); none
  // given so far allows it.
  33: (state) => {
    const world = structuredClone(state) as { directives: object[] }
    return { ...world, directives: world.directives.map((d) => ({ ...d, price: null })) }
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
