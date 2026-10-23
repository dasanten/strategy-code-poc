import {
  HAUL_KEEP_FOOD,
  Terrain,
  TICKS_PER_GAME_DAY,
  MAX_HEALTH,
  pileAt,
  statValue,
  terrainAt,
  unitsThatFit,
  type GoodsSpot,
  type Resident,
  type Stock,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { CARRIAGE_COSTS, PathFinder } from './pathfinding.js'
import { worldWithCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { stepWorld } from './world.js'

/** How long the Player sleeps: a real night, eight hours, is eight game days. */
const NIGHT = 8 * TICKS_PER_GAME_DAY

/** The iron mine is at least this far from home, in tiles along the carriage's road. */
const FAR = 80

/** Food each miner takes along for the walk out and the building, in units: two game days. */
const MINER_FOOD = 6

/**
 * Food the driver takes along for the trip out and the night, in units: about ten game days, to be safe. A route bringing Food back
 * out takes all the home storage has, so there is none left there to refill from.
 */
const DRIVER_FOOD = 24

/**
 * Food for the horse on the carriage, in units: about six game days, for the drive out, building
 * the mine and the first trip home. The route then keeps `HAUL_KEEP_FOOD` on board.
 */
const HORSE_FOOD = 18

/** Iron ore that is home by morning at the least. */
const MORNING_ORE = 30

/**
 * The PoC check (`CONTEXT.md`: Haul route; epic 6): a Player's starting city builds an iron mine
 * on a far node, sets residents to work it and a carriage to haul its ore home, and leaves the
 * realm running overnight. Everything happens through orders, as the Player would give them.
 */
function scenario() {
  const { world, terrain } = worldWithCity()
  const me = { userId: 1, account: { name: 'Mara', isAdmin: false } }
  const realm = world.realms[0]!
  const storage = world.buildings.find((b) => b.kind === 'storage')!
  const stable = world.buildings.find((b) => b.kind === 'stable')!
  const carriage = world.carriages[0]!
  // Stand-in for the lumber camp and quarry the realm would have run first (epic 5).
  storage.stock = { ...storage.stock, wood: 40, stone: 20 }

  // The far node: the nearest iron-ore node on Hills that a carriage reaches, FAR tiles out or more.
  const finder = new PathFinder(terrain)
  const roads = world.nodes
    .filter((n) => n.kind === 'ironOre' && terrainAt(terrain, n.x, n.y) === Terrain.Hills)
    .map((n) => ({ n, road: finder.findPath([storage.x, storage.y], [n.x, n.y], CARRIAGE_COSTS) }))
    .flatMap(({ n, road }) => (road.status === 'found' ? [{ n, length: road.path.length }] : []))
    .filter((r) => r.length >= FAR)
    .sort((a, b) => a.length - b.length)
  const node = roads[0]!.n

  const queue = new OrderQueue(undefined, terrain)
  const walking = new Walking(terrain)
  let requests = 0
  const order = (o: object) => {
    const answer = queue.receive(world, me, `q${requests++}`, o)
    expect(answer, JSON.stringify(o)).toEqual({ type: 'ack', requestId: `q${requests - 1}` })
  }
  /**
   * Runs the world tick by tick, at least one so the orders given take effect, until `done`
   * holds, checking the invariants every game hour.
   */
  const runUntil = (done: () => boolean, ticks: number) => {
    for (let t = 0; t < ticks; t++) {
      queue.applyAll(world)
      stepWorld(world, terrain, walking)
      if (world.tick % 150 === 0) expect(checkInvariants(world, terrain)).toEqual([])
      if (done()) break
    }
    expect(done()).toBe(true)
  }
  const idle = (rs: Resident[]) => () => rs.every((r) => r.order === null)
  const at = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    a.x === b.x && a.y === b.y

  // The Leader stays home on the farm. The five strongest of the rest go: the strongest drives,
  // as they carry their own Food for the night and still load by hand; the others mine.
  const [, ...rest] = world.residents.filter((r) => r.owner === realm.id)
  const [driver, ...miners] = rest
    .sort((a, b) => statValue(b, 'strength', 0) - statValue(a, 'strength', 0))
    .slice(0, 5)
  const crew = [driver!, ...miners]
  const onCarriage: GoodsSpot = { kind: 'carriage', carriageId: carriage.id }
  const inStorage: GoodsSpot = { kind: 'storage', storageId: storage.id }

  /** `r` moves `goods` from one spot on their tile to another, as many trips as it takes. */
  const move = (r: Resident, goods: Stock, from: GoodsSpot, to: GoodsSpot) => {
    for (const [good, units] of Object.entries(goods)) {
      let left = units
      while (left > 0) {
        const before = r.carried[good as keyof Stock] ?? 0
        const take = Math.min(left, unitsThatFit(r, good as keyof Stock, world.tick))
        order({ kind: 'pickUp', residentId: r.id, spot: from, goods: { [good]: take } })
        runUntil(idle([r]), 10)
        order({ kind: 'drop', residentId: r.id, spot: to, goods: { [good]: take } })
        runUntil(idle([r]), 10)
        expect(r.carried[good as keyof Stock] ?? 0).toBe(before)
        left -= take
      }
    }
  }

  return {
    world,
    terrain,
    storage,
    stable,
    carriage,
    node,
    driver: driver!,
    miners,
    crew,
    order,
    runUntil,
    idle,
    at,
    move,
    onCarriage,
    inStorage,
  }
}

describe('the PoC: iron from a far mine reaches home overnight', () => {
  it('runs a realm through the night with a far iron mine and a haul route', () => {
    const s = scenario()
    const { world, storage, stable, carriage, node, driver, miners, crew, order, runUntil } = s

    // Evening. The driver fetches the carriage; the miners walk into the city to the storage.
    order({ kind: 'walkTo', residentId: driver.id, x: stable.x, y: stable.y })
    for (const m of miners) order({ kind: 'walkTo', residentId: m.id, x: storage.x, y: storage.y })
    runUntil(s.idle(crew), TICKS_PER_GAME_DAY)
    order({
      kind: 'drive',
      residentId: driver.id,
      carriageId: carriage.id,
      x: storage.x,
      y: storage.y,
    })
    runUntil(() => s.idle([driver])() && s.at(driver, storage), TICKS_PER_GAME_DAY)

    // The mine's materials go on the carriage, and Food for the horse, which eats from the
    // carriage's load on the way. The miners take Food for the walk and the building, the driver
    // for the night.
    s.move(miners[0]!, { wood: 20 }, s.inStorage, s.onCarriage)
    s.move(miners[1]!, { wood: 20 }, s.inStorage, s.onCarriage)
    s.move(miners[2]!, { stone: 20 }, s.inStorage, s.onCarriage)
    s.move(miners[3]!, { food: HORSE_FOOD }, s.inStorage, s.onCarriage)
    for (const m of miners) {
      order({ kind: 'pickUp', residentId: m.id, spot: s.inStorage, goods: { food: MINER_FOOD } })
    }
    order({
      kind: 'pickUp',
      residentId: driver.id,
      spot: s.inStorage,
      goods: { food: DRIVER_FOOD },
    })
    runUntil(s.idle(crew), 10)

    // Off to the node: the miners walk, the driver drives the materials there.
    order({ kind: 'drive', residentId: driver.id, carriageId: carriage.id, x: node.x, y: node.y })
    for (const m of miners) order({ kind: 'walkTo', residentId: m.id, x: node.x, y: node.y })
    runUntil(() => crew.every((r) => r.order === null && s.at(r, node)), 3 * TICKS_PER_GAME_DAY)

    // The miners lay out the mine and build it; the driver unloads the materials onto the site.
    order({ kind: 'build', residentId: miners[0]!.id, building: 'mine' })
    runUntil(() => world.buildings.some((b) => s.at(b, node)), 10)
    const mine = world.buildings.find((b) => s.at(b, node))!
    for (const m of miners.slice(1)) order({ kind: 'build', residentId: m.id, building: 'mine' })
    s.move(driver, { wood: 40, stone: 20 }, s.onCarriage, { kind: 'site', siteId: mine.id })
    runUntil(() => !mine.site, 3 * TICKS_PER_GAME_DAY)
    runUntil(s.idle(miners), 10)

    // Night falls: the miners work the mine, the driver hauls its ore home and Food back out to
    // it, where the miners take their meals (`CONTEXT.md`: Refilling at a workplace).
    for (const m of miners) order({ kind: 'workAt', residentId: m.id })
    order({
      kind: 'haul',
      residentId: driver.id,
      carriageId: carriage.id,
      x: storage.x,
      y: storage.y,
      goods: ['ironOre'],
      returnGoods: ['food'],
      keepFood: HAUL_KEEP_FOOD,
    })
    const evening = world.tick
    const dug = () =>
      (storage.stock?.ironOre ?? 0) +
      (pileAt(world, node.x, node.y)?.goods.ironOre ?? 0) +
      (carriage.load.ironOre ?? 0) +
      crew.reduce((n, r) => n + (r.carried.ironOre ?? 0), 0)

    // The Player sleeps; nobody gives an order all night.
    runUntil(() => world.tick >= evening + NIGHT, NIGHT)

    // Morning: everyone is alive and still at it, and most of the night's iron ore is home.
    expect(world.realms).toHaveLength(1)
    for (const r of crew) {
      expect(world.residents).toContain(r)
      expect(r.health).toBe(MAX_HEALTH)
    }
    for (const m of miners) expect(m.order).toMatchObject({ kind: 'workAt', buildingId: mine.id })
    expect(driver.order).toMatchObject({ kind: 'haul', goods: ['ironOre'] })
    expect(world.horses.find((h) => h.id === carriage.horseId)).toBeDefined()
    expect(storage.stock?.ironOre ?? 0).toBeGreaterThanOrEqual(MORNING_ORE)
    expect(storage.stock!.ironOre! / dug()).toBeGreaterThan(0.6)
    expect(checkInvariants(world, s.terrain)).toEqual([])
  }, 120_000)
})
