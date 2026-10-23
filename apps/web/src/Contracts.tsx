import { useState, type FormEvent } from 'react'
import {
  CONTRACT_MAX_DAYS,
  TRADE_ORG,
  TRADE_ORG_ARMY,
  type Building,
  type SeenCity,
  type ContractView,
  type OrderRequest,
  type RealmLabel,
  type Resident,
  isAt,
  type SeenResident,
} from '@csp/shared'
import { contractStatus, sideName } from './contract-view.js'

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
  buildings,
  cities,
  realms,
  sendOrder,
}: {
  contracts: ContractView[]
  realmId: string
  /** The residents whose orders the Player gives. */
  own: Resident[]
  /** Everyone in sight, the Player's own included. */
  inSight: SeenResident[]
  buildings: Building[]
  /** Cities in sight; an NPC city that doesn't refuse the Player says what it would lend. */
  cities: SeenCity[]
  /** Realms the Player could make a contract with. */
  realms: RealmLabel[]
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
  const candidates =
    tradeOrg || npc
      ? []
      : hiring
        ? inSight.filter((r) => r.owner === other)
        : own.filter((r) => r.owner === realmId)
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
    <section className="alliance-panel" aria-label="Mercenary contracts">
      <div className="panel-head">
        <h2>Mercenaries</h2>
        <span>{contracts.length === 0 ? 'none' : contracts.length}</span>
      </div>
      {contracts.length > 0 && (
        <ul className="alliance-list">
          {contracts.map((c) => {
            const lender = c.lender.realmId === realmId
            const otherSide = lender ? c.hirer : c.lender
            const offered = c.startedAt === null
            const theirOffer =
              offered && (c.offeredBy === 'lender' ? c.lender : c.hirer).realmId !== realmId
            const payers =
              !lender && !offered && c.paidWeeks < c.weeks && c.storage
                ? own.filter(
                    (r) =>
                      isAt(r, { kind: 'storage', ...c.storage! }) &&
                      (r.carried.coins ?? 0) >= c.pricePerWeek,
                  )
                : []
            return (
              <li key={c.id} className="army">
                <span>
                  <strong>
                    {lender ? 'Rented to' : 'Hired from'} {sideName(otherSide, cities)}
                  </strong>
                  <br />
                  {c.residents.map((r) => r.name).join(', ')}
                  <br />
                  <span className="muted small">
                    {c.days} days at {c.pricePerWeek} Coins a week, paid into the{' '}
                    {c.lender.realmId === TRADE_ORG ? 'warehouse' : 'storage'}
                    {c.storage ? ` at ${c.storage.x}, ${c.storage.y}` : ' (gone)'} ·{' '}
                    {contractStatus(c, realmId)}
                  </span>
                </span>
                <div className="order-buttons">
                  {theirOffer && (
                    <button
                      type="button"
                      onClick={() => order({ kind: 'acceptContract', contractId: c.id })}
                    >
                      Accept
                    </button>
                  )}
                  {offered && (
                    <button
                      type="button"
                      onClick={() => order({ kind: 'cancelContract', contractId: c.id })}
                    >
                      {theirOffer ? 'Decline' : 'Withdraw'}
                    </button>
                  )}
                  {payers.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() =>
                        order({ kind: 'pay', residentId: r.id, contractId: c.id, weeks: 1 })
                      }
                    >
                      {r.name} pays a week
                    </button>
                  ))}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <form onSubmit={offer}>
        <fieldset className="army-members">
          <legend>{hiring ? 'Ask to hire' : 'Offer for hire'}</legend>
          <label>
            <input type="radio" checked={!hiring} onChange={() => switchMode(false)} />
            Rent out mine
          </label>
          <label>
            <input type="radio" checked={hiring} onChange={() => switchMode(true)} />
            Hire theirs
          </label>
          <select
            aria-label="Realm"
            value={other}
            onChange={(e) => {
              setOther(e.target.value)
              if (hiring) {
                setChosen(new Set())
                setStorageId('')
              }
            }}
          >
            <option value="">Pick a realm…</option>
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
          {tradeOrg && (
            <label>
              Soldiers{' '}
              <input
                type="number"
                min={1}
                value={soldiers}
                onChange={(e) => setSoldiers(Number(e.target.value))}
              />{' '}
              <span className="muted small">
                at least {TRADE_ORG_ARMY.pricePerSoldierWeek} Coins a week each
              </span>
            </label>
          )}
          {npc && (
            <label>
              Residents{' '}
              <input
                type="number"
                min={1}
                max={Math.max(1, npc.hire!.spare)}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />{' '}
              <span className="muted small">
                it can spare {npc.hire!.spare}, at least {npc.hire!.pricePerResidentWeek} Coins a
                week each
              </span>
            </label>
          )}
          {candidates.map((r) => (
            <label key={r.id}>
              <input type="checkbox" checked={chosen.has(r.id)} onChange={() => toggle(r.id)} />
              {r.name}
            </label>
          ))}
          <label>
            Days{' '}
            <input
              type="number"
              min={1}
              max={CONTRACT_MAX_DAYS}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            />
          </label>
          <label>
            Coins a week{' '}
            <input
              type="number"
              min={1}
              value={price}
              onChange={(e) => setPrice(Number(e.target.value))}
            />
          </label>
          <select
            aria-label="Storage to pay into"
            value={storageId}
            onChange={(e) => setStorageId(e.target.value)}
          >
            <option value="">Pay into the {tradeOrg ? 'warehouse' : 'storage'}…</option>
            {storages.map((b) => (
              <option key={b.id} value={b.id}>
                {tradeOrg ? 'Warehouse' : 'Storage'} at {b.x}, {b.y}
              </option>
            ))}
          </select>
        </fieldset>
        <button
          type="submit"
          disabled={(!tradeOrg && !npc && chosen.size === 0) || !other || !storageId}
        >
          {hiring ? 'Ask' : 'Offer'}
        </button>
      </form>
      <p className="muted small">
        Each week is paid in advance; a week left unpaid breaks the contract and the mercenaries
        walk home.
      </p>
      {error && <p className="error">{error}</p>}
    </section>
  )
}
