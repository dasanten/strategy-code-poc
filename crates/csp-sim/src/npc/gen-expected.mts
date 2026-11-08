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

// ---- npc-stepped.json: the NPC cities' own steps over the fixture worlds, nobody walking. ----
import { stepNpcDefence } from '../../../../apps/server/src/npc-defence.ts'
import { stepNpcHire } from '../../../../apps/server/src/npc-hire.ts'
import { stepNpcCities } from '../../../../apps/server/src/npc-behaviour.ts'

const TICKS = 360
const AT = [1, 2, 30, 60, 61, 120, 180, 240, 300, 360]
// The HQ grows by its own rings (`hq-growth.ts`, T86.9): its worlds join once that is ported.
const stepped = ['village-0', 'village-1440', 'village-10080'].map((name) => {
  const { terrain, world } = load(name)
  const at: unknown[] = []
  for (let t = 1; t <= TICKS; t++) {
    stepNpcDefence(world, terrain.size)
    stepNpcHire(world, terrain.size)
    stepNpcCities(world, terrain.size, terrain)
    world.tick++
    if (AT.includes(t)) {
      at.push(
        JSON.parse(
          JSON.stringify({
            t,
            nextId: world.nextId,
            residents: world.residents.map((r) => ({
              id: r.id,
              cityId: r.cityId,
              carried: r.carried,
              order: r.order,
              script: r.script ?? null,
              pair: r.pair ?? null,
            })),
            cityPlans: world.cityPlans,
            cities: world.cities,
            buildings: world.buildings.map((b) => ({ id: b.id, closed: b.closed ?? null })),
            horses: world.horses.length,
          }),
        ),
      )
    }
  }
  return { name, at }
})
writeFileSync(`${process.argv[2]}/npc-stepped.json`, JSON.stringify(stepped))

// ---- founded.json: a town and two villages founded on the 7-1024 map, with their horses. ----
import { NPC_TOWN, NPC_VILLAGE } from '../../../../packages/shared/src/index.ts'
import { findNpcCitySite, foundNpcCity } from '../../../../apps/server/src/npc-cities.ts'
import { giveNpcHorses } from '../../../../apps/server/src/npc-horses.ts'
import { mulberry32 } from '../../../../apps/server/src/residents.ts'
import { createWorld } from '../../../../apps/server/src/world.ts'

const tiles = new Uint8Array(readFileSync('crates/csp-sim/fixtures/terrain/7-1024.bin'))
const terrain1024 = { size: 1024, tiles }
const founded = createWorld(terrain1024, 7)
const rand = mulberry32(7 * 104729 + 31)
const sites: unknown[] = []
for (const kind of [NPC_TOWN, NPC_VILLAGE, NPC_VILLAGE]) {
  const site = findNpcCitySite(founded, terrain1024, kind, rand)
  sites.push(site ?? null)
  if (!site) continue
  const city = foundNpcCity(founded, terrain1024, kind, site[0], site[1], rand)
  giveNpcHorses(founded, terrain1024, city)
}
writeFileSync(
  `${process.argv[2]}/founded.json`,
  JSON.stringify({
    sites,
    cities: founded.cities,
    buildings: founded.buildings,
    residents: founded.residents,
    horses: founded.horses,
    piles: founded.piles,
    nextId: founded.nextId,
  }),
)
