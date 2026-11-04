import {
  RECIPES,
  Terrain,
  TICKS_PER_GAME_DAY,
  WORK_SKILL_MAX,
  WORKPLACE_SKILL,
  madePerDay,
  pileAt,
  ticksForAge,
  type BuildingKind,
  type Good,
  type TerrainMap,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { createWorld, stepWorld } from './world.js'

/** Plains, with Hills at (2, 2) for the mine on its node. */
const terrain: TerrainMap = { size: 16, tiles: new Uint8Array(16 * 16).fill(Terrain.Plains) }
terrain.tiles[2 * 16 + 2] = Terrain.Hills
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }
const DAYS = 10

describe('what a workplace’s card says is made (`CONTEXT.md`: Workplace amounts)', () => {
  it.each<[BuildingKind, Good, Good | undefined]>([
    ['farm', 'food', undefined],
    ['mine', 'ironOre', undefined],
    ['smelter', 'iron', undefined],
    ['mint', 'coins', undefined],
    ['smithy', 'sword', 'sword'],
  ])('a simulated worker at a %s makes that much %s a game day', (kind, good, makes) => {
    const world = createWorld(terrain)
    world.realms.push({ id: 'r1', userId: 7, leaderId: 'w1' })
    if (kind === 'mine') world.nodes.push({ id: 'n1', kind: 'ironOre', x: 2, y: 2 })
    world.buildings.push({ id: 'b1', kind, cityId: null, x: 2, y: 2 })
    // More than they use in the time, so they have what they need.
    const input = RECIPES[kind]?.find((r) => r.output[good] !== undefined)?.input
    if (input) {
      const goods = Object.fromEntries(Object.keys(input).map((g) => [g, 10_000]))
      world.piles.push({ id: 'p1', x: 2, y: 2, goods })
    }
    const r = newResident(mulberry32(1), { id: 'w1', owner: 'r1', x: 2, y: 2, tick: 0 })
    r.bornAt = world.tick - ticksForAge(30)
    r.stats.strength = { base: 13, trained: 0 }
    // At the skill's cap, so what they learn at work doesn't change the pace meanwhile.
    r.skills[WORKPLACE_SKILL[kind]!] = WORK_SKILL_MAX
    world.residents.push(r)
    const queue = new OrderQueue()
    queue.receive(world, me, 'q', { kind: 'workAt', residentId: 'w1', makes })
    queue.applyAll(world)
    expect(r.order).toMatchObject({ kind: 'workAt', buildingId: 'b1' })
    const perDay = madePerDay(r, kind, good, world.tick)

    // What lands on the pile taken off at once, so Food doesn't spoil before it is counted.
    let made = 0
    for (let i = 0; i < DAYS * TICKS_PER_GAME_DAY; i++) {
      r.hunger = 100
      stepWorld(world, terrain)
      const pile = pileAt(world, 2, 2)
      made += pile?.goods[good] ?? 0
      if (pile) delete pile.goods[good]
    }

    expect(r.order).toMatchObject({ kind: 'workAt', buildingId: 'b1' })
    // Whole units or batches at a time: up to a batch short of the pace, never over it.
    const batch = RECIPES[kind]?.find((x) => x.output[good] !== undefined)?.output[good] ?? 1
    expect(made).toBeLessThanOrEqual(perDay * DAYS + 1e-6)
    expect(made).toBeGreaterThanOrEqual(perDay * DAYS - batch - 1e-6)
    expect(perDay).toBeGreaterThan(0)
  })
})
