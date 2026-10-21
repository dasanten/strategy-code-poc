import {
  PROTECTION,
  WEAPON_ATTACK,
  carryCapacity,
  forSale,
  inCityArea,
  isArmed,
  npcHireProblem,
  npcStorages,
  organizationLabel,
  spareResidents,
  stockWeight,
  canWork,
  GOOD_WEIGHT,
  type City,
  type Good,
  type MercenaryContract,
  type Resident,
  type Weapon,
  type WorldState,
} from '@csp/shared'
import { cannotStart, startContract } from './contracts.js'
import { recordEvent } from './events.js'
import type { Invariant, InvariantViolation } from './invariants.js'

/*
 * Hiring from an NPC city (`CONTEXT.md`: Hiring from an NPC city): a Player asks an NPC city for
 * a number of its residents (`offerContract`), and the city answers at once, here. Paying and
 * ending go as in any mercenary contract (`stepContracts`). Like the rest of an NPC city it only
 * does what a Player could (ADR 0002): it accepts or declines, and its lent residents take
 * weapons and armour from its storage.
 */

/** The NPC city lending in a contract, if its lender is one. */
function lenderCity(world: WorldState, c: MercenaryContract): City | undefined {
  const city = world.cities.find((x) => x.id === c.lenderId)
  return city && forSale(city) ? city : undefined
}

/**
 * One tick of hiring from NPC cities, on a map of `size` tiles: each NPC city answers every ask
 * for its residents at once. It accepts when it has no `npcHireProblem` with the ask (it doesn't
 * refuse the hirer, can still spare those very residents and the price is at least its asking
 * price) and the residents and storage are still its own; its lent residents then arm themselves
 * (`armLent`). Otherwise it declines, which the hirer hears of. Run before `stepNpcCities`, so a
 * lent resident is not handed work first.
 */
export function stepNpcHire(world: WorldState, size: number): void {
  for (const c of [...world.contracts]) {
    if (c.startedAt !== null) continue
    const city = lenderCity(world, c)
    if (!city) continue
    if (accepts(world, city, c)) {
      startContract(world, c)
      armLent(world, city, c, size)
      continue
    }
    world.contracts = world.contracts.filter((x) => x !== c)
    recordEvent(world, c.hirerId, {
      kind: 'contract',
      contractId: c.id,
      what: 'declined',
      lender: false,
      other: organizationLabel(world, city.id),
      residents: c.residentIds.length,
    })
  }
}

/** Whether the city accepts the ask: no problem with it, and each resident asked for is spare. */
function accepts(world: WorldState, city: City, c: MercenaryContract): boolean {
  const n = c.residentIds.length
  if (npcHireProblem(world, city, c.hirerId, n, c.pricePerWeek, c.id)) return false
  if (cannotStart(world, c)) return false
  // The very residents named must still be ones it would lend.
  const spare = new Set(spareResidents(world, city, c.id).map((r) => r.id))
  return c.residentIds.every((id) => spare.has(id))
}

/** Weapons from the strongest down. */
const BY_STRENGTH = (Object.keys(WEAPON_ATTACK) as Weapon[]).sort(
  (a, b) => WEAPON_ATTACK[b] - WEAPON_ATTACK[a],
)

/**
 * The city's lent residents take weapons and armour from its storages along (`CONTEXT.md`:
 * Hiring from an NPC city), as far as it has them and they can carry them: each one at home in
 * its area takes its best weapon if unarmed, then one of each kind of protection they lack.
 */
function armLent(world: WorldState, city: City, c: MercenaryContract, size: number): void {
  const storages = npcStorages(world, city)
  const take = (r: Resident, good: Good): boolean => {
    if (stockWeight(r.carried) + GOOD_WEIGHT[good] > carryCapacity(r, world.tick) + 1e-9) {
      return false
    }
    const from = storages.find((b) => (b.stock?.[good] ?? 0) > 0)
    if (!from) return false
    from.stock![good]! -= 1
    if (from.stock![good] === 0) delete from.stock![good]
    r.carried[good] = (r.carried[good] ?? 0) + 1
    return true
  }
  for (const id of c.residentIds) {
    const r = world.residents.find((x) => x.id === id)
    if (!r || !inCityArea(world, city, r.x, r.y, size)) continue
    if (!isArmed(r)) BY_STRENGTH.some((w) => take(r, w))
    for (const p of PROTECTION) if (!(r.carried[p] ?? 0)) take(r, p)
  }
}

/**
 * Hiring from NPC cities holds together (`CONTEXT.md`: Hiring from an NPC city; ADR 0004): an NPC
 * city never offers on its own, hires out only to a realm, never lends a child, and is paid into
 * a storage of its own.
 */
export const npcHireSound: Invariant = {
  name: 'npc-hire-sound',
  check(world) {
    const out: InvariantViolation[] = []
    const fail = (message: string, entityIds: string[]) =>
      out.push({ invariant: this.name, message, entityIds })
    for (const c of world.contracts) {
      if (world.cities.some((x) => x.id === c.hirerId)) {
        fail(`contract ${c.id} has city ${c.hirerId} hiring`, [c.id])
      }
      const city = lenderCity(world, c)
      if (!city) continue
      if (c.offeredBy !== 'hirer') fail(`NPC city ${city.id} offered contract ${c.id}`, [c.id])
      if (!world.realms.some((r) => r.id === c.hirerId)) {
        fail(`NPC city ${city.id} hires out to ${c.hirerId}, which is no realm`, [c.id])
      }
      for (const id of c.residentIds) {
        const r = world.residents.find((x) => x.id === id)
        if (r && !canWork(r, world.tick)) fail(`NPC city ${city.id} lends child ${id}`, [c.id, id])
      }
      const b = world.buildings.find((x) => x.id === c.storageId)
      if (b && (b.kind !== 'storage' || b.cityId !== city.id)) {
        fail(`contract ${c.id} is paid into ${b.id}, no storage of ${city.id}`, [c.id, b.id])
      }
    }
    return out
  },
}
