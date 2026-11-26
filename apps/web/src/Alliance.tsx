import { useState, type FormEvent } from 'react'
import { ALLIANCE_NAME_MAX_LENGTH } from '@csp/shared-types'
import { formatGameTime } from '@csp/lang-wasm'
import { isArmed } from './stats.js'
import type {
  Diplomacy,
  OrderRequest,
  RealmLabel,
  SeenResident,
  SeenCarriage,
} from '@csp/shared-types'
import { GroupHead } from './diplomacy-parts.js'
import { PanelHead } from './panel-head.js'
import { relationshipClass } from './theme.js'
import { Icon } from './Icon.js'

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
  carriages: SeenCarriage[]
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
      <section className="dip" aria-label="Alliance">
        <PanelHead title="Alliance">none</PanelHead>
        {invitations.length > 0 && (
          <>
            <GroupHead count={invitations.length}>Invitations</GroupHead>
            <ul className="dip-list">
              {invitations.map((inv) => (
                <li key={inv.allianceId} className="sec">
                  <span className="fx wrap">
                    <span className="grow">
                      <span className="b">{inv.name}</span> (led by the realm of {inv.leader})
                      invites you
                    </span>
                    <button
                      type="button"
                      className="btn sm pri"
                      onClick={() => order({ kind: 'acceptInvite', allianceId: inv.allianceId })}
                    >
                      Join
                    </button>
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => order({ kind: 'declineInvite', allianceId: inv.allianceId })}
                    >
                      Decline
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        <form className="sec dip-form" onSubmit={found} aria-label="Found an alliance">
          <div className="fx dip-bottom">
            <label className="fld grow">
              <span className="px t16">Found an alliance</span>
              <input
                value={name}
                maxLength={ALLIANCE_NAME_MAX_LENGTH}
                placeholder="Its name"
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
            <button type="submit" className="btn pri">
              Found
            </button>
          </div>
        </form>
        {error && <p className="error dip-error">{error}</p>}
      </section>
    )
  }

  const leading = alliance.leaderId === realmId
  const taken = new Set([...alliance.members, ...alliance.invites].map((r) => r.realmId))
  const invitable = realmsInSight.filter((r) => !taken.has(r.realmId))
  const me = alliance.members.find((m) => m.realmId === realmId)

  return (
    <section className="dip" aria-label="Alliance">
      {/* In the sidebar its name joins the count, right of the tab's title. */}
      <PanelHead title={alliance.name}>
        {alliance.name} ·{' '}
        {alliance.members.length === 1 ? '1 member' : `${alliance.members.length} members`}
      </PanelHead>
      <div className="sec">
        <span className="lb">Members</span>
        <ul className="col dip-members">
          {alliance.members.map((m) => (
            <li
              key={m.realmId}
              className={`fx wrap ${relationshipClass(m.realmId === realmId ? 'own' : 'alliance')}`}
            >
              <span className="dot" aria-hidden="true" />
              <span className={m.realmId === realmId ? 'b grow' : 'grow'}>
                {m.realmId === realmId ? 'Your realm' : labelOf(m)}
              </span>
              {m.realmId === alliance.leaderId && <span className="chip y">leader</span>}
              {m.leavesAt !== null && (
                <span className="chip r">leaves {formatGameTime(m.leavesAt)}</span>
              )}
              {/* Only allies see who a realm's heir is (`CONTEXT.md`: Heir). */}
              {m.realmId !== realmId && m.heir && <span className="chip">heir {m.heir}</span>}
              {leading && m.realmId !== realmId && m.leavesAt === null && (
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => order({ kind: 'removeFromAlliance', realmId: m.realmId })}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
          {alliance.invites.map((r) => (
            <li
              key={r.realmId}
              className={`fx wrap ${relationshipClass(r.city ? 'npcCity' : 'otherRealm')}`}
            >
              <span className="dot" aria-hidden="true" />
              <span className="grow mu">{labelOf(r)}</span>
              <span className="chip">invited</span>
              {leading && (
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => order({ kind: 'withdrawInvite', realmId: r.realmId })}
                >
                  Withdraw
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
      {leading && (
        <form className="sec" onSubmit={invite} aria-label="Invite">
          <div className="fx dip-bottom">
            <label className="fld grow">
              <span className="lb">Invite a realm or NPC city in sight</span>
              <select value={invitee} onChange={(e) => setInvitee(e.target.value)}>
                <option value="">
                  {invitable.length === 0 ? 'nobody else in sight' : 'Choose whom'}
                </option>
                {invitable.map((r) => (
                  <option key={r.realmId} value={r.realmId}>
                    {labelOf(r)}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn pri" disabled={!invitee}>
              Invite
            </button>
          </div>
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
      {error && <p className="error dip-error">{error}</p>}
      {me?.leavesAt === null && (
        <div className="sec">
          <button
            type="button"
            className="btn dng dip-start"
            onClick={() => order({ kind: 'leaveAlliance' })}
          >
            Leave the alliance
          </button>
        </div>
      )}
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
  carriages: SeenCarriage[]
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
    <div className="sec" role="group" aria-label="Alliance army">
      <h3 className="px t16">Alliance army</h3>
      <p className="mu small">
        {leading
          ? 'Soldiers and carriages handed over take orders only from you: pick them as residents.'
          : 'Soldiers and carriages handed over take orders only from the alliance leader.'}
      </p>
      {army.length > 0 && (
        <ul className="col dip-members">
          {army.map((p) => (
            <li key={p.id} className="fx wrap">
              <Icon name={p.is === 'resident' ? 'sword' : 'cart'} size={16} />
              <span className="grow">{nameOf(p)}</span>
              <span className={p.realmId === realmId ? 'chip y' : 'chip bl'}>
                {p.realmId === realmId ? 'yours' : `realm of ${p.realm}`}
              </span>
              {p.recallAt !== null && (
                <span className="chip">back {formatGameTime(p.recallAt)}</span>
              )}
              {p.realmId === realmId && p.recallAt === null && (
                <button
                  type="button"
                  className="btn sm"
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
        <form className="fx dip-bottom" onSubmit={handOver} aria-label="Hand over">
          <label className="fld grow">
            <span className="lb">Hand over</span>
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

/** How a member is called: a realm by its realm name, an NPC city by its own. */
function labelOf(m: RealmLabel): string {
  return m.city ? `${m.realm} (NPC city)` : `Realm of ${m.realm}`
}
