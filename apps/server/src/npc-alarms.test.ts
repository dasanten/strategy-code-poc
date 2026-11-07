import {
  MAX_HEALTH,
  NPC_VILLAGE,
  SIGHT_RANGE,
  TICKS_PER_GAME_DAY,
  Terrain,
  inCityArea,
  isArmed,
  isAt,
  type Building,
  type City,
  type Resident,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { attack, attackOrder } from './combat.js'
import { startContract } from './contracts.js'
import { checkInvariants } from './invariants.js'
import { foundNpcCity } from './npc-cities.js'
import { npcSender } from './order-sender.js'
import { mulberry32, newResident } from './residents.js'
import { defaultScripts } from './test-default-scripts.js'
import { foundTradingPost } from './trading-posts.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/**
 * NPC villages, towns and self-managed cities run the Alarm default for their armed residents
 * (`CONTEXT.md`: Alarm script, NPC city; ADR 0028): the same alarms as a Player's city, the same
 * crime rule, and nothing but the game's default. Trading posts and the HQ keep their own rules.
 */

const SIZE = 160
const terrain: TerrainMap = { size: SIZE, tiles: new Uint8Array(SIZE * SIZE).fill(Terrain.Plains) }

/** Far from the city, out of its sight and its area. */
const AWAY = { x: 140, y: 140 }

function village(): { world: WorldState; city: City; walking: Walking } {
  const world = createWorld(terrain)
  const city = foundNpcCity(world, terrain, NPC_VILLAGE, 20, 20, mulberry32(7))
  return { world, city, walking: new Walking(terrain) }
}

const buildingOf = (world: WorldState, city: City, kind: Building['kind']): Building =>
  world.buildings.find((b) => b.cityId === city.id && b.kind === kind)!

/** A citizen of the city, unarmed, idle at the given building, by their script and order. */
function citizenAt(world: WorldState, city: City, kind: Building['kind']): Resident {
  const at = buildingOf(world, city, kind)
  const r = world.residents.find(
    (x) => x.owner === null && x.cityId === city.id && !isArmed(x) && x.health > 0 && !x.pair,
  )!
  // Out of the city's way: a grown resident who has eaten, doing nothing yet.
  Object.assign(r, { x: at.x, y: at.y, order: null, bornAt: world.tick - 20 * 24 * 3600 })
  delete r.script
  return r
}

/** A soldier of the city, armed with a spear, at the given building, not the hall. */
function soldierAt(world: WorldState, city: City, kind: Building['kind']): Resident {
  const r = citizenAt(world, city, kind)
  r.carried.spear = 1
  return r
}

/** A grown resident of realm r1 at (x, y), unarmed unless given `sword`; the Leader stays away. */
function outsider(world: WorldState, id: string, x: number, y: number, sword = false): Resident {
  const make = (rid: string, rx: number, ry: number) => {
    const r = newResident(mulberry32(world.residents.length + 1), {
      id: rid,
      owner: 'r1',
      cityId: null,
      x: rx,
      y: ry,
      tick: world.tick,
    })
    r.bornAt = world.tick - 20 * 24 * 3600
    r.lifespan = 60
    world.residents.push(r)
    return r
  }
  if (!world.realms.some((x) => x.id === 'r1')) {
    make('leader', AWAY.x, AWAY.y)
    world.realms.push({ id: 'r1', userId: 7, leaderId: 'leader' })
  }
  const r = make(id, x, y)
  if (sword) r.carried.sword = 1
  return r
}

/** Steps until `done` or `ticks` have passed, checking the invariants every tick. */
function until(
  world: WorldState,
  walking: Walking,
  done: () => boolean,
  ticks = TICKS_PER_GAME_DAY,
): void {
  for (let t = 0; t < ticks && !done(); t++) {
    stepWorld(world, terrain, walking)
    expect(checkInvariants(world, terrain).map((v) => v.message)).toEqual([])
  }
  expect(done()).toBe(true)
}

const onHall = (world: WorldState, city: City, r: Resident) =>
  isAt(r, buildingOf(world, city, 'townHall'), SIZE)

/** No resident of no realm runs anything but the game's defaults, kept aside or not. */
function expectOnlyDefaults(world: WorldState): void {
  for (const r of world.residents) {
    if (r.owner !== null) continue
    const scripts = [r.script, r.interrupted?.script, r.interrupted?.alarm?.script]
    for (const s of scripts) if (s) expect(s).toMatchObject({ scriptId: 0, task: expect.any(String) })
  }
}

describe('an NPC city and an armed outsider', { timeout: 30_000 }, () => {
  it('holds the hall until they are gone, and its soldiers then stand down', () => {
    const { world, city, walking } = village()
    const soldier = soldierAt(world, city, 'storage')
    const hall = buildingOf(world, city, 'townHall')
    const p = outsider(world, 'p1', soldier.x + 3, soldier.y, true)
    // They come into its area: raised once, at the end of the tick.
    until(world, walking, () => soldier.script?.task === 'alarm')
    expect(soldier.script).toMatchObject({ scriptId: 0, alarm: { kind: 'outsider', about: p.id } })
    expect(city.outsiders).toEqual([p.id])
    until(world, walking, () => onHall(world, city, soldier))
    // Nobody gets struck: holding it is no attack, so no crime and no standing.
    expect(p.health).toBe(MAX_HEALTH)
    expect(world.crimes).toEqual([])
    // With a defender on it, the outsider stepping onto the hall occupies nothing.
    Object.assign(p, { x: hall.x, y: hall.y })
    until(world, walking, () => world.tick % 10 === 0)
    expect(city.occupation ?? null).toBeNull()
    expect(soldier.script?.task).toBe('alarm')
    // They leave the area: the alarm ends, and what it interrupted goes on.
    Object.assign(p, AWAY)
    until(world, walking, () => soldier.script?.task !== 'alarm')
    expect(soldier.interrupted).toBeUndefined()
    expectOnlyDefaults(world)
  })

  it('only notes an unarmed outsider', () => {
    const { world, city, walking } = village()
    const soldier = soldierAt(world, city, 'storage')
    const [x, y] = [soldier.x, soldier.y]
    outsider(world, 'p1', soldier.x + 3, soldier.y)
    until(world, walking, () => world.tick >= 5)
    expect(soldier.script?.task).not.toBe('alarm')
    expect(soldier.interrupted).toBeUndefined()
    expect([soldier.x, soldier.y]).toEqual([x, y])
  })

  it('leaves its unarmed residents at what they were doing', () => {
    const { world, city, walking } = village()
    const bystander = citizenAt(world, city, 'storage')
    outsider(world, 'p1', bystander.x + 3, bystander.y, true)
    until(world, walking, () => world.tick >= 5)
    expect(bystander.script?.task).not.toBe('alarm')
  })
})

describe('an NPC city and a thief', { timeout: 30_000 }, () => {
  /** A thief taking Food from the city's storage in sight of a soldier, with what is in it. */
  function stage() {
    const { world, city, walking } = village()
    const storage = buildingOf(world, city, 'storage')
    storage.stock!.food = 50
    const soldier = soldierAt(world, city, 'storage')
    Object.assign(soldier, { x: storage.x + 4, y: storage.y })
    const thief = outsider(world, 'p1', storage.x, storage.y)
    thief.order = {
      kind: 'pickUp',
      from: { kind: 'storage', storageId: storage.id },
      goods: { food: 2 },
    }
    return { world, city, walking, soldier, thief }
  }

  it('goes after them, as no crime, until they have left the area', () => {
    const { world, city, walking, soldier, thief } = stage()
    until(world, walking, () => soldier.script?.alarm?.kind === 'theft')
    expect(soldier.script?.alarm?.about).toBe(thief.id)
    until(world, walking, () => soldier.order?.kind === 'attack')
    expect(soldier.order).toMatchObject({ targetId: thief.id })
    until(world, walking, () => thief.health < MAX_HEALTH)
    expect(world.crimes.filter((c) => c.culprit.org === city.id)).toEqual([])
    // Out of the area they go free, and nobody runs after them.
    Object.assign(thief, AWAY)
    until(world, walking, () => soldier.script?.task !== 'alarm')
    expect(soldier.order?.kind).not.toBe('attack')
  })

  it('comes home once the chase has taken them out of the area', () => {
    const { world, city, walking, soldier, thief } = stage()
    until(world, walking, () => soldier.script?.alarm?.kind === 'theft')
    // Outside the walls when the thief gets away, as far as the chase took them.
    const outside = { x: 20, y: 75 }
    expect(inCityArea(world, city, outside.x, outside.y, SIZE)).toBe(false)
    Object.assign(soldier, outside)
    Object.assign(thief, { x: outside.x + 2, y: outside.y })
    until(world, walking, () => soldier.script?.task !== 'alarm')
    until(world, walking, () => inCityArea(world, city, soldier.x, soldier.y, SIZE))
    expect(soldier.script).toBeUndefined()
  })

  it('leaves alone a resident it never saw steal', () => {
    const { world, city, walking } = village()
    const soldier = soldierAt(world, city, 'storage')
    outsider(world, 'p1', soldier.x + 2, soldier.y)
    until(world, walking, () => world.tick >= 10)
    expect(soldier.order?.kind).not.toBe('attack')
    expect(soldier.script?.task).not.toBe('alarm')
  })

  it('takes them off the hall, and they go back to holding it after (2026-11-07)', () => {
    const { world, city, walking, soldier, thief } = stage()
    const hall = buildingOf(world, city, 'townHall')
    const armed = outsider(world, 'p2', hall.x + 3, hall.y + 3, true)
    thief.order = null
    Object.assign(thief, AWAY)
    until(world, walking, () => soldier.script?.alarm?.kind === 'outsider')
    until(world, walking, () => soldier.script?.memory.holding === true)
    // The theft takes over, right next to them.
    const storage = buildingOf(world, city, 'storage')
    Object.assign(thief, { x: storage.x, y: storage.y })
    Object.assign(soldier, { x: storage.x + 2, y: storage.y })
    thief.order = {
      kind: 'pickUp',
      from: { kind: 'storage', storageId: storage.id },
      goods: { food: 2 },
    }
    until(world, walking, () => soldier.script?.alarm?.kind === 'theft')
    expect(soldier.script?.alarmUnder).toMatchObject({ kind: 'outsider', about: armed.id })
    Object.assign(thief, AWAY)
    // The chase over, the outsider alarm goes on, with what it remembered.
    until(world, walking, () => soldier.script?.alarm?.kind === 'outsider')
    expect(soldier.script?.memory.holding).toBe(true)
    until(world, walking, () => onHall(world, city, soldier))
    expect(soldier.script?.task).toBe('alarm')
  })
})

describe('an NPC city and someone occupying its hall', { timeout: 30_000 }, () => {
  function stage() {
    const { world, city, walking } = village()
    const soldier = soldierAt(world, city, 'storage')
    const hall = buildingOf(world, city, 'townHall')
    const p = outsider(world, 'p1', hall.x, hall.y, true)
    return { world, city, walking, soldier, hall, p }
  }

  it('reaches its soldiers, who go after them as no crime, and go home after', () => {
    const { world, city, walking, soldier, p } = stage()
    const bystander = citizenAt(world, city, 'storage')
    until(world, walking, () => soldier.order?.kind === 'attack')
    expect(city.occupation).toMatchObject({ realmId: 'r1' })
    expect(soldier.order).toMatchObject({ targetId: p.id, defending: true, started: false })
    expect(bystander.order?.kind).not.toBe('attack')
    until(world, walking, () => p.health < MAX_HEALTH)
    expect(world.crimes.filter((c) => c.culprit.org === city.id)).toEqual([])
    Object.assign(p, AWAY)
    until(world, walking, () => soldier.script?.task !== 'alarm')
    expect(soldier.interrupted).toBeUndefined()
  })

  it('reaches one armed after it started, or back home since', () => {
    const { world, city, walking, soldier, p } = stage()
    Object.assign(soldier, AWAY)
    delete soldier.carried.spear
    until(world, walking, () => !!city.occupation)
    expect(soldier.script?.task).not.toBe('alarm')
    const storage = buildingOf(world, city, 'storage')
    Object.assign(soldier, { x: storage.x, y: storage.y, order: null })
    soldier.carried.spear = 1
    until(world, walking, () => soldier.order?.kind === 'attack')
    expect(soldier.order).toMatchObject({ targetId: p.id, defending: true })
  })

  it('goes after an occupier who is Down, who holds the hall all the same', () => {
    const { world, walking, soldier, p } = stage()
    p.health = 0
    p.downUntil = world.tick + TICKS_PER_GAME_DAY
    until(world, walking, () => soldier.order?.kind === 'attack')
    expect(soldier.order).toMatchObject({ targetId: p.id, defending: true })
  })

  it('takes those holding it off whatever else they were on alarm for', () => {
    const { world, city, walking, soldier, hall, p } = stage()
    Object.assign(p, { x: hall.x + 4, y: hall.y + 4 })
    until(world, walking, () => soldier.script?.alarm?.kind === 'outsider')
    Object.assign(soldier, AWAY, { x: AWAY.x - 60, y: AWAY.y - 60 })
    Object.assign(p, { x: hall.x, y: hall.y })
    Object.assign(soldier, { x: hall.x + 8, y: hall.y })
    until(world, walking, () => soldier.script?.alarm?.kind === 'occupied')
    expect(city.occupation).toMatchObject({ realmId: 'r1' })
  })
})

describe('an NPC city under attack', { timeout: 30_000 }, () => {
  it('sends those who see a wall struck after who struck it, as no crime', () => {
    const { world, city, walking } = village()
    const gate = buildingOf(world, city, 'gate')
    const soldier = soldierAt(world, city, 'storage')
    Object.assign(soldier, { x: gate.x, y: gate.y - 1 })
    const breaker = outsider(world, 'p1', gate.x, gate.y + 1, true)
    breaker.order = attackOrder(gate.id)
    // Who stands at its gate already is no news: this is about the blow.
    until(world, walking, () => soldier.script?.alarm?.kind === 'attacked')
    expect(soldier.script?.alarm).toMatchObject({ about: breaker.id, x: gate.x, y: gate.y })
    until(world, walking, () => soldier.order?.kind === 'attack')
    expect(soldier.order).toMatchObject({ targetId: breaker.id, defending: true })
    breaker.order = attackOrder(gate.id)
    until(world, walking, () => breaker.health < MAX_HEALTH)
    expect(world.crimes.filter((c) => c.culprit.org === city.id)).toEqual([])
  })

  it('sends those who see a neighbour struck, and leaves the struck to fight back', () => {
    const { world, city, walking } = village()
    const neighbour = soldierAt(world, city, 'storage')
    const soldier = soldierAt(world, city, 'storage')
    const p = outsider(world, 'p1', neighbour.x + 1, neighbour.y, true)
    p.order = attackOrder(neighbour.id)
    until(world, walking, () => soldier.script?.alarm?.kind === 'attacked')
    expect(soldier.script?.alarm?.about).toBe(p.id)
    // The struck one's answer is their own: the alarm for the blow doesn't reach them.
    expect(neighbour.struck?.by).toBe(p.id)
    expect(neighbour.script?.alarm?.kind).not.toBe('attacked')
    until(world, walking, () => soldier.order?.kind === 'attack')
    expect(soldier.order).toMatchObject({ targetId: p.id, defending: true })
    expect(world.crimes.filter((c) => c.culprit.org === city.id)).toEqual([])
  })

  it('fights back when struck while holding the hall, then goes back to holding it', () => {
    const { world, city, walking } = village()
    const soldier = soldierAt(world, city, 'storage')
    const hall = buildingOf(world, city, 'townHall')
    const p = outsider(world, 'p1', soldier.x + 3, soldier.y, true)
    until(world, walking, () => soldier.script?.alarm?.kind === 'outsider')
    until(world, walking, () => soldier.script?.memory.holding === true)
    Object.assign(p, { x: soldier.x + 1, y: soldier.y })
    p.order = attackOrder(soldier.id)
    until(world, walking, () => soldier.struck !== undefined && soldier.order?.kind === 'attack')
    // The Alarm default isn't run over it: the same order stands the next ticks too.
    expect(soldier.order).toMatchObject({ targetId: p.id, defending: true })
    stepWorld(world, terrain, walking)
    expect(soldier.order).toMatchObject({ kind: 'attack', targetId: p.id })
    // The attacker stops, and walks off out of sight; another armed outsider remains.
    const other = outsider(world, 'p2', hall.x + 3, hall.y + 3, true)
    p.order = null
    Object.assign(p, AWAY)
    until(world, walking, () => soldier.order?.kind !== 'attack')
    until(world, walking, () => onHall(world, city, soldier))
    expect(soldier.script?.alarm?.kind).toBe('outsider')
    expect(other.health).toBe(MAX_HEALTH)
  })

  it('leaves alone a resident fought off, who has done nothing there', () => {
    const { world, city, walking } = village()
    const soldier = soldierAt(world, city, 'storage')
    Object.assign(soldier, { x: soldier.x + SIGHT_RANGE, y: soldier.y })
    const passer = outsider(world, 'p1', 150, 150)
    until(world, walking, () => world.tick >= 3)
    expect(soldier.script?.task).not.toBe('alarm')
    expect(passer.health).toBe(MAX_HEALTH)
  })
})

describe('whom an alarm reaches in an NPC city', { timeout: 30_000 }, () => {
  it('runs the default whatever they had picked as a Player’s, and nothing else', () => {
    const { world, city, walking } = village()
    const none = soldierAt(world, city, 'storage')
    none.alarmScriptId = 'none'
    const picked = soldierAt(world, city, 'storage')
    picked.alarmScriptId = 101
    outsider(world, 'p1', none.x + 3, none.y, true)
    until(world, walking, () => none.script?.task === 'alarm' && picked.script?.task === 'alarm')
    expect(none.script?.scriptId).toBe(0)
    expect(picked.script?.scriptId).toBe(0)
    expectOnlyDefaults(world)
  })

  it('keeps going past the Players’ script runner, which only ends what no city runs', () => {
    const { world, city, walking } = village()
    const soldier = soldierAt(world, city, 'storage')
    outsider(world, 'p1', soldier.x + 3, soldier.y, true)
    until(world, walking, () => soldier.script?.task === 'alarm')
    defaultScripts(terrain, []).runAll(world)
    expect(soldier.script?.task).toBe('alarm')
    expect(soldier.interrupted).toBeDefined()
  })

  it('ends a Player’s script left running on someone of no realm, handing back what it kept', () => {
    const { world, city, walking } = village()
    const soldier = soldierAt(world, city, 'storage')
    outsider(world, 'p1', soldier.x + 3, soldier.y, true)
    until(world, walking, () => soldier.script?.task === 'alarm')
    soldier.script!.scriptId = 101
    defaultScripts(terrain, []).runAll(world)
    expect(soldier.script).toBeUndefined()
    expect(soldier.interrupted).toBeUndefined()
    expectOnlyDefaults(world)
  })

  it('leaves out a founding party’s, who go by the founding', () => {
    const { world, city, walking } = village()
    const soldier = soldierAt(world, city, 'storage')
    world.cityPlans[city.id] = {
      ...world.cityPlans[city.id]!,
      jobs: { [soldier.id]: { kind: 'found' } },
      foundingSite: { ...AWAY },
    }
    outsider(world, 'p1', soldier.x + 3, soldier.y, true)
    until(world, walking, () => world.tick >= 3)
    expect(soldier.script?.task).not.toBe('alarm')
  })

  it('leaves out one hired out, and a contract ends an alarm for good', () => {
    const { world, city, walking } = village()
    const soldier = soldierAt(world, city, 'storage')
    const p = outsider(world, 'p1', soldier.x + 3, soldier.y, true)
    until(world, walking, () => soldier.script?.task === 'alarm')
    const contract = {
      id: 'k1',
      lenderId: city.id,
      hirerId: 'r1',
      offeredBy: 'hirer' as const,
      residentIds: [soldier.id],
      days: 7,
      pricePerWeek: 5,
      storageId: buildingOf(world, city, 'storage').id,
      startedAt: null,
      paidWeeks: 0,
    }
    world.contracts.push(contract)
    startContract(world, contract)
    expect(soldier.script).toBeUndefined()
    expect(soldier.interrupted).toBeUndefined()
    expect(checkInvariants(world, terrain).map((v) => v.message)).toEqual([])
    Object.assign(p, AWAY)
    stepWorld(world, terrain, walking)
    Object.assign(p, { x: soldier.x + 3, y: soldier.y })
    stepWorld(world, terrain, walking)
    expect(soldier.script?.task).not.toBe('alarm')
  })
})

describe('the attack order from an NPC city', () => {
  const sender = (city: City) => npcSender(city)

  it('takes one of its own after someone it sees, and nothing else', () => {
    const { world, city } = village()
    const soldier = soldierAt(world, city, 'storage')
    const other = citizenAt(world, city, 'storage')
    const p = outsider(world, 'p1', soldier.x + 1, soldier.y)
    const far = outsider(world, 'p2', AWAY.x, AWAY.y)
    const ask = (residentId: string, targetId: string) =>
      attack.validate(world, sender(city), { kind: 'attack', residentId, targetId }, terrain)
    expect(ask(soldier.id, p.id)).toBeUndefined()
    expect(ask(soldier.id, other.id)).toBe('that is one of your own residents')
    expect(ask(soldier.id, far.id)).toBe('that resident is out of sight')
    expect(ask(p.id, soldier.id)).toBe('not one of your residents')
    expect(ask(soldier.id, buildingOf(world, city, 'gate').id)).toBe('no such resident')
  })
})

describe('a trading post', { timeout: 30_000 }, () => {
  function post() {
    const world = createWorld(terrain)
    const city = foundTradingPost(world, terrain, 20, 20, undefined, mulberry32(7))
    return { world, city, walking: new Walking(terrain) }
  }

  it('keeps its own rules: no alarm, and no holding the hall', () => {
    const { world, city, walking } = post()
    const soldier = soldierAt(world, city, 'warehouse')
    const [x, y] = [soldier.x, soldier.y]
    const p = outsider(world, 'p1', soldier.x + 3, soldier.y, true)
    until(world, walking, () => world.tick >= 10)
    expect(city.outsiders).toBeUndefined()
    expect(soldier.script?.task).not.toBe('alarm')
    expect([soldier.x, soldier.y]).toEqual([x, y])
    expect(p.health).toBe(MAX_HEALTH)
  })

  it('still goes straight at whoever occupies its hall, and strikes as no crime', () => {
    const { world, city, walking } = post()
    const soldier = soldierAt(world, city, 'warehouse')
    const hall = buildingOf(world, city, 'townHall')
    const p = outsider(world, 'p1', hall.x, hall.y, true)
    until(world, walking, () => soldier.order?.kind === 'attack')
    expect(soldier.script?.task).not.toBe('alarm')
    expect(soldier.order).toMatchObject({ targetId: p.id, defending: true })
    until(world, walking, () => p.health < MAX_HEALTH)
    expect(world.crimes.filter((c) => c.culprit.org === city.id)).toEqual([])
  })
})
