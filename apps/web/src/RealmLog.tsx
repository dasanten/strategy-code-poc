import { formatGameTime, type RealmEvent } from '@csp/shared'
import { describeEvent, type EventPlace } from './realm-log.js'

/**
 * What happened in the Player's realm, newest first: hunger, deaths, spoilage. A place an event
 * names, such as a city their dead Leader left behind, can be found on the map from here.
 */
export function RealmLog({
  events,
  realmId,
  onShowPlace,
}: {
  events: RealmEvent[]
  realmId: string
  /** Called with a place the Player wants to see on the map. */
  onShowPlace?: (place: EventPlace) => void
}) {
  return (
    <section className="realm-log" aria-label="Realm log">
      <div className="panel-head">
        <h2>Realm log</h2>
        <span>{events.length === 0 ? 'nothing yet' : `${events.length} events`}</span>
      </div>
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
