import { formatGameTime, type RealmEvent } from '@csp/shared'
import { describeEvent } from './realm-log.js'

/** What happened in the Player's realm, newest first: hunger, deaths, spoilage. */
export function RealmLog({ events }: { events: RealmEvent[] }) {
  return (
    <section className="realm-log" aria-label="Realm log">
      <div className="panel-head">
        <h2>Realm log</h2>
        <span>{events.length === 0 ? 'nothing yet' : `${events.length} events`}</span>
      </div>
      <ol className="realm-log-list" aria-live="polite">
        {[...events].reverse().map((e) => {
          const { text, tone } = describeEvent(e)
          return (
            <li key={e.seq} className={tone}>
              <time className="mono">{formatGameTime(e.tick)}</time>
              <span>{text}</span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
