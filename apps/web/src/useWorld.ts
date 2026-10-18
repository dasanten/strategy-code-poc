import { useCallback, useEffect, useRef, useState } from 'react'
import {
  WS_PATH,
  type Building,
  type Carriage,
  type City,
  type Horse,
  type MapInfo,
  type OrderRequest,
  type Pile,
  type RealmEvent,
  type Resident,
  type SeenEntity,
  type ServerMessage,
} from '@csp/shared'
import { api } from './api.js'
import { appendEvents } from './realm-log.js'

export type ConnectionStatus = 'connecting' | 'open' | 'closed'

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
  residents: Resident[]
  cities: City[]
  buildings: Building[]
  horses: Horse[]
  carriages: Carriage[]
  piles: Pile[]
  /** The Player's realm log, oldest first. */
  events: RealmEvent[]
}

/** Sorts what is in sight by kind, dropping the tag. */
function byKind(entities: Iterable<SeenEntity>) {
  const out = {
    residents: [] as Resident[],
    cities: [] as City[],
    buildings: [] as Building[],
    horses: [] as Horse[],
    carriages: [] as Carriage[],
    piles: [] as Pile[],
  }
  for (const { is, ...e } of entities) {
    if (is === 'resident') out.residents.push(e as Resident)
    else if (is === 'city') out.cities.push(e as City)
    else if (is === 'building') out.buildings.push(e as Building)
    else if (is === 'horse') out.horses.push(e as Horse)
    else if (is === 'carriage') out.carriages.push(e as Carriage)
    else out.piles.push(e as Pile)
  }
  return out
}

/**
 * Keeps the client's copy of what the Player sees in sync with the server (ADR 0006): the
 * welcome message brings everything in sight and the realm log, every tick brings changes, ids
 * that left sight and new realm events.
 * Calls `onLoggedOut` when the session is no longer valid.
 */
export function useWorld(onLoggedOut: () => void) {
  const [world, setWorld] = useState<ClientWorld | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const socketRef = useRef<WebSocket | null>(null)
  const answers = useRef(new Map<string, (rejected: string | undefined) => void>())

  useEffect(() => {
    let socket: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    let entities = new Map<string, SeenEntity>()

    const connect = () => {
      setStatus('connecting')
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      socket = new WebSocket(`${proto}://${location.host}${WS_PATH}`)
      socketRef.current = socket
      socket.onopen = () => setStatus('open')
      socket.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string) as ServerMessage
        if (msg.type === 'welcome') {
          entities = new Map(msg.entities.map((e) => [e.id, e]))
          setWorld({
            map: msg.map,
            exploredChunks: new Set(msg.exploredChunks),
            grownChunks: [],
            home: msg.home,
            tick: msg.tick,
            events: msg.events,
            ...byKind(entities.values()),
          })
        } else if (msg.type === 'ack' || msg.type === 'rejected') {
          const answer = answers.current.get(msg.requestId)
          answers.current.delete(msg.requestId)
          answer?.(msg.type === 'rejected' ? msg.reason : undefined)
        } else if (msg.type === 'tick') {
          for (const e of msg.changed) entities.set(e.id, e)
          for (const id of msg.gone) entities.delete(id)
          const changed = msg.changed.length > 0 || msg.gone.length > 0
          setWorld((w) => {
            if (!w) return w
            const grown = msg.explored
            const exploredChunks =
              grown.length > 0 ? new Set([...w.exploredChunks, ...grown]) : w.exploredChunks
            const seen = changed ? byKind(entities.values()) : {}
            const events = appendEvents(w.events, msg.events)
            return { ...w, ...seen, tick: msg.tick, exploredChunks, grownChunks: grown, events }
          })
        }
      }
      socket.onclose = () => {
        setStatus('closed')
        if (stopped) return
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

  return { world, status, sendOrder }
}
