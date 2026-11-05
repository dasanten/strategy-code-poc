import {
  CITY_AREA_MARGIN,
  MAX_HEALTH,
  NPC_GATE_WATCH_RANGE,
  NPC_TOWN,
  NPC_VILLAGE,
  TICKS_PER_GAME_DAY,
  TRADE_ORG,
  TRADING_POST,
  Terrain,
  canWork,
  occupierOf,
  isArmed,
  npcSoldierTarget,
  onOwnWall,
  type Building,
  type City,
  type Resident,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { stepCaptures } from './capture.js'
import { attackOrder } from './combat.js'
import { commitCrime } from './crimes.js'
import { checkInvariants } from './invariants.js'
import { foundNpcCity } from './npc-cities.js'
import { attackersOf, npcGateShutToItsPunishers, stepNpcDefence } from './npc-defence.js'
import { mulberry32, newResident } from './residents.js'
import { changeStanding } from './standing.js'
import { foundTradingPost } from './trading-posts.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/** An open map of Plains, `size` tiles along each side. */
const plains = (size: number): TerrainMap => ({
  size,
  tiles: new Uint8Array(size * size).fill(Terrain.Plains),
})

/** A village alone on a small Plains map, its top-left wall tile at (20, 20). */
function village(): { world: WorldState; terrain: TerrainMap; city: City } {
  const terrain = plains(160)
  const world = createWorld(terrain)
  const city = foundNpcCity(world, terrain, NPC_VILLAGE, 20, 20, mulberry32(7))
  return { world, terrain, city }
}

const buildingOf = (world: WorldState, city: City, kind: Building['kind']): Building =>
  world.buildings.find((b) => b.cityId === city.id && b.kind === kind)!

const citizens = (world: WorldState, city: City): Resident[] =>
  world.residents.filter((r) => r.owner === null && r.cityId === city.id)

/** A grown Player's resident of realm r1 at (x, y). */
function outsider(world: WorldState, id: string, x: number, y: number): Resident {
  const r = newResident(mulberry32(world.residents.length + 1), {
    id,
    owner: 'r1',
    cityId: null,
    x,
    y,
    tick: world.tick,
  })
  r.bornAt = world.tick - 20 * 24 * 3600
  r.lifespan = 60
  world.residents.push(r)
  if (!world.realms.some((x) => x.id === 'r1'))
    world.realms.push({ id: 'r1', userId: 7, leaderId: id })
  return r
}

/** Runs the world for `ticks`, checking the invariants every game day. */
function run(world: WorldState, terrain: TerrainMap, walking: Walking, ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    stepWorld(world, terrain, walking)
    if (world.tick % TICKS_PER_GAME_DAY === 0) expect(checkInvariants(world, terrain)).toEqual([])
  }
}

/** An armed soldier of the Trade Org army at (x, y), on a punishment of `culpritOrg`. */
function armySoldier(world: WorldState, id: string, culpritOrg: string, x: number, y: number) {
  const r = newResident(mulberry32(world.residents.length + 1), {
    id,
    owner: null,
    cityId: 'hq',
    x,
    y,
    tick: world.tick,
  })
  r.carried.spear = 1
  world.residents.push(r)
  world.punishments.push({
    id: `punish-${id}`,
    culpritOrg,
    cityId: culpritOrg,
    worth: 100,
    members: [{ residentId: id, own: { spear: 1 } }],
    heading: 'out',
    took: 0,
    startedAt: world.tick,
  })
  return r
}

describe('an NPC city and the Trade Org army at its gate', () => {
  /** A village with its gate, stepped once with the given people staged near it. */
  function gateAfter(stage: (world: WorldState, gate: Building, city: City) => void) {
    const { world, terrain, city } = village()
    const gate = buildingOf(world, city, 'gate')
    stage(world, gate, city)
    stepNpcDefence(world, terrain.size)
    return gate
  }

  it('keeps its gate open while only the army is near', () => {
    const gate = gateAfter((world, g) => {
      armySoldier(world, 'a1', 'r9', g.x, g.y + 2)
    })
    expect(gate.closed).toBeUndefined()
  })

  it('opens its gate again once the only armed outsiders left are the army', () => {
    const { world, terrain, city } = village()
    const gate = buildingOf(world, city, 'gate')
    armySoldier(world, 'a1', 'r9', gate.x, gate.y + 2)
    const p = outsider(world, 'p1', gate.x, gate.y + 2)
    p.carried.sword = 1
    stepNpcDefence(world, terrain.size)
    expect(gate.closed).toBe(true)
    p.y = gate.y + NPC_GATE_WATCH_RANGE + 1
    stepNpcDefence(world, terrain.size)
    expect(gate.closed).toBeUndefined()
  })

  it('shuts its gate on the army if it refuses the Trade Organization', () => {
    const gate = gateAfter((world, g, city) => {
      armySoldier(world, 'a1', 'r9', g.x, g.y + 2)
      changeStanding(world, city.id, TRADE_ORG, -60)
    })
    expect(gate.closed).toBe(true)
  })

  it('shuts its gate on a punishment aimed at itself', () => {
    const gate = gateAfter((world, g, city) => {
      armySoldier(world, 'a1', city.id, g.x, g.y + 2)
    })
    expect(gate.closed).toBe(true)
  })

  it('shuts its gate on a punishment aimed at itself, with another army near too', () => {
    const gate = gateAfter((world, g, city) => {
      armySoldier(world, 'a1', 'r9', g.x, g.y + 2)
      armySoldier(world, 'a2', city.id, g.x, g.y + 2)
    })
    expect(gate.closed).toBe(true)
  })

  it('counts a supply wagon driver as the army they drive for', () => {
    const wagon = (world: WorldState, punishmentId: string | null) => {
      const r = armySoldier(world, 'd1', 'r9', 0, 0)
      world.punishments.pop()
      world.supplyWagons.push({
        id: 'w1',
        punishmentId,
        carriageId: 'k1',
        driverId: r.id,
        food: 0,
        ownFood: 0,
        holding: null,
      })
      return r
    }
    const near = (g: Building, r: Resident) => Object.assign(r, { x: g.x, y: g.y + 2 })
    const elsewhere = gateAfter((world, g) => {
      armySoldier(world, 'a1', 'r9', g.x, g.y + 40)
      near(g, wagon(world, 'punish-a1'))
    })
    expect(elsewhere.closed).toBeUndefined()
    const goingHome = gateAfter((world, g) => {
      near(g, wagon(world, null))
    })
    expect(goingHome.closed).toBeUndefined()
    const here = gateAfter((world, g, city) => {
      armySoldier(world, 'a1', city.id, g.x, g.y + 40)
      near(g, wagon(world, 'punish-a1'))
    })
    expect(here.closed).toBe(true)
  })

  it('still shuts its gate on Trade Org soldiers who are not its army', () => {
    const gate = gateAfter((world, g) => {
      armySoldier(world, 'a1', 'r9', g.x, g.y + 2)
      world.punishments = []
    })
    expect(gate.closed).toBe(true)
  })

  it('does not take the army for attackers', () => {
    const { world, terrain, city } = village()
    const gate = buildingOf(world, city, 'gate')
    armySoldier(world, 'a1', 'r9', gate.x, gate.y + 2)
    for (const r of citizens(world, city)) r.carried.spear = 1
    stepNpcDefence(world, terrain.size)
    expect(attackersOf(world, city, terrain.size)).toEqual([])
    for (const r of citizens(world, city)) expect(r.order?.kind).not.toBe('attack')
  })

  it('has an invariant catching its gate open to a punishment aimed at itself', () => {
    const { world, terrain, city } = village()
    const gate = buildingOf(world, city, 'gate')
    const r = armySoldier(world, 'a1', city.id, gate.x, gate.y + 2)
    expect(npcGateShutToItsPunishers.check(world, terrain)).toHaveLength(1)
    stepNpcDefence(world, terrain.size)
    expect(npcGateShutToItsPunishers.check(world, terrain)).toEqual([])
    delete gate.closed
    r.carried = {}
    expect(npcGateShutToItsPunishers.check(world, terrain)).toEqual([])
    r.carried.spear = 1
    world.punishments[0]!.culpritOrg = 'r9'
    expect(npcGateShutToItsPunishers.check(world, terrain)).toEqual([])
  })
})

// NPC cities' workers run the Work default every tick, which takes a while over game days.
describe('NPC cities defend themselves', { timeout: 20_000 }, () => {
  it('keep a quarter of their adults as soldiers, rounded up', () => {
    expect(npcSoldierTarget(NPC_VILLAGE.residents)).toBe(2)
    expect(npcSoldierTarget(NPC_TOWN.residents)).toBe(4)
    expect(npcSoldierTarget(1)).toBe(1)
  })

  it('arm soldiers from the storage by their size, and soldiers do not work', () => {
    const { world, terrain, city } = village()
    buildingOf(world, city, 'storage').stock!.spear = 5
    run(world, terrain, new Walking(terrain), 2 * TICKS_PER_GAME_DAY)
    const adults = citizens(world, city).filter((r) => canWork(r, world.tick))
    const soldiers = adults.filter(isArmed)
    expect(soldiers).toHaveLength(npcSoldierTarget(adults.length))
    expect(buildingOf(world, city, 'storage').stock!.spear).toBe(5 - soldiers.length)
    for (const s of soldiers) expect(s.order?.kind).not.toBe('workAt')
  })

  it('make spears in their smithy when the storage has no weapons', () => {
    const { world, terrain, city } = village()
    const hall = buildingOf(world, city, 'townHall')
    // A smithy is no city building; the city works it as one of its own workplaces.
    world.buildings.push({ id: 'smithy', kind: 'smithy', cityId: null, x: hall.x + 3, y: hall.y })
    city.workplaceIds = ['smithy']
    Object.assign(buildingOf(world, city, 'storage').stock!, { iron: 10, wood: 20 })
    run(world, terrain, new Walking(terrain), 3 * TICKS_PER_GAME_DAY)
    const armed = citizens(world, city).filter((r) => r.carried.spear)
    expect(armed).toHaveLength(npcSoldierTarget(NPC_VILLAGE.residents))
  })

  it('keep no soldiers they have no weapons for', () => {
    const { world, terrain, city } = village()
    run(world, terrain, new Walking(terrain), TICKS_PER_GAME_DAY)
    expect(citizens(world, city).filter(isArmed)).toEqual([])
  })

  it('close their gate while an armed outsider is near, and open it again', () => {
    const { world, terrain, city } = village()
    const gate = buildingOf(world, city, 'gate')
    const p = outsider(world, 'p1', gate.x, gate.y + NPC_GATE_WATCH_RANGE + 2)
    stepNpcDefence(world, terrain.size)
    expect(gate.closed).toBeUndefined()
    p.y = gate.y + NPC_GATE_WATCH_RANGE
    stepNpcDefence(world, terrain.size)
    // Unarmed, they are let in.
    expect(gate.closed).toBeUndefined()
    p.carried.sword = 1
    stepNpcDefence(world, terrain.size)
    expect(gate.closed).toBe(true)
    p.y = gate.y + NPC_GATE_WATCH_RANGE + 1
    stepNpcDefence(world, terrain.size)
    expect(gate.closed).toBeUndefined()
  })

  it('let their own residents through their closed gate, but not the armed outsider', () => {
    const { world, terrain, city } = village()
    const gate = buildingOf(world, city, 'gate')
    const hall = buildingOf(world, city, 'townHall')
    const walking = new Walking(terrain)
    const [own] = citizens(world, city)
    // Just outside its area, as far from its gate as an armed outsider gets without taking it.
    const p = outsider(world, 'p1', gate.x, gate.y + CITY_AREA_MARGIN + 2)
    p.carried.sword = 1
    Object.assign(own!, { x: gate.x, y: gate.y + 2, order: null })
    const home = { x: hall.x, y: hall.y }
    for (const r of [own!, p]) r.order = { kind: 'walkTo', target: home, path: null, progress: 0 }
    for (let t = 0; t < TICKS_PER_GAME_DAY && own!.order?.kind === 'walkTo'; t++) {
      stepWorld(world, terrain, walking)
      // The outsider stays put, so the gate stays shut.
      Object.assign(p, { x: gate.x, y: gate.y + CITY_AREA_MARGIN + 2 })
      expect(gate.closed).toBe(true)
    }
    expect([own!.x, own!.y]).toEqual([hall.x, hall.y])
    // They may stand on their own walls, and defend better there; the outsider may not.
    const wall = buildingOf(world, city, 'wall')
    expect(onOwnWall(world, { ...own!, x: wall.x, y: wall.y })).toBe(true)
    expect(onOwnWall(world, { ...p, x: wall.x, y: wall.y })).toBe(false)
    // The outsider, sent the same way, finds no way in.
    p.order = { kind: 'walkTo', target: home, path: null, progress: 0 }
    for (let t = 0; t < 20; t++) stepWorld(world, terrain, walking)
    expect(p.order).toBeNull()
    expect(p.y).toBeGreaterThan(gate.y)
  })

  it('fight attackers in their area', () => {
    const { world, terrain, city } = village()
    const hall = buildingOf(world, city, 'townHall')
    const [victim, soldier, bystander] = citizens(world, city)
    for (const r of [victim!, soldier!, bystander!]) Object.assign(r, { x: hall.x, y: hall.y })
    soldier!.carried.spear = 1
    const p = outsider(world, 'p1', hall.x + 2, hall.y)
    p.carried.sword = 1
    p.order = attackOrder(victim!.id)
    stepNpcDefence(world, terrain.size)
    expect(soldier!.order).toMatchObject({ kind: 'attack', targetId: p.id })
    // Only the armed fight; the city commits no crime by it.
    expect(bystander!.order?.kind).not.toBe('attack')
    run(world, terrain, new Walking(terrain), TICKS_PER_GAME_DAY)
    expect(world.crimes.filter((c) => c.culprit.residentId === soldier!.id)).toEqual([])
  })

  it('leave attackers outside their area alone', () => {
    const { world, terrain, city } = village()
    const hall = buildingOf(world, city, 'townHall')
    const [victim, soldier] = citizens(world, city)
    Object.assign(soldier!, { x: hall.x, y: hall.y, order: null })
    soldier!.carried.spear = 1
    Object.assign(victim!, { x: 120, y: 120 })
    const p = outsider(world, 'p1', 121, 120)
    p.order = attackOrder(victim!.id)
    stepNpcDefence(world, terrain.size)
    expect(soldier!.order).toBeNull()
  })

  it('fight those breaking or climbing their walls, and commit no crime by it', () => {
    const { world, terrain, city } = village()
    const gate = buildingOf(world, city, 'gate')
    const wall = buildingOf(world, city, 'wall')
    const [soldier] = citizens(world, city)
    Object.assign(soldier!, { x: gate.x, y: gate.y - 1, order: null })
    soldier!.carried.spear = 1
    const breaker = outsider(world, 'p1', gate.x, gate.y + 1)
    breaker.carried.sword = 1
    breaker.order = attackOrder(gate.id)
    stepNpcDefence(world, terrain.size)
    expect(soldier!.order).toMatchObject({ kind: 'attack', targetId: breaker.id })

    soldier!.order = null
    const climber = outsider(world, 'p2', wall.x, wall.y - 1)
    breaker.order = null
    climber.order = {
      kind: 'climb',
      wallId: wall.id,
      at: { x: climber.x, y: climber.y },
      progress: 0,
    }
    stepNpcDefence(world, terrain.size)
    expect(soldier!.order).toMatchObject({ kind: 'attack', targetId: climber.id })

    // Fought from the inside, the breaker at the gate gets hit and nobody counts it a crime.
    soldier!.order = attackOrder(breaker.id)
    breaker.order = attackOrder(gate.id)
    climber.order = null
    run(world, terrain, new Walking(terrain), TICKS_PER_GAME_DAY / 4)
    expect(breaker.health).toBeLessThan(MAX_HEALTH)
    expect(world.crimes.filter((c) => c.culprit.residentId === soldier!.id)).toEqual([])
  })

  it('still close a damaged gate, and close nothing once it is broken', () => {
    const { world, terrain, city } = village()
    const gate = buildingOf(world, city, 'gate')
    gate.damage = 1
    outsider(world, 'p1', gate.x, gate.y + 2).carried.sword = 1
    stepNpcDefence(world, terrain.size)
    expect(gate.closed).toBe(true)
    world.buildings = world.buildings.filter((b) => b !== gate)
    stepNpcDefence(world, terrain.size)
    expect(world.buildings.some((b) => b.cityId === city.id && b.closed)).toBe(false)
  })
})

describe('Trading posts defend themselves', { timeout: 20_000 }, () => {
  /** A trading post alone on a small Plains map, its top-left wall tile at (20, 20). */
  function post(): { world: WorldState; terrain: TerrainMap; city: City } {
    const terrain = plains(160)
    const world = createWorld(terrain)
    const city = foundTradingPost(world, terrain, 20, 20, undefined, mulberry32(7))
    return { world, terrain, city }
  }

  it('arm soldiers from the warehouse, so one armed outsider does not capture the post', () => {
    const { world, terrain, city } = post()
    const hall = buildingOf(world, city, 'townHall')
    const p = outsider(world, 'p1', hall.x, hall.y)
    p.carried.sword = 1
    expect(occupierOf(world, city, terrain.size)).toBe('r1')
    p.x = 140
    run(world, terrain, new Walking(terrain), 2 * TICKS_PER_GAME_DAY)
    const adults = citizens(world, city).filter((r) => canWork(r, world.tick))
    expect(adults.filter(isArmed)).toHaveLength(npcSoldierTarget(TRADING_POST.residents))
    const soldier = adults.find(isArmed)!
    Object.assign(soldier, { x: hall.x, y: hall.y })
    Object.assign(p, { x: hall.x, y: hall.y })
    expect(occupierOf(world, city, terrain.size)).toBeNull()
    expect(stepCaptures(world, terrain)).toEqual([])
    expect(citizens(world, city)).toHaveLength(TRADING_POST.residents)
  })

  it('go after a thief they saw, and commit no crime by it', () => {
    const { world, terrain, city } = post()
    const warehouse = buildingOf(world, city, 'warehouse')
    const [soldier, bystander] = citizens(world, city)
    for (const r of [soldier!, bystander!]) Object.assign(r, { x: warehouse.x, y: warehouse.y })
    soldier!.carried.spear = 1
    const honest = outsider(world, 'p0', warehouse.x - 1, warehouse.y)
    const thief = outsider(world, 'p1', warehouse.x + 1, warehouse.y)
    stepNpcDefence(world, terrain.size)
    expect(soldier!.order?.kind).not.toBe('attack')
    commitCrime(world, terrain.size, 'theft', thief, { victimOrg: city.id, goods: { coins: 5 } })
    stepNpcDefence(world, terrain.size)
    expect(soldier!.order).toMatchObject({ kind: 'attack', targetId: thief.id })
    expect(bystander!.order?.kind).not.toBe('attack')
    run(world, terrain, new Walking(terrain), TICKS_PER_GAME_DAY / 4)
    expect(thief.health).toBeLessThan(MAX_HEALTH)
    expect(honest.health).toBe(MAX_HEALTH)
    expect(world.crimes.filter((c) => c.culprit.residentId === soldier!.id)).toEqual([])
  })

  it('leave a thief alone that nobody of theirs saw', () => {
    const { world, terrain, city } = post()
    const warehouse = buildingOf(world, city, 'warehouse')
    const [soldier] = citizens(world, city)
    Object.assign(soldier!, { x: warehouse.x, y: warehouse.y, order: null })
    soldier!.carried.spear = 1
    const thief = outsider(world, 'p1', warehouse.x + 1, warehouse.y)
    commitCrime(world, terrain.size, 'theft', thief, { victimOrg: city.id, goods: { coins: 5 } })
    world.crimes[0]!.witnesses = []
    stepNpcDefence(world, terrain.size)
    expect(soldier!.order).toBeNull()
  })
})
