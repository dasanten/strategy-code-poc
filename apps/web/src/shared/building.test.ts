import { describe, expect, it } from 'vitest'
import { BUILD_MATERIALS, BUILD_WORK, STONE_BUILD_MATERIALS, STONE_BUILD_WORK } from './narrowed.js'
import { STONE_WALL_STRENGTH, WALL_STRENGTH } from './narrowed.js'
import { isStone, materialsOfKind, workOfKind } from './building.js'
import { brokenReturns, wallStrength } from './walls.js'
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
    expect(Object.keys(brokenReturns(wall('wall', 'stone')))).toEqual(['stone'])
  })
})
