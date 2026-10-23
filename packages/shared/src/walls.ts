import { allied, alliedRealms } from './alliance.js'
import {
  BROKEN_MATERIALS_RETURNED,
  BUILD_MATERIALS,
  WALL_ENCLOSES_MAX,
  WALL_STRENGTH,
} from './balance.js'
import { npcCityRefuses } from './city.js'
import { TRADE_ORG } from './trade-org.js'
import { isPassableTerrain, tileIndex, wrap, wrapDelta, type TerrainMap } from './terrain.js'
import type { Building, Good, Resident, Stock, WorldState } from './world.js'

/** World queries about walls and gates (`CONTEXT.md`: Walls in combat; ADR 0002). */

/**
 * Whose side a resident is on at walls and gates: their realm, or for a resident of an NPC city,
 * that city, so its residents stand on its walls as a realm's do (`CONTEXT.md`: NPC city).
 * Null for a resident of nobody.
 */
export function wallSide(r: Pick<Resident, 'owner' | 'cityId'>): string | null {
  return r.owner ?? r.cityId
}

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
  return (b.kind === 'wall' || b.kind === 'gate') && !b.site
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
 * A key that changes whenever the finished walls and gates, their gates' state or their cities'
 * realms or those realms' alliances change, or whom an NPC city shuts its gates to (`shutOut`),
 * so a `WallMap` is rebuilt only then.
 */
export function wallsKey(
  world: Pick<WorldState, 'buildings' | 'cities' | 'alliances' | 'standings'>,
): string {
  const parts: string[] = []
  for (const b of world.buildings) {
    if (!isWallOrGate(b)) continue
    parts.push(`${b.id}@${b.x},${b.y}:${b.cityId ?? ''}${isClosed(b) ? '!' : ''}`)
  }
  for (const c of world.cities) parts.push(`${c.id}=${c.realmId ?? ''}`)
  for (const a of world.alliances) parts.push(`${a.id}+${a.members.map((m) => m.realmId).join()}`)
  for (const [cityId, sides] of shutOut(world)) parts.push(`${cityId}-${sides.join()}`)
  return parts.join(';')
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
    tiles.set(tileIndex(size, b.x, b.y), {
      kind: b.kind as 'wall' | 'gate',
      realmId,
      realms: side(realmId ?? b.cityId),
      closed: isClosed(b),
      shutTo: (b.kind === 'gate' && b.cityId && shut.get(b.cityId)) || [],
    })
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

/** Whether a realm may stand on the wall on tile index `t`: its own city's, or an ally's. */
function ownWall(walls: WallMap, realmId: string | null, t: number): boolean {
  const w = walls.tiles.get(t)
  return w?.kind === 'wall' && realmId !== null && w.realms.includes(realmId)
}

/** Whether tile index `t` is a wall or gate of the realm's own cities or its allies'. */
function ownWallOrGate(walls: WallMap, realmId: string | null, t: number): boolean {
  const w = walls.tiles.get(t)
  return !!w && realmId !== null && w.realms.includes(realmId)
}

/**
 * Whether someone of `realmId` on tile index `t` is stuck on a wall: a wall they may not stand
 * on (a foreign wall finished under them), or a stretch of their own wall with no gate and no way
 * down inside. Such a one may climb down anywhere next to it.
 */
export function strandedOnWall(walls: WallMap, realmId: string | null, t: number): boolean {
  if (walls.tiles.get(t)?.kind !== 'wall') return false
  if (!ownWall(walls, realmId, t)) return true
  const seen = new Set([t])
  const todo = [t]
  while (todo.length > 0) {
    const c = todo.pop()!
    if (walls.tiles.get(c)!.kind === 'gate') return false
    for (const n of neighbours(walls.size, c)) {
      if (walls.inside.has(n)) return false
      if (!seen.has(n) && ownWallOrGate(walls, realmId, n)) {
        seen.add(n)
        todo.push(n)
      }
    }
  }
  return true
}

/**
 * Whether someone of `realmId` may step from tile index `from` to the next tile `to`
 * (`CONTEXT.md`: Walls in combat), walls and gates aside from the land itself. Nobody walks
 * through a wall: only the city's own realm and its allies go onto its walls, from inside or from
 * the wall itself, and down only inside, and only `onWalls` (on foot, not driving). A gate lets
 * them through always, everyone else only while open, and an NPC city's gate never those it
 * refuses (`CONTEXT.md`: NPC city reaction; `WallTile.shutTo`). `stranded` (`strandedOnWall`) frees the
 * way down from a wall.
 */
export function mayStep(
  walls: WallMap,
  realmId: string | null,
  from: number,
  to: number,
  onWalls: boolean,
  stranded = false,
): boolean {
  const w = walls.tiles.get(to)
  if (w?.kind === 'gate' && !ownWallOrGate(walls, realmId, to)) {
    if (w.closed || (realmId !== null && w.shutTo.includes(realmId))) return false
  }
  if (w?.kind === 'wall') {
    if (!onWalls || !ownWall(walls, realmId, to)) return false
    return walls.inside.has(from) || ownWallOrGate(walls, realmId, from)
  }
  if (walls.tiles.get(from)?.kind === 'wall' && !stranded)
    return walls.inside.has(to) || ownWallOrGate(walls, realmId, to)
  return true
}

/**
 * Whether a resident stands on a wall of their own side (`wallSide`) or an ally's, where they defend far better
 * (`CONTEXT.md`: Walls in combat; `WALL_DEFENCE`).
 */
export function onOwnWall(
  world: Pick<WorldState, 'buildings' | 'cities' | 'alliances'>,
  r: Pick<Resident, 'x' | 'y' | 'owner' | 'cityId'>,
): boolean {
  const wall = world.buildings.find(
    (b) => b.x === r.x && b.y === r.y && b.kind === 'wall' && !b.site,
  )
  const city = wall && world.cities.find((c) => c.id === wall.cityId)
  const side = wallSide(r)
  if (!city || side === null) return false
  // An NPC city's walls are its own residents' and its allies' (`wallSide`).
  return allied(world, city.realmId ?? city.id, side)
}

/** Damage a finished wall or gate takes before it falls (`WALL_STRENGTH`). */
export function wallStrength(b: Building): number {
  return WALL_STRENGTH[b.kind === 'gate' ? 'gate' : 'wall']
}

/** Damage a wall or gate can still take before it falls. */
export function wallStrengthLeft(b: Building): number {
  return Math.max(0, wallStrength(b) - (b.damage ?? 0))
}

/**
 * Goods left on the tile of a wall or gate that was broken (`CONTEXT.md`: Walls in combat):
 * `BROKEN_MATERIALS_RETURNED` of its materials, in whole units.
 */
export function brokenReturns(b: Building): Stock {
  const out: Stock = {}
  for (const [good, units] of Object.entries(BUILD_MATERIALS[b.kind] ?? {}) as [Good, number][]) {
    const back = Math.floor(units * BROKEN_MATERIALS_RETURNED)
    if (back > 0) out[good] = back
  }
  return out
}

/**
 * The finished wall or gate `wallId` that a resident of `realmId` may break or climb: one of
 * another realm's city, or of none (`CONTEXT.md`: Walls in combat); or why not.
 */
export function foreignWall(
  world: Pick<WorldState, 'buildings' | 'cities' | 'alliances'>,
  realmId: string | null,
  wallId: unknown,
): Building | string {
  const b = world.buildings.find((x) => x.id === wallId)
  if (!b || (b.kind !== 'wall' && b.kind !== 'gate')) return 'no such wall or gate'
  if (b.site) return 'that wall is not finished yet'
  const city = world.cities.find((c) => c.id === b.cityId)
  if (city?.realmId != null && city.realmId === realmId) return 'that is one of your own walls'
  return b
}

/**
 * Where a climber at `from` comes down after climbing over the wall or gate at `wall`, on a map of
 * `size` tiles: the tile beyond it, straight across, when they may stand there (passable land
 * with no wall or gate); otherwise up on the wall itself, from where they may climb down anywhere
 * next to it (`strandedOnWall`).
 */
export function climbLanding(
  world: Pick<WorldState, 'buildings'>,
  terrain: TerrainMap,
  from: { x: number; y: number },
  wall: { x: number; y: number },
): { x: number; y: number } {
  const { size } = terrain
  const x = wrap(wall.x + wrapDelta(from.x, wall.x, size), size)
  const y = wrap(wall.y + wrapDelta(from.y, wall.y, size), size)
  const t = tileIndex(size, x, y)
  // Walls and gates are 1×1 (`CONTEXT.md`: Footprint): their tile is their footprint.
  const walled = world.buildings.some((b) => b.x === x && b.y === y && isWallOrGate(b))
  if (walled || !isPassableTerrain(terrain.tiles[t]!)) return { x: wall.x, y: wall.y }
  return { x, y }
}
