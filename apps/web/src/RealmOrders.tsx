import { useState } from 'react'
import type { Good, ScriptSummary } from '@csp/shared-types'
import { SelectionCard } from './SelectionCard.js'
import { CityPicker, RunScript } from './Residents.js'
import { GOOD_LABELS } from './goods-grid.js'
import type { RelocateChoice } from './relocate-view.js'
import { heldGoods, realmTileOrders, type StorePlace } from './realm-orders-view.js'

/**
 * Run script on the realm bar (`CONTEXT.md`: Realm order): pick the script (Customise beside it
 * opens its form), then its form if it needs values, then who runs it.
 */
export function RealmScriptCard({
  scripts,
  onRun,
  onClose,
}: {
  scripts: ScriptSummary[]
  onRun: (scriptId: number) => void
  onClose: () => void
}) {
  return (
    <SelectionCard
      rel="own"
      title="Run script"
      lines={['Pick the script, then who runs it.']}
      onClose={onClose}
    >
      <section className="inspector-block" aria-label="Run script">
        <RunScript
          script={undefined}
          scripts={scripts}
          label="Script to run"
          customisable
          onRunScript={onRun}
        />
      </section>
    </SelectionCard>
  )
}

/** Relocate on the realm bar (`CONTEXT.md`: Relocate): pick the city, then who moves there. */
export function RealmRelocateCard({
  choices,
  onRelocate,
  onClose,
}: {
  choices: RelocateChoice[]
  onRelocate: (cityId: string) => void
  onClose: () => void
}) {
  return (
    <SelectionCard
      rel="own"
      title="Relocate"
      lines={['Pick the city, then who moves there.']}
      onClose={onClose}
    >
      <section className="inspector-block" aria-label="Relocate">
        {choices.length === 0 ? (
          <p className="muted small">Can’t relocate: your realm has no other city.</p>
        ) : (
          <>
            <p className="small">
              They walk there and move in on stepping into its area, while it still has free
              housing. Moving ends a pair.
            </p>
            <CityPicker choices={choices} onRelocate={onRelocate} />
          </>
        )}
      </section>
    </SelectionCard>
  )
}

/**
 * The realm orders on a tile's card in realm control mode (`CONTEXT.md`: Realm order): Walk
 * here, Build here on a tile with no building, and at a storage, stable, haven, carriage or boat
 * of the realm Store here and Fetch from here, the good picked from what it holds. Each goes on
 * to the who-list.
 */
export function RealmTileOrders({
  building,
  place,
  onWalk,
  onBuild,
  onStore,
  onFetch,
}: {
  /** Whether a building stands on the tile. */
  building: boolean
  place: StorePlace | undefined
  onWalk: () => void
  onBuild: () => void
  onStore: (place: StorePlace) => void
  onFetch: (place: StorePlace, good: Good) => void
}) {
  const [fetching, setFetching] = useState(false)
  const goods = place ? heldGoods(place.holds) : []
  const [good, setGood] = useState<Good>()
  const picked = good && goods.includes(good) ? good : goods[0]
  return (
    <section className="inspector-block realm-tile-orders" aria-label="Realm orders">
      <div className="order-buttons">
        {realmTileOrders({ building, place }).map((o) => (
          <button
            key={o.id}
            type="button"
            disabled={o.reason !== undefined}
            title={o.reason ? `Can’t: ${o.reason}` : undefined}
            aria-pressed={o.id === 'fetchFrom' ? fetching : undefined}
            onClick={() => {
              if (o.id === 'walkHere') onWalk()
              if (o.id === 'buildHere') onBuild()
              if (o.id === 'storeHere' && place) onStore(place)
              if (o.id === 'fetchFrom') setFetching(!fetching)
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
      {fetching && place && picked && (
        <div className="order-buttons">
          <select
            aria-label="Good to fetch"
            value={picked}
            onChange={(e) => setGood(e.target.value as Good)}
          >
            {goods.map((g) => (
              <option key={g} value={g}>
                {GOOD_LABELS[g]} · {place.holds[g]}
              </option>
            ))}
          </select>
          <button type="button" className="primary" onClick={() => onFetch(place, picked)}>
            Fetch
          </button>
        </div>
      )}
    </section>
  )
}
