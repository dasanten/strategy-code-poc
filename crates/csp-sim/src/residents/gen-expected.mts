// Writes expected.json and stepped.json from the frozen TypeScript. Run from the repo root:
//   apps/server/node_modules/.bin/tsx --conditions=source crates/csp-sim/src/residents/gen-expected.mts \n//     crates/csp-sim/src/residents/expected.json crates/csp-sim/src/residents/stepped.json
import { writeFileSync } from 'node:fs'
import {
  mulberry32,
  newResident,
  newChild,
  baseStats,
} from '../../../../apps/server/src/residents.ts'
import { uniqueName } from '../../../../apps/server/src/names.ts'
import { pickLayout } from '../../../../apps/server/src/city-layout.ts'
import { stepSpoilage } from '../../../../apps/server/src/spoilage.ts'
import {
  TICKS_PER_GAME_DAY,
  type Resident as R,
  type WorldState,
} from '../../../../packages/shared/src/index.ts'

const residents = [1, 7, 42, 7919, -3].map((seed) => {
  const rand = mulberry32(seed)
  const taken = new Set(['Mara', 'Tobin', 'Edda'])
  const made = Array.from({ length: 6 }, (_, i) =>
    newResident(
      rand,
      {
        id: `r${i}`,
        owner: 'realm1',
        cityId: i % 2 ? 'city2' : null,
        x: i,
        y: 2 * i,
        tick: 1000 * i,
      },
      i % 3 ? taken : undefined,
    ),
  )
  const child = newChild(
    rand,
    [baseStats(made[0]!), baseStats(made[1]!)],
    { id: 'c', owner: null, cityId: 'city2', x: 1, y: 1, tick: 5000 },
    taken,
  )
  return { seed, made, child }
})

const names = [
  ['Bram', ['Bram', 'Wren']],
  ['Ivo', ['Ivo', 'Jutta', 'Mara', 'Tobin']],
  ['Nobody', ['Nobody']],
  ['Edda II', ['Edda II', 'Edda III']],
].map(([drawn, taken]) => ({
  drawn,
  taken,
  out: uniqueName(drawn as string, new Set(taken as string[]), [
    'Mara',
    'Tobin',
    'Ivo',
    'Jutta',
    'Bram',
    'Wren',
  ]),
}))

const layouts = [1, 7, 123456].flatMap((seed) =>
  ['city1', 'city22', 'b305'].map((id) => ({ seed, id, out: pickLayout(seed, id) })),
)

const spoiled = [1, 9, 77].map((seed) => {
  const world = {
    tick: 3 * TICKS_PER_GAME_DAY - 1,
    seed,
    nextId: 10,
    realms: [{ id: 'realm1', userId: 1, leaderId: 'r1' }],
    cities: [{ id: 'city1', realmId: 'realm1' }],
    buildings: [
      { id: 'b1', kind: 'storage', cityId: 'city1', x: 0, y: 0, stock: { food: 337, wood: 4 } },
    ],
    residents: Array.from({ length: 20 }, (_, i) => ({
      id: `r${i}`,
      owner: i % 2 ? 'realm1' : null,
      carried: { food: i },
    })),
    carriages: [{ id: 'k1', realmId: 'realm1', load: { food: 55 } }],
    piles: Array.from({ length: 30 }, (_, i) => ({
      id: `pile${i}`,
      x: i,
      y: 0,
      goods: { food: (i % 7) + 1 },
    })),
    events: [] as unknown[],
  }
  stepSpoilage(world as never)
  return { seed, world }
})

writeFileSync(process.argv[2], JSON.stringify({ residents, names, layouts, spoiled }, null, 1))

// ---- stepped.json: survival, spoilage, the stock floor, aging and refilling over the fixture
// worlds, in the order `stepWorld` runs them, nobody walking (argv[3]). ----
import { readFileSync } from 'node:fs'
import { ticksForAge } from '../../../../packages/shared/src/index.ts'
import { stepSurvival, stepRefill } from '../../../../apps/server/src/survival.ts'
import { stepStockFloor } from '../../../../apps/server/src/stock-floor.ts'
import { stepAging } from '../../../../apps/server/src/aging.ts'

const revive = (_: string, v: unknown) => {
  if (v && typeof v === 'object' && '$number' in v) {
    const n = (v as { $number: string }).$number
    return n === '-0' ? -0 : Number(n)
  }
  return v
}
const load = (
  name: string,
): { terrain: { size: number; tiles: Uint8Array }; world: WorldState } => {
  const file = JSON.parse(
    readFileSync(`crates/csp-sim/fixtures/worlds/${name}.json`, 'utf8'),
    revive,
  )
  const terrain = {
    size: file.terrain.size,
    tiles: new Uint8Array(Buffer.from(file.terrain.tiles, 'base64')),
  }
  return { terrain, world: file.world }
}

/** The village made a Player's realm, with residents away, hungry, Down, old and young. */
function perturbVillage(world: WorldState) {
  world.realms.push({ id: 'realm9', userId: 3, leaderId: world.residents[0].id })
  world.cities[0].realmId = 'realm9'
  delete world.cities[0].layout
  for (const r of world.residents) r.owner = 'realm9'
  for (const k of [...world.horses, ...world.carriages]) k.realmId = 'realm9'
  const [leader, away, old, child, down] = world.residents as [R, R, R, R, R]
  Object.assign(leader, { health: 0, downUntil: 100, order: null })
  Object.assign(away, { x: away.x + 40, carried: {}, order: null })
  old.lifespan = (world.tick - old.bornAt) / (1440 * 365) + 0.001
  child.bornAt = world.tick - Math.ceil(ticksForAge(5))
  Object.assign(down, { health: 0, downUntil: 3000, carried: { stone: 3, food: 2 }, order: null })
}

const subset = (world: WorldState) =>
  JSON.parse(
    JSON.stringify({
      tick: world.tick,
      nextId: world.nextId,
      realms: world.realms,
      residents: world.residents.map((r) => ({
        id: r.id,
        owner: r.owner,
        cityId: r.cityId,
        x: r.x,
        y: r.y,
        hunger: r.hunger,
        health: r.health,
        carried: r.carried,
        downUntil: r.downUntil,
        order: r.order,
      })),
      cities: world.cities.map((c) => ({
        id: c.id,
        realmId: c.realmId,
        layout: c.layout,
        formerPlayer: c.formerPlayer,
      })),
      buildings: world.buildings.filter((b) => b.stock).map((b) => ({ id: b.id, stock: b.stock })),
      horses: world.horses.map((h) => ({ id: h.id, realmId: h.realmId, cityId: h.cityId })),
      carriages: world.carriages.map((k) => ({
        id: k.id,
        realmId: k.realmId,
        cityId: k.cityId,
        load: k.load,
      })),
      piles: world.piles,
      events: world.events,
    }),
  )

const stepped = ['village-0', 'hq-0'].map((name) => {
  const { terrain, world } = load(name)
  if (name === 'village-0') perturbVillage(world)
  const start = name === 'village-0' ? world : undefined
  const startJson = start && JSON.parse(JSON.stringify(start))
  const at: unknown[] = []
  for (let t = 1; t <= 8 * TICKS_PER_GAME_DAY; t++) {
    stepSurvival(world, terrain)
    stepSpoilage(world)
    stepStockFloor(world)
    world.tick++
    stepAging(world, terrain.size)
    stepRefill(world, terrain.size)
    if ([1, 99, 100, 101, 1439, 1440, 3001, 8 * TICKS_PER_GAME_DAY].includes(t))
      at.push({ t, ...subset(world) })
  }
  return { name, start: startJson, at }
})
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(stepped))
