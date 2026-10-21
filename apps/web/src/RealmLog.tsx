import { formatGameTime, type DeliveryView, type RealmEvent } from '@csp/shared'
import { describeDelivery, describeEvent, type EventPlace } from './realm-log.js'

/**
 * What happened in the Player's realm, newest first: hunger, deaths, spoilage. A place an event
 * names, such as a city their dead Leader left behind, can be found on the map from here. Above
 * it, the realm's deliveries and pick-ups not yet done (`CONTEXT.md`: Delivery).
 */
export function RealmLog({
  events,
  realmId,
  deliveries = [],
  onShowPlace,
}: {
  events: RealmEvent[]
  realmId: string
  deliveries?: DeliveryView[]
  /** Called with a place the Player wants to see on the map. */
  onShowPlace?: (place: EventPlace) => void
}) {
  return (
    <section className="realm-log" aria-label="Realm log">
      <div className="panel-head">
        <h2>Realm log</h2>
        <span>{events.length === 0 ? 'nothing yet' : `${events.length} events`}</span>
      </div>
      {deliveries.length > 0 && (
        <ul className="realm-log-list" aria-label="Open deliveries">
          {deliveries.map((d) => (
            <li key={d.id} className="info">
              <span>{describeDelivery(d)}</span>
            </li>
          ))}
        </ul>
      )}
      <ol className="realm-log-list" aria-live="polite">
        {[...events].reverse().map((e) => {
          const { text, tone, places } = describeEvent(e, realmId)
          return (
            <li key={e.seq} className={tone}>
              <time className="mono">{formatGameTime(e.tick)}</time>
              <span>
                {text}
                {onShowPlace &&
                  places?.map((p) => (
                    <button
                      key={`${p.x},${p.y}`}
                      type="button"
                      className="place"
                      title={`Show ${p.name} at (${p.x}, ${p.y}) on the map`}
                      onClick={() => onShowPlace(p)}
                    >
                      {p.name}
                    </button>
                  ))}
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
