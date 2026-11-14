import { useEffect, useRef, useState } from 'react'
import type { MapInfo } from '@csp/shared-types'
import { api } from './api.js'
import { applyLand, type LandState } from './map/land.js'

/** How long the client gathers the chunks whose explored terrain grew before loading their land. */
const LAND_REFRESH_MS = 3_000

/**
 * The land the Player knows (`CONTEXT.md`: Region), loaded from `LAND_PATH`: all of it with each
 * welcome (a new `map`), then the chunks whose explored terrain grew, a few seconds' worth at a
 * time. Null until the first load.
 */
export function useLand(
  map: MapInfo | undefined,
  grownChunks: readonly number[] | undefined,
): LandState | null {
  const [land, setLand] = useState<LandState | null>(null)
  const pending = useRef(new Set<number>())
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const size = map?.size

  useEffect(() => {
    setLand(null)
    pending.current.clear()
    if (!map) return
    let live = true
    api.land().then(
      (l) => live && setLand(applyLand(null, l, map.size)),
      () => {},
    )
    return () => {
      live = false
      clearTimeout(timer.current)
      timer.current = undefined
    }
  }, [map])

  useEffect(() => {
    if (!grownChunks?.length || size === undefined) return
    for (const c of grownChunks) pending.current.add(c)
    if (timer.current !== undefined) return
    timer.current = setTimeout(() => {
      timer.current = undefined
      const chunks = [...pending.current]
      pending.current.clear()
      api.land(chunks).then(
        (l) => setLand((s) => applyLand(s, l, size)),
        () => {},
      )
    }, LAND_REFRESH_MS)
  }, [grownChunks, size])

  return land
}
