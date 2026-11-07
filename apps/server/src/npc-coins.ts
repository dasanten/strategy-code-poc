import {
  NODE_GOOD,
  NPC_TRADER_REACH,
  npcCityStock,
  npcReserve,
  tradeCoinWarehouse,
  wrapDistance,
  type City,
  type WorldState,
} from '@csp/shared'
import type { Invariant, InvariantViolation } from './invariants.js'
import { npcHome } from './npc-behaviour.js'
import { makes, shortGoods } from './npc-chain.js'
import { knowsNode } from './npc-scouts.js'
import { onATradersLoop } from './trader-stops.js'

/*
 * Whether an NPC city has a way to earn Coins (`CONTEXT.md`: NPC reserve). A city with none doesn't
 * count Coins as short (`shortages`), so its war chest can't keep it from being full (`CONTEXT.md`:
 * Full city). Its war chest stays in its reserve for everything else: its prices, what it sells and
 * buys, what its traders take along.
 */

/**
 * Whether an NPC city can earn Coins (`CONTEXT.md`: NPC reserve): it has gold or a mint of its own,
 * or trade in reach. Of its own: a mint or a gold mine, finished or begun (`makes`), Gold ore in its
 * storages, or a gold node it knows of (`knowsNode`), which it would build a mine on for a mint. In
 * reach: a finished Trade Org warehouse that trades (`tradeCoinWarehouse`) within `NPC_TRADER_REACH`
 * of its home, where its trader would sell; or a wandering trader whose loop passes within
 * `TRADER_STOP_REACH` of its town hall, so it stops there (`onATradersLoop`). Player offers don't
 * count: they come and go. `size` is the map's.
 */
export function earnsCoins(world: WorldState, city: City, size: number): boolean {
  if (makes(world, city, 'coins') || makes(world, city, 'goldOre')) return true
  if ((npcCityStock(world, city).goldOre ?? 0) > 0) return true
  const home = npcHome(world, city)
  if (!home) return false
  for (const node of world.nodes) {
    if (NODE_GOOD[node.kind] === 'goldOre' && knowsNode(city, home, node, size)) return true
  }
  const warehouse = world.buildings.some(
    (b) =>
      b.kind === 'warehouse' &&
      !b.site &&
      tradeCoinWarehouse(world, b) !== undefined &&
      wrapDistance(size, home, b) <= NPC_TRADER_REACH,
  )
  return warehouse || onATradersLoop(world, city, size)
}

/**
 * An NPC city counts Coins as short only with a way to earn them, and always then (`CONTEXT.md`:
 * NPC reserve; ADR 0004): of the cities whose Coins are under their war chest, those that can earn
 * more (`earnsCoins`) have them among what they are short of (`shortGoods`), and those that can't
 * don't.
 */
export const coinsShortOnlyWithIncome: Invariant = {
  name: 'coins-short-only-with-income',
  check(world, terrain) {
    const out: InvariantViolation[] = []
    for (const city of world.cities) {
      if (city.realmId !== null || city.tradeOrg) continue
      const chest = npcReserve(world, city).coins ?? 0
      if ((npcCityStock(world, city).coins ?? 0) >= chest) continue
      const earns = earnsCoins(world, city, terrain.size)
      if (shortGoods(world, city, terrain.size).includes('coins') === earns) continue
      out.push({
        invariant: this.name,
        message: `${city.id} is under its war chest of ${chest} and ${earns ? 'can earn Coins but doesn’t count them as short' : 'can’t earn Coins but counts them as short'}`,
        entityIds: [city.id],
      })
    }
    return out
  },
}
