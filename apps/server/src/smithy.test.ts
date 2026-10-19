import {
  BATCHES_PER_DAY,
  BUILDABLE,
  BUILD_MATERIALS,
  BUILD_WORK,
  GOOD_WEIGHT,
  PROTECTION,
  PROTECTION_DEFENCE,
  RECIPES,
  Terrain,
  TICKS_PER_GAME_DAY,
  WEAPONS,
  WEAPON_ATTACK,
  WORKPLACE_SKILL,
  pileAt,
  recipeFor,
  recipeGood,
  stockWeight,
  workplaceGood,
  type Good,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants, workOrdersOnWorkplaces } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { createWorld, stepWorld } from './world.js'

const terrain: TerrainMap = { size: 16, tiles: new Uint8Array(16 * 16).fill(Terrain.Plains) }
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }
const ARMS = [...WEAPONS, ...PROTECTION] as const

/** A world with realm r1 (Player 7), a finished smithy at (2, 2) and resident w1 on it. */
function setup() {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'w1' })
  world.buildings.push({ id: 's1', kind: 'smithy', cityId: null, x: 2, y: 2 })
  const r = resident(world, 'w1')
  return { world, r, place: world.buildings[0]!, queue: new OrderQueue() }
}

/** A resident of r1 on (2, 2) with Strength, Intellect and Endurance 10. */
function resident(world: WorldState, id: string) {
  const r = newResident(mulberry32(world.residents.length + 1), {
    id,
    owner: 'r1',
    x: 2,
    y: 2,
    tick: 0,
  })
  r.stats.strength = { base: 10, trained: 0 }
  r.stats.intellect = { base: 10, trained: 0 }
  r.stats.endurance = { base: 10, trained: 0 }
  world.residents.push(r)
  return r
}

/** Sends a work-at order for resident `id` and answers whether it was taken. */
function work(world: WorldState, queue: OrderQueue, id: string, makes?: unknown) {
  const answer = queue.receive(world, me, 'q', { kind: 'workAt', residentId: id, makes })
  queue.applyAll(world)
  return answer.type === 'ack' ? 'ack' : (answer as { reason: string }).reason
}

/** Steps the world, keeping residents fed. */
function run(world: WorldState, ticks = 1) {
  for (let i = 0; i < ticks; i++) {
    for (const r of world.residents) r.hunger = 100
    stepWorld(world, terrain)
  }
}

/** All units of a good anywhere: carried and in piles. */
function total(world: WorldState, good: Good) {
  return (
    world.residents.reduce((n, r) => n + (r.carried[good] ?? 0), 0) +
    world.piles.reduce((n, p) => n + (p.goods[good] ?? 0), 0)
  )
}

describe('weapons and armour (balance file)', () => {
  it('a smithy has one recipe from Iron and Wood for each weapon and piece of armour', () => {
    const recipes = RECIPES.smithy!
    expect(recipes.map(recipeGood)).toEqual([...ARMS])
    for (const r of recipes) {
      expect(Object.keys(r.input).sort()).toEqual(['iron', 'wood'])
      expect(r.output).toEqual({ [recipeGood(r)]: 1 })
      // Nothing is lost or gained in weight at the anvil.
      expect(stockWeight(r.input)).toBe(GOOD_WEIGHT[recipeGood(r)])
    }
    expect(BATCHES_PER_DAY.smithy).toBeGreaterThan(0)
    expect(WORKPLACE_SKILL.smithy).toBe('smithing')
  })

  it('weapons attack, shields and armour defend, and all of them weigh something', () => {
    for (const w of WEAPONS) expect(WEAPON_ATTACK[w]).toBeGreaterThan(0)
    for (const p of PROTECTION) expect(PROTECTION_DEFENCE[p]).toBeGreaterThan(0)
    for (const g of ARMS) expect(GOOD_WEIGHT[g]).toBeGreaterThan(0)
  })

  it('a smithy can be built off nodes, from stone, wood and iron', () => {
    expect(BUILDABLE).toContain('smithy')
    expect(BUILD_MATERIALS.smithy).toMatchObject({ iron: expect.any(Number) })
    expect(BUILD_WORK.smithy).toBeGreaterThan(0)
  })
})

describe('the smithy', () => {
  it.each(ARMS)('turns the iron and wood its worker carries into %s on its pile', (made) => {
    const { world, r, queue } = setup()
    expect(work(world, queue, 'w1', made)).toBe('ack')
    expect(r.order).toMatchObject({ kind: 'workAt', makes: made })
    expect(workplaceGood(world, world.buildings[0]!, made)).toBe(made)
    r.carried = { iron: 20, wood: 10 }
    run(world, TICKS_PER_GAME_DAY + 2)
    const batches = BATCHES_PER_DAY.smithy!
    const recipe = recipeFor('smithy', made)!
    expect(pileAt(world, 2, 2)?.goods[made]).toBe(batches)
    expect(r.carried.iron).toBe(20 - batches * recipe.input.iron!)
    expect(r.carried.wood).toBe(10 - batches * recipe.input.wood!)
    expect(r.skills.smithing).toBeCloseTo(1, 1)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('uses the pile on its tile and conserves weight by the recipe', () => {
    const { world, queue } = setup()
    resident(world, 'w2')
    expect(work(world, queue, 'w1', 'sword')).toBe('ack')
    expect(work(world, queue, 'w2', 'shield')).toBe('ack')
    world.piles.push({ id: 'p1', x: 2, y: 2, goods: { iron: 30, wood: 30 } })
    const weight = (w: WorldState) =>
      (['iron', 'wood', 'sword', 'shield'] as const).reduce(
        (kg, g) => kg + total(w, g) * GOOD_WEIGHT[g],
        0,
      )
    const before = weight(world)
    for (let half = 0; half < 4; half++) {
      run(world, TICKS_PER_GAME_DAY / 2)
      expect(weight(world)).toBe(before)
      expect(checkInvariants(world, terrain)).toEqual([])
    }
    expect(total(world, 'sword')).toBeGreaterThan(0)
    expect(total(world, 'shield')).toBeGreaterThan(0)
  })

  it('stands idle without the input for what the worker makes', () => {
    const { world, r, queue } = setup()
    expect(work(world, queue, 'w1', 'armour')).toBe('ack')
    r.carried = { iron: 6, wood: 5 }
    run(world, TICKS_PER_GAME_DAY)
    expect(r.order).toMatchObject({ kind: 'workAt', progress: 0 })
    expect(r.skills.smithing ?? 0).toBe(0)
    expect(r.carried).toEqual({ iron: 6, wood: 5 })
  })

  it('a worker can switch to making something else', () => {
    const { world, r, queue } = setup()
    expect(work(world, queue, 'w1', 'spear')).toBe('ack')
    expect(work(world, queue, 'w1', 'spear')).toBe('already working here')
    expect(work(world, queue, 'w1', 'shield')).toBe('ack')
    expect(r.order).toMatchObject({ kind: 'workAt', makes: 'shield' })
  })

  it('turns down an order that says nothing, or something it can’t make', () => {
    const { world, queue } = setup()
    expect(work(world, queue, 'w1')).toMatch(/say what to make/)
    expect(work(world, queue, 'w1', 'iron')).toMatch(/can't make iron/)
    expect(work(world, queue, 'w1', 'gold')).toBe('no such good')
    expect(work(world, queue, 'w1', 7)).toBe('no such good')
  })

  it('a smelter takes no choice', () => {
    const { world, queue } = setup()
    world.buildings[0]!.kind = 'smelter'
    expect(work(world, queue, 'w1', 'iron')).toMatch(/nothing to choose/)
    expect(work(world, queue, 'w1')).toBe('ack')
  })

  it('the invariant catches a smithy worker making nothing, or a choice where there is none', () => {
    const { world, r } = setup()
    r.order = { kind: 'workAt', buildingId: 's1', at: { x: 2, y: 2 }, progress: 0 }
    expect(workOrdersOnWorkplaces.check(world, terrain)[0]?.message).toMatch(/making nothing/)
    r.order.makes = 'iron'
    expect(workOrdersOnWorkplaces.check(world, terrain)[0]?.message).toMatch(/can't make iron/)
    r.order.makes = 'spear'
    expect(workOrdersOnWorkplaces.check(world, terrain)).toEqual([])
    world.buildings[0]!.kind = 'smelter'
    expect(workOrdersOnWorkplaces.check(world, terrain)[0]?.message).toMatch(/nothing to choose/)
  })
})
