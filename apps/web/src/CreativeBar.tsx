import { useEffect, useState } from 'react'
import type { CreativeState } from '@csp/shared-types'
import { api, ApiFailure } from './api.js'
import { CREATIVE_SPEEDS, creativeRunning } from './creative-bar.js'
import { formatGameTime } from './shared/time.js'

/**
 * The Creative bar (`CONTEXT.md`: Creative mode): pause or resume the whole world, step one tick
 * and set its speed, with the current game time. Shown only to admins on a server started with
 * `CREATIVE=1`; the server refuses every other caller.
 */
export function CreativeBar({ tick }: { tick: number | undefined }) {
  const [state, setState] = useState<CreativeState>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let live = true
    api
      .creative()
      .then((s) => live && setState(s))
      .catch((e: unknown) => live && setError(message(e)))
    return () => {
      live = false
    }
  }, [])

  const act = (call: () => Promise<CreativeState>) => {
    setBusy(true)
    call()
      .then((s) => {
        setState(s)
        setError(undefined)
      })
      .catch((e: unknown) => setError(message(e)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="hud-creative-bar" role="toolbar" aria-label="Creative time controls">
      <span className="hud-creative-label" title="Creative mode: for testing, never play">
        Creative
      </span>
      {tick !== undefined && <span className="hud-creative-time">{formatGameTime(tick)}</span>}
      {state && (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => act(state.paused ? api.creativeResume : api.creativePause)}
          >
            {state.paused ? 'Resume' : 'Pause'}
          </button>
          <button
            type="button"
            disabled={busy}
            title="Pause and run exactly one tick (one game minute)"
            onClick={() => act(api.creativeStep)}
          >
            Step
          </button>
          <span className="hud-creative-speeds" role="group" aria-label="Speed">
            {CREATIVE_SPEEDS.map(({ speed, label, title }) => (
              <button
                key={speed}
                type="button"
                className={state.speed === speed ? 'on' : undefined}
                aria-pressed={state.speed === speed}
                disabled={busy}
                title={title}
                onClick={() => act(() => api.creativeSpeed(speed))}
              >
                {label}
              </button>
            ))}
          </span>
          <span className="hud-creative-status">{creativeRunning(state.paused, state.speed)}</span>
        </>
      )}
      {error && <span className="hud-creative-error">{error}</span>}
    </div>
  )
}

function message(e: unknown): string {
  return e instanceof ApiFailure || e instanceof Error ? e.message : String(e)
}
