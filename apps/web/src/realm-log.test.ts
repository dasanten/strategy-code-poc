import { REALM_LOG_LENGTH, type RealmEvent } from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { appendEvents, describeDelivery, describeEvent, realmEnded } from './realm-log.js'

const at = { tick: 7, userId: 1 }

describe('realm log', () => {
  it('says why a resident couldn’t move in (`CONTEXT.md`: Relocate)', () => {
    const failed = { kind: 'relocateFailed', residentId: 'r1', name: 'Ana', cityId: 'c2' } as const
    expect(
      describeEvent({ ...failed, city: 'Ironford', reason: 'no free housing', seq: 1, ...at }),
    ).toEqual({ text: 'Ana couldn’t move in to Ironford: no free housing.', tone: 'warn' })
    expect(describeEvent({ ...failed, reason: 'the city is gone', seq: 2, ...at }).text).toBe(
      'Ana couldn’t relocate: the city is gone.',
    )
  })

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
    expect(
      describeEvent({
        kind: 'down',
        residentId: 'r2',
        name: 'Ana',
        until: 7 + 23 * 3600,
        seq: 6,
        ...at,
      }),
    ).toEqual({ text: 'Ana is Down from hunger: about 23 h (58 game days) left.', tone: 'bad' })
    expect(
      describeEvent({ kind: 'woke', residentId: 'r2', name: 'Ana', by: 'Ben', seq: 7, ...at }).text,
    ).toBe('Ben fed Ana, who is awake again at low health.')
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
    const down = { kind: 'horseDown', horseId: 'h1', name: 'Ember', until: 7 + 23 * 3600 } as const
    expect(describeEvent({ ...down, seq: 7, ...at })).toEqual({
      text: 'Your horse Ember is Down from hunger: about 23 h (58 game days) left. Feed it or put Food down by it.',
      tone: 'bad',
    })
    const foaled = { kind: 'foaled', horseId: 'h2', stableId: 's1', seq: 8, ...at } as const
    expect(describeEvent({ ...foaled, name: 'Flint' }).text).toBe(
      'A foal, Flint, was born in a stable.',
    )
    expect(describeEvent(foaled).text).toBe('A foal was born in a stable.')
  })

  it('tells the truth about the Trade Organization’s army (`CONTEXT.md`: Punishment trip)', () => {
    const trip = {
      kind: 'punished',
      cityId: 'c1',
      city: 'Ashford',
      worth: 240,
      seq: 1,
      ...at,
    } as const
    const army = "The Trade Organization's army"
    const line = (e: Partial<Extract<RealmEvent, { kind: 'punished' }>>) =>
      describeEvent({ ...trip, what: 'left', ...e }).text
    expect(line({ what: 'arrived' })).toBe(`${army} has arrived at Ashford.`)
    expect(line({ took: 240, why: 'enough' })).toBe(
      `${army} left Ashford, taking 240 of the 240 Coins' worth it came for.`,
    )
    expect(line({ took: 0, why: 'empty' })).toBe(
      `${army} left Ashford, taking 0 of the 240 Coins' worth it came for: the storages of Ashford held nothing.`,
    )
    expect(line({ took: 90, why: 'gaveUp' })).toBe(
      `${army} left Ashford, taking 90 of the 240 Coins' worth it came for: it ran out of time there.`,
    )
    expect(line({ what: 'turnedBack', why: 'cityLost' })).toBe(
      `${army} turned back without reaching Ashford: Ashford is no longer yours.`,
    )
    expect(line({ what: 'turnedBack', why: 'directiveLifted' })).toBe(
      `${army} turned back without reaching Ashford: the admin directive was lifted.`,
    )
    expect(line({ what: 'turnedBack', why: 'noWay' })).toBe(
      `${army} turned back without reaching Ashford: it found no way to Ashford.`,
    )
    expect(line({ what: 'lost', where: 'wayThere' })).toBe(
      `${army} was lost on its way to Ashford.`,
    )
    expect(line({ what: 'lost', where: 'atCity', took: 10 })).toBe(
      `${army} was lost at Ashford, having taken 10 of the 240 Coins' worth it came for.`,
    )
    expect(line({ what: 'lost', where: 'wayHome', took: 10 })).toBe(
      `${army} was lost on its way home from Ashford, with 10 of the 240 Coins' worth it came for.`,
    )
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
    const marked = { kind: 'waypointAdded', ...who, waypoint: 'Gold ore node', x: 4, y: 9 } as const
    expect(describeEvent(marked)).toEqual({
      text: 'Mara put a waypoint “Gold ore node” at (4, 9).',
      tone: 'info',
      places: [{ name: 'Gold ore node', x: 4, y: 9 }],
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

  it('describes swaps, cut down or not, and where', () => {
    const swap = {
      kind: 'swapped',
      residentId: 'p1',
      name: 'Ada',
      give: 'wood',
      want: 'stone',
      x: 4,
      y: 5,
      seq: 9,
      ...at,
    } as const
    expect(
      describeEvent({
        ...swap,
        place: 'warehouse',
        gave: 7,
        units: 5,
        wanted: 5,
        coins: 2,
      }),
    ).toEqual({
      text: 'Ada swapped 7 wood for 5 stone, with 2 coins back, at the warehouse.',
      tone: 'info',
      places: [{ name: 'the warehouse', x: 4, y: 5 }],
    })
    expect(
      describeEvent({ ...swap, place: 'storage', gave: 3, units: 2, wanted: 5, coins: 0 }).text,
    ).toBe('Ada swapped 3 wood for 2 stone (of 5 wanted) at the storage.')
    expect(
      describeEvent({ ...swap, place: 'storage', gave: 0, units: 0, wanted: 5, coins: 0 }),
    ).toMatchObject({ text: 'Ada couldn’t swap wood for stone at the storage.', tone: 'warn' })
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
    const lost = {
      kind: 'orderEndedWithHq',
      good: 'iron',
      units: 4,
      cityId: 'c2',
      city: 'Yonder',
      seq: 12,
      ...at,
    } as const
    expect(describeEvent({ ...lost, order: 'delivery' })).toEqual({
      text: 'The Trade Org HQ has fallen and no caravans run: your delivery of 4 iron to Yonder is cancelled, with nothing refunded.',
      tone: 'bad',
    })
    expect(describeEvent({ ...lost, order: 'pickUp' }).text).toBe(
      'The Trade Org HQ has fallen and no caravans run: your pick-up of 4 iron from Yonder is cancelled.',
    )
    expect(describeEvent({ ...lost, order: 'transfer' }).text).toBe(
      'The Trade Org HQ has fallen and no caravans run: your transfer of 4 iron to Yonder is cancelled, with nothing refunded.',
    )
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

  it('describes town halls occupied and occupations broken, to both sides', () => {
    const hall = { cityId: 'c1', city: 'Ashford', x: 4, y: 5, seq: 9, ...at } as const
    const places = [{ name: 'Ashford’s town hall', x: 4, y: 5 }]
    const occupied = { ...hall, kind: 'hallOccupied', days: 10 } as const
    expect(describeEvent({ ...occupied, other: 'Northmarch', occupier: false })).toEqual({
      text: 'Your town hall in Ashford is occupied by the realm of Northmarch: it falls in 10 game days unless you retake it.',
      tone: 'bad',
      places,
    })
    expect(describeEvent({ ...occupied, other: null, occupier: true })).toEqual({
      text: 'You hold the town hall of Ashford: 10 game days to capture it.',
      tone: 'info',
      places,
    })
    const broken = { ...hall, kind: 'occupationBroken' } as const
    expect(describeEvent({ ...broken, other: 'Northmarch', occupier: false })).toEqual({
      text: 'The occupation of your town hall in Ashford by the realm of Northmarch is broken.',
      tone: 'info',
      places,
    })
    expect(describeEvent({ ...broken, other: 'Mara', occupier: true })).toEqual({
      text: 'Your occupation of Ashford’s town hall is broken: its days are lost.',
      tone: 'warn',
      places,
    })
    const gone = { ...broken, x: undefined, y: undefined }
    expect(describeEvent({ ...gone, other: null, occupier: true }).places).toBeUndefined()
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

  it('says a stolen carriage is gone and where it was last, never who took it', () => {
    const gone = { kind: 'transportGone', x: 4, y: 5, carriage: true, seq: 9, ...at } as const
    expect(describeEvent(gone)).toEqual({
      text: 'Your carriage is gone. It was last at (4, 5).',
      tone: 'bad',
      places: [{ name: '(4, 5)', x: 4, y: 5 }],
    })
    expect(describeEvent({ ...gone, horse: 'Rowan' }).text).toBe(
      'Your carriage, with Rowan, is gone. It was last at (4, 5).',
    )
  })

  it('says what the realm’s resident took and from whom', () => {
    const taken = {
      kind: 'transportTaken',
      residentId: 'r9',
      name: 'Vex',
      x: 4,
      y: 5,
      from: 'the realm of Ada',
      carriage: true,
      seq: 9,
      ...at,
    } as const
    expect(describeEvent(taken)).toEqual({
      text: 'Vex took a carriage from the realm of Ada at (4, 5). It is yours now.',
      tone: 'info',
      places: [{ name: '(4, 5)', x: 4, y: 5 }],
    })
    expect(describeEvent({ ...taken, horse: 'Rowan', goods: { food: 5 } }).text).toBe(
      'Vex took a carriage with Rowan, loaded with 5 Food, from the realm of Ada at (4, 5). It is yours now.',
    )
    expect(describeEvent({ ...taken, from: null }).text).toBe(
      'Vex took a carriage from nobody at (4, 5). It is yours now.',
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
    // A carriage with its horse and load (`CONTEXT.md`: Stealing a carriage or horse).
    expect(
      describeEvent({
        ...crime,
        crime: 'theft',
        carriage: true,
        horse: 'Rowan',
        goods: { food: 5 },
      }).text,
    ).toBe(
      'A witness got home: Vex of the realm of Ada stole a carriage with Rowan, loaded with 5 Food at (4, 5).',
    )
    expect(describeEvent({ ...crime, crime: 'theft', carriage: true }).text).toBe(
      'A witness got home: Vex of the realm of Ada stole a carriage at (4, 5).',
    )
    // Taken from someone Down (`CONTEXT.md`: Down).
    expect(
      describeEvent({ ...crime, crime: 'theft', goods: { stone: 3 }, victim: 'Ana' }).text,
    ).toBe('A witness got home: Vex of the realm of Ada stole 3 Stone from Ana at (4, 5).')
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

  it('tells both sides of a carried direct offer, with what they pay', () => {
    const terms = {
      kind: 'directOffer',
      gives: 'iron',
      givesUnits: 10,
      wants: 'stone',
      wantsUnits: 5,
      times: 1,
      from: 'Mara',
      carried: { fromCity: 'Oakford', toCity: 'Brook', fee: 40 },
      x: 6,
      y: 6,
      seq: 1,
      tick: 0,
      userId: 7,
    } as const
    const got = (what: string) => describeEvent({ ...terms, what } as RealmEvent).text
    expect(got('received')).toBe(
      'The realm of Mara sent you a direct offer the Trade Organization carries between Oakford and Brook: 10 iron for 5 stone. You pay up to 40 coins. Accept or decline it under Direct offers.',
    )
    expect(got('carriedAccepted')).toBe(
      'The realm of Mara accepted your carried direct offer of 10 iron for 5 stone: caravans carry both ways between Oakford and Brook. You pay up to 40 coins.',
    )
    expect(got('youAccepted')).toBe(
      'You accepted the carried direct offer of 10 iron for 5 stone from the realm of Mara: caravans carry both ways between Oakford and Brook. You pay up to 40 coins.',
    )
    expect(got('noCaravans')).toBe(
      'The direct offer of 10 iron for 5 stone from the realm of Mara is cancelled: the Trade Org HQ has fallen and no caravans run.',
    )
    const ended = (why: string, carried: boolean) =>
      describeEvent({ ...terms, kind: 'offerEnded', why, to: 'Bo', carried } as RealmEvent).text
    expect(ended('declined', true)).toBe(
      'Your direct offer of 10 iron for 5 stone to the realm of Bo was declined.',
    )
    expect(ended('noCaravans', true)).toBe(
      'Your direct offer of 10 iron for 5 stone to the realm of Bo is cancelled: the Trade Org HQ has fallen and no caravans run.',
    )
    expect(
      describeEvent({
        kind: 'transferStuck',
        why: 'nothingCame',
        good: 'stone',
        units: 5,
        cityId: 'c1',
        city: 'Oakford',
        seq: 1,
        tick: 0,
        userId: 7,
      } as RealmEvent).text,
    ).toBe('A caravan found no stone to bring Oakford for a carried direct offer.')
  })

  it('names no sum for a carried Transfer that arrived, whose fee may be shared', () => {
    const arrived = {
      kind: 'transferred',
      good: 'stone',
      units: 10,
      fee: 27,
      carried: true,
      fromRealmId: 'r2',
      fromRealm: 'Boland',
      toRealmId: 'r1',
      toRealm: 'Marland',
      back: false,
      cityId: 'c1',
      city: 'Brackenholt',
      x: 1,
      y: 2,
      seq: 1,
      tick: 0,
      userId: 8,
    } as RealmEvent
    expect(describeEvent(arrived, 'r2').text).toBe(
      'A caravan brought the 10 stone you sent to Brackenholt of Marland, as your carried direct offer agreed.',
    )
  })

  it('tells both sides of a direct offer, with its place', () => {
    const terms = {
      gives: 'wood',
      givesUnits: 10,
      wants: 'stone',
      wantsUnits: 5,
      x: 6,
      y: 6,
      seq: 1,
      tick: 0,
      userId: 7,
    } as const
    const place = [{ name: 'the storage', x: 6, y: 6 }]
    const got = (what: string, times?: number) =>
      describeEvent({ ...terms, kind: 'directOffer', what, from: 'Mara', times } as RealmEvent)
    expect(got('received', 2)).toEqual({
      text: 'The realm of Mara sent you a direct offer: 10 wood for 5 stone, 2 times over. Fetch it in person at the storage, or decline it, under Direct offers.',
      tone: 'info',
      places: place,
    })
    expect(got('received', 1).text).toMatch(
      /^The realm of Mara sent you a direct offer: 10 wood for 5 stone\. /,
    )
    expect(got('lapsed').text).toBe(
      'The direct offer of 10 wood for 5 stone from the realm of Mara lapsed.',
    )
    expect(got('declined').text).toBe(
      'You declined the direct offer of 10 wood for 5 stone from the realm of Mara.',
    )
    expect(got('takenDown').text).toBe(
      'The realm of Mara took down its direct offer of 10 wood for 5 stone to you.',
    )
    const ended = (why: string) =>
      describeEvent({ ...terms, kind: 'offerEnded', why, to: 'Bo' } as RealmEvent)
    expect(ended('declined')).toEqual({
      text: 'Your direct offer of 10 wood for 5 stone to the realm of Bo was declined. Its goods are ordinary again.',
      tone: 'info',
      places: place,
    })
    expect(ended('lapsed').text).toBe(
      'Your direct offer of 10 wood for 5 stone to the realm of Bo lapsed. Its goods are ordinary again.',
    )
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
