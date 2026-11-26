// Ported from packages/shared/src/walls.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { alliedRealms } from './alliance.js'
import { npcCityRefuses } from './city.js'
import { footprintTiles } from './footprint.js'
import { isPassableTerrain, tileIndex, type TerrainMap, wrap } from './terrain.js'
import { TRADE_ORG } from './trade-org.js'
import { WALL_ENCLOSES_MAX } from '@csp/balance'
import type { Building, WorldState } from '@csp/shared-types'

export { brokenReturns, wallStrength, wallStrengthLeft } from '@csp/lang-wasm'

/** World queries about walls and gates (`CONTEXT.md`: Walls in combat; ADR 0002). */

/** A finished wall or gate on a tile, and whose it is. */
export interface WallTile {
  kind: 'wall' | 'gate'
  /** The realm of the wall's city; null for nobody's. */
  realmId: string | null
  /**
   * The sides (`wallSide`) that may stand on it and pass its gate while closed: its city's realm
   * and the other members of that realm's alliance (`CONTEXT.md`: Alliance), or for a city of no
   * realm (an NPC city), the city itself and the members of its alliance. Empty for nobody's.
   */
  realms: string[]
  /** A gate that is closed. */
  closed: boolean
  /**
   * The sides (`wallSide`) an NPC city keeps its gate shut to even while open, because it refuses
   * them (`CONTEXT.md`: NPC city reaction; `npcCityRefuses`). Empty for a wall.
   */
  shutTo: string[]
}

/**
 * The finished walls and gates on the map, by tile index, and the tiles they enclose. Built
 * once per set of walls (`wallsKey`), so movement can ask about every step cheaply.
 */
export interface WallMap {
  size: number
  tiles: Map<number, WallTile>
  /** Tiles shut in by walls and gates (and impassable land): a wall ring's inside. */
  inside: Set<number>
}

/** Whether a building is a finished wall or gate. */
export function isWallOrGate(b: Building): boolean {
  return (b.kind === 'wall' || b.kind === 'gate' || b.kind === 'tower') && !b.site
}

/** Whether a gate is closed; a gate is open until its city's realm closes it. */
export function isClosed(b: Building): boolean {
  return b.kind === 'gate' && b.closed === true
}

/**
 * The sides (`wallSide`) each NPC city refuses (`npcCityRefuses`), by city id: a realm or NPC
 * city by its id, the Trade Organization by each of its cities. Its gates are shut to them.
 */
export function shutOut(world: Pick<WorldState, 'cities' | 'standings'>): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const s of world.standings) {
    const city = world.cities.find((c) => c.id === s.of)
    if (!city || !npcCityRefuses(world, city, s.toward)) continue
    const sides =
      s.toward === TRADE_ORG
        ? world.cities.filter((c) => c.tradeOrg !== undefined).map((c) => c.id)
        : [s.toward]
    out.set(city.id, [...(out.get(city.id) ?? []), ...sides].sort())
  }
  return out
}

/**
 * Builds the `WallMap` for the world on `terrain`. A tile is inside when it can't reach far out
 * (`WALL_ENCLOSES_MAX` tiles) on foot without crossing a wall or gate.
 */
export function wallMap(
  world: Pick<WorldState, 'buildings' | 'cities' | 'alliances' | 'standings'>,
  terrain: TerrainMap,
): WallMap {
  const { size } = terrain
  const shut = shutOut(world)
  const realms = new Map(world.cities.map((c) => [c.id, c.realmId]))
  const sides = new Map<string, string[]>()
  const side = (realmId: string | null): string[] => {
    if (realmId === null) return []
    if (!sides.has(realmId)) sides.set(realmId, alliedRealms(world, realmId))
    return sides.get(realmId)!
  }
  const tiles = new Map<number, WallTile>()
  for (const b of world.buildings) {
    if (!isWallOrGate(b)) continue
    const realmId = (b.cityId && realms.get(b.cityId)) ?? null
    // A tower is wall on every tile of its footprint (`CONTEXT.md`: Tower).
    for (const [x, y] of footprintTiles(b, size)) {
      tiles.set(tileIndex(size, x, y), {
        kind: b.kind === 'gate' ? 'gate' : 'wall',
        realmId,
        realms: side(realmId ?? b.cityId),
        closed: isClosed(b),
        shutTo: (b.kind === 'gate' && b.cityId && shut.get(b.cityId)) || [],
      })
    }
  }
  const inside = new Set<number>()
  const outside = new Set<number>()
  const open = (t: number) =>
    !tiles.has(t) && isPassableTerrain(terrain.tiles[t]!) && !inside.has(t) && !outside.has(t)
  for (const w of tiles.keys()) {
    for (const start of neighbours(size, w)) {
      if (!open(start)) continue
      // Fill from beside the wall; a fill that grows too large, or runs into the outside, is out.
      const seen = new Set([start])
      const todo = [start]
      let out = false
      while (todo.length > 0 && !out) {
        const t = todo.pop()!
        for (const n of neighbours(size, t)) {
          if (seen.has(n) || tiles.has(n) || !isPassableTerrain(terrain.tiles[n]!)) continue
          if (outside.has(n) || seen.size >= WALL_ENCLOSES_MAX) {
            out = true
            break
          }
          seen.add(n)
          todo.push(n)
        }
      }
      for (const t of seen) (out ? outside : inside).add(t)
    }
  }
  return { size, tiles, inside }
}

/** The four tiles next to tile index `t`, across the map's joins too. */
function neighbours(size: number, t: number): number[] {
  const x = t % size
  const y = (t - x) / size
  return [
    y * size + wrap(x + 1, size),
    y * size + wrap(x - 1, size),
    wrap(y + 1, size) * size + x,
    wrap(y - 1, size) * size + x,
  ]
}
