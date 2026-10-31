import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  ADMIN_TERRAIN_OVERVIEW_PATH,
  CHUNK_SIZE,
  MAP_SIZE,
  SESSION_COOKIE,
  SIGHT_RANGE,
  Terrain,
  UNEXPLORED,
  adminTerrainChunkPath,
  chunksAcross,
  decodeChunk,
  overviewAcross,
  terrainAt,
  terrainChunkPath,
} from '@csp/shared'
import { buildApp } from './app.js'
import { createAdmin, createInviteCode, createSession, signUp } from './auth.js'
import { openDb, schema } from './db/index.js'
import { ExploredTerrain, terrainOverview } from './explored.js'
import { smallTerrain } from './test-terrain.js'

const terrain = smallTerrain()
const player = { id: 7 }
const other = { id: 8 }

describe('ExploredTerrain', () => {
  it('knows only what a Player explored, admins too, and reports newly explored chunks', () => {
    const explored = new ExploredTerrain(terrain)
    expect(explored.isExplored(player, 60, 60)).toBe(false)
    const n = chunksAcross(terrain.size)
    expect(explored.explore(player.id, 60, 60, 3)).toEqual(new Set([1 * n + 1]))
    // Nothing new the second time.
    expect(explored.explore(player.id, 60, 60, 3)).toEqual(new Set())
    expect(explored.isExplored(player, 60, 60)).toBe(true)
    expect(explored.isExplored(player, 63, 60)).toBe(true)
    expect(explored.isExplored(player, 63, 63)).toBe(false)
    expect(explored.isExplored(other, 60, 60)).toBe(false)
    expect(explored.exploredChunks(other)).toEqual([])
    // Exploring near a side reaches across the join.
    explored.explore(player.id, 0, 60, 2)
    expect(explored.isExplored(player, terrain.size - 2, 60)).toBe(true)
    expect(explored.isExplored(player, -2, 60)).toBe(true)
  })

  it('serves explored chunks with unexplored tiles hidden, and refuses others', () => {
    const explored = new ExploredTerrain(terrain)
    explored.explore(player.id, 40, 40, 2)
    const n = chunksAcross(terrain.size)
    expect(explored.exploredChunks(player)).toEqual([1 * n + 1])
    expect(explored.chunk(player, 0, 0)).toBeUndefined()
    expect(explored.chunk(player, 99, 0)).toBeUndefined()
    expect(explored.chunk(player, 1.5, 1)).toBeUndefined()

    const chunk = explored.chunk(player, 1, 1)!
    expect(chunk).toHaveLength(CHUNK_SIZE * CHUNK_SIZE)
    const at = (x: number, y: number) => chunk[(y - CHUNK_SIZE) * CHUNK_SIZE + (x - CHUNK_SIZE)]
    expect(at(40, 40)).toBe(terrainAt(terrain, 40, 40))
    expect(at(50, 50)).toBe(UNEXPLORED)
  })

  it('saves what changed and loads it back', async () => {
    const { db, close } = await openDb(':memory:')
    await createAdmin(db, 'Daniel', 'admin password')
    const { id } = db.select().from(schema.users).get()!
    const explored = new ExploredTerrain(terrain)
    explored.explore(id, 60, 60, 5)
    explored.save(db)
    explored.explore(id, 20, 60, 1)
    explored.save(db)
    const loaded = ExploredTerrain.load(db, terrain)
    const viewer = { id, isAdmin: false }
    expect(loaded.isExplored(viewer, 60, 65)).toBe(true)
    expect(loaded.isExplored(viewer, 20, 60)).toBe(true)
    expect(loaded.isExplored(viewer, 40, 60)).toBe(false)
    close()
  })
})

/** The chunks with an explored tile, found by asking every tile: what `exploredChunks` replaced. */
function scannedChunks(explored: ExploredTerrain, size: number): number[] {
  const n = chunksAcross(size)
  const found = new Set<number>()
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = Math.floor(y / CHUNK_SIZE) * n + Math.floor(x / CHUNK_SIZE)
      if (!found.has(c) && explored.isExplored(player, x, y)) found.add(c)
    }
  }
  return [...found].sort((a, b) => a - b)
}

/** Every tile within `radius` of (x, y), across the joins: the disc `explore` marks. */
function disc(size: number, x: number, y: number, radius: number): Set<string> {
  const tiles = new Set<string>()
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue
      tiles.add(`${(((x + dx) % size) + size) % size},${(((y + dy) % size) + size) % size}`)
    }
  }
  return tiles
}

describe('explored chunks', () => {
  /** A few scattered looks, some across the joins and over each other. */
  const looks = [
    [5, 5, 3],
    [60, 60, 7],
    [127, 64, 9],
    [64, 0, 12],
    [62, 58, 10],
    [100, 100, 1],
  ] as const

  it('agree with a scan of every tile, grow after explore, and come back the same after a load', async () => {
    const explored = new ExploredTerrain(terrain)
    expect(explored.exploredChunks(player)).toEqual([])
    const seen: number[][] = []
    for (const [x, y, r] of looks) {
      explored.explore(player.id, x, y, r)
      const chunks = explored.exploredChunks(player)
      expect(chunks).toEqual(scannedChunks(explored, terrain.size))
      seen.push(chunks)
    }
    expect(seen.at(-1)!.length).toBeGreaterThan(seen[0]!.length)

    const { db, close } = await openDb(':memory:')
    await createAdmin(db, 'Daniel', 'admin password')
    const { id } = db.select().from(schema.users).get()!
    const fresh = new ExploredTerrain(terrain)
    for (const [x, y, r] of looks) fresh.explore(id, x, y, r)
    fresh.save(db)
    const loaded = ExploredTerrain.load(db, terrain)
    expect(loaded.exploredChunks({ id })).toEqual(fresh.exploredChunks({ id }))
    close()
  })

  it('come back the same after a load on a map whose side is not a whole number of bytes', async () => {
    const odd = { size: 77, tiles: new Uint8Array(77 * 77) }
    const { db, close } = await openDb(':memory:')
    await createAdmin(db, 'Daniel', 'admin password')
    const { id } = db.select().from(schema.users).get()!
    const fresh = new ExploredTerrain(odd)
    for (const [x, y, r] of looks) fresh.explore(id, x, y, r)
    fresh.save(db)
    expect(ExploredTerrain.load(db, odd).exploredChunks({ id })).toEqual(
      fresh.exploredChunks({ id }),
    )
    close()
  })

  it('explore marks exactly the disc, skipping what is already explored', () => {
    for (const map of [terrain, { size: 77, tiles: new Uint8Array(77 * 77) }]) {
      const explored = new ExploredTerrain(map)
      const expected = new Set<string>()
      for (const [x, y, r] of looks) {
        for (const t of disc(map.size, x, y, r)) expected.add(t)
        explored.explore(player.id, x, y, r)
      }
      for (let y = 0; y < map.size; y++) {
        for (let x = 0; x < map.size; x++) {
          expect(explored.isExplored(player, x, y)).toBe(expected.has(`${x},${y}`))
        }
      }
    }
  })

  it('ten welcomes on a full-size map take well under a second', async () => {
    const full = { size: MAP_SIZE, tiles: new Uint8Array(MAP_SIZE * MAP_SIZE) }
    const { db, close } = await openDb(':memory:')
    await createAdmin(db, 'Daniel', 'admin password')
    const { id } = db.select().from(schema.users).get()!
    const before = new ExploredTerrain(full)
    for (let i = 0; i < 40; i++) {
      before.explore(id, (i * 977) % MAP_SIZE, (i * 1931) % MAP_SIZE, SIGHT_RANGE)
    }
    before.save(db)
    const explored = ExploredTerrain.load(db, full)
    const start = performance.now()
    for (let i = 0; i < 10; i++) explored.exploredChunks({ id })
    expect(performance.now() - start).toBeLessThan(100)
    expect(explored.exploredChunks({ id })).toEqual(before.exploredChunks({ id }))
    close()
  })
})

describe('resource nodes in chunks', () => {
  it('include only nodes on tiles the Player explored', () => {
    const nodes = [
      { id: 'n1', kind: 'stone' as const, x: 40, y: 40 },
      { id: 'n2', kind: 'goldOre' as const, x: 50, y: 50 },
    ]
    const explored = new ExploredTerrain(terrain, nodes)
    explored.explore(player.id, 40, 40, 2)
    expect(decodeChunk(1, 1, explored.chunk(player, 1, 1)!).nodes).toEqual([
      { kind: 'stone', x: 40, y: 40 },
    ])
    explored.explore(player.id, 50, 50, 1)
    expect(decodeChunk(1, 1, explored.chunk(player, 1, 1)!).nodes).toHaveLength(2)
  })
})

describe('admin terrain', () => {
  it('gives any chunk whole, with every resource node, explored or not', () => {
    const nodes = [{ id: 'n1', kind: 'goldOre' as const, x: 70, y: 100 }]
    const explored = new ExploredTerrain(terrain, nodes)
    const chunk = decodeChunk(2, 3, explored.wholeChunk(2, 3)!)
    expect(chunk.nodes).toEqual([{ kind: 'goldOre', x: 70, y: 100 }])
    for (let dy = 0; dy < CHUNK_SIZE; dy++) {
      for (let dx = 0; dx < CHUNK_SIZE; dx++) {
        expect(chunk.tiles[dy * CHUNK_SIZE + dx]).toBe(terrainAt(terrain, 64 + dx, 96 + dy))
      }
    }
    expect(explored.wholeChunk(chunksAcross(terrain.size), 0)).toBeUndefined()
    expect(explored.wholeChunk(-1, 0)).toBeUndefined()
  })

  it('downsamples the map to the most common terrain of each square', () => {
    // 10 × 10: the overview is 2 × 2, its right and bottom squares only 2 tiles wide or tall.
    const tiles = new Uint8Array(100).fill(Terrain.Plains)
    for (let y = 0; y < 8; y++) for (let x = 0; x < 5; x++) tiles[y * 10 + x] = Terrain.Forest
    for (let x = 0; x < 10; x++) tiles[9 * 10 + x] = Terrain.Sea
    tiles[8 * 10 + 9] = Terrain.Sea
    expect(overviewAcross(10)).toBe(2)
    // Top left: 40 forest, 24 plains. Top right: plains. Bottom left: 8 sea and 8 plains, a tie
    // the lower code wins. Bottom right: 3 sea, 1 plains.
    expect([...terrainOverview({ size: 10, tiles })]).toEqual([
      Terrain.Forest,
      Terrain.Plains,
      Terrain.Plains,
      Terrain.Sea,
    ])
    expect(new ExploredTerrain(terrain).overview()).toHaveLength(overviewAcross(terrain.size) ** 2)
  })
})

describe('terrain chunk API', () => {
  async function start() {
    const opened = await openDb(':memory:')
    const explored = new ExploredTerrain(terrain)
    const app = await buildApp({
      db: opened.db,
      explored,
      logger: false,
      secureCookies: false,
      trustProxy: false,
    })
    const mara = await signUp(opened.db, {
      name: 'Mara',
      password: 'correct horse',
      inviteCode: createInviteCode(opened.db, null),
    })
    const cookies = { [SESSION_COOKIE]: createSession(opened.db, mara.id) }
    return { app, explored, mara, cookies, db: opened.db, close: () => opened.close() }
  }

  it('returns binary terrain for explored chunks and refuses unexplored ones', async () => {
    const { app, explored, mara, cookies, close } = await start()
    explored.explore(mara.id, 40, 40, 2)

    const ok = await app.inject({ method: 'GET', url: terrainChunkPath(1, 1), cookies })
    expect(ok.statusCode).toBe(200)
    expect(ok.headers['content-type']).toBe('application/octet-stream')
    expect(ok.rawPayload).toEqual(Buffer.from(explored.chunk(mara, 1, 1)!))

    const unexplored = await app.inject({ method: 'GET', url: terrainChunkPath(2, 2), cookies })
    expect(unexplored.statusCode).toBe(403)
    expect(unexplored.json().error).toBe('not-explored')

    const nonsense = await app.inject({ method: 'GET', url: '/api/terrain/x/1', cookies })
    expect(nonsense.statusCode).toBe(403)

    const anonymous = await app.inject({ method: 'GET', url: terrainChunkPath(1, 1) })
    expect(anonymous.statusCode).toBe(401)
    await app.close()
    close()
  })

  it('gives admins any chunk and the overview, and refuses everyone else', async () => {
    const { app, explored, db, cookies, close } = await start()
    await createAdmin(db, 'Daniel', 'admin password')
    const daniel = db.select().from(schema.users).where(eq(schema.users.name, 'Daniel')).get()!
    const admin = { [SESSION_COOKIE]: createSession(db, daniel.id) }
    const get = (url: string, c?: Record<string, string>) =>
      app.inject({ method: 'GET', url, cookies: c })

    const chunk = await get(adminTerrainChunkPath(2, 2), admin)
    expect(chunk.statusCode).toBe(200)
    expect(chunk.headers['content-type']).toBe('application/octet-stream')
    expect(chunk.rawPayload).toEqual(Buffer.from(explored.wholeChunk(2, 2)!))
    expect((await get(adminTerrainChunkPath(99, 0), admin)).statusCode).toBe(404)

    const overview = await get(ADMIN_TERRAIN_OVERVIEW_PATH, admin)
    expect(overview.statusCode).toBe(200)
    expect(overview.rawPayload).toEqual(Buffer.from(terrainOverview(terrain)))

    for (const url of [adminTerrainChunkPath(2, 2), ADMIN_TERRAIN_OVERVIEW_PATH]) {
      const player = await get(url, cookies)
      expect(player.statusCode).toBe(403)
      expect(player.json().error).toBe('not-admin')
      expect((await get(url)).statusCode).toBe(401)
    }

    // The admin's own Player still gets only what they explored from the game route.
    explored.explore(daniel.id, 40, 40, 2)
    const own = await get(terrainChunkPath(1, 1), admin)
    expect(own.rawPayload).toEqual(Buffer.from(explored.chunk(daniel, 1, 1)!))
    expect([...own.rawPayload]).toContain(UNEXPLORED)
    expect((await get(terrainChunkPath(2, 2), admin)).statusCode).toBe(403)
    await app.close()
    close()
  })
})
