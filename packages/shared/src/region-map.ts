import { allianceOf, realmName } from './alliance.js'
import { CHUNK_SIZE, chunksAcross } from './terrain.js'
import { TRADE_ORGANIZATION, type Territory } from './territory.js'
import { TRADE_ORG_NAME } from './trade-org.js'
import type { WorldState } from './world.js'

/** What the Region map shows (`CONTEXT.md`: Region map), as the server sends it to a Player. */

/** An Organization holding territory on the Region map, and the alliance it shows as part of. */
export interface RegionHolder {
  /** The Organization's id: a realm's, or a city's for a city that belongs to no realm. */
  id: string
  /** A realm by its Leader's name, a city by its own. */
  name: string
  /** The alliance a realm is a member of: it shows in the alliance's colour. */
  alliance: { id: string; name: string } | null
  /** The tiles it holds in what this update covers, as `y * size + x`. */
  tiles: number[]
}

/**
 * The Region map, or a part of it, as a Player gets it: territory over their explored terrain
 * only. `chunks` null replaces the whole map; otherwise it replaces just those chunks (see
 * `chunksAcross`), sent when the Player's explored terrain in them grew.
 */
export interface RegionMap {
  /** The tick the territory was worked out at. */
  tick: number
  chunks: number[] | null
  holders: RegionHolder[]
}

/**
 * How an Organization is called on the Region map: a realm by its Leader, a city by its name, the
 * Trade Organization by its own.
 */
export function organizationName(
  world: Pick<WorldState, 'realms' | 'residents' | 'cities'>,
  orgId: string,
): string {
  if (orgId === TRADE_ORGANIZATION) return TRADE_ORG_NAME
  if (world.realms.some((r) => r.id === orgId)) return realmName(world, orgId)
  return world.cities.find((c) => c.id === orgId)?.name ?? 'a lost city'
}

/**
 * The Region map a Player sees (`CONTEXT.md`: Region map): the territory on the tiles they have
 * explored (`isExplored`), by holder, with each realm's alliance. Territory is common knowledge,
 * so this is all of it there. With `chunks`, only the tiles in those chunks; `size` is the map's.
 */
export function regionMapFor(
  world: Pick<WorldState, 'realms' | 'residents' | 'cities' | 'alliances'>,
  territory: Territory,
  size: number,
  isExplored: (x: number, y: number) => boolean,
  chunks: number[] | null = null,
): RegionMap {
  const tiles = new Map<string, number[]>()
  const add = (owner: string, x: number, y: number) => {
    if (!isExplored(x, y)) return
    const list = tiles.get(owner) ?? []
    list.push(y * size + x)
    tiles.set(owner, list)
  }
  if (chunks === null) {
    for (const [key, owner] of territory.owners) {
      const [x, y] = key.split(',').map(Number) as [number, number]
      add(owner, x, y)
    }
  } else {
    const across = chunksAcross(size)
    for (const c of chunks) {
      const [x0, y0] = [(c % across) * CHUNK_SIZE, Math.floor(c / across) * CHUNK_SIZE]
      for (let y = y0; y < Math.min(size, y0 + CHUNK_SIZE); y++) {
        for (let x = x0; x < Math.min(size, x0 + CHUNK_SIZE); x++) {
          const owner = territory.owners.get(`${x},${y}`)
          if (owner !== undefined) add(owner, x, y)
        }
      }
    }
  }
  const holders = [...tiles].map(([id, held]): RegionHolder => {
    const alliance = allianceOf(world, id)
    return {
      id,
      name: organizationName(world, id),
      alliance: alliance ? { id: alliance.id, name: alliance.name } : null,
      tiles: held.sort((a, b) => a - b),
    }
  })
  holders.sort((a, b) => a.id.localeCompare(b.id))
  return { tick: territory.tick, chunks, holders }
}
