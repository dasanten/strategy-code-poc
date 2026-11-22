import { useState } from 'react'
import { describeGoal } from './shared/directive.js'
import type { DirectiveView, JoinRequestView, OrderRequest, StandingView } from '@csp/shared-types'
import {
  formatStanding,
  standingBar,
  standingName,
  standingRelationship,
  standingWord,
} from './standing-view.js'
import { PanelHead } from './drawer-head.js'
import { relationshipClass } from './theme.js'
import { aboutTime } from './shared/estimates.js'
import { OUTWEIGH_HOLD_DAYS, TICKS_PER_GAME_DAY } from '@csp/balance'

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
    <section className="dip" aria-label="Standing">
      <PanelHead title="Standing" />
      {joinRequests.length > 0 && (
        <ul className="dip-list" aria-label="Cities asking to join">
          {joinRequests.map((q) => (
            <li key={q.cityId} className="sec dip-asks">
              <span className="b">{q.city} asks to join your realm</span>
              <span>
                Town hall at {q.x}, {q.y}
              </span>
              <div className="fx dip-buttons">
                <button
                  type="button"
                  className="btn sm pri grow"
                  onClick={() => order({ kind: 'acceptJoin', cityId: q.cityId })}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="btn sm grow"
                  onClick={() => order({ kind: 'declineJoin', cityId: q.cityId })}
                >
                  Decline
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="error dip-error">{error}</p>}
      {standings.length === 0 ? (
        <p className="sec mu small">Everyone regards you neutrally.</p>
      ) : (
        <table className="tb dip-standings">
          <thead>
            <tr>
              <th>Organization</th>
              <th className="n" title="How they regard you">
                They → you
              </th>
              <th className="n" title="How you regard them">
                You
              </th>
            </tr>
          </thead>
          <tbody>
            {standings.map((s) => {
              const bar = standingBar(s.theirs)
              const word = standingWord(s.theirs)
              return (
                <tr key={s.org} className={relationshipClass(standingRelationship(s))}>
                  <td>
                    <span className="fx">
                      <span className="dot" aria-hidden="true" />
                      <span className="b">{standingName(s)}</span>
                      {s.temperament && <span className="mu small">· {s.temperament}</span>}
                    </span>
                    <span className="mt" aria-hidden="true">
                      <i className={bar.fill || 'flat'} style={{ width: `${bar.percent}%` }} />
                    </span>
                  </td>
                  <td
                    className={
                      bar.fill === 'ok'
                        ? 'n ok'
                        : bar.fill === 'low' || bar.fill === 'mid'
                          ? 'n bad'
                          : 'n'
                    }
                    title="How they regard you"
                  >
                    {word} {formatStanding(s.theirs)}
                  </td>
                  <td className="n" title="How you regard them">
                    {formatStanding(s.yours)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {directives.length > 0 && (
        <div className="sec" role="group" aria-label="Admin directives">
          <h3 className="px t16">Admin directives</h3>
          <ul className="col dip-directives">
            {directives.map((d) => (
              <li key={d.id} className="well">
                The Trade Organization punishes <span className="b">{d.targetName}</span>
                {d.withAlliance && ' and its alliance'}: {d.reason}
                {d.goals.length > 0 && (
                  <>
                    <br />
                    Until: {d.goals.map(describeGoal).join('; ')}.
                  </>
                )}
                {d.price !== null && (
                  <>
                    <br />
                    <span className="mu">
                      (can be bought off for {d.price} Coins at any Trade Org warehouse)
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="sec mu small dip-foot">
        Known crimes lower it, trade and paid contract weeks raise it, and it drifts back to
        neutral. An NPC city that holds you in high standing asks to join you once your armed
        residents near it have outweighed its soldiers and walls for{' '}
        {aboutTime(OUTWEIGH_HOLD_DAYS * TICKS_PER_GAME_DAY)} without a break. Respect counts them by
        weapon, armour, shield and Combat skill, only in its City area or in sight of its people at
        home; your walls and residents it lent you don't count.
      </p>
    </section>
  )
}
