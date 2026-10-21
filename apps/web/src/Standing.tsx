import { useState } from 'react'
import type { DirectiveView, JoinRequestView, OrderRequest, StandingView } from '@csp/shared'
import { formatStanding, standingName, standingWord } from './standing-view.js'

/**
 * Standing (`CONTEXT.md`: Standing): how other Organizations regard the Player's realm, and how
 * it regards them. Shown only; it does nothing on its own for Players. NPC cities that hold the
 * realm in high standing and respect it ask to join here (`CONTEXT.md`: Persuading a city); the
 * Player accepts or declines, each an order the server checks (ADR 0002).
 */
export function StandingPanel({
  standings,
  joinRequests,
  directives,
  sendOrder,
}: {
  standings: StandingView[]
  joinRequests: JoinRequestView[]
  directives: DirectiveView[]
  sendOrder: (order: OrderRequest) => Promise<string | undefined>
}) {
  const [error, setError] = useState<string>()
  const order = async (o: OrderRequest) => setError(await sendOrder(o))
  return (
    <section className="alliance-panel" aria-label="Standing">
      <div className="panel-head">
        <h2>Standing</h2>
      </div>
      {joinRequests.length > 0 && (
        <ul className="alliance-list" aria-label="Cities asking to join">
          {joinRequests.map((q) => (
            <li key={q.cityId}>
              <span>
                {q.city} asks to join your realm
                <span className="muted small">
                  {' '}
                  (town hall at {q.x}, {q.y})
                </span>
              </span>
              <div className="order-buttons">
                <button
                  type="button"
                  onClick={() => order({ kind: 'acceptJoin', cityId: q.cityId })}
                >
                  Accept
                </button>
                <button
                  type="button"
                  onClick={() => order({ kind: 'declineJoin', cityId: q.cityId })}
                >
                  Decline
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="error">{error}</p>}
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
      {directives.length > 0 && (
        <>
          <h3>Admin directives</h3>
          <ul className="alliance-list" aria-label="Admin directives">
            {directives.map((d) => (
              <li key={d.id}>
                <span>
                  The Trade Organization punishes {d.targetName}
                  {d.withAlliance && ' and its alliance'}: {d.reason}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="muted small">
        Known crimes lower it, trade and paid contract weeks raise it, and it drifts back to
        neutral. An NPC city that holds you in high standing and sees more of your armed residents
        and walls than it has soldiers asks to join you.
      </p>
    </section>
  )
}
