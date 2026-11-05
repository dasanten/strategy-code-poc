import { aboutTime } from '@csp/shared'
import { describe, expect, it } from 'vitest'
import {
  LANE_GAP,
  MIN_LANE_WIDTH,
  NOTICE_ORDER,
  cardHidden,
  firstDayView,
  laneNotices,
  laneSpot,
  skippedByWhy,
  traderVisitLine,
  visitKey,
} from './notices-view.js'

describe('the notice lane', () => {
  it('shows nothing when no notice wants to', () => {
    expect(laneNotices({})).toEqual([])
    expect(laneNotices({ pick: false, horseOffer: false })).toEqual([])
  })

  it('shows the pick banner in place of every other notice', () => {
    expect(laneNotices({ pick: true, horseOffer: true, groupReport: true })).toEqual(['pick'])
  })

  it('brings the others back once the pick banner goes', () => {
    const wanted = { horseOffer: true, groupReport: true }
    expect(laneNotices({ ...wanted, pick: true })).toEqual(['pick'])
    expect(laneNotices({ ...wanted, pick: false })).toEqual(['horseOffer', 'groupReport'])
  })

  it('says where a wandering trader stands and for how long, with a key for its one stop', () => {
    const visit = { traderId: 't1', cityId: 'c1', city: 'Ashford', x: 40, y: 50, until: 1_000 }
    expect(traderVisitLine(visit, 940)).toBe(
      `A wandering trader stands at Ashford, at (40, 50), and goes on in ${aboutTime(60)}`,
    )
    expect(visitKey(visit)).not.toBe(visitKey({ ...visit, until: 2_000 }))
    expect(laneNotices({ groupReport: true, traderVisit: true })).toEqual([
      'traderVisit',
      'groupReport',
    ])
  })

  it('stacks several notices in their order, whatever order they were asked in', () => {
    expect(laneNotices({ groupReport: true, horseOffer: true })).toEqual([
      'horseOffer',
      'groupReport',
    ])
    expect(laneNotices({ groupReport: true })).toEqual(['groupReport'])
  })

  it('keeps the lasting Horse offer above a passing group report', () => {
    expect(NOTICE_ORDER.indexOf('horseOffer')).toBeLessThan(NOTICE_ORDER.indexOf('groupReport'))
  })

  it('puts the first-day card under the Horse offer, above a group report', () => {
    expect(laneNotices({ groupReport: true, firstDay: true, horseOffer: true })).toEqual([
      'horseOffer',
      'firstDay',
      'groupReport',
    ])
    expect(laneNotices({ firstDay: true, pick: true })).toEqual(['pick'])
  })
})

describe('the card behind a drawer', () => {
  it('is hidden while the wide Scripts drawer is open', () => {
    expect(cardHidden('scripts')).toBe(true)
  })

  it('hides behind the full Residents list', () => {
    expect(cardHidden('residents', true)).toBe(true)
  })

  it('shows beside any other drawer and with none open', () => {
    expect(cardHidden(undefined)).toBe(false)
    expect(cardHidden('residents')).toBe(false)
    expect(cardHidden('realmLog')).toBe(false)
  })
})

describe('where the lane goes', () => {
  const rail = 48

  it('sits over the map between the open drawer and the card', () => {
    expect(laneSpot(1600, rail, { left: 428, right: 372 }, false)).toEqual({
      left: 428 + LANE_GAP,
      right: 372 + LANE_GAP,
      band: false,
    })
  })

  it('starts after the rail when no drawer is open, and at the edge with no card', () => {
    expect(laneSpot(1600, rail, { left: 0, right: 0 }, false)).toEqual({
      left: rail + LANE_GAP,
      right: LANE_GAP,
      band: false,
    })
  })

  it('becomes a band under the top bar when the map between leaves too little room', () => {
    // The wide drawer on a laptop screen, its card hidden.
    const spot = laneSpot(1440, rail, { left: 1328, right: 0 }, false)
    expect(spot).toEqual({ left: rail + LANE_GAP, right: LANE_GAP, band: true })
  })

  it('keeps over the map while exactly enough room is left', () => {
    const left = 400
    const right = 1000 - left - 2 * LANE_GAP - MIN_LANE_WIDTH
    expect(laneSpot(1000, rail, { left, right }, false).band).toBe(false)
    expect(laneSpot(1000, rail, { left: left + 1, right }, false).band).toBe(true)
  })

  it('is always a band on a phone, where drawers take the whole screen', () => {
    expect(laneSpot(390, 0, { left: 0, right: 0 }, true)).toEqual({
      left: LANE_GAP,
      right: LANE_GAP,
      band: true,
    })
  })
})

describe('a group order’s report', () => {
  it('names those skipped for the same reason together, reasons in the order they came up', () => {
    expect(
      skippedByWhy([
        { name: 'Mara', why: 'not riding' },
        { name: 'Odo', why: 'the carriage is full' },
        { name: 'Alda', why: 'not riding' },
      ]),
    ).toEqual([
      { names: ['Mara', 'Alda'], why: 'not riding' },
      { names: ['Odo'], why: 'the carriage is full' },
    ])
  })

  it('has nothing to say when nobody was skipped', () => {
    expect(skippedByWhy([])).toEqual([])
  })
})

describe('the first-day card’s lines', () => {
  it('lists every line in the card’s order, none ticked for a new Player', () => {
    const view = firstDayView({ done: [], dismissed: false })
    expect(view.lines.map((l) => l.label)).toEqual([
      'Claim the Horse offer',
      'Pick a resident',
      'Give them an order',
      'Open the Wiki',
    ])
    expect(view.lines.every((l) => !l.done)).toBe(true)
    expect(view).toMatchObject({ next: 'claimHorses', ticked: 0 })
  })

  it('ticks each line done, and names the first one still to do', () => {
    const view = firstDayView({ done: ['claimHorses', 'openWiki'], dismissed: false })
    expect(view.lines.filter((l) => l.done).map((l) => l.line)).toEqual(['claimHorses', 'openWiki'])
    expect(view).toMatchObject({ next: 'pickResident', ticked: 2 })
  })
})
