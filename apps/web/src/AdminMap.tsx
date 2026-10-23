import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  adminTerrainChunkPath,
  type AdminPlaces,
  type AdminWorldView,
  type MapInfo,
} from '@csp/shared'
import { api, ApiFailure } from './api.js'
import {
  ADMIN_MAP_REFRESH_MS,
  ADMIN_MAP_SETTLE_MS,
  ADMIN_TERRITORY_REFRESH_MS,
  adminMapWorld,
  adminViewRequest,
  mapViewSearch,
  parseMapView,
} from './admin-map.js'
import { jumpScale, type JumpEntry, type JumpKind } from './admin-jump.js'
import { AdminJumpList } from './AdminJumpList.js'
import { MapView } from './MapView.js'
import type { Camera, Size } from './map/camera.js'
import { applyRegionMap, type RegionState } from './map/region.js'

/** Jump list entries that are cities: the far tier rings their emblem. */
const JUMP_CITY_KINDS: ReadonlySet<JumpKind> = new Set(['city', 'npcCity', 'hq', 'post'])

/**
 * The admin panel's Map tab (`CONTEXT.md`: admin map): the whole world on the game's map, the
 * part in view loaded again every few seconds and whenever the view moves. Its view is kept in
 * the URL (`search`, reported back through `onSearch`), so a link lands on the same spot. The
 * jump list beside it centres the map on a place by name. Nothing on it gives orders.
 */
export function AdminMap({
  search,
  onSearch,
}: {
  search: string
  onSearch: (search: string) => void
}) {
  const [map, setMap] = useState<MapInfo | null>(null)
  const [overview, setOverview] = useState<Uint8Array | null>(null)
  const [view, setView] = useState<AdminWorldView | null>(null)
  const [places, setPlaces] = useState<AdminPlaces | null>(null)
  const [region, setRegion] = useState<RegionState | null>(null)
  const [error, setError] = useState<string>()
  const report = useCallback(
    (err: unknown) => setError(err instanceof ApiFailure ? err.message : 'Something went wrong.'),
    [],
  )
  const searchRef = useRef(search)
  const onSearchRef = useRef(onSearch)
  onSearchRef.current = onSearch

  useEffect(() => {
    api.adminMap().then(setMap, report)
    api.adminOverview().then(setOverview, report)
  }, [report])

  // Territory moves once a game hour; it may not be worked out yet just after the server starts.
  useEffect(() => {
    if (!map) return
    const load = () =>
      api.adminTerritory().then(
        (r) => setRegion(applyRegionMap(null, r, map.size)),
        () => {},
      )
    void load()
    const timer = setInterval(load, ADMIN_TERRITORY_REFRESH_MS)
    return () => clearInterval(timer)
  }, [map])

  // The view in place, and which load is the latest, so a slow answer never shows over a newer one.
  const camRef = useRef<{ cam: Camera; size: Size } | null>(null)
  const loadRef = useRef(0)
  const refresh = useCallback(() => {
    const at = camRef.current
    if (!map || !at) return
    const n = ++loadRef.current
    Promise.all([api.adminWorld(adminViewRequest(at.cam, at.size, map.size)), api.adminPlaces()])
      .then(([v, p]) => {
        if (n !== loadRef.current) return
        setView(v)
        setPlaces(p)
        setError(undefined)
      })
      .catch(report)
  }, [map, report])

  useEffect(() => {
    const timer = setInterval(refresh, ADMIN_MAP_REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh])

  // Once the view rests: load what is in it and put it in the URL.
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(settle.current), [])
  const onView = useCallback(
    (cam: Camera, size: Size) => {
      camRef.current = { cam, size }
      clearTimeout(settle.current)
      settle.current = setTimeout(() => {
        refresh()
        const next = mapViewSearch(cam)
        if (next !== searchRef.current) {
          searchRef.current = next
          onSearchRef.current(next)
        }
      }, ADMIN_MAP_SETTLE_MS)
    },
    [refresh],
  )

  // A place picked from the jump list: the map centres on it and rings it.
  const [jumped, setJumped] = useState<JumpEntry>()
  const [focus, setFocus] = useState<{ x: number; y: number; scale: number }>()
  const onJump = useCallback((e: JumpEntry) => {
    if (!e.at) return
    setJumped(e)
    setFocus({ ...e.at, scale: jumpScale(e.kind) })
  }, [])

  const start = useMemo(() => map && parseMapView(searchRef.current, map.size), [map])
  const world = useMemo(
    () => map && adminMapWorld({ map, view, places, region, overview }),
    [map, view, places, region, overview],
  )

  return (
    <div className="admin-map">
      <AdminJumpList places={places} selectedKey={jumped?.key} onJump={onJump} />
      <div className="admin-map-area">
        {world && start ? (
          <MapView
            world={world}
            terrainPath={adminTerrainChunkPath}
            start={start}
            onView={onView}
            focus={focus}
            selectedId={jumped?.kind === 'leader' ? jumped.id : undefined}
            selectedCityId={jumped && JUMP_CITY_KINDS.has(jumped.kind) ? jumped.id : undefined}
          />
        ) : (
          <p className="admin-map-note">{error ?? 'Loading the map…'}</p>
        )}
        {world && error && <p className="admin-map-note error">{error}</p>}
      </div>
    </div>
  )
}
