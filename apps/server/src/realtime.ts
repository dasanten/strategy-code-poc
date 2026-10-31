import type { IncomingMessage, Server } from 'node:http'
import { fastifyCookie } from '@fastify/cookie'
import { WebSocket, WebSocketServer } from 'ws'
import {
  SCRIPT_WATCH_MAX,
  SESSION_COOKIE,
  WS_CLOSE_LOGGED_OUT,
  WS_CLOSE_TOO_MANY_REQUESTS,
  WS_PATH,
  commanderOf,
  diplomacyFor,
  foundingProblem,
  regionMapFor,
  townHallOf,
  type Account,
  type ClientMessage,
  type Realm,
  type RegionMap,
  type Remembered,
  type ScriptLogLine,
  type ScriptMemory,
  type ScriptRunSeen,
  type SeenEntity,
  type ServerMessage,
  type TerrainMap,
  type Territory,
  type WorldState,
} from '@csp/shared'
import { getSessionUser, hashToken, sessionAlive, type SessionUser } from './auth.js'
import { config } from './config.js'
import type { Db } from './db/index.js'
import type { ExploredTerrain } from './explored.js'
import type { Logger } from './log.js'
import type { OrderQueue } from './orders.js'
import { foundStartingCity, realmOf, suggestedLeaderName } from './starting-city.js'
import { eventsFor } from './events.js'
import { regionMapUnsound } from './region-map.js'
import { shouldCheckInvariants } from './invariants.js'
import {
  entitiesInSight,
  sentInsideUnseen,
  sentOutOfSight,
  withSight,
  type SightTracker,
} from './sight.js'
import type { TickReporter } from './tick.js'
import { ClientView } from './sync.js'
import { lastSeenInSight, lastSeenOutOfSight } from './last-seen.js'

/**
 * The session token in an upgrade request's cookie header, read as the HTTP routes read theirs
 * (`@fastify/cookie`). A value that is not valid percent-encoding is kept as sent, so it matches
 * no session; decoding it ourselves threw in the `upgrade` event, where nothing catches, and
 * ended the process (#512).
 */
function sessionToken(header: string | undefined): string | undefined {
  return header ? fastifyCookie.parse(header)[SESSION_COOKIE] : undefined
}

function send(socket: WebSocket, msg: ServerMessage) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg))
}

/** Which browsers may open the WebSocket (`config.origins`). */
export interface OriginPolicy {
  /** Origins let in besides the request's own host, such as `https://game.example.com`. */
  allowed: string[]
  /** Whether a request without an Origin header, which no browser sends, is let in. */
  allowMissing: boolean
}

/**
 * Whether a WebSocket upgrade comes from a page the game may be played from: one of the allowed
 * origins, or the request's own host, which is the game's domain as Caddy forwards it in
 * production and the server itself in development. Any other page's socket is refused, so a
 * site a Player's browser also has open can't play as them with their cookie.
 */
export function originAllowed(req: IncomingMessage, policy: OriginPolicy): boolean {
  const origin = req.headers.origin
  if (origin === undefined) return policy.allowMissing
  if (policy.allowed.includes(origin)) return true
  let host: string
  try {
    host = new URL(origin).host
  } catch {
    return false
  }
  return host !== '' && host === req.headers.host
}

/** What one client may do (`config.realtime`). */
export type RealtimeLimits = typeof config.realtime

/**
 * A socket's allowance of messages: it holds up to `messageBurst` and earns `messagesPerSecond`
 * back, each message spending one.
 */
class TokenBucket {
  private tokens: number
  private last: number

  constructor(
    private limits: Pick<RealtimeLimits, 'messageBurst' | 'messagesPerSecond'>,
    private now: () => number,
  ) {
    this.tokens = limits.messageBurst
    this.last = now()
  }

  /** Spends one for a message; false when none is left. */
  take(): boolean {
    const now = this.now()
    const earned = ((now - this.last) / 1000) * this.limits.messagesPerSecond
    this.tokens = Math.min(this.limits.messageBurst, this.tokens + earned)
    this.last = now
    if (this.tokens < 1) return false
    this.tokens -= 1
    return true
  }
}

/**
 * How often each client's session is checked again after the handshake, so a session that
 * expired, or was deleted some other way than logout or a reset, ends its sockets within that.
 */
export const SESSION_RECHECK_MS = 60_000

/** A connected socket's session: what it is closed by when the session ends. */
interface Session {
  tokenHash: string
  userId: number
}

/** The realms whose residents are among the entities, and the cities among them. */
function realmsSeen(entities: readonly SeenEntity[]): string[] {
  return entities.flatMap((e) => {
    if (e.is === 'resident' && e.owner !== null) return [e.owner]
    return e.is === 'city' ? [e.id] : []
  })
}

/** The script a resident or army runs for the realm, if any (`CONTEXT.md`: Debugging a script). */
function runningScriptFor(world: WorldState, realmId: string, id: string) {
  const r = world.residents.find((r) => r.id === id)
  if (r) return (commanderOf(world, r) === realmId && r.script) || null
  const army = world.armies.find((a) => a.id === id)
  return (army?.realmId === realmId && army.script) || null
}

/**
 * The memory of the script a resident or army runs, for the realm running it (`CONTEXT.md`:
 * Debugging a script): null when it runs none, or another realm runs it.
 */
export function scriptMemoryFor(
  world: WorldState,
  realmId: string,
  id: string,
): ScriptMemory | null {
  return runningScriptFor(world, realmId, id)?.memory ?? null
}

/**
 * How the script a resident or army runs last ran, for the realm running it (`CONTEXT.md`:
 * Debugging a script): its last runtime error and the steps it used; null as `scriptMemoryFor`.
 */
export function scriptRunFor(world: WorldState, realmId: string, id: string): ScriptRunSeen | null {
  const running = runningScriptFor(world, realmId, id)
  if (!running) return null
  const { lastError, lastRun } = running
  return { ...(lastError ? { lastError } : {}), ...(lastRun ? { lastRun } : {}) }
}

/**
 * A resident's script log, for the realm owning them (`CONTEXT.md`: Script log): null for anyone
 * else's resident, or an army.
 */
export function scriptLogFor(
  world: WorldState,
  realmId: string,
  id: string,
): ScriptLogLine[] | null {
  const r = world.residents.find((r) => r.id === id)
  return r?.owner === realmId ? (r.scriptLog ?? []) : null
}

interface Client {
  account: Account
  userId: number
  realmId: string
  /**
   * The residents and armies whose Script tab the Player has open, with what was last sent for
   * each as JSON (its script's memory, how it last ran, and a resident's script log), so a tick
   * sends each only when it changed.
   */
  watching: Map<string, { memory: string; run: string; log: string }>
  view: ClientView
  /** What has been sent of the Player's Last seen out of sight (`CONTEXT.md`: Last seen). */
  lastSeenView: ClientView<Remembered>
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
  /** Whether the Player could still claim their Horse offer when last sent (`CONTEXT.md`). */
  horseOffer: boolean
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
     * (`sentOutOfSight`) and nothing from inside they may not see (`sentInsideUnseen`), and
     * reports what is.
     */
    sightCheck?: { reporter: TickReporter; sampleRate: number; rand?: () => number }
    /** Where an upgrade refused for an unexpected error is logged. */
    logger?: Pick<Logger, 'error'>
    /**
     * Told of an error that escaped a client's message handler, such as a bug in one order kind's
     * check (ADR 0004). The message is answered `rejected` and the socket stays open either way.
     */
    onError?: (error: unknown, userId: number) => void
    /** Which browsers may connect; the server's config by default. */
    origins?: OriginPolicy
    /** What one client may do; the server's config by default. */
    limits?: Partial<RealtimeLimits>
    /** The clock the message allowance runs on, for tests. */
    now?: () => number
  },
) {
  const { world } = opts
  const origins = opts.origins ?? config.origins
  const limits = { ...config.realtime, ...opts.limits }
  const now = opts.now ?? Date.now
  const users = new WeakMap<object, { user: SessionUser; session: Session }>()
  /** Every connected socket, whether or not its Player has a realm yet. */
  const sessions = new Map<WebSocket, Session>()
  const clients = new Map<WebSocket, Client>()
  let lastSessionCheck = Date.now()

  /** How many sockets an account holds open, with or without a realm (the connection cap). */
  function socketsOf(userId: number): number {
    let n = 0
    for (const session of sessions.values()) if (session.userId === userId) n++
    return n
  }

  /** Closes a socket because its session ended; the client shows the login screen. */
  function endSession(socket: WebSocket) {
    sessions.delete(socket)
    clients.delete(socket)
    socket.close(WS_CLOSE_LOGGED_OUT, 'logged out')
  }

  /** Closes the sockets whose session is gone or expired, at most once in `SESSION_RECHECK_MS`. */
  function recheckSessions(now: number) {
    if (now - lastSessionCheck < SESSION_RECHECK_MS) return
    lastSessionCheck = now
    for (const [socket, session] of sessions) {
      if (!sessionAlive(opts.db, session.tokenHash, now)) endSession(socket)
    }
  }

  /** Reports entities about to go to a realm's Player outside their sight, on sampled ticks. */
  function checkSent(realmId: string, sent: SeenEntity[]) {
    const check = opts.sightCheck
    if (!check || !shouldCheckInvariants(check.sampleRate, check.rand)) return
    const violations = [
      ...sentOutOfSight(world, opts.terrain, realmId, sent),
      ...sentInsideUnseen(world, opts.terrain, realmId, sent),
    ]
    if (violations.length > 0) check.reporter.invariantViolations(world, violations)
  }

  /** Reports Last seen about to go to a realm's Player that is in their sight, as `checkSent`. */
  function checkLastSeen(realmId: string, sent: Remembered[]) {
    const check = opts.sightCheck
    if (!check || sent.length === 0 || !shouldCheckInvariants(check.sampleRate, check.rand)) return
    const violations = lastSeenInSight(world, opts.terrain, realmId, sent)
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

  /**
   * Sends the client the memory of each script it watches, and how it last ran, where they
   * changed since they were last sent.
   */
  function sendScriptMemory(socket: WebSocket, client: Client) {
    for (const [id, last] of client.watching) {
      const memory = scriptMemoryFor(world, client.realmId, id)
      const memoryJson = JSON.stringify(memory)
      if (memoryJson !== last.memory) {
        last.memory = memoryJson
        send(socket, { type: 'scriptMemory', id, memory })
      }
      const run = scriptRunFor(world, client.realmId, id)
      const runJson = JSON.stringify(run)
      if (runJson !== last.run) {
        last.run = runJson
        send(socket, { type: 'scriptRun', id, run })
      }
    }
  }

  /** Sends the client the script log of each resident it watches that changed since last sent. */
  function sendScriptLogs(socket: WebSocket, client: Client) {
    for (const id of client.watching.keys()) {
      const lines = scriptLogFor(world, client.realmId, id)
      const json = JSON.stringify(lines)
      const last = client.watching.get(id)!
      if (json === last.log) continue
      last.log = json
      send(socket, { type: 'scriptLog', id, lines })
    }
  }

  const wss = new WebSocketServer({
    server,
    path: WS_PATH,
    // A larger frame closes the socket (1009) before it is buffered whole or parsed.
    maxPayload: limits.maxPayloadBytes,
    // Runs in the HTTP `upgrade` event, where an uncaught error ends the process: whatever goes
    // wrong refuses this one upgrade, and the server keeps serving the next (#512).
    verifyClient: ({ req }, done) => {
      try {
        if (!originAllowed(req, origins)) return done(false, 403, 'Origin not allowed')
        const token = sessionToken(req.headers.cookie)
        const user = getSessionUser(opts.db, token)
        if (!user || !token) return done(false, 401, 'Not logged in')
        if (socketsOf(user.id) >= limits.connectionsPerUser) {
          return done(false, 429, 'Too many connections')
        }
        users.set(req, { user, session: { tokenHash: hashToken(token), userId: user.id } })
        done(true)
      } catch (err) {
        opts.logger?.error({ err }, 'WebSocket upgrade refused: unexpected error')
        done(false, 400, 'Bad request')
      }
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
      watching: new Map(),
      view: new ClientView(),
      lastSeenView: new ClientView<Remembered>(),
      lastEventSeq: 0,
      lastDiplomacy: '',
      regionTick: null,
      leaderId: realm.leaderId,
      realmName: realm.name ?? null,
      horseOffer: !world.horseOffersClaimed.includes(user.id),
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
    const lastSeen = client.lastSeenView.initial(lastSeenOutOfSight(world, user.id))
    checkLastSeen(realm.id, lastSeen)
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
      lastSeen,
      events,
      diplomacy,
      region: regionFor(client, []) ?? null,
      horseOffer: client.horseOffer,
    })
  }

  wss.on('connection', (socket, req) => {
    const { user, session } = users.get(req)!
    sessions.set(socket, session)
    const account = { name: user.name, isAdmin: user.isAdmin }
    const allowance = new TokenBucket(limits, now)
    // A frame over `maxPayload` (or a bad one) is an error on the socket; it closes on its own,
    // and without a listener the error would take the server down.
    socket.on('error', () => {})
    // A Player without a realm (first login, or after a Leader death) names it and their Leader
    // before the realm and its starting city are founded (`CONTEXT.md`: Realm name).
    const realm = realmOf(world, user.id)
    if (realm) welcome(socket, user, realm)
    else
      send(socket, { type: 'founding', account, leaderName: suggestedLeaderName(world, user.id) })

    socket.on('message', (raw) => {
      if (!allowance.take()) return socket.close(WS_CLOSE_TOO_MANY_REQUESTS, 'Too many requests')
      let msg: ClientMessage
      try {
        msg = JSON.parse(String(raw)) as ClientMessage
      } catch {
        return send(socket, { type: 'rejected', requestId: '', reason: 'not JSON' })
      }
      try {
        handle(socket, msg)
      } catch (error) {
        // An exception here would otherwise escape the socket's emitter and end the process, and
        // any logged-in Player can send any message: one bug must not take the game down.
        opts.onError?.(error, user.id)
        const { requestId } = (msg ?? {}) as { requestId?: unknown }
        send(socket, {
          type: 'rejected',
          requestId: typeof requestId === 'string' ? requestId : '',
          reason: 'server error',
        })
      }
    })
    socket.on('close', () => {
      sessions.delete(socket)
      clients.delete(socket)
    })

    /** Answers one message from a logged-in client. */
    function handle(socket: WebSocket, msg: ClientMessage) {
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
        // A realm's orders waiting for the next tick are capped, so no script in a browser
        // console can pile up more than a tick works through.
        if (opts.orders.pendingFor(client.userId) >= limits.pendingOrdersPerRealm) {
          return send(socket, { type: 'rejected', requestId, reason: 'too many orders waiting' })
        }
        const sender = { userId: client.userId, account: client.account }
        send(socket, opts.orders.receive(world, sender, msg.requestId, msg.order))
      }
      if (msg?.type === 'watch' && client && Array.isArray(msg.ids)) {
        const ids = msg.ids.filter((id) => typeof id === 'string').slice(0, SCRIPT_WATCH_MAX)
        // Newly watched ones go out now; those still watched only when they change.
        client.watching = new Map(
          ids.map((id) => [id, client.watching.get(id) ?? { memory: '', run: '', log: '' }]),
        )
        sendScriptMemory(socket, client)
        sendScriptLogs(socket, client)
      }
    }
  })

  return {
    /** Closes the sockets of one session: called when it is logged out. */
    disconnectSession(tokenHash: string) {
      for (const [socket, session] of sessions) {
        if (session.tokenHash === tokenHash) endSession(socket)
      }
    },
    /** Closes every socket of an account: called when a password reset ends all its sessions. */
    disconnectUser(userId: number) {
      for (const [socket, session] of sessions) {
        if (session.userId === userId) endSession(socket)
      }
    },
    /**
     * Sends every client the changes in its sight since the last tick, and the chunks whose
     * explored terrain grew for its Player (`explored`, from `SightTracker.update`), and its
     * Player's new realm events, and their alliance matters when those changed, and the Region map
     * when territory was worked out again or their explored terrain grew: each Player gets only
     * their own. First, once a minute, the sockets whose session ended meanwhile are closed. What a
     * realm sees is worked out once and shared by its sockets (`SightCache`).
     */
    broadcastTick(explored: Map<number, Set<number>> = new Map(), now = Date.now()) {
      recheckSessions(now)
      withSight(world, opts.terrain.size, () => sendTicks(explored))
    },
    close() {
      for (const socket of clients.keys()) socket.close()
      wss.close()
    },
  }

  /** The tick message to each socket, as `broadcastTick` says. */
  function sendTicks(explored: Map<number, Set<number>>) {
    for (const [socket, client] of clients) {
      const inSight = entitiesInSight(world, opts.terrain, client.realmId)
      const { changed, gone } = client.view.diff(inSight)
      checkSent(client.realmId, changed)
      const remembered = client.lastSeenView.diff(lastSeenOutOfSight(world, client.userId))
      checkLastSeen(client.realmId, remembered.changed)
      const lastSeen =
        remembered.changed.length > 0 || remembered.gone.length > 0 ? { lastSeen: remembered } : {}
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
      const claimed = client.horseOffer && world.horseOffersClaimed.includes(client.userId)
      if (claimed) client.horseOffer = false
      const tick = {
        tick: world.tick,
        changed,
        gone,
        ...lastSeen,
        explored: grown,
        events,
        ...fresh,
        ...(region ? { region } : {}),
        ...(newLeader ? { leaderId } : {}),
        ...(named ? { realmName } : {}),
        ...(claimed ? { horseOffer: false as const } : {}),
      }
      send(socket, { type: 'tick', ...tick })
      sendScriptMemory(socket, client)
      sendScriptLogs(socket, client)
    }
  }
}
