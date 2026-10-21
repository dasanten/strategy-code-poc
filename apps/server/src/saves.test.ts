import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { backupDb, pruneBackups } from './backup.js'
import { openDb, schema } from './db/index.js'
import { gzipSync } from 'node:zlib'
import {
  LIFESPAN_MAX,
  LIFESPAN_MIN,
  MAX_HEALTH,
  NPC_CITY_MIN_DISTANCE,
  NPC_TOWNS,
  NPC_VILLAGES,
  START_HORSES,
  START_STABLE_FOOD,
  TRADING_POST,
  townHallOf,
  wrapDistance,
  type Carriage,
  type Horse,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { createAdmin } from './auth.js'
import { KEEP_LATEST, loadOrCreateWorld, pruneSaves, saveWorld } from './saves.js'
import { loadTerrain } from './terrain.js'
import { generateTerrain } from './terrain-gen.js'
import { smallTerrain, worldWithCity } from './test-terrain.js'
import { checkInvariants } from './invariants.js'
import { placeTradeOrgHq } from './trade-org.js'
import { placeTradingPosts, regions } from './trading-posts.js'
import { npcCityCount, placeNpcCities } from './npc-cities.js'
import { entitiesInSight } from './sight.js'
import { WorldFormatError, migrateWorld, migrations } from './world-format.js'
import { createWorld, generateWorld } from './world.js'
import { foundStartingCity } from './starting-city.js'

const terrain = smallTerrain()

/** A city as saved before format 15: a walled square with one gate. */
interface OldCity {
  id: string
  name: string
  realmId: string | null
  x: number
  y: number
  size: number
  wall: 'wooden'
  gate: { x: number; y: number }
}

const isInsideWalls = (c: OldCity, x: number, y: number) =>
  x > c.x && y > c.y && x < c.x + c.size - 1 && y < c.y + c.size - 1

/**
 * A fresh world with Player 1's starting city, as it was saved before format 15: each city a
 * walled square, with no town hall, wall or gate buildings. Returns the first city's old shape.
 */
function worldBefore15() {
  const { world, terrain: land } = worldWithCity()
  const cities: OldCity[] = world.cities.map((c) => {
    const walls = world.buildings.filter(
      (b) => b.cityId === c.id && (b.kind === 'wall' || b.kind === 'gate'),
    )
    const gate = walls.find((b) => b.kind === 'gate')!
    const x = Math.min(...walls.map((b) => b.x))
    const y = Math.min(...walls.map((b) => b.y))
    const size = Math.max(...walls.map((b) => b.x)) - x + 1
    return {
      id: c.id,
      name: c.name,
      realmId: c.realmId,
      x,
      y,
      size,
      wall: 'wooden',
      gate: { x: gate.x, y: gate.y },
    }
  })
  const old = structuredClone(world) as unknown as Omit<typeof world, 'cities'> & {
    cities: OldCity[]
  }
  old.cities = cities
  old.buildings = old.buildings.filter((b) => !['townHall', 'wall', 'gate'].includes(b.kind))
  return { world: old, terrain: land, city: cities[0]! }
}

/** Generates the small test map for any seed, counting how often it is asked to. */
function counting() {
  const seeds: number[] = []
  const generate = (seed: number): TerrainMap => {
    seeds.push(seed)
    return seed === 1 ? terrain : generateTerrain(seed, 128)
  }
  return { generate, seeds }
}

describe('world saves', () => {
  it('creates a world once, stores its terrain and loads what was saved', async () => {
    const { db, close } = await openDb(':memory:')
    const { generate, seeds } = counting()
    const fresh = loadOrCreateWorld(db, generate, 3)
    expect(fresh.world).toEqual(generateWorld(fresh.terrain, 3))
    expect(seeds).toEqual([3])
    expect(loadTerrain(db)).toEqual({ seed: 3, map: fresh.terrain })

    fresh.world.tick = 42
    saveWorld(db, fresh.world)
    const loaded = loadOrCreateWorld(db, generate)
    expect(loaded.world).toEqual(fresh.world)
    expect(loaded.terrain).toEqual(fresh.terrain)
    // The stored terrain is used; nothing is generated again.
    expect(seeds).toEqual([3])
    close()
  })

  it('refuses stored terrain from another seed than the save', async () => {
    const { db, close } = await openDb(':memory:')
    const { generate } = counting()
    loadOrCreateWorld(db, generate, 1)
    saveWorld(db, { ...createWorld(terrain, 1), seed: 2 })
    expect(() => loadOrCreateWorld(db, generate)).toThrow(/seed 1, the world is seed 2/)
    close()
  })

  it('resets a world from the disc-shaped map once, keeping accounts (ADR 0006)', async () => {
    const { db, close } = await openDb(':memory:')
    await createAdmin(db, 'Daniel', 'admin password')
    const userId = db.select().from(schema.users).get()!.id
    // An old world: a format-5 save, its terrain and a Player's explored terrain.
    db.insert(schema.worldSaves)
      .values({ tick: 900, version: 5, data: gzipSync(JSON.stringify({ tick: 900, seed: 1 })) })
      .run()
    db.insert(schema.terrain)
      .values({ id: 1, seed: 1, size: 120, data: Buffer.alloc(120 * 120) })
      .run()
    db.insert(schema.explored)
      .values({ userId, data: Buffer.alloc(8), updatedAt: new Date() })
      .run()

    const { generate, seeds } = counting()
    const { world, terrain: fresh } = loadOrCreateWorld(db, generate)
    expect(seeds).toEqual([1])
    expect(world).toEqual(generateWorld(fresh, 1))
    expect(loadTerrain(db)).toEqual({ seed: 1, map: fresh })
    expect(db.select().from(schema.worldSaves).all()).toEqual([])
    expect(db.select().from(schema.explored).all()).toEqual([])
    expect(db.select().from(schema.users).all()).toHaveLength(1)

    // A save in the current format loads as it is; nothing is reset again.
    world.tick = 77
    saveWorld(db, world)
    expect(loadOrCreateWorld(db, generate).world.tick).toBe(77)
    expect(seeds).toEqual([1])
    close()
  })

  it('gives residents empty hands and the world no piles (migration 6 → 7)', () => {
    const resident = { id: 'r1', name: 'Mara', owner: 'realm1', x: 1, y: 2 }
    const v6 = { tick: 10, seed: 1, residents: [resident], cities: [] }
    expect(migrateWorld(v6, 6, { terrain }, migrations, 7)).toEqual({
      ...v6,
      residents: [{ ...resident, carried: {} }],
      piles: [],
    })
  })

  it('leaves every resident idle (migration 7 → 8)', () => {
    const resident = { id: 'r1', name: 'Mara', owner: 'realm1', x: 1, y: 2, carried: {} }
    const v7 = { tick: 10, seed: 1, residents: [resident], piles: [] }
    expect(migrateWorld(v7, 7, { terrain }, migrations, 8)).toEqual({
      ...v7,
      residents: [{ ...resident, order: null }],
    })
  })

  it('gives every resident a lifespan, the same each time (migration 8 → 9)', () => {
    const resident = { id: 'r1', name: 'Mara', owner: 'realm1', x: 1, y: 2, order: null }
    const v8 = { tick: 10, seed: 1, residents: [resident, { ...resident, id: 'r2' }] }
    const v9 = migrateWorld(structuredClone(v8), 8, { terrain }, migrations, 9)
    expect(v9.residents.map(({ lifespan: _lifespan, ...rest }) => rest)).toEqual(v8.residents)
    for (const r of v9.residents) {
      expect(r.lifespan).toBeGreaterThanOrEqual(LIFESPAN_MIN)
      expect(r.lifespan).toBeLessThanOrEqual(LIFESPAN_MAX)
    }
    expect(v9.residents[0]!.lifespan).not.toBe(v9.residents[1]!.lifespan)
    expect(migrateWorld(structuredClone(v8), 8, { terrain }, migrations, 9)).toEqual(v9)
  })

  it('gives every Player an empty realm log (migration 9 → 10)', () => {
    const v9 = { tick: 10, seed: 1, residents: [], piles: [] }
    expect(migrateWorld(v9, 9, { terrain }, migrations, 10)).toEqual({ ...v9, events: [] })
  })

  it('gives every resident the nearest city of their realm, else the nearest city (migration 10 → 11)', () => {
    const city = (id: string, realmId: string | null, x: number) => ({
      id,
      realmId,
      x,
      y: 0,
      size: 7,
    })
    const resident = (id: string, owner: string | null, x: number) => ({ id, owner, x, y: 3 })
    const size = terrain.size
    const v10 = {
      tick: 10,
      seed: 1,
      cities: [city('c1', 'realm1', 0), city('c2', 'realm2', 20), city('c3', null, size - 10)],
      residents: [
        // Nearer c2 and, across the map's join, c3, but c1 is their realm's.
        resident('r1', 'realm1', 18),
        resident('r2', 'realm2', 1),
        // Their realm ended: c3 is nearest the short way round.
        resident('r3', null, size - 2),
      ],
    }
    const v11 = migrateWorld(structuredClone(v10), 10, { terrain }, migrations, 11)
    expect(v11.residents.map((r) => r.cityId)).toEqual(['c1', 'c2', 'c3'])
    expect(v11.residents.map(({ cityId: _cityId, ...rest }) => rest)).toEqual(v10.residents)
    const none = { tick: 10, seed: 1, cities: [], residents: [resident('r1', null, 1)] }
    expect(migrateWorld(none, 10, { terrain }, migrations, 11).residents[0]!.cityId).toBeNull()
  })

  it('gives horses health and starting cities a stable with their horses in it (migration 11 → 12)', () => {
    // A format-11 world: a starting city with no stable and one horse inside its walls, and a
    // horse of nobody out on the map.
    const { world, terrain: land, city } = worldBefore15()
    const v11 = structuredClone(world)
    v11.buildings = v11.buildings.filter((b) => b.kind !== 'stable')
    const strip = ({ health: _health, ...h }: Horse) => h
    v11.horses = [
      { ...world.horses[0]!, x: city.x + 2, y: city.y + city.size - 2 },
      { ...world.horses[1]!, id: 'stray', realmId: null, x: 3, y: 3 },
    ].map(strip) as Horse[]
    // Its carriage stood inside the walls with no horse, as carriages had none yet.
    v11.carriages = v11.carriages.map(({ horseId: _horseId, ...k }) => ({
      ...k,
      x: city.x + 3,
      y: city.y + city.size - 2,
    })) as Carriage[]
    const before = structuredClone(v11)

    const v12 = migrateWorld(structuredClone(v11), 11, { terrain: land }, migrations, 12)
    const stables = v12.buildings.filter((b) => b.kind === 'stable')
    expect(stables).toHaveLength(1)
    const stable = stables[0]!
    expect(stable).toMatchObject({ cityId: city.id, stock: { food: START_STABLE_FOOD } })
    expect(isInsideWalls(city, stable.x, stable.y)).toBe(false)
    // The city's horse moved in and got company of its realm; the stray stayed where it was.
    const inStable = v12.horses.filter((h) => h.x === stable.x && h.y === stable.y)
    expect(inStable).toHaveLength(START_HORSES)
    for (const h of inStable) expect(h.realmId).toBe(city.realmId)
    expect(v12.horses.find((h) => h.id === 'stray')).toMatchObject({ x: 3, y: 3 })
    for (const h of v12.horses) expect(h.health).toBe(MAX_HEALTH)
    // New ids come from the world's counter, and the rest of the world is as it was.
    expect(v12.nextId).toBe(before.nextId + 2)
    expect(v12.residents).toEqual(before.residents)
    expect(checkInvariants(migrateWorld(v12, 12, { terrain: land }), land)).toEqual([])
  })

  it('moves carriages from inside the walls to the stable and hitches a horse (migration 12 → 13)', () => {
    // A format-12 world: the city's carriage inside its walls with no horse, a second one of
    // the realm there too, and a carriage of nobody out on the map.
    const { world, terrain: land, city } = worldBefore15()
    const stable = world.buildings.find((b) => b.kind === 'stable')!
    const inside = { x: city.x + 3, y: city.y + city.size - 2 }
    const v12 = structuredClone(world)
    const own = world.carriages[0]!
    v12.carriages = [
      { ...own, ...inside },
      { ...own, id: 'second', ...inside },
      { ...own, id: 'stray', realmId: null, x: 3, y: 3 },
    ].map(({ horseId: _horseId, ...k }) => k) as Carriage[]
    const before = structuredClone(v12)

    const v13 = migrateWorld(structuredClone(v12), 12, { terrain: land }, migrations, 13)
    const [first, second, stray] = v13.carriages
    // Both of the city's carriages move to the stable, each with its own horse of the realm.
    expect(first).toMatchObject({ x: stable.x, y: stable.y })
    expect(second).toMatchObject({ x: stable.x, y: stable.y })
    expect(first!.horseId).not.toBeNull()
    expect(second!.horseId).not.toBeNull()
    expect(first!.horseId).not.toBe(second!.horseId)
    for (const k of [first!, second!]) {
      expect(v13.horses.find((h) => h.id === k.horseId)?.realmId).toBe(city.realmId)
    }
    // The stray stays where it is, with no horse; the rest of the world is as it was.
    expect(stray).toEqual({ ...before.carriages[2], horseId: null })
    expect(v13.horses).toEqual(before.horses)
    expect(checkInvariants(migrateWorld(v13, 13, { terrain: land }), land)).toEqual([])
  })

  it('gives running haul routes no return goods (migration 13 → 14)', () => {
    // A format-13 world: the city's driver on a haul route from the stable to the storage.
    const { world, terrain: land } = worldBefore15()
    const storage = world.buildings.find((b) => b.kind === 'storage')!
    const k = world.carriages[0]!
    const [driver, other] = world.residents
    driver!.x = k.x
    driver!.y = k.y
    const route = {
      kind: 'haul',
      carriageId: k.id,
      from: { x: k.x, y: k.y },
      to: { x: storage.x, y: storage.y },
      goods: ['ironOre'],
      keepFood: 6,
      stop: 'from',
      phase: 'loading',
      path: null,
      progress: 0,
      moving: null,
    }
    const v13 = structuredClone(world) as unknown as { residents: { order: unknown }[] }
    v13.residents[0]!.order = route
    const before = structuredClone(v13)

    const v14 = migrateWorld(structuredClone(v13), 13, { terrain: land }, migrations, 14)
    expect(v14.residents[0]!.order).toEqual({ ...route, returnGoods: [] })
    // Everyone else is as they were.
    expect(v14.residents.slice(1)).toEqual(before.residents.slice(1))
    expect(v14.residents[1]!.order).toEqual(other!.order)
    expect(checkInvariants(migrateWorld(v14, 14, { terrain: land }), land)).toEqual([])
  })

  it('gives cities a town hall and turns their wall ring into wall and gate buildings (migration 14 → 15)', () => {
    // A format-14 world: the starting city as a walled square, and a pair living in it.
    const { world, terrain: land, city } = worldBefore15()
    const [a, b] = world.residents
    a!.order = { kind: 'pair', partnerId: b!.id, since: 0 }
    b!.order = { kind: 'pair', partnerId: a!.id, since: 0 }
    const before = structuredClone(world)

    const v15 = migrateWorld(structuredClone(world), 14, { terrain: land }, migrations, 15)
    expect(v15.cities).toHaveLength(1)
    const c = v15.cities[0]!
    expect(c).toEqual({
      id: city.id,
      name: city.name,
      realmId: city.realmId,
      townHallId: c.townHallId,
    })
    // The town hall stands inside the walls, by the storage in the middle.
    const hall = v15.buildings.find((x) => x.id === c.townHallId)!
    expect(hall).toMatchObject({ kind: 'townHall', cityId: c.id })
    expect(isInsideWalls(city, hall.x, hall.y)).toBe(true)
    // Every tile of the old wall ring is a wall now, and the gate a gate, all of the city.
    const ring = v15.buildings.filter((x) => x.kind === 'wall' || x.kind === 'gate')
    expect(ring).toHaveLength(4 * (city.size - 1))
    expect(ring.filter((x) => x.kind === 'gate')).toEqual([
      expect.objectContaining({ x: city.gate.x, y: city.gate.y }),
    ])
    for (const x of ring) expect(x.cityId).toBe(c.id)
    // Houses and the storage still belong to it, so does the farm laid out for it.
    for (const x of before.buildings) {
      expect(v15.buildings.find((y) => y.id === x.id)).toEqual(x)
    }
    // Residents and their pairs are as they were; new ids come from the world's counter.
    expect(v15.residents).toEqual(before.residents)
    expect(v15.nextId).toBe(before.nextId + 1 + ring.length)
    expect(checkInvariants(v15, land)).toEqual([])
  })

  it('dissolves an old city with no room left for a town hall (migration 14 → 15)', () => {
    const { world, terrain: land, city } = worldBefore15()
    // Fill every free tile inside the walls.
    for (let y = city.y + 1; y < city.y + city.size - 1; y++) {
      for (let x = city.x + 1; x < city.x + city.size - 1; x++) {
        if (world.buildings.some((b) => b.x === x && b.y === y)) continue
        world.buildings.push({ id: `h${x},${y}`, kind: 'house', cityId: city.id, x, y })
      }
    }
    const [a, b] = world.residents
    a!.order = { kind: 'pair', partnerId: b!.id, since: 0 }
    b!.order = { kind: 'pair', partnerId: a!.id, since: 0 }

    const v15 = migrateWorld(structuredClone(world), 14, { terrain: land }, migrations, 15)
    expect(v15.cities).toEqual([])
    for (const r of v15.residents) expect(r.cityId).toBeNull()
    expect(v15.residents[0]!.order).toBeNull()
    for (const x of v15.buildings) expect(x.cityId).toBeNull()
    expect(checkInvariants(v15, land)).toEqual([])
  })

  it('gives the world no alliances (migration 15 → 16)', () => {
    const v15 = { tick: 10, seed: 1, residents: [], realms: [] }
    expect(migrateWorld(v15, 15, { terrain }, migrations, 16)).toEqual({ ...v15, alliances: [] })
  })

  it('gives the world no mercenary contracts (migration 23 → 24)', () => {
    const v23 = { tick: 10, seed: 1, residents: [], realms: [], armies: [], crimes: [] }
    expect(migrateWorld(v23, 23, { terrain }, migrations, 24)).toEqual({ ...v23, contracts: [] })
  })

  it('gives the world no armies (migration 18 → 19)', () => {
    const v18 = { tick: 10, seed: 1, residents: [], realms: [], alliances: [], crimes: [] }
    expect(migrateWorld(v18, 18, { terrain }, migrations, 19)).toEqual({ ...v18, armies: [] })
  })

  it('places NPC cities in the live world, out of every Player’s sight (migration 16 → 17)', () => {
    const { world, terrain: land } = worldWithCity()
    const before = structuredClone(world)
    const v17 = migrateWorld(structuredClone(world), 16, { terrain: land }, migrations, 17)
    // What was there stays as it was; the new cities come after it.
    expect(v17.cities.slice(0, before.cities.length)).toEqual(before.cities)
    expect(v17.residents.slice(0, before.residents.length)).toEqual(before.residents)
    expect(v17.buildings.slice(0, before.buildings.length)).toEqual(before.buildings)
    const npc = v17.cities.slice(before.cities.length)
    expect(npc).toHaveLength(
      npcCityCount(NPC_TOWNS, land.size) + npcCityCount(NPC_VILLAGES, land.size),
    )
    expect(npc.length).toBeGreaterThan(0)
    for (const c of npc) expect(c.realmId).toBeNull()
    // The Player sees none of them.
    const realm = v17.realms[0]!
    const seen = new Set(entitiesInSight(v17, land, realm.id).map((e) => e.id))
    for (const c of npc) {
      expect(seen.has(c.id)).toBe(false)
      for (const r of v17.residents.filter((x) => x.cityId === c.id))
        expect(seen.has(r.id)).toBe(false)
    }
    expect(checkInvariants(v17, land)).toEqual([])
    // The same save always migrates the same way.
    expect(migrateWorld(structuredClone(world), 16, { terrain: land }, migrations, 17)).toEqual(v17)
  })

  it('gives the world no crimes (migration 17 → 18)', () => {
    const v17 = { tick: 10, seed: 1, residents: [], realms: [] }
    expect(migrateWorld(v17, 17, { terrain }, migrations, 18)).toEqual({ ...v17, crimes: [] })
  })

  it('turns the cities, residents, horses and carriages of dead Leaders self-managed (migration 19 → 20)', () => {
    // A format-19 world: Player 1's Leader died, leaving everything to nobody; one of their
    // residents had no home and was out on an errand. Player 2 still has their realm.
    const { world, terrain: land } = worldWithCity()
    const city = world.cities[0]!
    const dead = world.realms[0]!
    world.realms = []
    for (const r of world.residents) r.owner = null
    city.realmId = null
    for (const k of [...world.horses, ...world.carriages]) k.realmId = null
    const homeless = world.residents.find((r) => r.id !== dead.leaderId)!
    const hall = world.buildings.find((b) => b.id === city.townHallId)!
    homeless.cityId = null
    Object.assign(homeless, { x: hall.x + 12, y: hall.y })
    homeless.order = { kind: 'tearDown', buildingId: hall.id, at: { x: hall.x, y: hall.y } }
    const living = foundStartingCity(world, land, 2)
    const v19 = structuredClone(world)
    v19.horses = v19.horses.map(({ cityId: _cityId, ...h }) => h) as Horse[]
    v19.carriages = v19.carriages.map(({ cityId: _cityId, ...k }) => k) as Carriage[]
    const before = structuredClone(v19)

    const v20 = migrateWorld(structuredClone(v19), 19, { terrain: land }, migrations, 20)
    const joined = v20.residents.find((r) => r.id === homeless.id)!
    expect(joined.cityId).toBe(city.id)
    expect(joined.order).toMatchObject({ kind: 'walkTo', target: { x: expect.any(Number) } })
    // The others already lived in the city and are left as they were.
    expect(v20.residents.filter((r) => r.id !== homeless.id)).toEqual(
      before.residents.filter((r) => r.id !== homeless.id),
    )
    for (const k of [...v20.horses, ...v20.carriages]) {
      expect(k.cityId).toBe(k.realmId === null ? city.id : null)
    }
    expect(v20.horses.filter((h) => h.realmId === living.id)).toHaveLength(START_HORSES)
    expect(checkInvariants(v20, land).map((v) => v.message)).toEqual([])
    // The same save always migrates the same way.
    expect(migrateWorld(structuredClone(v19), 19, { terrain: land }, migrations, 20)).toEqual(v20)
  })

  it('places the Trade Org HQ in the live world, far away and out of sight (migration 20 → 21)', () => {
    const { world, terrain: land } = worldWithCity()
    placeNpcCities(world, land)
    const before = structuredClone(world)
    const v21 = migrateWorld(structuredClone(world), 20, { terrain: land }, migrations, 21)
    // What was there stays as it was; the HQ comes after it.
    expect(v21.cities.slice(0, before.cities.length)).toEqual(before.cities)
    expect(v21.residents.slice(0, before.residents.length)).toEqual(before.residents)
    expect(v21.buildings.slice(0, before.buildings.length)).toEqual(before.buildings)
    const added = v21.cities.slice(before.cities.length)
    expect(added).toHaveLength(1)
    const hq = added[0]!
    expect(hq).toMatchObject({ realmId: null, tradeOrg: 'hq' })
    expect(v21.buildings.filter((b) => b.kind === 'warehouse' && b.cityId === hq.id)).toHaveLength(
      2,
    )
    // Far from every city: as far as the map allows.
    const hall = townHallOf(v21, hq)!
    const nearest = Math.min(
      ...before.cities.map((c) => wrapDistance(land.size, hall, townHallOf(v21, c)!)),
    )
    expect(nearest).toBeGreaterThanOrEqual(NPC_CITY_MIN_DISTANCE)
    // The Player sees none of it.
    const realm = v21.realms[0]!
    const seen = new Set(entitiesInSight(v21, land, realm.id).map((e) => e.id))
    for (const e of [
      ...v21.buildings.filter((b) => b.cityId === hq.id),
      ...v21.residents.filter((r) => r.cityId === hq.id),
    ])
      expect(seen.has(e.id)).toBe(false)
    expect(checkInvariants(v21, land)).toEqual([])
    // The same save always migrates the same way, and a world that has an HQ gets no other.
    expect(migrateWorld(structuredClone(world), 20, { terrain: land }, migrations, 21)).toEqual(v21)
    expect(migrateWorld(structuredClone(v21), 20, { terrain: land }, migrations, 21)).toEqual(v21)
  })

  it('places trading posts in the live world, out of sight (migration 21 → 22)', () => {
    const { world, terrain: land } = worldWithCity()
    placeTradeOrgHq(world, land)
    placeNpcCities(world, land)
    const before = structuredClone(world)
    const v22 = migrateWorld(structuredClone(world), 21, { terrain: land }, migrations, 22)
    // What was there stays as it was; the posts come after it.
    expect(v22.cities.slice(0, before.cities.length)).toEqual(before.cities)
    expect(v22.residents.slice(0, before.residents.length)).toEqual(before.residents)
    expect(v22.buildings.slice(0, before.buildings.length)).toEqual(before.buildings)
    const added = v22.cities.slice(before.cities.length)
    expect(added.length).toBeGreaterThanOrEqual(1)
    expect(added.length).toBeLessThanOrEqual(regions(land.size).length)
    const realm = v22.realms[0]!
    const start = v22.cities.find((c) => c.realmId === realm.id)!
    const seen = new Set(entitiesInSight(v22, land, realm.id).map((e) => e.id))
    for (const post of added) {
      expect(post).toMatchObject({ realmId: null, tradeOrg: 'post' })
      expect(
        v22.buildings.filter((b) => b.kind === 'warehouse' && b.cityId === post.id),
      ).toHaveLength(1)
      const d = wrapDistance(land.size, townHallOf(v22, post)!, townHallOf(v22, start)!)
      expect(d).toBeGreaterThanOrEqual(NPC_CITY_MIN_DISTANCE - TRADING_POST.size)
      for (const e of [
        ...v22.buildings.filter((b) => b.cityId === post.id),
        ...v22.residents.filter((r) => r.cityId === post.id),
      ])
        expect(seen.has(e.id)).toBe(false)
    }
    expect(checkInvariants(v22, land)).toEqual([])
    // The same save always migrates the same way, and a region with a post gets no other.
    expect(migrateWorld(structuredClone(world), 21, { terrain: land }, migrations, 22)).toEqual(v22)
    expect(migrateWorld(structuredClone(v22), 21, { terrain: land }, migrations, 22)).toEqual(v22)
  })

  it('gives the HQ a caravan for every trading post (migration 24 → 25)', () => {
    const { world, terrain: land } = worldWithCity()
    placeTradeOrgHq(world, land)
    placeNpcCities(world, land)
    placeTradingPosts(world, land)
    const v24: Partial<WorldState> = structuredClone(world)
    delete v24.caravans
    const before = structuredClone(v24)
    const v25 = migrateWorld(structuredClone(v24), 24, { terrain: land }, migrations, 25)
    // What was there stays as it was; the caravans' carriages, horses and crew come after it.
    expect(v25.residents.slice(0, before.residents.length)).toEqual(before.residents)
    expect(v25.carriages.slice(0, before.carriages.length)).toEqual(before.carriages)
    expect(v25.horses.slice(0, before.horses.length)).toEqual(before.horses)
    expect(v25.cities).toEqual(before.cities)
    const posts = v25.cities.filter((c) => c.tradeOrg === 'post')
    expect(posts.length).toBeGreaterThan(0)
    expect(v25.caravans.map((c) => c.postId).sort()).toEqual(posts.map((c) => c.id).sort())
    expect(checkInvariants(v25, land)).toEqual([])
    // The same save always migrates the same way.
    expect(migrateWorld(structuredClone(v24), 24, { terrain: land }, migrations, 25)).toEqual(v25)
  })

  it('gives every caravan no delivery and the world none (migration 26 → 27)', () => {
    const v26 = { tick: 5, caravans: [{ id: 'caravan1', postId: 'c2', toLoad: null }] }
    const v27 = migrateWorld(structuredClone(v26), 26, { terrain: smallTerrain() }, migrations, 27)
    expect(v27).toEqual({
      tick: 5,
      caravans: [{ ...v26.caravans[0], job: null }],
      deliveries: [],
    })
  })

  it('counts no robbery on any route or caravan job (migration 28 → 29)', () => {
    const job = { deliveryId: 'delivery1', step: 'deliver', units: 3 }
    const v28 = {
      tick: 5,
      caravans: [
        { id: 'caravan1', postId: 'c2', job: null },
        { id: 'caravan2', postId: 'c3', job },
      ],
    }
    const v29 = migrateWorld(structuredClone(v28), 28, { terrain: smallTerrain() }, migrations, 29)
    expect(v29).toEqual({
      tick: 5,
      caravans: [v28.caravans[0], { ...v28.caravans[1], job: { ...job, robbed: 0 } }],
      routeRobberies: {},
    })
  })

  it('starts everyone neutral toward everyone (migration 25 → 26)', () => {
    const { world, terrain: land } = worldWithCity()
    const v25: Partial<WorldState> = structuredClone(world)
    delete v25.standings
    const v26 = migrateWorld(structuredClone(v25), 25, { terrain: land }, migrations, 26)
    expect(v26).toEqual({ ...v25, standings: [] })
    expect(checkInvariants(v26, land)).toEqual([])
  })

  it('starts with no city asking to join (migration 27 → 28)', () => {
    const { world, terrain: land } = worldWithCity()
    const v27: Partial<WorldState> = structuredClone(world)
    delete v27.joinRequests
    const v28 = migrateWorld(structuredClone(v27), 27, { terrain: land }, migrations, 28)
    expect(v28).toEqual({ ...v27, joinRequests: [] })
    expect(checkInvariants(v28, land)).toEqual([])
  })

  it('gives every alliance an empty army (migration 22 → 23)', () => {
    const v22 = {
      tick: 5,
      alliances: [{ id: 'alliance1', name: 'North', leaderId: 'realm1', members: [], invites: [] }],
    }
    const v23 = migrateWorld(structuredClone(v22), 22, { terrain: smallTerrain() }, migrations, 23)
    expect(v23).toEqual({ tick: 5, alliances: [{ ...v22.alliances[0], army: [] }] })
  })

  it('keeps the newest saves and one per hour for a week', async () => {
    const { db, close } = await openDb(':memory:')
    const now = 1_000_000_000
    const hour = 3600
    // 10 saves an hour for 10 days, oldest first.
    for (let h = 240; h > 0; h--) {
      for (let i = 0; i < 10; i++) {
        db.insert(schema.worldSaves)
          .values({
            tick: 0,
            version: 1,
            data: Buffer.from(''),
            createdAt: new Date((now - h * hour + i) * 1000),
          })
          .run()
      }
    }
    pruneSaves(db, now)
    const left = db
      .select({ n: sql<number>`count(*)` })
      .from(schema.worldSaves)
      .get()!.n
    // One per hour for the last 7 days (168) plus the newest 20, which overlap the last 2 hours.
    expect(left).toBe(168 + KEEP_LATEST - 2)
    close()
  })
})

describe('world format migrations', () => {
  it('runs every step from the saved version to the current one', () => {
    const steps = {
      1: (s: unknown) => ({ ...(s as object), a: 1 }),
      2: (s: unknown) => ({ ...(s as object), b: 2 }),
    }
    expect(migrateWorld({ tick: 5 }, 1, { terrain }, steps, 3)).toEqual({ tick: 5, a: 1, b: 2 })
    expect(migrateWorld({ tick: 5 }, 3, { terrain }, steps, 3)).toEqual({ tick: 5 })
  })

  it('refuses a missing step or a newer save', () => {
    expect(() => migrateWorld({}, 1, { terrain }, {}, 2)).toThrow(WorldFormatError)
    expect(() => migrateWorld({}, 3, { terrain }, {}, 2)).toThrow(/newer than this server/)
  })
})

describe('backups', () => {
  it('backs up before migrating and prunes old backups', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csp-backup-'))
    const dbPath = path.join(dir, 'world.db')
    const backups = path.join(dir, 'backups')

    const first = await openDb(dbPath)
    saveWorld(first.db, createWorld(terrain))
    first.close()

    let backupFile = ''
    const second = await openDb(dbPath, {
      beforeMigrate: async (s) => {
        backupFile = await backupDb(s, backups, 'start')
      },
    })
    second.close()
    expect(fs.existsSync(backupFile)).toBe(true)
    const restored = await openDb(backupFile)
    expect(loadOrCreateWorld(restored.db, () => terrain).world.seed).toBe(1)
    restored.close()

    const old = path.join(backups, 'world-old-daily.db')
    fs.writeFileSync(old, '')
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000)
    fs.utimesSync(old, fifteenDaysAgo, fifteenDaysAgo)
    pruneBackups(backups)
    expect(fs.existsSync(old)).toBe(false)
    expect(fs.existsSync(backupFile)).toBe(true)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
