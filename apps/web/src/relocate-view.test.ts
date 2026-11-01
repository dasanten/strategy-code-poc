import {
  CARRYING_A_CHILD,
  HOUSING_ROOM,
  type Building,
  type City,
  type Resident,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import {
  groupRelocateActionProblem,
  groupRelocateChoices,
  knownOf,
  relocateActionProblem,
  relocateChoices,
} from './relocate-view.js'

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

describe('relocate choices for a group', () => {
  const cities = [city('home', 'Ashford'), city('roomy', 'Brightwater')]
  const buildings = [house('h2', 'roomy')]
  const group = [ana, { ...ana, id: 'bo', name: 'Bo' }, { ...ana, id: 'cy', name: 'Cy' }]

  it('counts a city as full unless the whole group fits, with those relocating there', () => {
    const fits = { cities, buildings, residents: living(room - 3, 'roomy', 'r') }
    expect(groupRelocateChoices(fits, 'me', group)).toEqual([
      { id: 'roomy', name: 'Brightwater', room: 3 },
    ])
    const going = {
      id: 'g',
      cityId: 'home',
      order: {
        kind: 'relocate' as const,
        cityId: 'roomy',
        target: { x: 0, y: 0 },
        path: null,
        progress: 0,
      },
    }
    const seen = { ...fits, residents: [...fits.residents, going] }
    expect(groupRelocateChoices(seen, 'me', group)).toEqual([
      { id: 'roomy', name: 'Brightwater', room: 2, problem: 'free housing for 2 only' },
    ])
  })

  it('names one of them who lives there already, and lists a city only some of them live in', () => {
    const split = [group[0]!, { ...group[1]!, cityId: 'roomy' }, group[2]!]
    const choices = groupRelocateChoices({ cities, buildings, residents: [] }, 'me', split)
    expect(choices.map((c) => [c.id, c.problem])).toEqual([
      ['home', 'Ana already lives in Ashford'],
      ['roomy', 'Bo already lives in Brightwater'],
    ])
  })

  it('turns the action off for the group when one of them carries a child, naming them', () => {
    const choices = groupRelocateChoices({ cities, buildings, residents: [] }, 'me', group)
    expect(groupRelocateActionProblem(group, choices)).toBeUndefined()
    const carrying = { ...group[1]!, carrying: {} as NonNullable<Resident['carrying']> }
    expect(groupRelocateActionProblem([group[0]!, carrying], choices)).toBe(
      `Bo is ${CARRYING_A_CHILD}`,
    )
    expect(groupRelocateActionProblem(group, [])).toBe('your realm has no other city')
  })
})
