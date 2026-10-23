import type { Server } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import {
  SESSION_COOKIE,
  WS_PATH,
  diplomacyFor,
  foundingProblem,
  regionMapFor,
  townHallOf,
  type Account,
  type ClientMessage,
  type Realm,
  type RegionMap,
  type SeenEntity,
  type ServerMessage,
  type TerrainMap,
  type Territory,
  type WorldState,
} from '@csp/shared'
import { getSessionUser, type SessionUser } from './auth.js'
import type { Db } from './db/index.js'
import type { ExploredTerrain } from './explored.js'
import type { OrderQueue } from './orders.js'
import { foundStartingCity, realmOf, suggestedLeaderName } from './starting-city.js'
import { eventsFor } from './events.js'
import { regionMapUnsound } from './region-map.js'
import { shouldCheckInvariants } from './invariants.js'
import { entitiesInSight, sentOutOfSight, type SightTracker } from './sight.js'
import type { TickReporter } from './tick.js'
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

/** The realms whose residents are among the entities, and the cities among them. */
function realmsSeen(entities: SeenEntity[]): string[] {
  return entities.flatMap((e) => {
    if (e.is === 'resident' && e.owner !== null) return [e.owner]
    return e.is === 'city' ? [e.id] : []
  })
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
  /** The tick of the territory the Region map last went out from; null before any did. */
  regionTick: number | null
  /** The realm's Leader last sent, so a tick sends it only when it changed (Leader handover). */
  leaderId: string
  /** The realm name last sent, null while it has none, so a tick sends it once it is named. */
  realmName: string | null
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
    /** The world's territory as last worked out (`TerritoryTracker`), for the Region map. */
    territory?: { current: Territory | null }
    /**
     * Checks, on the sampled share of ticks, that nothing is sent outside a Player's sight
     * (`sentOutOfSight`), and reports what is.
     */
    sightCheck?: { reporter: TickReporter; sampleRate: number; rand?: () => number }
  },
) {
  const { world } = opts
  const users = new WeakMap<object, SessionUser>()
  const clients = new Map<WebSocket, Client>()

  /** Reports entities about to go to a realm's Player outside their sight, on sampled ticks. */
  function checkSent(realmId: string, sent: SeenEntity[]) {
    const check = opts.sightCheck
    if (!check || !shouldCheckInvariants(check.sampleRate, check.rand)) return
    const violations = sentOutOfSight(world, opts.terrain, realmId, sent)
    if (violations.length > 0) check.reporter.invariantViolations(world, violations)
  }

  /**
   * The Region map to send a client, if any: all of it when territory was worked out again since
   * the last one went out, else the chunks whose explored terrain grew. Checked like `checkSent`.
   */
  function regionFor(client: Client, grown: number[]): RegionMap | undefined {
    const territory = opts.territory?.current
    if (!territory) return undefined
    const fresh = territory.tick !== client.regionTick
    if (!fresh && grown.length === 0) return undefined
    client.regionTick = territory.tick
    const size = opts.terrain.size
    const isExplored = (x: number, y: number) =>
      opts.explored.isExplored({ id: client.userId }, x, y)
    const region = regionMapFor(world, territory, size, isExplored, fresh ? null : grown)
    const check = opts.sightCheck
    if (check && shouldCheckInvariants(check.sampleRate, check.rand)) {
      const violations = regionMapUnsound(region, territory, size, isExplored, client.realmId)
      if (violations.length > 0) check.reporter.invariantViolations(world, violations)
    }
    return region
  }

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

  /** Starts sending a Player with a realm their world: the welcome now, then every tick. */
  function welcome(socket: WebSocket, user: SessionUser, realm: Realm) {
    // Their residents look around before the welcome goes out.
    opts.sight.update(world, opts.explored)
    const client: Client = {
      account: { name: user.name, isAdmin: user.isAdmin },
      userId: user.id,
      realmId: realm.id,
      view: new ClientView(),
      lastEventSeq: 0,
      lastDiplomacy: '',
      regionTick: null,
      leaderId: realm.leaderId,
      realmName: realm.name ?? null,
    }
    clients.set(socket, client)
    // The view starts at the town hall of the realm's first city, or with the Leader if it has
    // none left.
    const city = world.cities.find((c) => c.realmId === realm.id)
    const leader = world.residents.find((r) => r.id === realm.leaderId)
    const start = (city && townHallOf(world, city)) ?? leader ?? { x: 0, y: 0 }
    const [cx, cy] = [start.x, start.y]
    const entities = client.view.initial(entitiesInSight(world, opts.terrain, realm.id))
    checkSent(realm.id, entities)
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
      home: {
        realmId: realm.id,
        leaderId: realm.leaderId,
        realmName: client.realmName,
        cityId: city?.id ?? null,
        x: cx,
        y: cy,
      },
      entities,
      events,
      diplomacy,
      region: regionFor(client, []) ?? null,
    })
  }

  wss.on('connection', (socket, req) => {
    const user = users.get(req)!
    const account = { name: user.name, isAdmin: user.isAdmin }
    // A Player without a realm (first login, or after a Leader death) names it and their Leader
    // before the realm and its starting city are founded (`CONTEXT.md`: Realm name).
    const realm = realmOf(world, user.id)
    if (realm) welcome(socket, user, realm)
    else
      send(socket, { type: 'founding', account, leaderName: suggestedLeaderName(world, user.id) })

    socket.on('message', (raw) => {
      let msg: ClientMessage
      try {
        msg = JSON.parse(String(raw)) as ClientMessage
      } catch {
        return send(socket, { type: 'rejected', requestId: '', reason: 'not JSON' })
      }
      const client = clients.get(socket)
      if (msg?.type === 'found' && !client) {
        const requestId = typeof msg.requestId === 'string' ? msg.requestId : ''
        const problem = foundingProblem(msg.realmName, msg.leaderName)
        if (problem) return send(socket, { type: 'rejected', requestId, reason: problem })
        // Founded from another tab meanwhile: that realm stands, under the names given there.
        const names = { realmName: msg.realmName, leaderName: msg.leaderName }
        const realm =
          realmOf(world, user.id) ?? foundStartingCity(world, opts.terrain, user.id, names)
        return welcome(socket, user, realm)
      }
      if (msg?.type === 'order') {
        const requestId = typeof msg.requestId === 'string' ? msg.requestId : ''
        if (!client) return send(socket, { type: 'rejected', requestId, reason: 'no realm yet' })
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
     * Player's new realm events, and their alliance matters when those changed, and the Region map
     * when territory was worked out again or their explored terrain grew: each Player gets only
     * their own.
     */
    broadcastTick(explored: Map<number, Set<number>> = new Map()) {
      for (const [socket, client] of clients) {
        const inSight = entitiesInSight(world, opts.terrain, client.realmId)
        const { changed, gone } = client.view.diff(inSight)
        checkSent(client.realmId, changed)
        const grown = [...(explored.get(client.userId) ?? [])]
        const events = eventsFor(world, client.userId, client.lastEventSeq)
        client.lastEventSeq = events.at(-1)?.seq ?? client.lastEventSeq
        const diplomacy = diplomacyFor(world, client.realmId, realmsSeen(inSight))
        const json = JSON.stringify(diplomacy)
        const fresh = json === client.lastDiplomacy ? {} : { diplomacy }
        client.lastDiplomacy = json
        const region = regionFor(client, grown)
        const realm = world.realms.find((r) => r.id === client.realmId)
        const leaderId = realm?.leaderId
        const newLeader = leaderId !== undefined && leaderId !== client.leaderId
        if (newLeader) client.leaderId = leaderId
        const realmName = realm?.name ?? null
        const named = realmName !== null && realmName !== client.realmName
        if (named) client.realmName = realmName
        const tick = {
          tick: world.tick,
          changed,
          gone,
          explored: grown,
          events,
          ...fresh,
          ...(region ? { region } : {}),
          ...(newLeader ? { leaderId } : {}),
          ...(named ? { realmName } : {}),
        }
        send(socket, { type: 'tick', ...tick })
      }
    },
    close() {
      for (const socket of clients.keys()) socket.close()
      wss.close()
    },
  }
}
