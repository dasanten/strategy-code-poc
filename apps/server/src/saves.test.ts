import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { backupDb, pruneBackups } from './backup.js'
import { openDb, schema } from './db/index.js'
import { gzipSync } from 'node:zlib'
import { ADULT_AGE, ageInYears, type TerrainMap } from '@csp/shared'
import { checkInvariants } from './invariants.js'
import { KEEP_LATEST, loadOrCreateWorld, pruneSaves, saveWorld } from './saves.js'
import { loadTerrain } from './terrain.js'
import { generateTerrain } from './terrain-gen.js'
import { smallTerrain } from './test-terrain.js'
import { WorldFormatError, migrateWorld, migrations } from './world-format.js'
import { createWorld, isWalkable } from './world.js'

const terrain = smallTerrain()

/** The 32×24 world as format 1 saved it, with units in the grid's corners. */
const v1 = {
  tick: 900,
  seed: 1,
  width: 32,
  height: 24,
  tiles: Array<string>(32 * 24).fill('grass'),
  units: [
    { id: 'u1', owner: 'red', x: 0, y: 0, hp: 10 },
    { id: 'u2', owner: 'red', x: 1, y: 0, hp: 10 },
    { id: 'u3', owner: 'blue', x: 31, y: 23, hp: 7 },
  ],
}

/** Generates the small test map for any seed, counting how often it is asked to. */
function counting() {
  const seeds: number[] = []
  const generate = (seed: number): TerrainMap => {
    seeds.push(seed)
    return seed === 1 ? terrain : generateTerrain(seed, 120)
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

  it('loads a format-1 world through every migration to the current format', async () => {
    const { db, close } = await openDb(':memory:')
    db.insert(schema.worldSaves)
      .values({ tick: 900, version: 1, data: gzipSync(JSON.stringify(v1)) })
      .run()

    const { generate, seeds } = counting()
    const { world, terrain: stored } = loadOrCreateWorld(db, generate)
    expect(seeds).toEqual([1])
    expect(loadTerrain(db)?.seed).toBe(1)
    expect(world).toEqual({ ...createWorld(stored, 1), tick: 900 })
    expect(checkInvariants(world, stored)).toEqual([])
    close()
  })

  it('moves a format-1 world onto the stored disc (migration 1 → 2)', () => {
    const v2 = migrateWorld(structuredClone(v1), 1, { terrain }, migrations, 2) as unknown as {
      units: { x: number; y: number; hp: number }[]
    }
    expect(Object.keys(v2).sort()).toEqual(['seed', 'tick', 'units'])
    expect(v2.units.map((u) => u.hp)).toEqual([10, 10, 7])
    // On passable land near the centre, roughly where they were relative to each other.
    const centre = terrain.diameter / 2
    for (const u of v2.units) {
      expect(isWalkable(terrain, u.x, u.y)).toBe(true)
      expect(Math.abs(u.x - centre)).toBeLessThan(25)
      expect(Math.abs(u.y - centre)).toBeLessThan(25)
    }
    const [u1, , u3] = v2.units
    expect(u3!.x - u1!.x).toBeGreaterThan(20)
  })

  it('gives a format-2 world the resource nodes a new world would get (migration 2 → 3)', () => {
    const v2 = { tick: 50, seed: 1, units: [{ id: 'u1', owner: 'red', x: 60, y: 60, hp: 10 }] }
    const v3 = migrateWorld(v2, 2, { terrain }, migrations, 3)
    expect(v3.nodes).toEqual(createWorld(terrain, 1).nodes)
    expect(v3.nodes.length).toBeGreaterThan(0)
    expect(v3).toMatchObject({ tick: 50, seed: 1 })
  })

  it("turns a format-3 world's units into residents (migration 3 → 4)", () => {
    const v3 = {
      tick: 5000,
      seed: 1,
      nodes: [],
      units: [
        { id: 'u1', owner: 'red', x: 60, y: 60, hp: 10 },
        { id: 'u2', owner: 'blue', x: 61, y: 60, hp: 3 },
      ],
    }
    const v4 = migrateWorld(v3, 3, { terrain }, migrations, 4)
    expect(Object.keys(v4).sort()).toEqual(['nodes', 'residents', 'seed', 'tick'])
    expect(
      v4.residents.map(({ id, owner, x, y, health }) => ({ id, owner, x, y, health })),
    ).toEqual([
      { id: 'u1', owner: 'red', x: 60, y: 60, health: 100 },
      { id: 'u2', owner: 'blue', x: 61, y: 60, health: 30 },
    ])
    for (const r of v4.residents) {
      expect(ageInYears(r, v4.tick)).toBeGreaterThanOrEqual(ADULT_AGE)
      expect(r).not.toHaveProperty('hp')
    }
    // Same save, same residents.
    expect(migrateWorld(structuredClone(v3), 3, { terrain }, migrations, 4)).toEqual(v4)
  })

  it('drops the placeholder residents and adds empty realms (migration 4 → 5)', () => {
    const fresh = createWorld(terrain, 1)
    const v4 = {
      tick: 7000,
      seed: 1,
      nodes: fresh.nodes,
      residents: [{ id: 'u1', owner: 'red', x: 60, y: 60 }],
    }
    expect(migrateWorld(v4, 4, { terrain })).toEqual({ ...fresh, tick: 7000 })
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
