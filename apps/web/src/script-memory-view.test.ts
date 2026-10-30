import { describe, expect, it } from 'vitest'
import { MEMORY_TEXT_SHOWN, memoryRows } from './script-memory-view.js'

describe('memoryRows', () => {
  it('shows the memory as a tree, one row per value', () => {
    const memory = { n: 3, at: { x: 4, y: 5 }, path: [true, null], role: 'miner' }
    expect(memoryRows(memory)).toEqual({
      rows: [
        { depth: 0, name: 'n', value: '3' },
        { depth: 0, name: 'at', size: '2 fields' },
        { depth: 1, name: 'x', value: '4' },
        { depth: 1, name: 'y', value: '5' },
        { depth: 0, name: 'path', size: '2 items' },
        { depth: 1, name: '0', value: 'true' },
        { depth: 1, name: '1', value: 'null' },
        { depth: 0, name: 'role', value: '"miner"' },
      ],
      cut: 0,
    })
  })

  it('cuts large memory and long text, saying how much is left out', () => {
    const memory = { tiles: Array.from({ length: 10 }, (_, i) => i), note: 'x'.repeat(100) }
    const { rows, cut } = memoryRows(memory, 5)
    expect(rows).toHaveLength(5)
    expect(rows[0]).toEqual({ depth: 0, name: 'tiles', size: '10 items' })
    // The 10 items and the note: 11 rows, of which 4 are shown.
    expect(cut).toBe(7)
    const note = memoryRows({ note: 'x'.repeat(100) }).rows[0]!
    expect(note.value).toBe(`"${'x'.repeat(MEMORY_TEXT_SHOWN)}…"`)
  })
})
