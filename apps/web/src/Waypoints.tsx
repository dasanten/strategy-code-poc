import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import {
  WAYPOINT_NAME_MAX_LENGTH,
  addWaypointProblem,
  nameProblem,
  type Waypoint,
} from '@csp/shared'
import { PanelHead } from './drawer-head.js'
import { menuSpot, suggestedWaypointName, waypointCount, waypointPlace } from './waypoints-view.js'

/*
 * Waypoints (`CONTEXT.md`: Waypoint): the Player's named markers. Added from the map's tile menu
 * (right-click or long-press) or the tile card, listed in the Waypoints drawer. Each change is an
 * order the server checks (`addWaypoint`, `renameWaypoint`, `removeWaypoint`); its answer shows
 * under the form when it turns one down.
 */

/**
 * A name for a waypoint, new or renamed: the field starts filled and selected, Enter sends it.
 * `problem` says why it can't be sent whatever the name, such as the cap.
 */
export function WaypointNameForm({
  initial,
  submitLabel,
  problem,
  onSubmit,
  onCancel,
}: {
  initial: string
  submitLabel: string
  problem?: string
  onSubmit: (name: string) => Promise<string | undefined>
  onCancel?: () => void
}) {
  const [value, setValue] = useState(initial)
  const [error, setError] = useState<string>()
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.select(), [])
  const bad = problem ?? nameProblem(value, WAYPOINT_NAME_MAX_LENGTH)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (bad) return
    setError(await onSubmit(value.trim()))
  }
  return (
    <form className="waypoint-form" onSubmit={(e) => void submit(e)}>
      <div className="order-buttons">
        <input
          ref={input}
          value={value}
          maxLength={WAYPOINT_NAME_MAX_LENGTH}
          aria-label="Waypoint name"
          disabled={!!problem}
          onChange={(e) => {
            setValue(e.target.value)
            setError(undefined)
          }}
        />
      </div>
      {(error || bad) && (
        <p className="small muted" role="status">
          {error ? `Turned down: ${error}` : bad}
        </p>
      )}
      <div className="order-buttons">
        <button type="submit" className="primary" disabled={!!bad}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}

/** Why a waypoint can't go on tile (x, y) whatever its name, such as the Player's cap. */
export function addProblem(held: readonly Waypoint[], x: number, y: number, size: number) {
  // Any good name: only what the name doesn't decide is left.
  return addWaypointProblem(held, x, y, 'name', size)
}

/**
 * The map's tile menu (`CONTEXT.md`: Waypoint): opened by right-click or long-press on a tile
 * with nothing else to do there, at the point pressed. It adds a waypoint on the tile. Escape, a
 * press outside it or adding closes it.
 */
export function TileMenu({
  at,
  tile,
  held,
  size,
  onAdd,
  onClose,
}: {
  /** Where it was pressed, in the window. */
  at: { x: number; y: number }
  tile: { x: number; y: number }
  held: readonly Waypoint[]
  size: number
  /** Sends the add order; resolves with why it was turned down, if it was. */
  onAdd: (name: string) => Promise<string | undefined>
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [spot, setSpot] = useState({ left: at.x, top: at.y })
  useLayoutEffect(() => {
    const menu = ref.current?.getBoundingClientRect()
    if (!menu) return
    const view = { width: window.innerWidth, height: window.innerHeight }
    setSpot(menuSpot(at, menu, view))
  }, [at])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      onClose()
    }
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    window.addEventListener('pointerdown', onDown, { capture: true })
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true })
      window.removeEventListener('pointerdown', onDown, { capture: true })
    }
  }, [onClose])
  return (
    <div
      ref={ref}
      className="tile-menu"
      role="dialog"
      aria-label="Tile menu"
      style={{ left: spot.left, top: spot.top }}
    >
      <div className="panel-head">
        <h3>Add waypoint here</h3>
        <span className="small muted">{waypointPlace(tile)}</span>
      </div>
      <WaypointNameForm
        initial={suggestedWaypointName(held)}
        submitLabel="Add waypoint"
        problem={addProblem(held, tile.x, tile.y, size)}
        onSubmit={async (name) => {
          const turnedDown = await onAdd(name)
          if (!turnedDown) onClose()
          return turnedDown
        }}
        onCancel={onClose}
      />
    </div>
  )
}

/**
 * The Waypoints drawer (`CONTEXT.md`: Waypoint): the Player's waypoints, oldest first, each with
 * where it is. Its name centres the map on it; Rename and Remove act on it at once. While an
 * order waits for a place (`CONTEXT.md`: Picking a target), Pick gives it the waypoint's tile.
 */
export function WaypointsPanel({
  waypoints,
  onCentre,
  onRename,
  onRemove,
  onPick,
}: {
  waypoints: readonly Waypoint[]
  onCentre: (w: Waypoint) => void
  onRename: (w: Waypoint, name: string) => Promise<string | undefined>
  onRemove: (w: Waypoint) => Promise<string | undefined>
  /** Picks the waypoint as the place the order waits for; absent while none waits. */
  onPick?: (w: Waypoint) => void
}) {
  const [renaming, setRenaming] = useState<string>()
  const [error, setError] = useState<string>()
  return (
    <section className="waypoints" aria-label="Waypoints">
      <PanelHead title="Waypoints">{waypointCount(waypoints)}</PanelHead>
      {waypoints.length === 0 && (
        <p className="muted">
          No waypoints yet. Right-click a tile on the map, or long-press it on a touch screen, to
          add one.
        </p>
      )}
      {onPick && waypoints.length > 0 && (
        <p className="small muted">Pick a waypoint for the place the order waits for.</p>
      )}
      {error && (
        <p className="small muted" role="status">
          Turned down: {error}
        </p>
      )}
      <ul className="waypoint-list">
        {waypoints.map((w) => (
          <li key={w.id} className="waypoint-row">
            <div className="waypoint-head">
              <button
                type="button"
                className="waypoint-name"
                title="Show on the map"
                onClick={() => onCentre(w)}
              >
                <span className="name">{w.name}</span>
                <small className="muted">{waypointPlace(w)}</small>
              </button>
              {onPick && (
                <button
                  type="button"
                  className="primary"
                  aria-label={`Pick ${w.name}`}
                  onClick={() => onPick(w)}
                >
                  Pick
                </button>
              )}
              <button
                type="button"
                aria-pressed={renaming === w.id}
                onClick={() => setRenaming(renaming === w.id ? undefined : w.id)}
              >
                Rename
              </button>
              <button
                type="button"
                aria-label={`Remove ${w.name}`}
                onClick={async () => setError(await onRemove(w))}
              >
                Remove
              </button>
            </div>
            {renaming === w.id && (
              <WaypointNameForm
                initial={w.name}
                submitLabel="Rename"
                onSubmit={async (name) => {
                  const turnedDown = await onRename(w, name)
                  if (!turnedDown) setRenaming(undefined)
                  return turnedDown
                }}
                onCancel={() => setRenaming(undefined)}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
