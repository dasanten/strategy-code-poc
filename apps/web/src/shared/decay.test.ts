import { describe, expect, it } from 'vitest'
import { DECAY_NEARLY_RUIN, DECAY_WORN, TICKS_PER_GAME_DAY } from '@csp/balance'
import { conditionOf, DECAY_DAYS, repairable, repairMaterials, repairWork } from './decay.js'

describe('decay (`CONTEXT.md`: Decay, Repairing)', () => {
  it('reads a building’s condition in words, none for a site or a kind that never decays', () => {
    expect(conditionOf({ kind: 'house' })).toBe('good')
    expect(conditionOf({ kind: 'house', decay: DECAY_WORN })).toBe('worn')
    expect(conditionOf({ kind: 'house', decay: DECAY_NEARLY_RUIN })).toBe('nearlyRuin')
    expect(conditionOf({ kind: 'house', decay: 0.5, site: { delivered: {}, work: 0 } })).toBe(
      undefined,
    )
    expect(conditionOf({ kind: 'carriage' })).toBe(undefined)
  })

  it('goes fastest for roads and wooden walls, slowest for stone', () => {
    expect(DECAY_DAYS.road).toBe(DECAY_DAYS.wall)
    expect(DECAY_DAYS.road!).toBeLessThan(DECAY_DAYS.house!)
    expect(DECAY_DAYS.house!).toBeLessThan(DECAY_DAYS.smithy!)
  })

  it('repairs a worn building, or one being repaired, for a share of its materials and work', () => {
    expect(repairable({ kind: 'house' })).toBe(false)
    expect(repairable({ kind: 'house', decay: 0.5 })).toBe(true)
    expect(repairable({ kind: 'house', repair: { delivered: {}, work: 0 } })).toBe(true)
    expect(repairMaterials('house')).toEqual({ wood: 5 })
    expect(repairMaterials('road')).toEqual({ stone: 1 })
    expect(repairMaterials('farm')).toEqual({})
    expect(repairWork('house')).toBe(TICKS_PER_GAME_DAY / 4)
  })
})
