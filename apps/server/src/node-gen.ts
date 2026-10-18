import {
  NODE_DENSITY,
  NODE_MIN_SPACING,
  terrainAt,
  tileIndex,
  type ResourceKind,
  type ResourceNode,
  type Terrain,
  type TerrainMap,
} from '@csp/shared'
import { hash } from './terrain-gen.js'

const KINDS = Object.keys(NODE_DENSITY) as ResourceKind[]

/**
 * Places the resource nodes when a world is created (`CONTEXT.md`: Resource node): each tile
 * may hold one, with the chance its terrain gives that kind in the balance file, and no two
 * nodes closer than `NODE_MIN_SPACING`, measured across the map's joins too. The same terrain
 * and seed always give the same nodes.
 */
export function placeResourceNodes(terrain: TerrainMap, seed: number): ResourceNode[] {
  const { size } = terrain
  const blocked = new Uint8Array(size * size)
  const reach = NODE_MIN_SPACING - 1
  const nodes: ResourceNode[] = []
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (blocked[y * size + x]) continue
      const here = terrainAt(terrain, x, y)
      const kind = KINDS.find((k, i) => {
        const density = (NODE_DENSITY[k] as Partial<Record<Terrain, number>>)[here as Terrain]
        return density !== undefined && hash(x, y, seed + 7919 * (i + 1)) < density
      })
      if (!kind) continue
      nodes.push({ id: `n${nodes.length + 1}`, kind, x, y })
      for (let by = y - reach; by <= y + reach; by++) {
        for (let bx = x - reach; bx <= x + reach; bx++) blocked[tileIndex(size, bx, by)] = 1
      }
    }
  }
  return nodes
}
