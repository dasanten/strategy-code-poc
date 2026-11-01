import { parse, run, type ScriptObject } from '@csp/lang'
import {
  SCRIPT_MAX_CALL_DEPTH,
  SCRIPT_VALUE_LIMITS,
  TICKS_PER_GAME_YEAR,
  Terrain,
  teacherAt,
  type Building,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants, teachersSound } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { bindScript } from './script-bindings.js'
import { entitiesInSight } from './sight.js'
import { createWorld, stepWorld } from './world.js'

const terrain: TerrainMap = { size: 16, tiles: new Uint8Array(16 * 16).fill(Terrain.Plains) }
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/**
 * Realm r1 (Player 7) with a finished training ground g1 on (3, 3) to (5, 5), and grown residents
 * Ann (a1) and Bo (a2) standing on it.
 */
function setup() {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
  const ground: Building = { id: 'g1', kind: 'trainingGround', cityId: null, x: 3, y: 3 }
  world.buildings.push(ground)
  const ann = resident(world, 'a1', 'Ann', 3, 3)
  const bo = resident(world, 'a2', 'Bo', 5, 5)
  return { world, ground, ann, bo, queue: new OrderQueue(undefined, terrain) }
}

function resident(world: WorldState, id: string, name: string, x: number, y: number) {
  const r = newResident(mulberry32(world.residents.length + 1), { id, owner: 'r1', x, y, tick: 0 })
  r.name = name
  r.bornAt = -20 * TICKS_PER_GAME_YEAR
  r.lifespan = 60
  world.residents.push(r)
  return r
}

/** Sends an order and, if accepted, applies it; answers 'ack' or why it was rejected. */
function order(world: WorldState, queue: OrderQueue, o: object) {
  const answer = queue.receive(world, me, 'q', o)
  queue.applyAll(world)
  return answer.type === 'ack' ? 'ack' : (answer as { reason: string }).reason
}

const teach = (residentId: string, subject = 'strength', buildingId = 'g1') => ({
  kind: 'teach',
  residentId,
  buildingId,
  subject,
})

/** Steps the world, keeping residents fed. */
function step(world: WorldState, ticks = 1) {
  for (let i = 0; i < ticks; i++) {
    for (const r of world.residents) r.hunger = 100
    stepWorld(world, terrain)
  }
}

describe('the teach order (`CONTEXT.md`: Teacher)', () => {
  it('sets a grown resident on the ground to teach a stat or a skill, until ordered otherwise', () => {
    const { world, ground, ann, queue } = setup()
    expect(order(world, queue, teach('a1'))).toBe('ack')
    expect(ann.order).toEqual({ kind: 'teach', buildingId: 'g1', subject: 'strength' })
    expect(teacherAt(ground, world.residents)).toBe(ann)
    step(world, 5)
    expect(ann.order).toEqual({ kind: 'teach', buildingId: 'g1', subject: 'strength' })
    expect(checkInvariants(world, terrain)).toEqual([])
    // The teacher may switch subjects; a skill is a subject too.
    expect(order(world, queue, teach('a1', 'combat'))).toBe('ack')
    expect(ann.order).toMatchObject({ kind: 'teach', subject: 'combat' })
    expect(order(world, queue, teach('a1', 'combat'))).toBe('already teaching here')
  })

  it('is refused for a child, off the ground, at another building, a site or for no subject', () => {
    const { world, ann, bo, queue } = setup()
    ann.bornAt = world.tick
    expect(order(world, queue, teach('a1'))).toBe('children can’t teach')
    bo.x = 8
    expect(order(world, queue, teach('a2'))).toBe('there is no training ground here')
    world.buildings.push({ id: 'f1', kind: 'farm', cityId: null, x: 8, y: 5 })
    expect(order(world, queue, teach('a2', 'strength', 'f1'))).toBe(
      'there is no training ground here',
    )
    bo.x = 5
    expect(order(world, queue, teach('a2', 'cooking'))).toBe('teach a stat or a skill')
    expect(order(world, queue, teach('a2', 'strength', 'f1'))).toBe(
      'stand on the training ground to teach there',
    )
    world.buildings[0]!.site = { delivered: {}, work: 0 }
    expect(order(world, queue, teach('a2'))).toBe('it is still a construction site')
    expect(bo.order).toBeNull()
  })

  it('is refused for another realm’s resident, and NPC cities train nobody', () => {
    const { world, bo, queue } = setup()
    bo.owner = 'r2'
    expect(order(world, queue, teach('a2'))).toBe('not one of your residents')
    const npc = { userId: 0, account: { name: 'Elm', isAdmin: false }, npcCityId: 'c9' }
    expect(queue.receive(world, npc, 'q', teach('a2'))).toMatchObject({ type: 'rejected' })
  })

  it('refuses a second teacher at the ground, naming the first', () => {
    const { world, ann, bo, queue } = setup()
    expect(order(world, queue, teach('a1'))).toBe('ack')
    expect(order(world, queue, teach('a2', 'combat'))).toBe('Ann teaches Strength here')
    expect(bo.order).toBeNull()
    expect(ann.order).toMatchObject({ kind: 'teach' })
  })

  it('lets only the first of two teach orders in one tick teach', () => {
    const { world, ann, bo, queue } = setup()
    expect(queue.receive(world, me, 'q1', teach('a1')).type).toBe('ack')
    expect(queue.receive(world, me, 'q2', teach('a2', 'combat')).type).toBe('ack')
    queue.applyAll(world)
    expect(ann.order).toMatchObject({ kind: 'teach' })
    expect(bo.order).toBeNull()
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('ends on leaving the ground or taking another order, and the ground teaches nothing then', () => {
    const { world, ground, ann, bo, queue } = setup()
    expect(order(world, queue, teach('a1'))).toBe('ack')
    expect(order(world, queue, { kind: 'walkTo', residentId: 'a1', x: 10, y: 10 })).toBe('ack')
    expect(ann.order?.kind).toBe('walkTo')
    expect(teacherAt(ground, world.residents)).toBeUndefined()
    // Bo can teach now; pushed off the footprint, Bo's teaching ends too.
    expect(order(world, queue, teach('a2'))).toBe('ack')
    bo.x = 9
    step(world)
    expect(bo.order).toBeNull()
    expect(teacherAt(ground, world.residents)).toBeUndefined()
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('ends when the ground is gone', () => {
    const { world, ann, queue } = setup()
    expect(order(world, queue, teach('a1'))).toBe('ack')
    world.buildings = []
    step(world)
    expect(ann.order).toBeNull()
  })
})

describe('teachers sound (ADR 0004)', () => {
  it('flags a teacher off the ground, at no ground, and a second teacher', () => {
    const { world, ann, bo } = setup()
    ann.order = { kind: 'teach', buildingId: 'g1', subject: 'strength' }
    bo.order = { kind: 'teach', buildingId: 'g1', subject: 'combat' }
    expect(teachersSound.check(world, terrain)).toEqual([
      expect.objectContaining({ entityIds: ['a2', 'a1'] }),
    ])
    bo.order = { kind: 'teach', buildingId: 'gone', subject: 'combat' }
    ann.x = 9
    expect(teachersSound.check(world, terrain).map((v) => v.entityIds)).toEqual([['a1'], ['a2']])
  })
})

describe('teaching in scripts', () => {
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

  it('teach(subject) asks to teach at the ground on my tile', () => {
    const { world } = setup()
    const { requests, memory } = runAs(world, 'memory.answer = teach("agility")')
    expect(memory.answer).toBeNull()
    expect(requests).toEqual([
      { kind: 'teach', residentId: 'a2', buildingId: 'g1', subject: 'agility' },
    ])
  })

  it('the ground’s view names its teacher and subject, null while nobody teaches', () => {
    const { world, queue } = setup()
    const source = 'let g = buildingAt(3, 3)\nmemory.teacher = g.teacher\nmemory.subject = g.subject'
    expect(runAs(world, source).memory).toMatchObject({ teacher: null, subject: null })
    expect(order(world, queue, teach('a1', 'combat'))).toBe('ack')
    expect(runAs(world, source).memory).toMatchObject({ teacher: 'a1', subject: 'combat' })
    const listed = 'memory.teacher = buildings()[0].teacher'
    expect(runAs(world, listed).memory.teacher).toBe('a1')
  })
})
