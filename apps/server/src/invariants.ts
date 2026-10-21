import {
  isWallOrGate,
  wallStrength,
  ALLIANCE_LEAVE_DELAY,
  ALLIANCE_RECALL_DELAY,
  ALLIANCE_NAME_MAX_LENGTH,
  isAllianceCity,
  BUILDABLE,
  BUILD_MATERIALS,
  BUILD_WORK,
  CARRIAGE_CAPACITY,
  CRIME_MEMORY_DAYS,
  TICKS_PER_GAME_DAY,
  carriageCanEnter,
  drivenCarriageId,
  GOOD_WEIGHT,
  MAX_WORKERS,
  HOME_FOOD_LOW,
  MEAL_UNITS,
  unitsThatFit,
  NODE_WORKPLACE,
  PROCESSING,
  materialsNeeded,
  teardownWork,
  workNeeded,
  workplaceGood,
  hasChoice,
  type Good,
  LIFESPAN_MAX,
  LIFESPAN_MIN,
  MAX_HEALTH,
  ageInYears,
  canWork,
  MAX_HUNGER,
  STABLE_BREED_TICKS,
  KEEPS_GOODS,
  NODE_TERRAINS,
  REALM_LOG_LENGTH,
  ROAD_LINE_MAX_TILES,
  wrapDelta,
  Terrain,
  OFF_NODES,
  ON_PLAINS,
  captorOf,
  cityMembership,
  cityOrganization,
  computeTerritory,
  controlAt,
  controlSources,
  wrap,
  wrapDistance,
  isCityBuilding,
  STAT_NAMES,
  terrainAt,
  carryCapacity,
  stockWeight,
  trainedCap,
  type Stock,
  type TerrainMap,
  type Resident,
  type WorldState,
} from '@csp/shared'
import { tallyGoods } from './goods-made.js'
import { refillSource } from './survival.js'
import { NPC_ORDER_KINDS, runByNpcCity } from './npc-behaviour.js'
import { isWalkable } from './world.js'
import { contractsSound } from './contracts.js'
import { joinRequestsSound } from './persuasion.js'
import { formerPlayersSound, standingsSound } from './standing.js'
import { buyOrdersDone, cityPricesSound } from './buying.js'
import { refusedTradeNothing, tradeOrdersDone, tradesKeepGoods } from './trading.js'
import { armiesSound, supplyLinesSound } from './armies.js'
import { caravansSound, routeRobberiesSound } from './caravans.js'
import { deliveriesSound } from './deliveries.js'
import { transfersSound } from './transfers.js'
import { tradeOrgArmySound } from './trade-org-army.js'
import { buyOffOrdersDone, buyOffsSound, directivesSound } from './directives.js'
import { punishmentsSound } from './trade-org-punishment.js'
import { hqRingsSound } from './hq-growth.js'

/**
 * A rule the simulation must always keep (ADR 0004). A broken invariant does not crash
 * anything, so it is reported as an error instead.
 */
export interface Invariant {
  name: string
  check(world: WorldState, terrain: TerrainMap): InvariantViolation[]
}

export interface InvariantViolation {
  invariant: string
  message: string
  /** The entities involved, so the report points at them. */
  entityIds: string[]
}

/** Nothing stands on impassable terrain. */
export const nothingOnImpassableTerrain: Invariant = {
  name: 'nothing-on-impassable-terrain',
  check(world, terrain) {
    const things = [
      ...world.residents,
      ...world.horses,
      ...world.carriages,
      ...world.buildings,
      ...world.piles,
    ]
    return things
      .filter((t) => !isWalkable(terrain, t.x, t.y))
      .map((t) => ({
        invariant: this.name,
        message: `${t.id} stands on impassable terrain at (${t.x}, ${t.y})`,
        entityIds: [t.id],
      }))
  },
}

/**
 * Every position is stored as a tile on the map (0 ≤ x, y < size). Coordinates past a side
 * would still find terrain, as the sides join, but two names for one tile hide clashes.
 */
export const positionsOnMap: Invariant = {
  name: 'positions-on-map',
  check(world, terrain) {
    const on = (v: number) => Number.isInteger(v) && v >= 0 && v < terrain.size
    const things = [
      ...world.residents,
      ...world.horses,
      ...world.carriages,
      ...world.buildings,
      ...world.nodes,
      ...world.piles,
    ]
    return things
      .filter((t) => !on(t.x) || !on(t.y))
      .map((t) => ({
        invariant: this.name,
        message: `${t.id} is at (${t.x}, ${t.y}), off the map's tiles`,
        entityIds: [t.id],
      }))
  },
}

/** Every realm has a Player and a living Leader who belongs to it; one realm per Player. */
export const realmsHaveLeaders: Invariant = {
  name: 'realms-have-leaders',
  check(world) {
    const seen = new Set<number>()
    return world.realms.flatMap((realm) => {
      const leader = world.residents.find((r) => r.id === realm.leaderId)
      const problems: string[] = []
      if (!leader || leader.owner !== realm.id) problems.push(`has no Leader ${realm.leaderId}`)
      if (seen.has(realm.userId)) problems.push(`is a second realm of Player ${realm.userId}`)
      seen.add(realm.userId)
      return problems.map((p) => ({
        invariant: this.name,
        message: `realm ${realm.id} ${p}`,
        entityIds: [realm.id],
      }))
    })
  },
}

/**
 * Buildings and construction sites: one per tile, and next to it at most one road or road site,
 * on passable land off Mountain and of no city (`CONTEXT.md`: Road); farms and stables on Plains, mines, quarries
 * and lumber camps on a resource node of their kind and of no city; smelters, mints, town halls,
 * walls and gates off nodes and off Mountain, smelters and mints of no city; a stable, farm,
 * house or storage of no city or of one that exists; no stock below zero.
 */
export const buildingsInPlace: Invariant = {
  name: 'buildings-in-place',
  check(world, terrain) {
    const out: InvariantViolation[] = []
    const fail = (id: string, message: string) =>
      out.push({ invariant: this.name, message: `${id} ${message}`, entityIds: [id] })
    const cities = new Map(world.cities.map((c) => [c.id, c]))
    const tiles = new Set<string>()
    for (const b of world.buildings) {
      const key = `${b.x},${b.y}`
      const layer = b.kind === 'road' ? `road ${key}` : key
      if (tiles.has(layer))
        fail(b.id, `shares tile (${key}) with another ${b.kind === 'road' ? 'road' : 'building'}`)
      tiles.add(layer)
      if (b.kind === 'road') {
        if (terrainAt(terrain, b.x, b.y) === Terrain.Mountain) fail(b.id, 'is a road on Mountain')
        if (b.cityId !== null) fail(b.id, `is a road of city ${b.cityId}`)
        if (b.stock) fail(b.id, 'is a road with a stock')
      } else if (OFF_NODES.includes(b.kind)) {
        if (world.nodes.some((n) => n.x === b.x && n.y === b.y))
          fail(b.id, `is a ${b.kind} on a resource node`)
        if (terrainAt(terrain, b.x, b.y) === Terrain.Mountain)
          fail(b.id, `is a ${b.kind} on Mountain`)
        if (PROCESSING.includes(b.kind) && b.cityId !== null)
          fail(b.id, `is a ${b.kind} of city ${b.cityId}`)
      } else if (BUILDABLE.includes(b.kind) && !ON_PLAINS.includes(b.kind)) {
        const node = world.nodes.find((n) => n.x === b.x && n.y === b.y)
        if (!node || NODE_WORKPLACE[node.kind] !== b.kind) fail(b.id, `is a ${b.kind} off its node`)
        if (b.cityId !== null) fail(b.id, `is a ${b.kind} of city ${b.cityId}`)
      }
      if (b.cityId !== null && !cities.has(b.cityId)) fail(b.id, `belongs to no city (${b.cityId})`)
      if (
        (b.kind === 'farm' || b.kind === 'stable') &&
        terrainAt(terrain, b.x, b.y) !== Terrain.Plains
      ) {
        fail(b.id, `is a ${b.kind} off Plains`)
      }
      if (Object.values(b.stock ?? {}).some((kg) => kg < 0)) fail(b.id, 'has negative stock')
    }
    for (const k of world.carriages) {
      if (Object.values(k.load).some((kg) => kg < 0)) fail(k.id, 'has a negative load')
    }
    return out
  },
}

/**
 * Cities keep to `CONTEXT.md` (City, Town hall, City building): every city has exactly one town
 * hall, a finished one that belongs to it; every town hall makes a city; and every finished city
 * building belongs to the city its chain gives it (`cityMembership`), so the city area always
 * follows from the buildings.
 */
export const citiesFromBuildings: Invariant = {
  name: 'cities-from-buildings',
  check(world, terrain) {
    const out: InvariantViolation[] = []
    const fail = (id: string, message: string) =>
      out.push({ invariant: this.name, message: `${id} ${message}`, entityIds: [id] })
    const halls = new Map<string, string>()
    for (const c of world.cities) {
      const hall = world.buildings.find((b) => b.id === c.townHallId)
      if (!hall || hall.kind !== 'townHall' || hall.site) fail(c.id, 'has no town hall')
      else if (halls.has(hall.id)) fail(c.id, `shares town hall ${hall.id} with another city`)
      else halls.set(hall.id, c.id)
    }
    const members = cityMembership(world, terrain.size)
    for (const b of world.buildings) {
      if (b.kind === 'townHall' && !b.site && !halls.has(b.id)) fail(b.id, 'makes no city')
      if (!isCityBuilding(b)) continue
      const city = members.get(b.id) ?? null
      if (b.cityId !== city) fail(b.id, `belongs to city ${b.cityId}, but stands in ${city}`)
    }
    return out
  },
}

/** Every stat has a positive base and a trained bonus between 0 and its cap. */
export const trainedWithinCap: Invariant = {
  name: 'trained-within-cap',
  check(world) {
    return world.residents.flatMap((r) =>
      STAT_NAMES.filter((s) => {
        const { base, trained } = r.stats[s]
        return !(base > 0 && trained >= 0 && trained <= trainedCap(base))
      }).map((s) => ({
        invariant: this.name,
        message: `resident ${r.id} has ${s} ${r.stats[s].base} + ${r.stats[s].trained} trained (cap ${trainedCap(r.stats[s].base)})`,
        entityIds: [r.id],
      })),
    )
  },
}

/**
 * Health and the hunger meter stay within their ranges, for residents and horses alike.
 */
export const healthAndHungerInRange: Invariant = {
  name: 'health-and-hunger-in-range',
  check(world) {
    const living = [
      ...world.residents.map((r) => ({ what: 'resident', ...r })),
      ...world.horses.map((h) => ({ what: 'horse', ...h })),
    ]
    return living
      .filter(
        (t) =>
          !(t.health >= 0 && t.health <= MAX_HEALTH && t.hunger >= 0 && t.hunger <= MAX_HUNGER),
      )
      .map((t) => ({
        invariant: this.name,
        message: `${t.what} ${t.id} has health ${t.health} and hunger ${t.hunger}`,
        entityIds: [t.id],
      }))
  },
}

/**
 * Stables breed only while they make sense (`CONTEXT.md`: Stable): breeding progress is kept
 * only on stables, and stays between 0 and one foal's worth (`STABLE_BREED_TICKS`); a stable
 * reaching it has had its foal.
 */
export const stablesBreedInRange: Invariant = {
  name: 'stables-breed-in-range',
  check(world) {
    return world.buildings
      .filter(
        (b) =>
          b.breeding !== undefined &&
          !(b.kind === 'stable' && b.breeding >= 0 && b.breeding < STABLE_BREED_TICKS),
      )
      .map((b) => ({
        invariant: this.name,
        message: `${b.kind} ${b.id} has breeding ${b.breeding} of ${STABLE_BREED_TICKS}`,
        entityIds: [b.id],
      }))
  },
}

/**
 * Every resident has a lifespan in range and has not outlived it (`CONTEXT.md`: Aging), and
 * nobody is born after the current tick.
 */
export const agesInRange: Invariant = {
  name: 'ages-in-range',
  check(world) {
    return world.residents.flatMap((r) => {
      const age = ageInYears(r, world.tick)
      const problems: string[] = []
      if (!(r.lifespan >= LIFESPAN_MIN && r.lifespan <= LIFESPAN_MAX))
        problems.push(`has lifespan ${r.lifespan}`)
      if (age >= r.lifespan) problems.push(`is ${age} years old, past their lifespan ${r.lifespan}`)
      if (!(age >= 0)) problems.push(`is born after the current tick (${r.bornAt})`)
      return problems.map((p) => ({
        invariant: this.name,
        message: `resident ${r.id} ${p}`,
        entityIds: [r.id],
      }))
    })
  },
}

/** Every resource node lies on terrain that fits its kind. */
export const nodesOnFittingTerrain: Invariant = {
  name: 'nodes-on-fitting-terrain',
  check(world, terrain) {
    return world.nodes
      .filter((n) => !(NODE_TERRAINS[n.kind] as number[]).includes(terrainAt(terrain, n.x, n.y)))
      .map((n) => ({
        invariant: this.name,
        message: `${n.kind} node ${n.id} lies on unfitting terrain at (${n.x}, ${n.y})`,
        entityIds: [n.id],
      }))
  },
}

/** Nobody carries more than their carry capacity (`CONTEXT.md`: Carry capacity). */
export const carriedWithinCapacity: Invariant = {
  name: 'carried-within-capacity',
  check(world) {
    return world.residents
      .filter((r) => stockWeight(r.carried) > carryCapacity(r, world.tick) + 1e-9)
      .map((r) => ({
        invariant: this.name,
        message: `resident ${r.id} carries ${stockWeight(r.carried)} kg of ${carryCapacity(r, world.tick)} kg`,
        entityIds: [r.id],
      }))
  },
}

/**
 * Goods are never negative wherever they are, only storages and stables among buildings hold any,
 * and a pile is never empty; one pile per tile.
 */
export const goodsInPlace: Invariant = {
  name: 'goods-in-place',
  check(world) {
    const out: InvariantViolation[] = []
    const fail = (id: string, message: string) =>
      out.push({ invariant: this.name, message: `${id} ${message}`, entityIds: [id] })
    const negative = (stock: Stock) => Object.values(stock).some((n) => !(n >= 0))
    for (const r of world.residents) if (negative(r.carried)) fail(r.id, 'carries negative goods')
    for (const b of world.buildings) {
      const holds = Object.values(b.stock ?? {}).some((n) => n > 0)
      if (holds && (!KEEPS_GOODS.includes(b.kind) || b.site))
        fail(b.id, `is a ${b.kind} holding goods`)
      if (b.site && negative(b.site.delivered)) fail(b.id, 'has negative materials delivered')
    }
    const tiles = new Set<string>()
    for (const p of world.piles) {
      if (negative(p.goods)) fail(p.id, 'holds negative goods')
      if (!Object.values(p.goods).some((n) => n > 0)) fail(p.id, 'is an empty pile')
      const key = `${p.x},${p.y}`
      if (tiles.has(key)) fail(p.id, `is a second pile on tile (${key})`)
      tiles.add(key)
    }
    return out
  },
}

/**
 * Goods are counted in whole units wherever they are (`Good`); spoilage and eating never leave
 * part of a unit behind.
 */
export const goodsInWholeUnits: Invariant = {
  name: 'goods-in-whole-units',
  check(world) {
    const holders: [string, Stock | undefined][] = [
      ...world.residents.map((r): [string, Stock] => [r.id, r.carried]),
      ...world.buildings.map((b): [string, Stock | undefined] => [b.id, b.stock]),
      ...world.buildings
        .filter((b) => b.site)
        .map((b): [string, Stock] => [b.id, b.site!.delivered]),
      ...world.carriages.map((k): [string, Stock] => [k.id, k.load]),
      ...world.piles.map((p): [string, Stock] => [p.id, p.goods]),
    ]
    return holders
      .filter(([, stock]) => Object.values(stock ?? {}).some((n) => !Number.isInteger(n)))
      .map(([id, stock]) => ({
        invariant: this.name,
        message: `${id} holds part of a unit: ${JSON.stringify(stock)}`,
        entityIds: [id],
      }))
  },
}

/**
 * Pick-up and drop orders are done within the tick they start (`resolveCarrying`), so after a
 * tick no resident still holds one.
 */
export const carryOrdersDone: Invariant = {
  name: 'carry-orders-done',
  check(world) {
    return world.residents
      .filter((r) => r.order?.kind === 'pickUp' || r.order?.kind === 'drop')
      .map((r) => ({
        invariant: this.name,
        message: `resident ${r.id} still holds a ${r.order!.kind} order after the tick`,
        entityIds: [r.id],
      }))
  },
}

/**
 * A construction site never holds more materials than its building needs, nor goods it doesn't
 * need, and its work stays between 0 and what the building needs (`BUILD_WORK`). A site that has
 * everything has become its building.
 */
export const sitesWithinNeeds: Invariant = {
  name: 'sites-within-needs',
  check(world) {
    const out: InvariantViolation[] = []
    const fail = (id: string, message: string) =>
      out.push({ invariant: this.name, message: `${id} ${message}`, entityIds: [id] })
    for (const b of world.buildings) {
      if (!b.site) continue
      const needs = BUILD_MATERIALS[b.kind] ?? {}
      for (const [good, units] of Object.entries(b.site.delivered) as [Good, number][]) {
        if (units > (needs[good] ?? 0))
          fail(b.id, `holds ${units} ${good}, needs ${needs[good] ?? 0}`)
      }
      const work = BUILD_WORK[b.kind] ?? 0
      if (!(b.site.work >= 0 && b.site.work <= work))
        fail(b.id, `has work ${b.site.work} of ${work}`)
      if (workNeeded(b) === 0 && Object.keys(materialsNeeded(b)).length === 0) {
        fail(b.id, 'has all its materials and work but is still a site')
      }
    }
    return out
  },
}

/**
 * After a tick, a resident with a build order on a site stands on that site, and it is still a
 * site (`resolveBuilding` ends the orders of a finished or vanished one).
 */
export const buildOrdersOnSites: Invariant = {
  name: 'build-orders-on-sites',
  check(world) {
    return world.residents.flatMap((r) => {
      const o = r.order
      if (o?.kind !== 'build' || o.siteId === null) return []
      const site = world.buildings.find((b) => b.id === o.siteId)
      if (site?.site && site.x === r.x && site.y === r.y) return []
      return [
        {
          invariant: this.name,
          message: `resident ${r.id} builds ${o.siteId}, which is not a site on their tile`,
          entityIds: [r.id, o.siteId],
        },
      ]
    })
  },
}

/**
 * Tearing down (`CONTEXT.md`: Tearing down): only what can be built is ever being torn down, and
 * its tear-down work stays between 0 and what it needs (`teardownWork`); one that has all its
 * work in is gone.
 */
export const teardownsWithinNeeds: Invariant = {
  name: 'teardowns-within-needs',
  check(world) {
    const out: InvariantViolation[] = []
    const fail = (id: string, message: string) =>
      out.push({ invariant: this.name, message: `${id} ${message}`, entityIds: [id] })
    for (const b of world.buildings) {
      if (b.teardown === undefined) continue
      if (!BUILDABLE.includes(b.kind)) fail(b.id, `is a ${b.kind} being torn down`)
      const work = teardownWork(b)
      if (!(b.teardown >= 0 && b.teardown < work)) {
        fail(b.id, `has tear-down work ${b.teardown} of ${work}`)
      }
    }
    return out
  },
}

/**
 * After a tick, a resident with a tear-down order stands on that building or site, and it is
 * still there (`resolveTearingDown` ends the orders on one that is gone).
 */
export const tearDownOrdersOnBuildings: Invariant = {
  name: 'tear-down-orders-on-buildings',
  check(world) {
    return world.residents.flatMap((r) => {
      const o = r.order
      if (o?.kind !== 'tearDown') return []
      const b = world.buildings.find((x) => x.id === o.buildingId)
      if (b && b.x === r.x && b.y === r.y) return []
      return [
        {
          invariant: this.name,
          message: `resident ${r.id} tears down ${o.buildingId}, which is not on their tile`,
          entityIds: [r.id, o.buildingId],
        },
      ]
    })
  },
}

/**
 * Realm logs stay in order and in bounds: events are numbered in the order they happened, below
 * the next id and not after the current tick, and no Player keeps more than `REALM_LOG_LENGTH`.
 */
export const realmLogsInOrder: Invariant = {
  name: 'realm-logs-in-order',
  check(world) {
    const out: InvariantViolation[] = []
    const fail = (message: string) => out.push({ invariant: this.name, message, entityIds: [] })
    const kept = new Map<number, number>()
    let last = -Infinity
    for (const e of world.events) {
      if (!(e.seq > last)) fail(`event ${e.seq} is logged after event ${last}`)
      if (e.seq >= world.nextId) fail(`event ${e.seq} is numbered past next id ${world.nextId}`)
      if (e.tick > world.tick) fail(`event ${e.seq} happened at tick ${e.tick}, after now`)
      last = e.seq
      kept.set(e.userId, (kept.get(e.userId) ?? 0) + 1)
    }
    for (const [userId, n] of kept) {
      if (n > REALM_LOG_LENGTH) fail(`Player ${userId} keeps ${n} events, over ${REALM_LOG_LENGTH}`)
    }
    return out
  },
}

/**
 * After a tick, a resident with a work-at order stands on the finished workplace it names, says
 * what they make exactly where there is a choice (a smithy) and makes something there, their
 * share of the next unit is between 0 and 1, and no workplace has more workers than it takes
 * (`resolveWork` ends the orders that no longer fit).
 */
export const workOrdersOnWorkplaces: Invariant = {
  name: 'work-orders-on-workplaces',
  check(world) {
    const out: InvariantViolation[] = []
    const workers = new Map<string, number>()
    for (const r of world.residents) {
      const o = r.order
      if (o?.kind !== 'workAt') continue
      const fail = (message: string) =>
        out.push({
          invariant: this.name,
          message: `resident ${r.id} works ${o.buildingId}, ${message}`,
          entityIds: [r.id, o.buildingId],
        })
      const place = world.buildings.find((b) => b.id === o.buildingId)
      if (!place || place.site || MAX_WORKERS[place.kind] === undefined)
        fail('which is no finished workplace')
      else if (hasChoice(place.kind) !== (o.makes !== undefined))
        fail(o.makes === undefined ? 'making nothing' : `making ${o.makes} with nothing to choose`)
      else if (!workplaceGood(world, place, o.makes))
        fail(o.makes === undefined ? 'which makes nothing' : `which can't make ${o.makes}`)
      else if (place.x !== r.x || place.y !== r.y || o.at.x !== r.x || o.at.y !== r.y)
        fail('which is not on their tile')
      if (!(o.progress >= 0 && o.progress < 1)) fail(`with progress ${o.progress}`)
      workers.set(o.buildingId, (workers.get(o.buildingId) ?? 0) + 1)
    }
    for (const [id, n] of workers) {
      const place = world.buildings.find((b) => b.id === id)
      const max = place ? MAX_WORKERS[place.kind] : undefined
      if (max !== undefined && n > max) {
        out.push({
          invariant: this.name,
          message: `${id} has ${n} workers, over ${max}`,
          entityIds: [id],
        })
      }
    }
    return out
  },
}

/**
 * After a tick, nobody at home, at their workplace or in an army by a carriage runs low on food
 * while the storage, pile or carriage they refill from still has some and a meal would fit
 * (`stepRefill`, `CONTEXT.md`: Refilling at home, Refilling at a workplace, Refilling from a
 * carriage).
 */
export const refilledWhenLow: Invariant = {
  name: 'refilled-when-low',
  check(world, terrain) {
    return world.residents
      .filter(
        (r) =>
          (r.carried.food ?? 0) < HOME_FOOD_LOW &&
          (refillSource(world, r, terrain.size)?.food ?? 0) > 0 &&
          unitsThatFit(r, 'food', world.tick) >= MEAL_UNITS,
      )
      .map((r) => ({
        invariant: this.name,
        message: `resident ${r.id} runs low with ${r.carried.food ?? 0} food where there is more`,
        entityIds: [r.id],
      }))
  },
}

/**
 * Carriages keep to the rules of `CONTEXT.md` (Carriage): never in the mountains, never loaded
 * past `CARRIAGE_CAPACITY`, and a hitched horse exists, stands with its carriage and pulls no
 * other one.
 */
export const carriagesInPlace: Invariant = {
  name: 'carriages-in-place',
  check(world, terrain) {
    const out: InvariantViolation[] = []
    const fail = (id: string, message: string, ids = [id]) =>
      out.push({ invariant: this.name, message: `carriage ${id} ${message}`, entityIds: ids })
    const pulling = new Map<string, string>()
    for (const k of world.carriages) {
      if (!carriageCanEnter(terrainAt(terrain, k.x, k.y))) {
        fail(k.id, `stands where no carriage can go at (${k.x}, ${k.y})`)
      }
      const kg = stockWeight(k.load)
      if (kg > CARRIAGE_CAPACITY + 1e-9) fail(k.id, `holds ${kg} kg of ${CARRIAGE_CAPACITY} kg`)
      if (k.horseId === null) continue
      const horse = world.horses.find((h) => h.id === k.horseId)
      if (!horse) fail(k.id, `is hitched to ${k.horseId}, which doesn't exist`)
      else if (horse.x !== k.x || horse.y !== k.y) {
        fail(k.id, `is at (${k.x}, ${k.y}) but its horse at (${horse.x}, ${horse.y})`, [
          k.id,
          horse.id,
        ])
      }
      const other = pulling.get(k.horseId)
      if (other) fail(k.id, `shares horse ${k.horseId} with ${other}`, [k.id, other, k.horseId])
      pulling.set(k.horseId, k.id)
    }
    return out
  },
}

/**
 * After a tick, a driver stands on the carriage they drive, which exists, and is grown up; no
 * carriage has two drivers (`CONTEXT.md`: Carriage, `Walking.resolve` moves them together).
 */
export const driversOnCarriages: Invariant = {
  name: 'drivers-on-carriages',
  check(world) {
    const out: InvariantViolation[] = []
    const driven = new Map<string, string>()
    for (const r of world.residents) {
      const id = drivenCarriageId(r)
      if (!id) continue
      const fail = (message: string) =>
        out.push({
          invariant: this.name,
          message: `resident ${r.id} ${message}`,
          entityIds: [r.id, id],
        })
      const k = world.carriages.find((c) => c.id === id)
      if (!k) fail(`drives ${id}, which doesn't exist`)
      else if (k.x !== r.x || k.y !== r.y) fail(`drives ${k.id} but isn't on its tile`)
      if (!canWork(r, world.tick)) fail('drives as a child')
      const other = driven.get(id)
      if (other) fail(`drives ${id} together with ${other}`)
      driven.set(id, r.id)
    }
    return out
  },
}

/**
 * Haul routes stay sound (`CONTEXT.md`: Haul route): two different stops a carriage can reach,
 * at least one good and none hauled both ways, the Food kept for the horse fits on the carriage,
 * and a hauler loading or unloading stands at the stop they are at, holding goods for the route
 * only while loading. A route to an army (`CONTEXT.md`: Supply line) brings nothing back, and its
 * hauler never holds goods for it there.
 */
export const haulRoutesSound: Invariant = {
  name: 'haul-routes-sound',
  check(world, terrain) {
    const out: InvariantViolation[] = []
    for (const r of world.residents) {
      const o = r.order
      if (o?.kind !== 'haul') continue
      const fail = (message: string) =>
        out.push({
          invariant: this.name,
          message: `resident ${r.id} ${message}`,
          entityIds: [r.id, o.carriageId],
        })
      const { from, to } = o
      // An army stop is wherever the army is (`CONTEXT.md`: Supply line).
      const toArmy = o.toArmy !== undefined
      if (!toArmy && from.x === to.x && from.y === to.y) fail('hauls between one tile and itself')
      for (const s of toArmy ? [from] : [from, to]) {
        if (!carriageCanEnter(terrainAt(terrain, s.x, s.y))) {
          fail(`hauls to (${s.x}, ${s.y}), where no carriage can go`)
        }
      }
      if (o.goods.length === 0) fail('hauls no goods')
      const both = o.returnGoods.filter((g) => o.goods.includes(g))
      if (both.length > 0) fail(`hauls ${both.join(', ')} both ways`)
      if (toArmy && o.returnGoods.length > 0) fail('hauls goods back from an army')
      if (o.keepFood < 0 || o.keepFood * GOOD_WEIGHT.food > CARRIAGE_CAPACITY) {
        fail(`keeps ${o.keepFood} Food for the horse`)
      }
      const stop = o[o.stop]
      const withArmy = toArmy && o.stop === 'to'
      if (withArmy && o.moving) fail('holds goods for the route at an army')
      if (o.phase === 'loading' && !withArmy && (r.x !== stop.x || r.y !== stop.y)) {
        fail(`loads at the ${o.stop} stop but stands at (${r.x}, ${r.y})`)
      }
      if (o.phase === 'driving' && o.moving) fail('holds goods for the route while driving')
    }
    return out
  },
}

/**
 * Territory is derived soundly (`CONTEXT.md`: Territory): every tile in it belongs to an
 * Organization that exists (a realm, or a city of no realm) and lies within reach of one of that
 * Organization's cities or guarded workplaces, and no other Organization projects as much
 * control onto it.
 */
export const territorySound: Invariant = {
  name: 'territory-sound',
  check(world, terrain) {
    const out: InvariantViolation[] = []
    const size = terrain.size
    const organizations = new Set([
      ...world.realms.map((r) => r.id),
      ...world.cities.filter((c) => c.realmId === null).map(cityOrganization),
    ])
    // Each Organization's control on every tile it reaches, worked out apart from the territory.
    const controlByTile = new Map<string, Map<string, number>>()
    for (const s of controlSources(world, size)) {
      for (const t of s.tiles) {
        for (let dy = -s.reach; dy <= s.reach; dy++) {
          for (let dx = -s.reach; dx <= s.reach; dx++) {
            const at = { x: wrap(t.x + dx, size), y: wrap(t.y + dy, size) }
            const c = controlAt(s, wrapDistance(size, t, at))
            if (c <= 0) continue
            const key = `${at.x},${at.y}`
            const here = controlByTile.get(key) ?? new Map<string, number>()
            controlByTile.set(key, here)
            if (c > (here.get(s.owner) ?? 0)) here.set(s.owner, c)
          }
        }
      }
    }
    for (const [key, owner] of computeTerritory(world, size).owners) {
      const fail = (message: string) =>
        out.push({ invariant: this.name, message: `tile (${key}) ${message}`, entityIds: [owner] })
      if (!organizations.has(owner)) fail(`belongs to ${owner}, which is no Organization`)
      const control = controlByTile.get(key) ?? new Map<string, number>()
      const own = control.get(owner) ?? 0
      if (own <= 0) fail(`belongs to ${owner}, which projects no control there`)
      for (const [other, c] of control) {
        if (other !== owner && c >= own)
          fail(`belongs to ${owner}, but ${other} is as strong there`)
      }
    }
    return out
  },
}
/** Every resident lives in a city that exists, or in none. */
export const residentsInCities: Invariant = {
  name: 'residents-in-cities',
  check(world) {
    const cities = new Set(world.cities.map((c) => c.id))
    return world.residents
      .filter((r) => r.cityId !== null && !cities.has(r.cityId))
      .map((r) => ({
        invariant: this.name,
        message: `resident ${r.id} lives in city ${r.cityId}, which doesn't exist`,
        entityIds: [r.id],
      }))
  },
}

/**
 * An NPC city's residents belong to no realm (`CONTEXT.md`: NPC city): the game runs the city
 * and everyone in it, so none of them answers to a Player.
 */
export const npcCityResidentsUnowned: Invariant = {
  name: 'npc-city-residents-unowned',
  check(world) {
    const npc = new Set(world.cities.filter((c) => c.realmId === null).map((c) => c.id))
    return world.residents
      .filter((r) => r.cityId !== null && npc.has(r.cityId) && r.owner !== null)
      .map((r) => ({
        invariant: this.name,
        message: `resident ${r.id} of NPC city ${r.cityId} belongs to realm ${r.owner}`,
        entityIds: [r.id],
      }))
  },
}

/**
 * Everything belongs to a realm that exists, an NPC city that exists, or nobody (`CONTEXT.md`:
 * Leader death, Self-managed city): once a Leader has died, nothing belongs to their ended realm.
 * A horse or carriage of an NPC city belongs to no realm.
 */
export const ownersExist: Invariant = {
  name: 'owners-exist',
  check(world) {
    const realms = new Set(world.realms.map((r) => r.id))
    const npc = new Set(world.cities.filter((c) => c.realmId === null).map((c) => c.id))
    const out: InvariantViolation[] = []
    const problem = (id: string, message: string) =>
      out.push({ invariant: this.name, message: `${id} ${message}`, entityIds: [id] })
    for (const r of world.residents) {
      if (r.owner !== null && !realms.has(r.owner))
        problem(r.id, `belongs to ended realm ${r.owner}`)
    }
    for (const c of world.cities) {
      if (c.realmId !== null && !realms.has(c.realmId)) {
        problem(c.id, `belongs to ended realm ${c.realmId}`)
      }
    }
    for (const k of [...world.horses, ...world.carriages]) {
      if (k.realmId !== null && !realms.has(k.realmId)) {
        problem(k.id, `belongs to ended realm ${k.realmId}`)
      }
      if (k.cityId !== null && (k.realmId !== null || !npc.has(k.cityId))) {
        problem(k.id, `belongs to ${k.cityId}, which is no NPC city it can belong to`)
      }
    }
    return out
  },
}

/**
 * A realm's city's residents belong to that realm (`CONTEXT.md`: Capturing a city): a city
 * changes realm together with everyone who lives there.
 */
export const cityResidentsInItsRealm: Invariant = {
  name: 'city-residents-in-its-realm',
  check(world) {
    const realmOf = new Map(world.cities.map((c) => [c.id, c.realmId]))
    return world.residents.flatMap((r) => {
      const realm = r.cityId === null ? null : realmOf.get(r.cityId)
      if (realm === null || realm === undefined || r.owner === realm) return []
      return [
        {
          invariant: this.name,
          message: `resident ${r.id} of city ${r.cityId} (realm ${realm}) belongs to ${r.owner ?? 'no realm'}`,
          entityIds: [r.id, r.cityId!],
        },
      ]
    })
  },
}

/**
 * After a tick, no city is left standing taken (`CONTEXT.md`: Capturing a city): a city with
 * armed residents of one other realm inside and no defender left has changed realm already.
 */
export const takenCitiesCaptured: Invariant = {
  name: 'taken-cities-captured',
  check(world, terrain) {
    return world.cities.flatMap((c) => {
      const captor = captorOf(world, c, terrain.size)
      if (captor === null || captor === c.realmId) return []
      return [
        {
          invariant: this.name,
          message: `city ${c.id} of ${c.realmId ?? 'no realm'} is taken by ${captor} but hasn't changed realm`,
          entityIds: [c.id],
        },
      ]
    })
  },
}

/**
 * A city's own workplaces (`City.workplaceIds`), those an NPC city or the Trade Organization
 * built for the goods it needs (`CONTEXT.md`: NPC city, Trade Org HQ), are workplaces other than
 * farms (a farm is its city's by `cityId`), which belong to no city: whoever works one holds it.
 * Ids of ones that are gone are skipped.
 */
export const cityWorkplacesSound: Invariant = {
  name: 'city-workplaces-sound',
  check(world) {
    const out: InvariantViolation[] = []
    const byId = new Map(world.buildings.map((b) => [b.id, b]))
    for (const c of world.cities) {
      for (const id of c.workplaceIds ?? []) {
        const b = byId.get(id)
        if (!b) continue
        if (MAX_WORKERS[b.kind] === undefined || b.kind === 'farm' || b.cityId !== null) {
          out.push({
            invariant: this.name,
            message: `${c.id} works ${b.id}, a ${b.kind} of city ${b.cityId}`,
            entityIds: [c.id, b.id],
          })
        }
      }
    }
    return out
  },
}

/**
 * An NPC city does nothing a Player's residents couldn't (`CONTEXT.md`: NPC city; ADR 0002): its
 * residents hold only the kinds of order a Player can give (`NPC_ORDER_KINDS`), which the world
 * checks and resolves like anyone's. A caravan's driver also drives (`CONTEXT.md`: Caravan).
 */
export const npcOrdersAllowed: Invariant = {
  name: 'npc-orders-allowed',
  check(world) {
    const drivers = new Set(world.caravans.map((c) => c.driverId))
    const allowed = (r: Resident) =>
      NPC_ORDER_KINDS.includes(r.order!.kind) || (r.order!.kind === 'drive' && drivers.has(r.id))
    return world.residents
      .filter((r) => r.order !== null && runByNpcCity(world, r) && !allowed(r))
      .map((r) => ({
        invariant: this.name,
        message: `NPC resident ${r.id} holds a ${r.order!.kind} order`,
        entityIds: [r.id],
      }))
  },
}

/**
 * An NPC city fights only outsiders (`CONTEXT.md`: NPC city, Combat): none of its residents goes
 * after another of its residents.
 */
export const npcFightsOutsiders: Invariant = {
  name: 'npc-fights-outsiders',
  check(world) {
    const byId = new Map(world.residents.map((r) => [r.id, r]))
    return world.residents
      .filter((r) => {
        const o = r.order
        if (o?.kind !== 'attack' || !runByNpcCity(world, r)) return false
        const t = byId.get(o.targetId)
        return !!t && t.owner === null && t.cityId === r.cityId
      })
      .map((r) => ({
        invariant: this.name,
        message: `NPC resident ${r.id} attacks someone of their own city`,
        entityIds: [r.id],
      }))
  },
}

/**
 * After a tick, pairs hold together (`CONTEXT.md`: Pairing): a resident's partner pairs back
 * with the same `since`, which is not after now; both are adults of the same city. Broken pairs
 * end in `requestBirths`.
 */
export const pairsHoldTogether: Invariant = {
  name: 'pairs-hold-together',
  check(world) {
    const byId = new Map(world.residents.map((r) => [r.id, r]))
    return world.residents.flatMap((r) => {
      const o = r.order
      if (o?.kind !== 'pair') return []
      const partner = byId.get(o.partnerId)
      const back = partner?.order
      const problems: string[] = []
      if (!partner || back?.kind !== 'pair' || back.partnerId !== r.id) {
        problems.push(`pairs with ${o.partnerId}, who doesn't pair back`)
      } else {
        if (back.since !== o.since)
          problems.push(`pairs since ${o.since}, ${partner.id} since ${back.since}`)
        if (partner.cityId !== r.cityId) problems.push(`pairs with ${partner.id} of another city`)
        if (partner === r) problems.push('pairs with themselves')
      }
      if (r.cityId === null) problems.push('pairs but lives in no city')
      if (!canWork(r, world.tick)) problems.push('pairs as a child')
      if (o.since > world.tick) problems.push(`pairs since ${o.since}, after now`)
      return problems.map((p) => ({
        invariant: this.name,
        message: `resident ${r.id} ${p}`,
        entityIds: [r.id, o.partnerId],
      }))
    })
  },
}

/** Orders only a grown resident can hold (`CONTEXT.md`: Child); pairing is checked with pairs. */
const ADULT_ORDERS = new Set(['build', 'roadLine', 'tearDown', 'workAt', 'drive', 'pickUp', 'drop'])

/** Children don't work until they are grown (`CONTEXT.md`: Child, Aging). */
export const childrenDontWork: Invariant = {
  name: 'children-dont-work',
  check(world) {
    return world.residents
      .filter((r) => r.order && ADULT_ORDERS.has(r.order.kind) && !canWork(r, world.tick))
      .map((r) => ({
        invariant: this.name,
        message: `resident ${r.id} holds a ${r.order!.kind} order as a child`,
        entityIds: [r.id],
      }))
  },
}

/**
 * Dead residents leave their goods as loot (`CONTEXT.md`: Loot): a resident with no health left
 * is gone from the world by the end of the tick, killed, starved or not, so nobody keeps holding
 * goods once dead. Dying (`die`) is the only way out, and it drops all they carried in the pile
 * on their tile.
 */
export const deadLeaveLoot: Invariant = {
  name: 'dead-leave-loot',
  check(world) {
    return world.residents
      .filter((r) => !(r.health > 0))
      .map((r) => ({
        invariant: this.name,
        message: `resident ${r.id} has no health left but is still in the world, holding ${JSON.stringify(r.carried)}`,
        entityIds: [r.id],
      }))
  },
}

/**
 * Attack orders are sound (`CONTEXT.md`: Combat): nobody attacks themselves, and a blow is
 * always between 0 and 1 of the way to being struck.
 */
export const attackOrdersSound: Invariant = {
  name: 'attack-orders-sound',
  check(world) {
    const out: InvariantViolation[] = []
    for (const r of world.residents) {
      const o = r.order
      if (o?.kind !== 'attack') continue
      const problem =
        o.targetId === r.id
          ? 'attacks themselves'
          : !(o.strike >= 0 && o.strike < 1)
            ? `is ${o.strike} of the way to a blow`
            : undefined
      if (problem)
        out.push({
          invariant: this.name,
          message: `resident ${r.id} ${problem}`,
          entityIds: [r.id],
        })
    }
    return out
  },
}

/**
 * Alliances hold together (`CONTEXT.md`: Alliance, Alliance leader, NPC city in an alliance):
 * each has a name and at least one member, in the order they joined; its members are realms or
 * NPC cities (never the Trade Organization's) and its invited realms exist; a member is in at
 * most one alliance, and only a realm in none is invited; the alliance leader is a realm and a
 * member; a
 * member leaving goes within the leave delay; each soldier and carriage of its army (`CONTEXT.md`:
 * Alliance army) exists, belongs to a member, is in no other alliance army and, when recalled,
 * comes back within the recall delay.
 */
export const alliancesSound: Invariant = {
  name: 'alliances-sound',
  check(world) {
    const realms = new Set(world.realms.map((r) => r.id))
    const memberOf = new Map<string, string>()
    for (const a of world.alliances) {
      for (const m of a.members) memberOf.set(m.realmId, memberOf.has(m.realmId) ? '' : a.id)
    }
    const handedOver = new Map<string, string>()
    for (const a of world.alliances) {
      for (const p of a.army) handedOver.set(p.id, handedOver.has(p.id) ? '' : a.id)
    }
    return world.alliances.flatMap((a) => {
      const problems: string[] = []
      if (a.name.trim().length === 0 || a.name.length > ALLIANCE_NAME_MAX_LENGTH) {
        problems.push(`has a bad name "${a.name}"`)
      }
      if (a.members.length === 0) problems.push('has no members')
      if (!a.members.some((m) => m.realmId === a.leaderId)) {
        problems.push(`has leader ${a.leaderId}, who is not a member`)
      }
      if (!realms.has(a.leaderId)) problems.push(`has leader ${a.leaderId}, which is no realm`)
      a.members.forEach((m, i) => {
        if (!realms.has(m.realmId) && !isAllianceCity(world, m.realmId)) {
          problems.push(`has member ${m.realmId}, which is no realm or NPC city`)
        }
        if (memberOf.get(m.realmId) === '') problems.push(`shares member ${m.realmId}`)
        if (i > 0 && m.joinedAt < a.members[i - 1]!.joinedAt) {
          problems.push(`lists member ${m.realmId} before one that joined earlier`)
        }
        const at = m.leaving?.at
        if (at !== undefined && (at <= world.tick || at > world.tick + ALLIANCE_LEAVE_DELAY)) {
          problems.push(`has member ${m.realmId} leaving at tick ${at}`)
        }
      })
      if (new Set(a.invites).size !== a.invites.length) problems.push('invites a realm twice')
      for (const id of a.invites) {
        if (!realms.has(id)) problems.push(`invites ${id}, which has ended`)
        else if (memberOf.has(id)) problems.push(`invites ${id}, which is in an alliance`)
      }
      const members = new Set(a.members.map((m) => m.realmId))
      for (const p of a.army) {
        const owner =
          p.is === 'resident'
            ? world.residents.find((r) => r.id === p.id)?.owner
            : world.carriages.find((k) => k.id === p.id)?.realmId
        if (owner === undefined) problems.push(`has ${p.is} ${p.id} in its army, which is gone`)
        else if (!members.has(owner ?? '')) {
          problems.push(`has ${p.is} ${p.id} in its army, which is no member's`)
        }
        if (handedOver.get(p.id) !== a.id) problems.push(`shares ${p.is} ${p.id} in its army`)
        const at = p.recallAt
        if (at !== null && (at <= world.tick || at > world.tick + ALLIANCE_RECALL_DELAY)) {
          problems.push(`has ${p.is} ${p.id} in its army recalled at tick ${at}`)
        }
      }
      return problems.map((p) => ({
        invariant: this.name,
        message: `alliance ${a.id} ${p}`,
        entityIds: [a.id],
      }))
    })
  },
}

/**
 * Crimes hold together (`CONTEXT.md`: Crime, Witness): each is against another Organization than
 * the culprit's and happened no later than now; its witnesses are living residents, each listed
 * once, none of the culprit's Organization; it is known to each Organization at most once; and
 * it is kept only while someone carries news of it or an Organization remembers it.
 */
export const crimesSound: Invariant = {
  name: 'crimes-sound',
  check(world) {
    const alive = new Map(world.residents.map((r) => [r.id, r]))
    const memory = CRIME_MEMORY_DAYS * TICKS_PER_GAME_DAY
    return (world.crimes ?? []).flatMap((c) => {
      const problems: string[] = []
      if (c.culprit.org === c.victimOrg) problems.push('is against its culprit’s own Organization')
      if (c.tick > world.tick) problems.push(`happens later, at tick ${c.tick}`)
      if (new Set(c.witnesses).size !== c.witnesses.length) problems.push('lists a witness twice')
      for (const id of c.witnesses) {
        const w = alive.get(id)
        if (!w) problems.push(`has witness ${id}, who is gone`)
        else if ((w.owner ?? w.cityId) === c.culprit.org) {
          problems.push(`has witness ${id} of the culprit’s Organization`)
        }
      }
      if (new Set(c.knownBy).size !== c.knownBy.length) problems.push('is known twice to one')
      const remembered = c.knownBy.length > 0 && world.tick - c.tick <= memory
      if (c.witnesses.length === 0 && !remembered) problems.push('is kept though forgotten')
      return problems.map((p) => ({
        invariant: this.name,
        message: `crime ${c.id} ${p}`,
        entityIds: [c.id],
      }))
    })
  },
}

/**
 * Only gates close (`CONTEXT.md`: Walls in combat): a building marked closed is a finished gate,
 * and a gate is either closed or open, nothing else.
 */
export const gatesSound: Invariant = {
  name: 'gates-sound',
  check(world) {
    return world.buildings
      .filter((b) => b.closed !== undefined && (b.kind !== 'gate' || b.site || b.closed !== true))
      .map((b) => ({
        invariant: this.name,
        message: `${b.site ? 'site of a ' : ''}${b.kind} ${b.id} is marked closed: ${String(b.closed)}`,
        entityIds: [b.id],
      }))
  },
}

/**
 * Broken walls are sound (`CONTEXT.md`: Walls in combat): only a finished wall or gate takes
 * damage, and it stands only while its damage is short of its `wallStrength`.
 */
export const wallDamageSound: Invariant = {
  name: 'wall-damage-sound',
  check(world) {
    return world.buildings
      .filter(
        (b) =>
          b.damage !== undefined &&
          (!isWallOrGate(b) || !(b.damage >= 0 && b.damage < wallStrength(b))),
      )
      .map((b) => ({
        invariant: this.name,
        message: `${b.site ? 'site of a ' : ''}${b.kind} ${b.id} stands with damage ${b.damage}`,
        entityIds: [b.id],
      }))
  },
}

/**
 * Climb orders are sound (`CONTEXT.md`: Walls in combat): the climber stands where they started
 * climbing, and is between 0 and 1 of the way over.
 */
export const climbOrdersSound: Invariant = {
  name: 'climb-orders-sound',
  check(world) {
    const out: InvariantViolation[] = []
    for (const r of world.residents) {
      const o = r.order
      if (o?.kind !== 'climb') continue
      const problem =
        r.x !== o.at.x || r.y !== o.at.y
          ? `climbs from (${o.at.x}, ${o.at.y}) but stands on (${r.x}, ${r.y})`
          : !(o.progress >= 0 && o.progress < 1)
            ? `is ${o.progress} of the way over a wall`
            : undefined
      if (problem)
        out.push({
          invariant: this.name,
          message: `resident ${r.id} ${problem}`,
          entityIds: [r.id],
        })
    }
    return out
  },
}

/**
 * Road orders along a line are sound (`CONTEXT.md`: Road): they have tiles left, at most
 * `ROAD_LINE_MAX_TILES`, each next to the one before; and after a tick one building on a site
 * stands on that road site, on the order's first tile (`resolveBuilding` moves the order on from
 * a finished one and ends it on a vanished one).
 */
export const roadLineOrdersSound: Invariant = {
  name: 'road-line-orders-sound',
  check(world, terrain) {
    const out: InvariantViolation[] = []
    for (const r of world.residents) {
      const o = r.order
      if (o?.kind !== 'roadLine') continue
      const fail = (problem: string) =>
        out.push({
          invariant: this.name,
          message: `resident ${r.id} ${problem}`,
          entityIds: o.siteId ? [r.id, o.siteId] : [r.id],
        })
      const first = o.tiles[0]
      if (!first || o.tiles.length > ROAD_LINE_MAX_TILES) {
        fail(`has a road order with ${o.tiles.length} tiles`)
        continue
      }
      const size = terrain.size
      const apart = o.tiles.findIndex(
        ([x, y], i) =>
          i > 0 &&
          Math.abs(wrapDelta(o.tiles[i - 1]![0], x, size)) +
            Math.abs(wrapDelta(o.tiles[i - 1]![1], y, size)) !==
            1,
      )
      if (apart > 0) fail(`has a road order whose tile ${apart} is not next to the one before`)
      if (o.phase !== 'building' || o.siteId === null) continue
      const site = world.buildings.find((b) => b.id === o.siteId)
      const onIt = site?.site && site.kind === 'road' && site.x === r.x && site.y === r.y
      if (!onIt || r.x !== first[0] || r.y !== first[1]) {
        fail(`builds ${o.siteId}, which is not the road site on their tile and the order’s next`)
      }
    }
    return out
  },
}

/**
 * The Trade Organization stays apart (`CONTEXT.md`: Trade Organization, Trade Org HQ, Trading post,
 * Warehouse): there is at most one Trade Org HQ, every Trade Org city belongs to no realm, and
 * warehouses stand only in Trade Org cities, or in none once their city is gone.
 */
export const tradeOrgSound: Invariant = {
  name: 'trade-org-sound',
  check(world) {
    const out: InvariantViolation[] = []
    const fail = (id: string, message: string) =>
      out.push({ invariant: this.name, message, entityIds: [id] })
    const tradeOrg = new Set<string>()
    for (const c of world.cities) {
      if (!c.tradeOrg) continue
      tradeOrg.add(c.id)
      if (c.realmId !== null) fail(c.id, `Trade Org city ${c.id} belongs to realm ${c.realmId}`)
    }
    const hqs = world.cities.filter((c) => c.tradeOrg === 'hq')
    if (hqs.length > 1) fail(hqs[1]!.id, `the world has ${hqs.length} Trade Org HQs`)
    for (const b of world.buildings) {
      if (b.kind === 'warehouse' && b.cityId !== null && !tradeOrg.has(b.cityId))
        fail(b.id, `warehouse ${b.id} stands in ${b.cityId}, not a Trade Org city`)
    }
    return out
  },
}

export const worldInvariants: Invariant[] = [
  nothingOnImpassableTerrain,
  positionsOnMap,
  trainedWithinCap,
  healthAndHungerInRange,
  agesInRange,
  realmsHaveLeaders,
  buildingsInPlace,
  citiesFromBuildings,
  carriedWithinCapacity,
  goodsInPlace,
  stablesBreedInRange,
  goodsInWholeUnits,
  carryOrdersDone,
  sitesWithinNeeds,
  buildOrdersOnSites,
  workOrdersOnWorkplaces,
  refilledWhenLow,
  teardownsWithinNeeds,
  tearDownOrdersOnBuildings,
  nodesOnFittingTerrain,
  realmLogsInOrder,
  residentsInCities,
  npcCityResidentsUnowned,
  ownersExist,
  cityResidentsInItsRealm,
  takenCitiesCaptured,
  npcOrdersAllowed,
  npcFightsOutsiders,
  cityWorkplacesSound,
  pairsHoldTogether,
  childrenDontWork,
  carriagesInPlace,
  driversOnCarriages,
  haulRoutesSound,
  alliancesSound,
  territorySound,
  deadLeaveLoot,
  attackOrdersSound,
  armiesSound,
  contractsSound,
  buyOrdersDone,
  cityPricesSound,
  tradeOrdersDone,
  tradesKeepGoods,
  refusedTradeNothing,
  deliveriesSound,
  transfersSound,
  supplyLinesSound,
  crimesSound,
  standingsSound,
  joinRequestsSound,
  formerPlayersSound,
  gatesSound,
  wallDamageSound,
  climbOrdersSound,
  tradeOrgSound,
  caravansSound,
  routeRobberiesSound,
  tradeOrgArmySound,
  punishmentsSound,
  directivesSound,
  buyOffsSound,
  buyOffOrdersDone,
  hqRingsSound,
  roadLineOrdersSound,
]

export function checkInvariants(
  world: WorldState,
  terrain: TerrainMap,
  invariants: Invariant[] = worldInvariants,
): InvariantViolation[] {
  return invariants.flatMap((inv) => inv.check(world, terrain))
}

/** Whether this tick's invariants get checked, given the share of ticks to sample. */
export function shouldCheckInvariants(sampleRate: number, rand: () => number = Math.random) {
  return sampleRate >= 1 || rand() < sampleRate
}

/**
 * Goods appear from nothing only at the stock floor (`CONTEXT.md`: Stock floor, ADR 0003):
 * across one tick, no good grows in the world by more than work at workplaces, buildings torn
 * down or broken and the Trade Org's floor brought in (`noteMade`). Goods may go: eaten, spoiled, used up.
 * Checked across a tick, from the goods the world held (`tallyGoods`) before it.
 */
export function goodsOnlyFromNothingAtTheFloor(
  before: Stock,
  world: WorldState,
  made: Stock,
): InvariantViolation[] {
  const after = tallyGoods(world)
  const out: InvariantViolation[] = []
  for (const [good, n] of Object.entries(after) as [Good, number][]) {
    const grew = n - (before[good] ?? 0) - (made[good] ?? 0)
    if (grew > 1e-9) {
      out.push({
        invariant: 'goods-only-from-nothing-at-the-floor',
        message: `${grew} ${good} appeared from nothing at tick ${world.tick}`,
        entityIds: [],
      })
    }
  }
  return out
}
