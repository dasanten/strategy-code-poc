import {
  HORSE_FOOD_PER_DAY,
  MAX_HUNGER,
  NPC_HORSES_BASE,
  NPC_RESIDENTS_PER_HORSE,
  NPC_START_HORSES,
  NPC_START_HORSE_FOOD_DAYS,
  NPC_TOWN,
  NPC_VILLAGE,
  OWN_FOOD,
  STABLE_CAPACITY,
  TICKS_PER_GAME_DAY,
  TRADING_POST,
  horsesIn,
  isAt,
  npcHorsesWanted,
  npcReserve,
  ownsHorse,
  type Building,
  type City,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { newHorse } from './horses.js'
import { foundNpcCity } from './npc-cities.js'
import { nextProject } from './npc-growth.js'
import { plains, storageOf, village } from './npc-growth.fixture.js'
import { giveHorsesToNpcCities, giveNpcHorses } from './npc-horses.js'
import { tradeOrgBreedsNoHorses } from './npc-stable.js'
import { mulberry32 } from './residents.js'
import { Walking } from './walking.js'
import { createWorld, generateWorld, stepWorld } from './world.js'
import { generateTerrain } from './terrain-gen.js'

/**
 * NPC cities have horses and breed them (`CONTEXT.md`: NPC horses, Breeding, Horse stats): two to
 * start with and Food by them, a stable over them, and foals up to the number wanted for their size.
 */

const horsesOf = (world: WorldState, city: City) =>
  world.horses.filter((h) => ownsHorse({ cityId: city.id }, h))

const stableOf = (world: WorldState, city: City) =>
  world.buildings.find((b) => b.kind === 'stable' && b.cityId === city.id)

/** Runs the world with the invariants checked every game day. */
function run(world: WorldState, terrain: TerrainMap, ticks: number, each: () => void = () => {}) {
  const walking = new Walking(terrain)
  for (let t = 0; t < ticks; t++) {
    stepWorld(world, terrain, walking)
    each()
    if (world.tick % TICKS_PER_GAME_DAY === 0) expect(checkInvariants(world, terrain)).toEqual([])
  }
  expect(checkInvariants(world, terrain)).toEqual([])
}

/** A village with its two horses in a finished stable with plenty of Food, and a full storage. */
function stabled() {
  const f = village()
  const { world, city } = f
  giveNpcHorses(world, f.terrain, city)
  const [h] = horsesOf(world, city)
  const stable: Building = {
    id: 'stable1',
    kind: 'stable',
    cityId: city.id,
    x: h!.x - 1,
    y: h!.y - 1,
    stock: { food: 500 },
  }
  world.buildings.push(stable)
  world.piles = [] // the stable has its Food; none of it lies on its footprint
  storageOf(world, city).stock = { food: 2000 }
  for (const r of world.residents) r.carried.food = OWN_FOOD
  return { ...f, stable }
}

describe('NPC cities with horses', () => {
  it('a new village or town has two fed horses with Food by them; trading posts and the HQ none', () => {
    const terrain = generateTerrain(1, 1440)
    const world = generateWorld(terrain)
    const npc = world.cities.filter((c) => !c.tradeOrg)
    expect(npc.length).toBeGreaterThan(0)
    for (const city of npc) {
      const own = horsesOf(world, city)
      expect(own).toHaveLength(NPC_START_HORSES)
      for (const h of own) {
        expect(h.realmId).toBeNull()
        expect(h.hunger).toBe(MAX_HUNGER)
        const pile = world.piles.find((p) => p.x === h.x && p.y === h.y)
        expect(pile?.goods.food).toBe(
          Math.ceil(NPC_START_HORSES * NPC_START_HORSE_FOOD_DAYS * HORSE_FOOD_PER_DAY),
        )
      }
    }
    for (const city of world.cities.filter((c) => c.tradeOrg === 'post')) {
      expect(horsesOf(world, city)).toEqual([])
    }
    expect(checkInvariants(world, terrain)).toEqual([])
  }, 120_000)

  it('the same world always gets the same horses', () => {
    const horses = () => {
      const { world, terrain, city } = village()
      giveNpcHorses(world, terrain, city)
      return world.horses
    }
    expect(horses()).toEqual(horses())
  })

  it('stands them inside the wall on ground a stable fits, far from the home', () => {
    const { world, terrain, city, home } = village()
    giveNpcHorses(world, terrain, city)
    const [h] = horsesOf(world, city)
    expect(Math.max(Math.abs(h!.x - home.x), Math.abs(h!.y - home.y))).toBeGreaterThan(8)
    const spot = nextProjectStable(world, terrain, city, home)
    expect(isAt(h!, { kind: 'stable', ...spot })).toBe(true)
  })

  it('puts them in the stable a city already has', () => {
    const { world, terrain, city, stable } = stabled()
    for (const h of horsesOf(world, city)) world.horses.splice(world.horses.indexOf(h), 1)
    world.piles = []
    giveNpcHorses(world, terrain, city)
    expect(horsesIn(horsesOf(world, city), stable)).toHaveLength(NPC_START_HORSES)
  })
})

/** The stable the city would lay out next, with wood enough that nothing comes before it. */
function nextProjectStable(
  world: WorldState,
  terrain: TerrainMap,
  city: City,
  home: Building,
): { x: number; y: number } {
  storageOf(world, city).stock = { ...storageOf(world, city).stock, wood: 500 }
  const p = nextProject(world, city, home, terrain)
  if (p?.kind !== 'build' || p.building !== 'stable') {
    throw new Error(`wanted a stable, got ${JSON.stringify(p)}`)
  }
  return { x: p.x, y: p.y }
}

describe('the migration of NPC horses', () => {
  it('gives an NPC city with none two, and leaves one with horses, posts, the HQ and Players’ alone', () => {
    const terrain = plains(600)
    const world = createWorld(terrain)
    const none = foundNpcCity(world, terrain, NPC_VILLAGE, 20, 20, mulberry32(1))
    const some = foundNpcCity(world, terrain, NPC_VILLAGE, 300, 20, mulberry32(2))
    const post = foundNpcCity(world, terrain, TRADING_POST, 20, 300, mulberry32(3))
    post.tradeOrg = 'post'
    const player = foundNpcCity(world, terrain, NPC_VILLAGE, 300, 300, mulberry32(4))
    player.realmId = 'r1'
    world.horses.push(
      newHorse(mulberry32(5), {
        id: 'old',
        realmId: null,
        cityId: some.id,
        x: 310,
        y: 30,
        tick: world.tick,
      }),
    )
    giveHorsesToNpcCities(world, terrain)
    expect(horsesOf(world, none)).toHaveLength(NPC_START_HORSES)
    expect(horsesOf(world, some).map((h) => h.id)).toEqual(['old'])
    expect(horsesOf(world, post)).toEqual([])
    expect(world.horses.filter((h) => h.cityId === player.id)).toEqual([])
  })
})

describe('the stable of an NPC city with horses', () => {
  it('goes up around them, they stand in it fed and it is fed from then on', () => {
    const { world, terrain, city } = village()
    giveNpcHorses(world, terrain, city)
    storageOf(world, city).stock = { food: 1000, wood: 200 }
    for (const r of world.residents) r.carried.food = OWN_FOOD
    run(world, terrain, 25 * TICKS_PER_GAME_DAY)
    const stable = stableOf(world, city)!
    expect(stable).toBeDefined()
    expect(stable.site).toBeUndefined()
    const own = horsesOf(world, city)
    expect(own.length).toBeGreaterThanOrEqual(NPC_START_HORSES)
    for (const h of own) {
      expect(isAt(h, stable)).toBe(true)
      expect(h.hunger).toBeGreaterThan(0)
    }
    expect(stable.stock?.food ?? 0).toBeGreaterThan(0)
  }, 300_000)

  it(
    'takes its time from a village with no Wood at all, and the Food by them lasts',
    { timeout: 600_000, tags: ['slow'] },
    () => {
      const { world, terrain, city } = village()
      giveNpcHorses(world, terrain, city)
      storageOf(world, city).stock = { food: 1000 }
      for (const r of world.residents) r.carried.food = OWN_FOOD
      let upAt: number | undefined
      run(world, terrain, NPC_START_HORSE_FOOD_DAYS * TICKS_PER_GAME_DAY, () => {
        const s = stableOf(world, city)
        if (upAt === undefined && s && !s.site) upAt = world.tick
      })
      expect(upAt).toBeDefined()
      expect(horsesOf(world, city).length).toBeGreaterThanOrEqual(NPC_START_HORSES)
    },
  )
})

describe('how many horses an NPC city wants', () => {
  it('grows with its size, up to what a stable holds', () => {
    const { world, city } = village()
    const residents = world.residents.filter((r) => r.cityId === city.id).length
    expect(residents).toBe(NPC_VILLAGE.residents)
    expect(npcHorsesWanted(world, city)).toBe(
      NPC_HORSES_BASE + Math.floor(residents / NPC_RESIDENTS_PER_HORSE),
    )
    const big = {
      residents: Array.from({ length: NPC_TOWN.residents * 4 }, () => ({ cityId: city.id })),
    } as Pick<WorldState, 'residents'>
    expect(npcHorsesWanted(big, city)).toBe(STABLE_CAPACITY)
    expect(npcHorsesWanted(world, { ...city, tradeOrg: 'post' })).toBe(0)
  })
})

describe('an NPC city breeding its horses', () => {
  const breeders = (world: WorldState) =>
    world.residents.filter((r) => r.script?.scriptId === 0 && r.script.task === 'breed')

  it('stops at the number it wants', { timeout: 600_000, tags: ['slow'] }, () => {
    const { world, terrain, city, stable } = stabled()
    const wanted = npcHorsesWanted(world, city)
    expect(wanted).toBeGreaterThan(NPC_START_HORSES)
    let most = 0
    let bred = false
    run(world, terrain, 45 * TICKS_PER_GAME_DAY, () => {
      most = Math.max(most, horsesOf(world, city).length)
      bred ||= breeders(world).length > 0
      stable.stock!.food = 500
    })
    expect(bred).toBe(true)
    expect(most).toBe(npcHorsesWanted(world, city))
    expect(breeders(world)).toEqual([])
  })

  it('starts no breeding at the number', () => {
    const { world, terrain, city, stable } = stabled()
    const rand = mulberry32(9)
    while (horsesOf(world, city).length < npcHorsesWanted(world, city)) {
      const id = `extra${world.horses.length}`
      const tick = world.tick
      world.horses.push(
        newHorse(rand, { id, realmId: null, cityId: city.id, x: stable.x, y: stable.y, tick }),
      )
    }
    run(world, terrain, TICKS_PER_GAME_DAY, () => expect(breeders(world)).toEqual([]))
  })

  it('starts none while Food is short', () => {
    const { world, terrain, city } = stabled()
    storageOf(world, city).stock = {}
    run(world, terrain, TICKS_PER_GAME_DAY / 4, () => expect(breeders(world)).toEqual([]))
  })

  it('starts one below the number with two fed horses in the stable', () => {
    const { world, terrain } = stabled()
    let bred = false
    run(world, terrain, TICKS_PER_GAME_DAY / 4, () => {
      bred ||= breeders(world).length > 0
    })
    expect(bred).toBe(true)
    expect(breeders(world)).toHaveLength(1)
  })

  it('the Trade Organization’s cities don’t breed, and the invariant says so', () => {
    const { world, terrain, city } = stabled()
    city.tradeOrg = 'post'
    run(world, terrain, TICKS_PER_GAME_DAY / 4, () => expect(breeders(world)).toEqual([]))
    const r = world.residents.find((x) => x.cityId === city.id)!
    expect(tradeOrgBreedsNoHorses.check(world, terrain)).toEqual([])
    r.script = { scriptId: 0, task: 'breed', memory: { stableId: 'stable1', horseIds: [] } }
    expect(tradeOrgBreedsNoHorses.check(world, terrain)).toHaveLength(1)
  })
})

describe('a daughter with no horse', () => {
  /** A village with no horse and everything its reserve asks for in store, so nothing is short. */
  function stocked() {
    const f = village()
    const { world, city } = f
    const stock: Record<string, number> = { ...npcReserve(world, city) }
    for (const good of Object.keys(stock)) stock[good] = stock[good]! + 1000
    storageOf(world, city).stock = stock
    return f
  }

  it('wants no stable while something is short', () => {
    const { world, terrain, city, home } = stocked()
    storageOf(world, city).stock = {}
    const p = nextProject(world, city, home, terrain)
    expect(p?.kind === 'build' && p.building).not.toBe('stable')
  })

  it('builds a stable once nothing is short, so a Player can sell it one', () => {
    const { world, terrain, city, home } = stocked()
    const p = nextProject(world, city, home, terrain)
    expect(p).toMatchObject({ kind: 'build', building: 'stable' })
  })

  it('wants no second one', () => {
    const { world, terrain, city, home } = stocked()
    world.buildings.push({ id: 'stable1', kind: 'stable', cityId: city.id, x: 25, y: 25 })
    const p = nextProject(world, city, home, terrain)
    expect(p?.kind === 'build' && p.building).not.toBe('stable')
  })
})
