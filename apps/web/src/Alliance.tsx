import { useState, type FormEvent } from 'react'
import {
  ALLIANCE_NAME_MAX_LENGTH,
  formatGameTime,
  isArmed,
  type Carriage,
  type Diplomacy,
  type OrderRequest,
  type SeenResident,
} from '@csp/shared'

/**
 * The Player's alliance (`CONTEXT.md`: Alliance, Alliance leader): found one or answer
 * invitations while in none; in one, see its members and leave it; as its leader, invite realms
 * in sight and remove members; hand over soldiers and carriages to the alliance army and recall
 * them. Every change is an order the server checks (ADR 0002).
 */
export function AlliancePanel({
  diplomacy,
  realmId,
  residents,
  carriages,
  sendOrder,
}: {
  diplomacy: Diplomacy
  realmId: string
  /** Residents in sight, the Player's own among them. */
  residents: SeenResident[]
  /** Carriages in sight, the Player's own among them. */
  carriages: Carriage[]
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
      <AllianceArmy
        army={alliance.army}
        leading={leading}
        leaving={me?.leavesAt !== null}
        realmId={realmId}
        residents={residents}
        carriages={carriages}
        order={order}
      />
      {me?.leavesAt === null && (
        <button type="button" onClick={() => order({ kind: 'leaveAlliance' })}>
          Leave the alliance
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  )
}

/**
 * The alliance army (`CONTEXT.md`: Alliance army): what members handed over, recalling what the
 * Player handed over, and handing over more of their soldiers and carriages. The alliance leader
 * commands what was handed over from the residents list like their own.
 */
function AllianceArmy({
  army,
  leading,
  leaving,
  realmId,
  residents,
  carriages,
  order,
}: {
  army: NonNullable<Diplomacy['alliance']>['army']
  leading: boolean
  leaving: boolean
  realmId: string
  residents: SeenResident[]
  carriages: Carriage[]
  order: (o: OrderRequest) => Promise<void>
}) {
  const [pick, setPick] = useState('')
  const lent = new Set(army.map((p) => p.id))
  const soldiers = residents.filter((r) => r.owner === realmId && !lent.has(r.id) && isArmed(r))
  const ownCarriages = carriages.filter((k) => k.realmId === realmId && !lent.has(k.id))
  const nameOf = (p: (typeof army)[number]) =>
    p.is === 'resident'
      ? (residents.find((r) => r.id === p.id)?.name ?? 'a soldier out of sight')
      : `Carriage ${p.id}`

  async function handOver(e: FormEvent) {
    e.preventDefault()
    const [is, id] = pick.split(':')
    if (!id) return
    await order({
      kind: 'handOverToAlliance',
      residentIds: is === 'resident' ? [id] : [],
      carriageIds: is === 'carriage' ? [id] : [],
    })
    setPick('')
  }

  return (
    <div aria-label="Alliance army">
      <h3>Alliance army</h3>
      <p className="small">
        {leading
          ? 'Soldiers and carriages handed over take orders only from you: pick them as residents.'
          : 'Soldiers and carriages handed over take orders only from the alliance leader.'}
      </p>
      {army.length > 0 && (
        <ul className="alliance-list">
          {army.map((p) => (
            <li key={p.id}>
              <span>
                {nameOf(p)}
                <span className="badge">
                  {p.realmId === realmId ? 'yours' : `realm of ${p.realm}`}
                </span>
                {p.recallAt !== null && (
                  <span className="badge">back {formatGameTime(p.recallAt)}</span>
                )}
              </span>
              {p.realmId === realmId && p.recallAt === null && (
                <button
                  type="button"
                  onClick={() => order({ kind: 'recallFromAlliance', ids: [p.id] })}
                >
                  Recall
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!leaving && (
        <form onSubmit={handOver}>
          <label>
            Hand over
            <select value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">
                {soldiers.length + ownCarriages.length === 0
                  ? 'no soldier or carriage to hand over'
                  : 'Choose a soldier or carriage'}
              </option>
              {soldiers.map((r) => (
                <option key={r.id} value={`resident:${r.id}`}>
                  {r.name}
                </option>
              ))}
              {ownCarriages.map((k) => (
                <option key={k.id} value={`carriage:${k.id}`}>
                  Carriage {k.id}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={!pick}>
            Hand over
          </button>
        </form>
      )}
    </div>
  )
}
