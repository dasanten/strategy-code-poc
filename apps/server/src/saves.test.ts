import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { backupDb, pruneBackups } from './backup.js'
import { openDb, schema } from './db/index.js'
import { gzipSync } from 'node:zlib'
import {
  AVERAGE_HORSE_STATS,
  HORSE_START_AGE_MAX,
  HORSE_START_AGE_MIN,
  horseAgeInYears,
  type TerrainMap,
} from '@csp/shared'
import { createAdmin } from './auth.js'
import { KEEP_LATEST, loadOrCreateWorld, pruneSaves, saveWorld } from './saves.js'
import { loadTerrain } from './terrain.js'
import { generateTerrain } from './terrain-gen.js'
import { checkInvariants } from './invariants.js'
import { smallTerrain, worldWithCity, worldWithPost } from './test-terrain.js'
import {
  RESET_BEFORE,
  WORLD_FORMAT_VERSION,
  WorldFormatError,
  migrateWorld,
  migrations,
} from './world-format.js'
import { createWorld, generateWorld } from './world.js'

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
    // Captured the old way: the realm's, but still a Trade Org post with its caravan.
    post.realmId = realm.id
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

  it('leaves realms from before realm names unnamed (migration 38 → 39)', () => {
    const { world: v38, terrain: land } = worldWithPost()
    expect(v38.realms.length).toBeGreaterThan(0)
    // The live format, so a step no version reaches would show here.
    expect(WORLD_FORMAT_VERSION).toBe(52)
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

  it('migrates a format 51 world: every Player starts with their Horse offer unclaimed (migration 51 → 52)', () => {
    const { world, terrain } = worldWithPost()
    expect(world.horses.some((h) => h.realmId === world.realms[0]!.id)).toBe(true)
    const old: Partial<typeof world> = structuredClone(world)
    delete old.horseOffersClaimed
    const migrated = migrateWorld(old, 51, { terrain })
    expect(migrated).toEqual({ ...world, horseOffersClaimed: [] })
    expect(checkInvariants(migrated, terrain)).toEqual([])
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
    const migrated = migrateWorld(old, 49, { terrain })
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
