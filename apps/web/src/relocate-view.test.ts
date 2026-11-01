import {
  CARRYING_A_CHILD,
  HOUSING_ROOM,
  type Building,
  type City,
  type Resident,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { knownOf, relocateActionProblem, relocateChoices } from './relocate-view.js'

const city = (id: string, name: string, realmId: string | null = 'me'): City => ({
  id,
  name,
  realmId,
  townHallId: `${id}-hall`,
  occupation: null,
})
const house = (id: string, cityId: string): Building => ({ id, kind: 'house', cityId, x: 0, y: 0 })
const room = HOUSING_ROOM.house!

/** Residents of a city, standing nowhere in particular. */
const living = (n: number, cityId: string | null, prefix: string) =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, cityId, order: null }))

const ana: Pick<Resident, 'id' | 'name' | 'owner' | 'cityId' | 'carrying'> = {
  id: 'ana',
  name: 'Ana',
  owner: 'me',
  cityId: 'home',
}

describe('relocate choices', () => {
  const cities = [
    city('home', 'Ashford'),
    city('full', 'Ironford'),
    city('roomy', 'Brightwater'),
    city('theirs', 'Elsewhere', 'them'),
  ]
  const buildings = [house('h1', 'full'), house('h2', 'roomy')]

  it('lists the realm’s other cities by name with their free housing, a full one greyed out', () => {
    const residents = [...living(room, 'full', 'f'), ...living(1, 'roomy', 'r')]
    expect(relocateChoices({ cities, buildings, residents }, 'me', ana)).toEqual([
      { id: 'roomy', name: 'Brightwater', room: room - 1 },
      { id: 'full', name: 'Ironford', room: 0, problem: 'no free housing' },
    ])
  })

  it('counts residents already relocating there, but not the resident being told again', () => {
    const going = (id: string): Pick<Resident, 'id' | 'cityId' | 'order'> => ({
      id,
      cityId: 'home',
      order: { kind: 'relocate', cityId: 'roomy', target: { x: 0, y: 0 }, path: null, progress: 0 },
    })
    const others = Array.from({ length: room }, (_, i) => going(`g${i}`))
    const seen = { cities, buildings, residents: others }
    expect(relocateChoices(seen, 'me', ana).find((c) => c.id === 'roomy')).toMatchObject({
      room: 0,
      problem: 'no free housing',
    })
    const again = { ...seen, residents: [going('ana'), ...others.slice(1)] }
    expect(relocateChoices(again, 'me', ana).find((c) => c.id === 'roomy')).toEqual({
      id: 'roomy',
      name: 'Brightwater',
      room: 1,
    })
  })

  it('lists every city of the realm for a homeless resident', () => {
    const homeless = { ...ana, cityId: null }
    const ids = relocateChoices({ cities, buildings, residents: [] }, 'me', homeless).map(
      (c) => c.id,
    )
    expect(ids.sort()).toEqual(['full', 'home', 'roomy'])
  })

  it('turns the action off for a resident carrying a child, or a realm with one city', () => {
    const choices = relocateChoices({ cities, buildings, residents: [] }, 'me', ana)
    expect(relocateActionProblem(ana, choices)).toBeUndefined()
    const carrying = { ...ana, carrying: {} as NonNullable<Resident['carrying']> }
    expect(relocateActionProblem(carrying, choices)).toBe(CARRYING_A_CHILD)
    expect(relocateActionProblem(ana, [])).toBe('your realm has no other city')
  })

  it('knows cities in sight and remembered, each once, in sight first', () => {
    const seen = [city('a', 'Now')]
    const remembered = [city('a', 'Then'), city('b', 'Away')]
    expect(knownOf(seen, remembered).map((c) => c.name)).toEqual(['Now', 'Away'])
  })
})
