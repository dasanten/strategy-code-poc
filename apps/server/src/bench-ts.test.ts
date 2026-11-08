import { describe, expect, it } from 'vitest'
import { TICK_PHASES } from './tick.js'
import { benchSim } from '../../../scripts/bench-ts.mjs'

describe('scripts/bench-ts.mts', () => {
  it('sim village 10 runs and prints every phase', async () => {
    const lines: string[] = []
    const { totals } = await benchSim('village', 10, (line) => lines.push(line))
    expect(totals).toHaveLength(10)
    const printed = lines.join('\n')
    for (const phase of TICK_PHASES) expect(printed).toContain(`| ${phase} `)
    expect(printed).toContain('tick (total)')
    expect(printed).toContain('ms per tick per resident')
  })
})
