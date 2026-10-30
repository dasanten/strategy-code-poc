import { useCallback, useEffect, useRef, useState } from 'react'
import {
  WS_CLOSE_TOO_MANY_REQUESTS,
  WS_PATH,
  type SeenBuilding,
  type Army,
  type SeenCarriage,
  type SeenCity,
  type Diplomacy,
  type SeenHorse,
  type MapInfo,
  type OrderRequest,
  type Pile,
  type RealmEvent,
  type SeenResident,
  type SeenCaravan,
  type SeenEntity,
  type Remembered,
  type ScriptLogLine,
  type ScriptMemory,
  type ScriptRunSeen,
  type ServerMessage,
} from '@csp/shared'
import { api } from './api.js'
import { appendEvents } from './realm-log.js'
import { applyRegionMap, type RegionState } from './map/region.js'
import { lastSeenByKind, type LastSeen } from './last-seen.js'

/** `throttled`: the server closed the socket for sending too much; it reconnects after a wait. */
export type ConnectionStatus = 'connecting' | 'open' | 'closed' | 'throttled'

/** How long the client waits to connect again after the server closed it for sending too much. */
const THROTTLED_RETRY_MS = 10_000

/** What the client knows of the world: the map, which chunks it may load and the entities in sight. */
export interface ClientWorld {
  tick: number
  map: MapInfo
  /** Chunks with explored terrain, loaded on demand from `terrainChunkPath`. */
  exploredChunks: ReadonlySet<number>
  /** Chunks whose explored terrain grew in the latest tick; any copy loaded before is stale. */
  grownChunks: readonly number[]
  /** The Player's realm and home city, where the view starts. */
  home: Extract<ServerMessage, { type: 'welcome' }>['home']
  /** What the Player's residents see, by kind (`CONTEXT.md`: Sight). */
  residents: SeenResident[]
  cities: SeenCity[]
  buildings: SeenBuilding[]
  horses: SeenHorse[]
  carriages: SeenCarriage[]
  piles: Pile[]
  /** The Player's own armies (`CONTEXT.md`: Army). */
  armies: Army[]
  /** The Trade Org caravans in sight (`CONTEXT.md`: Caravan). */
  caravans: SeenCaravan[]
  /**
   * What the Player remembers out of their sight (`CONTEXT.md`: Last seen), kept apart from what
   * is in sight: never both at once.
   */
  lastSeen: LastSeen
  /** The Player's realm log, oldest first. */
  events: RealmEvent[]
  /** The Player's alliance, invitations and the realms they could invite. */
  diplomacy: Diplomacy
  /** The Region map over the Player's explored terrain; null until the server has one. */
  region: RegionState | null
  /** Whether the Player may still claim their Horse offer (`CONTEXT.md`: Horse offer). */
  horseOffer: boolean
}

/** Sorts what is in sight by kind, dropping the tag. */
function byKind(entities: Iterable<SeenEntity>) {
  const out = {
    residents: [] as SeenResident[],
    cities: [] as SeenCity[],
    buildings: [] as SeenBuilding[],
    horses: [] as SeenHorse[],
    carriages: [] as SeenCarriage[],
    piles: [] as Pile[],
    armies: [] as Army[],
    caravans: [] as SeenCaravan[],
  }
  for (const { is, ...e } of entities) {
    if (is === 'resident') out.residents.push(e as SeenResident)
    else if (is === 'city') out.cities.push(e as SeenCity)
    else if (is === 'building') out.buildings.push(e as SeenBuilding)
    else if (is === 'horse') out.horses.push(e as SeenHorse)
    else if (is === 'carriage') out.carriages.push(e as SeenCarriage)
    else if (is === 'army') out.armies.push(e as Army)
    else if (is === 'caravan') out.caravans.push(e as SeenCaravan)
    else out.piles.push(e as Pile)
  }
  return out
}

/** Tells the server which scripts the Player watches now (`watchScript`). */
function sendWatch(socket: WebSocket | null, watched: ReadonlyMap<string, number>) {
  if (socket?.readyState !== WebSocket.OPEN) return
  socket.send(JSON.stringify({ type: 'watch', ids: [...watched.keys()] }))
}

/**
 * Keeps the client's copy of what the Player sees in sync with the server (ADR 0006): the
 * welcome message brings everything in sight, the Player's Last seen and the realm log, every
 * tick brings changes, ids that left sight, changes to Last seen and new realm events.
 * Calls `onLoggedOut` when the session is no longer valid.
 */
export function useWorld(onLoggedOut: () => void) {
  const [world, setWorld] = useState<ClientWorld | null>(null)
  // Set while the Player has no realm and is to name it: the Leader's name from the game.
  const [founding, setFounding] = useState<{ leaderName: string } | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const socketRef = useRef<WebSocket | null>(null)
  const answers = useRef(new Map<string, (rejected: string | undefined) => void>())
  // The residents and armies whose Script tab is open, with how many cards show it, and the
  // memory the server last sent of each one's script and how it last ran (`CONTEXT.md`:
  // Debugging a script), and of each resident's script log (Script log).
  const watched = useRef(new Map<string, number>())
  const [memories, setMemories] = useState<ReadonlyMap<string, ScriptMemory | null>>(new Map())
  const [runs, setRuns] = useState<ReadonlyMap<string, ScriptRunSeen | null>>(new Map())
  const [scriptLogs, setScriptLogs] = useState<ReadonlyMap<string, ScriptLogLine[] | null>>(
    new Map(),
  )

  useEffect(() => {
    let socket: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    let entities = new Map<string, SeenEntity>()
    let remembered = new Map<string, Remembered>()

    const connect = () => {
      setStatus('connecting')
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      socket = new WebSocket(`${proto}://${location.host}${WS_PATH}`)
      socketRef.current = socket
      socket.onopen = () => setStatus('open')
      socket.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string) as ServerMessage
        if (msg.type === 'founding') {
          setWorld(null)
          setFounding({ leaderName: msg.leaderName })
        } else if (msg.type === 'welcome') {
          setFounding(null)
          // The founding request, if one was waiting, succeeded.
          for (const [id, answer] of answers.current) {
            if (id.startsWith('found-')) {
              answers.current.delete(id)
              answer(undefined)
            }
          }
          entities = new Map(msg.entities.map((e) => [e.id, e]))
          remembered = new Map(msg.lastSeen.map((e) => [e.id, e]))
          setWorld({
            map: msg.map,
            exploredChunks: new Set(msg.exploredChunks),
            grownChunks: [],
            home: msg.home,
            tick: msg.tick,
            events: msg.events,
            diplomacy: msg.diplomacy,
            region: msg.region && applyRegionMap(null, msg.region, msg.map.size),
            horseOffer: msg.horseOffer,
            ...byKind(entities.values()),
            lastSeen: lastSeenByKind(remembered.values()),
          })
          if (watched.current.size > 0) sendWatch(socket, watched.current)
        } else if (msg.type === 'scriptMemory') {
          if (!watched.current.has(msg.id)) return
          setMemories((m) => new Map(m).set(msg.id, msg.memory))
        } else if (msg.type === 'scriptRun') {
          if (!watched.current.has(msg.id)) return
          setRuns((m) => new Map(m).set(msg.id, msg.run))
        } else if (msg.type === 'scriptLog') {
          if (!watched.current.has(msg.id)) return
          setScriptLogs((m) => new Map(m).set(msg.id, msg.lines))
        } else if (msg.type === 'ack' || msg.type === 'rejected') {
          const answer = answers.current.get(msg.requestId)
          answers.current.delete(msg.requestId)
          answer?.(msg.type === 'rejected' ? msg.reason : undefined)
        } else if (msg.type === 'tick') {
          for (const e of msg.changed) entities.set(e.id, e)
          for (const id of msg.gone) entities.delete(id)
          const changed = msg.changed.length > 0 || msg.gone.length > 0
          for (const e of msg.lastSeen?.changed ?? []) remembered.set(e.id, e)
          for (const id of msg.lastSeen?.gone ?? []) remembered.delete(id)
          setWorld((w) => {
            if (!w) return w
            const grown = msg.explored
            const exploredChunks =
              grown.length > 0 ? new Set([...w.exploredChunks, ...grown]) : w.exploredChunks
            const seen = changed ? byKind(entities.values()) : {}
            const lastSeen = msg.lastSeen ? { lastSeen: lastSeenByKind(remembered.values()) } : {}
            const events = appendEvents(w.events, msg.events)
            const diplomacy = msg.diplomacy ?? w.diplomacy
            const region = msg.region ? applyRegionMap(w.region, msg.region, w.map.size) : w.region
            return {
              ...w,
              ...seen,
              ...lastSeen,
              home: {
                ...w.home,
                ...(msg.leaderId ? { leaderId: msg.leaderId } : {}),
                ...(msg.realmName ? { realmName: msg.realmName } : {}),
              },
              tick: msg.tick,
              exploredChunks,
              grownChunks: grown,
              events,
              diplomacy,
              region,
              horseOffer: msg.horseOffer ?? w.horseOffer,
            }
          })
        }
      }
      socket.onclose = (ev) => {
        if (stopped) return setStatus('closed')
        // The server closed it for sending too much: wait before trying again.
        if (ev.code === WS_CLOSE_TOO_MANY_REQUESTS) {
          setStatus('throttled')
          retry = setTimeout(connect, THROTTLED_RETRY_MS)
          return
        }
        setStatus('closed')
        // A refused socket looks like any other close; ask the API whether we're still logged in.
        api.me().then(
          () => {
            if (!stopped) retry = setTimeout(connect, 2000)
          },
          (err: { code?: string }) => {
            if (err.code === 'not-logged-in') onLoggedOut()
            else if (!stopped) retry = setTimeout(connect, 2000)
          },
        )
      }
    }
    connect()

    return () => {
      stopped = true
      clearTimeout(retry)
      socket?.close()
    }
  }, [onLoggedOut])

  /**
   * Watches the script memory of a resident or army while its Script tab is open (`memories`),
   * and a resident's script log (`scriptLogs`); the function it returns stops watching it.
   */
  const watchScript = useCallback((id: string) => {
    const count = watched.current.get(id) ?? 0
    watched.current.set(id, count + 1)
    if (count === 0) sendWatch(socketRef.current, watched.current)
    return () => {
      const left = (watched.current.get(id) ?? 1) - 1
      if (left > 0) return void watched.current.set(id, left)
      watched.current.delete(id)
      sendWatch(socketRef.current, watched.current)
      const without = <T>(m: ReadonlyMap<string, T>) => {
        const next = new Map(m)
        next.delete(id)
        return next
      }
      setMemories(without)
      setRuns(without)
      setScriptLogs(without)
    }
  }, [])

  /**
   * Sends an order (ADR 0002). Resolves with the server's reason when it is rejected, or
   * undefined once it is accepted; it takes effect from the next tick.
   */
  const sendOrder = useCallback((order: OrderRequest): Promise<string | undefined> => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.resolve('not connected')
    }
    const requestId = crypto.randomUUID()
    return new Promise((resolve) => {
      answers.current.set(requestId, resolve)
      socket.send(JSON.stringify({ type: 'order', requestId, order }))
    })
  }, [])

  /**
   * Founds the Player's realm with these names (`CONTEXT.md`: Realm name). Resolves with the
   * server's reason when it is refused, or undefined once the world arrives.
   */
  const found = useCallback((realmName: string, leaderName: string) => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.resolve<string | undefined>('not connected')
    }
    const requestId = `found-${crypto.randomUUID()}`
    return new Promise<string | undefined>((resolve) => {
      answers.current.set(requestId, resolve)
      socket.send(JSON.stringify({ type: 'found', requestId, realmName, leaderName }))
    })
  }, [])

  return { world, founding, status, sendOrder, found, memories, runs, scriptLogs, watchScript }
}
