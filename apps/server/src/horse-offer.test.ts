import { describe, expect, it } from 'vitest'
import { HORSE_GRANT_FOOD, HORSE_GRANT_HORSES, isAt, pileAt, type WorldState } from '@csp/shared'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { foundStartingCity, realmOf } from './starting-city.js'
import { dieAll } from './survival.js'
import { worldWithPost } from './test-terrain.js'

const player = { userId: 1, account: { name: 'Mara', isAdmin: false } }

/** Player 1's starting city, and a queue that applies each order as the next tick would. */
function setup() {
  const { world, terrain } = worldWithPost()
  const queue = new OrderQueue(undefined, terrain)
  const claim = (sender = player) => {
    const answer = queue.receive(world, sender, 'q', { kind: 'claimHorses' })
    queue.applyAll(world)
    return answer.type === 'rejected' ? answer.reason : 'ok'
  }
  return { world, terrain, claim }
}

const realmHorses = (world: WorldState, realmId: string) =>
  world.horses.filter((h) => h.realmId === realmId)

describe('the Horse offer', () => {
  it('puts two new horses in the realm’s stable, as the grant would, and logs where', () => {
    const { world, terrain, claim } = setup()
    const realm = realmOf(world, 1)!
    const before = realmHorses(world, realm.id).map((h) => h.id)
    expect(before.length).toBeGreaterThan(0)
    const stable = world.buildings.find((b) => b.kind === 'stable' && b.cityId !== null)!

    expect(claim()).toBe('ok')

    const added = realmHorses(world, realm.id).filter((h) => !before.includes(h.id))
    expect(added).toHaveLength(HORSE_GRANT_HORSES)
    for (const h of added) expect(isAt(h, stable, terrain.size)).toBe(true)
    expect(world.events.at(-1)).toMatchObject({
      kind: 'horsesClaimed',
      userId: 1,
      horseIds: added.map((h) => h.id),
      where: 'stable',
      city: world.cities.find((c) => c.id === stable.cityId)!.name,
      x: stable.x,
      y: stable.y,
    })
    expect(world.horseOffersClaimed).toEqual([1])
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('puts them next to the storage with Food by each when the realm has no stable', () => {
    const { world, terrain, claim } = setup()
    const stable = world.buildings.find((b) => b.kind === 'stable' && b.cityId !== null)!
    world.buildings = world.buildings.filter((b) => b !== stable)
    world.piles = world.piles.filter((p) => !isAt(p, stable, terrain.size))
    world.horses = world.horses.filter((h) => !isAt(h, stable, terrain.size))
    const realm = realmOf(world, 1)!
    const before = realmHorses(world, realm.id).map((h) => h.id)

    expect(claim()).toBe('ok')

    const added = realmHorses(world, realm.id).filter((h) => !before.includes(h.id))
    expect(added).toHaveLength(HORSE_GRANT_HORSES)
    for (const h of added)
      expect(pileAt(world, h.x, h.y)?.goods).toEqual({ food: HORSE_GRANT_FOOD })
    expect(world.events.at(-1)).toMatchObject({ kind: 'horsesClaimed', where: 'storage' })
  })

  it('refuses a second claim', () => {
    const { world, claim } = setup()
    expect(claim()).toBe('ok')
    const after = structuredClone(world)
    expect(claim()).toBe('you have claimed your horses already')
    expect(world).toEqual(after)
  })

  it('takes only one of two claims sent in the same tick', () => {
    const { world, terrain } = setup()
    const queue = new OrderQueue(undefined, terrain)
    expect(queue.receive(world, player, 'a', { kind: 'claimHorses' }).type).toBe('ack')
    expect(queue.receive(world, player, 'b', { kind: 'claimHorses' }).type).toBe('ack')
    const horses = world.horses.length
    queue.applyAll(world)
    expect(world.horses).toHaveLength(horses + HORSE_GRANT_HORSES)
    expect(world.horseOffersClaimed).toEqual([1])
  })

  it('refuses a Player without a living Leader', () => {
    const { world, claim } = setup()
    const realm = realmOf(world, 1)!
    world.residents = world.residents.filter((r) => r.id !== realm.leaderId)
    expect(claim()).toBe('you have no living Leader')
    expect(claim({ userId: 2, account: { name: 'Tobin', isAdmin: false } })).toBe(
      'you have no living Leader',
    )
    expect(world.horseOffersClaimed).toEqual([])
  })

  it('stays claimed after the Leader dies and the Player founds a new realm', () => {
    const { world, terrain, claim } = setup()
    expect(claim()).toBe('ok')
    const leader = world.residents.find((r) => r.id === realmOf(world, 1)!.leaderId)!
    dieAll(world, [leader], 'starved', terrain.size)
    expect(realmOf(world, 1)).toBeUndefined()

    foundStartingCity(world, terrain, 1)
    expect(claim()).toBe('you have claimed your horses already')
    expect(world.horseOffersClaimed).toEqual([1])
  })

  it('stays open for a Player who never claimed it, across a Leader death', () => {
    const { world, terrain, claim } = setup()
    const leader = world.residents.find((r) => r.id === realmOf(world, 1)!.leaderId)!
    dieAll(world, [leader], 'starved', terrain.size)
    expect(claim()).toBe('you have no living Leader')
    foundStartingCity(world, terrain, 1)
    expect(claim()).toBe('ok')
  })

  it('finds a world where a Player claimed twice broken (invariant)', () => {
    const { world, terrain } = setup()
    world.horseOffersClaimed = [1, 1]
    expect(checkInvariants(world, terrain).map((v) => v.invariant)).toEqual(['horse-offers-once'])
  })
})
