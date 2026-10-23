import {
  NODE_WORKPLACE,
  OFF_NODES,
  ON_PLAINS,
  Terrain,
  buildProblem,
  cornersCovering,
  footprintKeys,
  footprintTiles,
  isPassableTerrain,
  terrainAt,
  type BuildingKind,
  type ResourceNode,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'

/**
 * The ground as the game lays out buildings on it (`CONTEXT.md`: Where buildings go, Footprint):
 * which tiles footprints and resource nodes already cover, so the world generator and NPC cities
 * can try many spots quickly. `buildProblem` stays the rule; this is the same check, kept fast.
 */
export class Ground {
  private readonly taken = new Set<string>()
  private readonly nodes = new Map<string, ResourceNode>()

  constructor(
    world: Pick<WorldState, 'buildings' | 'nodes'>,
    readonly terrain: TerrainMap,
    /** More tiles to keep free, as "x,y" keys: where residents, horses or piles stand. */
    more: Iterable<string> = [],
  ) {
    for (const b of world.buildings) {
      if (b.kind !== 'road') for (const k of footprintKeys(b, terrain.size)) this.taken.add(k)
    }
    for (const n of world.nodes) this.nodes.set(`${n.x},${n.y}`, n)
    for (const k of more) this.taken.add(k)
  }

  /** Whether no footprint covers the tile. */
  free(x: number, y: number): boolean {
    return !this.taken.has(`${x},${y}`)
  }

  /** The resource node on the tile, if there is one. */
  nodeAt(x: number, y: number): ResourceNode | undefined {
    return this.nodes.get(`${x},${y}`)
  }

  /**
   * Whether a building of `kind` fits with the north-west tile of its footprint on (x, y), by the
   * rules `buildProblem` checks (the house's city area aside), and every tile passes `also`.
   */
  fits(
    kind: BuildingKind,
    x: number,
    y: number,
    also?: (x: number, y: number) => boolean,
  ): boolean {
    const tiles = footprintTiles({ kind, x, y }, this.terrain.size)
    let nodes = 0
    for (const [tx, ty] of tiles) {
      if (this.taken.has(`${tx},${ty}`)) return false
      const t = terrainAt(this.terrain, tx, ty)
      if (!isPassableTerrain(t)) return false
      if (ON_PLAINS.includes(kind) && t !== Terrain.Plains) return false
      if (OFF_NODES.includes(kind) && t === Terrain.Mountain) return false
      const node = this.nodes.get(`${tx},${ty}`)
      if (node) {
        if (NODE_WORKPLACE[node.kind] !== kind) return false
        nodes++
      }
      if (also && !also(tx, ty)) return false
    }
    // Only a node's workplace covers a node, and one of them.
    return !onNode(kind) || nodes === 1
  }

  /** Marks a footprint as covered. */
  take(kind: BuildingKind, x: number, y: number): void {
    for (const k of footprintKeys({ kind, x, y }, this.terrain.size)) this.taken.add(k)
  }
}

/**
 * Where a node's workplace can be laid out (`CONTEXT.md`: Where buildings go): the north-west
 * tile of a footprint that covers the node and fits, the node's own tile first; none when no
 * footprint over it fits.
 */
export function nodeCorner(
  world: WorldState,
  terrain: TerrainMap,
  node: ResourceNode,
): { x: number; y: number } | undefined {
  const kind = NODE_WORKPLACE[node.kind]
  for (const [x, y] of cornersCovering(kind, node.x, node.y, terrain.size)) {
    if (!buildProblem(world, x, y, kind, terrain)) return { x, y }
  }
  return undefined
}

/** Whether a kind of building goes on a resource node: mines, quarries and lumber camps. */
const onNode = (kind: BuildingKind) => Object.values(NODE_WORKPLACE).includes(kind)
