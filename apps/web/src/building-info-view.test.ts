import { describe, expect, it } from 'vitest'
import {
  BUILDING_PURPOSE,
  FOOTPRINT,
  WORKPLACE_MAX_WORKERS,
  type Building,
  type KnownNode,
} from '@csp/shared'
import { buildingInfoLines, buildingNodeKind } from './building-info-view.js'
import { GOOD_LABELS, SKILL_LABELS } from './Residents.js'

const labels = { goods: GOOD_LABELS, skills: SKILL_LABELS }

const site = (b: Partial<Building> & Pick<Building, 'kind'>): Building => ({
  id: `b-${b.kind}`,
  cityId: null,
  x: 0,
  y: 0,
  ...b,
})

describe('buildingInfoLines', () => {
  it('shows a smelter’s purpose, recipe, skill, workers, footprint and cost', () => {
    expect(buildingInfoLines('smelter', labels)).toEqual([
      BUILDING_PURPOSE.smelter,
      '2 iron ore → 1 iron',
      'Teaches Smelting',
      `Up to ${WORKPLACE_MAX_WORKERS.smelter} workers`,
      `Footprint ${FOOTPRINT.smelter} × ${FOOTPRINT.smelter} tiles`,
      'Built from 20 wood, 40 stone and about 4 game days of one resident’s work',
    ])
  })

  it('gives a smithy a line for each recipe', () => {
    const lines = buildingInfoLines('smithy', labels)
    expect(lines).toContain('2 wood, 1 iron → 1 spear')
    expect(lines).toContain('1 wood, 7 iron → 1 armour')
  })

  it('says a node’s workplace makes what its node yields', () => {
    expect(buildingInfoLines('mine', labels, { node: 'goldOre' })).toContain(
      'Makes gold ore, from its node',
    )
    expect(buildingInfoLines('mine', labels)).toContain('Makes iron ore or gold ore, from its node')
    expect(buildingInfoLines('lumberCamp', labels)).toContain(
      'Built from no materials and about 2 game days of one resident’s work',
    )
  })

  it('gives a city building no workplace lines', () => {
    expect(buildingInfoLines('house', labels)).toEqual([
      BUILDING_PURPOSE.house,
      `Footprint ${FOOTPRINT.house} × ${FOOTPRINT.house} tiles`,
      'Built from 20 wood and about 1 game day of one resident’s work',
    ])
  })

  it('gives a building nobody builds no cost line', () => {
    expect(buildingInfoLines('warehouse', labels)).toEqual([
      BUILDING_PURPOSE.warehouse,
      `Footprint ${FOOTPRINT.warehouse} × ${FOOTPRINT.warehouse} tiles`,
    ])
  })

  it('says what a construction site still needs instead of its cost', () => {
    const smelter = site({ kind: 'smelter', site: { delivered: { stone: 40, wood: 5 }, work: 0 } })
    const lines = buildingInfoLines('smelter', labels, { site: smelter })
    expect(lines.at(-1)).toBe('Still needs 15 wood and about 4 game days of one resident’s work')
    const done = site({ kind: 'house', site: { delivered: { wood: 20 }, work: 1e9 } })
    expect(buildingInfoLines('house', labels, { site: done }).at(-1)).toBe(
      'Still needs no more materials and no more work',
    )
  })
})

describe('buildingNodeKind', () => {
  it('finds the node under any tile of the footprint', () => {
    const node: KnownNode = { kind: 'ironOre', x: 11, y: 11 }
    const nodeAt = (x: number, y: number) => (x === node.x && y === node.y ? node : undefined)
    expect(buildingNodeKind(site({ kind: 'mine', x: 10, y: 10 }), nodeAt)).toBe('ironOre')
    expect(buildingNodeKind(site({ kind: 'mine', x: 20, y: 20 }), nodeAt)).toBeUndefined()
    expect(buildingNodeKind(undefined, nodeAt)).toBeUndefined()
  })
})
