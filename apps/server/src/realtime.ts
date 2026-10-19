import type { Server } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import {
  SESSION_COOKIE,
  WS_PATH,
  diplomacyFor,
  townHallOf,
  type Account,
  type ClientMessage,
  type SeenEntity,
  type ServerMessage,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { getSessionUser, type SessionUser } from './auth.js'
import type { Db } from './db/index.js'
import type { ExploredTerrain } from './explored.js'
import type { OrderQueue } from './orders.js'
import { foundStartingCity } from './starting-city.js'
import { eventsFor } from './events.js'
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

/** The realms whose residents are among the entities. */
function realmsSeen(entities: SeenEntity[]): string[] {
  return entities.flatMap((e) => (e.is === 'resident' && e.owner !== null ? [e.owner] : []))
}

interface Client {
  account: Account
  userId: number
  realmId: string
  view: ClientView
  /** The number of the last realm event sent, so each tick sends only newer ones. */
  lastEventSeq: number
  /** The alliance matters last sent, as JSON, so a tick sends them only when they changed. */
  lastDiplomacy: string
}

/**
 * The WebSocket side (ADR 0006): only logged-in sessions connect; each client gets what its
 * Player sees and their realm log on connect, then the changes every tick; orders come back the
 * same way.
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
      lastEventSeq: 0,
      lastDiplomacy: '',
    }
    clients.set(socket, client)
    // The view starts at the town hall of the realm's first city, or with the Leader if it has
    // none left.
    const city = world.cities.find((c) => c.realmId === realm.id)
    const leader = world.residents.find((r) => r.id === realm.leaderId)
    const start = (city && townHallOf(world, city)) ?? leader ?? { x: 0, y: 0 }
    const [cx, cy] = [start.x, start.y]
    const entities = client.view.initial(entitiesInSight(world, opts.terrain, realm.id))
    const events = eventsFor(world, user.id)
    client.lastEventSeq = events.at(-1)?.seq ?? 0
    const diplomacy = diplomacyFor(world, realm.id, realmsSeen(entities))
    client.lastDiplomacy = JSON.stringify(diplomacy)
    send(socket, {
      type: 'welcome',
      account: client.account,
      tick: world.tick,
      map: { seed: world.seed, size: opts.terrain.size },
      exploredChunks: opts.explored.exploredChunks(user),
      home: { realmId: realm.id, leaderId: realm.leaderId, cityId: city?.id ?? null, x: cx, y: cy },
      entities,
      events,
      diplomacy,
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
     * explored terrain grew for its Player (`explored`, from `SightTracker.update`), and its
     * Player's new realm events, and their alliance matters when those changed: each Player gets
     * only their own.
     */
    broadcastTick(explored: Map<number, Set<number>> = new Map()) {
      for (const [socket, client] of clients) {
        const inSight = entitiesInSight(world, opts.terrain, client.realmId)
        const { changed, gone } = client.view.diff(inSight)
        const grown = [...(explored.get(client.userId) ?? [])]
        const events = eventsFor(world, client.userId, client.lastEventSeq)
        client.lastEventSeq = events.at(-1)?.seq ?? client.lastEventSeq
        const diplomacy = diplomacyFor(world, client.realmId, realmsSeen(inSight))
        const json = JSON.stringify(diplomacy)
        const fresh = json === client.lastDiplomacy ? {} : { diplomacy }
        client.lastDiplomacy = json
        const tick = { tick: world.tick, changed, gone, explored: grown, events, ...fresh }
        send(socket, { type: 'tick', ...tick })
      }
    },
    close() {
      for (const socket of clients.keys()) socket.close()
      wss.close()
    },
  }
}
