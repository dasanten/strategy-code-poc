import { describe, expect, it } from 'vitest'
import {
  CHUNK_SIZE,
  SESSION_COOKIE,
  UNEXPLORED,
  chunksAcross,
  decodeChunk,
  terrainAt,
  terrainChunkPath,
} from '@csp/shared'
import { buildApp } from './app.js'
import { createAdmin, createInviteCode, createSession, signUp } from './auth.js'
import { openDb, schema } from './db/index.js'
import { ExploredTerrain } from './explored.js'
import { smallTerrain } from './test-terrain.js'

const terrain = smallTerrain()
const player = { id: 7, isAdmin: false }
const admin = { id: 1, isAdmin: true }

describe('ExploredTerrain', () => {
  it('knows only what a Player explored; admins know the whole map', () => {
    const explored = new ExploredTerrain(terrain)
    expect(explored.isExplored(player, 60, 60)).toBe(false)
    explored.explore(player.id, 60, 60, 3)
    expect(explored.isExplored(player, 60, 60)).toBe(true)
    expect(explored.isExplored(player, 63, 60)).toBe(true)
    expect(explored.isExplored(player, 63, 63)).toBe(false)
    expect(explored.isExplored({ id: 8, isAdmin: false }, 60, 60)).toBe(false)
    expect(explored.isExplored(admin, 100, 30)).toBe(true)
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
    expect(explored.exploredChunks(admin)).toHaveLength(n * n)
    expect(explored.chunk(player, 0, 0)).toBeUndefined()
    expect(explored.chunk(player, 99, 0)).toBeUndefined()
    expect(explored.chunk(player, 1.5, 1)).toBeUndefined()

    const chunk = explored.chunk(player, 1, 1)!
    expect(chunk).toHaveLength(CHUNK_SIZE * CHUNK_SIZE)
    const at = (x: number, y: number) => chunk[(y - CHUNK_SIZE) * CHUNK_SIZE + (x - CHUNK_SIZE)]
    expect(at(40, 40)).toBe(terrainAt(terrain, 40, 40))
    expect(at(50, 50)).toBe(UNEXPLORED)

    // Admins get the terrain itself.
    const whole = explored.chunk(admin, 0, 0)!
    expect(whole[0]).toBe(terrainAt(terrain, 0, 0))
    expect(whole[CHUNK_SIZE * CHUNK_SIZE - 1]).toBe(terrainAt(terrain, 31, 31))
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
    expect(decodeChunk(1, 1, explored.chunk(admin, 1, 1)!).nodes).toHaveLength(2)
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
    return { app, explored, mara, cookies, close: () => opened.close() }
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
})
