import {
  BLOW_BASE,
  BLOW_PER_STRENGTH,
  COMBAT_SKILL_LIMIT,
  DODGE_LIMIT,
  MAX_HEALTH,
  MIN_BLOW_DAMAGE,
  PROTECTION_DEFENCE,
  STRIKE_TICKS,
  Terrain,
  WEAPON_ATTACK,
  attackPower,
  bestWeapon,
  blowDamage,
  combatLearned,
  dodgeChance,
  inContact,
  isArmed,
  pileAt,
  protection,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { attackOrder } from './combat.js'
import { attackOrdersSound, checkInvariants, deadLeaveLoot, type Invariant } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { addCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

const terrain: TerrainMap = { size: 64, tiles: new Uint8Array(64 * 64).fill(Terrain.Plains) }
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/** A world with realm r1 (Player 7, Leader a1) and realm r2 (Player 8, Leader b1). */
function setup() {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
  world.realms.push({ id: 'r2', userId: 8, leaderId: 'b1' })
  const a = resident(world, 'a1', 'r1', 10, 10)
  const b = resident(world, 'b1', 'r2', 11, 10)
  return { world, a, b, queue: new OrderQueue(undefined, terrain) }
}

/** A resident at (x, y) with every stat 10 and no Agility, so they never dodge. */
function resident(world: WorldState, id: string, owner: string | null, x: number, y: number) {
  const r = newResident(mulberry32(world.residents.length + 1), { id, owner, x, y, tick: 0 })
  for (const s of ['strength', 'endurance', 'intellect'] as const)
    r.stats[s] = { base: 10, trained: 0 }
  r.stats.agility = { base: 0, trained: 0 }
  r.bornAt = -20 * 24 * 3600
  r.lifespan = 60
  world.residents.push(r)
  return r
}

/** Sends an attack order from Player 7 and answers whether it was taken. */
function order(world: WorldState, queue: OrderQueue, residentId: string, targetId: string) {
  const answer = queue.receive(world, me, 'q', { kind: 'attack', residentId, targetId })
  queue.applyAll(world)
  return answer.type === 'ack' ? 'ack' : (answer as { reason: string }).reason
}

/** Steps the world, keeping residents fed, and checks the combat invariants every tick. */
function run(world: WorldState, ticks = 1, walking?: Walking) {
  for (let i = 0; i < ticks; i++) {
    for (const r of world.residents) r.hunger = 100
    stepWorld(world, terrain, walking)
    expect(checkInvariants(world, terrain, [deadLeaveLoot, attackOrdersSound])).toEqual([])
  }
}

/** Steps until resident `id`'s health changes, at most `limit` ticks; answers the ticks taken. */
function untilHit(world: WorldState, id: string, limit = 20, walking?: Walking) {
  const before = world.residents.find((r) => r.id === id)!.health
  for (let t = 1; t <= limit; t++) {
    run(world, 1, walking)
    const r = world.residents.find((x) => x.id === id)
    if (!r || r.health < before - 0.5) return t
  }
  return undefined
}

const live = (world: WorldState, id: string) => world.residents.find((r) => r.id === id)

describe('combat (balance file)', () => {
  it('a blow comes from Strength and the best weapon carried, harder with Combat skill', () => {
    const world = createWorld(terrain)
    const r = resident(world, 'x', null, 0, 0)
    const fist = BLOW_BASE + BLOW_PER_STRENGTH * 10
    expect(attackPower(r, 0)).toBeCloseTo(fist)
    r.carried = { spear: 1, sword: 1 }
    expect(bestWeapon(r)).toBe('sword')
    expect(isArmed(r)).toBe(true)
    expect(attackPower(r, 0)).toBeCloseTo(fist + WEAPON_ATTACK.sword)
    r.skills.combat = 1000
    expect(attackPower(r, 0)).toBeCloseTo((fist + WEAPON_ATTACK.sword) * (1 + COMBAT_SKILL_LIMIT))
  })

  it('a shield and armour take damage off a blow, but a blow that lands always hurts', () => {
    const world = createWorld(terrain)
    const a = resident(world, 'a', null, 0, 0)
    const d = resident(world, 'd', null, 0, 0)
    a.carried = { sword: 1 }
    const full = attackPower(a, 0)
    expect(blowDamage(a, d, 0)).toBeCloseTo(full)
    d.carried = { shield: 2, armour: 1 }
    expect(protection(d)).toBe(PROTECTION_DEFENCE.shield + PROTECTION_DEFENCE.armour)
    expect(blowDamage(a, d, 0)).toBeCloseTo(full - protection(d))
    a.carried = {}
    expect(blowDamage(a, d, 0)).toBe(MIN_BLOW_DAMAGE)
  })

  it('Agility dodges, up to a limit; Intellect speeds up learning Combat', () => {
    const world = createWorld(terrain)
    const r = resident(world, 'x', null, 0, 0)
    expect(dodgeChance(r, 0)).toBe(0)
    r.stats.agility = { base: 10, trained: 0 }
    expect(dodgeChance(r, 0)).toBeGreaterThan(0)
    r.stats.agility = { base: 100, trained: 0 }
    expect(dodgeChance(r, 0)).toBe(DODGE_LIMIT)
    const slow = combatLearned(r, 0)
    r.stats.intellect = { base: 20, trained: 0 }
    expect(combatLearned(r, 0)).toBeCloseTo(slow * 2)
  })

  it('residents are in contact on the same or a neighbouring tile, across the map’s joins', () => {
    expect(inContact(64, { x: 3, y: 3 }, { x: 3, y: 3 })).toBe(true)
    expect(inContact(64, { x: 3, y: 3 }, { x: 4, y: 4 })).toBe(true)
    expect(inContact(64, { x: 3, y: 3 }, { x: 5, y: 3 })).toBe(false)
    expect(inContact(64, { x: 0, y: 0 }, { x: 63, y: 63 })).toBe(true)
  })
})

describe('the attack order', () => {
  it('attacks a resident of another realm in sight, with one of your own', () => {
    const { world, queue, b } = setup()
    expect(order(world, queue, 'b1', 'a1')).toBe('not one of your residents')
    resident(world, 'a2', 'r1', 12, 12)
    expect(order(world, queue, 'a1', 'a2')).toBe('that is one of your own residents')
    expect(order(world, queue, 'a1', 'nobody')).toBe('no such resident')
    b.x = 40
    expect(order(world, queue, 'a1', 'b1')).toBe('that resident is out of sight')
    b.x = 11
    expect(order(world, queue, 'a1', 'b1')).toBe('ack')
    expect(live(world, 'a1')!.order).toEqual(attackOrder('b1'))
  })

  it('walks after the target until in contact, then strikes', () => {
    const { world, queue, b } = setup()
    b.x = 16
    expect(order(world, queue, 'a1', 'b1')).toBe('ack')
    const hit = untilHit(world, 'b1', 600, new Walking(terrain))
    // Four tiles to walk at about 30 ticks each before the first blow.
    expect(hit).toBeGreaterThan(90)
    expect(inContact(terrain.size, live(world, 'a1')!, b)).toBe(true)
    expect(live(world, 'a1')!.x).toBe(15)
  })

  it('ends when the target gets out of the attacker’s sight', () => {
    const { world, queue, b } = setup()
    expect(order(world, queue, 'a1', 'b1')).toBe('ack')
    b.x = 40
    run(world)
    expect(live(world, 'a1')!.order).toBeNull()
  })
})

describe('combat', () => {
  it('strikes once every STRIKE_TICKS for the blow’s damage, and both learn Combat', () => {
    const { world, queue, a, b } = setup()
    a.carried = { sword: 1 }
    b.carried = { armour: 1 }
    b.order = { kind: 'walkTo', target: { x: 11, y: 10 }, path: [], progress: 0 }
    expect(order(world, queue, 'a1', 'b1')).toBe('ack')
    const damage = blowDamage(a, b, world.tick)
    expect(damage).toBeCloseTo(attackPower(a, 0) - PROTECTION_DEFENCE.armour)
    run(world, STRIKE_TICKS - 1)
    expect(b.health).toBeCloseTo(MAX_HEALTH, 0)
    run(world)
    expect(b.health).toBeCloseTo(MAX_HEALTH - damage, 0)
    expect(a.skills.combat).toBeGreaterThan(0)
    expect(b.skills.combat).toBeGreaterThan(0)
  })

  it('an agile resident dodges some blows', () => {
    const { world, queue, a, b } = setup()
    b.stats.agility = { base: 25, trained: 0 }
    b.health = MAX_HEALTH
    expect(order(world, queue, 'a1', 'b1')).toBe('ack')
    let landed = 0
    for (let i = 0; i < 40; i++) {
      const before = b.health
      run(world, STRIKE_TICKS)
      if (b.health < before - 0.5) landed++
      b.health = MAX_HEALTH
      b.order = null
    }
    expect(landed).toBeGreaterThan(5)
    expect(landed).toBeLessThan(35)
    expect(a.order?.kind).toBe('attack')
  })

  it('an armed resident who is hit fights back', () => {
    const { world, queue, b } = setup()
    b.carried = { spear: 1 }
    b.order = { kind: 'workAt', buildingId: 'none', at: { x: 11, y: 10 }, progress: 0 }
    expect(order(world, queue, 'a1', 'b1')).toBe('ack')
    expect(untilHit(world, 'b1')).toBeDefined()
    expect(b.order).toEqual({ ...attackOrder('a1', true, true), strike: expect.any(Number) })
    expect(untilHit(world, 'a1')).toBeDefined()
  })

  it('an unarmed resident who is hit flees home, to their city’s town hall', () => {
    const { world, queue, b } = setup()
    addCity(world, { id: 'c2', realmId: 'r2', x: 30, y: 30 })
    b.cityId = 'c2'
    expect(order(world, queue, 'a1', 'b1')).toBe('ack')
    expect(untilHit(world, 'b1')).toBeDefined()
    expect(b.order).toMatchObject({ kind: 'walkTo', target: { x: 30, y: 30 } })
    expect(world.events.filter((e) => e.kind === 'fled')).toMatchObject([
      { kind: 'fled', residentId: 'b1', userId: 8 },
    ])
    expect(untilHit(world, 'a1')).toBeUndefined()
  })

  it('a fight goes in both realm logs once', () => {
    const { world, queue } = setup()
    expect(order(world, queue, 'a1', 'b1')).toBe('ack')
    run(world, 10)
    expect(world.events.filter((e) => e.kind === 'fight')).toMatchObject([
      { userId: 7, residentId: 'a1', otherId: 'b1', attacker: true },
      { userId: 8, residentId: 'b1', otherId: 'a1', attacker: false },
    ])
  })

  it('a killed resident leaves everything they carried as loot, and the fight ends', () => {
    const { world, queue, a } = setup()
    const v = resident(world, 'b2', 'r2', 10, 11)
    v.carried = { food: 3, coins: 40, shield: 1 }
    v.health = 1
    a.carried = { sword: 1 }
    expect(order(world, queue, 'a1', 'b2')).toBe('ack')
    run(world, STRIKE_TICKS)
    expect(live(world, 'b2')).toBeUndefined()
    expect(pileAt(world, 10, 11)!.goods).toEqual({ food: 3, coins: 40, shield: 1 })
    expect(a.order).toBeNull()
    expect(world.events.find((e) => e.kind === 'died')).toMatchObject({
      residentId: 'b2',
      cause: 'killed',
      by: a.name,
      leader: false,
      userId: 8,
    })
  })

  it('killing a Leader ends their realm', () => {
    const { world, queue, b } = setup()
    b.health = 1
    expect(order(world, queue, 'a1', 'b1')).toBe('ack')
    run(world, STRIKE_TICKS)
    expect(world.realms.map((r) => r.id)).toEqual(['r1'])
  })
})

describe('combat invariants', () => {
  const broken = (inv: Invariant, world: WorldState) => inv.check(world, terrain)

  it('flag a dead resident still in the world', () => {
    const { world, b } = setup()
    expect(broken(deadLeaveLoot, world)).toEqual([])
    b.health = 0
    expect(broken(deadLeaveLoot, world)).toMatchObject([{ entityIds: ['b1'] }])
  })

  it('flag a resident attacking themselves or a blow out of range', () => {
    const { world, a, b } = setup()
    a.order = attackOrder('a1')
    b.order = { ...attackOrder('a1'), strike: 1 }
    expect(broken(attackOrdersSound, world).map((v) => v.entityIds)).toEqual([['a1'], ['b1']])
  })
})

describe('allies in combat', () => {
  /** The setup world with r1 and r2 in one alliance, both residents armed and next to each other. */
  function allied() {
    const s = setup()
    s.world.alliances.push({
      id: 'alliance-1',
      name: 'North',
      leaderId: 'r1',
      members: ['r1', 'r2'].map((realmId) => ({ realmId, joinedAt: 0, leaving: null })),
      invites: [],
    })
    s.a.carried = { spear: 1 }
    s.b.carried = { spear: 1 }
    return s
  }

  it('armed allies side by side leave each other alone', () => {
    const { world, a, b } = allied()
    expect(untilHit(world, 'a1', STRIKE_TICKS * 3)).toBeUndefined()
    expect([a.order, b.order]).toEqual([null, null])
    expect(world.crimes).toEqual([])
  })

  it('a direct order attacks an ally, and that is a crime; their fighting back is not', () => {
    const { world, queue, b } = allied()
    expect(order(world, queue, 'a1', 'b1')).toBe('ack')
    expect(untilHit(world, 'b1')).toBeDefined()
    expect(world.crimes).toMatchObject([
      { kind: 'attack', victimOrg: 'r2', culprit: { residentId: 'a1', org: 'r1' } },
    ])
    expect(b.order).toMatchObject({ kind: 'attack', targetId: 'a1', defending: true })
    expect(untilHit(world, 'a1')).toBeDefined()
    expect(world.crimes.map((c) => c.culprit.residentId)).toEqual(['a1'])
  })

  it('an army ordered to attack an ally does, and that is a crime', () => {
    const { world, queue } = allied()
    const send = (o: Record<string, unknown>) => {
      const answer = queue.receive(world, me, 'q', o as { kind: string })
      queue.applyAll(world)
      return answer.type
    }
    expect(send({ kind: 'formArmy', name: 'Foot', residentIds: ['a1'] })).toBe('ack')
    const armyId = world.armies[0]!.id
    expect(send({ kind: 'armyAttack', armyId, targetId: 'b1' })).toBe('ack')
    run(world)
    expect(untilHit(world, 'b1')).toBeDefined()
    expect(world.crimes).toMatchObject([{ kind: 'attack', culprit: { residentId: 'a1' } }])
  })
})
