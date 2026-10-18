import {
  terrainAt,
  type Account,
  type MapInfo,
  type TerrainMap,
  type Unit,
  type WorldState,
} from '@csp/shared'

/** The size of the terrain window the client gets on connect, in tiles. */
const WINDOW_WIDTH = 40
const WINDOW_HEIGHT = 30

/**
 * A window of terrain centred on the given units, for the client to draw. A stopgap until
 * explored terrain is served in chunks (T1.4); it does not check sight yet.
 */
export function mapWindow(terrain: TerrainMap, seed: number, units: Unit[]): MapInfo {
  const centre = Math.floor(terrain.diameter / 2)
  const cx = units.length ? Math.round(units.reduce((s, u) => s + u.x, 0) / units.length) : centre
  const cy = units.length ? Math.round(units.reduce((s, u) => s + u.y, 0) / units.length) : centre
  const x = cx - Math.floor(WINDOW_WIDTH / 2)
  const y = cy - Math.floor(WINDOW_HEIGHT / 2)
  const window: number[] = []
  for (let ty = y; ty < y + WINDOW_HEIGHT; ty++) {
    for (let tx = x; tx < x + WINDOW_WIDTH; tx++) window.push(terrainAt(terrain, tx, ty))
  }
  return {
    seed,
    diameter: terrain.diameter,
    x,
    y,
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    terrain: window,
  }
}

/**
 * What a Player currently sees (CONTEXT.md, Sight). Placeholder: everything, until residents
 * with a sight range exist (slice 2). The sync below already sends only what this returns.
 */
export function entitiesInSight(world: WorldState, _account: Account): Unit[] {
  return world.units
}

/**
 * What one connection has been sent so far, so each tick only sends the difference
 * (ADR 0006): entities in sight that changed, and ids that left sight.
 */
export class ClientView {
  private sent = new Map<string, string>()

  /** Everything in sight, for the welcome message; remembers it as sent. */
  initial(entities: Unit[]): Unit[] {
    this.sent.clear()
    for (const e of entities) this.sent.set(e.id, JSON.stringify(e))
    return entities
  }

  diff(entities: Unit[]): { changed: Unit[]; gone: string[] } {
    const changed: Unit[] = []
    const seen = new Set<string>()
    for (const e of entities) {
      seen.add(e.id)
      const json = JSON.stringify(e)
      if (this.sent.get(e.id) !== json) {
        changed.push(e)
        this.sent.set(e.id, json)
      }
    }
    const gone = [...this.sent.keys()].filter((id) => !seen.has(id))
    for (const id of gone) this.sent.delete(id)
    return { changed, gone }
  }
}
