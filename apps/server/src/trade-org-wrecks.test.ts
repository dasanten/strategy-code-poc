import {
  TRADE_ORG_ARMY,
  Terrain,
  WORKPLACE_MAX_WORKERS,
  WORKPLACE_WRECK_WORTH,
  debtOf,
  townHallOf,
  warehouseKeeps,
  type Building,
  type BuildingKind,
  type City,
  type Resident,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it, vi } from 'vitest'
import { attackOrder } from './combat.js'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { addCity } from './test-terrain.js'
import { foundTradeOrgHq } from './trade-org.js'
import { stepPunishments } from './trade-org-punishment.js'
import { workplacesOfCity, wreckRecordsOf, wrecksSound } from './trade-org-wrecks.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

// Armies walk and work tick by tick; a machine under load can take a while over it.
vi.setConfig({ testTimeout: 120_000 })

const terrain: TerrainMap = { size: 640, tiles: new Uint8Array(640 * 640).fill(Terrain.Plains) }
const size = terrain.size
const player = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/** Where the HQ's town hall stands, and Ashford's. */
const MID = 320
const ASHFORD = { x: MID, y: MID + 88 }

const FARM = WORKPLACE_WRECK_WORTH.farm!
const SMELTER = WORKPLACE_WRECK_WORTH.smelter!

function person(
  world: WorldState,
  id: string,
  owner: string,
  cityId: string,
  x: number,
  y: number,
) {
  const r = newResident(mulberry32(world.residents.length + 1), {
    id,
    owner,
    cityId,
    x,
    y,
    tick: 0,
  })
  r.bornAt = -20 * 24 * 3600
  r.lifespan = 60
  world.residents.push(r)
  return r
}

/** The resident works the workplace where they stand. */
function work(r: Resident, buildingId: string) {
  r.order = { kind: 'workAt', buildingId, at: { x: r.x, y: r.y }, progress: 0 }
}

function building(world: WorldState, id: string, kind: BuildingKind, x: number, y: number) {
  const b: Building = { id, kind, cityId: null, x, y }
  world.buildings.push(b)
  return b
}

/**
 * The Trade Org HQ; realm r1 (Player 7, Leader a1) with city c1, Ashford, owing `owed`: a storage s1
 * and a house h1, its farm f1 and further off its farm f3, and smelter m1, which its resident w1 works.
 * Nearby are realm r2's city c2 with its farm f2 and an idle smelter i1 nobody works.
 */
function setup(owed: number) {
  const world = createWorld(terrain)
  const hq = foundTradeOrgHq(world, terrain, MID, MID, mulberry32(7))
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
  world.realms.push({ id: 'r2', userId: 8, leaderId: 'z1' })
  addCity(world, { id: 'c1', realmId: 'r1', ...ASHFORD, name: 'Ashford' })
  addCity(world, { id: 'c2', realmId: 'r2', x: MID + 60, y: MID + 88, name: 'Farhold' })
  const { x, y } = ASHFORD
  building(world, 's1', 'storage', x + 4, y).cityId = 'c1'
  world.buildings.find((b) => b.id === 's1')!.stock = { coins: 500, iron: 40 }
  building(world, 'h1', 'house', x - 4, y).cityId = 'c1'
  building(world, 'f1', 'farm', x, y + 6).cityId = 'c1'
  building(world, 'm1', 'smelter', x + 10, y + 10)
  building(world, 'f3', 'farm', x - 20, y + 20).cityId = 'c1'
  building(world, 'f2', 'farm', MID + 60, y + 6).cityId = 'c2'
  building(world, 'i1', 'smelter', x + 14, y - 8)
  const a1 = person(world, 'a1', 'r1', 'c1', x - 4, y + 4)
  const w1 = person(world, 'w1', 'r1', 'c1', x + 10, y + 10)
  work(w1, 'm1')
  person(world, 'z1', 'r2', 'c2', MID + 60, y + 3)
  const soldiers = world.residents.filter((r) => r.owner === null && r.cityId === hq.id)
  for (const r of soldiers.slice(0, TRADE_ORG_ARMY.guard + 4)) r.carried.spear = 1
  world.debts.push({ org: 'r1', coins: owed, step: 'wrecks', cityId: 'c1' })
  return {
    world,
    hq,
    a1,
    w1,
    city: world.cities.find((c) => c.id === 'c1')!,
    queue: new OrderQueue(undefined, terrain),
    walking: new Walking(terrain),
  }
}

/** Sends out the army for the debt and stands it in the city. */
function armyInTheCity(world: WorldState, city: City) {
  stepPunishments(world, size)
  const p = world.punishments[0]!
  const hall = townHallOf(world, city)!
  for (const m of p.members) {
    const r = world.residents.find((x) => x.id === m.residentId)!
    r.x = hall.x
    r.y = hall.y
    m.packed = true
  }
  return p
}

/** Steps the world, keeping everyone fed, with every invariant checked now and then. */
function run(world: WorldState, walking: Walking, ticks: number, until?: () => boolean) {
  for (let i = 0; i < ticks; i++) {
    for (const r of world.residents) r.hunger = 100
    stepWorld(world, terrain, walking)
    if (i % 50 === 0) expect(checkInvariants(world, terrain)).toEqual([])
    if (until?.()) break
  }
  expect(checkInvariants(world, terrain)).toEqual([])
}

const standing = (world: WorldState, id: string) => world.buildings.some((b) => b.id === id)
const wrecked = (world: WorldState) => world.events.filter((e) => e.kind === 'wrecked')
const punished = (world: WorldState) => world.events.filter((e) => e.kind === 'punished')
const lastPunished = (world: WorldState) => punished(world).at(-1)

describe('its worth', () => {
  it('is set for every kind of workplace', () => {
    expect(Object.keys(WORKPLACE_WRECK_WORTH).sort()).toEqual(
      Object.keys(WORKPLACE_MAX_WORKERS).sort(),
    )
    for (const worth of Object.values(WORKPLACE_WRECK_WORTH)) expect(worth).toBeGreaterThan(0)
  })
})

describe('its next army', () => {
  it('goes only at the step `wrecks`, saying so', () => {
    const { world } = setup(100)
    world.debts[0]!.step = 'demanded'
    world.debts[0]!.deadline = world.tick + 1000
    stepPunishments(world, size)
    expect(world.punishments).toEqual([])
    world.debts[0]!.step = 'wrecks'
    delete world.debts[0]!.deadline
    stepPunishments(world, size)
    expect(world.punishments).toMatchObject([{ culpritOrg: 'r1', cityId: 'c1', worth: 100 }])
    expect(world.punishments[0]!.wrecks).toEqual([])
    expect(lastPunished(world)).toMatchObject({ what: 'coming', city: 'Ashford', wrecks: true })
  })

  it('goes to the city the debt keeps, or with that gone to their city nearest the HQ', () => {
    const near = setup(100)
    addCity(near.world, { id: 'c9', realmId: 'r1', x: MID, y: MID + 200, name: 'Mirk' })
    near.world.debts[0]!.cityId = 'c9'
    stepPunishments(near.world, size)
    expect(near.world.punishments[0]!.cityId).toBe('c9')

    const gone = setup(100)
    addCity(gone.world, { id: 'c9', realmId: 'r1', x: MID, y: MID + 200, name: 'Mirk' })
    gone.world.debts[0]!.cityId = 'c0'
    stepPunishments(gone.world, size)
    expect(gone.world.punishments[0]!.cityId).toBe('c1')
  })

  it('waits for a spare soldier', () => {
    const { world, hq } = setup(100)
    for (const r of world.residents) if (r.cityId === hq.id) delete r.carried.spear
    stepPunishments(world, size)
    expect(world.punishments).toEqual([])
  })

  it('goes one at a time against one Organization', () => {
    const { world } = setup(100)
    stepPunishments(world, size)
    stepPunishments(world, size)
    expect(world.punishments).toHaveLength(1)
  })

  it('leaves no debt of its own when it is lost', () => {
    const { world, city } = setup(100)
    const p = armyInTheCity(world, city)
    stepPunishments(world, size)
    for (const m of p.members) {
      world.residents.find((r) => r.id === m.residentId)!.health = 0
    }
    stepPunishments(world, size)
    expect(world.punishments).toEqual([])
    expect(debtOf(world, 'r1')).toBe(100)
    expect(lastPunished(world)).toMatchObject({ what: 'lost', where: 'atCity', wrecks: true })
  })
})

describe('the workplaces of a city', () => {
  it('are those on its books and those its residents work', () => {
    const { world, city } = setup(100)
    expect(workplacesOfCity(world, city, size).map((b) => b.id)).toEqual(['f1', 'm1', 'f3'])
  })

  it('count one its worker is away from, carrying, by the Work default’s memory', () => {
    const { world, city, w1 } = setup(100)
    w1.order = null
    w1.script = { scriptId: 1, memory: { workplaceId: 'i1' } } as unknown as typeof w1.script
    expect(workplacesOfCity(world, city, size).map((b) => b.id)).toContain('i1')
  })

  it('leave out a farm of theirs someone of another Organization works', () => {
    const { world, city } = setup(100)
    const stranger = person(world, 'z2', 'r2', 'c2', ASHFORD.x, ASHFORD.y + 6)
    work(stranger, 'f1')
    expect(workplacesOfCity(world, city, size).map((b) => b.id)).toEqual(['m1', 'f3'])
  })

  it('leave out a farm of another Organization its residents work', () => {
    const { world, city, w1 } = setup(100)
    w1.x = MID + 60
    w1.y = ASHFORD.y + 6
    work(w1, 'f2')
    expect(workplacesOfCity(world, city, size).map((b) => b.id)).toEqual(['f1', 'f3'])
  })

  it('leave out a site', () => {
    const { world, city } = setup(100)
    world.buildings.find((b) => b.id === 'f1')!.site = {
      delivered: {},
      work: 10,
    }
    expect(workplacesOfCity(world, city, size).map((b) => b.id)).toEqual(['m1', 'f3'])
  })
})

describe('tearing down', () => {
  it('goes on until the debt is covered, and then it goes home', () => {
    const { world, city, walking } = setup(FARM + 50)
    const p = armyInTheCity(world, city)
    run(world, walking, 4000, () => p.heading === 'home')
    expect(p.heading).toBe('home')
    // Nearest the town hall first; what they didn't need stays.
    expect(standing(world, 'f1')).toBe(false)
    expect(standing(world, 'm1')).toBe(false)
    expect(standing(world, 'f3')).toBe(true)
    expect(world.debts).toEqual([])
    expect(p.took).toBe(FARM + 50)
    expect(wrecked(world)).toMatchObject([
      { building: 'farm', x: ASHFORD.x, y: ASHFORD.y + 6, coins: FARM, owed: 50, city: 'Ashford' },
      { building: 'smelter', coins: 50, owed: 0 },
    ])
    expect(lastPunished(world)).toMatchObject({ what: 'left', why: 'enough', wrecks: true })
    run(world, walking, 4000, () => world.punishments.length === 0)
    expect(world.punishments).toEqual([])
  })

  it('tears down by the order anyone gives, and takes no goods', () => {
    const { world, city, walking } = setup(FARM)
    const p = armyInTheCity(world, city)
    run(world, walking, 4000, () =>
      world.residents.some(
        (r) => r.order?.kind === 'tearDown' && p.members.some((m) => m.residentId === r.id),
      ),
    )
    const r = world.residents.find(
      (x) => x.order?.kind === 'tearDown' && p.members.some((m) => m.residentId === x.id),
    )!
    expect(r.order).toEqual({ kind: 'tearDown', buildingId: 'f1', at: { x: r.x, y: r.y } })
    run(world, walking, 4000, () => p.heading === 'home')
    const storage = world.buildings.find((b) => b.id === 's1')!
    expect(storage.stock).toMatchObject({ coins: 500, iron: 40 })
    // Taking it down is a crime like anyone's, of no consequence to the debt.
    expect(world.crimes.filter((c) => c.kind === 'tearDown')).toMatchObject([
      { victimOrg: 'r1', building: 'farm' },
    ])
  })

  it('with none left goes home with the debt still owed, and comes again', () => {
    const owed = 5000
    const { world, city, walking } = setup(owed)
    const p = armyInTheCity(world, city)
    run(world, walking, 6000, () => p.heading === 'home')
    expect(p.heading).toBe('home')
    for (const id of ['f1', 'm1', 'f3']) expect(standing(world, id)).toBe(false)
    expect(debtOf(world, 'r1')).toBe(owed - 2 * FARM - SMELTER)
    expect(p.took).toBe(2 * FARM + SMELTER)
    expect(lastPunished(world)).toMatchObject({
      what: 'left',
      why: 'noWorkplaces',
      took: 2 * FARM + SMELTER,
      wrecks: true,
    })
    // It never touched anything but those: what isn't the culprit's workplaces still stands.
    for (const id of ['s1', 'h1', 'f2', 'i1']) expect(standing(world, id)).toBe(true)
    expect(townHallOf(world, city)).toBeDefined()
    expect(wrecked(world)).toHaveLength(3)
    run(world, walking, 4000, () => world.punishments.some((x) => x !== p))
    expect(world.punishments.some((x) => x !== p)).toBe(true)
    expect(punished(world).filter((e) => e.what === 'coming')).toHaveLength(2)
  })

  it('goes on with one whose workers left once it found it', () => {
    const { world, city, w1, walking } = setup(5000)
    const p = armyInTheCity(world, city)
    stepPunishments(world, size)
    expect(p.wrecks).toEqual(['f1', 'm1', 'f3'])
    w1.order = null
    run(world, walking, 6000, () => p.heading === 'home')
    expect(standing(world, 'm1')).toBe(false)
  })

  it('leaves one that someone of another Organization has taken over', () => {
    const { world, city, walking } = setup(5000)
    const p = armyInTheCity(world, city)
    stepPunishments(world, size)
    expect(p.wrecks).toContain('f3')
    const stranger = person(world, 'z2', 'r2', 'c2', ASHFORD.x - 20, ASHFORD.y + 20)
    work(stranger, 'f3')
    world.buildings.find((b) => b.id === 'f3')!.cityId = null
    run(world, walking, 6000, () => p.heading === 'home')
    expect(standing(world, 'f3')).toBe(true)
    expect(p.wrecks).not.toContain('f3')
  })

  it('fights those who resist, and then carries on', () => {
    const { world, city, a1 } = setup(5000)
    const p = armyInTheCity(world, city)
    const first = world.residents.find((r) => r.id === p.members[0]!.residentId)!
    a1.order = attackOrder(first.id)
    stepPunishments(world, size)
    for (const m of p.members) {
      const r = world.residents.find((x) => x.id === m.residentId)!
      expect(r.order).toMatchObject({ kind: 'attack', targetId: 'a1' })
    }
    a1.order = null
    for (const m of p.members) world.residents.find((x) => x.id === m.residentId)!.order = null
    stepPunishments(world, size)
    expect(
      p.members.every((m) => {
        const k = world.residents.find((x) => x.id === m.residentId)!.order?.kind
        return k === 'walkTo' || k === 'tearDown'
      }),
    ).toBe(true)
  })
})

describe('paying while it is there', () => {
  /** Mara's resident a1 on the HQ's coin warehouse with `coins`. */
  function atTheWarehouse(
    world: WorldState,
    a1: { x: number; y: number; carried: object },
    coins: number,
  ) {
    const coinWarehouse = world.buildings.find((b) => warehouseKeeps(world, b).includes('coins'))!
    a1.x = coinWarehouse.x
    a1.y = coinWarehouse.y
    a1.carried = { coins }
  }

  it('in full stops it and sends it home', () => {
    const { world, city, a1, queue, walking } = setup(5000)
    const p = armyInTheCity(world, city)
    run(world, walking, 4000, () => wrecked(world).length >= 1)
    expect(p.heading).toBe('out')
    const owed = debtOf(world, 'r1')
    atTheWarehouse(world, a1, owed)
    const said = queue.receive(world, player, 'q', {
      kind: 'payDebt',
      residentId: 'a1',
      coins: owed,
    })
    expect(said.type).toBe('ack')
    queue.applyAll(world)
    run(world, walking, 2, () => p.heading === 'home')
    expect(p.heading).toBe('home')
    expect(world.debts).toEqual([])
    expect(lastPunished(world)).toMatchObject({ what: 'left', why: 'paid', wrecks: true })
    for (const m of p.members) {
      expect(world.residents.find((r) => r.id === m.residentId)!.order?.kind).not.toBe('tearDown')
    }
    const left = world.buildings.filter((b) => ['m1', 'f3'].includes(b.id)).length
    run(world, walking, 4000, () => world.punishments.length === 0)
    expect(world.punishments).toEqual([])
    expect(world.buildings.filter((b) => ['m1', 'f3'].includes(b.id))).toHaveLength(left)
  })

  it('in part only lowers what it counts for', () => {
    const { world, city, a1, queue, walking } = setup(5000)
    const p = armyInTheCity(world, city)
    atTheWarehouse(world, a1, 4900)
    queue.receive(world, player, 'q', { kind: 'payDebt', residentId: 'a1', coins: 4900 })
    queue.applyAll(world)
    run(world, walking, 1)
    expect(p.heading).toBe('out')
    expect(debtOf(world, 'r1')).toBe(100)
    run(world, walking, 4000, () => p.heading === 'home')
    // A hundred Coins take the one nearest farm and no more.
    expect(standing(world, 'f1')).toBe(false)
    expect(standing(world, 'm1')).toBe(true)
    expect(lastPunished(world)).toMatchObject({ what: 'left', why: 'enough' })
  })

  it('on the way there turns it back', () => {
    const { world, a1, queue, walking } = setup(5000)
    stepPunishments(world, size)
    const p = world.punishments[0]!
    atTheWarehouse(world, a1, 5000)
    queue.receive(world, player, 'q', { kind: 'payDebt', residentId: 'a1', coins: 5000 })
    queue.applyAll(world)
    run(world, walking, 2, () => p.heading === 'home')
    expect(p.heading).toBe('home')
    expect(lastPunished(world)).toMatchObject({ what: 'turnedBack', why: 'paid' })
    expect(wrecked(world)).toEqual([])
  })
})

describe('the invariant', () => {
  it('holds a soldier to what the army means to tear down', () => {
    const { world, city } = setup(5000)
    const p = armyInTheCity(world, city)
    stepPunishments(world, size)
    expect(wrecksSound.check(world, terrain)).toEqual([])
    const r = world.residents.find((x) => x.id === p.members[0]!.residentId)!
    r.order = { kind: 'tearDown', buildingId: 'h1', at: { x: r.x, y: r.y } }
    expect(wrecksSound.check(world, terrain)).toMatchObject([
      { invariant: 'wrecks-sound', entityIds: [p.id, r.id, 'h1'] },
    ])
  })

  it('holds an army out to take goods to tearing down nothing', () => {
    const { world, city } = setup(5000)
    const p = armyInTheCity(world, city)
    delete p.wrecks
    const r = world.residents.find((x) => x.id === p.members[0]!.residentId)!
    r.order = { kind: 'tearDown', buildingId: 'f1', at: { x: r.x, y: r.y } }
    expect(wrecksSound.check(world, terrain)).toHaveLength(1)
  })

  it('finds what is no workplace on its list', () => {
    const { world, city } = setup(5000)
    const p = armyInTheCity(world, city)
    p.wrecks = ['h1']
    expect(wrecksSound.check(world, terrain)).toHaveLength(1)
  })

  it('catches a building that came down by a soldier and wasn’t the culprit’s workplace', () => {
    const { world, city, walking } = setup(FARM)
    const p = armyInTheCity(world, city)
    run(world, walking, 4000, () => wrecked(world).length >= 1)
    expect(p.heading).toBe('out')
    const [record] = wreckRecordsOf(world)
    expect(record).toMatchObject({ buildingId: 'f1', listed: true, org: 'r1', culpritOrg: 'r1' })
    expect(wrecksSound.check(world, terrain)).toEqual([])
    record!.org = 'r2'
    expect(wrecksSound.check(world, terrain)).toHaveLength(1)
    record!.org = 'r1'
    record!.listed = false
    expect(wrecksSound.check(world, terrain)).toHaveLength(1)
    record!.listed = true
    record!.kind = 'house'
    expect(wrecksSound.check(world, terrain)).toHaveLength(1)
  })
})
