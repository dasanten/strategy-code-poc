import { useState, type FormEvent } from 'react'
import { CONTRACT_MAX_DAYS, TRADE_ORG_ARMY } from '@csp/balance'
import { TRADE_ORG } from '@csp/shared-types'
import type {
  Building,
  SeenCity,
  SeenHorse,
  ContractView,
  OrderRequest,
  RealmLabel,
  Resident,
  ScriptSummary,
  SeenResident,
} from '@csp/shared-types'
import { ageInYears } from '@csp/lang-wasm'
import { isAt } from '../building/footprint.js'
import {
  contractChip,
  contractStatus,
  offerSummary,
  sideName,
  storageName,
  type OfferSide,
} from './contract-view.js'
import { doingLine } from '../residents/doing-view.js'
import { Choice } from './diplomacy-parts.js'
import { PanelHead } from '../ui/panel-head.js'
import { labelled, nameLabels } from '../residents/name-labels.js'

/**
 * Mercenary contracts (`CONTEXT.md`: Mercenary contract): offer some of your residents for hire
 * to a realm, or ask to hire residents of a realm you see, or a number of the Trade Org army's
 * soldiers, paid into a Trade Org warehouse you know (`CONTEXT.md`: Trade Org army), or a number
 * of an NPC city's residents, paid into its storage (`CONTEXT.md`: Hiring from an NPC city); accept or
 * decline what others offer;
 * pay each week in advance with one of your residents standing on the contract's storage,
 * carrying the coins. Every change is an order the server checks (ADR 0002).
 */
export function ContractsPanel({
  contracts,
  realmId,
  own,
  inSight,
  horses,
  buildings,
  cities,
  realms,
  scripts,
  tick,
  sendOrder,
}: {
  contracts: ContractView[]
  realmId: string
  /** The residents whose orders the Player gives. */
  own: Resident[]
  /** Everyone in sight, the Player's own included. */
  inSight: SeenResident[]
  /** The horses the Player knows, for the residents' Doing lines. */
  horses: readonly SeenHorse[]
  buildings: Building[]
  /** Cities in sight; an NPC city that doesn't refuse the Player says what it would lend. */
  cities: SeenCity[]
  /** Realms the Player could make a contract with. */
  realms: RealmLabel[]
  /** The Player's scripts, for the residents' Doing lines. */
  scripts: ScriptSummary[]
  /** Now, for the ages that tell residents of one name apart (`nameLabels`). */
  tick: number
  sendOrder: (order: OrderRequest) => Promise<string | undefined>
}) {
  const [hiring, setHiring] = useState(false)
  const [other, setOther] = useState('')
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [days, setDays] = useState(7)
  const [price, setPrice] = useState(10)
  const [storageId, setStorageId] = useState('')
  const [soldiers, setSoldiers] = useState(1)
  const [count, setCount] = useState(1)
  const [error, setError] = useState<string | undefined>()
  const order = async (o: OrderRequest) => setError(await sendOrder(o))

  const tradeOrg = hiring && other === TRADE_ORG
  const npcCities = cities.filter((c) => c.hire !== undefined)
  const npc = hiring ? npcCities.find((c) => c.id === other) : undefined
  const lenderId = hiring ? other : realmId
  const candidates: SeenResident[] =
    tradeOrg || npc
      ? []
      : hiring
        ? inSight.filter((r) => r.owner === other)
        : own.filter((r) => r.owner === realmId)
  // Each row shows age and city; the summary line tells two of one name apart the same way.
  const candidateNames = nameLabels(candidates, tick, cities)
  const storages = buildings.filter(
    (b) =>
      b.kind === (tradeOrg ? 'warehouse' : 'storage') &&
      !b.site &&
      cities.some(
        (c) =>
          c.id === b.cityId &&
          (tradeOrg ? c.tradeOrg !== undefined : npc ? c.id === npc.id : c.realmId === lenderId),
      ),
  )

  const side: OfferSide | undefined = !other
    ? undefined
    : tradeOrg
      ? { kind: 'tradeOrg' }
      : npc
        ? { kind: 'npcCity', name: npc.name }
        : { kind: 'realm', name: realms.find((r) => r.realmId === other)?.realm ?? other }
  const storage = storages.find((b) => b.id === storageId)
  const summary = offerSummary({
    hiring,
    side,
    residents: candidates.filter((r) => chosen.has(r.id)).map((r) => candidateNames.get(r.id)!),
    count: tradeOrg ? soldiers : count,
    days,
    pricePerWeek: price,
    storage: storage && storageName(storage, cities, storages),
  })
  const cityName = (r: SeenResident) => cities.find((c) => c.id === r.cityId)?.name

  async function offer(e: FormEvent) {
    e.preventDefault()
    await order({
      kind: 'offerContract',
      ...(tradeOrg ? { soldiers } : npc ? { residents: count } : { residentIds: [...chosen] }),
      ...(hiring && !tradeOrg && !npc ? {} : { realmId: other }),
      days,
      pricePerWeek: price,
      storageId,
    })
    setChosen(new Set())
  }

  function toggle(id: string) {
    const next = new Set(chosen)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setChosen(next)
  }

  function switchMode(next: boolean) {
    setHiring(next)
    setChosen(new Set())
    setStorageId('')
  }

  return (
    <section className="dip" aria-label="Mercenary contracts">
      <PanelHead title="Mercenaries">
        {contracts.length === 0 ? 'none' : contracts.length}
      </PanelHead>
      {contracts.length > 0 && (
        <ul className="dip-list">
          {contracts.map((c) => {
            const lender = c.lender.realmId === realmId
            const otherSide = lender ? c.hirer : c.lender
            const offered = c.startedAt === null
            const theirOffer =
              offered && (c.offeredBy === 'lender' ? c.lender : c.hirer).realmId !== realmId
            const payers = labelled(
              !lender && !offered && c.paidWeeks < c.weeks && c.storage
                ? own.filter(
                    (r) =>
                      isAt(r, { kind: 'storage', ...c.storage! }) &&
                      (r.carried.coins ?? 0) >= c.pricePerWeek,
                  )
                : [],
              tick,
            )
            const rented = nameLabels(
              inSight.filter((r) => c.residents.some((x) => x.id === r.id)),
              tick,
              cities,
            )
            const chip = contractChip(c, realmId)
            return (
              <li key={c.id} className="sec">
                <span className="fx">
                  <span className="b grow">
                    {lender ? 'Rented to' : 'Hired from'} {sideName(otherSide, cities)}
                  </span>
                  <span className={chip.tone ? `chip ${chip.tone}` : 'chip'}>{chip.text}</span>
                </span>
                {c.residents.length > 0 && (
                  <span>{c.residents.map((r) => rented.get(r.id) ?? r.name).join(', ')}</span>
                )}
                <span className="mu small">
                  {c.days} days at {c.pricePerWeek} Coins a week, paid into the{' '}
                  {c.lender.realmId === TRADE_ORG ? 'warehouse' : 'storage'}
                  {c.storage ? ` at ${c.storage.x}, ${c.storage.y}` : ' (gone)'}
                </span>
                {!offered && (
                  <span className="fx">
                    <span className="mt grow" aria-hidden="true">
                      <i className="mid" style={{ width: `${chip.paid * 100}%` }} />
                    </span>
                    <span className="mono small">{contractStatus(c, realmId)}</span>
                  </span>
                )}
                {(offered || payers.length > 0) && (
                  <div className="fx wrap dip-buttons">
                    {theirOffer && (
                      <button
                        type="button"
                        className="btn sm pri grow"
                        onClick={() => order({ kind: 'acceptContract', contractId: c.id })}
                      >
                        Accept
                      </button>
                    )}
                    {offered && (
                      <button
                        type="button"
                        className={theirOffer ? 'btn sm grow' : 'btn sm'}
                        onClick={() => order({ kind: 'cancelContract', contractId: c.id })}
                      >
                        {theirOffer ? 'Decline' : 'Withdraw'}
                      </button>
                    )}
                    {payers.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        className="btn sm gold"
                        onClick={() =>
                          order({ kind: 'pay', residentId: r.id, contractId: c.id, weeks: 1 })
                        }
                      >
                        {r.name} pays a week
                      </button>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <form className="sec dip-form" onSubmit={offer} aria-label="New contract">
        <h3 className="px t16">{hiring ? 'Ask to hire' : 'Offer for hire'}</h3>
        <Choice
          label="What"
          value={hiring}
          options={[
            { value: false, label: 'Rent out mine' },
            { value: true, label: 'Hire theirs' },
          ]}
          onChange={switchMode}
        />
        <label className="fld">
          <span className="lb">{hiring ? 'From' : 'To'}</span>
          <select
            value={other}
            onChange={(e) => {
              setOther(e.target.value)
              if (hiring) {
                setChosen(new Set())
                setStorageId('')
              }
            }}
          >
            <option value="">{hiring ? 'Hire from…' : 'Rent out to…'}</option>
            {hiring && <option value={TRADE_ORG}>The Trade Organization</option>}
            {realms.map((r) => (
              <option key={r.realmId} value={r.realmId}>
                The realm of {r.realm}
              </option>
            ))}
            {hiring &&
              npcCities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        {!tradeOrg && !npc && (
          <div className="fld" role="group" aria-label="Residents">
            <span className="lb">Residents</span>
            {candidates.length === 0 ? (
              <span className="mu small">
                {hiring ? (other ? 'None of theirs in sight' : 'Pick whom to hire from') : 'None'}
              </span>
            ) : (
              <ul className="dip-residents" aria-label="Residents">
                {candidates.map((r) => (
                  <li key={r.id}>
                    <label className="dip-resident">
                      <input
                        type="checkbox"
                        checked={chosen.has(r.id)}
                        onChange={() => toggle(r.id)}
                      />
                      <span className="col">
                        <span className="b">
                          {r.name}{' '}
                          <span className="mu small">
                            · {Math.floor(ageInYears(r, tick))}
                            {cityName(r) ? ` · ${cityName(r)}` : ''}
                          </span>
                        </span>
                        <small className="mu">
                          {doingLine(r, { scripts, buildings, residents: inSight, horses, cities })}
                        </small>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="fx dip-numbers">
          {tradeOrg && (
            <label className="fld grow">
              <span className="lb">Soldiers</span>
              <input
                type="number"
                className="mono"
                min={1}
                value={soldiers}
                onChange={(e) => setSoldiers(Number(e.target.value))}
              />
            </label>
          )}
          {npc && (
            <label className="fld grow">
              <span className="lb">Residents</span>
              <input
                type="number"
                className="mono"
                min={1}
                max={Math.max(1, npc.hire!.spare)}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </label>
          )}
          <label className="fld grow">
            <span className="lb">For · game days</span>
            <input
              type="number"
              className="mono"
              min={1}
              max={CONTRACT_MAX_DAYS}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            />
          </label>
          <label className="fld grow">
            <span className="lb">Coins a week</span>
            <input
              type="number"
              className="mono"
              min={1}
              value={price}
              onChange={(e) => setPrice(Number(e.target.value))}
            />
          </label>
        </div>
        {tradeOrg && (
          <span className="mu small">
            At least {TRADE_ORG_ARMY.pricePerSoldierWeek} Coins a week each.
          </span>
        )}
        {npc && (
          <span className="mu small">
            {npc.hire!.spare === 0
              ? 'It can spare nobody now: it lends only its spare hands, and nobody while it weighs a demand, its town hall is occupied or your armed residents are near it'
              : `It can spare ${npc.hire!.spare}`}
            , at least {npc.hire!.pricePerResidentWeek} Coins a week each.
          </span>
        )}
        <label className="fld">
          <span className="lb">Paid into</span>
          <select value={storageId} onChange={(e) => setStorageId(e.target.value)}>
            <option value="">Pay into the {tradeOrg ? 'warehouse' : 'storage'}…</option>
            {storages.map((b) => (
              <option key={b.id} value={b.id}>
                {storageName(b, cities, storages)}
              </option>
            ))}
          </select>
        </label>
        <p className="well dip-summary" aria-live="polite">
          {summary.text}
        </p>
        <button type="submit" className="btn pri" disabled={!summary.complete}>
          {hiring ? 'Ask' : 'Offer'}
        </button>
      </form>
      {error && <p className="error dip-error">{error}</p>}
      <p className="sec mu small dip-foot">
        Each week is paid in advance; a week left unpaid breaks the contract and the mercenaries
        walk home.
      </p>
    </section>
  )
}
