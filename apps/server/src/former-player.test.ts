import {
  CITY_PRICE_STANDING_SWING,
  FORMER_PLAYER_STANDING,
  STANDING_DRIFT_PER_DAY,
  STANDING_RANGE,
  TICKS_PER_GAME_DAY,
  cityPrice,
  formerPlayerStanding,
  standingOf,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { formerPlayersSound, stepStanding } from './standing.js'
import { foundStartingCity } from './starting-city.js'
import { endRealm } from './survival.js'
import { worldWithCity } from './test-terrain.js'

/** Player 1's Leader has died: their starting city is self-managed now. */
function afterDeath() {
  const { world, terrain } = worldWithCity()
  const realm = world.realms[0]!
  const city = world.cities.find((c) => c.realmId === realm.id)!
  endRealm(world, realm, terrain.size)
  return { world, terrain, city, old: realm }
}

/** Lets `days` game days pass for standing alone. */
function passDays(world: WorldState, days: number) {
  for (let t = 0; t < days * TICKS_PER_GAME_DAY; t++) {
    world.tick++
    stepStanding(world)
  }
}

const sound = (world: WorldState, terrain: Parameters<typeof checkInvariants>[1]) =>
  checkInvariants(world, terrain).map((v) => v.message)

describe('a self-managed city remembers its former Player', () => {
  it('holds the Player’s new realm in good standing', () => {
    const { world, terrain, city } = afterDeath()
    expect(city.formerPlayer).toEqual({ userId: 1, tick: world.tick })
    expect(sound(world, terrain)).toEqual([])

    const realm = foundStartingCity(world, terrain, 1)

    expect(standingOf(world, city.id, realm.id)).toBe(FORMER_PLAYER_STANDING)
    // One-sided: the Player's realm holds no opinion of its own.
    expect(standingOf(world, realm.id, city.id)).toBe(0)
    // The memory lives on as that standing now.
    expect(city.formerPlayer).toBeUndefined()
    expect(sound(world, terrain)).toEqual([])
  })

  it('sells itself back to the Player’s new realm cheaper than to a stranger', () => {
    const { world, terrain, city } = afterDeath()
    const realm = foundStartingCity(world, terrain, 1)
    const stranger = foundStartingCity(world, terrain, 2)
    const worth = cityPrice(world, city)
    expect(cityPrice(world, city, stranger.id)).toBe(worth)
    expect(cityPrice(world, city, realm.id)).toBeLessThan(worth)
    expect(cityPrice(world, city, realm.id)).toBe(
      Math.round(
        worth * (1 - (CITY_PRICE_STANDING_SWING * FORMER_PLAYER_STANDING) / STANDING_RANGE),
      ),
    )
  })

  it('fades from the Leader’s death on, also while the Player is away', () => {
    const { world, terrain, city } = afterDeath()
    passDays(world, 10)
    expect(formerPlayerStanding(city, world.tick)).toBeCloseTo(
      FORMER_PLAYER_STANDING - 10 * STANDING_DRIFT_PER_DAY,
    )

    const realm = foundStartingCity(world, terrain, 1)
    expect(standingOf(world, city.id, realm.id)).toBeCloseTo(
      FORMER_PLAYER_STANDING - 10 * STANDING_DRIFT_PER_DAY,
    )

    passDays(world, 5)
    expect(standingOf(world, city.id, realm.id)).toBeCloseTo(
      FORMER_PLAYER_STANDING - 15 * STANDING_DRIFT_PER_DAY,
    )
    expect(sound(world, terrain)).toEqual([])
  })

  it('is forgotten once faded, and a Player back after that is a stranger', () => {
    const { world, terrain, city } = afterDeath()
    passDays(world, FORMER_PLAYER_STANDING / STANDING_DRIFT_PER_DAY)
    expect(city.formerPlayer).toBeUndefined()
    expect(sound(world, terrain)).toEqual([])

    const realm = foundStartingCity(world, terrain, 1)
    expect(standingOf(world, city.id, realm.id)).toBe(0)
  })

  it('is forgotten by a city that joins a realm', () => {
    const { world, terrain, city } = afterDeath()
    world.realms.push({ id: 'other', userId: 2, leaderId: 'nobody' })
    city.realmId = 'other'
    stepStanding(world)
    expect(city.formerPlayer).toBeUndefined()

    const realm = foundStartingCity(world, terrain, 1)
    expect(standingOf(world, city.id, realm.id)).toBe(0)
  })

  it('goes only to that Player', () => {
    const { world, terrain, city } = afterDeath()
    const stranger = foundStartingCity(world, terrain, 2)
    expect(standingOf(world, city.id, stranger.id)).toBe(0)
    expect(city.formerPlayer?.userId).toBe(1)
    expect(sound(world, terrain)).toEqual([])
  })

  it('is checked by an invariant', () => {
    const { world, terrain, city } = afterDeath()
    const check = () => checkInvariants(world, terrain, [formerPlayersSound]).map((v) => v.message)
    expect(check()).toEqual([])

    city.formerPlayer = { userId: 1, tick: world.tick + 1 }
    expect(check()).toEqual([expect.stringMatching(/still to come/)])

    city.formerPlayer = { userId: 1, tick: world.tick }
    world.realms.push({ id: 'again', userId: 1, leaderId: 'nobody' })
    expect(check()).toEqual([expect.stringMatching(/has a realm again/)])
    world.realms.pop()

    city.realmId = 'again'
    expect(check()).toContainEqual(expect.stringMatching(/belongs to a realm/))
  })
})
