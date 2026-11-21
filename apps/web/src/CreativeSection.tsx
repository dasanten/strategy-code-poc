import { useState } from 'react'
import type { CreativeAction, Good } from '@csp/shared-types'
import { api, ApiFailure } from './api.js'
import { creativeAmount, type CreativeOffer } from './creative-section.js'
import { GOOD_LABELS } from './goods-grid.js'

const GOODS = Object.keys(GOOD_LABELS) as Good[]

/**
 * The Creative section on a building's or carriage's card (`CONTEXT.md`: Creative mode): give or
 * take goods and finish now, by hand, for any realm. Shown only to admins on a server started
 * with `CREATIVE=1`; the server refuses every other caller. What it changes shows with the next
 * tick (step a paused world to see it).
 */
export function CreativeSection({ offer }: { offer: CreativeOffer }) {
  const [holderId, setHolderId] = useState(offer.holders[0]?.id)
  const [good, setGood] = useState<Good>('wood')
  const [amount, setAmount] = useState('100')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<{ text: string; error?: boolean }>()
  const holder = offer.holders.find((h) => h.id === holderId) ?? offer.holders[0]
  const units = creativeAmount(amount)

  const act = (action: CreativeAction) => {
    setBusy(true)
    api
      .creativeAct(action)
      .then((done) => {
        const broken = done.violations.length
        setSaid(
          broken
            ? {
                text: `${done.message} Invariants broken: ${done.violations.join('; ')}`,
                error: true,
              }
            : { text: done.message },
        )
      })
      .catch((e: unknown) => setSaid({ text: message(e), error: true }))
      .finally(() => setBusy(false))
  }

  return (
    <section className="card-creative" aria-label="Creative">
      <h3 title="Creative mode: for testing, never play">Creative</h3>
      {holder && (
        <div className="card-creative-goods">
          {offer.holders.length > 1 ? (
            <select
              aria-label="Where"
              value={holder.id}
              onChange={(e) => setHolderId(e.target.value)}
            >
              {offer.holders.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label}
                </option>
              ))}
            </select>
          ) : (
            <span className="muted">{holder.label}</span>
          )}
          <select aria-label="Good" value={good} onChange={(e) => setGood(e.target.value as Good)}>
            {GOODS.map((g) => (
              <option key={g} value={g}>
                {GOOD_LABELS[g]}
              </option>
            ))}
          </select>
          <input
            aria-label="Units"
            type="number"
            min={1}
            step={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <button
            type="button"
            disabled={busy || units === undefined}
            onClick={() =>
              units && act({ action: 'giveGoods', holderId: holder.id, good, amount: units })
            }
          >
            Give
          </button>
          <button
            type="button"
            disabled={busy || units === undefined}
            onClick={() =>
              units && act({ action: 'takeGoods', holderId: holder.id, good, amount: units })
            }
          >
            Take
          </button>
        </div>
      )}
      {offer.finish && (
        <button
          type="button"
          disabled={busy}
          title={offer.finish.title}
          onClick={() => act({ action: 'finishNow', buildingId: offer.finish!.buildingId })}
        >
          {offer.finish.label}
        </button>
      )}
      {said && (
        <p className={`small ${said.error ? 'card-creative-error' : 'muted'}`} role="status">
          {said.text}
        </p>
      )}
    </section>
  )
}

function message(e: unknown): string {
  return e instanceof ApiFailure || e instanceof Error ? e.message : String(e)
}
