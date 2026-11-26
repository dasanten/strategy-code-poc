import { readFileSync } from 'node:fs'
import type {
  Building,
  FirstDay,
  Good,
  Resident,
  Richness,
  SeenBuilding,
  SeenEntity,
  TradeSide,
  WallMaterial,
  BuildingKind,
} from '@csp/shared-types'
import type { Recipe } from '@csp/lang-wasm'
import { describe, expect, it } from 'vitest'
import { armyDrivenTo, spareFood } from './army.js'
import {
  holdersOf,
  isStone,
  recipeGood,
  roadLine,
  roadTiles,
  takesWorkSettings,
  teacherAt,
  traineesOf,
  workersOf,
} from './building.js'
import {
  carriageCapacity,
  carriageOfResident,
  carriagePulledBy,
  crewIdsOf,
  drivenCarriageId,
  hitchHorseProblem,
  horseFor,
} from './carriages.js'
import {
  buildingRealm,
  cityResidents,
  freeHousing,
  housingRoom,
  isOutpostStorage,
  occupationTicksLeft,
  townHallOf,
} from './city.js'
import { isRuin } from './decay.js'
import { citiesToCarryAt } from './direct-offer.js'
import { firstDayShown } from './first-day.js'
import { covers, footprintTiles, isAt } from './footprint.js'
import { breedersAt, horseOfResident, riderOf } from './horse-rules.js'
import {
  freeStock,
  offerOpenTo,
  offersAt,
  setAsideAt,
  timesToPost,
  wantsNothing,
} from './offer-rules.js'
import { gatheredOn, patchLeft } from './patch.js'
import { fighterStrength } from './persuasion.js'
import { buildingAt } from './pick-preview.js'
import { relocateProblem, relocateRoom, relocatingTo } from './relocate.js'
import { richnessFactor } from './richness.js'
import { bestWeapon, isArmed } from './stats.js'
import { quoteSwap } from './swap.js'
import {
  isPassableTerrain,
  isWater,
  tileIndex,
  wrap,
  wrapDelta,
  wrapDistance,
  type Terrain,
} from './terrain.js'
import { nearestWarehouse, transferWarehouses } from './transfer.js'
import { byKind } from './useWorld.js'
import {
  besideVessel,
  crewShort,
  vesselCapacity,
  vesselName,
  vesselOfResident,
  vesselRoom,
} from './vessels.js'
import { isClosed, isWallOrGate } from './walls.js'
import {
  deliveryStorage,
  quoteDelivery,
  quotePickUp,
  quoteTrade,
  stockFloor,
  tradeCoinWarehouse,
  warehouseKeeps,
} from './warehouse.js'
import { feedHorseProblem, horseFull } from './reviving.js'
import { isDown } from './world.js'

/**
 * The rules the client keeps in TypeScript next to the wasm module (T122.8, ADR 0045): what it
 * asks per frame, per tile or per row, where a call into the module would cost more than the rule.
 * Each is held to its Rust original: `crates/csp-sim/tests/client_twins.rs` wrote, for two fixture
 * worlds as a realm is sent them, the entities, the cases and what each original answers on the
 * mirror of them (`client_twins.json`). Here each TypeScript twin is asked the same cases of the
 * same entities, as the client holds them (`byKind`), and must answer the same. A twin is one line
 * there and one in `TWINS` here; ESLint (`csp/no-rule-copy`) refuses a client function named after
 * a `queries/` function that is in neither.
 */

interface SentWorld {
  name: string
  size: number
  tick: number
  realm: string
  entities: SeenEntity[]
}

const file = new URL('../../../crates/csp-sim/tests/client_twins.json', import.meta.url)
const { worlds, twins } = JSON.parse(readFileSync(file, 'utf8')) as {
  worlds: SentWorld[]
  twins: Record<string, [unknown[], unknown][][]>
}

/** What the client holds of a world: what is in sight by kind, its tick and size. */
function held(w: SentWorld) {
  const seen = byKind(w.entities)
  const buildings = seen.buildings
  return {
    ...seen,
    tick: w.tick,
    size: w.size,
    realm: w.realm,
    lastSeen: [] as SeenBuilding[],
    // The offers at a storage come with it (`SeenBuilding.offers`).
    offers: buildings.flatMap((b) => b.offers ?? []),
  }
}
type Held = ReturnType<typeof held>

const byId = <T extends { id: string }>(xs: readonly T[], id: unknown): T => {
  const x = xs.find((x) => x.id === id)
  if (!x) throw new Error(`no ${String(id)}`)
  return x
}
const idOf = (x: { id: string } | undefined) => x?.id
const idsOf = (xs: readonly { id: string }[]) => xs.map((x) => x.id)

/** The trader's goods the quotes are asked with, as the Rust test has them. */
const HELD = { food: 20, coins: 50, wood: 10 }
const holder = () => ({ stock: { ...HELD }, room: 60 })

/** What a TypeScript twin answers for one case's arguments, of the world as the client holds it. */
type Twin = (w: Held, ...args: never[]) => unknown

const TWINS: Record<string, Twin> = {
  // Armies and carriages.
  armyDrivenTo: (w, r: string) => armyDrivenTo(byId(w.residents, r) as Resident),
  spareFood: (w, k: string) => spareFood(w as never, byId(w.carriages, k) as never),
  carriageCapacity: (w, k: string) => carriageCapacity(w, byId(w.carriages, k)),
  horseFor: (w, k: string) => idOf(horseFor(w, byId(w.carriages, k))),
  carriagePulledBy: (w, h: string) => idOf(carriagePulledBy(w, byId(w.horses, h))),
  hitchHorseProblem: (w, k: string, h: string) =>
    hitchHorseProblem(w, byId(w.carriages, k), byId(w.horses, h)),
  crewIdsOf: (w, c: string) => crewIdsOf(byId(w.caravans, c)),
  drivenCarriageId: (w, r: string) => drivenCarriageId(byId(w.residents, r)),
  carriageOfResident: (w, k: string, r: string) =>
    carriageOfResident(byId(w.carriages, k), byId(w.residents, r)),
  // Buildings.
  holdersOf: (w, b: string) => holdersOf(w, byId(w.buildings, b)),
  workersOf: (w, b: string) => idsOf(workersOf(w, byId(w.buildings, b))),
  teacherAt: (w, b: string) => idOf(teacherAt(byId(w.buildings, b), w.residents, w.size)),
  traineesOf: (w, b: string) => idsOf(traineesOf(byId(w.buildings, b), w.residents, w.size)),
  takesWorkSettings: (w, b: string) => takesWorkSettings(byId(w.buildings, b)),
  isStone: (_, kind: BuildingKind, material: WallMaterial | null) => isStone(kind, material),
  recipeGood: (_, recipe: Recipe) => recipeGood(recipe),
  roadLine: (w, from: [number, number], to: [number, number]) =>
    roadLine({ x: from[0], y: from[1] }, { x: to[0], y: to[1] }, w.size),
  roadTiles: (w) => [...roadTiles(w, w.size)].sort((a, b) => a - b),
  isWallOrGate: (w, b: string) => isWallOrGate(byId(w.buildings, b)),
  isRuin: (w, b: string) => isRuin(byId(w.buildings, b)),
  covers: (w, b: string) => {
    const building = byId(w.buildings, b)
    return tilesOf(w).filter(([x, y]) => covers(building, x, y, w.size))
  },
  buildingAt: (w, x: number, y: number) => idOf(buildingAt({ x, y }, w)),
  // Cities.
  buildingRealm: (w, b: string) => buildingRealm(w, byId(w.buildings, b)),
  isOutpostStorage: (w, b: string) => isOutpostStorage(byId(w.buildings, b)),
  cityResidents: (w, c: string) => idsOf(cityResidents(w, byId(w.cities, c))),
  townHallOf: (w, c: string) => idOf(townHallOf(w, byId(w.cities, c))),
  housingRoom: (w, c: string) => housingRoom(w, byId(w.cities, c)),
  freeHousing: (w, c: string) => freeHousing(w, byId(w.cities, c)),
  occupationTicksLeft: (w, c: string) => occupationTicksLeft(w, byId(w.cities, c)),
  deliveryStorage: (w, c: string) => idOf(deliveryStorage(w, c)),
  citiesToCarryAt: (w, realm: string) => idsOf(citiesToCarryAt(w, realm)),
  relocatingTo: (w, c: string) => idsOf(relocatingTo(w, byId(w.cities, c))),
  relocateRoom: (w, c: string) => relocateRoom(w, byId(w.cities, c)),
  relocateProblem: (w, rs: string[], c: string | null) =>
    relocateProblem(
      w,
      w.realm,
      rs.map((r) => byId(w.residents, r) as Resident),
      c ?? undefined,
    ),
  // Horses and people.
  breedersAt: (w, b: string) => idsOf(breedersAt(w.residents, byId(w.buildings, b))),
  riderOf: (w, h: string) => idOf(riderOf(w, byId(w.horses, h))),
  horseOfResident: (w, h: string, r: string) =>
    horseOfResident(byId(w.horses, h), byId(w.residents, r)),
  isDown: (w, kind: 'resident' | 'horse', id: string) =>
    isDown(kind === 'resident' ? byId(w.residents, id) : byId(w.horses, id)),
  bestWeapon: (w, r: string) => bestWeapon(byId(w.residents, r)),
  isArmed: (w, r: string) => isArmed(byId(w.residents, r)),
  fighterStrength: (w, r: string) => fighterStrength(byId(w.residents, r) as Resident),
  firstDayShown: (_, card: FirstDay) => firstDayShown(card),
  richnessFactor: (_, r: Richness) => richnessFactor(r),
  wrap: (w, v: number) => wrap(v, w.size),
  patchLeft: (_, p: { left: number; at: number }, tick: number) => patchLeft(p, tick),
  horseFull: (w, h: string) => horseFull(byId(w.horses, h)),
  feedHorseProblem: (w, r: string, h: string) =>
    feedHorseProblem(byId(w.residents, r) as Resident, byId(w.horses, h), w.tick, w.size),
  isClosed: (w, b: string) => isClosed(byId(w.buildings, b)),
  isAt: (w, b: string) => {
    const building = byId(w.buildings, b)
    return tilesOf(w).filter(([x, y]) => isAt({ x, y }, building, w.size))
  },
  footprintTiles: (w, b: string) => footprintTiles(byId(w.buildings, b), w.size),
  gatheredOn: (_, t: number) => gatheredOn(t as Terrain),
  isWater: (_, t: number) => isWater(t),
  isPassableTerrain: (_, t: number) => isPassableTerrain(t),
  wrapDelta: (w, a: number, b: number) => wrapDelta(a, b, w.size),
  wrapDistance: (w, a: [number, number], b: [number, number]) =>
    wrapDistance(w.size, { x: a[0], y: a[1] }, { x: b[0], y: b[1] }),
  tileIndex: (w, x: number, y: number) => tileIndex(w.size, x, y),
  // Offers.
  offersAt: (w, b: string) => idsOf(offersAt(w, b)),
  setAsideAt: (w, b: string) => setAsideAt(w, b),
  freeStock: (w, b: string) => freeStock(w, byId(w.buildings, b)),
  timesToPost: (w, b: string, good: Good, units: number, times: number) =>
    timesToPost(w, byId(w.buildings, b), good, units, times),
  offerOpenTo: (w, o: string, side: string) => offerOpenTo(byId(w.offers, o), side),
  wantsNothing: (w, o: string) => wantsNothing(byId(w.offers, o)),
  // Vessels.
  besideVessel: (w, v: string) => {
    const vessel = byId(w.vessels, v)
    return tilesOf(w).filter(([x, y]) => besideVessel(vessel, { x, y }, w.size, w.buildings))
  },
  crewShort: (w, v: string) => crewShort(byId(w.vessels, v)),
  vesselCapacity: (w, v: string) => vesselCapacity(byId(w.vessels, v).kind),
  vesselName: (w, v: string) => vesselName(byId(w.vessels, v)),
  vesselRoom: (w, v: string) => vesselRoom(byId(w.vessels, v)),
  vesselOfResident: (w, v: string, r: string) =>
    vesselOfResident(byId(w.vessels, v), byId(w.residents, r)),
  // Warehouses, trade and transfers.
  warehouseKeeps: (w, b: string) => warehouseKeeps(w, byId(w.buildings, b) as Building),
  stockFloor: (w, b: string) => stockFloor(w, byId(w.buildings, b) as Building),
  tradeCoinWarehouse: (w, b: string) =>
    idOf(tradeCoinWarehouse(w, byId(w.buildings, b) as Building)),
  transferWarehouses: (w) => idsOf(transferWarehouses(w)),
  nearestWarehouse: (w, b: string) => idOf(nearestWarehouse(w, byId(w.buildings, b), w.size)),
  quoteTrade: (w, b: string, side: TradeSide, good: never, wanted: number, owed: number) =>
    quoteTrade(w, byId(w.buildings, b) as Building, holder(), side, good, wanted, owed),
  quoteSwap: (w, b: string, give: never, want: never, wanted: number, owed: number) =>
    quoteSwap(w, byId(w.buildings, b) as Building, holder(), give, want, wanted, owed),
  quoteDelivery: (w, b: string, good: never, wanted: number, tiles: number, owed: number) =>
    quoteDelivery(w, byId(w.buildings, b) as Building, { ...HELD }, good, wanted, tiles, owed),
  quotePickUp: (
    w,
    b: string,
    good: never,
    wanted: number,
    units: number,
    tiles: number,
    budget: number,
  ) => quotePickUp(w, byId(w.buildings, b) as Building, good, wanted, units, tiles, budget),
}

/** The tiles on and around each building, resident and vessel, as the Rust test asks them. */
function tilesOf(w: Held): [number, number][] {
  const spots = [...w.buildings, ...w.residents, ...w.vessels].map((t) => [t.x, t.y] as const)
  const keys = new Set<string>()
  for (const [x, y] of spots) {
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [-1, 1],
      [2, 2],
    ] as const) {
      keys.add(`${x + dx},${y + dy}`)
    }
  }
  return [...keys]
    .map((k) => k.split(',').map(Number) as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
}

/** An answer as JSON has it: nothing as null, no fields left undefined. */
const asJson = (v: unknown): unknown => {
  const text = JSON.stringify(v)
  return text === undefined ? null : JSON.parse(text)
}

describe('the TypeScript twins of the rules (T122.8)', () => {
  it('are each held to their Rust original, and every original has its twin here', () => {
    expect(Object.keys(TWINS).sort()).toEqual(Object.keys(twins).sort())
  })

  for (const [name, perWorld] of Object.entries(twins)) {
    it(`${name} answers as its Rust original`, () => {
      const twin = TWINS[name]!
      worlds.forEach((sent, i) => {
        const w = held(sent)
        const got = perWorld[i]!.map(([args]) => [args, asJson(twin(w, ...(args as never[])))])
        expect(got, `${name} on ${sent.name}`).toEqual(perWorld[i])
      })
    })
  }
})
