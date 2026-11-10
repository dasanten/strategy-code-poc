import { describe, expect, it } from 'vitest'
import { FOOTPRINT } from '../shared/footprint.js'
import { NODE_KINDS } from '../shared/chunks.js'
import {
  ACTIVITY_ART,
  ART_FILES,
  BUILDING_ART,
  NODE_ART,
  PAINTED_BUILDING_ART,
  PAINTED_BUILDING_IMAGE,
  PAINTED_FILES,
  PAINTED_SHEET,
  PAINTED_SITE_ART,
  artInUse,
  paintedBuildingArt,
  paintedCell,
  paintedCellsInUse,
  paintedImage,
} from './art.js'
import type { Activity } from './figures.js'
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

  it("has art for every resident's activity", () => {
    const activities: Activity[] = ['walking', 'riding', 'carrying', 'working', 'fighting']
    for (const a of activities) expect(isSvg(ACTIVITY_ART[a]), a).toBe(true)
  })

  it('draws painted art from cells of the sheet, one site per footprint size', () => {
    expect(PAINTED_FILES[PAINTED_SHEET.file]).toBeDefined()
    const cells = PAINTED_SHEET.columns ** 2
    for (const cell of paintedCellsInUse()) expect(cell >= 0 && cell < cells, `${cell}`).toBe(true)
    expect(PAINTED_SITE_ART).toHaveLength(Math.max(...Object.values(FOOTPRINT)))
  })

  it('gives the training ground its painted image, and its site the 3×3 site cell', () => {
    const file = PAINTED_BUILDING_IMAGE.trainingGround!
    expect(PAINTED_FILES[file]).toBeDefined()
    expect(paintedBuildingArt('trainingGround', false)).toBe(paintedImage(file))
    expect(FOOTPRINT.trainingGround).toBe(3)
    expect(paintedBuildingArt('trainingGround', true)).toBe(paintedCell(PAINTED_SITE_ART[2]))
    expect(artInUse()).not.toContain(paintedImage(file))
  })

  it('keeps the other workplaces on their cells of the sheet, and walls unpainted', () => {
    expect(paintedBuildingArt('stable', false)).toBe(paintedCell(PAINTED_BUILDING_ART.stable!))
    expect(paintedBuildingArt('stable', true)).toBe(paintedCell(PAINTED_SITE_ART[2]))
    expect(paintedBuildingArt('wall', false)).toBeUndefined()
  })

  it('points to every SVG in the assets folder, each with a viewBox', () => {
    expect(artInUse().sort()).toEqual(Object.keys(ART_FILES).sort())
    for (const svg of Object.values(ART_FILES)) expect(svg).toMatch(/viewBox="0 0 24 24"/)
  })
})
