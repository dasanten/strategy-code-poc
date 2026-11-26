import { BUILDING_KINDS } from '@csp/balance'
import { buildingWork as rustBuildingWork, WorldMirror } from '@csp/lang-wasm'
import type { Building, BuildingKind } from '@csp/shared-types'
import { describe, expect, it } from 'vitest'
import { buildingAt, buildingWork } from './shared/building.js'
import { Terrain } from './shared/terrain.js'

/**
 * The Rust rules as WebAssembly (ADR 0045, T122.1): they answer what the TypeScript copy answers,
 * in Vitest as in the browser. The copy goes in later tickets of Epic 122.
 */

describe('a rule that needs no world', () => {
  it('answers the work a building takes as the TypeScript copy does, over each terrain', () => {
    for (const kind of BUILDING_KINDS) {
      for (const under of [undefined, Terrain.Plains, Terrain.Mountain]) {
        expect([kind, under, rustBuildingWork(kind, under)]).toEqual([
          kind,
          under,
          buildingWork(kind, under),
        ])
      }
    }
  })

  it('says NaN for a kind that is none', () => {
    expect(rustBuildingWork('castle' as BuildingKind)).toBeNaN()
  })
})

describe('the world mirror', () => {
  const SIZE = 64
  const building = (id: string, kind: BuildingKind, x: number, y: number): Building => ({
    id,
    kind,
    cityId: null,
    x,
    y,
  })
  const seen = (b: Building) => ({ is: 'building', ...b })
  const welcome = (buildings: Building[]) =>
    JSON.stringify({
      type: 'welcome',
      map: { size: SIZE },
      entities: buildings.map(seen),
    })

  it('finds the building on a tile as the TypeScript copy does, across the map’s join too', () => {
    const buildings = [
      building('b1', 'farm', 10, 10),
      building('b2', 'storage', 62, 63),
      building('b3', 'road', 11, 10),
      building('b4', 'townHall', 20, 5),
    ]
    const mirror = new WorldMirror()
    mirror.welcome(welcome(buildings))
    expect(mirror.count).toBe(4)
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        expect([x, y, mirror.buildingAt(x, y)]).toEqual([
          x,
          y,
          buildingAt({ buildings }, x, y, SIZE)?.id,
        ])
      }
    }
    mirror.free()
  })

  it('takes in what a tick changed and what left sight', () => {
    const mirror = new WorldMirror()
    mirror.welcome(welcome([building('b1', 'farm', 10, 10), building('b2', 'storage', 30, 30)]))
    const tick = {
      type: 'tick',
      changed: [seen(building('b3', 'house', 40, 40)), seen(building('b1', 'farm', 12, 10))],
      gone: ['b2'],
    }
    mirror.tick(JSON.stringify(tick))
    expect([mirror.buildingAt(10, 10), mirror.buildingAt(12, 10)]).toEqual([undefined, 'b1'])
    expect([mirror.buildingAt(30, 30), mirror.buildingAt(40, 40)]).toEqual([undefined, 'b3'])
    mirror.free()
  })

  it('throws on a message it can’t read, and keeps what it had', () => {
    const mirror = new WorldMirror()
    mirror.welcome(welcome([building('b1', 'farm', 10, 10)]))
    expect(() => mirror.tick('{"changed": 1}')).toThrow()
    expect(mirror.buildingAt(10, 10)).toBe('b1')
    mirror.free()
  })
})
