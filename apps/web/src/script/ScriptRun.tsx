import type { ScriptRunError, ScriptRunSeen } from '@csp/shared-types'
import { errorWhen, stepsText, waitingText } from './script-run-view.js'
import { stepsShare } from '../screen/command-tabs-view.js'

/**
 * How the script a resident or army runs last ran, on its Script tab (`CONTEXT.md`: Debugging a
 * script): whether it waits on the order (Running a script, Waiting), the steps it used the last
 * tick it ran against its step budget, with a meter, and its last runtime error, a click opening
 * that line in the Library. Sent while the Script tab watches it (`ScriptMemoryTree`), only to the
 * Player running the script.
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
  const { lastError, lastRun, waitingSince } = run
  return (
    <div className="script-run">
      {(waitingSince !== undefined || lastRun) && (
        <div className="well script-run-info">
          {waitingSince !== undefined && (
            <p className="script-waiting small" aria-label="Script waiting">
              {waitingText(waitingSince, tick)}
            </p>
          )}
          {lastRun && (
            <>
              <p
                className={`script-steps small${lastRun.outOfSteps ? ' out-of-steps' : ''}`}
                aria-label="Steps used last tick"
              >
                {stepsText(lastRun)}
              </p>
              <span className="mt bl" aria-hidden="true">
                <i style={{ width: `${Math.round(stepsShare(lastRun) * 100)}%` }} />
              </span>
            </>
          )}
        </div>
      )}
      {lastError && (
        <button
          type="button"
          className="btn sm dng why fill script-error"
          onClick={() => onOpenError(lastError)}
          title="Open this line in the Library"
        >
          <span className="script-error-message">Last error: {lastError.message}</span>
          <small>{errorWhen(lastError, tick)} · opens the line in the Library</small>
        </button>
      )}
    </div>
  )
}
