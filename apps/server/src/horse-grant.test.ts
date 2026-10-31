import { describe, expect, it } from 'vitest'
import {
  HORSE_GRANT_FOOD,
  HORSE_GRANT_HORSES,
  HORSE_START_AGE_MAX,
  HORSE_START_AGE_MIN,
  HORSE_STAT_MAX,
  HORSE_STAT_MIN,
  HORSE_STAT_NAMES,
  horseAgeInYears,
  isAt,
  nearFootprint,
  pileAt,
  type WorldState,
} from '@csp/shared'
import { checkInvariants } from './invariants.js'
import { grantHorses } from './horse-grant.js'
import { HORSE_NAMES } from './horses.js'
import { worldWithPost } from './test-terrain.js'
import { migrateWorld, migrations } from './world-format.js'

/** A world where Player 1's realm has lost every horse: none stabled, hitched or ridden. */
function withoutHorses() {
  const { world, terrain } = worldWithPost()
  const realm = world.realms[0]!
  world.horses = world.horses.filter((h) => h.realmId !== realm.id)
  for (const c of world.carriages) if (c.realmId === realm.id) c.horseId = null
  return { world, terrain, realm }
}

const realmHorses = (world: WorldState, realmId: string) =>
  world.horses.filter((h) => h.realmId === realmId)

describe('the Horse grant (migration 47 → 48)', () => {
  it('puts two new horses in a realm’s stable and says so in the realm log', () => {
    const { world, terrain, realm } = withoutHorses()
    const stable = world.buildings.find((b) => b.kind === 'stable' && b.cityId !== null)!
    const migrated = migrateWorld(structuredClone(world), 47, { terrain })

    const horses = realmHorses(migrated, realm.id)
    expect(horses).toHaveLength(HORSE_GRANT_HORSES)
    for (const h of horses) {
      expect(isAt(h, stable, terrain.size)).toBe(true)
      for (const s of HORSE_STAT_NAMES) {
        expect(h.stats[s]).toBeGreaterThanOrEqual(HORSE_STAT_MIN)
        expect(h.stats[s]).toBeLessThanOrEqual(HORSE_STAT_MAX)
      }
      const age = horseAgeInYears(h, migrated.tick)
      expect(age).toBeGreaterThanOrEqual(HORSE_START_AGE_MIN)
      expect(age).toBeLessThanOrEqual(HORSE_START_AGE_MAX)
      expect(HORSE_NAMES).toContain(h.name)
    }
    expect(migrated.events.at(-1)).toMatchObject({
      kind: 'horsesGranted',
      userId: realm.userId,
      horseIds: horses.map((h) => h.id),
      where: 'stable',
      city: migrated.cities.find((c) => c.id === stable.cityId)!.name,
      x: stable.x,
      y: stable.y,
    })
    expect(checkInvariants(migrated, terrain)).toEqual([])
  })

  it('puts them next to the storage with Food on the ground by each when the realm has no stable', () => {
    const { world, terrain, realm } = withoutHorses()
    const stable = world.buildings.find((b) => b.kind === 'stable' && b.cityId !== null)!
    world.buildings = world.buildings.filter((b) => b !== stable)
    world.piles = world.piles.filter((p) => !isAt(p, stable, terrain.size))
    const city = world.cities.find((c) => c.realmId === realm.id)!
    const storage = world.buildings.find((b) => b.kind === 'storage' && b.cityId === city.id)!
    const migrated = migrateWorld(structuredClone(world), 47, { terrain })

    const horses = realmHorses(migrated, realm.id)
    expect(horses).toHaveLength(HORSE_GRANT_HORSES)
    expect(new Set(horses.map((h) => `${h.x},${h.y}`)).size).toBe(horses.length)
    for (const h of horses) {
      expect(nearFootprint(storage, h, 1, terrain.size)).toBe(true)
      expect(isAt(h, storage, terrain.size)).toBe(false)
      expect(pileAt(migrated, h.x, h.y)?.goods).toEqual({ food: HORSE_GRANT_FOOD })
    }
    expect(migrated.events.at(-1)).toMatchObject({
      kind: 'horsesGranted',
      where: 'storage',
      city: city.name,
    })
    expect(checkInvariants(migrated, terrain)).toEqual([])
  })

  it('puts them next to the Leader when the realm has no city', () => {
    const { world, terrain, realm } = withoutHorses()
    // The realm's city went to nobody, as if lost; its Leader is still alive.
    for (const c of world.cities) if (c.realmId === realm.id) c.realmId = null
    const leader = world.residents.find((r) => r.id === realm.leaderId)!
    const migrated = structuredClone(world)
    grantHorses(migrated, terrain)

    const horses = realmHorses(migrated, realm.id)
    expect(horses).toHaveLength(HORSE_GRANT_HORSES)
    for (const h of horses) {
      expect(Math.max(Math.abs(h.x - leader.x), Math.abs(h.y - leader.y))).toBeLessThanOrEqual(2)
      expect(pileAt(migrated, h.x, h.y)?.goods.food).toBe(HORSE_GRANT_FOOD)
    }
    expect(migrated.events.at(-1)).toMatchObject({ kind: 'horsesGranted', where: 'leader' })
  })

  it('gives nothing to a realm with a horse, NPC cities or the Trade Organization', () => {
    const { world, terrain } = worldWithPost()
    const before = structuredClone(world)
    expect(world.horses.some((h) => h.realmId !== null)).toBe(true)
    expect(world.cities.some((c) => c.realmId === null)).toBe(true)
    const migrated = migrateWorld(structuredClone(world), 47, { terrain }, migrations, 48)
    expect(migrated).toEqual(before)
  })

  it('gives nothing a second time', () => {
    const { world, terrain } = withoutHorses()
    const once = migrateWorld(structuredClone(world), 47, { terrain })
    const twice = structuredClone(once)
    grantHorses(twice, terrain)
    expect(twice).toEqual(once)
    expect(migrateWorld(structuredClone(once), 48, { terrain })).toEqual(once)
  })

  it('gives nothing to a realm whose Leader is dead', () => {
    const { world, terrain, realm } = withoutHorses()
    world.residents = world.residents.filter((r) => r.id !== realm.leaderId)
    const migrated = structuredClone(world)
    grantHorses(migrated, terrain)
    expect(realmHorses(migrated, realm.id)).toEqual([])
  })
})
