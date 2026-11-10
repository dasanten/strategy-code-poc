import { ADULT_AGE, MAX_HEALTH, MAX_HUNGER, ticksForAge } from '@csp/balance'
import type { Resident } from '@csp/shared-types'
import { describe, expect, it } from 'vitest'
import {
  CHOICE_KEY,
  DEFAULT_CHOICE,
  LIST_COLUMNS,
  clearFilters,
  directionLabel,
  filterResidents,
  filtersOn,
  fittingChoice,
  loadChoice,
  parseChoice,
  pickedFromList,
  sortBy,
  sortResidents,
  storeChoice,
  type ListColumn,
  type ResidentsChoice,
} from './residents-list-choice.js'
import { listedResidents } from './residents-list-view.js'

const NOW = ticksForAge(100)
const stat = (base: number) => ({ base, trained: 0 })
/** Someone of the given age at `NOW`, with no gear, no skills, nothing carried and no order. */
const resident = (name: string, over: Partial<Resident> = {}, age = 30) =>
  ({
    id: name.toLowerCase(),
    name,
    bornAt: NOW - ticksForAge(age),
    lifespan: 200,
    stats: {
      strength: stat(5),
      endurance: stat(5),
      agility: stat(5),
      intellect: stat(5),
    },
    skills: {},
    carried: {},
    hunger: MAX_HUNGER,
    health: MAX_HEALTH,
    order: null,
    ...over,
  }) as Resident

const list = (...residents: Resident[]) =>
  listedResidents([{ key: 'c1', label: 'Oakford', residents }])
const names = (listed: readonly { resident: Pick<Resident, 'name'> }[]) =>
  listed.map((l) => l.resident.name)
const filtered = (residents: Resident[], choice: Partial<ResidentsChoice>) =>
  names(filterResidents(list(...residents), { ...DEFAULT_CHOICE, ...choice }, NOW))
const sorted = (
  residents: Resident[],
  sort: ListColumn,
  descending: boolean,
  doing: (r: Resident) => string = () => 'Idle',
) => names(sortResidents(list(...residents), { sort, descending }, { tick: NOW, doing }))
const withStrength = (name: string, base: number) =>
  resident(name, { stats: { ...resident(name).stats, strength: stat(base) } })

describe('searching the full list', () => {
  const people = [resident('Edda'), resident('Bram'), resident('Hedda')]

  it('finds part of a name in any case, the spaces around it ignored', () => {
    expect(filtered(people, { search: 'edd' })).toEqual(['Edda', 'Hedda'])
    expect(filtered(people, { search: '  BRAM ' })).toEqual(['Bram'])
  })

  it('finds everyone with nothing typed and nobody with no such name', () => {
    expect(filtered(people, { search: '  ' })).toEqual(['Edda', 'Bram', 'Hedda'])
    expect(filtered(people, { search: 'zed' })).toEqual([])
  })
})

describe('filtering the full list', () => {
  it('by weapons: has any, has none, or fights with this one', () => {
    const people = [
      resident('Spear', { carried: { spear: 1 } }),
      resident('Both', { carried: { spear: 1, sword: 1 } }),
      resident('Shield', { carried: { shield: 1 } }),
      resident('Bare'),
    ]
    expect(filtered(people, { weapons: 'armed' })).toEqual(['Spear', 'Both'])
    expect(filtered(people, { weapons: 'unarmed' })).toEqual(['Shield', 'Bare'])
    expect(filtered(people, { weapons: 'sword' })).toEqual(['Both'])
    // Armed with the weapon they fight with, as the Gear column says: the best one.
    expect(filtered(people, { weapons: 'spear' })).toEqual(['Spear'])
  })

  it('does not count a weapon they carry none of any more', () => {
    expect(filtered([resident('Spent', { carried: { sword: 0 } })], { weapons: 'armed' })).toEqual(
      [],
    )
  })

  it('by doing: idle has neither order nor script, as the head counts them', () => {
    const people = [
      resident('Idle'),
      resident('Ordered', { order: { kind: 'feed', targetId: 'h1', units: 1 } }),
      resident('Scripted', { script: { scriptId: 1 } as Resident['script'] }),
    ]
    expect(filtered(people, { doing: 'idle' })).toEqual(['Idle'])
    expect(filtered(people, { doing: 'busy' })).toEqual(['Ordered', 'Scripted'])
  })

  it('by age: a child until they are grown up', () => {
    const people = [
      resident('Baby', {}, 0),
      resident('Almost', {}, ADULT_AGE - 0.1),
      resident('Grown', {}, ADULT_AGE),
    ]
    expect(filtered(people, { age: 'child' })).toEqual(['Baby', 'Almost'])
    expect(filtered(people, { age: 'adult' })).toEqual(['Grown'])
  })

  it('by city: the group they stand under, hired and homeless too', () => {
    const listed = listedResidents([
      { key: 'c1', label: 'Oakford', residents: [resident('Edda')] },
      { key: 'homeless', label: 'Homeless', residents: [resident('Bram')] },
    ])
    const by = (city: string) => names(filterResidents(listed, { ...DEFAULT_CHOICE, city }, NOW))
    expect(by('homeless')).toEqual(['Bram'])
    expect(by('c1')).toEqual(['Edda'])
    expect(by('')).toEqual(['Edda', 'Bram'])
  })

  it('by skill: those who learned it as far as the Skills column shows it', () => {
    const people = [
      resident('Miner', { skills: { mining: 2 } }),
      resident('Barely', { skills: { mining: 0.04 } }),
      resident('Farmer', { skills: { farming: 1 } }),
      resident('Nothing'),
    ]
    expect(filtered(people, { skill: 'mining' })).toEqual(['Miner'])
  })

  it('takes filters together and leaves the order alone', () => {
    const people = [
      resident('Zed', { carried: { sword: 1 } }),
      resident('Anna', {
        carried: { sword: 1 },
        order: { kind: 'feed', targetId: 'h1', units: 1 },
      }),
      resident('Ava', { carried: { sword: 1 } }),
      resident('Abe'),
    ]
    expect(filtered(people, { weapons: 'armed', doing: 'idle' })).toEqual(['Zed', 'Ava'])
  })

  it('counts the filters on, without the search, and clears them all but the sort', () => {
    const choice: ResidentsChoice = {
      search: 'edd',
      weapons: 'armed',
      doing: 'idle',
      age: 'child',
      city: 'c1',
      skill: 'combat',
      sort: 'strength',
      descending: true,
    }
    expect(filtersOn(DEFAULT_CHOICE)).toBe(0)
    expect(filtersOn({ ...DEFAULT_CHOICE, search: 'edd' })).toBe(0)
    expect(filtersOn(choice)).toBe(5)
    expect(clearFilters(choice)).toEqual({ ...DEFAULT_CHOICE, sort: 'strength', descending: true })
  })

  it('counts a city nobody is listed under as all of them', () => {
    const groups = [{ key: 'c1' }]
    const gone = { ...DEFAULT_CHOICE, city: 'c9' }
    expect(fittingChoice(gone, groups).city).toBe('')
    expect(fittingChoice({ ...DEFAULT_CHOICE, city: 'c1' }, groups).city).toBe('c1')
    expect(fittingChoice(DEFAULT_CHOICE, groups)).toBe(DEFAULT_CHOICE)
  })
})

describe('sorting the full list', () => {
  it('sorts by a stat as it counts now, in both directions', () => {
    const people = [withStrength('Mid', 5), withStrength('Top', 9), withStrength('Low', 1)]
    expect(sorted(people, 'strength', true)).toEqual(['Top', 'Mid', 'Low'])
    expect(sorted(people, 'strength', false)).toEqual(['Low', 'Mid', 'Top'])
  })

  it('sorts by each stat, age, hunger and health', () => {
    for (const s of ['endurance', 'agility', 'intellect'] as const) {
      const high = resident('High', { stats: { ...resident('x').stats, [s]: stat(9) } })
      expect(sorted([resident('Low'), high], s, true)).toEqual(['High', 'Low'])
    }
    const young = resident('Young', {}, 20)
    const old = resident('Old', {}, 60)
    expect(sorted([young, old], 'age', true)).toEqual(['Old', 'Young'])
    const fed = resident('Fed')
    const starved = resident('Starved', { hunger: 1, health: 1 })
    expect(sorted([starved, fed], 'hunger', true)).toEqual(['Fed', 'Starved'])
    expect(sorted([starved, fed], 'health', true)).toEqual(['Fed', 'Starved'])
  })

  it('sorts names and Doing as words, in any case and numbers in order', () => {
    const people = [resident('bram'), resident('Anna'), resident('Cato 10'), resident('Cato 2')]
    expect(sorted(people, 'name', false)).toEqual(['Anna', 'bram', 'Cato 2', 'Cato 10'])
    expect(sorted(people, 'name', true)).toEqual(['Cato 10', 'Cato 2', 'bram', 'Anna'])
    const doing = (r: Resident) => (r.name === 'Anna' ? 'Walking' : 'Fetching')
    expect(sorted([resident('Anna'), resident('Bram')], 'doing', false, doing)).toEqual([
      'Bram',
      'Anna',
    ])
  })

  it('asks what they are doing only when sorted by Doing', () => {
    let asked = 0
    const doing = () => {
      asked++
      return 'Idle'
    }
    sorted([resident('Anna')], 'name', false, doing)
    expect(asked).toBe(0)
    sorted([resident('Anna')], 'doing', false, doing)
    expect(asked).toBe(1)
  })

  it('sorts City by the groups in their order, within a group as they came', () => {
    const listed = listedResidents([
      { key: 'home', label: 'Zedtown', residents: [resident('Edda'), resident('Abe')] },
      { key: 'other', label: 'Ashford', residents: [resident('Cato')] },
    ])
    const by = (descending: boolean) =>
      names(sortResidents(listed, { sort: 'city', descending }, { tick: NOW, doing: () => 'Idle' }))
    expect(by(false)).toEqual(['Edda', 'Abe', 'Cato'])
    expect(by(true)).toEqual(['Cato', 'Edda', 'Abe'])
  })

  describe('with missing values', () => {
    const none = resident('None')
    const also = resident('Also')

    it('puts those without a skill last either way, the rest by their best skill', () => {
      const good = resident('Good', { skills: { mining: 1, combat: 4 } })
      const fair = resident('Fair', { skills: { farming: 2 } })
      const barely = resident('Barely', { skills: { farming: 0.01 } })
      expect(sorted([none, fair, barely, good], 'skills', true)).toEqual([
        'Good',
        'Fair',
        'None',
        'Barely',
      ])
      expect(sorted([none, fair, barely, good], 'skills', false)).toEqual([
        'Fair',
        'Good',
        'None',
        'Barely',
      ])
    })

    it('puts those without gear last either way, the rest by what it says', () => {
      const sword = resident('Sword', { carried: { sword: 1 } })
      const shield = resident('Shield', { carried: { shield: 1 } })
      expect(sorted([none, sword, shield], 'gear', false)).toEqual(['Shield', 'Sword', 'None'])
      expect(sorted([none, sword, shield], 'gear', true)).toEqual(['Sword', 'Shield', 'None'])
    })

    it('puts those carrying nothing last either way, the rest by weight', () => {
      const heavy = resident('Heavy', { carried: { iron: 5 } })
      const light = resident('Light', { carried: { food: 1 } })
      const emptied = resident('Emptied', { carried: { food: 0 } })
      expect(sorted([none, emptied, light, heavy], 'carrying', true)).toEqual([
        'Heavy',
        'Light',
        'None',
        'Emptied',
      ])
      expect(sorted([none, emptied, light, heavy], 'carrying', false)).toEqual([
        'Light',
        'Heavy',
        'None',
        'Emptied',
      ])
    })

    it('puts a value the resident lacks or that is no number last, not at a random place', () => {
      const unknown = resident('Unknown', { health: Number.NaN })
      const low = resident('Low', { health: 1 })
      const high = resident('High', { health: MAX_HEALTH })
      expect(sorted([unknown, low, high], 'health', true)).toEqual(['High', 'Low', 'Unknown'])
      expect(sorted([unknown, low, high], 'health', false)).toEqual(['Low', 'High', 'Unknown'])
      const blank = resident('Blank')
      expect(
        sorted([blank, resident('Busy')], 'doing', true, (r) =>
          r.name === 'Blank' ? '' : 'Walking',
        ),
      ).toEqual(['Busy', 'Blank'])
    })

    it('keeps those of the same value in the order they came, in either direction', () => {
      expect(sorted([none, also], 'skills', true)).toEqual(['None', 'Also'])
      expect(sorted([none, also], 'skills', false)).toEqual(['None', 'Also'])
      expect(sorted([none, also], 'strength', true)).toEqual(['None', 'Also'])
      expect(sorted([none, also], 'strength', false)).toEqual(['None', 'Also'])
    })
  })

  it('sorts by every column there is without throwing', () => {
    for (const column of LIST_COLUMNS) {
      expect(sorted([resident('Anna'), resident('Bram')], column, false)).toHaveLength(2)
    }
  })

  it('starts numbers highest first and words from A; choosing it again turns it round', () => {
    const byStrength = sortBy(DEFAULT_CHOICE, 'strength')
    expect(byStrength).toMatchObject({ sort: 'strength', descending: true })
    expect(sortBy(byStrength, 'strength').descending).toBe(false)
    expect(sortBy(byStrength, 'name')).toMatchObject({ sort: 'name', descending: false })
    expect(sortBy(byStrength, 'gear').descending).toBe(false)
    expect(sortBy(byStrength, 'hunger').descending).toBe(true)
  })

  it('says the order in words', () => {
    expect(directionLabel('strength', true)).toBe('Highest first')
    expect(directionLabel('strength', false)).toBe('Lowest first')
    expect(directionLabel('name', false)).toBe('A to Z')
    expect(directionLabel('doing', true)).toBe('Z to A')
    expect(directionLabel('city', false)).toBe('Home city first')
    expect(directionLabel('city', true)).toBe('Home city last')
  })
})

describe('who Pick these picks', () => {
  const ada = resident('Ada', { carried: { sword: 1 } })
  const bo = resident('Bo')
  const cy = resident('Cy', { carried: { spear: 1 } })
  const dee = resident('Dee', { carried: { spear: 1 } })
  const all = list(ada, bo, cy, dee)
  const armed = filterResidents(all, { ...DEFAULT_CHOICE, weapons: 'armed' }, NOW)

  it('picks everyone listed with nobody ticked', () => {
    expect(pickedFromList(all, new Set())).toEqual(['ada', 'bo', 'cy', 'dee'])
  })

  it('picks only those ticked', () => {
    expect(pickedFromList(all, new Set(['cy', 'ada']))).toEqual(['ada', 'cy'])
  })

  it('picks everyone a filter leaves with nobody ticked', () => {
    expect(pickedFromList(armed, new Set())).toEqual(['ada', 'cy', 'dee'])
  })

  it('picks those ticked whom a filter leaves, not those it hides', () => {
    expect(pickedFromList(armed, new Set(['bo', 'cy']))).toEqual(['cy'])
  })

  it('picks everyone a filter leaves when it hides all those ticked', () => {
    expect(pickedFromList(armed, new Set(['bo']))).toEqual(['ada', 'cy', 'dee'])
  })

  it('picks in the order the list is sorted', () => {
    const byName = sortResidents(
      armed,
      { sort: 'name', descending: true },
      { tick: NOW, doing: () => '' },
    )
    expect(pickedFromList(byName, new Set())).toEqual(['dee', 'cy', 'ada'])
    expect(pickedFromList(byName, new Set(['ada', 'dee']))).toEqual(['dee', 'ada'])
  })

  it('picks nobody from an empty list', () => {
    expect(pickedFromList([], new Set(['ada']))).toEqual([])
  })

  it('does not pick someone ticked who has left the list', () => {
    expect(pickedFromList(list(ada, bo), new Set(['ada', 'gone']))).toEqual(['ada'])
    expect(pickedFromList(list(ada, bo), new Set(['gone']))).toEqual(['ada', 'bo'])
  })
})

describe('the choice kept in this browser', () => {
  const choice: ResidentsChoice = {
    search: 'edd',
    weapons: 'sword',
    doing: 'idle',
    age: 'adult',
    city: 'c1',
    skill: 'combat',
    sort: 'strength',
    descending: true,
  }

  it('comes back as it was stored', () => {
    const kept = new Map<string, string>()
    storeChoice({ setItem: (k, v) => void kept.set(k, v) }, choice)
    expect(kept.has(CHOICE_KEY)).toBe(true)
    expect(loadChoice({ getItem: (k) => kept.get(k) ?? null })).toEqual(choice)
  })

  it('falls back to the default when it holds nothing usable', () => {
    for (const broken of [null, '', 'not json{', '3', 'null', '"text"', '[1,2]', '{}']) {
      expect(parseChoice(broken)).toEqual(DEFAULT_CHOICE)
    }
  })

  it('falls back per part, keeping what still means something', () => {
    const saved = parseChoice(
      JSON.stringify({ ...choice, weapons: 'trebuchet', doing: 3, age: null, city: 7, search: {} }),
    )
    expect(saved).toEqual({
      ...choice,
      weapons: 'any',
      doing: 'any',
      age: 'any',
      city: '',
      search: '',
    })
  })

  it('drops the direction along with a sort that is no use', () => {
    const saved = parseChoice(JSON.stringify({ ...choice, sort: 'charm', descending: true }))
    expect(saved).toMatchObject({ sort: 'city', descending: false })
    const noDirection = parseChoice(JSON.stringify({ ...choice, descending: 'yes' }))
    expect(noDirection).toMatchObject({ sort: 'strength', descending: false })
  })

  it('does without storage, or with storage that throws', () => {
    expect(loadChoice(undefined)).toEqual(DEFAULT_CHOICE)
    const failing = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(loadChoice(failing)).toEqual(DEFAULT_CHOICE)
    expect(() => storeChoice(failing, choice)).not.toThrow()
    expect(() => storeChoice(undefined, choice)).not.toThrow()
  })
})
