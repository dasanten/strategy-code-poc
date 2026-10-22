import { describe, expect, it } from 'vitest'
import { NODE_KINDS } from '@csp/shared'
import { ART_FILES, BUILDING_ART, NODE_ART, artInUse } from './art.js'
import { BUILDING_NAMES } from './palette.js'

const isSvg = (file: string | undefined) =>
  file !== undefined && ART_FILES[file]?.trimStart().startsWith('<svg') === true

describe('map art registry', () => {
  it('has art for every building kind', () => {
    for (const kind of Object.keys(BUILDING_NAMES) as (keyof typeof BUILDING_NAMES)[]) {
      expect(isSvg(BUILDING_ART[kind]), kind).toBe(true)
    }
  })

  it('has art for every resource kind', () => {
    for (const kind of NODE_KINDS) expect(isSvg(NODE_ART[kind]), kind).toBe(true)
  })

  it('points to every SVG in the assets folder, each with a viewBox', () => {
    expect(artInUse().sort()).toEqual(Object.keys(ART_FILES).sort())
    for (const svg of Object.values(ART_FILES)) expect(svg).toMatch(/viewBox="0 0 24 24"/)
  })
})
