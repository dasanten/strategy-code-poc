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
  START_HORSES,
  START_STABLE_FOOD,
  isInsideWalls,
  type Horse,
  type TerrainMap,
} from '@csp/shared'
import { createAdmin } from './auth.js'
import { KEEP_LATEST, loadOrCreateWorld, pruneSaves, saveWorld } from './saves.js'
import { loadTerrain } from './terrain.js'
import { generateTerrain } from './terrain-gen.js'
import { smallTerrain, worldWithCity } from './test-terrain.js'
import { checkInvariants } from './invariants.js'
import { WorldFormatError, migrateWorld, migrations } from './world-format.js'
import { createWorld } from './world.js'

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
    expect(fresh.world).toEqual(createWorld(fresh.terrain, 3))
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
    expect(world).toEqual(createWorld(fresh, 1))
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
    const { world, terrain: land } = worldWithCity()
    const city = world.cities[0]!
    const v11 = structuredClone(world) as unknown as Record<string, unknown> & typeof world
    v11.buildings = v11.buildings.filter((b) => b.kind !== 'stable')
    const strip = ({ health: _health, ...h }: Horse) => h
    v11.horses = [
      { ...world.horses[0]!, x: city.x + 2, y: city.y + city.size - 2 },
      { ...world.horses[1]!, id: 'stray', realmId: null, x: 3, y: 3 },
    ].map(strip) as Horse[]
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
    expect(checkInvariants(v12, land)).toEqual([])
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
