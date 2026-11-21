import { useEffect, useState } from 'react'
import type { CreativeState, SkipProgress, SkipUnit } from '@csp/shared-types'
import { api, ApiFailure } from './api.js'
import {
  CREATIVE_SPEEDS,
  creativeRunning,
  SKIP_UNITS,
  skipLine,
  skipTicks,
} from './creative-bar.js'
import { formatGameTime } from './shared/time.js'

/**
 * The Creative bar (`CONTEXT.md`: Creative mode): pause or resume the whole world, step one tick,
 * set its speed and skip ahead, with the current game time. Shown only to admins on a server started with
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

  // While a skip ahead runs, its progress is asked for a few times a second; the world itself
  // arrives in one update at its end.
  const skipping = state?.skip !== undefined
  useEffect(() => {
    if (!skipping) return
    let live = true
    const timer = window.setInterval(() => {
      api
        .creative()
        .then((s) => live && setState(s))
        .catch((e: unknown) => live && setError(message(e)))
    }, SKIP_POLL_MS)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [skipping])

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
          <SkipAhead skip={state.skip} busy={busy} act={act} />
        </>
      )}
      {error && <span className="hud-creative-error">{error}</span>}
    </div>
  )
}

/** How often the bar asks for a running skip ahead's progress. */
const SKIP_POLL_MS = 250

/**
 * Skip ahead a number of game hours or days, as fast as the machine allows; while it runs, its
 * progress and Cancel instead.
 */
function SkipAhead({
  skip,
  busy,
  act,
}: {
  skip: SkipProgress | undefined
  busy: boolean
  act: (call: () => Promise<CreativeState>) => void
}) {
  const [amount, setAmount] = useState('1')
  const [unit, setUnit] = useState<SkipUnit>('days')

  if (skip) {
    return (
      <span className="hud-creative-skip" role="group" aria-label="Skip ahead">
        <progress max={skip.total} value={skip.done} aria-label="Skip ahead progress" />
        <span className="hud-creative-status">{skipLine(skip)}</span>
        <button type="button" disabled={busy} onClick={() => act(api.creativeSkipCancel)}>
          Cancel
        </button>
      </span>
    )
  }
  const n = Number(amount)
  const ticks = skipTicks(n, unit)
  return (
    <form
      className="hud-creative-skip"
      aria-label="Skip ahead"
      onSubmit={(e) => {
        e.preventDefault()
        if (ticks !== undefined) act(() => api.creativeSkip({ amount: n, unit }))
      }}
    >
      <button
        type="submit"
        disabled={busy || ticks === undefined}
        title="Run this much game time as fast as the machine allows; every rule runs as usual"
      >
        Skip ahead
      </button>
      <input
        type="number"
        min={1}
        step={1}
        value={amount}
        aria-label="How many"
        onChange={(e) => setAmount(e.target.value)}
      />
      <select value={unit} aria-label="Unit" onChange={(e) => setUnit(e.target.value as SkipUnit)}>
        {SKIP_UNITS.map((u) => (
          <option key={u.unit} value={u.unit}>
            {u.label}
          </option>
        ))}
      </select>
    </form>
  )
}

function message(e: unknown): string {
  return e instanceof ApiFailure || e instanceof Error ? e.message : String(e)
}
