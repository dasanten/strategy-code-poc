import { describe, expect, it } from 'vitest'
import { goalProgress } from './admin-directives.js'

describe('how far a directive goal has come', () => {
  it('says met or not yet for a city, without a meter', () => {
    const city = { kind: 'city', cityId: 'c1', city: 'Mirefield', met: false } as const
    expect(goalProgress({ soldiersKilled: 0 }, city)).toEqual({ text: 'not yet', met: false })
    expect(goalProgress({ soldiersKilled: 0 }, { ...city, met: true })).toEqual({
      text: 'met',
      met: true,
    })
  })

  it('counts soldiers killed against the goal, with the share for its meter', () => {
    const goal = { kind: 'soldiers', count: 12, percent: 40 } as const
    expect(goalProgress({ soldiersKilled: 7 }, goal)).toEqual({
      text: '7 of 12 killed',
      met: false,
      done: 7 / 12,
    })
  })

  it('stops at the goal once more are killed than it asks', () => {
    expect(goalProgress({ soldiersKilled: 30 }, { kind: 'soldiers', count: 10 })).toEqual({
      text: '10 of 10 killed, met',
      met: true,
      done: 1,
    })
  })
})
