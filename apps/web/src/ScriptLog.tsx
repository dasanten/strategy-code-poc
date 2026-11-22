import { useEffect } from 'react'
import { formatGameTime } from './shared/time.js'
import type { ScriptLogLine } from '@csp/shared-types'

/**
 * A resident's script log on their Script tab, newest first (`CONTEXT.md`: Script log): what
 * their scripts gave `log()` and `end(reason)`. The server sends it while this shows (`watch`),
 * and only to the Player owning the resident.
 */
export function ScriptLog({
  id,
  lines,
  watch,
}: {
  /** The resident. */
  id: string
  /** As last sent; undefined until it arrives, null for a resident of another Player's. */
  lines: ScriptLogLine[] | null | undefined
  /** Watches the resident's script; the function it returns stops it. */
  watch: (id: string) => () => void
}) {
  useEffect(() => watch(id), [id, watch])
  if (!lines) return null
  return (
    <section className="sec script-log" aria-label="Script log">
      <h3 className="px t16">Script log</h3>
      {lines.length === 0 ? (
        <p className="muted small">Empty: lines a script gives log() show here.</p>
      ) : (
        <ul className="mono script-log-lines" aria-label="Script log">
          {lines.toReversed().map((l, i) => (
            <li key={lines.length - i}>
              <time className="muted">{formatGameTime(l.tick)}</time> {l.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
