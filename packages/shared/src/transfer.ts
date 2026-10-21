import { commandsCarriage } from './alliance.js'
import { DELIVERY_LOAD, GOOD_WEIGHT, TRANSFER_FEE_FACTOR, canWork } from './balance.js'
import { tradeOrgRefuses } from './standing.js'
import { wrapDistance } from './terrain.js'
import {
  deliveryFee,
  deliveryStorage,
  tradeCoinWarehouse,
  tradingWarehouseAt,
} from './warehouse.js'
import { GOODS, type Building, type Good, type Resident, type WorldState } from './world.js'

/*
 * Transfers between realms (`CONTEXT.md`: Transfer): the Trade Organization carries goods or
 * coins from one realm to a city of another as a courier, for a fee. The queries here are the
 * game API the UI, scripts and server share (ADR 0002).
 */

/**
 * A transfer's fee, in coins (`CONTEXT.md`: Transfer): `TRANSFER_FEE_FACTOR` times a delivery's
 * fee (`deliveryFee`) for `kg` over the caravan's whole way of `tiles`.
 */
export function transferFee(kg: number, tiles: number): number {
  return TRANSFER_FEE_FACTOR * deliveryFee(kg, tiles)
}

/** The most units of `good` one transfer carries: one delivery load (`DELIVERY_LOAD`). */
export function transferLoad(good: Good): number {
  return Math.floor(DELIVERY_LOAD / GOOD_WEIGHT[good] + 1e-9)
}

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
 * The tiles of a transfer's whole way (`CONTEXT.md`: Transfer): from the `warehouse` to the
 * sender's storage `from` (none for a hand-in), on to the recipient's storage `to`, and back.
 */
export function transferTiles(
  size: number,
  warehouse: { x: number; y: number },
  from: { x: number; y: number } | null,
  to: { x: number; y: number },
): number {
  const stops = from ? [warehouse, from, to, warehouse] : [warehouse, to, warehouse]
  let tiles = 0
  for (let i = 1; i < stops.length; i++) tiles += wrapDistance(size, stops[i - 1]!, stops[i]!)
  return tiles
}

/**
 * The most of `wanted` units of `good` a transfer takes from `held` (`CONTEXT.md`: Transfer),
 * with its fee over `tiles`: cut down to the units held, one delivery load and the coins held
 * for the fee (for a transfer of coins, the units and the fee together). Pure.
 */
export function quoteTransfer(
  held: Partial<Record<Good, number>>,
  good: Good,
  wanted: number,
  tiles: number,
): { units: number; fee: number } {
  let best = { units: 0, fee: 0 }
  for (let n = 1; n <= Math.min(wanted, transferLoad(good)); n++) {
    const fee = transferFee(n * GOOD_WEIGHT[good], tiles)
    const coins = fee + (good === 'coins' ? n : 0)
    if (n > (held[good] ?? 0) || coins > (held.coins ?? 0)) break
    best = { units: n, fee }
  }
  return best
}

/**
 * Why `realmId` can't send a transfer of `units` of `good` to the city `toCityId` (`CONTEXT.md`:
 * Transfer), or undefined when it can: the Trade Organization doesn't refuse it, the good is one
 * that exists, `units` whole, positive and within one load, and the city is another realm's,
 * with a storage.
 */
export function transferProblem(
  world: WorldState,
  realmId: string,
  good: unknown,
  units: unknown,
  toCityId: unknown,
): string | undefined {
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
  if (!tradingWarehouseAt(world, resident.x, resident.y)) return 'not on a Trade Org warehouse'
  let stock = resident.carried
  if (carriageId !== null && carriageId !== undefined) {
    const k = world.carriages.find((x) => x.id === carriageId)
    if (!commandsCarriage(world, realmId, k)) return 'not one of your carriages'
    if (k.x !== resident.x || k.y !== resident.y) {
      return 'that carriage is not on the resident’s tile'
    }
    stock = k.load
  }
  if (!((stock[good as Good] ?? 0) > 0)) return 'none of that good to hand in'
  return undefined
}
