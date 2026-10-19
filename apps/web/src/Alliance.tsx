import { useState, type FormEvent } from 'react'
import {
  ALLIANCE_NAME_MAX_LENGTH,
  formatGameTime,
  type Diplomacy,
  type OrderRequest,
} from '@csp/shared'

/**
 * The Player's alliance (`CONTEXT.md`: Alliance, Alliance leader): found one or answer
 * invitations while in none; in one, see its members and leave it; as its leader, invite realms
 * in sight and remove members. Every change is an order the server checks (ADR 0002).
 */
export function AlliancePanel({
  diplomacy,
  realmId,
  sendOrder,
}: {
  diplomacy: Diplomacy
  realmId: string
  sendOrder: (order: OrderRequest) => Promise<string | undefined>
}) {
  const [name, setName] = useState('')
  const [invitee, setInvitee] = useState('')
  const [error, setError] = useState<string | undefined>()
  const order = async (o: OrderRequest) => setError(await sendOrder(o))
  const { alliance, invitations, realmsInSight } = diplomacy

  async function found(e: FormEvent) {
    e.preventDefault()
    await order({ kind: 'foundAlliance', name })
    setName('')
  }

  async function invite(e: FormEvent) {
    e.preventDefault()
    if (invitee) await order({ kind: 'inviteToAlliance', realmId: invitee })
    setInvitee('')
  }

  if (!alliance) {
    return (
      <section className="alliance-panel" aria-label="Alliance">
        <div className="panel-head">
          <h2>Alliance</h2>
          <span>none</span>
        </div>
        {invitations.length > 0 && (
          <ul className="alliance-list">
            {invitations.map((inv) => (
              <li key={inv.allianceId}>
                <span>
                  <strong>{inv.name}</strong> (led by the realm of {inv.leader}) invites you
                </span>
                <button
                  type="button"
                  onClick={() => order({ kind: 'acceptInvite', allianceId: inv.allianceId })}
                >
                  Join
                </button>
                <button
                  type="button"
                  onClick={() => order({ kind: 'declineInvite', allianceId: inv.allianceId })}
                >
                  Decline
                </button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={found}>
          <label>
            Found an alliance
            <input
              value={name}
              maxLength={ALLIANCE_NAME_MAX_LENGTH}
              placeholder="Its name"
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
          <button type="submit">Found</button>
        </form>
        {error && <p className="error">{error}</p>}
      </section>
    )
  }

  const leading = alliance.leaderId === realmId
  const taken = new Set([...alliance.members, ...alliance.invites].map((r) => r.realmId))
  const invitable = realmsInSight.filter((r) => !taken.has(r.realmId))
  const me = alliance.members.find((m) => m.realmId === realmId)

  return (
    <section className="alliance-panel" aria-label="Alliance">
      <div className="panel-head">
        <h2>{alliance.name}</h2>
        <span>
          {alliance.members.length === 1 ? '1 member' : `${alliance.members.length} members`}
        </span>
      </div>
      <ul className="alliance-list">
        {alliance.members.map((m) => (
          <li key={m.realmId}>
            <span>
              {m.realmId === realmId ? 'Your realm' : `Realm of ${m.realm}`}
              {m.realmId === alliance.leaderId && <span className="badge">leader</span>}
              {m.leavesAt !== null && (
                <span className="badge">leaves {formatGameTime(m.leavesAt)}</span>
              )}
            </span>
            {leading && m.realmId !== realmId && m.leavesAt === null && (
              <button
                type="button"
                onClick={() => order({ kind: 'removeFromAlliance', realmId: m.realmId })}
              >
                Remove
              </button>
            )}
          </li>
        ))}
        {alliance.invites.map((r) => (
          <li key={r.realmId} className="invited">
            <span>
              Realm of {r.realm}
              <span className="badge">invited</span>
            </span>
            {leading && (
              <button
                type="button"
                onClick={() => order({ kind: 'withdrawInvite', realmId: r.realmId })}
              >
                Withdraw
              </button>
            )}
          </li>
        ))}
      </ul>
      {leading && (
        <form onSubmit={invite}>
          <label>
            Invite a realm in sight
            <select value={invitee} onChange={(e) => setInvitee(e.target.value)}>
              <option value="">
                {invitable.length === 0 ? 'no other realm in sight' : 'Choose a realm'}
              </option>
              {invitable.map((r) => (
                <option key={r.realmId} value={r.realmId}>
                  Realm of {r.realm}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={!invitee}>
            Invite
          </button>
        </form>
      )}
      {me?.leavesAt === null && (
        <button type="button" onClick={() => order({ kind: 'leaveAlliance' })}>
          Leave the alliance
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  )
}
