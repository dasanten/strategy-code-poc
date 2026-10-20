import {
  ADULT_AGE,
  CHILD_STAT_SPREAD,
  HOME_FOOD_LOW,
  STAT_NAMES,
  TICKS_PER_GAME_YEAR,
  canWork,
  type Resident,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { stepAging } from './aging.js'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { requestBirths, resolveBirths } from './pairing.js'
import { mulberry32, newChild } from './residents.js'
import { cityTerrain, worldWithCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { stepWorld } from './world.js'

const terrain = cityTerrain()
const me = { userId: 1, account: { name: 'Mara', isAdmin: false } }

/**
 * Player 1's starting city with food to spare, every resident 20 game years old so nobody dies
 * of old age while a child grows up, and a child born to the first two residents on the farm.
 */
function bornOnTheFarm() {
  const { world } = worldWithCity()
  world.buildings.find((b) => b.kind === 'storage')!.stock = { food: 100_000 }
  for (const r of world.residents) r.bornAt = world.tick - 20 * TICKS_PER_GAME_YEAR
  const [a, b] = world.residents as [Resident, Resident]
  const queue = new OrderQueue()
  queue.receive(world, me, 'q', { kind: 'pair', residentId: a.id, partnerId: b.id })
  queue.applyAll(world)
  world.tick += TICKS_PER_GAME_YEAR
  const [child] = resolveBirths(world, requestBirths(world))
  return { world, queue, child: child!, parents: [a, b] as const }
}

describe('children', () => {
  it('inherit each base stat as the parents’ average plus a small random amount, nothing more', () => {
    const { world, parents } = bornOnTheFarm()
    const [a, b] = parents
    a.stats.intellect = { base: 15, trained: 5 }
    b.stats.intellect = { base: 8, trained: 4 }
    a.skills = { farming: 9 }
    const offsets = new Map<number, number>()
    for (let seed = 0; seed < 500; seed++) {
      const child = newChild(mulberry32(seed), [a, b], {
        id: `c${seed}`,
        owner: a.owner,
        cityId: a.cityId!,
        x: a.x,
        y: a.y,
        tick: world.tick,
      })
      for (const s of STAT_NAMES) {
        const average = Math.round((a.stats[s].base + b.stats[s].base) / 2)
        const offset = child.stats[s].base - average
        expect(Math.abs(offset)).toBeLessThanOrEqual(CHILD_STAT_SPREAD)
        expect(child.stats[s].trained).toBe(0)
        offsets.set(offset, (offsets.get(offset) ?? 0) + 1)
      }
      expect(child.skills).toEqual({})
    }
    // The random amount takes every whole value in the spread, either way.
    expect([...offsets.keys()].sort((x, y) => x - y)).toEqual(
      Array.from({ length: 2 * CHILD_STAT_SPREAD + 1 }, (_, i) => i - CHILD_STAT_SPREAD),
    )
  })

  it('grow up at ADULT_AGE through aging, and only then can work', () => {
    const { world, queue, child } = bornOnTheFarm()
    const workAt = () => queue.receive(world, me, 'q', { kind: 'workAt', residentId: child.id })
    expect(canWork(child, world.tick)).toBe(false)
    expect(workAt()).toMatchObject({ type: 'rejected', reason: 'children can’t work' })

    world.tick = child.bornAt + ADULT_AGE * TICKS_PER_GAME_YEAR - 1
    expect(stepAging(world, terrain.size).grown).toEqual([])
    expect(workAt()).toMatchObject({ type: 'rejected', reason: 'children can’t work' })
    expect(world.events.some((e) => e.kind === 'grownUp')).toBe(false)

    // The running world's tick ages them past ADULT_AGE.
    world.tick--
    stepWorld(world, terrain)
    expect(world.tick).toBe(child.bornAt + ADULT_AGE * TICKS_PER_GAME_YEAR - 1)
    stepWorld(world, terrain)
    expect(canWork(child, world.tick)).toBe(true)
    expect(world.events.filter((e) => e.kind === 'grownUp')).toEqual([
      expect.objectContaining({ residentId: child.id, name: child.name, userId: me.userId }),
    ])
    expect(workAt()).toMatchObject({ type: 'ack' })
    queue.applyAll(world)
    expect(child.order).toMatchObject({ kind: 'workAt' })
    expect(checkInvariants(world, terrain)).toEqual([])

    // Growing up is logged once.
    stepWorld(world, terrain)
    expect(world.events.filter((e) => e.kind === 'grownUp')).toHaveLength(1)
  })

  it('can’t pick up or put down goods, but can walk home and be fed there', () => {
    const { world, queue, child } = bornOnTheFarm()
    const storage = world.buildings.find((b) => b.cityId === child.cityId && b.kind === 'storage')!
    const walking = new Walking(terrain)
    const send = (o: object) => queue.receive(world, me, 'q', { residentId: child.id, ...o })
    const carry = 'children can’t pick up or put down goods'
    world.piles.push({ id: 'p1', x: child.x, y: child.y, goods: { food: 5 } })
    expect(send({ kind: 'pickUp', spot: { kind: 'ground' }, goods: { food: 5 } })).toMatchObject({
      type: 'rejected',
      reason: carry,
    })
    child.carried = { food: 1 }
    expect(send({ kind: 'drop', spot: { kind: 'ground' }, goods: { food: 1 } })).toMatchObject({
      type: 'rejected',
      reason: carry,
    })

    // Born on the farm outside the wall, they walk home, where they take meals from storage.
    const home = { x: storage.x - 2, y: storage.y + 2 }
    expect(send({ kind: 'walkTo', ...home })).toMatchObject({ type: 'ack' })
    queue.applyAll(world)
    for (let t = 0; t < 5000 && (child.x !== home.x || child.y !== home.y); t++) {
      stepWorld(world, terrain, walking)
    }
    expect(child).toMatchObject(home)
    expect(child.carried.food).toBeGreaterThanOrEqual(HOME_FOOD_LOW)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('are watched by an invariant: a child holds no order only adults may hold', () => {
    const { world, child } = bornOnTheFarm()
    const farm = world.buildings.find((b) => b.kind === 'farm')!
    child.order = {
      kind: 'workAt',
      buildingId: farm.id,
      at: { x: child.x, y: child.y },
      progress: 0,
    }
    expect(checkInvariants(world, terrain)).toContainEqual(
      expect.objectContaining({ invariant: 'children-dont-work', entityIds: [child.id] }),
    )
  })
})
