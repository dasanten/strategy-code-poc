import type { ScriptRunError, ScriptRunSeen } from '@csp/shared'
import { errorWhen, stepsText } from './script-run-view.js'

/**
 * How the script a resident or army runs last ran, on its Script tab (`CONTEXT.md`: Debugging a
 * script): its last runtime error, a click opening that line in the Library, and the steps it
 * used last tick against its step budget. Sent while the Script tab watches it
 * (`ScriptMemoryTree`), only to the Player running the script.
 */
export function ScriptRunInfo({
  run,
  tick,
  onOpenError,
}: {
  /** As last sent; undefined until it arrives, null when it runs none of the Player's scripts. */
  run: ScriptRunSeen | null | undefined
  /** The world's tick now, to say how long ago the error was. */
  tick: number
  /** Opens the script in the Library at the error's line. */
  onOpenError: (error: ScriptRunError) => void
}) {
  if (!run) return null
  const { lastError, lastRun } = run
  return (
    <div className="sel-order-group script-run">
      {lastRun && (
        <p
          className={`script-steps small${lastRun.outOfSteps ? ' out-of-steps' : ''}`}
          aria-label="Steps used last tick"
        >
          {stepsText(lastRun)}
        </p>
      )}
      {lastError && (
        <button
          type="button"
          className="script-error"
          onClick={() => onOpenError(lastError)}
          title="Open this line in the Library"
        >
          <span className="script-error-message">{lastError.message}</span>
          <span className="muted small">{errorWhen(lastError, tick)}</span>
        </button>
      )}
    </div>
  )
}
