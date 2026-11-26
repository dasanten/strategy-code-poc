// The warehouses whose caravans carry transfers (`CONTEXT.md`: Transfer). Its rules with a Rust
// original are twins of it, held to it by `client-twins.test.ts` (T122.8, docs/wasm-rules.md): the
// client asks them per frame or per row.

import { wrapDistance } from './terrain.js'
import { tradeCoinWarehouse } from './warehouse.js'
import type { Building, WorldState } from '@csp/shared-types'

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
