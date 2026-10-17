import { useEffect, useState } from 'react'
import { WS_PATH, type ServerMessage, type WorldState } from '@csp/shared'

export type ConnectionStatus = 'connecting' | 'open' | 'closed'

/** Keeps a local copy of the world in sync with the server's tick stream. */
export function useWorld() {
  const [world, setWorld] = useState<WorldState | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('connecting')

  useEffect(() => {
    let socket: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let stopped = false

    const connect = () => {
      setStatus('connecting')
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      socket = new WebSocket(`${proto}://${location.host}${WS_PATH}`)
      socket.onopen = () => setStatus('open')
      socket.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string) as ServerMessage
        if (msg.type === 'welcome') setWorld(msg.world)
        else setWorld((w) => (w ? { ...w, tick: msg.tick, units: msg.units } : w))
      }
      socket.onclose = () => {
        setStatus('closed')
        if (!stopped) retry = setTimeout(connect, 2000)
      }
    }
    connect()

    return () => {
      stopped = true
      clearTimeout(retry)
      socket?.close()
    }
  }, [])

  return { world, status }
}
