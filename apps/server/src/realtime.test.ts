import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import {
  REALM_NAME_MAX_LENGTH,
  RESIDENT_NAME_MAX_LENGTH,
  SCRIPT_STEP_BUDGET,
  SESSION_COOKIE,
  WS_CLOSE_LOGGED_OUT,
  WS_CLOSE_TOO_MANY_REQUESTS,
  WS_PATH,
  chunksAcross,
  realmName,
  type ServerMessage,
} from '@csp/shared'
import { buildApp } from './app.js'
import { createAdmin, createInviteCode, createSession, signUp } from './auth.js'
import { recordEvent } from './events.js'
import { ExploredTerrain } from './explored.js'
import type { InvariantViolation } from './invariants.js'
import { openDb, schema, type Db } from './db/index.js'
import { OrderQueue, orderKinds, type OrderKind } from './orders.js'
import { realmOf } from './starting-city.js'
import { SightTracker } from './sight.js'
import { dieAll } from './survival.js'
import { SESSION_RECHECK_MS, attachRealtime, scriptMemoryFor } from './realtime.js'
import { TerritoryTracker } from './territory.js'
import { cityTerrain } from './test-terrain.js'
import { createWorld, stepWorld } from './world.js'

const terrain = cityTerrain()


const cleanup: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn()
})

/**
 * Starts a server. `sessionDb` is what the upgrade checks sessions against, the app's db unless
 * given; `kinds` the order kinds, the game's unless given; `onError` hears of a message handler's
 * exceptions; `origins`, `limits` and `now` go to `attachRealtime` as they are.
 */
async function start(
  options: {
    sessionDb?: Db
    kinds?: Record<string, OrderKind>
  } & Partial<Pick<Parameters<typeof attachRealtime>[1], 'onError' | 'origins' | 'limits' | 'now'>> = {},
) {
  const opened = await openDb(':memory:')
  const app = await buildApp({
    db: opened.db,
    logger: false,
    secureCookies: false,
    trustProxy: false,
    // Wired as in `index.ts`: the sockets are attached once the app has its server.
    sockets: {
      disconnectSession: (tokenHash) => realtime.disconnectSession(tokenHash),
      disconnectUser: (userId) => realtime.disconnectUser(userId),
    },
  })
  const world = createWorld(terrain)
  const orders = new OrderQueue(options.kinds)
  const territory = new TerritoryTracker()
  // Every send is checked against the Player's sight; what breaks it lands here.
  const violations: InvariantViolation[] = []
  const reporter = {
    invariantViolations: (_w: unknown, v: InvariantViolation[]) => violations.push(...v),
    tickHealth() {},
    tickError() {},
  }
  const realtime = attachRealtime(app.server, {
    db: options.sessionDb ?? opened.db,
    world,
    terrain,
    explored: new ExploredTerrain(terrain),
    sight: new SightTracker(),
    orders,
    territory,
    sightCheck: { reporter, sampleRate: 1 },
    onError: options.onError,
    origins: options.origins,
    limits: options.limits,
    now: options.now,
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
    app,
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

/**
 * Opens a socket and collects every message it receives. A Player without a realm founds one
 * named `found` gives, keeping the Leader's name from the game; `found: null` leaves it to the test.
 */
function connect(
  url: string,
  token?: string,
  found: { realmName: string; leaderName?: string } | null = { realmName: 'Ironvale' },
  headers: Record<string, string> = {},
) {
  if (token) headers = { ...headers, cookie: `${SESSION_COOKIE}=${token}` }
  const socket = new WebSocket(url, { headers })
  const messages: ServerMessage[] = []
  socket.on('message', (raw) => {
    const msg = JSON.parse(String(raw)) as ServerMessage
    messages.push(msg)
    if (msg.type === 'founding' && found) {
      const leaderName = found.leaderName ?? msg.leaderName
      socket.send(JSON.stringify({ type: 'found', requestId: 'f', ...found, leaderName }))
    }
  })
  // Closing a refused socket mid-handshake reports an error; the tests check status codes instead.
  socket.on('error', () => {})
  const closed = new Promise<number>((resolve) => socket.on('close', (code) => resolve(code)))
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
  const refused = () =>
    new Promise<number | undefined>((resolve) =>
      socket.on('unexpected-response', (_req, res) => resolve(res.statusCode)),
    )
  return { socket, next, messages, refused, closed }
}

/** Whether a socket is still open after what was just sent arrived: it still gets ticks. */
async function stillOpen(client: ReturnType<typeof connect>, realtime: { broadcastTick(): void }) {
  realtime.broadcastTick()
  await client.next('tick')
  return client.socket.readyState === WebSocket.OPEN
}

describe('realtime', () => {
  it('refuses sockets without a session', async () => {
    const { url } = await start()
    expect(await connect(url).refused()).toBe(401)
  })

  it('refuses a socket from another origin, and takes the allowed ones and its own host', async () => {
    const origins = { allowed: ['https://game.example.com'], allowMissing: false }
    const { url, token, world } = await start({ origins })
    const open = (origin?: string) =>
      connect(url, token, { realmName: 'Ironvale' }, origin === undefined ? {} : { origin })
    // Another site a Player has open, with their cookie: refused before the session is looked at.
    expect(await open('https://evil.example.com').refused()).toBe(403)
    // A browser always sends an Origin; without one it is let in only outside production.
    expect(await open().refused()).toBe(403)
    expect(world.realms).toEqual([])
    // The game's own domain, as configured, and whatever host the request came in at.
    expect(await open('https://game.example.com').next('welcome')).toMatchObject({ type: 'welcome' })
    const own = `http://${new URL(url).host}`
    expect(await open(own).next('welcome')).toMatchObject({ type: 'welcome' })
    expect(await open('http://localhost:5173').refused()).toBe(403)
  })

  it('lets a socket without an Origin in where the policy allows it (development)', async () => {
    const { url, token } = await start({ origins: { allowed: [], allowMissing: true } })
    expect(await connect(url, token).next('welcome')).toMatchObject({ type: 'welcome' })
  })

  it('closes a socket that sends a frame over maxPayload, and stays up', async () => {
    const { url, token } = await start({ limits: { maxPayloadBytes: 1024 } })
    const first = connect(url, token)
    await first.next('welcome')
    first.socket.send(JSON.stringify({ type: 'watch', ids: ['x'.repeat(2000)] }))
    expect(await first.closed).toBe(1009)
    // The server took no harm: the next connection plays on, and a frame within the cap is fine.
    const second = connect(url, token)
    await second.next('welcome')
    second.socket.send(JSON.stringify({ type: 'order', requestId: 'r1', order: { kind: 'fly' } }))
    expect(await second.next('rejected')).toMatchObject({ requestId: 'r1' })
  })

  it('closes a socket that floods it with messages, as "too many requests"', async () => {
    let time = 0
    const { url, token } = await start({
      limits: { messageBurst: 4, messagesPerSecond: 1 },
      now: () => time,
    })
    const { socket, next, closed } = connect(url, token)
    await next('welcome')
    const order = (id: string) =>
      socket.send(JSON.stringify({ type: 'order', requestId: id, order: { kind: 'fly' } }))
    // The burst goes through, each answered.
    for (const id of ['a', 'b', 'c']) {
      order(id)
      expect(await next('rejected')).toMatchObject({ requestId: id })
    }
    // Half a second on, half a message is earned: not enough.
    time = 500
    order('d')
    expect(await closed).toBe(WS_CLOSE_TOO_MANY_REQUESTS)

    // Given time, the allowance comes back.
    time = 2500
    const again = connect(url, token)
    await again.next('welcome')
    again.socket.send(JSON.stringify({ type: 'order', requestId: 'e', order: { kind: 'fly' } }))
    expect(await again.next('rejected')).toMatchObject({ requestId: 'e' })
  })

  it('caps the sockets one account holds open, and frees a slot when one closes', async () => {
    const { url, token, db, userId } = await start({ limits: { connectionsPerUser: 2 } })
    const first = connect(url, token)
    await first.next('welcome')
    const second = connect(url, token)
    await second.next('welcome')
    expect(await connect(url, token).refused()).toBe(429)
    // Another account is counted on its own.
    const other = await signUp(db, {
      name: 'Mara',
      password: 'mara password',
      inviteCode: createInviteCode(db, userId),
    })
    await connect(url, createSession(db, other.id)).next('welcome')
    first.socket.close()
    await first.closed
    await connect(url, token).next('welcome')
  })

  it("caps a realm's orders waiting for the next tick, and takes more once it ran", async () => {
    const { url, token, world, orders } = await start({ limits: { pendingOrdersPerRealm: 2 } })
    const { socket, next } = connect(url, token)
    await next('welcome')
    // Renaming the Leader is valid any number of times, before and after a tick applied it.
    const leaderId = world.realms[0]!.leaderId
    const order = (id: string) =>
      socket.send(
        JSON.stringify({
          type: 'order',
          requestId: id,
          order: { kind: 'rename', residentId: leaderId, targetId: leaderId, name: `Brann ${id}` },
        }),
      )
    order('a')
    expect(await next('ack')).toEqual({ type: 'ack', requestId: 'a' })
    order('b')
    expect(await next('ack')).toEqual({ type: 'ack', requestId: 'b' })
    order('c')
    expect(await next('rejected')).toEqual({
      type: 'rejected',
      requestId: 'c',
      reason: 'too many orders waiting',
    })
    expect(orders.size).toBe(2)
    orders.applyAll(world)
    order('d')
    expect(await next('ack')).toEqual({ type: 'ack', requestId: 'd' })
  })

  /** The status the server refuses an upgrade with. */
  const refusal = (socket: WebSocket) =>
    new Promise<number | undefined>((resolve) =>
      socket.on('unexpected-response', (_req, res) => resolve(res.statusCode)),
    )

  it('refuses a malformed session cookie and keeps serving the next upgrade', async () => {
    const { url, token } = await start()
    // Not valid percent-encoding: decoding it threw inside the upgrade and ended the process.
    expect(await refusal(connect(url, '%E0%A4%A').socket)).toBe(401)
    const { next } = connect(url, token)
    expect(await next('welcome')).toMatchObject({ type: 'welcome', account: { name: 'Daniel' } })
  })

  it('refuses an upgrade that errors unexpectedly with 400, instead of going down', async () => {
    const broken = {
      select() {
        throw new Error('database gone')
      },
    } as unknown as Db
    const { url, token } = await start({ sessionDb: broken })
    expect(await refusal(connect(url, token).socket)).toBe(400)
    expect(await refusal(connect(url, token).socket)).toBe(400)
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

  it('founds nothing on connect: a Player without a realm names it and their Leader first', async () => {
    const { url, token, userId, world } = await start()
    const { socket, next } = connect(url, token, null)
    const founding = await next('founding')
    if (founding.type !== 'founding') throw new Error('no founding')
    expect(founding.account).toEqual({ name: 'Daniel', isAdmin: true })
    expect(founding.leaderName).toMatch(/^\w+$/)
    expect(world.realms).toEqual([])
    expect(world.cities).toEqual([])

    // Nothing to order around yet.
    socket.send(JSON.stringify({ type: 'order', requestId: 'o1', order: { kind: 'fly' } }))
    expect(await next('rejected')).toEqual({
      type: 'rejected',
      requestId: 'o1',
      reason: 'no realm yet',
    })

    const names = { realmName: '  Ironvale ', leaderName: ' Brann  ' }
    socket.send(JSON.stringify({ type: 'found', requestId: 'f1', ...names }))
    const welcome = await next('welcome')
    const realm = realmOf(world, userId)!
    expect(realm.name).toBe('Ironvale')
    const leader = world.residents.find((r) => r.id === realm.leaderId)!
    expect(leader.name).toBe('Brann')
    expect(welcome).toMatchObject({ home: { realmId: realm.id, leaderId: leader.id } })
    expect(world.cities).toHaveLength(1)
    // The log names the Leader as founded.
    expect(welcome.type === 'welcome' && welcome.events[0]).toMatchObject({
      kind: 'founded',
      name: 'Brann',
    })
    // Founded once: asking again changes nothing.
    socket.send(JSON.stringify({ type: 'found', requestId: 'f2', realmName: 'X', leaderName: 'Y' }))
    socket.send(JSON.stringify({ type: 'order', requestId: 'o2', order: { kind: 'fly' } }))
    expect(await next('rejected')).toMatchObject({ requestId: 'o2' })
    expect(realm.name).toBe('Ironvale')
    expect(world.realms).toHaveLength(1)
  })

  it('refuses to found with an empty or too long name', async () => {
    const { url, token, world } = await start()
    const { socket, next } = connect(url, token, null)
    await next('founding')
    const tooLong = 'x'.repeat(REALM_NAME_MAX_LENGTH + 1)
    const tries = [
      { realmName: '   ', leaderName: 'Brann', reason: 'Realm name: needs a name' },
      { realmName: tooLong, leaderName: 'Brann', reason: `Realm name: at most 30 characters` },
      { realmName: 'Ironvale', leaderName: '', reason: 'Leader name: needs a name' },
      {
        realmName: 'Ironvale',
        leaderName: 'y'.repeat(RESIDENT_NAME_MAX_LENGTH + 1),
        reason: 'Leader name: at most 30 characters',
      },
      { realmName: 7, leaderName: 'Brann', reason: 'Realm name: needs a name' },
    ]
    for (const [i, { reason, ...names }] of tries.entries()) {
      socket.send(JSON.stringify({ type: 'found', requestId: `f${i}`, ...names }))
      expect(await next('rejected')).toEqual({ type: 'rejected', requestId: `f${i}`, reason })
    }
    expect(world.realms).toEqual([])
    expect(world.cities).toEqual([])
    // Exactly the longest name is fine.
    const longest = 'z'.repeat(REALM_NAME_MAX_LENGTH)
    socket.send(
      JSON.stringify({ type: 'found', requestId: 'ok', realmName: longest, leaderName: 'B' }),
    )
    await next('welcome')
    expect(world.realms[0]!.name).toBe(longest)
  })

  it('sends what left sight as Last seen, apart from sight, and drops it when back in sight', async () => {
    const { url, token, world, realtime, violations } = await start()
    const first = connect(url, token)
    await first.next('welcome')
    stepWorld(world, terrain)
    realtime.broadcastTick()
    await first.next('tick')
    // Everyone walks far off: the city leaves sight and comes back as Last seen.
    const homes = world.residents.map((r) => ({ x: r.x, y: r.y }))
    for (const r of world.residents)
      Object.assign(r, { x: (r.x + 400) % terrain.size, order: null })
    stepWorld(world, terrain)
    realtime.broadcastTick()
    const away = await first.next('tick')
    const city = world.cities[0]!
    const hall = city.townHallId
    if (away.type !== 'tick') throw new Error('no tick')
    expect(away.gone).toContain(hall)
    expect(away.lastSeen?.changed.map((e) => e.id)).toEqual(expect.arrayContaining([hall, city.id]))
    expect(away.lastSeen?.changed.find((e) => e.id === hall)).toMatchObject({ seenAt: 1 })
    // A new connection gets it in the welcome, apart from what is in sight.
    const welcome = await connect(url, token).next('welcome')
    if (welcome.type !== 'welcome') throw new Error('no welcome')
    expect(welcome.lastSeen.map((e) => e.id)).toContain(hall)
    expect(welcome.entities.map((e) => e.id)).not.toContain(hall)
    // Back home: in sight again, no longer Last seen.
    world.residents.forEach((r, i) => Object.assign(r, homes[i]))
    stepWorld(world, terrain)
    realtime.broadcastTick()
    const back = await first.next('tick')
    if (back.type !== 'tick') throw new Error('no tick')
    expect(back.changed.map((e) => e.id)).toContain(hall)
    expect(back.lastSeen?.gone).toContain(hall)
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

  it('rejects an order kind named after something inherited from Object.prototype', async () => {
    const { url, token } = await start()
    const { socket, next } = connect(url, token)
    await next('welcome')
    for (const kind of ['constructor', 'toString', '__proto__']) {
      socket.send(JSON.stringify({ type: 'order', requestId: kind, order: { kind } }))
      expect(await next('rejected')).toEqual({
        type: 'rejected',
        requestId: kind,
        reason: `unknown order: ${kind}`,
      })
    }
  })

  it('answers a message whose handling throws, reports it and keeps the socket open', async () => {
    const errors: unknown[] = []
    const broken: OrderKind = {
      validate: () => {
        throw new Error('bug in the check')
      },
      apply: () => {},
    }
    const { url, token, userId } = await start({
      kinds: { ...orderKinds, broken },
      onError: (error, from) => errors.push([error, from]),
    })
    const { socket, next } = connect(url, token)
    await next('welcome')
    socket.send(JSON.stringify({ type: 'order', requestId: 'r1', order: { kind: 'broken' } }))
    expect(await next('rejected')).toEqual({
      type: 'rejected',
      requestId: 'r1',
      reason: 'server error',
    })
    expect(errors).toEqual([[new Error('bug in the check'), userId]])
    // The socket, and the server, are still there for the next message.
    socket.send(JSON.stringify({ type: 'order', requestId: 'r2', order: { kind: 'fly' } }))
    expect(await next('rejected')).toMatchObject({ requestId: 'r2', reason: 'unknown order: fly' })
    expect(socket.readyState).toBe(WebSocket.OPEN)
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
    // Each log starts with their Leader founding their starting city.
    const founded = [expect.objectContaining({ kind: 'founded' })]
    expect(await daniel.next('welcome')).toMatchObject({ events: founded })
    expect(await mara.next('welcome')).toMatchObject({ events: founded })

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
    expect(welcome.type === 'welcome' && welcome.events.map((e) => e.kind)).toEqual([
      'founded',
      'hungry',
    ])
  })
  it('sends the memory of a watched script to the Player running it, and to nobody else', async () => {
    const { url, token, db, userId, world, realtime } = await start()
    const other = await signUp(db, {
      name: 'Mara',
      password: 'mara password',
      inviteCode: createInviteCode(db, userId),
    })
    const daniel = connect(url, token)
    const mara = connect(url, createSession(db, other.id))
    await daniel.next('welcome')
    await mara.next('welcome')
    const realm = realmOf(world, userId)!
    const worker = world.residents.find((r) => r.owner === realm.id)!
    worker.script = { scriptId: 1, memory: { n: 1, at: { x: 3, y: 4 } } }
    const watch = { type: 'watch', ids: [worker.id] }

    // Opening the Script tab brings the memory at once.
    daniel.socket.send(JSON.stringify(watch))
    expect(await daniel.next('scriptMemory')).toEqual({
      type: 'scriptMemory',
      id: worker.id,
      memory: { n: 1, at: { x: 3, y: 4 } },
    })
    // Another Player watching the same resident learns nothing of it.
    mara.socket.send(JSON.stringify(watch))
    expect(await mara.next('scriptMemory')).toEqual({
      type: 'scriptMemory',
      id: worker.id,
      memory: null,
    })

    // An answered order shows the server got to everything sent before it.
    const settle = async (c: ReturnType<typeof connect>) => {
      c.socket.send(JSON.stringify({ type: 'order', requestId: 's', order: { kind: 'fly' } }))
      await c.next('rejected')
    }
    const memorySent = (c: ReturnType<typeof connect>) =>
      c.messages.filter((m) => m.type === 'scriptMemory')

    // Every tick it changed, it goes out again; unchanged, it doesn't.
    worker.script.memory = { n: 2, at: { x: 3, y: 4 } }
    realtime.broadcastTick()
    expect(await daniel.next('scriptMemory')).toMatchObject({ memory: { n: 2 } })
    realtime.broadcastTick()
    await settle(daniel)
    await settle(mara)
    expect(memorySent(daniel)).toEqual([])
    expect(memorySent(mara)).toEqual([])

    // Closing the tab stops it.
    daniel.socket.send(JSON.stringify({ type: 'watch', ids: [] }))
    await settle(daniel)
    worker.script.memory = { n: 3 }
    realtime.broadcastTick()
    await settle(daniel)
    expect(memorySent(daniel)).toEqual([])

    // An army's script the same way: only for its own realm.
    const army = { id: 'army-1', name: 'Guard', realmId: realm.id, memberIds: [worker.id] }
    world.armies.push({ ...army, order: null, script: { scriptId: 1, memory: { k: 1 } } })
    expect(scriptMemoryFor(world, realm.id, army.id)).toEqual({ k: 1 })
    expect(scriptMemoryFor(world, realmOf(world, other.id)!.id, army.id)).toBeNull()
  })

  it('sends how a watched script last ran, its error and steps, to the Player running it only', async () => {
    const { url, token, db, userId, world, realtime } = await start()
    const other = await signUp(db, {
      name: 'Mara',
      password: 'mara password',
      inviteCode: createInviteCode(db, userId),
    })
    const daniel = connect(url, token)
    const mara = connect(url, createSession(db, other.id))
    await daniel.next('welcome')
    await mara.next('welcome')
    const realm = realmOf(world, userId)!
    const worker = world.residents.find((r) => r.owner === realm.id)!
    const lastError = { message: 'null has no field x', line: 3, column: 9, tick: 0, version: 2 }
    worker.script = { scriptId: 1, memory: {}, lastError, lastRun: { steps: 312 } }
    const watch = JSON.stringify({ type: 'watch', ids: [worker.id] })

    daniel.socket.send(watch)
    expect(await daniel.next('scriptRun')).toEqual({
      type: 'scriptRun',
      id: worker.id,
      run: { lastError, lastRun: { steps: 312 } },
    })
    mara.socket.send(watch)
    expect(await mara.next('scriptRun')).toEqual({ type: 'scriptRun', id: worker.id, run: null })

    // A tick it changed in sends it again; one it didn't sends nothing.
    worker.script.lastRun = { steps: SCRIPT_STEP_BUDGET, outOfSteps: 'own' }
    realtime.broadcastTick()
    expect(await daniel.next('scriptRun')).toMatchObject({
      run: { lastError, lastRun: { steps: SCRIPT_STEP_BUDGET, outOfSteps: 'own' } },
    })
    realtime.broadcastTick()
    daniel.socket.send(JSON.stringify({ type: 'order', requestId: 's', order: { kind: 'fly' } }))
    await daniel.next('rejected')
    expect(daniel.messages.filter((m) => m.type === 'scriptRun')).toEqual([])
  })

  it('sends a watched resident’s script log to the Player owning them, and to nobody else', async () => {
    const { url, token, db, userId, world, realtime } = await start()
    const other = await signUp(db, {
      name: 'Mara',
      password: 'mara password',
      inviteCode: createInviteCode(db, userId),
    })
    const daniel = connect(url, token)
    const mara = connect(url, createSession(db, other.id))
    await daniel.next('welcome')
    await mara.next('welcome')
    const realm = realmOf(world, userId)!
    // No script running: the log stays to show why the last one ended.
    const worker = world.residents.find((r) => r.owner === realm.id)!
    worker.scriptLog = [{ tick: 3, text: 'no workplace here' }]
    const watch = JSON.stringify({ type: 'watch', ids: [worker.id] })

    daniel.socket.send(watch)
    expect(await daniel.next('scriptLog')).toEqual({
      type: 'scriptLog',
      id: worker.id,
      lines: [{ tick: 3, text: 'no workplace here' }],
    })
    mara.socket.send(watch)
    expect(await mara.next('scriptLog')).toEqual({ type: 'scriptLog', id: worker.id, lines: null })

    // A new line goes out after the tick, to the owner only; nothing in the tick itself.
    worker.scriptLog.push({ tick: 4, text: 'tick' })
    realtime.broadcastTick()
    expect(await daniel.next('scriptLog')).toMatchObject({ lines: [{ tick: 3 }, { tick: 4 }] })
    const ticks = await Promise.all([daniel.next('tick'), mara.next('tick')])
    expect(JSON.stringify(ticks)).not.toContain('no workplace here')
    daniel.socket.send(JSON.stringify({ type: 'order', requestId: 's', order: { kind: 'fly' } }))
    await daniel.next('rejected')
    mara.socket.send(JSON.stringify({ type: 'order', requestId: 's', order: { kind: 'fly' } }))
    await mara.next('rejected')
    expect(mara.messages.filter((m) => m.type === 'scriptLog')).toEqual([])
  })

  it('tells a Player how their Leader died and what became of their cities, then starts them afresh', async () => {
    const { url, token, userId, world, realtime, territory, violations } = await start()
    const first = connect(url, token)
    await first.next('welcome')
    const realm = realmOf(world, userId)!
    const leader = world.residents.find((r) => r.id === realm.leaderId)!
    const city = world.cities.find((c) => c.realmId === realm.id)!
    const hall = world.buildings.find((b) => b.id === city.townHallId)!

    dieAll(world, [leader], 'killed', terrain.size, new Map([[leader.id, 'Brann']]))
    realtime.broadcastTick()
    // Online, the Player reads it at once.
    const tick = await first.next('tick')
    expect(tick.type === 'tick' && tick.events.map((e) => e.kind)).toEqual(['died', 'selfManaged'])
    first.socket.close()

    // On the next login: they name a new realm and Leader, then get a new starting city, and the
    // whole story in the log.
    territory.update(world, terrain)
    const again = connect(url, token, { realmName: 'Ashford', leaderName: 'Odo' })
    expect(await again.next('founding')).toMatchObject({ type: 'founding' })
    const welcome = await again.next('welcome')
    if (welcome.type !== 'welcome') throw new Error('no welcome')
    const fresh = realmOf(world, userId)!
    expect(fresh.id).not.toBe(realm.id)
    expect(fresh.name).toBe('Ashford')
    expect(realmName(world, fresh.id)).toBe('Ashford')
    expect(world.residents.find((r) => r.id === fresh.leaderId)?.name).toBe('Odo')
    expect(welcome.home).toMatchObject({ realmId: fresh.id, leaderId: fresh.leaderId })
    expect(welcome.home.cityId).not.toBe(city.id)
    expect(welcome.events.map((e) => e.kind)).toEqual(['founded', 'died', 'selfManaged', 'founded'])
    expect(welcome.events[1]).toMatchObject({ name: leader.name, leader: true, by: 'Brann' })
    const residents = world.residents.filter((r) => r.cityId === city.id).length
    expect(welcome.events[2]).toMatchObject({
      cities: [{ cityId: city.id, name: city.name, x: hall.x, y: hall.y, residents }],
    })
    // The former city stays findable: on the Region map over the terrain they explored.
    expect(welcome.region?.holders).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: city.id, name: city.name })]),
    )
    expect(violations).toEqual([])
  })

  it('sends the new Leader once the Player handed the realm over (Leader handover)', async () => {
    const { url, token, world, realtime } = await start()
    const { next } = connect(url, token)
    await next('welcome')
    realtime.broadcastTick()
    expect(await next('tick')).not.toHaveProperty('leaderId')
    const realm = world.realms[0]!
    const heir = world.residents.find((r) => r.owner === realm.id && r.id !== realm.leaderId)!
    realm.leaderId = heir.id
    realtime.broadcastTick()
    expect(await next('tick')).toMatchObject({ leaderId: heir.id })
    realtime.broadcastTick()
    expect(await next('tick')).not.toHaveProperty('leaderId')
  })

  it('offers the Player their horses on connect, and says once when they are claimed (Horse offer)', async () => {
    const { url, token, world, realtime, userId } = await start()
    const { next } = connect(url, token)
    expect(await next('welcome')).toMatchObject({ horseOffer: true })
    realtime.broadcastTick()
    expect(await next('tick')).not.toHaveProperty('horseOffer')
    world.horseOffersClaimed.push(userId)
    realtime.broadcastTick()
    expect(await next('tick')).toMatchObject({ horseOffer: false })
    realtime.broadcastTick()
    expect(await next('tick')).not.toHaveProperty('horseOffer')
    const again = connect(url, token)
    expect(await again.next('welcome')).toMatchObject({ horseOffer: false })
  })

  it('sends the Player their alliance matters on connect, and again only when they change', async () => {
    const { url, token, world, realtime, orders } = await start()
    const { socket, next } = connect(url, token)
    const welcome = await next('welcome')
    expect(welcome.type === 'welcome' && welcome.diplomacy).toEqual({
      alliance: null,
      invitations: [],
      realmsInSight: [],
      contracts: [],
      deliveries: [],
      standings: [],
      joinRequests: [],
      directives: [],
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

  it('closes the socket of a session logged out, and keeps the account’s other sessions’', async () => {
    const { app, url, token, db, userId, realtime } = await start()
    const here = connect(url, token)
    await here.next('welcome')
    const elsewhere = connect(url, createSession(db, userId))
    await elsewhere.next('welcome')

    const out = await app.inject({
      method: 'POST',
      url: '/api/logout',
      cookies: { [SESSION_COOKIE]: token },
    })
    expect(out.statusCode).toBe(204)
    expect(await here.closed).toBe(WS_CLOSE_LOGGED_OUT)
    expect(await stillOpen(elsewhere, realtime)).toBe(true)
  })

  it('closes every socket of an account whose password an admin reset, and nobody else’s', async () => {
    const { app, url, token, db, userId, realtime } = await start()
    const mara = await signUp(db, {
      name: 'Mara',
      password: 'mara password',
      inviteCode: createInviteCode(db, userId),
    })
    const daniel = connect(url, token)
    await daniel.next('welcome')
    const found = { realmName: 'Marafield' }
    const marasPhone = connect(url, createSession(db, mara.id), found)
    await marasPhone.next('welcome')
    const marasLaptop = connect(url, createSession(db, mara.id), found)
    await marasLaptop.next('welcome')

    const reset = await app.inject({
      method: 'POST',
      url: '/api/admin/password',
      cookies: { [SESSION_COOKIE]: token },
      payload: { name: 'Mara', password: 'a new password' },
    })
    expect(reset.statusCode).toBe(204)
    expect(await marasPhone.closed).toBe(WS_CLOSE_LOGGED_OUT)
    expect(await marasLaptop.closed).toBe(WS_CLOSE_LOGGED_OUT)
    expect(await stillOpen(daniel, realtime)).toBe(true)
  })

  it('closes the socket of a session that expired, on the next check a minute later', async () => {
    const { url, token, db, realtime } = await start()
    const daniel = connect(url, token)
    await daniel.next('welcome')
    // The only session there is: it expires, but the socket is checked once a minute, not every tick.
    db.update(schema.sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .run()
    const now = Date.now()
    realtime.broadcastTick(new Map(), now)
    expect(await daniel.next('tick')).toMatchObject({ type: 'tick' })
    expect(daniel.socket.readyState).toBe(WebSocket.OPEN)

    realtime.broadcastTick(new Map(), now + SESSION_RECHECK_MS)
    expect(await daniel.closed).toBe(WS_CLOSE_LOGGED_OUT)
  })
})
