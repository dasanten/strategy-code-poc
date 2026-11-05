import {
  CARRIAGE_SPEED,
  TRADER_DRIVE_TRIES,
  TRADER_STOP_REACH,
  TRADER_STOP_TICKS,
  WALL_ENCLOSES_MAX,
  footprintKeys,
  isPassableTerrain,
  middleOf,
  terrainAt,
  tileIndex,
  townHallOf,
  traderStanding,
  wallMap,
  wrap,
  wrapDelta,
  wrapDistance,
  type Carriage,
  type City,
  type Resident,
  type TerrainMap,
  type Trader,
  type WorldState,
} from '@csp/shared'
import type { Invariant, InvariantViolation } from './invariants.js'

/*
 * Trader stops (`CONTEXT.md`: Trader stop): on its way between two of its places a wandering trader
 * stops for a while at each NPC or Player city near that way. Plain data (ADR 0002): the cities go
 * into `Trader.calls`, the stop it is at into `Trader.stand`, and the game gives its driver the same
 * drive orders as for the rest of its loop.
 */

/** A way shorter than this, in tiles, is no way at all: the trader is at the place already. */
const SAME_PLACE = 16

/** How far from a town hall it looks for a tile to stand on: past the most a wall can shut in. */
const STOP_SEARCH = Math.ceil(Math.sqrt(WALL_ENCLOSES_MAX) / 2) + 1

/** Whether a wandering trader stops at a city: one of an NPC or a Player with a finished town hall. */
function takesStops(world: WorldState, city: City | undefined): city is City {
  if (!city || city.tradeOrg) return false
  const hall = townHallOf(world, city)
  return hall !== undefined && !hall.site
}

/**
 * The cities a trader driving straight from `from` to `to` passes within `TRADER_STOP_REACH` of its
 * town hall, in the order it passes them (`CONTEXT.md`: Trader stop). None on a way of no length.
 * `size` is the map's.
 */
export function callsOnTheWay(
  world: WorldState,
  from: { x: number; y: number },
  to: { x: number; y: number },
  size: number,
): string[] {
  if (wrapDistance(size, from, to) < SAME_PLACE) return []
  const dx = wrapDelta(from.x, to.x, size)
  const dy = wrapDelta(from.y, to.y, size)
  const length2 = dx * dx + dy * dy
  const passed: { id: string; along: number }[] = []
  for (const city of world.cities) {
    if (!takesStops(world, city)) continue
    const hall = middleOf(townHallOf(world, city)!, size)
    const px = wrapDelta(from.x, hall.x, size)
    const py = wrapDelta(from.y, hall.y, size)
    const along = Math.max(0, Math.min(1, (px * dx + py * dy) / length2))
    if (Math.hypot(px - along * dx, py - along * dy) > TRADER_STOP_REACH) continue
    passed.push({ id: city.id, along })
  }
  return passed.sort((a, b) => a.along - b.along).map((c) => c.id)
}

/**
 * Where a wandering trader stands at a city (`CONTEXT.md`: Trader stop): the free tile nearest its
 * town hall that lies outside every ring of walls, so a gate closed against its armed escort doesn't
 * stop it, and on land a carriage can drive; of those, the nearest to where it comes `from`. Free:
 * no building but a road on it, and no other trader standing or bound there. Undefined when there is
 * none within reach.
 */
export function stopTile(
  world: WorldState,
  terrain: TerrainMap,
  city: City,
  from: { x: number; y: number },
): { x: number; y: number } | undefined {
  const hall = townHallOf(world, city)
  if (!hall) return undefined
  const { size } = terrain
  const { inside } = wallMap(world, terrain)
  const taken = new Set<string>()
  for (const b of world.buildings)
    if (b.kind !== 'road') footprintKeys(b, size).forEach((k) => taken.add(k))
  for (const t of world.traders) if (t.stand) taken.add(`${t.stand.x},${t.stand.y}`)
  const free = (x: number, y: number) => {
    const ground = terrainAt(terrain, x, y)
    return (
      isPassableTerrain(ground) &&
      (CARRIAGE_SPEED as Record<number, number | undefined>)[ground] !== undefined &&
      !inside.has(tileIndex(size, x, y)) &&
      !taken.has(`${x},${y}`)
    )
  }
  // A town hall's footprint is 3 tiles along each side; rings of tiles round it, nearest first.
  for (let d = 1; d <= STOP_SEARCH; d++) {
    let best: { x: number; y: number; away: number } | undefined
    for (let dy = -d; dy <= 2 + d; dy++) {
      for (let dx = -d; dx <= 2 + d; dx++) {
        if (dy !== -d && dy !== 2 + d && dx !== -d && dx !== 2 + d) continue
        const x = wrap(hall.x + dx, size)
        const y = wrap(hall.y + dy, size)
        if (!free(x, y)) continue
        const away = wrapDistance(size, { x, y }, from)
        if (!best || away < best.away) best = { x, y, away }
      }
    }
    if (best) return { x: best.x, y: best.y }
  }
  return undefined
}

/**
 * A wandering trader's stops, for one tick of its driver idle with the carriage (`CONTEXT.md`: Trader
 * stop): it stands out its time at the stop it is at, then takes the next of its calls, drives to
 * the tile there (`stopTile`) and stands for `TRADER_STOP_TICKS`. A city that stopped taking stops is
 * passed by, and so is one whose tile it fails to reach in `TRADER_DRIVE_TRIES` drives. Whether the
 * driver has what to do here; with no stop left it goes on along its loop.
 */
export function runStops(
  world: WorldState,
  trader: Trader,
  driver: Resident,
  carriage: Carriage,
  terrain: TerrainMap,
): boolean {
  for (;;) {
    if (trader.stand === null) {
      const next = trader.calls?.shift()
      if (next === undefined) return false
      const city = world.cities.find((c) => c.id === next)
      const tile = takesStops(world, city) ? stopTile(world, terrain, city, carriage) : undefined
      if (!tile) continue
      trader.stand = { cityId: next, x: tile.x, y: tile.y, until: null }
      trader.misses = 0
    }
    const stand = trader.stand
    const passedBy = () => {
      trader.stand = null
      trader.misses = 0
    }
    if (
      !takesStops(
        world,
        world.cities.find((c) => c.id === stand.cityId),
      )
    ) {
      passedBy()
      continue
    }
    if (stand.until !== null) {
      if (world.tick < stand.until) return true
      passedBy()
      continue
    }
    if (carriage.x === stand.x && carriage.y === stand.y) {
      stand.until = world.tick + TRADER_STOP_TICKS
      trader.misses = 0
      return true
    }
    if (trader.misses >= TRADER_DRIVE_TRIES) {
      passedBy()
      continue
    }
    trader.misses++
    const target = { x: stand.x, y: stand.y }
    driver.order = { kind: 'drive', carriageId: carriage.id, target, path: null, progress: 0 }
    return true
  }
}

/**
 * Trader stops hold together (`CONTEXT.md`: Trader stop; ADR 0004): no trader means to stop at a city
 * twice, or to stand longer than `TRADER_STOP_TICKS`; one whose time at a stop has begun has its
 * carriage on the stop's tile until the time is up; and no two stand on the same tile, where a trade
 * could only reach one of them.
 */
export const traderStopsSound: Invariant = {
  name: 'trader-stops-sound',
  check(world) {
    const out: InvariantViolation[] = []
    const fail = (t: Trader, message: string) =>
      out.push({
        invariant: this.name,
        message: `trader ${t.id} ${message}`,
        entityIds: [t.id],
      })
    const tiles = new Set<string>()
    for (const t of world.traders) {
      if (new Set(t.calls ?? []).size !== (t.calls ?? []).length) fail(t, 'calls at a city twice')
      const until = t.stand?.until
      if (until === null || until === undefined) continue
      if (until > world.tick + TRADER_STOP_TICKS) fail(t, `stands until ${until}, too long`)
      if (world.tick < until && t.driverId !== null && !traderStanding(world, t)) {
        fail(t, `has left its stop at (${t.stand!.x}, ${t.stand!.y}) with time to stand`)
      }
      if (world.tick >= until) continue
      const tile = `${t.stand!.x},${t.stand!.y}`
      if (tiles.has(tile)) fail(t, `stands on (${tile}) with another trader`)
      tiles.add(tile)
    }
    return out
  },
}
