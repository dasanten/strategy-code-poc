import {
  SHARES_A_TILE,
  footprintTiles,
  roadTiles,
  tileIndex,
  type Building,
  type Carriage,
  type Horse,
  type Resident,
  type WorldState,
} from '@csp/shared'

/*
 * Lookups the server builds once a tick instead of scanning the world's arrays inside per-resident
 * and per-action loops (Epic 49). Scratch memory like the pathfinder's: never saved, never world
 * state (ADR 0006). Each lookup gives the same answer as the scan it replaces.
 */

/**
 * The world's entities by id and by tile, who commands each resident and the finished roads, as
 * of when it was built. Parts are built the first time they are asked for.
 */
export class WorldIndex {
  private residents?: Map<string, Resident>
  private buildings?: Map<string, Building>
  private carriages?: Map<string, Carriage>
  private horses?: Map<string, Horse>
  private commanders?: Map<string, string>
  private tiles = new Map<number, Map<number, Building>>()
  private roadSets = new Map<number, Set<number>>()

  constructor(private readonly world: WorldState) {}

  residentById(id: string): Resident | undefined {
    return (this.residents ??= byId(this.world.residents)).get(id)
  }

  buildingById(id: string): Building | undefined {
    return (this.buildings ??= byId(this.world.buildings)).get(id)
  }

  carriageById(id: string): Carriage | undefined {
    return (this.carriages ??= byId(this.world.carriages)).get(id)
  }

  horseById(id: string): Horse | undefined {
    return (this.horses ??= byId(this.world.horses)).get(id)
  }

  /**
   * The building standing on (x, y), as `buildingAt` finds it: the first in the world's order
   * whose footprint covers the tile, roads and carriage sites aside (`SHARES_A_TILE`).
   */
  buildingAt(x: number, y: number, size: number): Building | undefined {
    let tiles = this.tiles.get(size)
    if (!tiles) {
      tiles = new Map()
      for (const b of this.world.buildings) {
        if (SHARES_A_TILE.includes(b.kind)) continue
        for (const [tx, ty] of footprintTiles(b, size)) {
          const t = tileIndex(size, tx, ty)
          if (!tiles.has(t)) tiles.set(t, b)
        }
      }
      this.tiles.set(size, tiles)
    }
    return tiles.get(tileIndex(size, x, y))
  }

  /**
   * The realm whose orders the resident takes, as `commanderOf` answers it: the alliance leader's
   * while handed over to its army, the hirer's while a started contract rents them out, their own
   * realm's otherwise. The armies and contracts are gone through once; the owner is read live.
   */
  commanderOf(r: Pick<Resident, 'id' | 'owner'>): string | null {
    if (!this.commanders) {
      const commanders = new Map<string, string>()
      // An alliance army before a contract, and the first of each, as `commanderOf` finds them.
      const first = (id: string, realmId: string) => {
        if (!commanders.has(id)) commanders.set(id, realmId)
      }
      for (const a of this.world.alliances) for (const p of a.army) first(p.id, a.leaderId)
      for (const c of this.world.contracts) {
        if (c.startedAt !== null) for (const id of c.residentIds) first(id, c.hirerId)
      }
      this.commanders = commanders
    }
    return this.commanders.get(r.id) ?? r.owner
  }

  /**
   * The tiles with a finished road, as `roadTiles` gives them. Road sites finish only as the
   * world resolves building, after everyone has walked, and the tick turns right after: within
   * one tick the roads asked for before then stay true.
   */
  roads(size: number): Set<number> {
    let roads = this.roadSets.get(size)
    if (!roads) this.roadSets.set(size, (roads = roadTiles(this.world, size)))
    return roads
  }
}

function byId<T extends { id: string }>(items: T[]): Map<string, T> {
  // The first with an id wins, as `find` would.
  const out = new Map<string, T>()
  for (const x of items) if (!out.has(x.id)) out.set(x.id, x)
  return out
}

/**
 * What the index was built from: the tick, and each collection it reads with its length. A step
 * that adds to a collection changes its length, one that filters it makes a new array; an
 * alliance's army and a contract's residents and start likewise.
 */
function revisionOf(world: WorldState): unknown[] {
  const out: unknown[] = [
    world.tick,
    world.residents,
    world.residents.length,
    world.buildings,
    world.buildings.length,
    world.carriages,
    world.carriages.length,
    world.horses,
    world.horses.length,
    world.alliances,
    world.alliances.length,
    world.contracts,
    world.contracts.length,
  ]
  for (const a of world.alliances) out.push(a.leaderId, a.army, a.army.length)
  for (const c of world.contracts)
    out.push(c.startedAt, c.hirerId, c.residentIds, c.residentIds.length)
  return out
}

const memo = new WeakMap<WorldState, { revision: unknown[]; index: WorldIndex }>()

/**
 * The world's index, built again only when the tick or one of the collections it reads has
 * changed since it was last asked for (`revisionOf`), so nobody has to remember to throw it away.
 */
export function worldIndex(world: WorldState): WorldIndex {
  const revision = revisionOf(world)
  const known = memo.get(world)
  if (known && sameRevision(known.revision, revision)) return known.index
  const index = new WorldIndex(world)
  memo.set(world, { revision, index })
  return index
}

function sameRevision(a: unknown[], b: unknown[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}
