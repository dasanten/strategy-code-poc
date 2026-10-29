import {
  CARAVAN_ESCORTS,
  CARAVAN_FOOD,
  CARAVAN_SPREAD,
  CARRIAGE_CAPACITY,
  Terrain,
  stockWeight,
  wrapDistance,
  type Carriage,
  type Good,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { caravansSound, evenOut, placeCaravans, routeEnd } from './caravans.js'
import { checkInvariants } from './invariants.js'
import { mulberry32, newResident } from './residents.js'
import { entitiesInSight } from './sight.js'
import { foundTradeOrgHq, hqLayout } from './trade-org.js'
import { foundTradingPost } from './trading-posts.js'
import { Walking } from './walking.js'
import { createWorld, generateWorld, stepWorld } from './world.js'
import { smallTerrain } from './test-terrain.js'

/** An open map of Plains, `size` tiles along each side. */
const plains = (size: number): TerrainMap => ({
  size,
  tiles: new Uint8Array(size * size).fill(Terrain.Plains),
})

/** The Trade Org HQ at (128, 128) and one trading post south-east of it, with its caravan. */
function route() {
  const terrain = plains(512)
  const world = createWorld(terrain)
  const rand = mulberry32(5)
  const hq = foundTradeOrgHq(world, terrain, 128, 128, rand)
  const post = foundTradingPost(world, terrain, 320, 320, undefined, rand)
  const [caravan] = placeCaravans(world)
  return { world, terrain, hq, post, caravan: caravan! }
}

/** Every unit of a good in the world: in buildings, on carriages, carried and on the ground. */
function total(world: WorldState, good: Good): number {
  const stocks = [
    ...world.buildings.map((b) => b.stock ?? {}),
    ...world.carriages.map((k) => k.load),
    ...world.residents.map((r) => r.carried),
    ...world.piles.map((p) => p.goods),
  ]
  return stocks.reduce((n, s) => n + (s[good] ?? 0), 0)
}

describe('placing caravans', () => {
  it('gives the HQ a carriage, a horse and a crew for each trading post, at its goods warehouse', () => {
    const { world, hq, post, caravan } = route()
    expect(world.caravans).toEqual([caravan])
    expect(caravan.postId).toBe(post.id)
    expect(caravan.escortIds).toHaveLength(CARAVAN_ESCORTS)
    const hall = world.buildings.find((b) => b.id === hq.townHallId)!
    const [x, y] = hqLayout(hall.x + 1, hall.y + 1).goodsWarehouse
    const carriage = world.carriages.find((k) => k.id === caravan.carriageId)!
    expect(carriage).toMatchObject({ realmId: null, cityId: hq.id, x, y })
    expect(world.horses.find((h) => h.id === carriage.horseId)).toMatchObject({
      cityId: hq.id,
      x,
      y,
    })
    for (const id of [caravan.driverId, ...caravan.escortIds]) {
      expect(world.residents.find((r) => r.id === id)).toMatchObject({
        owner: null,
        cityId: hq.id,
        x,
        y,
      })
    }
    expect(caravansSound.check(world, plains(512))).toEqual([])
  })

  it('places none twice, and none without an HQ', () => {
    const { world, terrain } = route()
    expect(placeCaravans(world)).toEqual([])
    const bare = createWorld(terrain)
    foundTradingPost(bare, terrain, 320, 320, undefined, mulberry32(1))
    expect(placeCaravans(bare)).toEqual([])
  })

  it('comes with a generated world, one for every trading post', () => {
    const world = generateWorld(smallTerrain(), 1)
    const posts = world.cities.filter((c) => c.tradeOrg === 'post')
    expect(world.caravans.map((c) => c.postId).sort()).toEqual(posts.map((c) => c.id).sort())
  })
})

describe('evening out', () => {
  const carriage = (load = {}): Carriage => ({
    id: 'k',
    realmId: null,
    cityId: null,
    x: 0,
    y: 0,
    horseId: null,
    load,
  })

  it('takes half of what this warehouse has more than the other, never Food or coins', () => {
    const here = { wood: 300, stone: 40, iron: 11, coins: 900, food: 50 }
    const there = { wood: 100, stone: 60, iron: 0 }
    expect(evenOut(here, there, carriage(), CARRIAGE_CAPACITY)).toEqual({ wood: 100, iron: 5 })
  })

  it('takes no more than fits on the carriage', () => {
    const plan = evenOut(
      { stone: 2000, wood: 2000 },
      {},
      carriage({ food: CARAVAN_FOOD }),
      CARRIAGE_CAPACITY,
    )
    expect(stockWeight(plan) + CARAVAN_FOOD).toBeLessThanOrEqual(CARRIAGE_CAPACITY)
    expect(stockWeight(plan) + CARAVAN_FOOD).toBeGreaterThan(CARRIAGE_CAPACITY - 10)
  })
})

describe('caravans on their route', () => {
  it(
    'carry stock from the HQ to the post and back, evening out, with the escort along',
    { tags: ['slow'], timeout: 180_000 },
    () => {
      const { world, terrain, post, caravan } = route()
      const walking = new Walking(terrain)
      const postWarehouse = routeEnd(world, caravan, 'post').warehouse!
      const hqWarehouse = routeEnd(world, caravan, 'hq').warehouse!
      // Wood and coins stay above the stock floor, so the floor adds none of them on the way.
      postWarehouse.stock = { coins: 2_000, wood: 30 }
      hqWarehouse.stock = { wood: 300, iron: 100 }
      const wood = total(world, 'wood')
      const carriage = world.carriages.find((k) => k.id === caravan.carriageId)!
      let reachedPost = false
      let back = false
      let farthest = 0
      for (let t = 0; t < 12_000 && !back; t++) {
        stepWorld(world, terrain, walking)
        for (const id of caravan.escortIds) {
          const r = world.residents.find((x) => x.id === id)!
          if (caravan.stop === 'warehouse' || caravan.heading === 'post') {
            farthest = Math.max(farthest, wrapDistance(terrain.size, r, carriage))
          }
        }
        if (t % 500 === 0) expect(checkInvariants(world, terrain)).toEqual([])
        if (caravan.heading === 'hq' && (postWarehouse.stock.wood ?? 0) > 30) reachedPost = true
        back = reachedPost && caravan.heading === 'post' && caravan.stop === 'storage'
      }
      expect(reachedPost).toBe(true)
      expect(back).toBe(true)
      // The post got about half the difference in wood and iron; nothing was made or lost.
      expect(postWarehouse.stock.wood).toBeGreaterThan(100)
      expect(postWarehouse.stock.iron).toBeGreaterThan(0)
      expect(postWarehouse.stock.coins).toBe(2_000)
      expect(total(world, 'wood')).toBe(wood)
      // Moving its own stock between its warehouses is no theft.
      expect(world.crimes).toEqual([])
      // The escort walked along: never far from the carriage on the way.
      expect(farthest).toBeLessThanOrEqual(CARAVAN_SPREAD + 2)
      // The crew and horse ate from what the caravan carries; nobody starved.
      const crew = [caravan.driverId, ...caravan.escortIds]
      expect(crew.every((id) => world.residents.some((r) => r.id === id))).toBe(true)
      expect(world.cities.some((c) => c.id === post.id)).toBe(true)
      expect(checkInvariants(world, terrain)).toEqual([])
    },
  )

  it('breaks up when its driver is gone, leaving the escort to the HQ', () => {
    const { world, terrain, caravan } = route()
    world.residents = world.residents.filter((r) => r.id !== caravan.driverId)
    stepWorld(world, terrain, new Walking(terrain))
    expect(world.caravans).toEqual([])
    expect(checkInvariants(world, terrain)).toEqual([])
  })
})

describe('seeing caravans', () => {
  it('shows a caravan to a Player whose resident sees its carriage or crew, else not', () => {
    const { world, terrain, caravan } = route()
    world.realms.push({ id: 'realm1', userId: 1, leaderId: 'scout' } as WorldState['realms'][0])
    const carriage = world.carriages.find((k) => k.id === caravan.carriageId)!
    const scout = newResident(mulberry32(9), {
      id: 'scout',
      owner: 'realm1',
      x: carriage.x + 3,
      y: carriage.y,
      tick: 0,
    })
    world.residents.push(scout)
    const caravans = () =>
      entitiesInSight(world, terrain, 'realm1').filter((e) => e.is === 'caravan')
    expect(caravans()).toEqual([
      {
        is: 'caravan',
        id: caravan.id,
        postId: caravan.postId,
        carriageId: caravan.carriageId,
        driverId: caravan.driverId,
        escortIds: caravan.escortIds,
        heading: caravan.heading,
      },
    ])
    scout.x = (carriage.x + 60) % terrain.size
    expect(caravans()).toEqual([])
  })
})
