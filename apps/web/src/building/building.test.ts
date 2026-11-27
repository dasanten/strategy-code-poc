import { describe, expect, it } from 'vitest'
import { BUILD_MATERIALS, BUILD_WORK } from '../world/narrowed.js'
import {
  STONE_BUILD_MATERIALS,
  STONE_BUILD_WORK,
  STONE_WALL_STRENGTH,
  WALL_STRENGTH,
} from '@csp/balance'
import { isStone, stoneOverAt } from './building.js'
import { materialsOfKind, workOfKind, wallStrength } from '@csp/lang-wasm'
import type { Building } from '@csp/shared-types'

const wall = (kind: 'wall' | 'gate', material?: 'stone'): Building => ({
  id: 'w',
  kind,
  cityId: null,
  x: 1,
  y: 1,
  ...(material ? { material } : {}),
})

describe('stone walls and gates (`CONTEXT.md`: Wood or stone)', () => {
  it('take Stone and more work; any other kind, or none given, is as before', () => {
    for (const kind of ['wall', 'gate'] as const) {
      expect(isStone(kind, 'stone')).toBe(true)
      expect(materialsOfKind(kind, 'stone')).toEqual(STONE_BUILD_MATERIALS[kind])
      expect(workOfKind(kind, 'stone')).toBe(STONE_BUILD_WORK[kind])
      expect(workOfKind(kind, 'stone')).toBeGreaterThan(workOfKind(kind))
      expect(materialsOfKind(kind)).toEqual(BUILD_MATERIALS[kind])
      expect(workOfKind(kind, 'wood')).toBe(BUILD_WORK[kind])
    }
    expect(isStone('house', 'stone')).toBe(false)
    expect(materialsOfKind('house', 'stone')).toEqual(BUILD_MATERIALS.house)
  })

  it('hold out longer and leave Stone when broken', () => {
    expect(wallStrength(wall('wall', 'stone'))).toBe(STONE_WALL_STRENGTH.wall)
    expect(wallStrength(wall('gate', 'stone'))).toBe(STONE_WALL_STRENGTH.gate)
    expect(wallStrength(wall('wall'))).toBe(WALL_STRENGTH.wall)
  })
})

describe('towers (`CONTEXT.md`: Tower)', () => {
  const tower = (material?: 'stone'): Building => ({
    id: 't',
    kind: 'tower',
    cityId: null,
    x: 4,
    y: 4,
    ...(material ? { material } : {}),
  })

  it('are of wood or stone, and hold out longer than a wall', () => {
    expect(isStone('tower', 'stone')).toBe(true)
    expect(materialsOfKind('tower', 'stone')).toEqual(STONE_BUILD_MATERIALS.tower)
    expect(materialsOfKind('tower')).toEqual(BUILD_MATERIALS.tower)
    expect(wallStrength(tower())).toBe(WALL_STRENGTH.tower)
    expect(wallStrength(tower('stone'))).toBe(STONE_WALL_STRENGTH.tower)
    expect(WALL_STRENGTH.tower).toBeGreaterThan(WALL_STRENGTH.gate)
  })
})

describe('a stone wall on a wooden one (`CONTEXT.md`: Wood or stone)', () => {
  const site = { delivered: {}, work: 0 }
  it('goes on a finished wooden one of its kind with no site on it yet', () => {
    const at = (buildings: Building[]) => stoneOverAt({ buildings }, 1, 1, 'wall')
    expect(at([wall('wall')])).toBe(true)
    expect(at([wall('wall', 'stone')])).toBe(false)
    expect(at([wall('gate')])).toBe(false)
    expect(at([{ ...wall('wall'), site }])).toBe(false)
    expect(at([wall('wall'), { ...wall('wall', 'stone'), id: 's', site }])).toBe(false)
    expect(stoneOverAt({ buildings: [wall('gate')] }, 1, 1, 'gate')).toBe(true)
    expect(stoneOverAt({ buildings: [wall('wall')] }, 1, 1, 'house')).toBe(false)
  })
})
