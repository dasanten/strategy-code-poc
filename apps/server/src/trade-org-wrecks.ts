import {
  MAX_WORKERS,
  WORKPLACE_WRECK_WORTH,
  isAt,
  townHallOf,
  workersOf,
  wrapDistance,
  type Building,
  type BuildingKind,
  type City,
  type Punishment,
  type Resident,
  type WorldState,
} from '@csp/shared'
import { buildingOrganization, cityOrganization, organizationOf } from './crimes.js'
import { recordEvent } from './events.js'
import type { Invariant, InvariantViolation } from './invariants.js'
import { ownWorkplaces } from './npc-chain.js'
import { workplaceOf } from './npc-plan.js'
import type { Felled } from './teardown.js'

/*
 * The Trade Organization's second step on a debt (`CONTEXT.md`: Trade Org debt; ADR 0025): past the
 * deadline its army goes to that city and tears down workplaces of it, each counting for its worth
 * against the debt, until the debt is covered or none are left. Its soldiers only hold tear-down
 * orders like any Player's (ADR 0002); the crime and what falls to the ground go as anyone's.
 */

/**
 * Whether `b` is on the books of an Organization other than `org` (`Building.cityId`,
 * `City.workplaceIds`). There is no ownership flag (`CONTEXT.md`: Holding a workplace), so a workplace
 * that is on nobody's books is only whoever's works it.
 */
function onOthersBooks(world: WorldState, b: Building, org: string): boolean {
  const owner = buildingOrganization(world, b)
  if (owner !== null && owner !== org) return true
  return world.cities.some((c) => cityOrganization(c) !== org && c.workplaceIds?.includes(b.id))
}

/** Whether `b` is a finished workplace. */
const isWorkplace = (b: Building) => !b.site && MAX_WORKERS[b.kind] !== undefined

/**
 * The workplaces of `city` that are its Organization's (`CONTEXT.md`: Holding a workplace), nearest
 * its town hall first: finished ones on its books (a farm laid out for it, an NPC city's
 * `workplaceIds`) and those its residents work, also while away carrying. Never one on another
 * Organization's books or with someone of another Organization working it.
 */
export function workplacesOfCity(world: WorldState, city: City, size: number): Building[] {
  const org = cityOrganization(city)
  const worked = new Set<string>()
  for (const r of world.residents) {
    if (r.health <= 0 || r.cityId !== city.id || organizationOf(r) !== org) continue
    const id = workplaceOf(r)
    if (id !== undefined) worked.add(id)
  }
  for (const b of ownWorkplaces(world, city)) worked.add(b.id)
  const hall = townHallOf(world, city) ?? { x: 0, y: 0 }
  return world.buildings
    .filter(
      (b) =>
        worked.has(b.id) &&
        isWorkplace(b) &&
        !onOthersBooks(world, b, org) &&
        workersOf(world, b).every((r) => organizationOf(r) === org),
    )
    .sort(
      (a, b) =>
        wrapDistance(size, hall, a) - wrapDistance(size, hall, b) || a.id.localeCompare(b.id),
    )
}

/**
 * Brings up to date what a wrecking army means to tear down at `city`, where it now is: what it found
 * stays, so a workplace doesn't escape it by its workers leaving or dying, unless someone of another
 * Organization holds it by now, and what has become a workplace of the city since is added.
 */
export function findWorkplaces(world: WorldState, p: Punishment, city: City, size: number): void {
  const org = cityOrganization(city)
  const byId = new Map(world.buildings.map((b) => [b.id, b]))
  const known = (p.wrecks ?? []).filter((id) => {
    const b = byId.get(id)
    return !!b && workersOf(world, b).every((r) => organizationOf(r) === org)
  })
  const found = workplacesOfCity(world, city, size).map((b) => b.id)
  p.wrecks = [...known, ...found.filter((id) => !known.includes(id))]
}

/**
 * The workplaces a wrecking army is at now: the first of what it means to tear down whose worth covers
 * `owed`, so that it brings down no more than the debt asks for while it works several at once.
 */
export function workplacesToWreck(world: WorldState, p: Punishment, owed: number): Building[] {
  const out: Building[] = []
  let worth = 0
  for (const id of p.wrecks ?? []) {
    if (worth >= owed) break
    const b = world.buildings.find((x) => x.id === id)
    if (!b) continue
    out.push(b)
    worth += WORKPLACE_WRECK_WORTH[b.kind] ?? 0
  }
  return out
}

/**
 * A soldier's part in it: they stay at the workplace they are tearing down while it is among `targets`;
 * else they walk to the nearest of them and start, the same order a Player gives (`tearDown`).
 */
export function tearDownNext(
  r: Resident,
  targets: Building[],
  size: number,
  headFor: (r: Resident, to: { x: number; y: number }) => void,
): void {
  if (targets.length === 0) return
  const o = r.order
  if (o?.kind === 'tearDown' && targets.some((b) => b.id === o.buildingId)) return
  const b = targets.reduce((a, c) => (wrapDistance(size, r, c) < wrapDistance(size, r, a) ? c : a))
  if (!isAt(r, b, size)) headFor(r, b)
  else r.order = { kind: 'tearDown', buildingId: b.id, at: { x: r.x, y: r.y } }
}

/** One building a punishment's soldier brought down this tick, for the invariant. */
interface WreckRecord {
  residentId: string
  buildingId: string
  kind: BuildingKind
  /** The Organization on whose books it was as it fell, if any. */
  org: string | null
  culpritOrg: string
  /** Whether the punishment had it down to tear down. */
  listed: boolean
}

/** What punishments' soldiers brought down in the latest tick, kept beside the world. */
const ledger = new WeakMap<WorldState, WreckRecord[]>()

/**
 * What came down this tick (`resolveTearingDown`): a workplace a wrecking army's soldier brought down
 * counts its worth against the debt, as far as there is any, and the realm log reports the building.
 * A debt so covered is gone. Run right after `resolveTearingDown`.
 */
export function countWrecked(world: WorldState, felled: Felled[]): void {
  const records: WreckRecord[] = []
  ledger.set(world, records)
  for (const { residentId, building: b } of felled) {
    const p = world.punishments.find((x) => x.members.some((m) => m.residentId === residentId))
    if (!p) continue
    const listed = p.heading === 'out' && !!p.wrecks?.includes(b.id)
    records.push({
      residentId,
      buildingId: b.id,
      kind: b.kind,
      org: buildingOrganization(world, b),
      culpritOrg: p.culpritOrg,
      listed,
    })
    if (!listed) continue
    p.wrecks = p.wrecks!.filter((id) => id !== b.id)
    const debt = world.debts.find((d) => d.org === p.culpritOrg)
    const coins = Math.min(WORKPLACE_WRECK_WORTH[b.kind] ?? 0, debt?.coins ?? 0)
    if (debt) {
      debt.coins -= coins
      p.took += coins
      p.worth = p.took + debt.coins
      if (debt.coins <= 0) world.debts = world.debts.filter((d) => d !== debt)
    }
    recordEvent(world, p.culpritOrg, {
      kind: 'wrecked',
      building: b.kind,
      x: b.x,
      y: b.y,
      cityId: p.cityId,
      city: world.cities.find((c) => c.id === p.cityId)?.name ?? 'a city',
      coins,
      owed: debt?.coins ?? 0,
    })
  }
}

/** Test hook: what came down in the latest tick, so a test can tamper with it. */
export function wreckRecordsOf(world: WorldState): WreckRecord[] {
  return ledger.get(world) ?? []
}

/**
 * Its army never tears down anything but the culprit's workplaces (`CONTEXT.md`: Trade Org debt; ADR
 * 0004). Only a wrecking army on its way there holds tear-down orders, only for what it means to tear
 * down, and all that is finished workplaces; what a soldier brought down this tick was one of those,
 * on nobody's books but the culprit's.
 */
export const wrecksSound: Invariant = {
  name: 'wrecks-sound',
  check(world) {
    const out: InvariantViolation[] = []
    const fail = (message: string, entityIds: string[]) =>
      out.push({ invariant: this.name, message, entityIds })
    const byId = new Map(world.buildings.map((b) => [b.id, b]))
    const byResident = new Map(world.residents.map((r) => [r.id, r]))
    for (const p of world.punishments ?? []) {
      for (const id of p.wrecks ?? []) {
        const b = byId.get(id)
        if (b && !isWorkplace(b))
          fail(`punishment ${p.id} means to tear down ${b.kind} ${id}`, [p.id, id])
      }
      for (const { residentId } of p.members) {
        const o = byResident.get(residentId)?.order
        if (o?.kind !== 'tearDown') continue
        if (p.heading !== 'out' || !p.wrecks?.includes(o.buildingId)) {
          fail(`${residentId} of punishment ${p.id} is tearing down ${o.buildingId}`, [
            p.id,
            residentId,
            o.buildingId,
          ])
        }
      }
    }
    for (const w of ledger.get(world) ?? []) {
      const ids = [w.residentId, w.buildingId]
      if (!w.listed) fail(`${w.residentId} brought down ${w.buildingId}, not on its list`, ids)
      if (MAX_WORKERS[w.kind] === undefined) {
        fail(`${w.residentId} brought down ${w.kind} ${w.buildingId}, no workplace`, ids)
      }
      if (w.org !== null && w.org !== w.culpritOrg) {
        fail(`${w.residentId} brought down ${w.buildingId} of ${w.org}, not ${w.culpritOrg}`, ids)
      }
    }
    return out
  },
}
