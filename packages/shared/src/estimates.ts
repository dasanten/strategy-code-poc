import { MAX_HUNGER, driveSpeed, rideSpeed, walkSpeed } from './balance.js'
import { horseFor, type CarriagePlace, type CarriageHorse } from './carriages.js'
import { horseRidden } from './horses.js'
import { Terrain, stepLength } from './terrain.js'
import { TICKS_PER_GAME_HOUR } from './time.js'
import { TICKS_PER_GAME_DAY, TICK_MS, type Horse, type Resident } from './world.js'

/**
 * Ticks a way of `path` from `from` takes (`CONTEXT.md`: Doing, Estimates): each step its length
 * (`stepLength`) at the pace onto the tile it goes to, less the `progress` already made into the
 * first. `pace` is in tiles per tick, as the movement rules give it; a step at no pace counts as
 * one at `slowest`.
 */
export function wayTicks(
  size: number,
  from: { x: number; y: number },
  path: readonly (readonly [number, number])[],
  progress: number,
  pace: (x: number, y: number) => number,
  slowest: number,
): number {
  let ticks = 0
  let [x, y] = [from.x, from.y]
  for (const [i, [nx, ny]] of path.entries()) {
    const speed = pace(nx, ny) || slowest
    const length = stepLength(size, x, y, nx, ny) || 1
    ticks += (i === 0 ? Math.max(0, length - progress) : length) / speed
    ;[x, y] = [nx, ny]
  }
  return ticks
}

/** What a resident's arrival is worked out from: who and what moves, and the ground. */
export interface ArrivalWorld {
  size: number
  tick: number
  horses: readonly (CarriageHorse & Partial<Pick<Horse, 'hunger'>>)[]
  carriages: readonly (CarriagePlace & { id: string })[]
  residents?: readonly Pick<Resident, 'riding'>[]
  /** The ground of a tile as the movement rules see it (`groundAt`): a road over any terrain. */
  ground: (x: number, y: number) => Terrain
}

/**
 * About how many ticks until a walking, riding or driving resident arrives (`CONTEXT.md`: Doing,
 * Estimates): their way still to go, at the pace that applies on each tile today, from the same
 * rules the server moves them by (`walkSpeed`, `rideSpeed`, `driveSpeed`). Undefined while
 * they go nowhere or their way is still being found.
 */
export function arrivalTicks(world: ArrivalWorld, r: Resident): number | undefined {
  const o = r.order
  const moving =
    o?.kind === 'walkTo' || o?.kind === 'drive' || (o?.kind === 'haul' && o.phase === 'driving')
  if (!moving || !o.path) return undefined
  const slowest = walkSpeed(r, Terrain.Mountain, world.tick)
  let pace: (g: Terrain) => number
  if (o.kind === 'walkTo') {
    const horse = horseRidden(world, r)
    pace = horse
      ? (g) => rideSpeed(r, { stats: horse.stats, hunger: horse.hunger ?? MAX_HUNGER }, g)
      : (g) => walkSpeed(r, g, world.tick)
  } else {
    const carriage = world.carriages.find((k) => k.id === o.carriageId)
    const horse = carriage && horseFor(world, carriage)
    // Without a horse each step goes at once, a tile a tick.
    pace = horse ? (g) => driveSpeed(r, horse, g) : () => 1
  }
  return wayTicks(world.size, r, o.path, o.progress, (x, y) => pace(world.ground(x, y)), slowest)
}

/**
 * About how long `ticks` last, to plan around (`CONTEXT.md`: Doing, Estimates): real time first,
 * game time in brackets, each rounded to one coarse unit: "about 3 min (3 game hours)", "about
 * 20 min (a game day)". Under a real minute is just "under a minute".
 */
export function aboutTime(ticks: number): string {
  const seconds = (ticks * TICK_MS) / 1000
  if (seconds < 60) return 'under a minute'
  const minutes = Math.round(seconds / 60)
  const real = minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`
  return `about ${real} (${gameTimeAbout(ticks)})`
}

/** The most game hours `aboutTime` counts in hours; longer is half a game day, then days. */
const HOURS_UP_TO = 8

/** Game time in one coarse unit: "a game hour", "half a game day", "3 game days". */
function gameTimeAbout(ticks: number): string {
  const hours = Math.max(1, Math.round(ticks / TICKS_PER_GAME_HOUR))
  if (hours <= HOURS_UP_TO) return hours === 1 ? 'a game hour' : `${hours} game hours`
  if (hours < 18) return 'half a game day'
  const days = Math.max(1, Math.round(ticks / TICKS_PER_GAME_DAY))
  return days === 1 ? 'a game day' : `${days} game days`
}
