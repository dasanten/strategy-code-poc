import {
  NPC_OFFER_REACH,
  NPC_CITY_REFUSES_STANDING,
  NPC_SMITHY_WEAPON,
  NPC_VILLAGE,
  Terrain,
  TICKS_PER_GAME_DAY,
  npcCityStock,
  npcOfferTimes,
  npcPriceFor,
  npcReserve,
  standingOf,
  type Building,
  type City,
  type Good,
  type Offer,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { eventsFor } from './events.js'
import { checkInvariants } from './invariants.js'
import { npcHome } from './npc-behaviour.js'
import { foundNpcCity } from './npc-cities.js'
import { plains } from './npc-growth.fixture.js'
import { planCity, planDue } from './npc-plan.js'
import { offersAcceptedIn, offersKeepGoods, tradeOrgTakesNoOffer } from './offers.js'
import { mulberry32, newResident } from './residents.js'
import { changeStanding } from './standing.js'
import { addCity } from './test-terrain.js'
import { foundTradingPost } from './trading-posts.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/*
 * NPC cities at an offer (`CONTEXT.md`): a city sends its trader to a Player's offer in reach that
 * gives what it is short of, for what it has spare or Coins, at a rate at least as good as its own
 * prices. The trader goes by the orders a Player could give.
 */

/** A map too big to wrap inside the reach. */
const SIZE = 2400

/** A village whose storage holds its reserve, 60 Wood and 10 Stone over it, and is short of Iron. */
function village(world: WorldState, terrain: TerrainMap, x: number, y: number, seed = 7) {
  const city = foundNpcCity(world, terrain, NPC_VILLAGE, x, y, mulberry32(seed))
  const storage = npcHome(world, city)!
  storage.stock = { food: 400 }
  const reserve = npcReserve(world, city)
  storage.stock.food = (reserve.food ?? 0) + 5
  storage.stock.wood = (reserve.wood ?? 0) + 60
  storage.stock.stone = (reserve.stone ?? 0) + 10
  storage.stock.coins = reserve.coins ?? 0
  return { city, storage }
}

/** Realm r1 (Player 7) with a city and a storage holding plenty of everything, `tiles` east. */
function playerStorage(world: WorldState, x: number, y: number): Building {
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
  addCity(world, { id: 'c1', realmId: 'r1', x: x + 8, y })
  const storage: Building = {
    id: 's1',
    kind: 'storage',
    cityId: 'c1',
    x,
    y,
    stock: { iron: 100, wood: 100, food: 100, coins: 1000, spear: 10 },
  }
  world.buildings.push(storage)
  const leader = newResident(mulberry32(1), { id: 'a1', owner: 'r1', x: x + 8, y, tick: 0 })
  leader.cityId = 'c1'
  world.residents.push(leader)
  return storage
}

/** Stands an offer at the storage: "gives", "wants", once unless `times` says otherwise. */
function post(
  world: WorldState,
  storage: Building,
  gives: Good,
  givesUnits: number,
  wants: Good,
  wantsUnits: number,
  times = 1,
): Offer {
  const offer: Offer = {
    id: `offer-${world.offers.length + 1}`,
    realmId: 'r1',
    storageId: storage.id,
    x: storage.x,
    y: storage.y,
    gives,
    givesUnits,
    wants,
    wantsUnits,
    times,
  }
  world.offers.push(offer)
  return offer
}

/** A village short of Iron and a Player's storage `tiles` east of it. */
function setup(tiles = 100) {
  const terrain = plains(SIZE)
  const world = createWorld(terrain)
  const { city, storage } = village(world, terrain, 20, 20)
  const theirs = playerStorage(world, storage.x + tiles, storage.y)
  return { world, terrain, city, storage, theirs }
}

/** Runs the world until `done` or `days` pass, checking the invariants each game day. */
function run(world: WorldState, terrain: TerrainMap, days: number, done: () => boolean): void {
  const walking = new Walking(terrain)
  for (let t = 0; t < days * TICKS_PER_GAME_DAY; t++) {
    stepWorld(world, terrain, walking)
    if (t % TICKS_PER_GAME_DAY === 0) expect(checkInvariants(world, terrain)).toEqual([])
    if (done()) break
  }
  expect(checkInvariants(world, terrain)).toEqual([])
}

/** Runs the world until the city has sent its trader and has them home again. */
function untilHome(world: WorldState, terrain: TerrainMap, city: City, days = 6) {
  let traderId: string | undefined
  run(world, terrain, days, () => {
    traderId ??= world.cityPlans[city.id]?.trader?.residentId
    return traderId !== undefined && !world.cityPlans[city.id]?.trader
  })
  expect(traderId).toBeDefined()
  expect(world.cityPlans[city.id]?.trader).toBeUndefined()
  return world.residents.find((r) => r.id === traderId)!
}

/** All of a good in the world: in storages, in hands, on carriages. */
function worldHolds(world: WorldState, good: Good): number {
  let n = 0
  for (const b of world.buildings) n += b.stock?.[good] ?? 0
  for (const r of world.residents) n += r.carried[good] ?? 0
  for (const k of world.carriages) n += k.load[good] ?? 0
  return n
}

describe('an NPC city at an offer', () => {
  it('sends its trader to a good offer by the plan, as far as it lacks the good', () => {
    const { world, terrain, city, storage, theirs } = setup()
    const offer = post(world, theirs, 'iron', 1, 'wood', 1, 50)
    const lacks = npcReserve(world, city).iron! - (storage.stock!.iron ?? 0)
    expect(lacks).toBeGreaterThan(0)
    const plan = planCity(world, city, terrain)
    const t = plan.trader!
    expect(t.warehouseId).toBe(theirs.id)
    expect(t.offer).toEqual({
      offerId: offer.id,
      times: lacks,
      pays: 'wood',
      units: lacks,
      leg: 'load',
    })
    expect(plan.jobs[t.residentId]).toEqual({ kind: 'trade' })
  })

  it(
    'a trader arrives, takes the offer and brings the goods home, whether or not the Player is on',
    { timeout: 60_000 },
    () => {
      const { world, terrain, city, storage, theirs } = setup()
      const offer = post(world, theirs, 'iron', 5, 'wood', 5)
      const ironThere = theirs.stock!.iron!
      const woodThere = theirs.stock!.wood!
      const ironBefore = storage.stock!.iron ?? 0
      const r = untilHome(world, terrain, city)
      // The Player's storage has been paid in ordinary goods; the offer is used up.
      expect(theirs.stock!.iron).toBe(ironThere - 5)
      expect(theirs.stock!.wood).toBe(woodThere + 5)
      expect(world.offers.find((o) => o.id === offer.id)).toBeUndefined()
      // The Iron is in the city's storage, and nothing of the trade in the trader's arms.
      expect(storage.stock!.iron).toBe(ironBefore + 5)
      expect(r.carried.iron ?? 0).toBe(0)
      expect(r.carried.wood ?? 0).toBe(0)
      // It reads in the realm's log and moves standing like a trade.
      const log = eventsFor(world, 7).map((e) => e.kind)
      expect(log).toContain('offerTaken')
      expect(log).toContain('offerEnded')
      expect(standingOf(world, city.id, 'r1')).toBeGreaterThan(0)
    },
  )

  it('ignores a rate worse than its own prices', () => {
    const { world, terrain, city, theirs } = setup()
    // One Iron for forty Wood: its own prices make that a bad bargain.
    post(world, theirs, 'iron', 1, 'wood', 40)
    expect(planCity(world, city, terrain).trader).toBeUndefined()
  })

  it('takes a rate exactly as good as its own prices, not a coin worse', () => {
    const { world, terrain, city, storage, theirs } = setup()
    const buy = npcPriceFor('iron', (storage.stock!.iron ?? 0) + 1, npcReserve(world, city), 0).buy
    const fair = post(world, theirs, 'iron', 1, 'coins', buy)
    expect(npcOfferTimes(world, city, fair, 1)).toBe(1)
    fair.wantsUnits = buy + 1
    expect(npcOfferTimes(world, city, fair, 1)).toBe(0)
    expect(planCity(world, city, terrain).trader).toBeUndefined()
    fair.wantsUnits = buy
    expect(planCity(world, city, terrain).trader?.offer?.pays).toBe('coins')
  })

  it('ignores an offer out of reach', () => {
    const far = setup(NPC_OFFER_REACH + 10)
    post(far.world, far.theirs, 'iron', 5, 'wood', 5)
    expect(far.world.cityPlans[far.city.id]?.trader).toBeUndefined()
    expect(planCity(far.world, far.city, far.terrain).trader).toBeUndefined()
    const near = setup(NPC_OFFER_REACH - 10)
    post(near.world, near.theirs, 'iron', 5, 'wood', 5)
    expect(planCity(near.world, near.city, near.terrain).trader).toBeDefined()
  })

  it('leaves a Direct offer alone: it is for its named realm', () => {
    const { world, terrain, city, theirs } = setup()
    const offer = post(world, theirs, 'iron', 5, 'wood', 5)
    offer.direct = { toId: 'r2', lapsesAt: world.tick + 1000 }
    expect(planCity(world, city, terrain).trader).toBeUndefined()
    delete offer.direct
    expect(planCity(world, city, terrain).trader?.offer?.offerId).toBe(offer.id)
  })

  it('ignores goods it does not lack, and what it has no spare of to pay', () => {
    const lacksNothing = setup()
    post(lacksNothing.world, lacksNothing.theirs, 'wood', 50, 'stone', 1)
    expect(planCity(lacksNothing.world, lacksNothing.city, lacksNothing.terrain).trader).toBe(
      undefined,
    )
    const noSpare = setup()
    noSpare.storage.stock!.wood = npcReserve(noSpare.world, noSpare.city).wood ?? 0
    post(noSpare.world, noSpare.theirs, 'iron', 5, 'wood', 1)
    expect(planCity(noSpare.world, noSpare.city, noSpare.terrain).trader).toBeUndefined()
  })

  it('never goes for a weapon, nor pays with one', () => {
    const gives = setup()
    gives.storage.stock!.iron = 100
    post(gives.world, gives.theirs, NPC_SMITHY_WEAPON, 1, 'coins', 1)
    expect(npcCityStock(gives.world, gives.city)[NPC_SMITHY_WEAPON] ?? 0).toBe(0)
    expect(npcReserve(gives.world, gives.city)[NPC_SMITHY_WEAPON]).toBeGreaterThan(0)
    expect(planCity(gives.world, gives.city, gives.terrain).trader).toBeUndefined()
    const pays = setup()
    pays.storage.stock![NPC_SMITHY_WEAPON] = 50
    post(pays.world, pays.theirs, 'iron', 1, NPC_SMITHY_WEAPON, 1)
    expect(planCity(pays.world, pays.city, pays.terrain).trader).toBeUndefined()
  })

  it('pays in Coins from its war chest, and takes Coins for what it has spare', () => {
    const buying = setup()
    post(buying.world, buying.theirs, 'iron', 1, 'coins', 1, 50)
    const plan = planCity(buying.world, buying.city, buying.terrain)
    expect(plan.trader?.offer?.pays).toBe('coins')
    const selling = setup()
    selling.storage.stock!.coins = 0
    selling.storage.stock!.iron = 100
    selling.storage.stock![NPC_SMITHY_WEAPON] = 20
    post(selling.world, selling.theirs, 'coins', 200, 'wood', 1)
    expect(planCity(selling.world, selling.city, selling.terrain).trader?.offer?.pays).toBe('wood')
  })

  it('refuses a realm it holds in low standing', () => {
    const { world, terrain, city, theirs } = setup()
    post(world, theirs, 'iron', 5, 'wood', 5)
    changeStanding(world, city.id, 'r1', NPC_CITY_REFUSES_STANDING - 1)
    expect(planCity(world, city, terrain).trader).toBeUndefined()
  })

  it('goes for the good it is shortest of, then the nearest', () => {
    const { world, terrain, city, storage, theirs } = setup()
    const nearer: Building = {
      ...theirs,
      id: 's2',
      x: theirs.x - 40,
      y: theirs.y,
      stock: { iron: 100 },
    }
    world.buildings.push(nearer)
    post(world, theirs, 'iron', 5, 'wood', 5)
    const near = post(world, nearer, 'iron', 5, 'wood', 5)
    expect(storage.stock!.iron ?? 0).toBe(0)
    expect(planCity(world, city, terrain).trader?.offer?.offerId).toBe(near.id)
  })

  it('looks only on its planning hour', () => {
    const { world, terrain, city, theirs } = setup()
    post(world, theirs, 'iron', 5, 'wood', 5)
    const walking = new Walking(terrain)
    while (!world.cityPlans[city.id]?.trader) {
      stepWorld(world, terrain, walking)
      if (world.cityPlans[city.id]?.trader) {
        expect(planDue({ ...world, tick: world.tick - 1 }, city)).toBe(true)
      }
    }
  })

  it('while Food runs short only an offer that gives Food sends the trader', () => {
    const wood = setup()
    wood.storage.stock!.food = 0
    post(wood.world, wood.theirs, 'iron', 5, 'wood', 5)
    expect(planCity(wood.world, wood.city, wood.terrain).trader).toBeUndefined()
    const food = setup()
    food.storage.stock!.food = 0
    post(food.world, food.theirs, 'food', 10, 'wood', 5)
    expect(planCity(food.world, food.city, food.terrain).trader?.offer?.pays).toBe('wood')
  })

  it(
    'two cities at one offer lose no goods: the second is cut down and carries the rest home',
    { timeout: 120_000 },
    () => {
      const terrain = plains(SIZE)
      const world = createWorld(terrain)
      const a = village(world, terrain, 20, 20, 7)
      const b = village(world, terrain, 20 + 700, 20, 11)
      const theirs = playerStorage(world, a.storage.x + 350, a.storage.y)
      const lacks = npcReserve(world, a.city).iron! - (a.storage.stock!.iron ?? 0)
      expect(lacks).toBeGreaterThan(1)
      // Enough for one of them and one time over for the other; paid in Coins, which nobody uses up.
      const offer = post(world, theirs, 'iron', 1, 'coins', 2, lacks + 1)
      // Coins, since a village puts its Iron into building sites as soon as it has any.
      const coins = worldHolds(world, 'coins')
      const ironThere = theirs.stock!.iron!
      const chests = a.storage.stock!.coins! + b.storage.stock!.coins!
      let out = false
      run(world, terrain, 12, () => {
        expect(offersKeepGoods.check(world, terrain)).toEqual([])
        expect(worldHolds(world, 'coins')).toBe(coins)
        const plans = [world.cityPlans[a.city.id]?.trader, world.cityPlans[b.city.id]?.trader]
        out ||= plans.every((t) => t?.offer)
        return out && plans.every((t) => !t)
      })
      expect(out).toBe(true)
      // Between them they took the whole offer and no more, and paid for exactly that.
      expect(world.offers.find((o) => o.id === offer.id)).toBeUndefined()
      expect(theirs.stock!.iron).toBe(ironThere - (lacks + 1))
      expect(theirs.stock!.coins).toBe(1000 + 2 * (lacks + 1))
      // What the second couldn't spend is back in its storage, and in nobody's arms.
      const coinsHome = a.storage.stock!.coins! + b.storage.stock!.coins!
      expect(coinsHome).toBe(chests - 2 * (lacks + 1))
    },
  )

  it(
    'with the offer gone the trader comes home with what they took along',
    { timeout: 60_000 },
    () => {
      const { world, terrain, city, storage, theirs } = setup()
      const offer = post(world, theirs, 'iron', 5, 'coins', 10)
      const coins = storage.stock!.coins!
      run(world, terrain, 2, () => {
        const t = world.cityPlans[city.id]?.trader
        if (t?.offer?.leg === 'walking') world.offers = world.offers.filter((o) => o !== offer)
        return world.offers.length === 0
      })
      const r = untilHome(world, terrain, city)
      expect(storage.stock!.coins).toBe(coins)
      expect(r.carried.coins ?? 0).toBe(0)
      expect(theirs.stock!.coins).toBe(1000)
    },
  )

  it('with no way to the storage they carry the load straight home', { timeout: 60_000 }, () => {
    const { world, terrain, city, storage, theirs } = setup()
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== 2) continue
        terrain.tiles[(theirs.y + dy) * terrain.size + theirs.x + dx] = Terrain.Lake
      }
    }
    post(world, theirs, 'iron', 5, 'coins', 10)
    const coins = storage.stock!.coins!
    const r = untilHome(world, terrain, city)
    expect(storage.stock!.coins).toBe(coins)
    expect(r.carried.coins ?? 0).toBe(0)
    expect(world.offers).toHaveLength(1)
  })

  it('the Trade Organization never accepts offers', () => {
    const terrain = plains(SIZE)
    const world = createWorld(terrain)
    const post_ = foundTradingPost(world, terrain, 200, 200, undefined, mulberry32(3))
    const theirs = playerStorage(world, 220, 200)
    const warehouse = world.buildings.find((b) => b.cityId === post_.id && b.kind === 'warehouse')!
    warehouse.stock = {}
    post(world, theirs, 'wood', 100, 'coins', 1, 1)
    expect(planCity(world, post_, terrain).trader).toBeUndefined()
    // And the invariant would say so if one of its residents ever did.
    stepWorld(world, terrain)
    expect(tradeOrgTakesNoOffer.check(world, terrain)).toEqual([])
    const one = world.residents.find((r) => r.cityId === post_.id)!
    offersAcceptedIn(world).push({ residentId: one.id, before: {}, after: {} })
    expect(tradeOrgTakesNoOffer.check(world, terrain)).toHaveLength(1)
  })
})
