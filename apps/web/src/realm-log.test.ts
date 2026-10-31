import { REALM_LOG_LENGTH, type RealmEvent } from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { appendEvents, describeDelivery, describeEvent, realmEnded } from './realm-log.js'

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
    const horseHungry = {
      kind: 'horseHungry',
      horseId: 'h1',
      residentId: 'r1',
      name: 'Mara',
    } as const
    expect(describeEvent({ ...horseHungry, seq: 6, ...at })).toEqual({
      text: 'Mara’s horse is hungry, and Mara carries no Food to spare for it.',
      tone: 'warn',
    })
    // Horses have names (`CONTEXT.md`: Horse name); entries from before say "a horse".
    expect(describeEvent({ ...horseHungry, horseName: 'Ember', seq: 6, ...at }).text).toBe(
      'Mara’s horse Ember is hungry, and Mara carries no Food to spare for it.',
    )
    const starved = { kind: 'horseDied', horseId: 'h1', seq: 7, ...at } as const
    expect(describeEvent({ ...starved, name: 'Ember' })).toEqual({
      text: 'Your horse Ember starved to death.',
      tone: 'bad',
    })
    expect(describeEvent(starved).text).toBe('A horse starved to death.')
    const foaled = { kind: 'foaled', horseId: 'h2', stableId: 's1', seq: 8, ...at } as const
    expect(describeEvent({ ...foaled, name: 'Flint' }).text).toBe(
      'A foal, Flint, was born in a stable.',
    )
    expect(describeEvent(foaled).text).toBe('A foal was born in a stable.')
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
    const stopped = {
      kind: 'scriptStopped',
      ...who,
      script: 'Work',
      reason: 'no workplace here',
    } as const
    expect(describeEvent(stopped)).toEqual({
      text: 'Mara stopped Work: no workplace here',
      tone: 'info',
    })
    const dropped = { kind: 'scriptFieldDropped', field: 'resident.plan', seq: 9, ...at } as const
    expect(describeEvent({ ...dropped, scripts: [{ scriptId: 3, name: 'feeder' }] }).text).toBe(
      'Your script “feeder” reads resident.plan, which scripts no longer see: it is null from now on.',
    )
    expect(
      describeEvent({
        ...dropped,
        scripts: [
          { scriptId: 3, name: 'feeder' },
          { scriptId: 4, name: 'miner' },
        ],
      }).text,
    ).toBe(
      'Your scripts “feeder”, “miner” read resident.plan, which scripts no longer see: it is null from now on.',
    )
  })

  it('describes a skipped queue step', () => {
    const skipped = {
      kind: 'queueStepSkipped',
      residentId: 'r1',
      name: 'Mara',
      step: 2,
      order: 'workAt',
      reason: 'not standing on that workplace',
      seq: 9,
      ...at,
    } as const
    expect(describeEvent(skipped).text).toBe(
      'Mara skipped step 2 of their queue: not standing on that workplace.',
    )
    expect(describeEvent({ ...skipped, queueEnded: true }).text).toBe(
      'Mara skipped step 2 of their queue: not standing on that workplace. None of its steps could start, so the queue ended.',
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

  it('describes trades at a warehouse, cut down or not', () => {
    const trade = {
      kind: 'traded',
      residentId: 'p1',
      name: 'Ada',
      good: 'ironOre',
      x: 4,
      y: 5,
      seq: 9,
      ...at,
    } as const
    expect(describeEvent({ ...trade, side: 'sell', units: 3, wanted: 3, coins: 12 })).toEqual({
      text: 'Ada sold 3 iron ore for 12 coins at the warehouse.',
      tone: 'info',
      places: [{ name: 'the warehouse', x: 4, y: 5 }],
    })
    expect(describeEvent({ ...trade, side: 'buy', units: 2, wanted: 5, coins: 14 }).text).toBe(
      'Ada bought 2 iron ore (of 5 wanted) for 14 coins at the warehouse.',
    )
    expect(describeEvent({ ...trade, side: 'buy', units: 0, wanted: 5, coins: 0 })).toMatchObject({
      text: 'Ada couldn’t buy any iron ore at the warehouse.',
      tone: 'warn',
    })
  })

  it('describes deliveries ordered, carried out and stuck', () => {
    const ordered = {
      kind: 'deliveryOrdered',
      residentId: 'p1',
      name: 'Ada',
      good: 'iron',
      wanted: 4,
      cityId: 'c1',
      city: 'Ashford',
      x: 4,
      y: 5,
      seq: 9,
      ...at,
    } as const
    expect(describeEvent({ ...ordered, side: 'buy', units: 4, coins: 40, fee: 6 })).toEqual({
      text: 'Ada bought 4 iron for 40 coins and a 6-coin fee; a caravan brings them to Ashford.',
      tone: 'info',
      places: [{ name: 'the warehouse', x: 4, y: 5 }],
    })
    expect(describeEvent({ ...ordered, side: 'sell', units: 4, coins: 20, fee: 6 }).text).toBe(
      'Ada sold up to 4 iron from Ashford; a caravan picks them up and pays there (about 20 coins after a 6-coin fee at today’s prices).',
    )
    expect(describeEvent({ ...ordered, side: 'buy', units: 0, coins: 0, fee: 0 }).tone).toBe('warn')
    const done = {
      kind: 'delivered',
      good: 'iron',
      units: 4,
      cityId: 'c1',
      city: 'Ashford',
      x: 8,
      y: 9,
      seq: 10,
      ...at,
    } as const
    expect(describeEvent({ ...done, delivery: 'delivery', coins: 0, fee: 6 })).toEqual({
      text: 'A caravan delivered 4 iron to Ashford.',
      tone: 'info',
      places: [{ name: 'Ashford', x: 8, y: 9 }],
    })
    expect(describeEvent({ ...done, delivery: 'pickUp', coins: 20, fee: 6 }).text).toBe(
      'A caravan picked up 4 iron in Ashford and paid 20 coins there (after a 6-coin fee).',
    )
    const stuck = {
      kind: 'deliveryStuck',
      delivery: 'delivery',
      good: 'iron',
      units: 4,
      cityId: 'c1',
      city: 'Ashford',
      seq: 11,
      ...at,
    } as const
    expect(describeEvent({ ...stuck, cancelled: false })).toEqual({
      text: 'A caravan delivering 4 iron to Ashford couldn’t get to its storage and turned back; the next caravan tries again.',
      tone: 'warn',
    })
    expect(describeEvent({ ...stuck, cancelled: true }).tone).toBe('bad')
  })

  it('describes transfers ordered, arrived and stuck, for sender and recipient', () => {
    const ordered = {
      kind: 'transferOrdered',
      good: 'iron',
      units: 4,
      wanted: 4,
      fee: 0,
      toRealmId: 'realm2',
      toRealm: 'Ivo',
      cityId: 'c2',
      city: 'Yonder',
      x: 4,
      y: 5,
      seq: 9,
      ...at,
    } as const
    expect(describeEvent({ ...ordered, fromCity: 'Ashford', name: null })).toEqual({
      text: 'You sent 4 iron from Ashford to Yonder of Ivo; a caravan picks them up there with its fee.',
      tone: 'info',
      places: [{ name: 'Ashford', x: 4, y: 5 }],
    })
    expect(describeEvent({ ...ordered, fromCity: null, name: 'Ada', fee: 30 }).text).toBe(
      'Ada handed in 4 iron with a 30-coin fee; a caravan brings them to Yonder of Ivo.',
    )
    const none = { ...ordered, fromCity: null, name: 'Ada', units: 0 }
    expect(describeEvent(none).tone).toBe('warn')
    const done = {
      kind: 'transferred',
      good: 'iron',
      units: 4,
      fee: 30,
      fromRealmId: 'realm1',
      fromRealm: 'Mara',
      toRealmId: 'realm2',
      toRealm: 'Ivo',
      back: false,
      cityId: 'c2',
      city: 'Yonder',
      x: 8,
      y: 9,
      seq: 10,
      ...at,
    } as const
    expect(describeEvent(done, 'realm2')).toEqual({
      text: 'A caravan brought 4 iron from Mara to Yonder.',
      tone: 'info',
      places: [{ name: 'Yonder', x: 8, y: 9 }],
    })
    expect(describeEvent(done, 'realm1').text).toBe(
      'A caravan brought the 4 iron you sent to Yonder of Ivo (a 30-coin fee).',
    )
    expect(describeEvent({ ...done, back: true, city: 'Ashford' }, 'realm1').text).toBe(
      'A caravan brought 4 iron you sent back to Ashford.',
    )
    const stuck = {
      kind: 'transferStuck',
      good: 'iron',
      units: 4,
      cityId: 'c2',
      city: 'Yonder',
      seq: 11,
      ...at,
    } as const
    expect(describeEvent({ ...stuck, why: 'turnedBack' }).tone).toBe('warn')
    expect(describeEvent({ ...stuck, why: 'robbed' }).text).toBe(
      'Robbers took 4 iron of your transfer to Yonder off a caravan; the Trade Organization sends them again.',
    )
    for (const why of ['cancelled', 'kept', 'nothing'] as const) {
      expect(describeEvent({ ...stuck, why }).tone).toBe('bad')
    }
  })

  it('describes open deliveries', () => {
    const d = {
      id: 'd1',
      kind: 'delivery',
      good: 'ironOre',
      units: 3,
      cityId: 'c1',
      city: 'Ashford',
      x: 1,
      y: 2,
      underway: false,
    } as const
    expect(describeDelivery(d)).toBe(
      'Delivery of 3 iron ore to Ashford: waiting for a caravan at the warehouse.',
    )
    expect(describeDelivery({ ...d, kind: 'pickUp', underway: true })).toBe(
      'Pick-up of up to 3 iron ore from Ashford: a caravan is on it.',
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

  it('says who handed the realm over to whom, and where', () => {
    expect(
      describeEvent({
        kind: 'leaderHandedOver',
        fromId: 'r1',
        from: 'Mara',
        toId: 'r2',
        to: 'Ysolde',
        cityId: 'c1',
        city: 'Ashford',
        x: 3,
        y: 9,
        seq: 1,
        ...at,
      }),
    ).toEqual({
      text: 'Mara handed your realm over to Ysolde in Ashford; Ysolde is your Leader now.',
      tone: 'info',
      places: [{ name: 'Ashford', x: 3, y: 9 }],
    })
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
