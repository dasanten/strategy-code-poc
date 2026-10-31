import { parse, run, type ScriptObject } from '@csp/lang'
import {
  SCRIPT_MAX_CALL_DEPTH,
  SCRIPT_VALUE_LIMITS,
  SKILL_MAX,
  TICKS_PER_GAME_DAY,
  TICKS_PER_GAME_YEAR,
  TRAIN_SKILL_FACTOR,
  TRAIN_STAT_PER_TICK,
  TRAINING_GROUND_MAX_TRAINEES,
  Terrain,
  WORK_SKILL_PER_DAY,
  statValue,
  trainedCap,
  traineesOf,
  type Building,
  type Resident,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants, traineesSound } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { bindScript } from './script-bindings.js'
import { entitiesInSight } from './sight.js'
import { refillSource } from './survival.js'
import { defaultScripts } from './test-default-scripts.js'
import { createWorld, stepWorld } from './world.js'

const terrain: TerrainMap = { size: 16, tiles: new Uint8Array(16 * 16).fill(Terrain.Plains) }
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }
const tasks = defaultScripts(terrain, [me])
const WEEK = 7 * TICKS_PER_GAME_DAY

/**
 * Realm r1 (Player 7) with a finished training ground g1 on (3, 3) to (5, 5); on it the teacher
 * Tea (t1, Strength 15) and the trainees Ann (a1), Bo (a2) and Cy (a3), Strength and Intellect 10.
 * Dee (a4) stands on it too, as a fourth.
 */
function setup() {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 't1' })
  const ground: Building = { id: 'g1', kind: 'trainingGround', cityId: null, x: 3, y: 3 }
  world.buildings.push(ground)
  const tea = resident(world, 't1', 'Tea', 4, 4)
  tea.stats.strength = { base: 15, trained: 0 }
  const ann = resident(world, 'a1', 'Ann', 3, 3)
  const bo = resident(world, 'a2', 'Bo', 5, 5)
  const cy = resident(world, 'a3', 'Cy', 3, 5)
  const dee = resident(world, 'a4', 'Dee', 5, 3)
  return { world, ground, tea, ann, bo, cy, dee, queue: new OrderQueue(tasks.kinds, terrain) }
}

function resident(world: WorldState, id: string, name: string, x: number, y: number) {
  const r = newResident(mulberry32(world.residents.length + 1), { id, owner: 'r1', x, y, tick: 0 })
  r.name = name
  r.bornAt = -20 * TICKS_PER_GAME_YEAR
  r.lifespan = 60
  r.stats.strength = { base: 10, trained: 0 }
  r.stats.intellect = { base: 10, trained: 0 }
  r.skills = {}
  world.residents.push(r)
  return r
}

/** Sends an order and, if accepted, applies it; answers 'ack' or why it was rejected. */
function order(world: WorldState, queue: OrderQueue, o: object) {
  const answer = queue.receive(world, me, 'q', o)
  queue.applyAll(world)
  return answer.type === 'ack' ? 'ack' : (answer as { reason: string }).reason
}

const train = (residentId: string, buildingId = 'g1') => ({ kind: 'train', residentId, buildingId })
const teach = (subject = 'strength') => ({
  kind: 'teach',
  residentId: 't1',
  buildingId: 'g1',
  subject,
})

/** Runs scripts and steps the world, keeping residents fed. */
function step(world: WorldState, ticks = 1) {
  for (let i = 0; i < ticks; i++) {
    for (const r of world.residents) r.hunger = 100
    expect(tasks.runAll(world)).toEqual([])
    stepWorld(world, terrain)
  }
}

/** What a stat counts for now. */
const value = (world: WorldState, r: Resident, stat: 'strength' = 'strength') =>
  statValue(r, stat, world.tick)

describe('training (`CONTEXT.md`: Trainee, Training)', () => {
  it('three trainees gain over a game week, at the pace their Intellect sets', () => {
    const { world, tea, ann, bo, cy, queue } = setup()
    cy.stats.intellect = { base: 15, trained: 0 }
    expect(order(world, queue, teach())).toBe('ack')
    for (const id of ['a1', 'a2', 'a3']) expect(order(world, queue, train(id))).toBe('ack')
    expect(ann.order).toEqual({ kind: 'train', buildingId: 'g1', learning: 'strength' })
    step(world, WEEK)
    const week = WEEK * TRAIN_STAT_PER_TICK
    expect(ann.stats.strength.trained).toBeCloseTo(week, 6)
    expect(bo.stats.strength.trained).toBeCloseTo(week, 6)
    // Cy's Intellect of 15 learns half again as fast.
    expect(cy.stats.strength.trained).toBeCloseTo(week * 1.5, 6)
    // The teacher gains nothing.
    expect(tea.stats.strength.trained).toBe(0)
    expect(ann.order).toMatchObject({ kind: 'train', learning: 'strength' })
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('a trainee stops at their cap and at the teacher’s value, and waits', () => {
    const { world, tea, ann, bo, queue } = setup()
    ann.stats.strength = { base: 8, trained: trainedCap(8) - 100 * TRAIN_STAT_PER_TICK }
    bo.stats.strength = { base: 14, trained: 0 }
    tea.stats.strength = { base: 14, trained: 300 * TRAIN_STAT_PER_TICK }
    order(world, queue, teach())
    order(world, queue, train('a1'))
    order(world, queue, train('a2'))
    step(world, 500)
    expect(ann.stats.strength.trained).toBe(trainedCap(8))
    expect(value(world, bo)).toBeCloseTo(value(world, tea), 9)
    expect(ann.order).toMatchObject({ kind: 'train', learning: null })
    expect(bo.order).toMatchObject({ kind: 'train', learning: null })
    step(world, 100)
    expect(ann.stats.strength.trained).toBe(trainedCap(8))
    expect(value(world, bo)).toBeLessThanOrEqual(value(world, tea) + 1e-9)
  })

  it('teaches nothing without a teacher, nor a stronger trainee', () => {
    const { world, tea, ann, bo, queue } = setup()
    order(world, queue, train('a1'))
    step(world, 100)
    expect(ann.stats.strength.trained).toBe(0)
    expect(ann.order).toMatchObject({ kind: 'train', learning: null })
    tea.stats.strength = { base: 8, trained: 0 }
    order(world, queue, teach())
    order(world, queue, train('a2'))
    step(world, 100)
    expect(ann.stats.strength.trained).toBe(0)
    expect(bo.stats.strength.trained).toBe(0)
  })

  it('trains a skill toward the teacher’s, faster than by doing, never past its maximum', () => {
    const { world, tea, ann, bo, queue } = setup()
    tea.skills = { mining: 50 }
    order(world, queue, teach('mining'))
    order(world, queue, train('a1'))
    step(world, TICKS_PER_GAME_DAY)
    expect(ann.skills.mining).toBeCloseTo(WORK_SKILL_PER_DAY * TRAIN_SKILL_FACTOR, 6)
    // A veteran past Combat's most takes a recruit only up to it.
    tea.skills = { combat: SKILL_MAX.combat + 10 }
    bo.skills = { combat: SKILL_MAX.combat - 0.001 }
    order(world, queue, teach('combat'))
    order(world, queue, train('a2'))
    step(world, TICKS_PER_GAME_DAY)
    expect(bo.skills.combat).toBe(SKILL_MAX.combat)
    expect(ann.skills.combat).toBeGreaterThan(0)
    expect(bo.order).toMatchObject({ learning: null })
  })

  it('is refused for a child, off the ground, at a site, and at a full ground', () => {
    const { world, ground, ann, bo, queue } = setup()
    ann.bornAt = world.tick
    expect(order(world, queue, train('a1'))).toBe('children can’t train')
    bo.x = 9
    expect(order(world, queue, train('a2'))).toBe('there is no training ground here')
    bo.x = 5
    world.buildings.push({ id: 'f1', kind: 'farm', cityId: null, x: 8, y: 5 })
    expect(order(world, queue, train('a2', 'f1'))).toBe(
      'stand on the training ground to train there',
    )
    ground.site = { delivered: {}, work: 0 }
    expect(order(world, queue, train('a2'))).toBe('it is still a construction site')
    delete ground.site
    expect(order(world, queue, train('a2'))).toBe('ack')
    expect(order(world, queue, train('a2'))).toBe('already training here')
    expect(ann.order).toBeNull()
  })

  it('refuses the fourth trainee at a full ground, also within one tick', () => {
    const { world, ground, dee, queue } = setup()
    for (const id of ['a1', 'a2', 'a3']) expect(order(world, queue, train(id))).toBe('ack')
    expect(order(world, queue, train('a4'))).toBe(
      `the training ground has room for ${TRAINING_GROUND_MAX_TRAINEES} trainees`,
    )
    expect(dee.order).toBeNull()
    const fresh = setup()
    for (const id of ['a1', 'a2', 'a3', 'a4']) {
      expect(fresh.queue.receive(fresh.world, me, id, train(id)).type).toBe('ack')
    }
    fresh.queue.applyAll(fresh.world)
    expect(traineesOf(fresh.ground, fresh.world.residents).map((r) => r.id)).toEqual([
      'a1',
      'a2',
      'a3',
    ])
    expect(traineesOf(ground, world.residents)).toHaveLength(TRAINING_GROUND_MAX_TRAINEES)
  })

  it('is refused for another realm’s resident, and NPC cities train nobody', () => {
    const { world, ann, queue } = setup()
    ann.owner = 'r2'
    expect(order(world, queue, train('a1'))).toBe('not one of your residents')
    const npc = { userId: 0, account: { name: 'Elm', isAdmin: false }, npcCityId: 'c9' }
    expect(queue.receive(world, npc, 'q', train('a2'))).toMatchObject({ type: 'rejected' })
  })

  it('ends on walking off the ground, or when it is gone', () => {
    const { world, ann, bo, queue } = setup()
    order(world, queue, train('a1'))
    order(world, queue, train('a2'))
    ann.x = 9
    step(world)
    expect(ann.order).toBeNull()
    expect(bo.order).toMatchObject({ kind: 'train' })
    world.buildings = []
    step(world)
    expect(bo.order).toBeNull()
  })

  it('refills from Food on the ground’s tile, as at a workplace', () => {
    const { world, ann, tea, queue } = setup()
    world.piles.push({ id: 'p1', x: 3, y: 3, goods: { food: 4 } })
    expect(refillSource(world, ann, terrain.size)).toBeUndefined()
    order(world, queue, train('a1'))
    order(world, queue, teach())
    expect(refillSource(world, ann, terrain.size)?.food).toBe(4)
    expect(refillSource(world, tea, terrain.size)?.food).toBe(4)
  })

  it('keeps every invariant over a long run, the teacher switching subjects', () => {
    const { world, tea, ann, bo, cy, queue } = setup()
    tea.skills = { combat: 15 }
    ann.stats.strength.trained = trainedCap(10) - 0.01
    bo.skills = { combat: 14.9 }
    cy.stats.intellect = { base: 15, trained: 7 }
    order(world, queue, teach())
    for (const id of ['a1', 'a2', 'a3']) order(world, queue, train(id))
    for (let day = 0; day < 6; day++) {
      if (day === 3) order(world, queue, teach('combat'))
      for (let i = 0; i < 4; i++) {
        step(world, TICKS_PER_GAME_DAY / 4)
        expect(checkInvariants(world, terrain)).toEqual([])
      }
    }
    expect(ann.stats.strength.trained).toBe(trainedCap(10))
    expect(bo.skills.combat).toBe(15)
    expect(cy.skills.combat).toBeGreaterThan(0)
    expect(tea.stats.strength.trained).toBe(0)
  })
})

describe('trainees sound (ADR 0004)', () => {
  it('flags a trainee off the ground, at no ground, and one too many', () => {
    const { world, ann, bo, cy, dee } = setup()
    for (const r of [ann, bo, cy, dee])
      r.order = { kind: 'train', buildingId: 'g1', learning: null }
    expect(traineesSound.check(world, terrain)).toEqual([
      expect.objectContaining({ entityIds: ['a1', 'a2', 'a3', 'a4'] }),
    ])
    dee.order = { kind: 'train', buildingId: 'gone', learning: null }
    ann.x = 9
    expect(traineesSound.check(world, terrain).map((v) => v.entityIds)).toEqual([['a1'], ['a4']])
  })
})

describe('training in scripts', () => {
  function runAs(world: WorldState, source: string, memory: ScriptObject = {}) {
    const bindings = bindScript({
      world,
      terrain,
      sender: me,
      residentId: 'a2',
      memory,
      seen: () => entitiesInSight(world, terrain, 'r1'),
      explored: () => true,
    })
    run(parse(source), {
      globals: bindings.globals,
      steps: 10_000,
      maxCallDepth: SCRIPT_MAX_CALL_DEPTH,
      limits: SCRIPT_VALUE_LIMITS,
    })
    return { ...bindings, memory }
  }

  it('train() asks to train at the ground on my tile', () => {
    const { world } = setup()
    const { requests, memory } = runAs(world, 'memory.answer = train()')
    expect(memory.answer).toBeNull()
    expect(requests).toEqual([{ kind: 'train', residentId: 'a2', buildingId: 'g1' }])
  })

  it('the ground’s view lists its trainees', () => {
    const { world, queue } = setup()
    const source = 'memory.trainees = buildingAt(3, 3).trainees'
    expect(runAs(world, source).memory.trainees).toEqual([])
    order(world, queue, train('a1'))
    order(world, queue, train('a3'))
    expect(runAs(world, source).memory.trainees).toEqual(['a1', 'a3'])
  })
})

describe('the Train default', () => {
  const give = (world: WorldState, queue: OrderQueue, more: object = {}) =>
    order(world, queue, { kind: 'task', task: 'train', residentId: 'a1', groundId: 'g1', ...more })

  it('trains at the ground, waiting with a Doing note while no teacher is there', () => {
    const { world, ann, queue } = setup()
    expect(give(world, queue)).toBe('ack')
    expect(ann.script!.memory).toEqual({ groundId: 'g1' })
    step(world, 2)
    expect(ann.order).toMatchObject({ kind: 'train', learning: null })
    expect(ann.script!.memory.doing).toBe('Waiting for a teacher')
    order(world, queue, teach())
    step(world, 2)
    expect(ann.order).toMatchObject({ kind: 'train', learning: 'strength' })
    // Training, the order's own line shows: "Training Strength".
    expect(ann.script!.memory.doing).toBeUndefined()
    step(world, 100)
    expect(ann.stats.strength.trained).toBeGreaterThan(0)
  })

  it('waits with a note at the ceiling', () => {
    const { world, ann, queue } = setup()
    ann.stats.strength.trained = trainedCap(10)
    order(world, queue, teach())
    give(world, queue)
    step(world, 2)
    expect(ann.script!.memory.doing).toBe('Waiting: learned all I can here')
  })

  it('ends once the ground teaches another subject than the one asked for', () => {
    const { world, ann, queue } = setup()
    give(world, queue, { subject: 'combat' })
    expect(ann.script!.memory).toEqual({ groundId: 'g1', subject: 'combat' })
    step(world, 2)
    expect(ann.order).toMatchObject({ kind: 'train' })
    order(world, queue, teach('strength'))
    step(world, 2)
    expect(ann.script).toBeUndefined()
  })

  it('is refused off the ground, for a child and for no stat or skill', () => {
    const { world, ann, queue } = setup()
    expect(give(world, queue, { subject: 'cooking' })).toBe('train a stat or a skill')
    ann.bornAt = world.tick
    expect(give(world, queue)).toBe('children can’t train')
    ann.bornAt = -20 * TICKS_PER_GAME_YEAR
    ann.x = 9
    expect(give(world, queue)).toBe('there is no training ground here')
  })
})
