import {
  DIRECTIVE_PUNISH_WORTH,
  HQ_COIN_WAREHOUSE,
  MAX_DIRECTIVE_REASON,
  TRADE_ORG_ARMY,
  TRADE_ORG_PUNISH,
  Terrain,
  diplomacyFor,
  directiveAgainst,
  standingOf,
  townHallOf,
  tradeOrgRefuses,
  TRADE_ORG,
  type Building,
  type City,
  type Directive,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import {
  adminDirectives,
  buyOffOrdersDone,
  buyOffsOf,
  buyOffsSound,
  directiveTargetChoices,
  directivesSound,
  giveDirective,
  liftDirective,
  setDirectivePrice,
} from './directives.js'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { addCity } from './test-terrain.js'
import { foundTradeOrgHq } from './trade-org.js'
import { stepPunishments } from './trade-org-punishment.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

const terrain: TerrainMap = { size: 160, tiles: new Uint8Array(160 * 160).fill(Terrain.Plains) }

/** Where the HQ's town hall stands. */
const MID = 80

/**
 * The Trade Org HQ at (MID, MID) with `TRADE_ORG_ARMY.guard` + 12 armed soldiers; realm r1
 * (Leader a1, Aldo) with city c1 near the HQ and c2 far from it, its storage s1 full of Coins;
 * realm r2 (Leader b1, Bea) in an alliance with r1 and its city c3; and an NPC city n1 apart, its storage s2 full of Coins.
 */
function setup() {
  const world = createWorld(terrain)
  const hq = foundTradeOrgHq(world, terrain, MID, MID, mulberry32(7))
  world.realms.push(
    { id: 'r1', userId: 7, leaderId: 'a1' },
    { id: 'r2', userId: 8, leaderId: 'b1' },
  )
  addCity(world, { id: 'c1', realmId: 'r1', x: MID, y: MID + 22, name: 'Ashford' })
  addCity(world, { id: 'c2', realmId: 'r1', x: MID + 60, y: MID, name: 'Farhold' })
  addCity(world, { id: 'c3', realmId: 'r2', x: MID - 30, y: MID - 30, name: 'Bywater' })
  addCity(world, { id: 'n1', realmId: null, x: MID + 30, y: MID - 40, name: 'Nook' })
  world.buildings.push(
    {
      id: 's1',
      kind: 'storage',
      cityId: 'c1',
      x: MID + 1,
      y: MID + 22,
      stock: { coins: 1000 },
    },
    {
      id: 's2',
      kind: 'storage',
      cityId: 'n1',
      x: MID + 31,
      y: MID - 40,
      stock: { coins: 1000 },
    },
  )
  resident(world, 'a1', 'r1', MID - 1, MID + 23, 'c1')
  resident(world, 'b1', 'r2', MID - 31, MID - 29, 'c3')
  world.alliances.push({
    id: 'al1',
    name: 'North',
    leaderId: 'r1',
    members: [
      { realmId: 'r1', joinedAt: 0 },
      { realmId: 'r2', joinedAt: 0 },
    ],
    invites: [],
    army: [],
  })
  const soldiers = world.residents
    .filter((r) => r.owner === null && r.cityId === hq.id)
    .slice(0, TRADE_ORG_ARMY.guard + 12)
  for (const r of soldiers) r.carried.spear = 1
  return { world, hq, walking: new Walking(terrain) }
}

function resident(
  world: WorldState,
  id: string,
  owner: string,
  x: number,
  y: number,
  cityId: string,
) {
  const r = newResident(mulberry32(world.residents.length + 1), {
    id,
    owner,
    cityId,
    x,
    y,
    tick: 0,
  })
  r.bornAt = -20 * 24 * 3600
  r.lifespan = 60
  r.name = id === 'a1' ? 'Aldo' : 'Bea'
  world.residents.push(r)
  return r
}

/** Gives a directive that must be given. */
function give(world: WorldState, target: string, withAlliance = false): Directive {
  const d = giveDirective(world, { target, withAlliance, reason: 'farms new Players' }, 'Daniel')
  if (typeof d === 'string') throw new Error(d)
  return d
}

/** Steps the world, keeping everyone fed, and checks every invariant now and then. */
function run(world: WorldState, walking: Walking, ticks: number, until?: () => boolean) {
  for (let i = 0; i < ticks; i++) {
    for (const r of world.residents) r.hunger = 100
    stepWorld(world, terrain, walking)
    if (i % 200 === 0) expect(checkInvariants(world, terrain)).toEqual([])
    if (until?.()) break
  }
  expect(checkInvariants(world, terrain)).toEqual([])
}

describe('giving and lifting an admin directive', () => {
  it('names a realm or an NPC city, with a reason, once each', () => {
    const { world, hq } = setup()
    const reason = 'farms new Players'
    expect(giveDirective(world, { target: 'nobody', withAlliance: false, reason }, 'D')).toBe(
      'Name a realm or an NPC city.',
    )
    expect(giveDirective(world, { target: hq.id, withAlliance: false, reason }, 'D')).toBe(
      'Name a realm or an NPC city.',
    )
    expect(giveDirective(world, { target: TRADE_ORG, withAlliance: false, reason }, 'D')).toBe(
      'Name a realm or an NPC city.',
    )
    expect(giveDirective(world, { target: 'r1', withAlliance: false, reason: '  ' }, 'D')).toBe(
      'Give a reason; every Player sees it.',
    )
    const long = 'x'.repeat(MAX_DIRECTIVE_REASON + 1)
    expect(giveDirective(world, { target: 'r1', withAlliance: false, reason: long }, 'D')).toMatch(
      /Keep the reason/,
    )
    expect(giveDirective(world, { target: 'r1', withAlliance: 'yes', reason }, 'D')).toMatch(
      /alliance/,
    )

    const d = give(world, 'r1')
    expect(d).toMatchObject({ target: 'r1', withAlliance: false, reason, givenBy: 'Daniel' })
    expect(giveDirective(world, { target: 'r1', withAlliance: true, reason }, 'D')).toBe(
      'A directive already names Aldo.',
    )
    give(world, 'n1')
    expect(world.directives).toHaveLength(2)
    expect(checkInvariants(world, terrain)).toEqual([])

    expect(liftDirective(world, d.id)).toBe(true)
    expect(liftDirective(world, d.id)).toBe(false)
    expect(world.directives.map((x) => x.target)).toEqual(['n1'])
  })

  it('offers admins every realm and NPC city to name, never the Trade Organization', () => {
    const { world, hq } = setup()
    const targets = directiveTargetChoices(world, (id) => (id === 7 ? 'mara' : undefined))
    expect(targets).toEqual([
      { org: 'r1', name: 'Aldo', is: 'realm', account: 'mara' },
      { org: 'r2', name: 'Bea', is: 'realm', account: undefined },
      { org: 'n1', name: 'Nook', is: 'city' },
    ])
    expect(targets.some((t) => t.org === hq.id)).toBe(false)
  })
})

describe('the Trade Organization under an admin directive', () => {
  it('refuses the target trade until the directive is lifted', () => {
    const { world } = setup()
    expect(tradeOrgRefuses(world, 'r1')).toBe(false)
    const d = give(world, 'r1')
    expect(standingOf(world, TRADE_ORG, 'r1')).toBe(0)
    expect(tradeOrgRefuses(world, 'r1')).toBe(true)
    expect(tradeOrgRefuses(world, 'r2')).toBe(false)
    liftDirective(world, d.id)
    expect(tradeOrgRefuses(world, 'r1')).toBe(false)
  })

  it('treats the target’s alliance, as it stands, as ones to punish when it names it', () => {
    const { world } = setup()
    give(world, 'r1', true)
    expect(directiveAgainst(world, 'r2')?.target).toBe('r1')
    expect(tradeOrgRefuses(world, 'r2')).toBe(true)
    expect(tradeOrgRefuses(world, 'n1')).toBe(false)
    // Once r2 is out of the alliance, the directive no longer names it.
    world.alliances[0]!.members = world.alliances[0]!.members.filter((m) => m.realmId !== 'r2')
    expect(tradeOrgRefuses(world, 'r2')).toBe(false)
  })

  it('sends its army to the target’s city nearest the HQ, again and again', () => {
    const { world, walking } = setup()
    const d = give(world, 'r1')
    stepPunishments(world, terrain.size)
    expect(world.punishments).toHaveLength(1)
    const p = world.punishments[0]!
    expect(p).toMatchObject({
      culpritOrg: 'r1',
      cityId: 'c1',
      worth: DIRECTIVE_PUNISH_WORTH,
      directiveId: d.id,
      heading: 'out',
    })
    expect(p.members.length).toBeGreaterThan(0)
    expect(p.members.length).toBeLessThanOrEqual(TRADE_ORG_PUNISH.soldiers)
    expect(world.events.find((e) => e.kind === 'punished')).toMatchObject({
      what: 'coming',
      city: 'Ashford',
      directive: 'farms new Players',
    })

    run(world, walking, 20_000, () => !world.punishments.some((x) => x.id === p.id))
    expect(world.punishments.some((x) => x.id === p.id)).toBe(false)
    // The first one is over and the directive still stands: it goes again.
    run(world, walking, 5, () => world.punishments.length > 0)
    expect(world.punishments[0]).toMatchObject({ culpritOrg: 'r1', directiveId: d.id })
  })

  it('sends its army against every member of the alliance it names', () => {
    const { world } = setup()
    give(world, 'r1', true)
    stepPunishments(world, terrain.size)
    expect(world.punishments.map((p) => [p.culpritOrg, p.cityId]).sort()).toEqual([
      ['r1', 'c1'],
      ['r2', 'c3'],
    ])
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('calls its army home once the directive is lifted, and sends none again', () => {
    const { world, walking } = setup()
    const d = give(world, 'n1')
    stepPunishments(world, terrain.size)
    expect(world.punishments[0]).toMatchObject({ culpritOrg: 'n1', heading: 'out' })
    liftDirective(world, d.id)
    stepPunishments(world, terrain.size)
    expect(world.punishments[0]!.heading).toBe('home')
    run(world, walking, 20_000, () => world.punishments.length === 0)
    expect(world.punishments).toEqual([])
    run(world, walking, 50)
    expect(world.punishments).toEqual([])
  })
})

describe('who sees an admin directive', () => {
  it('shows every Player the target and the reason, never who gave it', () => {
    const { world } = setup()
    give(world, 'r1', true)
    for (const realm of ['r1', 'r2']) {
      const seen = diplomacyFor(world, realm, [])
      expect(seen.directives).toEqual([
        expect.objectContaining({
          target: 'r1',
          targetName: 'Aldo',
          withAlliance: true,
          reason: 'farms new Players',
        }),
      ])
      expect(JSON.stringify(seen)).not.toContain('Daniel')
    }
  })

  it('shows admins who gave it', () => {
    const { world } = setup()
    give(world, 'n1')
    expect(adminDirectives(world)).toEqual([
      expect.objectContaining({ target: 'n1', targetName: 'Nook', givenBy: 'Daniel' }),
    ])
  })
})

describe('the directives-sound invariant', () => {
  it('catches a directive naming the Trade Organization, a target named twice, or no reason', () => {
    const { world, hq } = setup()
    const base = { withAlliance: false, givenBy: 'Daniel', givenAt: 0, price: null }
    const broken = (city: City) => [
      { ...base, id: 'd1', target: city.id, reason: 'x' },
      { ...base, id: 'd2', target: 'r1', reason: 'x' },
      { ...base, id: 'd3', target: 'r1', reason: ' ' },
    ]
    world.directives = broken(hq)
    expect(directivesSound.check(world, terrain).map((v) => v.message)).toEqual([
      `directive d1 names the Trade Organization`,
      `r1 is named by two directives`,
      `directive d3 has a reason of 1 characters`,
    ])
  })
})

describe('buying off an admin directive', () => {
  const aldo = { userId: 7, account: { name: 'Mara', isAdmin: false } }
  const bea = { userId: 8, account: { name: 'Ben', isAdmin: false } }

  /** The setup with a directive against r1 that costs `price` to buy off, and the HQ's warehouses. */
  function priced(price: number | null, withAlliance = false) {
    const s = setup()
    const d = giveDirective(
      s.world,
      { target: 'r1', withAlliance, reason: 'farms new Players', price },
      'Daniel',
    )
    if (typeof d === 'string') throw new Error(d)
    const hall = townHallOf(s.world, s.hq)!
    const isCoins = (b: Building) =>
      b.x === hall.x + HQ_COIN_WAREHOUSE.dx && b.y === hall.y + HQ_COIN_WAREHOUSE.dy
    const warehouses = s.world.buildings.filter((b) => b.kind === 'warehouse')
    return {
      ...s,
      d,
      coins: warehouses.find(isCoins)!,
      goods: warehouses.find((b) => b.cityId === s.hq.id && !isCoins(b))!,
      queue: new OrderQueue(undefined, terrain),
    }
  }

  /** Puts a resident on a tile with some coins in their hands. */
  function standOn(world: WorldState, id: string, at: { x: number; y: number }, coins: number) {
    const r = world.residents.find((x) => x.id === id)!
    r.x = at.x
    r.y = at.y
    r.carried = coins > 0 ? { coins } : {}
    return r
  }

  /** The buy-off order for the resident `residentId`. */
  const buyOff = (residentId: string, directiveId: string, carriageId: string | null = null) => ({
    kind: 'buyOff',
    residentId,
    directiveId,
    carriageId,
  })

  it('ends the directive once the target pays its price at a warehouse; the coins go into its stock', () => {
    const { world, walking, d, coins, goods, queue } = priced(300)
    const a1 = standOn(world, 'a1', goods, 350)
    expect(tradeOrgRefuses(world, 'r1')).toBe(true)
    const before = coins.stock!.coins ?? 0
    expect(queue.receive(world, aldo, 'q1', buyOff('a1', d.id))).toEqual({
      type: 'ack',
      requestId: 'q1',
    })
    queue.applyAll(world)
    stepWorld(world, terrain, walking)
    expect(world.directives).toEqual([])
    expect(a1.carried.coins).toBe(50)
    expect(coins.stock!.coins).toBe(before + 300)
    expect(goods.stock?.coins).toBeUndefined()
    expect(a1.order).toBeNull()
    expect(tradeOrgRefuses(world, 'r1')).toBe(false)
    expect(world.events.filter((e) => e.kind === 'boughtOff')).toEqual([
      expect.objectContaining({ name: 'Aldo', reason: 'farms new Players', coins: 300 }),
    ])
    expect(buyOffsOf(world)).toHaveLength(1)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('takes the price from a carriage, and at the coin warehouse itself', () => {
    const { world, walking, d, coins, queue } = priced(300)
    standOn(world, 'a1', coins, 0)
    world.carriages.push({
      id: 'k1',
      realmId: 'r1',
      cityId: null,
      x: coins.x,
      y: coins.y,
      horseId: null,
      load: { coins: 300 },
    } as WorldState['carriages'][number])
    const before = coins.stock!.coins ?? 0
    expect(queue.receive(world, aldo, 'q1', buyOff('a1', d.id, 'k1')).type).toBe('ack')
    queue.applyAll(world)
    stepWorld(world, terrain, walking)
    expect(world.directives).toEqual([])
    expect(world.carriages.find((k) => k.id === 'k1')!.load.coins).toBeUndefined()
    expect(coins.stock!.coins).toBe(before + 300)
  })

  it('calls the army sent for it home', () => {
    const { world, walking, d, goods, queue } = priced(300)
    stepPunishments(world, terrain.size)
    expect(world.punishments[0]).toMatchObject({ culpritOrg: 'r1', heading: 'out' })
    standOn(world, 'a1', goods, 300)
    queue.receive(world, aldo, 'q1', buyOff('a1', d.id))
    queue.applyAll(world)
    stepWorld(world, terrain, walking)
    stepPunishments(world, terrain.size)
    expect(world.directives).toEqual([])
    expect(world.punishments[0]!.heading).toBe('home')
  })

  it('is refused unless the admin allows it, to the target, with the whole price, on a warehouse', () => {
    const { world, d, goods } = priced(300, true)
    standOn(world, 'a1', goods, 299)
    standOn(world, 'b1', goods, 1000)
    const ask = (sender: typeof aldo, residentId: string, directiveId = d.id) =>
      new OrderQueue(undefined, terrain).receive(
        world,
        sender,
        'q',
        buyOff(residentId, directiveId),
      )
    expect(ask(aldo, 'a1')).toMatchObject({ reason: 'it costs 300 coins' })
    // Bea's realm is named only through its alliance: the target pays, not its allies.
    expect(ask(bea, 'b1')).toMatchObject({ reason: 'no directive names your realm by that id' })
    expect(ask(aldo, 'a1', 'nope')).toMatchObject({
      reason: 'no directive names your realm by that id',
    })
    standOn(world, 'a1', { x: goods.x + 30, y: goods.y + 30 }, 300)
    expect(ask(aldo, 'a1')).toMatchObject({ reason: 'not on a Trade Org warehouse' })
    standOn(world, 'a1', goods, 300)
    expect(ask(aldo, 'a1').type).toBe('ack')
    expect(setDirectivePrice(world, d.id, null)).toMatchObject({ price: null })
    expect(ask(aldo, 'a1')).toMatchObject({ reason: 'this directive can’t be bought off' })
  })

  it('does nothing when the price rose since the order', () => {
    const { world, walking, d, goods, queue } = priced(300)
    const a1 = standOn(world, 'a1', goods, 300)
    queue.receive(world, aldo, 'q1', buyOff('a1', d.id))
    setDirectivePrice(world, d.id, 400)
    queue.applyAll(world)
    stepWorld(world, terrain, walking)
    expect(world.directives).toHaveLength(1)
    expect(a1.carried.coins).toBe(300)
    expect(a1.order).toBeNull()
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('lets admins set whole Coins as the price, or none, and Players see it', () => {
    const { world, d } = priced(null)
    expect(d.price).toBeNull()
    for (const bad of [0, -5, 2.5, '100']) {
      expect(setDirectivePrice(world, d.id, bad)).toBe(
        'A price to buy it off is a whole number of Coins, at least one, or none.',
      )
    }
    expect(setDirectivePrice(world, 'nope', 100)).toBe('No such directive.')
    expect(setDirectivePrice(world, d.id, 500)).toMatchObject({ price: 500 })
    const other = giveDirective(
      world,
      { target: 'n1', withAlliance: false, reason: 'x', price: 0 },
      'Daniel',
    )
    expect(other).toBe('A price to buy it off is a whole number of Coins, at least one, or none.')
    expect(diplomacyFor(world, 'r2', []).directives).toEqual([
      expect.objectContaining({ target: 'r1', price: 500 }),
    ])
  })
})

describe('the buy-off invariants', () => {
  it('catch a price that is not whole Coins', () => {
    const { world } = setup()
    const d = give(world, 'r1')
    d.price = 2.5
    expect(directivesSound.check(world, terrain).map((v) => v.message)).toEqual([
      `directive ${d.id} asks 2.5 coins to buy it off`,
    ])
  })

  it('catch a buy-off that made or lost coins, or left its directive in force', () => {
    const { world, walking, hq } = setup()
    const d = giveDirective(
      world,
      { target: 'r1', withAlliance: false, reason: 'x', price: 100 },
      'Daniel',
    ) as Directive
    const hall = townHallOf(world, hq)!
    const a1 = world.residents.find((r) => r.id === 'a1')!
    a1.x = hall.x + HQ_COIN_WAREHOUSE.dx
    a1.y = hall.y + HQ_COIN_WAREHOUSE.dy
    a1.carried = { coins: 100 }
    a1.order = { kind: 'buyOff', directiveId: d.id, carriageId: null }
    stepWorld(world, terrain, walking)
    expect(world.directives).toEqual([])
    expect(buyOffsSound.check(world, terrain)).toEqual([])
    const record = buyOffsOf(world)[0]!
    record.after += 1
    world.directives.push(d)
    expect(buyOffsSound.check(world, terrain).map((v) => v.message)).toEqual([
      `a buy-off by a1 turned ${record.before} coins into ${record.before + 1}`,
      `directive ${d.id} still holds after it was bought off`,
    ])
  })

  it('catch a buy-off order that outlasts its tick', () => {
    const { world } = setup()
    const a1 = world.residents.find((r) => r.id === 'a1')!
    a1.order = { kind: 'buyOff', directiveId: 'd', carriageId: null }
    expect(buyOffOrdersDone.check(world, terrain)).toHaveLength(1)
  })
})
