import {
  BUILD_MATERIALS,
  BUILD_WORK,
  Terrain,
  buildWork,
  constructionLearned,
  ticksForAge,
  type Building,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import {
  buildOrdersOnSites,
  buildingsInPlace,
  checkInvariants,
  sitesWithinNeeds,
} from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { createWorld, stepWorld } from './world.js'

/** Plains, with forest at (3, 3) and (4, 4) and hills at (6, 6) and (10, 10). */
function map(): TerrainMap {
  const tiles = new Uint8Array(16 * 16).fill(Terrain.Plains)
  tiles[3 * 16 + 3] = Terrain.Forest
  tiles[4 * 16 + 4] = Terrain.Forest
  tiles[6 * 16 + 6] = Terrain.Hills
  tiles[10 * 16 + 10] = Terrain.Hills
  return { size: 16, tiles }
}
const terrain = map()
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }
const stranger = { userId: 8, account: { name: 'Tobin', isAdmin: false } }

/**
 * A world on a small map: a forest node at (3, 3), a stone node at (6, 6) and an iron ore node at
 * (10, 10); realm r1 (Player 7) with resident w1 standing on the forest node, Strength 10.
 */
function setup() {
  const world = createWorld({ size: 16, tiles: new Uint8Array(16 * 16).fill(Terrain.Plains) })
  world.nodes = [
    { id: 'n1', kind: 'forest', x: 3, y: 3 },
    { id: 'n2', kind: 'stone', x: 6, y: 6 },
    { id: 'n3', kind: 'ironOre', x: 10, y: 10 },
  ]
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'w1' })
  const r = resident(world, 'w1', 3, 3)
  return { world, r, queue: new OrderQueue() }
}

function resident(world: WorldState, id: string, x: number, y: number) {
  const r = newResident(mulberry32(world.residents.length + 1), { id, owner: 'r1', x, y, tick: 0 })
  r.stats.strength = { base: 10, trained: 0 }
  r.stats.intellect = { base: 10, trained: 0 }
  world.residents.push(r)
  return r
}

/** Steps the world, keeping residents fed so long builds don't starve them. */
function run(world: WorldState, ticks = 1) {
  for (let i = 0; i < ticks; i++) {
    for (const r of world.residents) r.hunger = 100
    stepWorld(world, terrain)
  }
}

const buildOrder = (building: string, residentId = 'w1') => ({
  kind: 'build',
  residentId,
  building,
})

/** Sends an order, and if accepted runs the tick that starts it. */
function order(world: WorldState, queue: OrderQueue, o: object, sender = me) {
  const answer = queue.receive(world, sender, 'q', o)
  queue.applyAll(world)
  run(world)
  return answer
}

const siteOf = (world: WorldState) => world.buildings.find((b) => b.site)

describe('build order', () => {
  it('lays out a construction site on the node in the next tick, of no city', () => {
    const { world, r, queue } = setup()
    expect(queue.receive(world, me, 'q1', buildOrder('lumberCamp'))).toEqual({
      type: 'ack',
      requestId: 'q1',
    })
    expect(world.buildings).toEqual([])
    queue.applyAll(world)
    expect(r.order).toEqual({
      kind: 'build',
      building: 'lumberCamp',
      at: { x: 3, y: 3 },
      siteId: null,
    })
    run(world)
    const site = siteOf(world)!
    expect(site).toMatchObject({ kind: 'lumberCamp', cityId: null, x: 3, y: 3 })
    expect(site.site).toEqual({ delivered: {}, work: 0 })
    expect(r.order).toMatchObject({ kind: 'build', siteId: site.id })
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('then works on the site: Strength and Construction add work, and Construction grows', () => {
    const { world, r, queue } = setup()
    order(world, queue, buildOrder('lumberCamp'))
    const per = buildWork(r, world.tick)
    expect(per).toBeCloseTo(1)
    run(world, 10)
    expect(siteOf(world)!.site!.work).toBeCloseTo(10 * per)
    expect(r.skills.construction).toBeCloseTo(10 * constructionLearned(r, world.tick))
    // A skilled, stronger resident works faster.
    const strong = structuredClone(r)
    strong.stats.strength.base = 15
    strong.skills.construction = 10
    expect(buildWork(strong, world.tick)).toBeCloseTo(1.5 * 1.5)
  })

  it('finishes a lumber camp once enough work is in, and the order is done', () => {
    const { world, r, queue } = setup()
    expect(BUILD_MATERIALS.lumberCamp).toEqual({})
    order(world, queue, buildOrder('lumberCamp'))
    const site = siteOf(world)!
    site.site!.work = BUILD_WORK.lumberCamp! - 2.5
    run(world, 2)
    expect(site.site).toBeDefined()
    run(world)
    expect(site.site).toBeUndefined()
    expect(world.buildings).toEqual([{ id: site.id, kind: 'lumberCamp', cityId: null, x: 3, y: 3 }])
    expect(r.order).toBeNull()
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('needs its materials too: delivered with the drop order, only what it still needs', () => {
    const { world, r, queue } = setup()
    r.x = r.y = 6
    order(world, queue, buildOrder('quarry'))
    const site = siteOf(world)!
    site.site!.work = BUILD_WORK.quarry!
    run(world, 3)
    expect(site.site).toBeDefined() // all work in, but no wood yet
    expect(r.order).toMatchObject({ kind: 'build', siteId: site.id })

    const need = BUILD_MATERIALS.quarry!.wood!
    const helper = resident(world, 'w2', 6, 6)
    helper.stats.strength = { base: 15, trained: 7 }
    helper.carried = { wood: need + 5, food: 3 }
    const spot = { kind: 'site', siteId: site.id }
    expect(
      queue.receive(world, me, 'f', { kind: 'drop', residentId: 'w2', spot, goods: { food: 3 } }),
    ).toMatchObject({ type: 'rejected', reason: 'the construction site needs none of those goods' })
    queue.receive(world, me, 'q', {
      kind: 'drop',
      residentId: 'w2',
      spot,
      goods: { wood: need + 5 },
    })
    queue.applyAll(world)
    run(world)
    expect(helper.carried).toEqual({ wood: 5, food: 3 })
    expect(site.site).toBeUndefined() // the builder's work finished it in the same tick
    expect(r.order).toBeNull()
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('lets delivered materials be taken again: they are goods like any others', () => {
    const { world, r, queue } = setup()
    r.x = r.y = 10
    order(world, queue, buildOrder('mine'))
    const site = siteOf(world)!
    site.site!.delivered = { wood: 10, stone: 4 }
    const spot = { kind: 'site', siteId: site.id }
    order(world, queue, { kind: 'pickUp', residentId: 'w1', spot, goods: { stone: 4 } })
    expect(r.carried).toEqual({ stone: 4 })
    expect(site.site!.delivered).toEqual({ wood: 10 })
  })

  it('lets another resident join the site, and two finish sooner than one', () => {
    const { world, queue } = setup()
    order(world, queue, buildOrder('lumberCamp'))
    const site = siteOf(world)!
    resident(world, 'w2', 3, 3)
    expect(queue.receive(world, me, 'j', buildOrder('lumberCamp', 'w2'))).toMatchObject({
      type: 'ack',
    })
    queue.applyAll(world)
    run(world) // w2 joins
    expect(world.residents[1]!.order).toMatchObject({ siteId: site.id })
    const before = site.site!.work
    run(world, 4)
    expect(site.site!.work - before).toBeCloseTo(8)
    expect(world.buildings).toHaveLength(1)
  })

  it('lays out the footprint from its north-west tile, the node on any tile; others join from any tile of it', () => {
    const { world, r, queue } = setup()
    // The forest node at (3, 3) is the south-east tile of a camp laid out from (2, 2).
    r.x = r.y = 2
    order(world, queue, buildOrder('lumberCamp'))
    const site = siteOf(world)!
    expect(site).toMatchObject({ kind: 'lumberCamp', x: 2, y: 2 })
    const w2 = resident(world, 'w2', 3, 2)
    expect(order(world, queue, buildOrder('lumberCamp', 'w2'))).toMatchObject({ type: 'ack' })
    expect(w2.order).toMatchObject({ kind: 'build', siteId: site.id })
    expect(world.buildings).toHaveLength(1)
    // A tile next to the footprint is not at the site: there, a camp would be a new one.
    resident(world, 'w3', 4, 2)
    expect(queue.receive(world, me, 'x', buildOrder('lumberCamp', 'w3'))).toMatchObject({
      type: 'rejected',
      reason: 'a lumberCamp goes with one tile on a fitting resource node',
    })
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('gathers goods lying on the footprint into the site’s one pile when it is laid out', () => {
    const { world, r, queue } = setup()
    r.x = r.y = 2
    world.piles.push(
      { id: 'p1', x: 3, y: 3, goods: { wood: 2 } },
      { id: 'p2', x: 2, y: 3, goods: { wood: 1, stone: 4 } },
      { id: 'p3', x: 4, y: 3, goods: { food: 5 } }, // just off it
    )
    order(world, queue, buildOrder('lumberCamp'))
    expect(siteOf(world)).toMatchObject({ x: 2, y: 2 })
    expect(world.piles.map((p) => [p.x, p.y, p.goods])).toEqual([
      [4, 3, { food: 5 }],
      [2, 2, { wood: 3, stone: 4 }],
    ])
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('stops when the resident leaves the tile; an unattended site stays for anyone', () => {
    const { world, r, queue } = setup()
    order(world, queue, buildOrder('lumberCamp'))
    r.x = 2
    run(world)
    expect(r.order).toBeNull()
    expect(siteOf(world)).toBeDefined()
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('rejects what cannot be built', () => {
    const { world, r, queue } = setup()
    const reject = (o: object, sender = me) => {
      const a = queue.receive(world, sender, 'x', o)
      return a.type === 'rejected' ? a.reason : 'ack'
    }
    expect(reject(buildOrder('lumberCamp'), stranger)).toBe('not one of your residents')
    expect(reject(buildOrder('storage'))).toBe('that can’t be built')
    expect(reject(buildOrder('quarry'))).toBe(
      'a quarry goes with one tile on a fitting resource node',
    )
    r.x = 1
    expect(reject(buildOrder('lumberCamp'))).toBe(
      'a lumberCamp goes with one tile on a fitting resource node',
    )
    r.x = 3
    r.bornAt = world.tick - ticksForAge(5)
    expect(reject(buildOrder('lumberCamp'))).toBe('children can’t build')
    r.bornAt = world.tick - ticksForAge(30)
    world.buildings.push({ id: 'b9', kind: 'lumberCamp', cityId: null, x: 3, y: 3 })
    expect(reject(buildOrder('lumberCamp'))).toBe('there is already a building there')
    world.buildings = [{ id: 'b9', kind: 'wall', cityId: null, x: 3, y: 3 }]
    expect(reject(buildOrder('lumberCamp'))).toBe('there is already a building there')
    // A wall on another tile of the camp's footprint is in the way too.
    world.buildings = [{ id: 'b9', kind: 'wall', cityId: null, x: 4, y: 4 }]
    expect(reject(buildOrder('lumberCamp'))).toBe('there is already a building there')
    expect(queue.size).toBe(0)
  })

  it('ends the order if the tile was taken before the site is laid out', () => {
    const { world, r, queue } = setup()
    queue.receive(world, me, 'q', buildOrder('lumberCamp'))
    queue.applyAll(world)
    world.buildings.push({ id: 'b9', kind: 'lumberCamp', cityId: null, x: 3, y: 3 })
    run(world)
    expect(r.order).toBeNull()
    expect(world.buildings).toHaveLength(1)
  })
})

describe('building invariants', () => {
  const site = (over: Partial<Building> = {}): Building => ({
    id: 'b1',
    kind: 'mine',
    cityId: null,
    x: 10,
    y: 10,
    site: { delivered: {}, work: 0 },
    ...over,
  })

  it('a site never holds more or other materials than it needs, nor too much work', () => {
    const { world } = setup()
    world.buildings.push(site({ site: { delivered: { wood: 41, food: 1 }, work: 0 } }))
    expect(sitesWithinNeeds.check(world, terrain)).toHaveLength(2)
    world.buildings = [site({ site: { delivered: {}, work: BUILD_WORK.mine! + 1 } })]
    expect(sitesWithinNeeds.check(world, terrain)).toHaveLength(1)
    world.buildings = [
      site({
        kind: 'lumberCamp',
        x: 3,
        y: 3,
        site: { delivered: {}, work: BUILD_WORK.lumberCamp! },
      }),
    ]
    expect(sitesWithinNeeds.check(world, terrain)).toHaveLength(1)
    world.buildings = [site()]
    expect(sitesWithinNeeds.check(world, terrain)).toEqual([])
  })

  it('workplaces stand on a node of their kind and belong to no city', () => {
    const { world } = setup()
    world.buildings.push(site({ x: 6, y: 6 }), site({ id: 'b2', cityId: 'c1' }))
    expect(buildingsInPlace.check(world, terrain).map((v) => v.message)).toEqual([
      'b1 is a mine off its node',
      'b2 is a mine of city c1',
      'b2 belongs to no city (c1)',
    ])
  })

  it('a builder stands on their site', () => {
    const { world, r } = setup()
    world.buildings.push(site())
    r.order = { kind: 'build', building: 'mine', at: { x: 3, y: 3 }, siteId: 'b1' }
    expect(buildOrdersOnSites.check(world, terrain)).toHaveLength(1)
    r.x = r.y = 10
    expect(buildOrdersOnSites.check(world, terrain)).toEqual([])
  })
})
