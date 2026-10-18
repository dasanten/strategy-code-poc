import {
  NODE_DENSITY,
  NODE_MIN_SPACING,
  NODE_TERRAINS,
  Terrain,
  terrainAt,
  wrap,
  type ResourceKind,
  type ResourceNode,
  type TerrainMap,
} from '@csp/shared'
import { beforeAll, describe, expect, it } from 'vitest'
import { placeResourceNodes } from './node-gen.js'
import { generateTerrain } from './terrain-gen.js'
import { smallTerrain } from './test-terrain.js'

describe('placeResourceNodes', () => {
  it('places the same nodes for the same terrain and seed, other ones for another seed', () => {
    const terrain = smallTerrain()
    const nodes = placeResourceNodes(terrain, 1)
    expect(placeResourceNodes(terrain, 1)).toEqual(nodes)
    expect(placeResourceNodes(terrain, 2)).not.toEqual(nodes)
  })

  describe('on a full-size map', () => {
    let terrain: TerrainMap
    let nodes: ResourceNode[]

    beforeAll(() => {
      terrain = generateTerrain(1)
      nodes = placeResourceNodes(terrain, 1)
    }, 120_000)

    it('puts every node on terrain that fits its kind', () => {
      const wrong = nodes.filter(
        (n) => !(NODE_TERRAINS[n.kind] as number[]).includes(terrainAt(terrain, n.x, n.y)),
      )
      expect(wrong).toEqual([])
    })

    it('keeps nodes apart, across the joins too, one per tile, with unique ids', () => {
      expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length)
      const byTile = new Map(nodes.map((n) => [`${n.x},${n.y}`, n]))
      expect(byTile.size).toBe(nodes.length)
      const tooClose = nodes.filter((n) => {
        for (let dy = -(NODE_MIN_SPACING - 1); dy < NODE_MIN_SPACING; dy++) {
          for (let dx = -(NODE_MIN_SPACING - 1); dx < NODE_MIN_SPACING; dx++) {
            const [ox, oy] = [wrap(n.x + dx, terrain.size), wrap(n.y + dy, terrain.size)]
            const other = byTile.get(`${ox},${oy}`)
            if (other && other !== n) return true
          }
        }
        return false
      })
      expect(tooClose).toEqual([])
    })

    it('places roughly the densities from the balance file, gold rarest', () => {
      const tilesOf = new Map<number, number>()
      for (const t of terrain.tiles) tilesOf.set(t, (tilesOf.get(t) ?? 0) + 1)
      const count = (kind: ResourceKind) => nodes.filter((n) => n.kind === kind).length
      for (const kind of Object.keys(NODE_DENSITY) as ResourceKind[]) {
        const densities = NODE_DENSITY[kind] as Partial<Record<Terrain, number>>
        const expected = Object.entries(densities).reduce(
          (sum, [t, d]) => sum + d * (tilesOf.get(Number(t)) ?? 0),
          0,
        )
        // Spacing removes a few candidates; rare kinds also vary by chance (3 standard deviations).
        const noise = 3 * Math.sqrt(expected)
        expect(count(kind)).toBeGreaterThan(expected * 0.75 - noise)
        expect(count(kind)).toBeLessThan(expected + noise)
      }
      expect(count('goldOre')).toBeLessThan(count('ironOre'))
      expect(count('goldOre')).toBeGreaterThan(10)
      const ironIn = (t: Terrain) =>
        nodes.filter((n) => n.kind === 'ironOre' && terrainAt(terrain, n.x, n.y) === t).length
      expect(ironIn(Terrain.Mountain) / (tilesOf.get(Terrain.Mountain) ?? 1)).toBeGreaterThan(
        ironIn(Terrain.Hills) / (tilesOf.get(Terrain.Hills) ?? 1),
      )
    })
  })
})
