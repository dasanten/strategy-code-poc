import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { SESSION_COOKIE, WS_PATH, type ServerMessage } from '@csp/shared'
import { buildApp } from './app.js'
import { createAdmin, createSession } from './auth.js'
import { openDb, schema } from './db/index.js'
import { OrderQueue } from './orders.js'
import { attachRealtime } from './realtime.js'
import { createWorld, stepWorld } from './world.js'

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
  const world = createWorld()
  const realtime = attachRealtime(app.server, { db: opened.db, world, orders: new OrderQueue() })
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
    world,
    realtime,
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
    const { url, token, world, realtime } = await start()
    const { next } = connect(url, token)
    const welcome = await next('welcome')
    expect(welcome).toMatchObject({ type: 'welcome', account: { name: 'Daniel' }, tick: 0 })
    if (welcome.type === 'welcome') expect(welcome.entities).toHaveLength(world.units.length)

    realtime.broadcastTick()
    expect(await next('tick')).toEqual({ type: 'tick', tick: 0, changed: [], gone: [] })

    stepWorld(world, () => 0)
    realtime.broadcastTick()
    const tick = await next('tick')
    if (tick.type === 'tick') expect(tick.tick).toBe(1)
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
})
