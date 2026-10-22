import { describe, expect, it } from 'vitest'
import { atlasLayout } from './atlas.js'
import {
  cityRelationship,
  relationshipColor,
  RELATIONSHIP_COLORS,
  UNOWNED_COLOR,
} from './tokens.js'

const viewer = { realmId: 'r1', allies: new Set(['r2']) }

describe('cityRelationship', () => {
  it('tells own, alliance, other realm, NPC city and Trade Organization apart', () => {
    expect(cityRelationship({ realmId: 'r1' }, viewer)).toBe('own')
    expect(cityRelationship({ realmId: 'r2' }, viewer)).toBe('alliance')
    expect(cityRelationship({ realmId: 'r3' }, viewer)).toBe('other')
    expect(cityRelationship({ realmId: null }, viewer)).toBe('npc')
    expect(cityRelationship({ realmId: null, tradeOrg: 'post' }, viewer)).toBe('trade')
  })

  it('has none for no city, drawn in the unowned colour', () => {
    expect(cityRelationship(undefined, viewer)).toBeUndefined()
    expect(relationshipColor(undefined)).toBe(UNOWNED_COLOR)
    expect(relationshipColor('own')).toBe(RELATIONSHIP_COLORS.own)
  })
})

describe('atlasLayout', () => {
  it('fits every cell, apart, in a power-of-two square', () => {
    const { size, frame } = atlasLayout(22, 96)
    expect(Math.log2(size) % 1).toBe(0)
    const frames = Array.from({ length: 22 }, (_, i) => frame(i))
    for (const f of frames) {
      expect(f.x + f.width).toBeLessThanOrEqual(size)
      expect(f.y + f.height).toBeLessThanOrEqual(size)
    }
    for (const [i, a] of frames.entries())
      for (const b of frames.slice(i + 1))
        expect(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y).toBe(true)
  })
})
