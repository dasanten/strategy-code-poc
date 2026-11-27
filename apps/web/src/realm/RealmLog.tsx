import type { DeliveryView, RealmEvent } from '@csp/shared-types'
import { describeDelivery, describeEvent, logDays, type EventPlace } from './realm-log.js'
import { PanelHead } from '../ui/panel-head.js'
import { Icon } from '../ui/Icon.js'

/**
 * What happened in the Player's realm, newest first under a heading for each game day: hunger,
 * deaths, spoilage, each in its tone. A place an event names, such as a city their dead Leader left
 * behind, can be found on the map from here. Above it, the realm's deliveries and pick-ups not yet
 * done (`CONTEXT.md`: Delivery).
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
      <PanelHead title="Realm log">
        {events.length === 0 ? 'nothing yet' : `${events.length} events`}
      </PanelHead>
      {deliveries.length > 0 && (
        <div className="sec">
          <span className="lb">Open deliveries</span>
          <ul className="col realm-log-deliveries" aria-label="Open deliveries">
            {deliveries.map((d) => (
              <li key={d.id} className="fx">
                <Icon name="cart" size={16} />
                <span className="grow">{describeDelivery(d)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ol className="realm-log-days" aria-live="polite">
        {logDays(events).map(({ day, events: those }) => (
          <li key={day}>
            <div className="rw grp">
              <span className="lb grow">{day}</span>
            </div>
            <ol aria-label={day}>
              {those.map(({ event, time }) => {
                const { text, tone, places } = describeEvent(event, realmId)
                return (
                  <li key={event.seq} className={`rw realm-log-event ${tone}`}>
                    <time className="mono">{time}</time>
                    <span className="grow">
                      <span className={tone === 'bad' ? 'bad' : undefined}>{text}</span>
                      {onShowPlace && places && places.length > 0 && (
                        <span className="fx wrap realm-log-places">
                          {places.map((p) => (
                            <button
                              key={`${p.x},${p.y}`}
                              type="button"
                              className="btn sm place"
                              title={`Show ${p.name} at (${p.x}, ${p.y}) on the map`}
                              onClick={() => onShowPlace(p)}
                            >
                              {p.name}
                            </button>
                          ))}
                        </span>
                      )}
                    </span>
                  </li>
                )
              })}
            </ol>
          </li>
        ))}
      </ol>
    </section>
  )
}
