import { useEffect } from 'react'
import { SCRIPT_MEMORY_MAX, type ScriptMemory } from '@csp/shared'
import { memoryRows } from './script-memory-view.js'

/**
 * The memory of the script a resident or army runs, read-only and live on its Script tab
 * (`CONTEXT.md`: Debugging a script). The server sends it while this shows (`watch`), and only
 * to the Player running the script; large memory is shown cut.
 */
export function ScriptMemoryTree({
  id,
  memory,
  watch,
}: {
  /** The resident or army. */
  id: string
  /** As last sent; undefined until it arrives, null when it runs none of the Player's scripts. */
  memory: ScriptMemory | null | undefined
  /** Watches the script's memory; the function it returns stops it. */
  watch: (id: string) => () => void
}) {
  useEffect(() => watch(id), [id, watch])
  // Not there yet, or someone else's script, as an ally's resident runs: nothing to show.
  if (!memory) return null
  const { rows, cut } = memoryRows(memory)
  return (
    <div className="sel-order-group script-memory">
      <h3>Memory</h3>
      {rows.length === 0 ? (
        <p className="muted small">Empty: the script keeps nothing between ticks yet.</p>
      ) : (
        <ul className="memory-tree" aria-label="Script memory">
          {rows.map((r, i) => (
            <li key={i} style={{ paddingLeft: `${r.depth * 12}px` }}>
              <span className="memory-name">{r.name}</span>{' '}
              {r.value !== undefined ? r.value : <span className="muted">{r.size}</span>}
            </li>
          ))}
        </ul>
      )}
      {cut > 0 && (
        <p className="muted small">
          {cut} more not shown. A script keeps up to {SCRIPT_MEMORY_MAX} characters.
        </p>
      )}
    </div>
  )
}
