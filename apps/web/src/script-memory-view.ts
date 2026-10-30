import type { MemoryValue, ScriptMemory } from '@csp/shared'

/**
 * The Script tab's view of a running script's memory (`CONTEXT.md`: Debugging a script): a
 * read-only tree, one row per value, cut when large.
 */

/** The most rows of memory the Script tab shows; the rest is left out with a note. */
export const MEMORY_ROWS_SHOWN = 40

/** The most characters of a text value the Script tab shows. */
export const MEMORY_TEXT_SHOWN = 60

/**
 * One row of the memory tree: a field's name or a list's index, indented by `depth`, and its
 * value when plain; a list or object row has `size` instead, its rows following it one deeper.
 */
export interface MemoryRow {
  depth: number
  name: string
  value?: string
  size?: string
}

/** A plain value as the Script tab writes it: text quoted and cut, the rest as in a script. */
function shownValue(v: number | string | boolean | null): string {
  if (typeof v !== 'string') return String(v)
  const cut = v.length > MEMORY_TEXT_SHOWN ? `${v.slice(0, MEMORY_TEXT_SHOWN)}…` : v
  return JSON.stringify(cut)
}

/**
 * The memory as rows, in the order its fields were set, with how many more rows there are than
 * `max` shows (`cut`).
 */
export function memoryRows(
  memory: ScriptMemory,
  max = MEMORY_ROWS_SHOWN,
): { rows: MemoryRow[]; cut: number } {
  const rows: MemoryRow[] = []
  let cut = 0
  const add = (row: MemoryRow) => {
    if (rows.length < max) rows.push(row)
    else cut++
  }
  const walk = (entries: [string, MemoryValue][], depth: number) => {
    for (const [name, v] of entries) {
      if (Array.isArray(v)) {
        add({ depth, name, size: v.length === 1 ? '1 item' : `${v.length} items` })
        walk(
          v.map((e, i) => [String(i), e]),
          depth + 1,
        )
      } else if (v !== null && typeof v === 'object') {
        const n = Object.keys(v).length
        add({ depth, name, size: n === 1 ? '1 field' : `${n} fields` })
        walk(Object.entries(v), depth + 1)
      } else add({ depth, name, value: shownValue(v) })
    }
  }
  walk(Object.entries(memory), 0)
  return { rows, cut }
}
