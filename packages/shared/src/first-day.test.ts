import { describe, expect, it } from 'vitest'
import {
  FIRST_DAY_LINES,
  firstDayShown,
  isClientFirstDayLine,
  isFirstDayLine,
  tickFirstDay,
  type FirstDay,
} from './first-day.js'

const fresh: FirstDay = { done: [], dismissed: false }

describe('the first-day card', () => {
  it('shows for a new Player, with nothing ticked', () => {
    expect(firstDayShown(fresh)).toBe(true)
  })

  it('ticks each line once, kept in the card’s order whatever order they were done in', () => {
    const card = tickFirstDay(tickFirstDay(fresh, 'openWiki'), 'claimHorses')
    expect(card.done).toEqual(['claimHorses', 'openWiki'])
    expect(tickFirstDay(card, 'openWiki')).toBe(card)
  })

  it('goes for good once every line is ticked', () => {
    const card = FIRST_DAY_LINES.reduce(tickFirstDay, fresh)
    expect(card.done).toEqual([...FIRST_DAY_LINES])
    expect(firstDayShown(card)).toBe(false)
  })

  it('goes for good once dismissed, however few lines are ticked', () => {
    expect(firstDayShown({ done: ['claimHorses'], dismissed: true })).toBe(false)
  })

  it('lets the client report only picking a resident and opening the Wiki', () => {
    expect(FIRST_DAY_LINES.filter(isClientFirstDayLine)).toEqual(['pickResident', 'openWiki'])
    expect(isClientFirstDayLine('claimHorses')).toBe(false)
    expect(isClientFirstDayLine('constructor')).toBe(false)
    expect(isFirstDayLine('giveOrder')).toBe(true)
    expect(isFirstDayLine(3)).toBe(false)
  })
})
