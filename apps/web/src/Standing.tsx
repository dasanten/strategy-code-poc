import type { StandingView } from '@csp/shared'
import { formatStanding, standingName, standingWord } from './standing-view.js'

/**
 * Standing (`CONTEXT.md`: Standing): how other Organizations regard the Player's realm, and how
 * it regards them. Shown only; it does nothing on its own for Players.
 */
export function StandingPanel({ standings }: { standings: StandingView[] }) {
  return (
    <section className="alliance-panel" aria-label="Standing">
      <div className="panel-head">
        <h2>Standing</h2>
      </div>
      {standings.length === 0 ? (
        <p className="muted small">Everyone regards you neutrally.</p>
      ) : (
        <ul className="alliance-list">
          {standings.map((s) => (
            <li key={s.org}>
              <span>{standingName(s)}</span>
              <span className="badge" title="How they regard you">
                {standingWord(s.theirs)} {formatStanding(s.theirs)}
              </span>
              <span className="muted small" title="How you regard them">
                you: {formatStanding(s.yours)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">
        Known crimes lower it, trade and paid contract weeks raise it, and it drifts back to
        neutral.
      </p>
    </section>
  )
}
