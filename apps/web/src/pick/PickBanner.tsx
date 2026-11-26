import type { WallMaterial } from '@csp/shared-types'

/**
 * The banner over the map while an order waits for its target (ADR 0012; `CONTEXT.md`: Picking a
 * target): what to pick, what is under the pointer and what the pick would do there (or else
 * more on what picking does), and Cancel, which Escape does too. On a touch screen, once a tap
 * has shown the preview, Confirm picks that tile. Waypoints opens its sidebar tab to pick one of the
 * Player's waypoints instead (`CONTEXT.md`: Waypoint).
 */
export function PickBanner({
  prompt,
  hint,
  under,
  onConfirm,
  onWaypoints,
  onCancel,
  material,
}: {
  prompt: string
  hint?: string
  /** For a wall line: what it is built of, and how to change it (`CONTEXT.md`: Wood or stone). */
  material?: { value: WallMaterial; onChange: (m: WallMaterial) => void }
  /** What is under the pointer, or the tile tapped, and what the pick would do there. */
  under?: string
  /** Picks the tile previewed by a tap, on a touch screen. */
  onConfirm?: () => void
  /** Opens the Waypoints tab; absent while the Player holds none or it is open. */
  onWaypoints?: () => void
  onCancel: () => void
}) {
  const line = under ?? hint
  return (
    <div
      className="pn notice pick-banner"
      role="status"
      title={hint ? `${prompt}\n${hint}` : prompt}
    >
      <div className="notice-text pick-banner-text">
        <strong>{prompt}</strong>
        {line && <span className="small">{line}</span>}
      </div>
      {material && (
        <div className="material-pick" role="group" aria-label="Wall of">
          {(['wood', 'stone'] as const).map((m) => (
            <button
              type="button"
              key={m}
              aria-pressed={material.value === m}
              onClick={() => material.onChange(m)}
            >
              {m === 'wood' ? 'Wood' : 'Stone'}
            </button>
          ))}
        </div>
      )}
      {onConfirm && (
        <button type="button" className="primary" onClick={onConfirm}>
          Confirm
        </button>
      )}
      {onWaypoints && (
        <button type="button" onClick={onWaypoints}>
          Waypoints
        </button>
      )}
      <button type="button" onClick={onCancel}>
        Cancel<kbd aria-hidden="true">Esc</kbd>
      </button>
    </div>
  )
}
