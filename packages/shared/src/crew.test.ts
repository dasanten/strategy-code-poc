import { describe, expect, it } from 'vitest'
import { crewTile } from './crew.js'
import type { Building, Resident, WorldState } from './world.js'

/**
 * Where a resident stands at a building they are sent to (`CONTEXT.md`: Spreading over the
 * footprint): the footprint tile with the fewest of the crew on it, the nearest on ties.
 */

const SIZE = 16
/** A 2x2 mine with its north-west tile at (5, 5). */
const mine: Building = { id: 'mine', kind: 'mine', cityId: null, x: 5, y: 5 }

function resident(
  id: string,
  x: number,
  y: number,
  more: Partial<Pick<Resident, 'order' | 'script' | 'owner'>> = {},
): Resident {
  return { id, owner: 'r1', x, y, order: null, ...more } as unknown as Resident
}

const working = { kind: 'workAt', buildingId: 'mine', at: { x: 5, y: 5 }, progress: 0 } as const
const ofRealm = (r: Resident) => r.owner === 'r1'
const tile = (world: Pick<WorldState, 'residents'>, me: Resident) =>
  crewTile(world, mine, me, ofRealm, SIZE)

describe('crewTile (`CONTEXT.md`: Spreading over the footprint)', () => {
  it('sends a lone resident to the footprint tile nearest them', () => {
    const me = resident('me', 9, 6)
    expect(tile({ residents: [me] }, me)).toEqual({ x: 6, y: 6 })
  })

  it('keeps one already on the footprint where they are while their tile is among the fewest', () => {
    const me = resident('me', 6, 6)
    const other = resident('o', 5, 5, { order: working })
    expect(tile({ residents: [me, other] }, me)).toEqual({ x: 6, y: 6 })
  })

  it('moves one off a crowded tile to the least crowded, the nearest on ties', () => {
    const me = resident('me', 5, 5)
    const crew = [
      resident('a', 5, 5, { order: working }),
      resident('b', 5, 5, { order: working }),
      resident('c', 6, 5, { order: working }),
    ]
    // (5, 6) and (6, 6) are both empty; (5, 6) is a straight step away, (6, 6) a diagonal one.
    expect(tile({ residents: [me, ...crew] }, me)).toEqual({ x: 5, y: 6 })
  })

  it('counts those on their way at the tile their script sends them to', () => {
    const me = resident('me', 5, 5)
    const walking = (id: string, at: { x: number; y: number }) =>
      resident(id, 12, 12, { script: { scriptId: 1, memory: { workplaceId: 'mine', at } } })
    const crew = [
      walking('a', { x: 5, y: 5 }),
      walking('b', { x: 6, y: 5 }),
      walking('c', { x: 5, y: 6 }),
    ]
    expect(tile({ residents: [me, ...crew] }, me)).toEqual({ x: 6, y: 6 })
  })

  it('leaves out other realms’ residents, me, and those busy elsewhere', () => {
    const me = resident('me', 5, 5)
    const others = [
      resident('t', 5, 5, { owner: 'r2', order: working }),
      resident('idle', 5, 5),
      resident('elsewhere', 5, 5, {
        order: { kind: 'workAt', buildingId: 'farm', at: { x: 5, y: 5 }, progress: 0 },
      }),
      resident('far', 5, 5, { script: { scriptId: 1, memory: { at: { x: 1, y: 1 } } } }),
    ]
    expect(tile({ residents: [me, ...others] }, me)).toEqual({ x: 5, y: 5 })
  })

  it('counts builders and breeders by their orders at the building too', () => {
    const site: Building = {
      id: 'h',
      kind: 'house',
      cityId: null,
      x: 5,
      y: 5,
      site: { delivered: {}, work: 0 },
    }
    const me = resident('me', 5, 5)
    const builder = resident('b', 5, 5, {
      order: { kind: 'build', building: 'house', at: { x: 5, y: 5 }, siteId: 'h' },
    })
    expect(crewTile({ residents: [me, builder] }, site, me, ofRealm, SIZE)).toEqual({ x: 6, y: 5 })

    const stable: Building = { id: 's', kind: 'stable', cityId: null, x: 5, y: 5 }
    const breeder = resident('k', 5, 5, {
      order: {
        kind: 'breed',
        stableId: 's',
        horseIds: ['h1', 'h2'],
        at: { x: 5, y: 5 },
        progress: 0,
      },
    })
    expect(crewTile({ residents: [me, breeder] }, stable, me, ofRealm, SIZE)).toEqual({
      x: 6,
      y: 5,
    })
  })

  it('wraps the footprint across the map’s join', () => {
    const edge: Building = { id: 'q', kind: 'quarry', cityId: null, x: 15, y: 15 }
    const me = resident('me', 1, 1)
    const other = resident('o', 0, 0, {
      order: { kind: 'workAt', buildingId: 'q', at: { x: 0, y: 0 }, progress: 0 },
    })
    expect(crewTile({ residents: [me, other] }, edge, me, ofRealm, SIZE)).toEqual({ x: 0, y: 15 })
  })
})
