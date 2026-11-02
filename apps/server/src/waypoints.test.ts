import { describe, expect, it } from 'vitest'
import { WAYPOINTS_MAX, WAYPOINT_NAME_MAX_LENGTH, type OrderRequest } from '@csp/shared'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { foundStartingCity, realmOf } from './starting-city.js'
import { dieAll } from './survival.js'
import { worldWithPost } from './test-terrain.js'
import { waypointsOf } from './waypoints.js'

const player = { userId: 1, account: { name: 'Mara', isAdmin: false } }
const other = { userId: 2, account: { name: 'Edda', isAdmin: false } }

/** Player 1's starting city, and a queue that applies each order as the next tick would. */
function setup() {
  const { world, terrain } = worldWithPost()
  const queue = new OrderQueue(undefined, terrain)
  const send = (order: OrderRequest, sender = player) => {
    const answer = queue.receive(world, sender, 'q', order)
    queue.applyAll(world)
    return answer.type === 'rejected' ? answer.reason : 'ok'
  }
  const add = (x: number, y: number, name: string, sender = player) =>
    send({ kind: 'addWaypoint', x, y, name }, sender)
  return { world, terrain, queue, send, add }
}

describe('waypoints', () => {
  it('are added on a tile with their name trimmed, oldest first, for their Player only', () => {
    const { world, terrain, add } = setup()
    expect(add(3, 4, '  Pass ')).toBe('ok')
    expect(add(10, 2, 'Gold ore node')).toBe('ok')
    const held = waypointsOf(world, 1)
    expect(held.map(({ name, x, y }) => ({ name, x, y }))).toEqual([
      { name: 'Pass', x: 3, y: 4 },
      { name: 'Gold ore node', x: 10, y: 2 },
    ])
    expect(new Set(held.map((w) => w.id)).size).toBe(2)
    expect(waypointsOf(world, 2)).toEqual([])
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('turn down a tile off the map and a bad name', () => {
    const { world, terrain, add } = setup()
    expect(add(-1, 4, 'Pass')).toBe('not a tile on the map')
    expect(add(terrain.size, 4, 'Pass')).toBe('not a tile on the map')
    expect(add(1.5, 4, 'Pass')).toBe('not a tile on the map')
    expect(add(3, 4, '   ')).toBe('Name: needs a name')
    expect(add(3, 4, 'x'.repeat(WAYPOINT_NAME_MAX_LENGTH + 1))).toBe(
      `Name: at most ${WAYPOINT_NAME_MAX_LENGTH} characters`,
    )
    expect(world.waypoints).toEqual({})
  })

  it(`are turned down past ${WAYPOINTS_MAX} per Player, also when sent in the same tick`, () => {
    const { world, terrain, queue, add } = setup()
    for (let i = 0; i < WAYPOINTS_MAX - 1; i++) expect(add(i % terrain.size, 1, `W${i}`)).toBe('ok')
    // Two at once: both pass the check on arrival, only the first fits when applied.
    queue.receive(world, player, 'a', { kind: 'addWaypoint', x: 1, y: 1, name: 'Last' })
    queue.receive(world, player, 'b', { kind: 'addWaypoint', x: 2, y: 1, name: 'Too many' })
    queue.applyAll(world)
    expect(waypointsOf(world, 1)).toHaveLength(WAYPOINTS_MAX)
    expect(waypointsOf(world, 1).at(-1)!.name).toBe('Last')
    expect(add(5, 5, 'More')).toBe(`you hold ${WAYPOINTS_MAX} waypoints already, the most`)
    // Another Player's cap is their own.
    expect(add(5, 5, 'Mine', other)).toBe('ok')
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('are renamed and removed only by their own Player', () => {
    const { world, send, add } = setup()
    add(3, 4, 'Pass')
    add(6, 6, 'Ford')
    const [pass, ford] = waypointsOf(world, 1)
    expect(send({ kind: 'renameWaypoint', waypointId: pass!.id, name: ' High pass ' })).toBe('ok')
    expect(waypointsOf(world, 1)[0]).toEqual({ ...pass, name: 'High pass' })
    expect(send({ kind: 'renameWaypoint', waypointId: pass!.id, name: '' })).toBe(
      'Name: needs a name',
    )
    expect(send({ kind: 'renameWaypoint', waypointId: pass!.id, name: 'Mine' }, other)).toBe(
      'not one of your waypoints',
    )
    expect(send({ kind: 'removeWaypoint', waypointId: pass!.id }, other)).toBe(
      'not one of your waypoints',
    )

    expect(send({ kind: 'removeWaypoint', waypointId: pass!.id })).toBe('ok')
    expect(waypointsOf(world, 1)).toEqual([ford])
    expect(send({ kind: 'removeWaypoint', waypointId: pass!.id })).toBe('not one of your waypoints')
    expect(send({ kind: 'removeWaypoint', waypointId: ford!.id })).toBe('ok')
    // A Player left with none has no entry.
    expect(world.waypoints).toEqual({})
  })

  it('stay with the Player across a Leader death and a new realm', () => {
    const { world, terrain, add } = setup()
    add(3, 4, 'Pass')
    const before = waypointsOf(world, 1)
    const leader = world.residents.find((r) => r.id === realmOf(world, 1)!.leaderId)!
    dieAll(world, [leader], 'starved', terrain.size)
    expect(realmOf(world, 1)).toBeUndefined()
    expect(waypointsOf(world, 1)).toEqual(before)

    foundStartingCity(world, terrain, 1)
    expect(waypointsOf(world, 1)).toEqual(before)
    expect(add(5, 5, 'New home')).toBe('ok')
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('leave a resident’s script running when a script of theirs puts one down', () => {
    const { world, send } = setup()
    const r = world.residents.find((x) => x.owner === realmOf(world, 1)!.id)!
    r.script = { scriptId: 1, memory: {} } as unknown as NonNullable<typeof r.script>
    expect(send({ kind: 'addWaypoint', residentId: r.id, x: 3, y: 4, name: 'Pass' })).toBe('ok')
    expect(r.script).toBeDefined()
  })

  it('finds waypoints past the cap, off the map, badly named or sharing an id broken (invariant)', () => {
    const { world, terrain } = setup()
    world.waypoints[1] = [
      { id: 'wp1', name: 'Pass', x: terrain.size, y: 0 },
      { id: 'wp1', name: ' Ford', x: 0, y: 0 },
    ]
    world.waypoints[2] = Array.from({ length: WAYPOINTS_MAX + 1 }, (_, i) => ({
      id: `wp${100 + i}`,
      name: 'W',
      x: 0,
      y: 0,
    }))
    const messages = checkInvariants(world, terrain)
      .filter((v) => v.invariant === 'waypoints-sound')
      .map((v) => v.message)
    expect(messages).toEqual([
      `Player 1's waypoint wp1: is off the map`,
      `Player 1's waypoint wp1: shares its id with another waypoint`,
      `Player 2 holds ${WAYPOINTS_MAX + 1} waypoints, more than ${WAYPOINTS_MAX}`,
    ])
  })
})
