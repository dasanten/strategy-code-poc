import {
  CHUNK_SIZE,
  Terrain,
  chunksAcross,
  organizationName,
  regionMapFor,
  type Territory,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { regionMapUnsound } from './region-map.js'
import { mulberry32, newResident } from './residents.js'
import { addCity } from './test-terrain.js'
import { createWorld } from './world.js'

const terrain: TerrainMap = { size: 64, tiles: new Uint8Array(64 * 64).fill(Terrain.Plains) }
const size = terrain.size

/** Realms r1, r2 and r3 led by Ann, Bo and Cy; r1 and r2 in the alliance North; city c3 alone. */
function setup(): WorldState {
  const world = createWorld(terrain)
  world.nodes = []
  const leaders = [
    ['r1', 'Ann'],
    ['r2', 'Bo'],
    ['r3', 'Cy'],
  ] as const
  leaders.forEach(([id, name], i) => {
    world.realms.push({ id, userId: i + 1, leaderId: `lead-${id}` })
    const r = newResident(mulberry32(i), { id: `lead-${id}`, owner: id, x: 60, y: 60 + i })
    world.residents.push({ ...r, name })
  })
  world.alliances.push({
    id: 'a1',
    name: 'North',
    leaderId: 'r1',
    members: [
      { realmId: 'r1', joinedAt: 0, leavesAt: null },
      { realmId: 'r2', joinedAt: 0, leavesAt: null },
    ],
    invites: [],
    army: [],
  })
  addCity(world, { id: 'c3', realmId: null, x: 40, y: 40, name: 'Oakmoor' })
  return world
}

/** Territory with the given "x,y" tiles held. */
function territory(owners: Record<string, string>): Territory {
  return { tick: 120, owners: new Map(Object.entries(owners)) }
}

const everywhere = () => true

describe('region map', () => {
  it('names realms by their Leader and cities by their own name', () => {
    const world = setup()
    expect(organizationName(world, 'r2')).toBe('Bo')
    expect(organizationName(world, 'c3')).toBe('Oakmoor')
  })

  it('shows every holder over explored terrain, alliance members with their alliance', () => {
    const world = setup()
    const t = territory({ '1,1': 'r1', '2,1': 'r2', '3,1': 'r3', '1,2': 'c3', '5,5': 'r1' })
    const region = regionMapFor(world, t, size, everywhere)
    expect(region).toEqual({
      tick: 120,
      chunks: null,
      holders: [
        { id: 'c3', name: 'Oakmoor', alliance: null, tiles: [2 * size + 1] },
        { id: 'r1', name: 'Ann', alliance: { id: 'a1', name: 'North' }, tiles: [65, 5 * size + 5] },
        { id: 'r2', name: 'Bo', alliance: { id: 'a1', name: 'North' }, tiles: [66] },
        { id: 'r3', name: 'Cy', alliance: null, tiles: [67] },
      ],
    })
    expect(regionMapUnsound(region, t, size, everywhere, 'r3')).toEqual([])
  })

  it('leaves out territory on terrain the Player has not explored', () => {
    const world = setup()
    const t = territory({ '1,1': 'r1', '20,1': 'r1', '30,30': 'r3' })
    const explored = (x: number) => x < 10
    const region = regionMapFor(world, t, size, explored)
    expect(region.holders).toEqual([expect.objectContaining({ id: 'r1', tiles: [size + 1] })])
    expect(regionMapUnsound(region, t, size, explored, 'r2')).toEqual([])
  })

  it('covers only the given chunks when asked for part of it', () => {
    const world = setup()
    const t = territory({ '1,1': 'r1', [`${CHUNK_SIZE + 1},1`]: 'r2', '1,40': 'r3' })
    const region = regionMapFor(world, t, size, everywhere, [1])
    expect(region.chunks).toEqual([1])
    expect(region.holders.map((h) => [h.id, h.tiles])).toEqual([['r2', [size + CHUNK_SIZE + 1]]])
    // Every chunk together is the whole map.
    const n = chunksAcross(size)
    const all = regionMapFor(world, t, size, everywhere, [...Array(n * n).keys()])
    expect(all.holders).toEqual(regionMapFor(world, t, size, everywhere).holders)
  })

  it('flags a Region map showing unexplored, wrong or doubled tiles (invariant)', () => {
    const t = territory({ '1,1': 'r1', '2,1': 'r2' })
    const region = {
      tick: 120,
      chunks: null,
      holders: [
        { id: 'r1', name: 'Ann', alliance: null, tiles: [size + 1, size + 2, 40 * size] },
        { id: 'r2', name: 'Bo', alliance: null, tiles: [size + 2] },
      ],
    }
    const explored = (_x: number, y: number) => y < 10
    const problems = regionMapUnsound(region, t, size, explored, 'r3').map((v) => v.message)
    expect(problems).toEqual([
      'tile 2,1 went to realm r3 as held by r1: not theirs',
      'tile 0,40 went to realm r3 as held by r1: unexplored',
      'tile 2,1 went to realm r3 as held by r2: shown twice',
    ])
  })
})
