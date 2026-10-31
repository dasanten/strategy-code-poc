import { describe, expect, it } from 'vitest'
import { BUILD_MATERIALS, HOUSING_ROOM, RECIPES, WORKPLACE_MAX_WORKERS } from './balance.js'
import { BUILDING_PURPOSE, buildingInfo } from './building-info.js'
import { FOOTPRINT } from './footprint.js'
import type { BuildingKind } from './world.js'

/** Every kind of building there is: the footprint table has one entry per kind. */
const KINDS = Object.keys(FOOTPRINT) as BuildingKind[]

describe('building descriptions', () => {
  it('gives every kind of building a description', () => {
    for (const kind of KINDS) expect(BUILDING_PURPOSE[kind]?.trim(), kind).toBeTruthy()
    expect(Object.keys(BUILDING_PURPOSE).sort()).toEqual([...KINDS].sort())
  })

  it('writes no numbers into the text, which come from the balance', () => {
    const room = `room for ${HOUSING_ROOM.house} residents`
    for (const kind of KINDS)
      expect(BUILDING_PURPOSE[kind].replace(room, ''), kind).not.toMatch(/\d/)
  })

  it('says how many residents a house is room for (`HOUSING_ROOM`)', () => {
    expect(BUILDING_PURPOSE.house).toContain(`room for ${HOUSING_ROOM.house} residents`)
  })
})

describe('buildingInfo', () => {
  it('takes a processing workplace’s recipes, skill, workers, footprint and cost from the balance', () => {
    const info = buildingInfo('smelter')
    expect(info.recipes).toBe(RECIPES.smelter)
    expect(info.yields).toEqual([])
    expect(info.skill).toBe('smelting')
    expect(info.maxWorkers).toBe(WORKPLACE_MAX_WORKERS.smelter)
    expect(info.footprint).toBe(FOOTPRINT.smelter)
    expect(info.materials).toBe(BUILD_MATERIALS.smelter)
    expect(info.work).toBeGreaterThan(0)
  })

  it('says a node’s workplace yields what its node does, either ore for a mine until its node is known', () => {
    expect(buildingInfo('mine').yields).toEqual(['ironOre', 'goldOre'])
    expect(buildingInfo('mine', 'goldOre').yields).toEqual(['goldOre'])
    expect(buildingInfo('lumberCamp').yields).toEqual(['wood'])
    expect(buildingInfo('mine').skill).toBe('mining')
  })

  it('says a farm makes Food and a city building nothing', () => {
    expect(buildingInfo('farm').yields).toEqual(['food'])
    const house = buildingInfo('house')
    expect(house.yields).toEqual([])
    expect(house.recipes).toEqual([])
    expect(house.skill).toBeUndefined()
    expect(house.maxWorkers).toBeUndefined()
  })

  it('gives a kind with no materials an empty cost', () => {
    expect(buildingInfo('warehouse').materials).toEqual({})
  })
})
