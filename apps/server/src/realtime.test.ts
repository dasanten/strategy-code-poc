import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { SESSION_COOKIE, WS_PATH, chunksAcross, realmName, type ServerMessage } from '@csp/shared'
import { buildApp } from './app.js'
import { createAdmin, createInviteCode, createSession, signUp } from './auth.js'
import { recordEvent } from './events.js'
import { ExploredTerrain } from './explored.js'
import type { InvariantViolation } from './invariants.js'
import { openDb, schema } from './db/index.js'
import { OrderQueue } from './orders.js'
import { realmOf } from './starting-city.js'
import { SightTracker } from './sight.js'
import { attachRealtime } from './realtime.js'
import { TerritoryTracker } from './territory.js'
import { cityTerrain } from './test-terrain.js'
import { createWorld, stepWorld } from './world.js'

const terrain = cityTerrain()

const cleanup: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn()
})

async function start() {
  const opened = await openDb(':memory:')
  const app = await buildApp({
    db: opened.db,
    logger: false,
    secureCookies: false,
    trustProxy: false,
  })
  const world = createWorld(terrain)
  const orders = new OrderQueue()
  const territory = new TerritoryTracker()
  // Every send is checked against the Player's sight; what breaks it lands here.
  const violations: InvariantViolation[] = []
  const reporter = {
    invariantViolations: (_w: unknown, v: InvariantViolation[]) => violations.push(...v),
    tickHealth() {},
    tickError() {},
  }
  const realtime = attachRealtime(app.server, {
    db: opened.db,
    world,
    terrain,
    explored: new ExploredTerrain(terrain),
    sight: new SightTracker(),
    orders,
    territory,
    sightCheck: { reporter, sampleRate: 1 },
  })
  await app.listen({ port: 0, host: '127.0.0.1' })
  cleanup.push(
    () => opened.close(),
    () => app.close(),
    () => realtime.close(),
  )
  const port = (app.server.address() as AddressInfo).port
  await createAdmin(opened.db, 'Daniel', 'admin password')
  const user = opened.db.select().from(schema.users).get()!
  return {
    db: opened.db,
    userId: user.id,
    world,
    realtime,
    territory,
    orders,
    sightCheck: { reporter, sampleRate: 1 },
    violations,
    url: `ws://127.0.0.1:${port}${WS_PATH}`,
    token: createSession(opened.db, user.id),
  }
}

/** Opens a socket and collects every message it receives. */
function connect(url: string, token?: string) {
  const headers = token ? { cookie: `${SESSION_COOKIE}=${token}` } : undefined
  const socket = new WebSocket(url, { headers })
  const messages: ServerMessage[] = []
  socket.on('message', (raw) => messages.push(JSON.parse(String(raw)) as ServerMessage))
  // Closing a refused socket mid-handshake reports an error; the tests check status codes instead.
  socket.on('error', () => {})
  cleanup.push(() => socket.terminate())
  const next = async (type: ServerMessage['type']) => {
    for (let i = 0; i < 100; i++) {
      const found = messages.find((m) => m.type === type)
      if (found) {
        messages.splice(messages.indexOf(found), 1)
        return found
      }
      await new Promise((r) => setTimeout(r, 10))
    }
    throw new Error(`no ${type} message`)
  }
  return { socket, next }
}

describe('realtime', () => {
  it('refuses sockets without a session', async () => {
    const { url } = await start()
    const { socket } = connect(url)
    const status = await new Promise<number | undefined>((resolve) =>
      socket.on('unexpected-response', (_req, res) => resolve(res.statusCode)),
    )
    expect(status).toBe(401)
  })

  it('welcomes a logged-in Player, then sends only changes', async () => {
    const { url, token, world, realtime, violations } = await start()
    const { next } = connect(url, token)
    const welcome = await next('welcome')
    expect(welcome).toMatchObject({ type: 'welcome', account: { name: 'Daniel' }, tick: 0 })
    if (welcome.type === 'welcome') {
      // First connect: Daniel gets a realm and starting city, and the view starts there.
      expect(world.realms).toHaveLength(1)
      const city = world.cities[0]!
      expect(welcome.home).toMatchObject({ realmId: world.realms[0]!.id, cityId: city.id })
      const hall = world.buildings.find((b) => b.id === city.townHallId)!
      expect(welcome.home).toMatchObject({ x: hall.x, y: hall.y })
      // Daniel sees his city and everything in it, through his residents' eyes.
      const kinds = welcome.entities.map((e) => e.is)
      expect(kinds.filter((k) => k === 'resident')).toHaveLength(world.residents.length)
      expect(kinds.filter((k) => k === 'city')).toHaveLength(1)
      expect(kinds.filter((k) => k === 'building')).toHaveLength(world.buildings.length)
      expect(kinds).toContain('horse')
      expect(kinds).toContain('carriage')
      // Explored terrain: what the residents see around the city, not the whole map, admin or not.
      const n = chunksAcross(terrain.size)
      expect(welcome.exploredChunks.length).toBeGreaterThan(0)
      expect(welcome.exploredChunks.length).toBeLessThan(n * n)
    }

    realtime.broadcastTick()
    expect(await next('tick')).toEqual({
      type: 'tick',
      tick: 0,
      changed: [],
      gone: [],
      explored: [],
      events: [],
    })

    stepWorld(world, terrain)
    realtime.broadcastTick()
    const tick = await next('tick')
    if (tick.type === 'tick') expect(tick.tick).toBe(1)
    expect(violations).toEqual([])
  })

  it('keeps one realm per Player across logins', async () => {
    const { url, token, world } = await start()
    const first = await connect(url, token).next('welcome')
    const second = await connect(url, token).next('welcome')
    expect(world.realms).toHaveLength(1)
    expect(world.cities).toHaveLength(1)
    if (first.type === 'welcome' && second.type === 'welcome') {
      expect(second.home).toEqual(first.home)
    }
  })

  it('answers orders with an ack or a rejection', async () => {
    const { url, token } = await start()
    const { socket, next } = connect(url, token)
    await next('welcome')
    socket.send(JSON.stringify({ type: 'order', requestId: 'r1', order: { kind: 'fly' } }))
    expect(await next('rejected')).toEqual({
      type: 'rejected',
      requestId: 'r1',
      reason: 'unknown order: fly',
    })
  })

  it('sends each Player only their own realm events, each once, and the log on connect', async () => {
    const { url, token, db, userId, world, realtime } = await start()
    const other = await signUp(db, {
      name: 'Mara',
      password: 'mara password',
      inviteCode: createInviteCode(db, userId),
    })
    const daniel = connect(url, token)
    const mara = connect(url, createSession(db, other.id))
    expect(await daniel.next('welcome')).toMatchObject({ events: [] })
    expect(await mara.next('welcome')).toMatchObject({ events: [] })

    const danielsRealm = realmOf(world, userId)!
    const danielsLeader = world.residents.find((r) => r.id === danielsRealm.leaderId)!
    recordEvent(world, danielsRealm.id, {
      kind: 'hungry',
      residentId: danielsLeader.id,
      name: danielsLeader.name,
    })
    recordEvent(world, realmOf(world, other.id)!.id, { kind: 'foodSpoiled', units: 3 })
    realtime.broadcastTick()
    const danielsTick = await daniel.next('tick')
    const marasTick = await mara.next('tick')
    expect(danielsTick.type === 'tick' && danielsTick.events).toEqual([
      expect.objectContaining({ kind: 'hungry', userId, residentId: danielsLeader.id }),
    ])
    expect(marasTick.type === 'tick' && marasTick.events).toEqual([
      expect.objectContaining({ kind: 'foodSpoiled', userId: other.id, units: 3 }),
    ])

    // Nothing new happened, so nothing is sent again.
    realtime.broadcastTick()
    const again = await daniel.next('tick')
    expect(again.type === 'tick' && again.events).toEqual([])

    // Logging in again brings the Player's log as kept, and only theirs.
    const welcome = await connect(url, token).next('welcome')
    expect(welcome.type === 'welcome' && welcome.events.map((e) => e.kind)).toEqual(['hungry'])
  })
  it('sends the Player their alliance matters on connect, and again only when they change', async () => {
    const { url, token, world, realtime, orders } = await start()
    const { socket, next } = connect(url, token)
    const welcome = await next('welcome')
    expect(welcome.type === 'welcome' && welcome.diplomacy).toEqual({
      alliance: null,
      invitations: [],
      realmsInSight: [],
    })
    socket.send(
      JSON.stringify({
        type: 'order',
        requestId: 'a1',
        order: { kind: 'foundAlliance', name: 'North' },
      }),
    )
    expect(await next('ack')).toEqual({ type: 'ack', requestId: 'a1' })
    realtime.broadcastTick()
    expect(await next('tick')).not.toHaveProperty('diplomacy')

    orders.applyAll(world)
    realtime.broadcastTick()
    const tick = await next('tick')
    expect(tick.type === 'tick' && tick.diplomacy?.alliance).toMatchObject({
      name: 'North',
      leaderId: world.realms[0]!.id,
    })
    realtime.broadcastTick()
    expect(await next('tick')).not.toHaveProperty('diplomacy')
  })

  it('sends the Region map whole when territory is worked out, then the chunks explored', async () => {
    const { url, token, userId, world, realtime, territory, violations } = await start()
    const { next } = connect(url, token)
    const welcome = await next('welcome')
    // Territory is worked out on the first tick after a start: nothing to show yet.
    expect(welcome.type === 'welcome' && welcome.region).toBeNull()
    const explored = welcome.type === 'welcome' ? welcome.exploredChunks : []

    territory.update(world, terrain)
    realtime.broadcastTick()
    const whole = await next('tick')
    const realmId = world.realms[0]!.id
    expect(whole.type === 'tick' && whole.region).toMatchObject({
      tick: world.tick,
      chunks: null,
      holders: [{ id: realmId, name: realmName(world, realmId), alliance: null }],
    })
    // Only once: the next tick has nothing new for it.
    realtime.broadcastTick()
    expect(await next('tick')).not.toHaveProperty('region')

    // Explored terrain grew in a chunk: that chunk goes out again.
    realtime.broadcastTick(new Map([[userId, new Set([explored[0]!])]]))
    const part = await next('tick')
    expect(part.type === 'tick' && part.region?.chunks).toEqual([explored[0]])
    expect(violations).toEqual([])
  })
})
