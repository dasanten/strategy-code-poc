import { describe, expect, it } from 'vitest'
import type {
  AdminEntity,
  AdminInspection,
  AdminOrganization,
  AdminWorldView,
  Resident,
} from '@csp/shared'
import {
  inspectorCard,
  jumpInspectTarget,
  ownerText,
  pickOnTile,
  type InspectorCard,
} from './admin-inspector.js'
import type { JumpEntry } from './admin-jump.js'

const realm: AdminOrganization = {
  id: 'r1',
  is: 'realm',
  name: 'Mara',
  account: 'mara',
  alliance: { id: 'al1', name: 'North' },
}
const npc: AdminOrganization = { id: 'n1', is: 'city', name: 'Nook', alliance: null }
const trade: AdminOrganization = {
  id: 'tradeOrg',
  is: 'tradeOrg',
  name: 'Trade Organization',
  alliance: null,
}

const stats = {
  strength: { base: 10, trained: 2 },
  endurance: { base: 9, trained: 0 },
  agility: { base: 8, trained: 0 },
  intellect: { base: 7, trained: 0 },
}
const resident = (id: string, x = 3, y = 4) =>
  ({
    id,
    name: id,
    owner: 'r1',
    cityId: 'c1',
    x,
    y,
    stats,
    skills: {},
    health: 80,
    hunger: 50,
    bornAt: 0,
    lifespan: 60,
    carried: { spear: 1, food: 2 },
    order: null,
  }) satisfies Omit<Resident, 'script'>

/** Everything a card says, in one string. */
const text = (c: InspectorCard) =>
  [
    c.title,
    c.badge,
    c.owner,
    ...c.rows.flatMap((r) => [r.label, r.text, ...(r.links ?? []).map((l) => l.name)]),
  ].join(' | ')
const row = (c: InspectorCard, label: string) => c.rows.find((r) => r.label.startsWith(label))

describe('what a click on the admin map inspects', () => {
  const view = (...entities: AdminEntity[]): AdminWorldView => ({ tick: 1, orgs: [], entities })
  const building = (id: string, kind: 'townHall' | 'road' | 'storage', cityId: string | null) =>
    ({ is: 'building', org: null, id, kind, cityId, x: 3, y: 4 }) as AdminEntity
  const carriage = {
    is: 'carriage',
    org: null,
    id: 'k1',
    realmId: null,
    cityId: null,
    x: 3,
    y: 4,
    horseId: null,
    load: {},
  } as AdminEntity

  it('picks a resident first, then a carriage, a building, goods, a horse, a road', () => {
    const r = { is: 'resident', org: 'r1', ...resident('a1') } as AdminEntity
    const hall = building('h1', 'townHall', 'c1')
    const road = building('rd', 'road', null)
    expect(pickOnTile(view(road, hall, carriage, r), 3, 4)).toEqual({ kind: 'resident', id: 'a1' })
    expect(pickOnTile(view(road, hall, carriage), 3, 4)).toEqual({ kind: 'carriage', id: 'k1' })
    // A town hall stands for its city.
    expect(pickOnTile(view(road, hall), 3, 4)).toEqual({ kind: 'city', id: 'c1' })
    expect(pickOnTile(view(road, building('s1', 'storage', 'c1')), 3, 4)).toEqual({
      kind: 'building',
      id: 's1',
    })
    expect(pickOnTile(view(road), 3, 4)).toEqual({ kind: 'building', id: 'rd' })
    expect(pickOnTile(view(road), 5, 5)).toBeUndefined()
    expect(pickOnTile(null, 3, 4)).toBeUndefined()
  })

  it("picks a caravan's carriage as the caravan", () => {
    const caravan = { is: 'caravan', org: 'tradeOrg', id: 'cv1', carriageId: 'k1' } as AdminEntity
    expect(pickOnTile(view(carriage, caravan), 3, 4)).toEqual({ kind: 'caravan', id: 'cv1' })
  })
})

describe('the admin inspector', () => {
  it('names who something belongs to', () => {
    expect(ownerText(realm)).toBe('Realm of Mara (mara) · alliance North')
    expect(ownerText(npc)).toBe('NPC city Nook')
    expect(ownerText(trade)).toBe('Trade Organization')
    expect(ownerText(null)).toBe('Nobody’s')
  })

  it("shows a resident's stats, health, hunger, load, order and script by name only", () => {
    const ins: AdminInspection = {
      tick: 1,
      org: realm,
      is: 'resident',
      resident: {
        ...resident('Ada'),
        hunger: 49.6,
        order: { kind: 'pickUp', goods: {} } as unknown as Resident['order'],
        script: { scriptId: 4, name: 'Miner', memory: { secret: 'memory value' } },
      },
      city: { id: 'c1', name: 'Ashford' },
      army: { id: 'ar1', name: 'Vanguard' },
      caravan: null,
      leader: true,
    }
    const card = inspectorCard(ins)
    expect(card).toMatchObject({ title: 'Ada', badge: 'Leader' })
    expect(row(card, 'Health')?.text).toBe('80 / 100')
    expect(row(card, 'Hunger')?.text).toMatch(/^50 \/ \d+ fed$/)
    expect(row(card, 'Stats')?.text).toBe('Strength 10 +2, Endurance 9, Agility 8, Intellect 7')
    expect(row(card, 'Carries')?.text).toBe('2 food, 1 spear')
    expect(row(card, 'Doing')?.text).toBe('Picking up goods')
    expect(row(card, 'Script')?.text).toBe('Miner')
    expect(text(card)).not.toContain('memory value')
    expect(row(card, 'City')?.links).toEqual([
      { target: { kind: 'city', id: 'c1' }, name: 'Ashford' },
    ])
    expect(row(card, 'Army')?.links?.[0]?.target).toEqual({ kind: 'army', id: 'ar1' })
    expect(card.directive).toEqual({ org: 'r1', name: 'Mara' })

    const deleted = inspectorCard({
      ...ins,
      resident: { ...ins.resident, script: { scriptId: 4, name: null, memory: {} } },
    } as AdminInspection)
    expect(row(deleted, 'Script')?.text).toBe('a deleted script')
  })

  it("shows a city's residents, buildings, storage, gates and soldiers", () => {
    const card = inspectorCard({
      tick: 1,
      org: npc,
      is: 'city',
      city: { id: 'n1', name: 'Nook', realmId: null, townHallId: 'h', x: 40, y: 41 },
      residents: [
        { id: 'a', name: 'Ann' },
        { id: 'b', name: 'Bo' },
      ],
      buildings: [
        ['house', 3],
        ['storage', 1],
      ],
      storage: { wood: 7 },
      gates: { open: 1, shut: 2 },
      soldiers: 4,
    })
    expect(card.title).toBe('Nook')
    expect(card.owner).toBe('NPC city Nook')
    expect(row(card, 'Residents')).toMatchObject({ label: 'Residents (2)' })
    expect(row(card, 'Residents')?.links?.map((l) => l.target)).toEqual([
      { kind: 'resident', id: 'a' },
      { kind: 'resident', id: 'b' },
    ])
    expect(row(card, 'Buildings')?.text).toBe('3 houses, 1 storage')
    expect(row(card, 'Storage')?.text).toBe('7 wood')
    expect(row(card, 'Gates')?.text).toBe('1 open, 2 shut')
    expect(row(card, 'Soldiers')?.text).toBe('4')
    expect(card.directive).toEqual({ org: 'n1', name: 'Nook' })
  })

  it('shows a carriage, a caravan and an army with what they are doing', () => {
    const carriage = {
      id: 'k1',
      realmId: 'r1',
      cityId: null,
      x: 5,
      y: 6,
      horseId: 'h1',
      load: { wood: 10 },
    }
    const k = inspectorCard({
      tick: 1,
      org: realm,
      is: 'carriage',
      carriage,
      driver: { id: 'a1', name: 'Ada' },
      caravan: null,
    })
    expect(row(k, 'Load')?.text).toMatch(/ kg: 10 wood$/)
    expect(row(k, 'Driver')?.links?.[0]?.target).toEqual({ kind: 'resident', id: 'a1' })

    const cv = inspectorCard({
      tick: 1,
      org: trade,
      is: 'caravan',
      caravan: {
        id: 'cv1',
        postId: 'p1',
        carriageId: 'k1',
        driverId: 'd1',
        escortIds: ['e1'],
        heading: 'post',
        stop: 'storage',
        toLoad: null,
        holding: null,
        job: null,
        transfer: null,
      },
      post: { id: 'p1', name: 'Ferry' },
      carriage,
      crew: [
        { id: 'd1', name: 'Dan' },
        { id: 'e1', name: 'Eve' },
      ],
    })
    expect(cv.title).toBe('Caravan to Ferry')
    expect(row(cv, 'Doing')?.text).toBe('On its route to Ferry, for the storage')
    expect(row(cv, 'Crew')?.links?.map((l) => l.name)).toEqual(['Dan', 'Eve'])
    // The Trade Organization is no directive's target.
    expect(cv.directive).toBeUndefined()

    const army = inspectorCard({
      tick: 1,
      org: realm,
      is: 'army',
      army: {
        id: 'ar1',
        name: 'Vanguard',
        realmId: 'r1',
        memberIds: ['a1'],
        order: { kind: 'guard', at: { x: 9, y: 9 }, started: true },
        script: { scriptId: 2, name: 'Patrol', memory: {} },
      },
      members: [{ id: 'a1', name: 'Ada', x: 9, y: 9 }],
    })
    expect(army).toMatchObject({ title: 'Vanguard', badge: 'Army' })
    expect(row(army, 'Doing')?.text).toBe('Guarding 9, 9')
    expect(row(army, 'Script')?.text).toBe('Patrol')
    expect(row(army, 'Members')?.links?.[0]?.target).toEqual({ kind: 'resident', id: 'a1' })
    expect(army.directive).toEqual({ org: 'r1', name: 'Mara' })
  })

  it('shows buildings, horses and piles; what belongs to nobody has no directive', () => {
    const site = inspectorCard({
      tick: 1,
      org: realm,
      is: 'building',
      building: {
        id: 'b1',
        kind: 'gate',
        cityId: 'c1',
        x: 1,
        y: 2,
        closed: true,
      },
      city: { id: 'c1', name: 'Ashford' },
    })
    expect(site.title).toBe('Gate')
    expect(row(site, 'Gate')?.text).toBe('Shut')
    const pile = inspectorCard({
      tick: 1,
      org: null,
      is: 'pile',
      pile: { id: 'p', x: 1, y: 1, goods: { stone: 3 } },
    })
    expect(row(pile, 'Goods')?.text).toBe('3 stone')
    expect(pile.directive).toBeUndefined()
    const horse = inspectorCard({
      tick: 1,
      org: npc,
      is: 'horse',
      horse: { id: 'h', realmId: null, cityId: 'n1', x: 1, y: 1, hunger: 40, health: 90 },
    })
    expect(row(horse, 'Health')?.text).toBe('90 / 100')
  })
})

describe('what a place picked from the jump list inspects', () => {
  const entry = (kind: JumpEntry['kind']): JumpEntry => ({
    key: `${kind}:x`,
    id: 'x',
    kind,
    name: 'X',
    nested: false,
    at: { x: 1, y: 1 },
  })

  it('inspects a Leader, a city of any kind, a caravan or an army; a realm is nothing', () => {
    expect(jumpInspectTarget(entry('leader'))).toEqual({ kind: 'resident', id: 'x' })
    for (const k of ['city', 'npcCity', 'hq', 'post'] as const)
      expect(jumpInspectTarget(entry(k))).toEqual({ kind: 'city', id: 'x' })
    expect(jumpInspectTarget(entry('caravan'))).toEqual({ kind: 'caravan', id: 'x' })
    expect(jumpInspectTarget(entry('army'))).toEqual({ kind: 'army', id: 'x' })
    expect(jumpInspectTarget(entry('realm'))).toBeUndefined()
  })
})
