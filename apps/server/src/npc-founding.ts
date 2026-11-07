import {
  BUILD_MATERIALS,
  FOOD_PER_DAY,
  HOUSING_ROOM,
  NODE_GOOD,
  NPC_CITY_MIN_DISTANCE,
  NPC_FOUND_FOOD_DAYS,
  NPC_FOUND_GIVE_UP_DAYS,
  NPC_FOUND_PARTY_MOST,
  NPC_FOUND_REACH,
  NPC_FOUND_SAMPLES,
  NPC_FOUND_STANDING,
  NPC_FULL_DIP_DAYS,
  NPC_NODE_REACH,
  NPC_PLAN_TICKS,
  NPC_VILLAGE,
  TICKS_PER_GAME_DAY,
  WALK_TICKS_PER_TILE,
  buildingAt,
  carryCapacity,
  cityResidents,
  computeTerritory,
  hasFoodSurplus,
  isArmed,
  isAt,
  npcCityStock,
  npcFoundingPartySize,
  npcFullDays,
  npcReserve,
  stockWeight,
  wrap,
  wrapDistance,
  GOOD_WEIGHT,
  type Building,
  type City,
  type CityJob,
  type CityPlan,
  type Good,
  type Resident,
  type Stock,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import type { Invariant, InvariantViolation } from './invariants.js'
import { stopWork } from './npc-behaviour.js'
import { shortGoods } from './npc-chain.js'
import { npcSiteFits, takenGround } from './npc-cities.js'
import { knowsNode } from './npc-scouts.js'
import { hash, mulberry32 } from './residents.js'
import { FARM_RING, hallTile } from './starting-city.js'
import { raiseStandingBothWays } from './standing.js'

/*
 * How a full NPC city founds a daughter (`CONTEXT.md`: Full city, Founding). Its planning pass
 * (`planCity`) keeps `CityPlan.fullSince` while it has idle spare hands and nothing short; full a
 * game week, less the bigger it is, with a food surplus and its party's materials to spare, it looks
 * for a site once a game day (`CityPlan.foundingSite`, the town hall's tile) and sends a founding
 * party: its members get the `found` job, and `fullSince` then holds when they set out. Each tick
 * the party loads its share at the storage and builds the town hall by the Build default
 * (`stepFounders`); once it stands, the party moves to the daughter (`foundDaughter`). All through
 * the orders a Player's residents take (ADR 0002).
 */

/**
 * The materials a founding party of `members` carries (`CONTEXT.md`: Founding): a town hall's and a
 * storage's, and a house's for each `HOUSING_ROOM.house` members past a village's worth, rounded up.
 * What they don't build with they put in the daughter's storage, which builds the houses.
 */
export function foundingMaterials(members: number = NPC_VILLAGE.residents): Stock {
  const out: Stock = {}
  const add = (goods: Stock | undefined, times = 1) => {
    for (const [good, n] of Object.entries(goods ?? {}) as [Good, number][]) {
      out[good] = (out[good] ?? 0) + n * times
    }
  }
  add(BUILD_MATERIALS.townHall)
  add(BUILD_MATERIALS.storage)
  const past = Math.max(0, members - NPC_VILLAGE.residents)
  add(BUILD_MATERIALS.house, Math.ceil(past / (HOUSING_ROOM.house ?? 1)))
  return out
}

/** The ids of a plan's founding party, by their `found` jobs: none while no party is out. */
export function foundingParty(plan: CityPlan | undefined): string[] {
  if (!plan) return []
  return Object.entries(plan.jobs)
    .filter(([, job]) => job.kind === 'found')
    .map(([id]) => id)
}

/**
 * Whether a city would be full but for its materials (`CONTEXT.md`: Full city, NPC road): with no
 * party out, full since `npcFullDays` game days at least, less the bigger it is, and with a food
 * surplus. From then on its road crew leaves what the founding takes (`keeps` in `npc-roads.ts`).
 */
export function fullButMaterials(world: WorldState, city: City, plan: CityPlan): boolean {
  if (plan.fullSince === undefined || foundingParty(plan).length > 0) return false
  const wait = npcFullDays(cityResidents(world, city).length) * TICKS_PER_GAME_DAY
  return world.tick - plan.fullSince >= wait && hasFoodSurplus(world, city)
}

/**
 * Whether a city is full (`CONTEXT.md`: Full city): it would be but for its materials
 * (`fullButMaterials`), and holds its founding party's (`foundingMaterials`) above its reserve.
 */
export function isFull(world: WorldState, city: City, plan: CityPlan): boolean {
  if (!fullButMaterials(world, city, plan)) return false
  const reserve = npcReserve(world, city)
  const stock = npcCityStock(world, city)
  const materials = foundingMaterials(npcFoundingPartySize(cityResidents(world, city).length))
  return (Object.entries(materials) as [Good, number][]).every(
    ([good, n]) => (stock[good] ?? 0) >= (reserve[good] ?? 0) + n,
  )
}

/**
 * The founding part of an NPC city's planning pass (`CONTEXT.md`: Full city, Founding), after its
 * jobs are shared out. With a party out, it only gives up once `NPC_FOUND_GIVE_UP_DAYS` have gone
 * by since it set out and the town hall doesn't stand: its members who live are let go (`idle`, so
 * they walk home) and the city may found again once full again. With something short of its reserve
 * it does nothing more, and a wait under way starts over only once that has lasted past
 * `NPC_FULL_DIP_DAYS` (`CityPlan.shortSince`). Otherwise it keeps `fullSince` while it has idle
 * spare hands (`unneeded`: spare hands the pass had nowhere to send, idle or back on a farm beyond
 * the farmers it keeps), clears it (and the site) else; once full it searches for a site on its
 * daily pass (`findFoundingSite`), and with one sends a party (`pickParty`). `adults` are those it
 * gives orders to, the party aside; `members` the party's who live and belong to it.
 */
export function planFounding(
  world: WorldState,
  city: City,
  plan: CityPlan,
  jobs: Record<string, CityJob>,
  people: { adults: Resident[]; unneeded: Resident[]; members: Resident[] },
  home: Building | undefined,
  terrain: TerrainMap | undefined,
): void {
  const { adults, unneeded, members } = people
  if (city.tradeOrg) return
  const party = foundingParty(plan)
  if (party.length > 0) {
    for (const id of party) jobs[id] = { kind: 'found' }
    const since = plan.fullSince ?? world.tick
    if (hallStands(world, plan)) return
    if (world.tick - since < NPC_FOUND_GIVE_UP_DAYS * TICKS_PER_GAME_DAY) return
    for (const id of party) delete jobs[id]
    for (const r of members) {
      r.order = null
      delete r.script
      jobs[r.id] = { kind: 'idle' }
    }
    delete plan.fullSince
    delete plan.foundingSite
    return
  }
  if (shortGoods(world, city).length > 0) {
    if (plan.fullSince === undefined) return
    plan.shortSince ??= world.tick
    if (world.tick - plan.shortSince <= NPC_FULL_DIP_DAYS * TICKS_PER_GAME_DAY) return
    delete plan.shortSince
    delete plan.fullSince
    delete plan.foundingSite
    return
  }
  delete plan.shortSince
  if (unneeded.length === 0) {
    delete plan.fullSince
    delete plan.foundingSite
    return
  }
  plan.fullSince ??= world.tick
  if (!terrain || !home || !isFull(world, city, plan)) return
  if (plan.foundingSite && !siteStillFits(world, terrain, plan.foundingSite)) {
    delete plan.foundingSite
  }
  if (!plan.foundingSite && dailyPass(world, city)) {
    const site = findFoundingSite(world, terrain, city, home)
    if (site) plan.foundingSite = site
  }
  if (!plan.foundingSite) return
  const walk = wrapDistance(terrain.size, home, plan.foundingSite) * WALK_TICKS_PER_TILE
  const near = (r: Resident) => !farOut(r, home, terrain.size)
  const chosen = pickParty(world, city, adults, unneeded, near, jobs, walk)
  if (!chosen) return
  for (const r of chosen) {
    r.order = null
    delete r.script
    delete r.interrupted
    endPair(world, r)
    jobs[r.id] = { kind: 'found' }
  }
  // From now on `fullSince` is when the party set out (`CityPlan.fullSince`).
  plan.fullSince = world.tick
}

/** Whether this pass is a city's first of a game day, when it may search for a site. */
function dailyPass(world: WorldState, city: City): boolean {
  return (world.tick + hash(city.id)) % TICKS_PER_GAME_DAY < NPC_PLAN_TICKS
}

/** Whether the town hall stands finished on the plan's founding site. */
function hallStands(world: WorldState, plan: CityPlan): boolean {
  const site = plan.foundingSite
  const hall = site && buildingAt(world, site.x, site.y)
  return !!hall && hall.kind === 'townHall' && !hall.site
}

/**
 * Whether a resident is too far from home to fetch their share of a founding party's load
 * (`stepFounders`): a scout out, or a worker at a workplace on a far node.
 */
export function farOut(
  r: Pick<Resident, 'x' | 'y'>,
  home: Pick<Building, 'x' | 'y'>,
  size: number,
): boolean {
  return wrapDistance(size, r, home) > NPC_NODE_REACH
}

/**
 * The founding party (`CONTEXT.md`: Founding): `npcFoundingPartySize` adults, one of them armed
 * while the city has an armed adult, the rest of its `unneeded` spare hands and its workers off the
 * farms, those with the most room on them first; all of them `near` enough to fetch their share,
 * none of them building, carrying a child or with one on the way. None while there aren't enough,
 * or while their arms can't hold the Food for the walk (`foundingFood`) and all the materials
 * (`foundingMaterials`): a daughter without them could never build its storage. A city only founds
 * with nothing short, so it holds its reserve of Food, and what they take of that still leaves those
 * who stay fed.
 */
function pickParty(
  world: WorldState,
  city: City,
  adults: Resident[],
  unneeded: Resident[],
  near: (r: Resident) => boolean,
  jobs: Record<string, CityJob>,
  walkTicks: number,
): Resident[] | undefined {
  const byId = new Map(world.residents.map((r) => [r.id, r]))
  const free = (r: Resident) => {
    if (r.carrying || !near(r)) return false
    const partner = r.pair && byId.get(r.pair.partnerId)
    return !partner?.carrying
  }
  const room = (r: Resident) =>
    carryCapacity(r, world.tick) - stockWeight(r.carried) + (r.carried.food ?? 0) * GOOD_WEIGHT.food
  const armed = adults.filter((r) => isArmed(r) && free(r)).sort((a, b) => room(b) - room(a))[0]
  const rest = [
    ...new Set([
      ...unneeded.filter((r) => !isArmed(r) && free(r)),
      ...adults.filter((r) => !isArmed(r) && free(r) && jobs[r.id]?.kind === 'work'),
    ]),
  ].sort((a, b) => room(b) - room(a))
  const members = npcFoundingPartySize(cityResidents(world, city).length)
  const party = [...(armed ? [armed] : []), ...rest].slice(0, members)
  if (party.length < members) return undefined
  const load =
    stockWeight(foundingMaterials(members)) +
    party.length * foundingFood(walkTicks).walk * GOOD_WEIGHT.food
  return party.reduce((sum, r) => sum + room(r), 0) >= load ? party : undefined
}

/** A pair ends when one of them leaves to found a daughter (a pair lives in one city). */
function endPair(world: WorldState, r: Resident): void {
  const partner = r.pair && world.residents.find((x) => x.id === r.pair!.partnerId)
  if (partner?.pair?.partnerId === r.id) delete partner.pair
  delete r.pair
}

/** The top-left tile of a village's square whose town hall stands at `hall` (`hallTile`). */
function squareOf(hall: { x: number; y: number }): { x: number; y: number } {
  const [hx, hy] = hallTile(0, 0, NPC_VILLAGE.size)
  return { x: hall.x - hx, y: hall.y - hy }
}

/**
 * Whether a village laid out from its town hall at `hall` fits (`npcSiteFits`, out of sight or
 * not), and never straddles the map's joins.
 */
function siteStillFits(
  world: WorldState,
  terrain: TerrainMap,
  hall: { x: number; y: number },
  ground = takenGround(world, terrain),
): boolean {
  const { x, y } = squareOf(hall)
  const far = terrain.size - NPC_VILLAGE.size - FARM_RING
  if (x < FARM_RING || y < FARM_RING || x > far || y > far) return false
  return npcSiteFits(world, terrain, NPC_VILLAGE, x, y, ground, false)
}

/**
 * The good a city wants its daughter near (`CONTEXT.md`: Founding): the first good of a node
 * (Wood, Stone, Iron ore, Gold ore) that no node it knows of yields (`knowsNode`); none if it
 * knows a node of each.
 */
export function lackedGood(
  world: WorldState,
  city: City,
  home: Building,
  size: number,
): Good | undefined {
  const goods = [...new Set(Object.values(NODE_GOOD))]
  return goods.find(
    (good) =>
      !world.nodes.some((n) => NODE_GOOD[n.kind] === good && knowsNode(city, home, n, size)),
  )
}

/**
 * A site for a city's daughter (`CONTEXT.md`: Founding), by its town hall's tile: of
 * `NPC_FOUND_SAMPLES` random tiles between `NPC_CITY_MIN_DISTANCE` and `NPC_FOUND_REACH` from its
 * home, those where a village fits (`npcSiteFits`, seen or not) with no tile of it on a realm's
 * territory; the one nearest a node of the good it lacks (`lackedGood`) wins, else the one
 * nearest home. None when no sample fits.
 */
export function findFoundingSite(
  world: WorldState,
  terrain: TerrainMap,
  city: City,
  home: Building,
): { x: number; y: number } | undefined {
  const size = terrain.size
  const rand = mulberry32(hash(`${city.id}:${world.tick}`))
  const ground = takenGround(world, terrain)
  const realms = new Set(world.realms.map((r) => r.id))
  let owners: Map<string, string> | undefined
  const onRealm = (x: number, y: number) => {
    owners ??= computeTerritory(world, size).owners
    const span = NPC_VILLAGE.size + 2 * FARM_RING
    for (let dy = 0; dy < span; dy++) {
      for (let dx = 0; dx < span; dx++) {
        const owner = owners.get(
          `${wrap(x - FARM_RING + dx, size)},${wrap(y - FARM_RING + dy, size)}`,
        )
        if (owner !== undefined && realms.has(owner)) return true
      }
    }
    return false
  }
  const good = lackedGood(world, city, home, size)
  const nodes = good ? world.nodes.filter((n) => NODE_GOOD[n.kind] === good) : []
  const score = (at: { x: number; y: number }) =>
    nodes.length > 0
      ? Math.min(...nodes.map((n) => wrapDistance(size, at, n)))
      : wrapDistance(size, home, at)
  let best: { hall: { x: number; y: number }; score: number } | undefined
  for (let i = 0; i < NPC_FOUND_SAMPLES; i++) {
    const angle = rand() * 2 * Math.PI
    const half = Math.floor(NPC_VILLAGE.size / 2)
    const d = NPC_CITY_MIN_DISTANCE + rand() * (NPC_FOUND_REACH - NPC_CITY_MIN_DISTANCE)
    const x = wrap(Math.round(home.x + d * Math.cos(angle)) - half, size)
    const y = wrap(Math.round(home.y + d * Math.sin(angle)) - half, size)
    const [hx, hy] = hallTile(x, y, NPC_VILLAGE.size)
    const hall = { x: hx, y: hy }
    if (!siteStillFits(world, terrain, hall, ground)) continue
    const s = score({ x: x + half, y: y + half })
    if (best && s >= best.score) continue
    if (onRealm(x, y)) continue
    best = { hall, score: s }
  }
  return best?.hall
}

/**
 * The Food a founding party's member carries (`CONTEXT.md`: Founding), in whole units: for twice
 * the walk to the site, and for `NPC_FOUND_FOOD_DAYS` there.
 */
export function foundingFood(walkTicks: number): { walk: number; stay: number } {
  const walk = Math.ceil(((2 * walkTicks) / TICKS_PER_GAME_DAY) * FOOD_PER_DAY - 1e-9)
  return { walk, stay: Math.ceil(NPC_FOUND_FOOD_DAYS * FOOD_PER_DAY - 1e-9) }
}

/**
 * What a founding party of `size` still lacks of its materials (`foundingMaterials`) beyond what
 * its `members` who live carry, as two parts in the order they are taken: the town hall's, then the
 * rest, so that what doesn't fit on them isn't the town hall's.
 */
function partyLacks(members: Resident[], size: number): Stock[] {
  const carried: Stock = {}
  for (const r of members) {
    // What they are picking up this tick counts as carried.
    const picking = r.order?.kind === 'pickUp' ? r.order.goods : {}
    for (const stock of [r.carried, picking]) {
      for (const [good, n] of Object.entries(stock) as [Good, number][]) {
        carried[good] = (carried[good] ?? 0) + n
      }
    }
  }
  const hall: Stock = {}
  const rest: Stock = {}
  for (const [good, n] of Object.entries(foundingMaterials(size)) as [Good, number][]) {
    const forHall = BUILD_MATERIALS.townHall?.[good] ?? 0
    const lack = Math.max(0, n - (carried[good] ?? 0))
    hall[good] = Math.max(0, forHall - (carried[good] ?? 0))
    rest[good] = lack - hall[good]
  }
  return [hall, rest]
}

/**
 * What the founding party does each tick (`CONTEXT.md`: Founding), for its members that are idle:
 * within `NPC_NODE_REACH` of the storage (at home, its farms or its workplaces), they first take
 * from it, as much as fits: Food for the walk (`foundingFood`), what the party still lacks of its
 * materials (`partyLacks`), then Food for their first weeks; then they build the town hall on the
 * site by the Build default, which walks them there, lays it out or joins it, and puts in what they
 * carry.
 */
export function stepFounders(
  world: WorldState,
  city: City,
  plan: CityPlan,
  members: Resident[],
  storage: Building | undefined,
  size: number,
): void {
  const site = plan.foundingSite
  if (!site) return
  const partySize = foundingParty(plan).length
  for (const r of members) {
    if (r.order !== null || r.script) continue
    if (storage && wrapDistance(size, r, storage) <= NPC_NODE_REACH) {
      const walk = wrapDistance(size, r, site) * WALK_TICKS_PER_TILE
      const food = foundingFood(walk)
      const onWay = Math.max(0, food.walk - (r.carried.food ?? 0))
      const stay = Math.max(0, food.walk + food.stay - (r.carried.food ?? 0) - onWay)
      const load = loadFor(
        world,
        r,
        [{ food: onWay }, ...partyLacks(members, partySize), { food: stay }],
        storage,
      )
      if (load) {
        if (isAt(r, storage, size)) {
          r.order = {
            kind: 'pickUp',
            from: { kind: 'storage', storageId: storage.id },
            goods: load,
          }
        } else {
          r.order = {
            kind: 'walkTo',
            target: { x: storage.x, y: storage.y },
            path: null,
            progress: 0,
          }
        }
        continue
      }
    }
    r.script = { scriptId: 0, task: 'build', memory: { building: 'townHall', at: { ...site } } }
  }
}

/**
 * What a member takes from the storage of `wanted`: part by part in its order, as far as the
 * storage holds it and it fits; none if nothing.
 */
function loadFor(
  world: WorldState,
  r: Resident,
  wanted: Stock[],
  storage: Building,
): Stock | undefined {
  let room = carryCapacity(r, world.tick) - stockWeight(r.carried)
  const load: Stock = {}
  for (const part of wanted) {
    for (const [good, units] of Object.entries(part) as [Good, number][]) {
      const left = Math.floor(storage.stock?.[good] ?? 0) - (load[good] ?? 0)
      const n = Math.min(units, Math.floor(room / GOOD_WEIGHT[good] + 1e-9), left)
      if (n <= 0) continue
      load[good] = (load[good] ?? 0) + n
      room -= n * GOOD_WEIGHT[good]
    }
  }
  return Object.keys(load).length > 0 ? load : undefined
}

/**
 * The founding party's town hall stands (`CONTEXT.md`: Founding): it founded the daughter, an NPC
 * city of its own (`finishSite`). The party's members who live move to it, its plan forgets the
 * party, and mother and daughter start at `NPC_FOUND_STANDING` toward each other. The daughter
 * then builds its storage, a farm and a house as its own projects (`nextProject`). Returns the
 * daughter, if founded now.
 */
export function foundDaughter(world: WorldState, city: City, plan: CityPlan): City | undefined {
  const party = foundingParty(plan)
  const site = plan.foundingSite
  if (party.length === 0 || !site || !hallStands(world, plan)) return undefined
  const hall = buildingAt(world, site.x, site.y)!
  const daughter = world.cities.find((c) => c.id === hall.cityId)
  if (!daughter || daughter.id === city.id || daughter.realmId !== null) return undefined
  const ids = new Set(party)
  for (const r of world.residents) {
    if (!ids.has(r.id) || r.cityId !== city.id || r.owner !== null || r.health <= 0) continue
    r.cityId = daughter.id
    // One gone back to the mother's storage for materials comes to the daughter instead: the hall
    // needs them no more, and that storage is no longer theirs to take from.
    if (r.script?.memory.fetch != null) stopWork(r)
  }
  for (const id of party) delete plan.jobs[id]
  delete plan.fullSince
  delete plan.foundingSite
  raiseStandingBothWays(world, city.id, daughter.id, NPC_FOUND_STANDING)
  return daughter
}

/**
 * Founding parties hold together (`CONTEXT.md`: Founding; ADR 0004): a plan with a party has its
 * site and at most `NPC_FOUND_PARTY_MOST` members; no resident is in two cities' parties; and a
 * member who lives and belongs to no realm belongs to the mother until the town hall stands.
 */
export const foundingPartiesSound: Invariant = {
  name: 'founding-parties-sound',
  check(world) {
    const out: InvariantViolation[] = []
    const residents = new Map(world.residents.map((r) => [r.id, r]))
    const seen = new Map<string, string>()
    for (const [cityId, plan] of Object.entries(world.cityPlans)) {
      const party = foundingParty(plan)
      if (party.length === 0) continue
      if (!plan.foundingSite || party.length > NPC_FOUND_PARTY_MOST) {
        out.push({
          invariant: this.name,
          message: `${cityId} has a party of ${party.length}${plan.foundingSite ? '' : ' and no site'}`,
          entityIds: [cityId],
        })
      }
      for (const id of party) {
        const other = seen.get(id)
        if (other !== undefined) {
          out.push({
            invariant: this.name,
            message: `${id} is in the founding parties of ${other} and ${cityId}`,
            entityIds: [id, other, cityId],
          })
        }
        seen.set(id, cityId)
        const r = residents.get(id)
        if (r && r.health > 0 && r.owner === null && r.cityId !== cityId) {
          out.push({
            invariant: this.name,
            message: `${id} of ${cityId}'s founding party belongs to ${r.cityId ?? 'no city'}`,
            entityIds: [id, cityId],
          })
        }
      }
    }
    return out
  },
}

/**
 * A city's dip below its reserve belongs to a wait under way (`CONTEXT.md`: Full city; ADR 0004): a
 * plan with `shortSince` has `fullSince`, no party out, and began no later than now.
 */
export const fullWaitSound: Invariant = {
  name: 'full-wait-sound',
  check(world) {
    const out: InvariantViolation[] = []
    for (const [cityId, plan] of Object.entries(world.cityPlans)) {
      if (plan.shortSince === undefined) continue
      const party = foundingParty(plan).length
      if (plan.fullSince !== undefined && party === 0 && plan.shortSince <= world.tick) continue
      out.push({
        invariant: this.name,
        message: `${cityId} has been short since ${plan.shortSince}, with ${plan.fullSince === undefined ? 'no wait under way' : `a party of ${party}`}`,
        entityIds: [cityId],
      })
    }
    return out
  },
}

/**
 * Every city of no realm, a daughter too, has its town hall (`CONTEXT.md`: Town hall, Founding;
 * ADR 0004): finished, and its own.
 */
export const npcCitiesHaveHalls: Invariant = {
  name: 'npc-cities-have-halls',
  check(world) {
    const out: InvariantViolation[] = []
    const buildings = new Map(world.buildings.map((b) => [b.id, b]))
    for (const city of world.cities) {
      if (city.realmId !== null) continue
      const hall = buildings.get(city.townHallId)
      if (hall && hall.kind === 'townHall' && !hall.site && hall.cityId === city.id) continue
      out.push({
        invariant: this.name,
        message: `${city.id}, a city of no realm, has no town hall of its own`,
        entityIds: [city.id],
      })
    }
    return out
  },
}
