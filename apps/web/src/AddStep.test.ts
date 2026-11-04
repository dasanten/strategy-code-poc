import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MAX_HEALTH, MAX_HUNGER, TICKS_PER_GAME_DAY, type SeenHorse } from '@csp/shared'
import { AddStep } from './AddStep.js'

const horse = (h: Partial<SeenHorse>): SeenHorse => ({
  id: 'h1',
  realmId: 'me',
  cityId: null,
  x: 5,
  y: 5,
  hunger: MAX_HUNGER,
  health: MAX_HEALTH,
  name: 'Rowan',
  stats: { speed: 12, strength: 8, endurance: 10 },
  bornAt: 0,
  ...h,
})

/** The planner's Add step asking which horses in the stable picked to breed. */
const breedAsk = (horses: SeenHorse[], tick = 0) =>
  renderToStaticMarkup(
    createElement(AddStep, {
      plan: { kind: 'breed', picked: [{ x: 5, y: 5, id: 's1', building: 'stable' }] },
      onStart: () => {},
      onAnswer: () => {},
      onCancel: () => {},
      scripts: [],
      buildKinds: [],
      horses,
      tick,
      cities: [],
      onPickCity: () => {},
    }),
  )
    // The text as read, without the tags React splits it with.
    .replace(/<!-- -->/g, '')

describe('picking two horses to breed in the planner', () => {
  it('names each horse and shows its stats and age, so the two can be compared', () => {
    const html = breedAsk(
      [
        horse({}),
        horse({
          id: 'h2',
          name: 'Bramble',
          stats: { speed: 7, strength: 15, endurance: 9 },
          bornAt: 3 * TICKS_PER_GAME_DAY,
        }),
      ],
      10 * TICKS_PER_GAME_DAY,
    )
    expect(html).toContain('Rowan · Speed 12, Strength 8, Endurance 10 · 10 game days old')
    expect(html).toContain('Bramble · Speed 7, Strength 15, Endurance 9 · 7 game days old')
    expect(html).not.toContain('Horse 1')
  })

  it('says so when fewer than two horses are there', () => {
    expect(breedAsk([horse({})])).toContain('Fewer than two horses')
  })
})
