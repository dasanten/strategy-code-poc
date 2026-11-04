import { TRADE_ORG, tradeOrgHq, type City, type WorldState } from '@csp/shared'
import { endTradeOrgContracts } from './contracts.js'
import { recordEvent } from './events.js'
import type { Invariant, InvariantViolation } from './invariants.js'

/**
 * The Trade Org HQ `hq`, whose residents, horses and carriages have just joined a realm, leaves
 * the Trade Organization for good (`CONTEXT.md`: Fall of the HQ): it becomes a plain city, its
 * warehouses storages with all they hold. What only the HQ gave the Trade Organization ends with
 * it: caravans, with the robberies counted on their routes, and so the deliveries and transfers
 * still open, each with a line in its realm's log and nothing refunded; its contracts; its
 * punishments. The trading posts live on. Goods stay where they are, whoever that makes them
 * belong to.
 */
export function hqFalls(world: WorldState, hq: City): void {
  delete hq.tradeOrg
  for (const b of world.buildings) {
    if (b.cityId === hq.id && b.kind === 'warehouse') b.kind = 'storage'
  }
  world.caravans = []
  world.routeRobberies = {}
  const cityName = (id: string) => world.cities.find((c) => c.id === id)?.name ?? 'a lost city'
  for (const d of world.deliveries) {
    recordEvent(world, d.realmId, {
      kind: 'orderEndedWithHq',
      order: d.kind,
      good: d.good,
      units: d.units,
      cityId: d.cityId,
      city: cityName(d.cityId),
    })
  }
  for (const t of world.transfers) {
    recordEvent(world, t.realmId, {
      kind: 'orderEndedWithHq',
      order: 'transfer',
      good: t.good,
      units: t.units,
      cityId: t.toCityId,
      city: cityName(t.toCityId),
    })
  }
  world.deliveries = []
  world.transfers = []
  world.punishments = []
  endTradeOrgContracts(world)
}

/**
 * A world with no Trade Org HQ has nothing left that only the HQ gave the Trade Organization
 * (`CONTEXT.md`: Fall of the HQ; ADR 0004): no caravans or robberies counted on their routes, no
 * deliveries or transfers, no punishments, and no contract with it on either side.
 */
export const nothingLeftOfTheHq: Invariant = {
  name: 'nothing-left-of-the-hq',
  check(world) {
    if (tradeOrgHq(world)) return []
    const out: InvariantViolation[] = []
    const left = (what: string, ids: string[]) => {
      if (ids.length === 0) return
      out.push({
        invariant: this.name,
        message: `the world has no Trade Org HQ but still has ${what}`,
        entityIds: ids,
      })
    }
    left(
      'caravans',
      world.caravans.map((c) => c.id),
    )
    left('robberies counted on routes', Object.keys(world.routeRobberies))
    left(
      'deliveries',
      world.deliveries.map((d) => d.id),
    )
    left(
      'transfers',
      world.transfers.map((t) => t.id),
    )
    left(
      'punishments',
      world.punishments.map((p) => p.id),
    )
    left(
      'contracts with the Trade Organization',
      world.contracts
        .filter((c) => c.lenderId === TRADE_ORG || c.hirerId === TRADE_ORG)
        .map((c) => c.id),
    )
    return out
  },
}
