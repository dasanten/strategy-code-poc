import { useEffect, useState } from 'react'
import { WS_PATH, type MapInfo, type ServerMessage, type Unit } from '@csp/shared'
import { api } from './api.js'

export type ConnectionStatus = 'connecting' | 'open' | 'closed'

/** What the client knows of the world: the map, which chunks it may load and the entities in sight. */
export interface ClientWorld {
  tick: number
  map: MapInfo
  /** Chunks with explored terrain, loaded on demand from `terrainChunkPath`. */
  exploredChunks: ReadonlySet<number>
  units: Unit[]
}

/**
 * Keeps the client's copy of what the Player sees in sync with the server (ADR 0006): the
 * welcome message brings everything in sight, every tick brings changes and ids that left sight.
 * Calls `onLoggedOut` when the session is no longer valid.
 */
export function useWorld(onLoggedOut: () => void) {
  const [world, setWorld] = useState<ClientWorld | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('connecting')

  useEffect(() => {
    let socket: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    let entities = new Map<string, Unit>()

    const connect = () => {
      setStatus('connecting')
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      socket = new WebSocket(`${proto}://${location.host}${WS_PATH}`)
      socket.onopen = () => setStatus('open')
      socket.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string) as ServerMessage
        if (msg.type === 'welcome') {
          entities = new Map(msg.entities.map((e) => [e.id, e]))
          setWorld({
            map: msg.map,
            exploredChunks: new Set(msg.exploredChunks),
            tick: msg.tick,
            units: [...entities.values()],
          })
        } else if (msg.type === 'tick') {
          for (const e of msg.changed) entities.set(e.id, e)
          for (const id of msg.gone) entities.delete(id)
          setWorld((w) => (w ? { ...w, tick: msg.tick, units: [...entities.values()] } : w))
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

  return { world, status }
}
