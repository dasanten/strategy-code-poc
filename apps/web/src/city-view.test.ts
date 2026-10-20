import type { Building, City, Resident } from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { buildingCount, describeBuying, describeCity } from './city-view.js'

const city = (realmId: string | null): City => ({
  id: 'city1',
  name: 'Ashford',
  realmId,
  townHallId: 'b1',
})
const b = (id: string, kind: Building['kind'], cityId: string | null, site = false): Building => ({
  id,
  kind,
  cityId,
  x: 0,
  y: 0,
  ...(site ? { site: { delivered: {}, work: 0 } } : {}),
})
const resident = (cityId: string | null) => ({ cityId }) as Resident
const realms = [{ realmId: 'realm2', realm: 'Mara' }]

describe('city inspector', () => {
  it('says whose a city is', () => {
    const none = { residents: [], buildings: [] }
    expect(describeCity(city(null), none, 'realm1', realms).whose).toBe('NPC city')
    expect(describeCity({ ...city(null), tradeOrg: 'hq' }, none, 'realm1', realms).whose).toBe(
      'Trade Org HQ',
    )
    expect(describeCity(city('realm1'), none, 'realm1', realms).whose).toBe('Your city')
    expect(describeCity(city('realm2'), none, 'realm1', realms).whose).toBe(
      'City of the realm of Mara',
    )
    expect(describeCity(city('realm3'), none, 'realm1', realms).whose).toBe(
      'City of the realm of another Player',
    )
  })

  it('counts the residents and finished buildings in sight that belong to it', () => {
    const seen = {
      residents: [resident('city1'), resident('city1'), resident('city2'), resident(null)],
      buildings: [
        b('b1', 'townHall', 'city1'),
        b('b2', 'house', 'city1'),
        b('b3', 'house', 'city1'),
        b('b4', 'house', 'city1', true),
        b('b5', 'house', 'city2'),
      ],
    }
    expect(describeCity(city(null), seen, 'realm1', realms)).toEqual({
      id: 'city1',
      name: 'Ashford',
      whose: 'NPC city',
      residents: 2,
      buildings: [
        ['house', 2],
        ['townHall', 1],
      ],
    })
  })

  it('names building counts', () => {
    expect(buildingCount('house', 3)).toBe('3 houses')
    expect(buildingCount('townHall', 1)).toBe('1 town hall')
    expect(buildingCount('lumberCamp', 2)).toBe('2 lumber camps')
  })
})

describe('buying a city in the inspector', () => {
  const hall = { ...b('b1', 'townHall', 'city1'), x: 5, y: 6 }
  const mine = (x: number, y: number, coins?: number) =>
    ({ id: `r${x}${y}`, owner: 'realm1', x, y, carried: coins ? { coins } : {} }) as Resident

  it('names no price for a city that is not for sale', () => {
    expect(describeBuying(city('realm2'), { residents: [], buildings: [hall] }, 'realm1')).toBe(
      undefined,
    )
  })

  it('shows the price and where to bring the coins', () => {
    const view = describeBuying(
      { ...city(null), price: 900 },
      { residents: [mine(1, 1, 500)], buildings: [hall] },
      'realm1',
    )
    expect(view).toEqual({ price: 900, townHall: { x: 5, y: 6 }, coins: 0 })
  })

  it('adds up the coins of the Player’s residents on the town hall and picks one to buy', () => {
    const other = { ...mine(5, 6, 700), owner: 'realm2' } as Resident
    const view = describeBuying(
      { ...city(null), price: 900 },
      { residents: [mine(5, 6, 500), mine(5, 6, 300), other], buildings: [hall] },
      'realm1',
    )
    expect(view).toEqual({ price: 900, townHall: { x: 5, y: 6 }, coins: 800, buyerId: 'r56' })
  })
})
