import {
  HAUL_KEEP_FOOD,
  Terrain,
  TICKS_PER_GAME_DAY,
  carryCapacity,
  pileAt,
  statValue,
  terrainAt,
  unitsThatFit,
  type Building,
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

  // The Leader stays home on the farm; the next resident drives, the four strongest of the rest mine.
  const [, driver, ...rest] = world.residents.filter((r) => r.owner === realm.id)
  const miners = rest
    .sort((a, b) => statValue(b, 'strength', 0) - statValue(a, 'strength', 0))
    .slice(0, 4)
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

    // The mine's materials go on the carriage; the miners take Food for the night.
    s.move(miners[0]!, { wood: 20 }, s.inStorage, s.onCarriage)
    s.move(miners[1]!, { wood: 20 }, s.inStorage, s.onCarriage)
    s.move(miners[2]!, { stone: 20 }, s.inStorage, s.onCarriage)
    // And Food for the horse, which eats from the carriage's load until it is back home.
    s.move(miners[3]!, { food: HAUL_KEEP_FOOD }, s.inStorage, s.onCarriage)
    console.log('loaded', world.tick)
    for (const m of miners) {
      const food = unitsThatFit(m, 'food', world.tick)
      order({ kind: 'pickUp', residentId: m.id, spot: s.inStorage, goods: { food } })
    }
    runUntil(s.idle(miners), 10)

    // Off to the node: the miners walk, the driver drives the materials there.
    order({ kind: 'drive', residentId: driver.id, carriageId: carriage.id, x: node.x, y: node.y })
    for (const m of miners) order({ kind: 'walkTo', residentId: m.id, x: node.x, y: node.y })
    runUntil(() => crew.every((r) => r.order === null && s.at(r, node)), 3 * TICKS_PER_GAME_DAY)

    console.log('arrived', world.tick)
    // The miners lay out the mine and build it; the driver unloads the materials onto the site.
    order({ kind: 'build', residentId: miners[0]!.id, building: 'mine' })
    runUntil(() => world.buildings.some((b) => s.at(b, node)), 10)
    const site = world.buildings.find((b) => b.x === node.x && b.y === node.y)! as Building
    for (const m of miners.slice(1)) order({ kind: 'build', residentId: m.id, building: 'mine' })
    s.move(driver, { wood: 40, stone: 20 }, s.onCarriage, { kind: 'site', siteId: site.id })
    runUntil(() => !site.site, 3 * TICKS_PER_GAME_DAY)
    runUntil(s.idle(miners), 10)

    console.log('built', world.tick)
    // Night falls: the miners work the mine, the driver hauls its ore home, the Player sleeps.
    for (const m of miners) order({ kind: 'workAt', residentId: m.id })
    order({
      kind: 'haul',
      residentId: driver.id,
      carriageId: carriage.id,
      x: storage.x,
      y: storage.y,
      goods: ['ironOre'],
      keepFood: HAUL_KEEP_FOOD,
    })
    const evening = world.tick
    const oreAtHome = () => storage.stock?.ironOre ?? 0
    const report = () => ({
      hours: Math.round((world.tick - evening) / 150),
      home: oreAtHome(),
      pile: pileAt(world, node.x, node.y)?.goods,
      onCarriage: carriage.load,
      miners: miners.map((m) => ({
        cap: Math.round(carryCapacity(m, world.tick)),
        carried: m.carried,
        hunger: Math.round(m.hunger),
        health: Math.round(m.health),
        alive: world.residents.includes(m),
      })),
      driver: { carried: driver.carried, order: driver.order?.kind },
    })
    for (let day = 0; day < 8; day++) {
      runUntil(() => world.tick >= evening + (day + 1) * TICKS_PER_GAME_DAY, TICKS_PER_GAME_DAY + 1)
      console.log(JSON.stringify(report()))
    }
    expect(world.tick - evening).toBe(NIGHT)
  }, 600_000)
})
