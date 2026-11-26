// Ported from packages/shared/src/transfer.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { commandsCarriage } from './alliance.js'
import { isAt } from './footprint.js'
import { tradeOrgRefuses } from './standing.js'
import { canWork } from './stats.js'
import { wrapDistance } from './terrain.js'
import { NO_CARAVANS, tradeOrgHq } from './trade-org.js'
import { deliveryStorage, tradeCoinWarehouse, tradingWarehouseAt } from './warehouse.js'
import { GOODS } from './world.js'
import type { Building, Good, Resident, WorldState } from '@csp/shared-types'
import { transferLoad } from '@csp/lang-wasm'

export { transferTiles, quoteTransfer } from '@csp/lang-wasm'

export { transferFee, feeAtPickUp, transferLoad } from '@csp/lang-wasm'

/*
 * Transfers between realms (`CONTEXT.md`: Transfer): the Trade Organization carries goods or
 * coins from one realm to a city of another as a courier, for a fee. The queries here are the
 * game API the UI, scripts and server share (ADR 0002).
 */

/**
 * The warehouses whose caravans carry transfers: every finished Trade Org warehouse that prices
 * goods and has its coins at hand, the HQ's goods warehouse and each trading post's.
 */
export function transferWarehouses(world: Pick<WorldState, 'cities' | 'buildings'>): Building[] {
  return world.buildings.filter(
    (b) => b.kind === 'warehouse' && !b.site && tradeCoinWarehouse(world, b) !== undefined,
  )
}

/**
 * The warehouse a transfer picked up at `storage` comes from (`CONTEXT.md`: Transfer): the one
 * nearest it (`transferWarehouses`), undefined when there is none. `size` is the map's.
 */
export function nearestWarehouse(
  world: Pick<WorldState, 'cities' | 'buildings'>,
  storage: { x: number; y: number },
  size: number,
): Building | undefined {
  let best: Building | undefined
  let bestTiles = Infinity
  for (const w of transferWarehouses(world)) {
    const tiles = wrapDistance(size, w, storage)
    if (tiles < bestTiles) [best, bestTiles] = [w, tiles]
  }
  return best
}

/**
 * Why `realmId` can't send a transfer of `units` of `good` to the city `toCityId` (`CONTEXT.md`:
 * Transfer), or undefined when it can: caravans still run (`CONTEXT.md`: Fall of the HQ), the
 * Trade Organization doesn't refuse it, the good is one that exists, `units` whole, positive and
 * within one load, and the city is another realm's, with a storage.
 */
export function transferProblem(
  world: WorldState,
  realmId: string,
  good: unknown,
  units: unknown,
  toCityId: unknown,
): string | undefined {
  if (!tradeOrgHq(world)) return NO_CARAVANS
  if (tradeOrgRefuses(world, realmId)) return 'the Trade Organization won’t carry for you'
  if (!(GOODS as readonly unknown[]).includes(good)) return 'not a good'
  if (!Number.isInteger(units) || (units as number) <= 0) return 'units must be a whole number'
  if ((units as number) > transferLoad(good as Good)) return 'more than one carriage load'
  const to = world.cities.find((c) => c.id === toCityId)
  if (!to || to.realmId === null || !world.realms.some((r) => r.id === to.realmId)) {
    return 'not a city of a realm'
  }
  if (to.realmId === realmId) return 'that city is your own'
  if (!deliveryStorage(world, to.id)) return 'that city has no storage'
  return undefined
}

/**
 * Why `realmId` can't have a caravan pick up a transfer at its city `fromCityId` (`CONTEXT.md`:
 * Transfer), or undefined when it can: besides `transferProblem`, the city is the realm's, with a
 * storage, and a warehouse is there to send a caravan.
 */
export function pickUpTransferProblem(
  world: WorldState,
  realmId: string,
  fromCityId: unknown,
  good: unknown,
  units: unknown,
  toCityId: unknown,
): string | undefined {
  const problem = transferProblem(world, realmId, good, units, toCityId)
  if (problem) return problem
  const from = world.cities.find((c) => c.id === fromCityId)
  if (!from || from.realmId !== realmId) return 'not one of your cities'
  if (!deliveryStorage(world, from.id)) return 'your city has no storage'
  if (transferWarehouses(world).length === 0) return 'no Trade Org warehouse to send a caravan'
  return undefined
}

/**
 * Why `resident` of `realmId` can't hand in a transfer at a warehouse now (`CONTEXT.md`:
 * Transfer), or undefined when they can: besides `transferProblem`, they are grown up, on a Trade
 * Org warehouse's tile, with some of the good in their hands or on `carriageId`, a carriage on
 * their tile that `realmId` commands.
 */
export function handInProblem(
  world: WorldState,
  realmId: string,
  resident: Resident,
  good: unknown,
  units: unknown,
  carriageId: unknown,
  toCityId: unknown,
): string | undefined {
  const problem = transferProblem(world, realmId, good, units, toCityId)
  if (problem) return problem
  if (!canWork(resident, world.tick)) return 'children can’t hand in a transfer'
  const warehouse = tradingWarehouseAt(world, resident.x, resident.y)
  if (!warehouse) return 'not at a Trade Org warehouse'
  let stock = resident.carried
  if (carriageId !== null && carriageId !== undefined) {
    const k = world.carriages.find((x) => x.id === carriageId)
    if (!commandsCarriage(world, realmId, k)) return 'not one of your carriages'
    if (!isAt(k, warehouse)) return 'that carriage is not at the warehouse'
    stock = k.load
  }
  if (!((stock[good as Good] ?? 0) > 0)) return 'none of that good to hand in'
  return undefined
}
