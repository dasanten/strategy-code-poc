import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { backupDb, pruneBackups } from './backup.js'
import { openDb, schema } from './db/index.js'
import { gzipSync } from 'node:zlib'
import {
  AVERAGE_HORSE_STATS,
  HORSE_START_AGE_MAX,
  HORSE_START_AGE_MIN,
  horseAgeInYears,
  horsesIn,
  tradeOrgHq,
  type TerrainMap,
  TRADERS,
  TRADER_ESCORTS,
} from '@csp/shared'
import { createAdmin } from './auth.js'

import { KEEP_LATEST, WorldSaver, loadOrCreateWorld, pruneSaves, saveWorld } from './saves.js'
import { loadTerrain } from './terrain.js'
import { generateTerrain } from './terrain-gen.js'
import { HORSE_NAMES } from './horses.js'
import { checkInvariants } from './invariants.js'
import { Walking } from './walking.js'
import { refreshLastSeen } from './last-seen.js'
import { smallTerrain, worldWithCity, worldWithPost } from './test-terrain.js'
import {
  RESET_BEFORE,
  WORLD_FORMAT_VERSION,
  WorldFormatError,
  migrateWorld,
  migrations,
} from './world-format.js'
import { createWorld, generateWorld, stepWorld } from './world.js'

const terrain = smallTerrain()

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

  it.each([
    ['from the disc-shaped map', 5],
    ['from before the finer grid (the second reset)', RESET_BEFORE - 1],
  ])('discards a world %s, keeping accounts (ADR 0006)', async (_, version) => {
    const { db, close } = await openDb(':memory:')
    await createAdmin(db, 'Daniel', 'admin password')
    const userId = db.select().from(schema.users).get()!.id
    // An old world: an old save, its terrain and a Player's explored terrain.
    db.insert(schema.worldSaves)
      .values({ tick: 900, version, data: gzipSync(JSON.stringify({ tick: 900, seed: 1 })) })
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
    // Nobody has a realm yet: every Player gets a new starting city on their next login.
    expect(world.realms).toEqual([])

    // A save in the current format loads as it is; nothing is reset again.
    world.tick = 77
    saveWorld(db, world)
    expect(loadOrCreateWorld(db, generate).world.tick).toBe(77)
    expect(seeds).toEqual([1])
    close()
  })

  it('has no migration steps from before the second reset', () => {
    expect(Object.keys(migrations).every((v) => Number(v) >= RESET_BEFORE)).toBe(true)
  })

  it('lets trading posts already captured leave the Trade Organization (migration 37 → 38)', () => {
    const { world: v37, terrain: land, post } = worldWithPost()
    const realm = v37.realms[0]!
    const warehouse = v37.buildings.find((b) => b.cityId === post.id && b.kind === 'warehouse')!
    // Captured the old way: the realm's, but still a Trade Org post with its caravan. A format 37
    // world marks no name as the game's.
    post.realmId = realm.id
    for (const r of v37.residents) delete r.gameName
    for (const r of v37.residents) if (r.cityId === post.id) r.owner = realm.id
    v37.routeRobberies[post.id] = 2
    const v38 = migrateWorld(structuredClone(v37), 37, { terrain: land }, migrations, 38)
    const city = v38.cities.find((c) => c.id === post.id)!
    expect(city.tradeOrg).toBeUndefined()
    expect(v38.buildings.find((b) => b.id === warehouse.id)).toMatchObject({
      kind: 'storage',
      stock: warehouse.stock,
    })
    expect(v37.caravans.some((c) => c.postId === post.id)).toBe(true)
    expect(v38.caravans.some((c) => c.postId === post.id)).toBe(false)
    expect(v38.routeRobberies).toEqual({})
    expect(checkInvariants(v38, land)).toEqual([])
  })

  it('lets an HQ already captured leave the Trade Organization (migration 78 → 79)', () => {
    const { world: v78, terrain: land, post } = worldWithPost()
    const realm = v78.realms[0]!
    const hq = v78.cities.find((c) => c.tradeOrg === 'hq')!
    const coins = v78.buildings.find(
      (b) => b.cityId === hq.id && b.kind === 'warehouse' && (b.stock?.coins ?? 0) > 0,
    )!
    // Captured the old way: the realm's, but still the Trade Org's HQ, its caravan running.
    hq.realmId = realm.id
    for (const r of v78.residents) {
      if (r.cityId !== hq.id) continue
      r.owner = realm.id
      // The realm's own names would have had a numeral added; not what this step is about.
      delete r.gameName
    }
    for (const t of [...v78.carriages, ...v78.horses]) {
      if (t.cityId === hq.id) Object.assign(t, { realmId: realm.id, cityId: null })
    }
    v78.routeRobberies[post.id] = 2
    expect(checkInvariants(v78, land)).not.toEqual([])
    const v79 = migrateWorld(structuredClone(v78), 78, { terrain: land }, migrations, 79)
    const city = v79.cities.find((c) => c.id === hq.id)!
    expect(city.tradeOrg).toBeUndefined()
    expect(v79.buildings.find((b) => b.id === coins.id)).toMatchObject({
      kind: 'storage',
      stock: coins.stock,
    })
    expect(v78.caravans.length).toBeGreaterThan(0)
    expect(v79.caravans).toEqual([])
    expect(v79.routeRobberies).toEqual({})
    expect(v79.cities.find((c) => c.id === post.id)?.tradeOrg).toBe('post')
    expect(checkInvariants(v79, land)).toEqual([])
    // A world whose HQ still stands is left as it was.
    const { world: standing, terrain: same } = worldWithPost()
    expect(migrateWorld(structuredClone(standing), 78, { terrain: same }, migrations, 79)).toEqual(
      standing,
    )
  })

  it('has the HQ send out its wandering traders (migration 80 → 81)', () => {
    const { world: now, terrain: land } = worldWithPost()
    // A format 80 world had neither traders nor their carriages, horses and crew.
    const trader = now.traders[0]!
    const gone = new Set([trader.driverId, ...trader.escortIds])
    const v80: Partial<typeof now> = {
      ...now,
      residents: now.residents.filter((r) => !gone.has(r.id)),
      carriages: now.carriages.filter((k) => k.id !== trader.carriageId),
      horses: now.horses.filter(
        (h) => h.id !== now.carriages.find((k) => k.id === trader.carriageId)?.horseId,
      ),
    }
    delete v80.traders
    const v81 = migrateWorld(structuredClone(v80), 80, { terrain: land })
    const posts = v81.cities.filter((c) => c.tradeOrg === 'post').map((c) => c.id)
    expect(posts.length).toBeGreaterThan(0)
    expect(v81.traders).toHaveLength(Math.min(TRADERS, posts.length))
    for (const t of v81.traders) {
      expect(t.loop).toEqual(posts)
      expect(v81.carriages.some((k) => k.id === t.carriageId)).toBe(true)
      expect(t.escortIds).toHaveLength(TRADER_ESCORTS)
      expect(v81.residents.some((r) => r.id === t.driverId)).toBe(true)
    }
    expect(checkInvariants(v81, land)).toEqual([])
    // And on it goes from there, tick by tick.
    const walking = new Walking(land)
    for (let i = 0; i < 5; i++) stepWorld(v81, land, walking)
    expect(checkInvariants(v81, land)).toEqual([])
    // A world with no HQ has no one to send them.
    const fallen = structuredClone(v80)
    fallen.cities = fallen.cities!.map((c) => ({
      ...c,
      ...(c.tradeOrg === 'hq' ? { tradeOrg: undefined } : {}),
    }))
    expect(migrateWorld(fallen, 80, { terrain: land }).traders).toEqual([])
  })

  it('leaves every resident unmarked for orders standing under attack (migration 79 → 80)', () => {
    const { world: v79, terrain: land } = worldWithPost()
    const v80 = migrateWorld(structuredClone(v79), 79, { terrain: land }, migrations, 80)
    expect(v80).toEqual(v79)
    expect(v80.residents.every((r) => r.givenUnderAttack === undefined)).toBe(true)
    expect(checkInvariants(v80, land)).toEqual([])
  })

  it('leaves realms from before realm names unnamed (migration 38 → 39)', () => {
    const { world: v38, terrain: land } = worldWithPost()
    expect(v38.realms.length).toBeGreaterThan(0)
    // The live format, so a step no version reaches would show here.
    expect(WORLD_FORMAT_VERSION).toBe(82)
    const v39 = migrateWorld(structuredClone(v38), 38, { terrain: land }, migrations, 39)
    expect(v39.realms).toEqual(v38.realms)
    expect(v39.realms.every((r) => r.name === undefined)).toBe(true)
    expect(checkInvariants(v39, land)).toEqual([])
  })

  it('migrates a format 39 world: every Player starts with an empty Last seen (migration 39 → 40)', () => {
    const { world } = worldWithCity()
    const old: Partial<typeof world> = { ...world }
    delete old.lastSeen
    const migrated = migrateWorld(old, 39, { terrain: smallTerrain() })
    expect(migrated.lastSeen).toEqual({})
    expect(migrated.buildings).toEqual(world.buildings)
  })

  it('migrates a format 64 world: every city starts without a plan (migration 64 → 65)', () => {
    const { world, terrain } = worldWithPost()
    const old: Partial<typeof world> = structuredClone(world)
    delete old.cityPlans
    const migrated = migrateWorld(old, 64, { terrain }, migrations, 65)
    expect(migrated).toEqual({ ...world, cityPlans: {} })
    expect(checkInvariants(migrated, terrain)).toEqual([])
  })

  it('migrates a format 52 world: every Player starts with their Horse offer unclaimed (migration 52 → 53)', () => {
    const { world, terrain } = worldWithPost()
    expect(world.horses.some((h) => h.realmId === world.realms[0]!.id)).toBe(true)
    const old: Partial<typeof world> = structuredClone(world)
    delete old.horseOffersClaimed
    const migrated = migrateWorld(old, 52, { terrain }, migrations, 53)
    expect(migrated).toEqual({ ...world, horseOffersClaimed: [] })
    expect(checkInvariants(migrated, terrain)).toEqual([])
  })

  it('gives a running worker the workplace in their memory as the param workplace (migration 54 → 55)', () => {
    const { world, terrain } = worldWithCity()
    const [worker, npc, other] = world.residents
    const farm = world.buildings[0]!
    worker!.script = { scriptId: 7, memory: { workplaceId: farm.id, at: { x: 1, y: 2 } } }
    worker!.scriptParams = { 7: { storage: 'storage-1' } }
    // The game's own default, run by an NPC city, keeps its memory only.
    npc!.script = { scriptId: 0, task: 'work', memory: { workplaceId: farm.id } }
    // A workplace gone from the world is none to give.
    other!.script = { scriptId: 8, memory: { workplaceId: 'gone' } }
    const migrated = migrateWorld(structuredClone(world), 54, { terrain }, migrations, 55)
    const [w, n, o] = migrated.residents
    expect(w!.scriptParams).toEqual({ 7: { storage: 'storage-1', workplace: farm.id } })
    expect(w!.script).toEqual(worker!.script)
    expect(n!.scriptParams).toBeUndefined()
    expect(o!.scriptParams).toBeUndefined()
  })

  it('gives a builder their site and a hauler their carriage as params (migration 56 → 57)', () => {
    const { world, terrain } = worldWithCity()
    const [builder, hauler, npc, other, nobodys] = world.residents
    const site = { delivered: {}, work: 0 }
    // A farm site laid out for the realm's city is the realm's, so the param can hold it.
    world.buildings.push({
      id: 'site-1',
      kind: 'farm',
      cityId: world.cities[0]!.id,
      x: 1,
      y: 1,
      site,
    })
    world.carriages.push({
      id: 'k1',
      realmId: world.realms[0]!.id,
      cityId: null,
      x: 3,
      y: 3,
      horseId: null,
      load: {},
    })
    const building = { building: 'farm', at: { x: 1, y: 1 }, siteId: 'site-1' }
    builder!.script = { scriptId: 7, memory: building }
    builder!.scriptParams = { 7: { source: 'storage-1' } }
    const route = { from: { x: 3, y: 3 }, to: { x: 9, y: 9 }, goods: ['wood'], returnGoods: [] }
    hauler!.script = { scriptId: 8, memory: { carriageId: 'k1', ...route, keepFood: 0 } }
    // The game's own default, run by an NPC city, keeps its memory only.
    npc!.script = { scriptId: 0, task: 'build', memory: building }
    // A finished building is no site to join, and a carriage gone is none to drive.
    world.buildings.push({ id: 'done', kind: 'house', cityId: null, x: 5, y: 5 })
    other!.script = { scriptId: 9, memory: { siteId: 'done', carriageId: 'gone' } }
    // A house site out of every city is nobody's: the param can't hold it, the memory keeps it.
    world.buildings.push({ id: 'site-2', kind: 'house', cityId: null, x: 7, y: 1, site })
    nobodys!.script = { scriptId: 7, memory: { ...building, building: 'house', siteId: 'site-2' } }
    const migrated = migrateWorld(structuredClone(world), 56, { terrain }, migrations, 57)
    const [b, h, n, o, none] = migrated.residents
    expect(none!.scriptParams).toBeUndefined()
    expect(b!.scriptParams).toEqual({ 7: { source: 'storage-1', site: 'site-1' } })
    expect(b!.script).toEqual(builder!.script)
    expect(h!.scriptParams).toEqual({ 8: { carriage: 'k1' } })
    expect(n!.scriptParams).toBeUndefined()
    expect(o!.scriptParams).toBeUndefined()
  })

  it('gives each construction site the realm of a builder, else of its city (migration 57 → 58)', () => {
    const { world, terrain } = worldWithCity()
    const [builder, npc] = world.residents
    const city = world.cities[0]!
    const realmId = world.realms[0]!.id
    expect(city.realmId).toBe(realmId)
    world.realms.push({ id: 'r-other', userId: 99, leaderId: builder!.id })
    builder!.owner = 'r-other'
    npc!.owner = null
    const site = () => ({ delivered: {}, work: 0 })
    const hall = world.buildings.find((b) => b.id === city.townHallId)!
    world.buildings.push(
      // Built by a resident of another realm: theirs, though it stands in the city.
      { id: 'built', kind: 'house', cityId: null, x: hall.x + 3, y: hall.y, site: site() },
      // In the city's area with nobody of a realm building it: the city's realm's.
      { id: 'near', kind: 'house', cityId: null, x: hall.x, y: hall.y + 3, site: site() },
      // A farm site laid out for the city: the city's realm's.
      { id: 'farm', kind: 'farm', cityId: city.id, x: 40, y: 40, site: site() },
      // Far from every city, an NPC builder only: nobody's.
      { id: 'far', kind: 'storage', cityId: null, x: 60, y: 10, site: site() },
      { id: 'done', kind: 'house', cityId: null, x: 60, y: 30 },
    )
    builder!.order = { kind: 'build', building: 'house', at: { x: 0, y: 0 }, siteId: 'built' }
    npc!.order = { kind: 'build', building: 'storage', at: { x: 60, y: 10 }, siteId: 'far' }
    const migrated = migrateWorld(structuredClone(world), 57, { terrain }, migrations, 58)
    const realmOf = (id: string) => migrated.buildings.find((b) => b.id === id)!.realmId
    expect(realmOf('built')).toBe('r-other')
    expect(realmOf('near')).toBe(realmId)
    expect(realmOf('farm')).toBe(realmId)
    expect(realmOf('far')).toBeUndefined()
    expect(realmOf('done')).toBeUndefined()
  })

  it('gives residents tearing down, breeding and feeding their target as its param (migration 55 → 56)', () => {
    const { world, terrain } = worldWithCity()
    const [wrecker, breeder, feeder, npc, other] = world.residents
    const farm = world.buildings[0]!
    const stable = { id: 'stable-1', kind: 'stable' as const, cityId: farm.cityId, x: 1, y: 1 }
    // Another realm's building, which no param of theirs can name.
    const theirs = { id: 'theirs', kind: 'house' as const, cityId: 'elsewhere', x: 9, y: 9 }
    world.buildings.push(stable, theirs)
    wrecker!.script = { scriptId: 9, memory: { buildingId: farm.id } }
    wrecker!.scriptParams = { 9: { foodTake: 4 } }
    breeder!.script = { scriptId: 10, memory: { stableId: stable.id, horseIds: ['h1', 'h2'] } }
    feeder!.script = { scriptId: 11, memory: { stableId: stable.id } }
    // The game's own default, run by an NPC city, keeps its memory only.
    npc!.script = { scriptId: 0, task: 'tearDown', memory: { buildingId: farm.id } }
    other!.script = { scriptId: 12, memory: { buildingId: theirs.id } }
    const migrated = migrateWorld(structuredClone(world), 55, { terrain }, migrations, 56)
    const [w, b, f, n, o] = migrated.residents
    expect(w!.scriptParams).toEqual({ 9: { foodTake: 4, building: farm.id } })
    expect(w!.script).toEqual(wrecker!.script)
    expect(b!.scriptParams).toEqual({ 10: { stable: stable.id } })
    expect(f!.scriptParams).toEqual({ 11: { stable: stable.id } })
    expect(n!.scriptParams).toBeUndefined()
    expect(o!.scriptParams).toBeUndefined()
  })

  it('keeps a format 50 world as it is: picked param values stay ids (migration 50 → 51)', () => {
    const { world, terrain } = worldWithCity()
    const r = world.residents[0]!
    r.script = { scriptId: 1, memory: {} }
    r.scriptParams = { 1: { home: world.buildings[0]!.id } }
    const migrated = migrateWorld(structuredClone(world), 50, { terrain }, migrations, 51)
    expect(migrated).toEqual(world)
    expect(checkInvariants(migrated, terrain)).toEqual([])
  })

  it('keeps a format 53 world as it is: nobody is aboard a carriage (migration 53 → 54)', () => {
    const { world, terrain } = worldWithCity()
    expect(world.carriages.length).toBeGreaterThan(0)
    const migrated = migrateWorld(structuredClone(world), 53, { terrain }, migrations, 54)
    expect(migrated).toEqual(world)
    expect(migrated.residents.every((r) => r.aboard === undefined)).toBe(true)
    expect(checkInvariants(migrated, terrain)).toEqual([])
  })

  it('keeps the progress of breedings under way, with their stable (migration 51 → 52)', () => {
    const { world, terrain } = worldWithCity()
    const stable = world.buildings.find((b) => b.kind === 'stable')!
    const [a, b] = horsesIn(world.horses, stable)
    const [breeder, idle] = world.residents
    // A format 51 breeder, partway to a foal; the progress was the order's alone.
    breeder!.x = stable.x
    breeder!.y = stable.y
    const at = { x: stable.x, y: stable.y }
    const horseIds: [string, string] = [a!.id, b!.id]
    breeder!.order = { kind: 'breed', stableId: stable.id, horseIds, at, progress: 40 }
    idle!.order = null
    const migrated = migrateWorld(structuredClone(world), 51, { terrain }, migrations, 52)
    const kept = migrated.buildings.find((x) => x.id === stable.id)!.breedings
    expect(kept).toEqual([{ horseIds, progress: 40 }])
    expect(migrated.residents.find((r) => r.id === breeder!.id)!.order).toEqual(breeder!.order)
    expect(migrated.buildings.filter((x) => x.breedings).length).toBe(1)
    expect(checkInvariants(migrated, terrain)).toEqual([])
  })

  it('keeps a format 58 world as it is: scripts keep no error or steps yet (migration 58 → 59)', () => {
    const { world, terrain } = worldWithCity()
    world.residents[0]!.script = { scriptId: 1, memory: { n: 2 }, errorLoggedAt: 0 }
    const migrated = migrateWorld(structuredClone(world), 58, { terrain }, migrations, 59)
    expect(migrated).toEqual(world)
    expect(migrated.residents[0]!.script).not.toHaveProperty('lastError')
    expect(checkInvariants(migrated, terrain)).toEqual([])
  })

  it('keeps a format 59 world as it is: no resident has a script log yet (migration 59 → 60)', () => {
    const { world, terrain } = worldWithCity()
    const migrated = migrateWorld(structuredClone(world), 59, { terrain }, migrations, 60)
    expect(migrated).toEqual(world)
    expect(migrated.residents.every((r) => r.scriptLog === undefined)).toBe(true)
    expect(checkInvariants(migrated, terrain)).toEqual([])
  })

  it('keeps a format 60 world as it is: no resident was struck yet (migration 60 → 61)', () => {
    const { world, terrain } = worldWithCity()
    const migrated = migrateWorld(structuredClone(world), 60, { terrain }, migrations, 61)
    expect(migrated).toEqual(world)
    expect(migrated.residents.every((r) => r.struck === undefined)).toBe(true)
    expect(checkInvariants(migrated, terrain)).toEqual([])
  })

  it('keeps a format 61 world as it is: nothing is interrupted yet (migration 61 → 62)', () => {
    const { world, terrain } = worldWithCity()
    const migrated = migrateWorld(structuredClone(world), 61, { terrain }, migrations, 62)
    expect(migrated).toEqual(world)
    expect(migrated.residents.every((r) => r.interrupted === undefined)).toBe(true)
    expect(checkInvariants(migrated, terrain)).toEqual([])
  })

  it('keeps a format 62 world as it is: no defence script is picked yet (migration 62 → 63)', () => {
    const { world, terrain } = worldWithCity()
    const migrated = migrateWorld(structuredClone(world), 62, { terrain }, migrations, 63)
    expect(migrated).toEqual(world)
    expect(migrated.residents.every((r) => r.defenceScriptId === undefined)).toBe(true)
    expect(checkInvariants(migrated, terrain)).toEqual([])
  })

  it('keeps a format 63 world as it is: no script waits yet (migration 63 → 64)', () => {
    const { world, terrain } = worldWithCity()
    const migrated = migrateWorld(structuredClone(world), 63, { terrain }, migrations, 64)
    expect(migrated).toEqual(world)
    expect(migrated.residents.every((r) => r.script?.waitingSince === undefined)).toBe(true)
    expect(checkInvariants(migrated, terrain)).toEqual([])
  })

  it('migrates a format 66 world: no city’s town hall is occupied (migration 66 → 67)', () => {
    const { world, terrain } = worldWithPost()
    // The Player remembers their own city, as it was before cities could be occupied.
    refreshLastSeen(world, terrain.size)
    const old = structuredClone(world)
    for (const c of old.cities) delete (c as Partial<typeof c>).occupation
    for (const e of Object.values(old.lastSeen).flat())
      if (e.is === 'city') delete (e as Partial<typeof e>).occupation
    const migrated = migrateWorld(old, 66, { terrain }, migrations, 67)
    expect(migrated.cities.length).toBeGreaterThan(1)
    expect(migrated.cities.every((c) => c.occupation === null)).toBe(true)
    const remembered = Object.values(migrated.lastSeen).flat()
    expect(remembered.filter((e) => e.is === 'city').length).toBeGreaterThan(0)
    expect(migrated).toEqual(world)
    expect(checkInvariants(migrated, terrain)).toEqual([])
  })

  it('keeps a format 67 world as it is: nobody relocates yet (migration 67 → 68)', () => {
    const { world, terrain } = worldWithCity()
    const migrated = migrateWorld(structuredClone(world), 67, { terrain }, migrations, 68)
    expect(migrated).toEqual(world)
    expect(migrated.residents.every((r) => r.order?.kind !== 'relocate')).toBe(true)
    expect(checkInvariants(migrated, terrain)).toEqual([])
  })

  it('keeps a format 68 world’s names, duplicates too (migration 68 → 69)', () => {
    const { world, terrain } = worldWithCity()
    // A format 68 world: no name is marked as the game's, and two residents share one.
    for (const r of world.residents) delete r.gameName
    for (const c of world.cities) delete c.gameName
    const [a, b] = world.residents
    a!.name = 'Edda'
    b!.name = 'Edda'
    const migrated = migrateWorld(structuredClone(world), 68, { terrain }, migrations, 69)
    expect(migrated).toEqual(world)
    expect(checkInvariants(migrated, terrain)).toEqual([])
  })

  it('keeps a format 69 world as it is: nobody is Down yet (migration 69 → 70)', () => {
    const { world, terrain } = worldWithCity()
    const migrated = migrateWorld(structuredClone(world), 69, { terrain }, migrations, 70)
    expect(migrated).toEqual(world)
    expect(migrated.residents.every((r) => r.downUntil === undefined && r.health > 0)).toBe(true)
    expect(checkInvariants(migrated, terrain)).toEqual([])
  })

  it('keeps a format 71 world as it is: nobody fed anyone yet (migration 71 → 72)', () => {
    const { world, terrain } = worldWithCity()
    const migrated = migrateWorld(structuredClone(world), 71, { terrain }, migrations, 72)
    expect(migrated).toEqual(world)
    expect(migrated.residents.every((r) => r.order?.kind !== 'feed')).toBe(true)
    expect(checkInvariants(migrated, terrain)).toEqual([])
  })

  it('keeps a format 70 world as it is: no horse is Down yet (migration 70 → 71)', () => {
    const { world, terrain } = worldWithCity()
    expect(world.horses.length).toBeGreaterThan(0)
    const migrated = migrateWorld(structuredClone(world), 70, { terrain }, migrations, 71)
    expect(migrated).toEqual(world)
    expect(migrated.horses.every((h) => h.downUntil === undefined && h.health > 0)).toBe(true)
    expect(checkInvariants(migrated, terrain)).toEqual([])
  })

  it('gives every realm no Workplace settings (migration 72 → 73)', () => {
    const { world, terrain } = worldWithCity()
    expect(world.realms.length).toBeGreaterThan(0)
    // A format 72 world: no Workplace settings at all.
    const old = structuredClone(world) as Partial<typeof world>
    delete old.workplaceSettings
    const migrated = migrateWorld(old, 72, { terrain }, migrations, 73)
    expect(migrated.workplaceSettings).toEqual({})
    expect(migrated).toEqual(world)
    expect(checkInvariants(migrated, terrain)).toEqual([])
  })

  it('leaves every running script its resident’s own (migration 73 → 74)', () => {
    const { world, terrain } = worldWithCity()
    // A format 73 world: a resident working a farm by the Work default, given before settings.
    const r = world.residents[0]!
    r.script = { scriptId: 4, memory: { workplaceId: 'farm' } }
    r.scriptParams = { 4: { foodTake: 2 } }
    const migrated = migrateWorld(structuredClone(world), 73, { terrain }, migrations, 74)
    expect(migrated).toEqual(world)
    expect(migrated.residents[0]!.script?.settingsFrom).toBeUndefined()
    expect(checkInvariants(migrated, terrain)).toEqual([])
  })

  it('migrates a format 74 world: every Player starts with no waypoints (migration 74 → 75)', () => {
    const { world, terrain } = worldWithCity()
    const old: Partial<typeof world> = structuredClone(world)
    delete old.waypoints
    const migrated = migrateWorld(old, 74, { terrain }, migrations, 75)
    expect(migrated).toEqual({ ...world, waypoints: {} })
    expect(checkInvariants(migrated, terrain)).toEqual([])
  })

  it('gives horses and carriages left behind to the realm their city joined (migration 75 → 76)', () => {
    const { world, terrain } = worldWithPost()
    const realm = world.realms[0]!
    const home = world.cities.find((c) => c.realmId === realm.id)!
    const hq = tradeOrgHq(world)!
    const post = world.cities.find((c) => c.tradeOrg === 'post')!
    const horse = (id: string, realmId: string | null, cityId: string | null) => ({
      ...world.horses[0]!,
      id,
      realmId,
      cityId,
    })
    const carriage = { ...world.carriages[0]!, horseId: 'hitched', load: {} }
    const old = structuredClone(world)
    const hqHorses = old.horses.filter((h) => h.cityId === hq.id).map((h) => h.id)
    expect(hqHorses.length).toBeGreaterThan(0)
    old.horses.push(
      horse('stranded', null, home.id),
      { ...horse('hitched', null, home.id), x: carriage.x, y: carriage.y },
      horse('atPost', null, post.id),
      horse('ofNobody', null, null),
      horse('ofTheRealm', realm.id, null),
    )
    old.carriages.push({ ...carriage, id: 'kStranded', realmId: null, cityId: home.id })
    const before = old.horses.filter((h) => hqHorses.includes(h.id))
    const migrated = migrateWorld(structuredClone(old), 75, { terrain }, migrations, 76)
    const owner = (id: string) => {
      const t = [...migrated.horses, ...migrated.carriages].find((x) => x.id === id)!
      return [t.realmId, t.cityId]
    }
    for (const id of ['stranded', 'hitched', 'kStranded'])
      expect(owner(id), id).toEqual([realm.id, null])
    expect(owner('atPost')).toEqual([null, post.id])
    expect(owner('ofNobody')).toEqual([null, null])
    expect(owner('ofTheRealm')).toEqual([realm.id, null])
    // The Trade Organization keeps its own.
    expect(migrated.horses.filter((h) => hqHorses.includes(h.id))).toEqual(before)
  })

  it('leaves crimes and logs as they are for stealing carriages (migration 76 → 77)', () => {
    const { world, terrain } = worldWithCity()
    const migrated = migrateWorld(structuredClone(world), 76, { terrain }, migrations, 77)
    expect(migrated).toEqual(world)
    expect(checkInvariants(migrated, terrain)).toEqual([])
  })

  it('leaves caravans as they are for one that can have no driver (migration 77 → 78)', () => {
    const { world, terrain } = worldWithPost()
    expect(world.caravans.length).toBeGreaterThan(0)
    const migrated = migrateWorld(structuredClone(world), 77, { terrain }, migrations, 78)
    expect(migrated).toEqual(world)
    expect(checkInvariants(migrated, terrain)).toEqual([])
  })

  it('names every horse from before horses had names, alike on every server (migration 65 → 66)', () => {
    const { world, terrain: land } = worldWithCity()
    expect(world.horses.length).toBeGreaterThan(0)
    // A format 65 horse: no name.
    const old = structuredClone(world) as unknown as { horses: Record<string, unknown>[] }
    for (const h of old.horses) delete h.name
    const migrated = migrateWorld(structuredClone(old), 65, { terrain: land }, migrations, 66)
    for (const h of migrated.horses) expect(HORSE_NAMES).toContain(h.name)
    // Drawn from the seed and the horse's id, so a second run names them the same.
    expect(migrateWorld(old, 65, { terrain: land }, migrations, 66)).toEqual(migrated)
    expect(migrated.horses.map(({ id, x, y }) => ({ id, x, y }))).toEqual(
      world.horses.map(({ id, x, y }) => ({ id, x, y })),
    )
    expect(checkInvariants(migrated, land)).toEqual([])
  })

  it('keeps a format 46 world as it is: no resident has a queue yet (migration 46 → 47)', () => {
    const { world, terrain } = worldWithCity()
    const migrated = migrateWorld(structuredClone(world), 46, { terrain }, migrations, 47)
    expect(migrated).toEqual(world)
    expect(migrated.residents.every((r) => r.queue === undefined)).toBe(true)
    expect(checkInvariants(migrated, terrain)).toEqual([])
  })

  it('migrates a format 49 world: its Players are still to be told of the switch to script views (migration 49 → 50)', () => {
    const { world, terrain } = worldWithCity()
    const old: Partial<typeof world> = { ...world }
    delete old.scriptViewChanges
    const migrated = migrateWorld(old, 49, { terrain }, migrations, 50)
    expect(migrated).toEqual({ ...world, scriptViewChanges: 0 })
    expect(checkInvariants(migrated, terrain)).toEqual([])
  })

  it('keeps a format 42 world as it is: no script param is picked yet (migration 42 → 43)', () => {
    const { world, terrain } = worldWithCity()
    const migrated = migrateWorld(structuredClone(world), 42, { terrain }, migrations, 43)
    expect(migrated).toEqual(world)
    expect(migrated.residents.every((r) => r.scriptParams === undefined)).toBe(true)
    expect(checkInvariants(migrated, terrain)).toEqual([])
  })

  it('keeps a format 41 world as it is: no resident stores or fetches yet (migration 41 → 42)', () => {
    const { world, terrain } = worldWithCity()
    const migrated = migrateWorld(structuredClone(world), 41, { terrain }, migrations, 42)
    expect(migrated).toEqual(world)
    expect(migrated.residents.every((r) => r.orderEnded === undefined)).toBe(true)
    expect(checkInvariants(migrated, terrain)).toEqual([])
  })

  it('keeps road orders along a line as they are (migration 40 → 41)', () => {
    const { world } = worldWithCity()
    const r = world.residents[0]!
    r.order = {
      kind: 'roadLine',
      tiles: [[r.x, r.y]],
      phase: 'walking',
      path: null,
      progress: 0,
      siteId: null,
    }
    const migrated = migrateWorld(
      structuredClone(world),
      40,
      { terrain: smallTerrain() },
      migrations,
      41,
    )
    expect(migrated).toEqual(world)
  })

  it('gives horses from before stats average stats and a plausible age (migration 43 → 44)', () => {
    const { world, terrain: land } = worldWithCity()
    expect(world.horses.length).toBeGreaterThan(0)
    // A format 43 horse: no stats, no birth tick.
    const old = structuredClone(world) as unknown as { horses: Record<string, unknown>[] }
    for (const h of old.horses) {
      delete h.stats
      delete h.bornAt
    }
    const migrated = migrateWorld(old, 43, { terrain: land })
    for (const h of migrated.horses) {
      expect(h.stats).toEqual(AVERAGE_HORSE_STATS)
      const age = horseAgeInYears(h, migrated.tick)
      expect(age).toBeGreaterThanOrEqual(HORSE_START_AGE_MIN)
      expect(age).toBeLessThanOrEqual(HORSE_START_AGE_MAX)
    }
    expect(migrated.horses.map(({ id, x, y }) => ({ id, x, y }))).toEqual(
      world.horses.map(({ id, x, y }) => ({ id, x, y })),
    )
    expect(checkInvariants(migrated, land)).toEqual([])
  })

  it('drops the breeding progress stables kept (migration 44 → 45)', () => {
    const { world, terrain: land } = worldWithCity()
    const stable = world.buildings.find((b) => b.kind === 'stable')!
    // A format 44 stable, partway to a foal.
    const old = structuredClone(world) as unknown as { buildings: Record<string, unknown>[] }
    old.buildings.find((b) => b.id === stable.id)!.breeding = 40
    const migrated = migrateWorld(old, 44, { terrain: land })
    expect(migrated.buildings.every((b) => !('breeding' in b))).toBe(true)
    expect(migrated.buildings).toEqual(world.buildings)
    expect(checkInvariants(migrated, land)).toEqual([])
  })

  it('brings a format 45 world over with nobody riding (migration 45 → 46)', () => {
    const { world, terrain: land } = worldWithCity()
    expect(world.horses.length).toBeGreaterThan(0)
    const migrated = migrateWorld(structuredClone(world), 45, { terrain: land }, migrations, 46)
    expect(migrated).toEqual(world)
    expect(migrated.residents.every((r) => r.riding === undefined)).toBe(true)
    expect(checkInvariants(migrated, land)).toEqual([])
  })

  it('leaves a storage of no city from before ownerless (migration 48 → 49)', () => {
    const { world, terrain: land } = worldWithCity()
    const storage = world.buildings.find((b) => b.kind === 'storage')!
    // A format 48 storage cut off from every city: which city it last belonged to is not kept.
    storage.cityId = null
    const migrated = migrateWorld(structuredClone(world), 48, { terrain: land }, migrations, 49)
    expect(migrated).toEqual(world)
    expect(migrated.buildings.every((b) => b.realmId === undefined)).toBe(true)
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

describe('WorldSaver', () => {
  function fakeLog() {
    return { skipped: vi.fn(), failed: vi.fn() }
  }

  it('writes a save asynchronously that loads back to the same world', async () => {
    const { db, close } = await openDb(':memory:')
    const { world, terrain: map } = loadOrCreateWorld(db, counting().generate)
    world.tick = 30
    const log = fakeLog()
    const saver = new WorldSaver(db, log)
    expect(saver.start(world)).toBe(true)
    const taken = structuredClone(world)
    // The world goes on while the save is written; the save is the world as it was.
    world.tick = 31
    await saver.settled()
    const loaded = loadOrCreateWorld(db, counting().generate)
    expect(loaded.world).toEqual(taken)
    expect(loaded.terrain).toEqual(map)
    expect(db.select().from(schema.worldSaves).all().at(-1)?.tick).toBe(30)
    expect(log.failed).not.toHaveBeenCalled()
    close()
  })

  it('skips and logs a save asked for while one is in flight', async () => {
    const { db, close } = await openDb(':memory:')
    const world = createWorld(terrain, 1)
    const log = fakeLog()
    const saver = new WorldSaver(db, log)
    world.tick = 30
    expect(saver.start(world)).toBe(true)
    world.tick = 60
    expect(saver.start(world)).toBe(false)
    expect(log.skipped).toHaveBeenCalledWith(60, 30)
    await saver.settled()
    expect(
      db
        .select()
        .from(schema.worldSaves)
        .all()
        .map((r) => r.tick),
    ).toEqual([30])
    // Once it is written, the next save starts again.
    world.tick = 90
    expect(saver.start(world)).toBe(true)
    await saver.settled()
    expect(
      db
        .select()
        .from(schema.worldSaves)
        .all()
        .map((r) => r.tick),
    ).toEqual([30, 90])
    close()
  })

  it('saves synchronously on shutdown, and a save still in flight does not land after it', async () => {
    const { db, close } = await openDb(':memory:')
    const world = createWorld(terrain, 1)
    const saver = new WorldSaver(db, fakeLog())
    world.tick = 30
    saver.start(world)
    world.tick = 45
    saver.saveNow(world)
    // Written before anything else runs.
    expect(
      db
        .select()
        .from(schema.worldSaves)
        .all()
        .map((r) => r.tick),
    ).toEqual([45])
    await saver.settled()
    expect(
      db
        .select()
        .from(schema.worldSaves)
        .all()
        .map((r) => r.tick),
    ).toEqual([45])
    expect(saver.start(world)).toBe(false)
    close()
  })
})
