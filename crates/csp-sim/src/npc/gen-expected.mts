// Writes chain.json from the frozen TypeScript. Run from the repo root:
//   apps/server/node_modules/.bin/tsx --conditions=source crates/csp-sim/src/npc/gen-expected.mts \
//     crates/csp-sim/src/npc
// For every city of the stepped fixture worlds: what the NPC chain says of it (shortages, reserve
// lacks, coins, surplus work by workplace, chain store, the Trade Org's reserve and stock).
import { readFileSync, writeFileSync } from 'node:fs'
import type { TerrainMap, WorldState } from '../../../../packages/shared/src/index.ts'
import {
  chainStore,
  ownWorkplaces,
  reserveLacks,
  shortages,
  surplusWork,
  tradeOrgReserve,
  warehouseStock,
} from '../../../../apps/server/src/npc-chain.ts'
import { earnsCoins } from '../../../../apps/server/src/npc-coins.ts'

const revive = (_: string, v: unknown) =>
  v && typeof v === 'object' && '$number' in v ? Number((v as { $number: string }).$number) : v

export const WORLDS = [
  'village-0',
  'village-1440',
  'village-10080',
  'hq-0',
  'hq-1440',
  'hq-10080',
  'generated-1-1024',
]

export function load(name: string): { terrain: TerrainMap; world: WorldState } {
  const file = JSON.parse(
    readFileSync(`crates/csp-sim/fixtures/worlds/${name}.json`, 'utf8'),
    revive,
  )
  const terrain = {
    size: file.terrain.size,
    tiles: new Uint8Array(Buffer.from(file.terrain.tiles, 'base64')),
  }
  return { terrain, world: file.world as WorldState }
}

const chain = WORLDS.map((name) => {
  const { terrain, world } = load(name)
  const size = terrain.size
  const cities = world.cities.map((city) => {
    const project = world.cityPlans[city.id]?.project
    const store = chainStore(world, city)
    const surplus = surplusWork(world, city, store)
    return {
      id: city.id,
      shortages: shortages(world, city, size, project),
      lacks: reserveLacks(world, city),
      earnsCoins: earnsCoins(world, city, size),
      surplus: ownWorkplaces(world, city).map((b) => [b.id, surplus(b) ?? null]),
      store: store?.id ?? null,
      tradeOrgReserve: tradeOrgReserve(world, city),
      warehouseStock: warehouseStock(world, city),
    }
  })
  return { name, cities }
})
writeFileSync(`${process.argv[2]}/chain.json`, JSON.stringify(chain))
