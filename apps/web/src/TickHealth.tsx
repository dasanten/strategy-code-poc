import { useEffect, useState } from 'react'
import type { Percentiles, WindowStats } from '@csp/shared-types'
import { api } from './api.js'
import {
  TICK_HEALTH_POLL_MS,
  formatMs,
  phasesSlowestFirst,
  pollTickHealth,
  type TickHealthState,
} from './tick-health.js'

/**
 * The admin panel's Tick health tab (ADR 0004): how long the live world's ticks took in the last
 * minute and the last hour, as the server keeps them. Fetched when the tab opens and every 10 s
 * while it stays open.
 */
export function TickHealthPanel() {
  const [state, setState] = useState<TickHealthState>({})
  useEffect(() => pollTickHealth(() => api.tickHealth(), setState), [])
  return <TickHealthView {...state} />
}

/** The tick health as shown, from the last answer, when it came and the last failure. */
export function TickHealthView({ health, fetchedAt, error }: TickHealthState) {
  return (
    <section className="admin-panel tick-health" aria-label="Tick health">
      <h2>Tick health</h2>
      <p className="muted small">
        {fetchedAt === undefined
          ? 'Not fetched yet.'
          : `Fetched at ${new Date(fetchedAt).toLocaleTimeString('en-GB')}.`}{' '}
        Fetched again every {TICK_HEALTH_POLL_MS / 1000} s while this tab is open.
        {health && ` A phase whose p95 is over ${formatMs(health.slowTickMs)} is marked slow.`}
      </p>
      {error && (
        <p role="alert" className="error">
          {`Could not fetch the tick health: ${error}`}
        </p>
      )}
      {health && (
        <div className="tick-health-windows">
          <TickWindow title="Last minute" stats={health.lastMinute} slowMs={health.slowTickMs} />
          <TickWindow title="Last hour" stats={health.lastHour} slowMs={health.slowTickMs} />
        </div>
      )}
    </section>
  )
}

/** One window: the tick, the residents and the script runs, then the phases slowest first. */
function TickWindow({
  title,
  stats,
  slowMs,
}: {
  title: string
  stats: WindowStats
  slowMs: number
}) {
  const count = (n: number) => String(n)
  return (
    <div className="tick-health-window" aria-label={title}>
      <h3>{title}</h3>
      <ul className="codes">
        <li>{`${stats.ticks} ${stats.ticks === 1 ? 'tick' : 'ticks'}, ${stats.slow} slow`}</li>
      </ul>
      {stats.ticks > 0 && (
        <>
          <table>
            <thead>
              <tr>
                <th />
                <th>p50</th>
                <th>p95</th>
                <th>max</th>
              </tr>
            </thead>
            <tbody>
              <Row name="Tick" p={stats.durationMs} show={formatMs} />
              <Row name="Residents" p={stats.residents} show={count} />
              <Row name="Script runs" p={stats.scriptRuns} show={count} />
            </tbody>
          </table>
          <table aria-label={`Phases, ${title.toLowerCase()}`}>
            <thead>
              <tr>
                <th>Phase</th>
                <th>p50</th>
                <th>p95</th>
              </tr>
            </thead>
            <tbody>
              {phasesSlowestFirst(stats).map(([phase, p]) => {
                const slow = p.p95 > slowMs
                return (
                  <tr key={phase} className={slow ? 'slow' : undefined}>
                    <th>{slow ? `${phase} (slow)` : phase}</th>
                    <td>{formatMs(p.p50)}</td>
                    <td>{formatMs(p.p95)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

function Row({ name, p, show }: { name: string; p: Percentiles; show: (n: number) => string }) {
  return (
    <tr>
      <th>{name}</th>
      <td>{show(p.p50)}</td>
      <td>{show(p.p95)}</td>
      <td>{show(p.max)}</td>
    </tr>
  )
}
