import { REALM_LOG_LENGTH, type RealmEvent } from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { appendEvents, describeEvent, realmEnded } from './realm-log.js'

const at = { tick: 7, userId: 1 }

describe('realm log', () => {
  it('describes each kind of event', () => {
    const died = { kind: 'died', residentId: 'r1', name: 'Mara', seq: 2, ...at } as const
    expect(
      describeEvent({ kind: 'hungry', residentId: 'r1', name: 'Mara', seq: 1, ...at }),
    ).toEqual({ text: 'Mara has nothing to eat and is starving.', tone: 'warn' })
    expect(describeEvent({ ...died, cause: 'oldAge', leader: false }).text).toBe(
      'Mara died of old age.',
    )
    expect(describeEvent({ ...died, cause: 'starved', leader: true }).text).toBe(
      'Your Leader Mara starved to death. Your realm has ended.',
    )
    expect(describeEvent({ kind: 'foodSpoiled', units: 4, seq: 3, ...at }).text).toBe(
      '4 Food spoiled.',
    )
    const born = { kind: 'born', residentId: 'r3', name: 'Wren', seq: 4, ...at } as const
    expect(describeEvent({ ...born, parents: ['Mara', 'Tobin'] }).text).toBe(
      'Mara and Tobin had a child, Wren.',
    )
    expect(
      describeEvent({ kind: 'grownUp', residentId: 'r3', name: 'Wren', seq: 5, ...at }),
    ).toEqual({ text: 'Wren has grown up and can work now.', tone: 'info' })
  })

  it('describes a script’s trouble', () => {
    const who = { residentId: 'r1', name: 'Mara', scriptId: 3, seq: 9, ...at } as const
    expect(
      describeEvent({ kind: 'scriptError', ...who, message: 'Oops', line: 2, column: 5 }).text,
    ).toBe('Mara’s script stopped with an error (line 2, column 5): Oops')
    expect(describeEvent({ kind: 'scriptOutOfSteps', ...who, realm: false }).text).toBe(
      'Mara’s script ran out of steps this tick.',
    )
    expect(describeEvent({ kind: 'scriptOutOfSteps', ...who, realm: true }).tone).toBe('warn')
    expect(describeEvent({ kind: 'scriptEnded', ...who }).text).toBe(
      'Mara stopped running a script: it was deleted.',
    )
  })

  it('describes fights, flight and deaths in them', () => {
    const fight = { kind: 'fight', residentId: 'r1', name: 'Mara', otherId: 'r9', seq: 6 } as const
    expect(describeEvent({ ...fight, other: 'Tobin', attacker: true, ...at })).toEqual({
      text: 'Mara attacked Tobin.',
      tone: 'info',
    })
    expect(describeEvent({ ...fight, other: 'Tobin', attacker: false, ...at })).toEqual({
      text: 'Mara was attacked by Tobin.',
      tone: 'warn',
    })
    expect(
      describeEvent({ kind: 'fled', residentId: 'r1', name: 'Mara', seq: 7, ...at }).text,
    ).toBe('Mara was hit and flees home.')
    const died = { kind: 'died', residentId: 'r1', name: 'Mara', seq: 8, ...at } as const
    expect(describeEvent({ ...died, cause: 'killed', leader: false, by: 'Tobin' }).text).toBe(
      'Mara was killed by Tobin.',
    )
  })

  it('describes cities captured and lost', () => {
    const captured = { kind: 'cityCaptured', cityId: 'c1', city: 'Ashford', seq: 9, ...at } as const
    expect(describeEvent({ ...captured, other: null, captor: true, residents: 6 })).toEqual({
      text: 'You captured Ashford, with its 6 residents.',
      tone: 'info',
    })
    expect(describeEvent({ ...captured, other: 'Tobin', captor: true, residents: 1 }).text).toBe(
      'You captured Ashford from the realm of Tobin, with its 1 resident.',
    )
    expect(describeEvent({ ...captured, other: 'Mara', captor: false, residents: 3 })).toEqual({
      text: 'The realm of Mara captured Ashford and its 3 residents.',
      tone: 'bad',
    })
  })

  it('describes alliance events, saying which are about the Player’s own realm', () => {
    const north = { allianceId: 'a1', name: 'North', seq: 6, ...at } as const
    const about = (realmId: string) => ({ ...north, realmId, realm: 'Tobin' })
    expect(describeEvent({ kind: 'allianceInvited', ...north }).text).toBe(
      'You were invited to join the alliance North.',
    )
    expect(describeEvent({ kind: 'allianceJoined', ...about('realm1') }, 'realm1').text).toBe(
      'You joined the alliance North.',
    )
    expect(describeEvent({ kind: 'allianceJoined', ...about('realm2') }, 'realm1').text).toBe(
      'The realm of Tobin joined the alliance North.',
    )
    const left = { kind: 'allianceLeft', ...about('realm2') } as const
    expect(describeEvent({ ...left, why: 'removed' }, 'realm2')).toEqual({
      text: 'Your realm was removed from the alliance North.',
      tone: 'warn',
    })
    expect(describeEvent({ ...left, why: 'leaderDied' }, 'realm1').text).toBe(
      'The realm of Tobin lost its Leader and left the alliance North.',
    )
    expect(describeEvent({ kind: 'allianceLeader', ...about('realm1') }, 'realm1').text).toBe(
      'You are now the leader of the alliance North.',
    )
  })

  it('describes crimes a witness brought home, with who did them', () => {
    const crime = {
      kind: 'crimeKnown',
      crimeId: 'x9',
      at: 3,
      x: 4,
      y: 5,
      culpritId: 'r9',
      culprit: 'Vex',
      culpritOrg: 'the realm of Ada',
      seq: 9,
      ...at,
    } as const
    expect(describeEvent({ ...crime, crime: 'theft', goods: { food: 5, ironOre: 2 } })).toEqual({
      text: 'A witness got home: Vex of the realm of Ada stole 5 Food, 2 Iron Ore at (4, 5).',
      tone: 'bad',
    })
    expect(describeEvent({ ...crime, crime: 'killing', victim: 'Mara' }).text).toBe(
      'A witness got home: Vex of the realm of Ada killed Mara at (4, 5).',
    )
    expect(describeEvent({ ...crime, crime: 'tearDown', building: 'lumberCamp' }).text).toBe(
      'A witness got home: Vex of the realm of Ada tore down your lumber camp at (4, 5).',
    )
  })

  it('says what became of a dead Leader’s cities, and where to find them', () => {
    const city = (name: string, x: number, residents: number) => ({
      cityId: name,
      name,
      x,
      y: 9,
      residents,
    })
    const ended = { kind: 'selfManaged', seq: 10, ...at } as const
    expect(describeEvent({ ...ended, cities: [city('Ashford', 3, 1)] })).toEqual({
      text: 'Your city Ashford (1 resident) is now a self-managed city.',
      tone: 'bad',
      places: [{ name: 'Ashford', x: 3, y: 9 }],
    })
    const three = [city('Ashford', 3, 4), city('Redbank', 40, 0), city('Elm', 70, 2)]
    const line = describeEvent({ ...ended, cities: three })
    expect(line.text).toBe(
      'Your cities Ashford (4 residents), Redbank (0 residents) and Elm (2 residents) are now self-managed cities.',
    )
    expect(line.places).toHaveLength(3)
    expect(describeEvent({ ...ended, cities: [] }).text).toBe('Your realm had no city left.')
  })

  it('says whose Leader’s death ended a mercenary contract', () => {
    const ended = {
      kind: 'contract',
      contractId: 'c1',
      what: 'ended',
      other: 'Tobin',
      residents: 2,
      seq: 11,
      ...at,
    } as const
    expect(describeEvent({ ...ended, lender: true, leaderDied: 'hirer' })).toEqual({
      text: 'The Leader of the realm of Tobin died, ending the contract for 2 mercenaries: the 2 mercenaries walk home.',
      tone: 'warn',
    })
    expect(describeEvent({ ...ended, lender: false, leaderDied: 'hirer' }).text).toBe(
      'Your Leader died, ending the contract for 2 mercenaries: the 2 mercenaries walk home.',
    )
    expect(describeEvent({ ...ended, lender: false }).text).toBe(
      'The contract with the realm of Tobin for 2 mercenaries ended: the 2 mercenaries walk home.',
    )
  })

  it('says where the fresh start is, and whether the realm has ended until then', () => {
    const founded = {
      kind: 'founded',
      residentId: 'r1',
      name: 'Mara',
      cityId: 'c1',
      city: 'Ashford',
      x: 3,
      y: 9,
      seq: 1,
      ...at,
    } as const
    expect(describeEvent(founded)).toEqual({
      text: 'Your Leader Mara founded Ashford, your realm’s starting city.',
      tone: 'info',
      places: [{ name: 'Ashford', x: 3, y: 9 }],
    })
    const died = {
      kind: 'died',
      residentId: 'r1',
      name: 'Mara',
      cause: 'oldAge',
      leader: true,
    } as const
    const log: RealmEvent[] = [founded, { ...died, seq: 2, ...at }]
    expect(realmEnded([])).toBe(false)
    expect(realmEnded(log)).toBe(false)
    log.push(
      { kind: 'selfManaged', cities: [], seq: 3, ...at },
      { kind: 'foodSpoiled', units: 1, seq: 4, ...at },
    )
    expect(realmEnded(log)).toBe(true)
    log.push({ ...founded, seq: 5 })
    expect(realmEnded(log)).toBe(false)
  })

  it('keeps the latest events, as many as the server does', () => {
    const event = (seq: number): RealmEvent => ({ kind: 'foodSpoiled', units: 1, seq, ...at })
    const log = Array.from({ length: REALM_LOG_LENGTH }, (_, i) => event(i))
    expect(appendEvents(log, [])).toBe(log)
    const next = appendEvents(log, [event(100), event(101)])
    expect(next).toHaveLength(REALM_LOG_LENGTH)
    expect(next.at(-1)!.seq).toBe(101)
    expect(next[0]!.seq).toBe(2)
  })
})
