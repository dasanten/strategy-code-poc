import type { Server } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import {
  SESSION_COOKIE,
  WS_PATH,
  type Account,
  type ClientMessage,
  type ServerMessage,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { getSessionUser, type SessionUser } from './auth.js'
import type { Db } from './db/index.js'
import type { ExploredTerrain } from './explored.js'
import type { OrderQueue } from './orders.js'
import { foundStartingCity } from './starting-city.js'
import { entitiesInSight, type SightTracker } from './sight.js'
import { ClientView } from './sync.js'

function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of header?.split(';') ?? []) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return undefined
}

function send(socket: WebSocket, msg: ServerMessage) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg))
}

interface Client {
  account: Account
  userId: number
  realmId: string
  view: ClientView
}

/**
 * The WebSocket side (ADR 0006): only logged-in sessions connect; each client gets what its
 * Player sees on connect and the changes every tick; orders come back the same way.
 */
export function attachRealtime(
  server: Server,
  opts: {
    db: Db
    world: WorldState
    terrain: TerrainMap
    explored: ExploredTerrain
    sight: SightTracker
    orders: OrderQueue
  },
) {
  const { world } = opts
  const users = new WeakMap<object, SessionUser>()
  const clients = new Map<WebSocket, Client>()

  const wss = new WebSocketServer({
    server,
    path: WS_PATH,
    verifyClient: ({ req }, done) => {
      const user = getSessionUser(opts.db, readCookie(req.headers.cookie, SESSION_COOKIE))
      if (!user) return done(false, 401, 'Not logged in')
      users.set(req, user)
      done(true)
    },
  })

  wss.on('connection', (socket, req) => {
    const user = users.get(req)!
    // A Player without a realm (new, or from before realms) gets their starting city now, and
    // their residents look around before the welcome goes out.
    const realm = foundStartingCity(world, opts.terrain, user.id)
    opts.sight.update(world, opts.explored)
    const client: Client = {
      account: { name: user.name, isAdmin: user.isAdmin },
      userId: user.id,
      realmId: realm.id,
      view: new ClientView(),
    }
    clients.set(socket, client)
    const city = world.cities.find((c) => c.realmId === realm.id)!
    const [cx, cy] = [city.x + Math.floor(city.size / 2), city.y + Math.floor(city.size / 2)]
    const entities = client.view.initial(entitiesInSight(world, opts.terrain, realm.id))
    send(socket, {
      type: 'welcome',
      account: client.account,
      tick: world.tick,
      map: { seed: world.seed, size: opts.terrain.size },
      exploredChunks: opts.explored.exploredChunks(user),
      home: { realmId: realm.id, leaderId: realm.leaderId, cityId: city.id, x: cx, y: cy },
      entities,
    })

    socket.on('message', (raw) => {
      let msg: ClientMessage
      try {
        msg = JSON.parse(String(raw)) as ClientMessage
      } catch {
        return send(socket, { type: 'rejected', requestId: '', reason: 'not JSON' })
      }
      if (msg?.type === 'order') {
        const sender = { userId: client.userId, account: client.account }
        send(socket, opts.orders.receive(world, sender, msg.requestId, msg.order))
      }
    })
    socket.on('close', () => clients.delete(socket))
  })

  return {
    /**
     * Sends every client the changes in its sight since the last tick, and the chunks whose
     * explored terrain grew for its Player (`explored`, from `SightTracker.update`).
     */
    broadcastTick(explored: Map<number, Set<number>> = new Map()) {
      for (const [socket, client] of clients) {
        const inSight = entitiesInSight(world, opts.terrain, client.realmId)
        const { changed, gone } = client.view.diff(inSight)
        const grown = [...(explored.get(client.userId) ?? [])]
        send(socket, { type: 'tick', tick: world.tick, changed, gone, explored: grown })
      }
    },
    close() {
      for (const socket of clients.keys()) socket.close()
      wss.close()
    },
  }
}
