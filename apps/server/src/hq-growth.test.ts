import {
  TICKS_PER_GAME_DAY,
  TRADE_ORG_ARMY,
  TRADE_ORG_HQ,
  Terrain,
  freeHousing,
  isArmed,
  strongestArmed,
  townHallOf,
  tradeOrgArmyWanted,
  wrapDelta,
  type Building,
  type City,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import {
  hqHouseTile,
  hqProject,
  hqRingRadius,
  hqRingTiles,
  hqRings,
  hqRingsSound,
} from './hq-growth.js'
import { updateCityMembership } from './cities.js'
import { checkInvariants } from './invariants.js'
import { Ground } from './placing.js'
import { mulberry32, newResident } from './residents.js'
import { addCity } from './test-terrain.js'
import { foundTradeOrgHq, hqLayout } from './trade-org.js'
import { armedOutsidersNear, hqSoldiers } from './trade-org-army.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

const terrain: TerrainMap = { size: 640, tiles: new Uint8Array(640 * 640).fill(Terrain.Plains) }

/** Where the HQ's town hall stands. */
const MID = 320

/** The Trade Org HQ at (MID, MID); realm r1 with city c1 at (80, 560). */
function setup() {
  const world = createWorld(terrain)
  const hq = foundTradeOrgHq(world, terrain, MID, MID, mulberry32(7))
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
  addCity(world, { id: 'c1', realmId: 'r1', x: 80, y: 560 })
  resident(world, 'a1', 80, 563, 'r1')
  return { world, hq, walking: new Walking(terrain) }
}

/** A grown resident of `owner` (a realm, or null for one of the HQ's own). */
function resident(world: WorldState, id: string, x: number, y: number, owner: string | null) {
  const r = newResident(mulberry32(world.residents.length + 1), {
    id,
    owner,
    cityId: owner === null ? world.cities.find((c) => c.tradeOrg === 'hq')!.id : 'c1',
    x,
    y,
    tick: 0,
  })
  r.bornAt = -20 * 24 * 3600
  r.lifespan = 60
  world.residents.push(r)
  return r
}

/** `n` armed residents of realm `owner` in a row from (x, y). */
function armed(world: WorldState, owner: string, n: number, x: number, y: number, tag = owner) {
  return Array.from({ length: n }, (_, i) => {
    const r = resident(world, `${tag}-${i}`, x + i, y, owner)
    r.carried.spear = 1
    return r
  })
}

/** The HQ's own residents. */
const hqPeople = (world: WorldState, hq: City) =>
  world.residents.filter((r) => r.owner === null && r.cityId === hq.id)

/** Steps the world, keeping everyone fed, and checks every invariant now and then. */
function run(world: WorldState, walking: Walking, ticks: number, until?: () => boolean) {
  for (let i = 0; i < ticks; i++) {
    for (const r of world.residents) r.hunger = 100
    stepWorld(world, terrain, walking)
    if (i % 200 === 0) expect(checkInvariants(world, terrain)).toEqual([])
    if (until?.()) break
  }
  expect(checkInvariants(world, terrain)).toEqual([])
}

/** The HQ's gates on its outer ring. */
function outerGates(world: WorldState, hq: City): Building[] {
  // From the middle of its town hall, which its rings are round.
  const hall = townHallOf(world, hq)!
  const d = (b: Building) =>
    Math.hypot(wrapDelta(hall.x + 1, b.x, terrain.size), wrapDelta(hall.y + 1, b.y, terrain.size))
  return world.buildings.filter(
    (b) => b.cityId === hq.id && b.kind === 'gate' && d(b) > TRADE_ORG_HQ.innerRadius + 1,
  )
}

/** Distance of a tile from the HQ's town hall. */
const fromHall = (b: { x: number; y: number }) => Math.hypot(b.x - MID, b.y - MID)

describe('the HQ closing its gates', () => {
  it('closes its outer gates when armed outsiders pass a share of its soldiers, and opens them', () => {
    const { world, hq, walking } = setup()
    const soldiers = hqPeople(world, hq).slice(0, 8)
    for (const r of soldiers) r.carried.spear = 1
    expect(hqSoldiers(world)).toHaveLength(8)
    const [gx, gy] = hqLayout(MID, MID).outerGates[0]!
    // As many as half its soldiers: the gates stay open.
    const outsiders = armed(world, 'r1', 4, gx, gy - 16)
    run(world, walking, 1)
    expect(armedOutsidersNear(world, hq, terrain.size)).toHaveLength(4)
    expect(outerGates(world, hq).every((g) => !g.closed)).toBe(true)
    // One more: it closes them all.
    outsiders.push(...armed(world, 'r1', 1, gx, gy - 24, 'late'))
    run(world, walking, 1)
    expect(outerGates(world, hq)).toHaveLength(TRADE_ORG_HQ.gates)
    expect(outerGates(world, hq).every((g) => g.closed)).toBe(true)
    // Unarmed ones and those far away don't count; once they put down their arms it opens again.
    for (const r of outsiders.slice(0, 3)) delete r.carried.spear
    run(world, walking, 1)
    expect(outerGates(world, hq).every((g) => !g.closed)).toBe(true)
  })

  it('counts only its soldiers at home', () => {
    const { world, hq, walking } = setup()
    const [gx, gy] = hqLayout(MID, MID).outerGates[0]!
    // No soldiers at all: a single armed outsider closes the gates.
    armed(world, 'r1', 1, gx, gy - 16)
    run(world, walking, 1)
    expect(outerGates(world, hq).every((g) => g.closed)).toBe(true)
  })
})

describe('the HQ against the strongest Organization', () => {
  it('wants a multiple of the strongest side’s armed residents, an alliance counted together', () => {
    const { world } = setup()
    expect(tradeOrgArmyWanted(world)).toBe(TRADE_ORG_ARMY.size)
    world.realms.push(
      { id: 'r2', userId: 8, leaderId: 'x' },
      { id: 'r3', userId: 9, leaderId: 'y' },
    )
    armed(world, 'r1', 8, 40, 40)
    armed(world, 'r2', 7, 40, 80)
    armed(world, 'r3', 12, 40, 120)
    expect(strongestArmed(world)).toBe(12)
    world.alliances.push({
      id: 'al',
      name: 'Pact',
      leaderId: 'r1',
      members: [
        { realmId: 'r1', joinedAt: 0, leaving: null },
        { realmId: 'r2', joinedAt: 0, leaving: null },
      ],
      invites: [],
      army: [],
    })
    expect(strongestArmed(world)).toBe(15)
    expect(tradeOrgArmyWanted(world)).toBe(Math.ceil(15 * TRADE_ORG_ARMY.strongestMultiple))
  })

  it(
    'trains more soldiers than its army’s size when a Player grows strong',
    { tags: ['slow'], timeout: 120_000 },
    () => {
      const { world, hq, walking } = setup()
      const goods = world.buildings.find((b) => b.cityId === hq.id && b.stock?.wood !== undefined)!
      goods.stock!.spear = 40
      armed(world, 'r1', 12, 80, 563)
      const wanted = Math.ceil(12 * TRADE_ORG_ARMY.strongestMultiple)
      expect(wanted).toBeGreaterThan(TRADE_ORG_ARMY.size)
      run(world, walking, 10 * TICKS_PER_GAME_DAY, () => hqSoldiers(world).length >= wanted)
      expect(hqSoldiers(world)).toHaveLength(wanted)
      expect(hqPeople(world, hq).filter((r) => !isArmed(r)).length).toBeGreaterThanOrEqual(
        TRADE_ORG_ARMY.workers,
      )
    },
  )
})

/**
 * The HQ too weak against r1 (more armed residents than it can match from its adults), with a
 * food surplus, Wood for building and no free housing.
 */
function weak() {
  const s = setup()
  armed(s.world, 'r1', 20, 40, 563)
  const storage = s.world.buildings.find((b) => b.cityId === s.hq.id && b.kind === 'storage')!
  storage.stock = { food: 20_000, wood: 2_000 }
  let i = 0
  while (freeHousing(s.world, s.hq) > 0) resident(s.world, `h${i++}`, MID, MID + 28, null)
  return s
}

/**
 * Fills every spot between its rings the HQ could put a house on, so its housing stays full:
 * warehouses wherever one fits, row by row, then smelters in the gaps: nothing an NPC city works
 * or carries its output to, so the HQ goes on as it would.
 */
function fillRoom(world: WorldState, hq: City, outermost: number) {
  const hall = townHallOf(world, hq)!
  const ground = new Ground(world, terrain)
  const r = Math.ceil(hqRingRadius(outermost))
  const between = (x: number, y: number) => {
    const d = Math.hypot(x - MID, y - MID)
    return d > TRADE_ORG_HQ.innerRadius && d <= r + 0.5
  }
  let n = 0
  // The biggest footprints first, so there are few buildings and the ticks stay quick.
  for (const kind of ['warehouse', 'smelter'] as const) {
    for (let y = MID - r; y <= MID + r; y++) {
      for (let x = MID - r; x <= MID + r; x++) {
        if (!ground.fits(kind, x, y, between)) continue
        ground.take(kind, x, y)
        // A workplace belongs to no city (`CONTEXT.md`: Workplace).
        const cityId = kind === 'smelter' ? null : hq.id
        world.buildings.push({ id: `fill${n++}`, kind, cityId, x, y })
      }
    }
  }
  updateCityMembership(world, terrain.size)
  expect(hqHouseTile(world, hall, terrain, outermost)).toBeUndefined()
}

describe('the HQ growing', () => {
  it('stays as it is while it is strong enough', () => {
    const { world, hq } = setup()
    const hall = townHallOf(world, hq)!
    expect(hqRings(world, hall, terrain)).toEqual({ outermost: 0, building: undefined })
    // Its rings stand where the layout put them.
    const ring = hqRingTiles(hall, 0, terrain.size)
    expect(ring.filter((t) => t.kind === 'gate').map((t) => [t.x, t.y])).toEqual(
      expect.arrayContaining(hqLayout(MID, MID).outerGates),
    )
    expect(hqRingsSound.check(world, terrain)).toEqual([])
  })

  it('builds houses between its rings while too weak', () => {
    const { world, walking } = weak()
    const houses = () => world.buildings.filter((b) => b.kind === 'house')
    const before = houses().length
    run(world, walking, TICKS_PER_GAME_DAY, () => houses().length > before)
    expect(houses().length).toBeGreaterThan(before)
    for (const h of houses()) {
      expect(fromHall(h)).toBeGreaterThan(TRADE_ORG_HQ.innerRadius + 0.5)
      expect(fromHall(h)).toBeLessThanOrEqual(TRADE_ORG_HQ.outerRadius + 0.5)
    }
  }, 120_000)

  it(
    'grows a new outer ring once it has no room for houses, and houses beyond the old one',
    { tags: ['slow'], timeout: 120_000 },
    () => {
      const { world, hq, walking } = weak()
      const hall = townHallOf(world, hq)!
      fillRoom(world, hq, 0)
      // Out of room: it starts on a gate of the next ring, in line with the others.
      const next = hqProject(world, hq, terrain)!
      expect(next.building).toBe('gate')
      expect(fromHall(next)).toBeGreaterThan(hqRingRadius(1) - 1.5)
      expect(fromHall(next)).toBeLessThanOrEqual(hqRingRadius(1) + 0.5)
      run(world, walking, 2 * TICKS_PER_GAME_DAY, () =>
        world.buildings.some(
          (b) => !b.site && b.kind === 'gate' && fromHall(b) > hqRingRadius(1) - 1.5,
        ),
      )
      expect(hqRings(world, hall, terrain)).toEqual({ outermost: 0, building: 1 })
      const ring = world.buildings.filter(
        (b) =>
          (b.kind === 'wall' || b.kind === 'gate') && fromHall(b) > TRADE_ORG_HQ.outerRadius + 1,
      )
      expect(ring.length).toBeGreaterThan(0)
      // The old ring stays.
      expect(
        outerGates(world, hq).filter((g) => fromHall(g) <= TRADE_ORG_HQ.outerRadius + 0.5),
      ).toHaveLength(TRADE_ORG_HQ.gates)

      // Once the new ring is finished, its next houses go between the old ring and the new.
      for (const t of hqRingTiles(hall, 1, terrain.size)) {
        const b = world.buildings.find((x) => x.x === t.x && x.y === t.y)
        if (b) delete b.site
        else
          world.buildings.push({
            id: `ring-${t.x}-${t.y}`,
            kind: t.kind,
            cityId: hq.id,
            x: t.x,
            y: t.y,
          })
      }
      expect(hqRings(world, hall, terrain)).toEqual({ outermost: 1, building: undefined })
      const house = hqHouseTile(world, hall, terrain, 1)!
      expect(fromHall(house)).toBeGreaterThan(TRADE_ORG_HQ.outerRadius + 0.5)
      expect(fromHall(house)).toBeLessThan(hqRingRadius(1))
      expect(hqRingsSound.check(world, terrain)).toEqual([])
    },
  )

  it('does not grow while it can match the strongest Organization', () => {
    const { world, hq } = weak()
    world.residents = world.residents.filter((r) => !r.id.startsWith('r1-'))
    fillRoom(world, hq, 0)
    const sites = () => world.buildings.filter((b) => b.site).length
    const walking = new Walking(terrain)
    run(world, walking, 200)
    expect(sites()).toBe(0)
  }, 120_000)
})

describe('hq-rings-sound', () => {
  it('reports a wall off its rings and a house outside them', () => {
    const { world, hq } = setup()
    world.buildings.push(
      { id: 'stray', kind: 'wall', cityId: hq.id, x: MID + 28, y: MID },
      { id: 'far', kind: 'house', cityId: hq.id, x: MID, y: MID + 48 },
    )
    expect(hqRingsSound.check(world, terrain).map((v) => v.message)).toEqual([
      'wall stray of the Trade Org HQ stands on none of its rings',
      'house far of the Trade Org HQ stands outside its rings',
    ])
  })
})
