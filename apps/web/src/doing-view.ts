import { Terrain, UNEXPLORED, tileIndex } from './shared/terrain.js'
import { arrivalTicks, timeLeft, type ArrivalWorld } from './shared/estimates.js'
import { drivenCarriageId } from './shared/carriages.js'
import { isDown } from './shared/world.js'
import { roadTiles } from './shared/building.js'
import type {
  Building,
  City,
  GoodsPlace,
  GoodsWanted,
  Horse,
  Resident,
  ResidentOrder,
  ScriptSummary,
  SeenScript,
  Task,
} from '@csp/shared-types'
import { BUILDING_NAMES } from './city-view.js'
import { selectedWay } from './map/way.js'
import { GOOD_LABELS, orderDoing } from './Residents.js'

/** What the Doing line is worked out from: the resident's order and the script they run. */
export interface DoingOf {
  order: ResidentOrder | null
  /** The horse they ride: their walks say "Riding" (`CONTEXT.md`: Riding). */
  riding?: string
  /** Expecting a child, which shows while they have no order. */
  carrying?: unknown
  script?: SeenScript
  /** The carriage they are aboard (`CONTEXT.md`: Passenger), which shows while they have no order. */
  aboard?: string
  /** What their defence script keeps aside (`CONTEXT.md`: Defence script), if one runs. */
  interrupted?: { order: ResidentOrder | null; script?: SeenScript }
  /** Down (`CONTEXT.md`: Down): from the world, or as a Player sees them. */
  down?: true
  downUntil?: number
}

/**
 * Whether a driver just struck drives on with their defence script yet to say otherwise, so their
 * line stays what they were doing and doesn't flicker at each blow (`CONTEXT.md`: On a carriage
 * under attack).
 */
function drivesOn(r: {
  order?: ResidentOrder | null
  interrupted?: DoingOf['interrupted']
  script?: SeenScript
}): boolean {
  if (r.script?.task !== 'defend' || r.script.doing || !r.interrupted) return false
  const driving = drivenCarriageId({ order: r.order ?? null })
  return driving !== undefined && driving === drivenCarriageId(r.interrupted)
}

/**
 * A resident's Doing line (`CONTEXT.md`: Doing): what the script last gave `doing()`, else what
 * their task and current order have them doing, "Building a house: fetching 10 wood from the
 * storage". The script's name is not part of it; the card and list show it on a line of its own.
 * A passenger with no order is "Aboard a carriage", heading where its driver among `residents`
 * drives it. While the script waits on the order (`CONTEXT.md`: Running a script, Waiting), the
 * line ends in "· script waiting".
 */
export function doingLine(r: DoingOf, seen: DoingSeen): string {
  if (drivesOn(r)) {
    const goingOn = { ...r }
    delete goingOn.interrupted
    if (r.interrupted!.script) goingOn.script = r.interrupted!.script
    else delete goingOn.script
    return doingLine(goingOn, seen)
  }
  const line = doingOfOrder(r, seen)
  return r.script?.waiting ? `${line} · script waiting` : line
}

/**
 * The small line under the Doing line naming the script a resident runs (`CONTEXT.md`: Doing):
 * the script's name, left out when it is the default script of their task, which the Doing line
 * already says ("Working the farm" alone). Undefined while they run no script.
 */
export function scriptLine(
  r: { script?: SeenScript },
  scripts: readonly ScriptSummary[],
): string | undefined {
  if (!r.script || taskOf(r.script, scripts)) return undefined
  return scripts.find((s) => s.id === r.script!.scriptId)?.name ?? 'a script'
}

/**
 * What someone Down is doing (`CONTEXT.md`: Down): lying Down from hunger, with about how long
 * is left before they die when that is seen (`downUntil`) and `tick` is given.
 */
export function downLine(r: { downUntil?: number }, tick?: number): string {
  if (r.downUntil === undefined || tick === undefined) return 'Down from hunger'
  return `Down from hunger: ${timeLeft(r.downUntil - tick)}`
}

/** What else the Doing line is worked out from (`doingLine`). */
interface DoingSeen {
  scripts?: readonly ScriptSummary[]
  buildings?: readonly Pick<Building, 'id' | 'kind'>[]
  residents?: readonly Pick<Resident, 'order'>[]
  /** The cities the Player knows, to name where a resident relocates to (`CONTEXT.md`: Relocate). */
  cities?: readonly Pick<City, 'id' | 'name'>[]
  /** The horses the Player knows, to name the two being bred (`CONTEXT.md`: Breeding). */
  horses?: readonly Pick<Horse, 'id' | 'name'>[]
  /** About how many ticks until they arrive where they walk, ride or drive (`arrivalTicks`). */
  arrives?: number
  /** The world's tick, to say how long someone Down has left. */
  tick?: number
}

/** The Doing line but for the script waiting (`doingLine`). */
function doingOfOrder(
  r: DoingOf,
  {
    scripts = [],
    buildings = [],
    residents = [],
    cities = [],
    horses = [],
    arrives,
    tick,
  }: DoingSeen,
): string {
  if (isDown(r)) return downLine(r, tick)
  if (r.script?.doing) return r.script.doing
  if (r.aboard !== undefined && !r.order) return aboardLine(r, residents)
  if (r.carrying && !r.order) return 'Carrying a child'
  const task = r.script && taskOf(r.script, scripts)
  const step = stepLine(r.order, buildings, horses)
  if (!task) return step ?? orderDoing(r, arrives, cities)
  const what = taskLine(task, r.script!.building, r.script!.site)
  const o = r.order
  // Building the workplace first, Work's own order is building (`CONTEXT.md`: Working a site).
  const own = task === 'work' && r.script!.site ? 'build' : TASK_ORDER[task]
  // The task's own order says no more than the task does, but where a haul route is, what a
  // trainee learns, which two horses are bred and what a smithy makes.
  if (o && o.kind === own) {
    if (o.kind === 'breed') return breedingLine(o.horseIds, horses)
    if (o.kind === 'haul' || o.kind === 'train') return orderDoing(r, arrives, cities)
    return o.kind === 'workAt' && o.makes
      ? `${what}: ${lower(orderDoing(r, arrives, cities))}`
      : what
  }
  return `${what}: ${o ? lower(step ?? orderDoing(r, arrives, cities)) : 'waiting'}`
}

/**
 * A passenger's line (`CONTEXT.md`: Passenger): "Aboard a carriage", and "· heading to 4, 5"
 * while its driver drives it there.
 */
function aboardLine(
  r: Pick<DoingOf, 'aboard'>,
  residents: readonly Pick<Resident, 'order'>[],
): string {
  const to = selectedWay({ order: null, aboard: r.aboard }, residents)?.target
  return to ? `Aboard a carriage · heading to ${to.x}, ${to.y}` : 'Aboard a carriage'
}

/** The order a task's default script gives for the task itself; Feed the stable and Explore have none. */
const TASK_ORDER: Record<Task, ResidentOrder['kind'] | undefined> = {
  work: 'workAt',
  build: 'build',
  buildLine: 'build',
  haul: 'haul',
  tearDown: 'tearDown',
  breed: 'breed',
  feedStable: undefined,
  train: 'train',
  defend: undefined,
  explore: undefined,
  alarm: undefined,
}

/**
 * The task a running script is the default script of: the one the server says it runs without
 * one of the Player's, or the task of the Player's script it runs.
 */
function taskOf(script: SeenScript, scripts: readonly ScriptSummary[]): Task | undefined {
  return script.task ?? scripts.find((s) => s.id === script.scriptId)?.task ?? undefined
}

/**
 * "Working the farm", "Building the farm (to work it)" while Work builds its workplace first
 * (`site`), "Building a house", "Tearing down the mine", "Breeding horses".
 */
function taskLine(task: Task, building: SeenScript['building'], site?: true): string {
  const name = building && BUILDING_NAMES[building]
  if (task === 'work' && site)
    return name ? `Building the ${name} (to work it)` : 'Building (to work it)'
  if (task === 'work') return name ? `Working the ${name}` : 'Working'
  if (task === 'build') return name ? `Building ${article(name)} ${name}` : 'Building'
  if (task === 'buildLine')
    return name ? `Building ${article(name)} ${name} line` : 'Building a line'
  if (task === 'tearDown') return name ? `Tearing down the ${name}` : 'Tearing down'
  if (task === 'feedStable') return 'Feeding the stable'
  if (task === 'train') return 'Training'
  if (task === 'defend') return 'Defending'
  if (task === 'alarm') return 'On alarm'
  if (task === 'breed') return 'Breeding horses'
  if (task === 'haul') return 'Hauling'
  if (task === 'explore') return 'Exploring'
  return task satisfies never
}

/**
 * What storing, fetching and breeding say beyond the built-in order line: the goods and where,
 * "Carrying iron to the storage", "Fetching 10 wood from the stable", and the two horses, "Breeding
 * Star and Blaze". Undefined for any other order.
 */
function stepLine(
  o: ResidentOrder | null,
  buildings: readonly Pick<Building, 'id' | 'kind'>[],
  horses: readonly Pick<Horse, 'id' | 'name'>[],
): string | undefined {
  if (o?.kind === 'store' && o.phase !== 'refilling') {
    return `Carrying ${goodsLine(o.goods)} to ${placeLine(o.to, buildings)}`
  }
  if (o?.kind === 'fetch')
    return `Fetching ${goodsLine(o.goods)} from ${placeLine(o.from, buildings)}`
  if (o?.kind === 'breed') return breedingLine(o.horseIds, horses)
  return undefined
}

/**
 * "Breeding Star and Blaze", as far as the Player knows the two (`CONTEXT.md`: Breeding, Doing): one
 * they no longer know of is "another horse", and with neither known it is "Breeding horses".
 */
function breedingLine(
  horseIds: readonly string[],
  horses: readonly Pick<Horse, 'id' | 'name'>[],
): string {
  const names = horseIds.flatMap((id) => horses.find((h) => h.id === id)?.name ?? [])
  if (names.length === 0) return 'Breeding horses'
  return `Breeding ${names[0]} and ${names[1] ?? 'another horse'}`
}

/** "10 wood and iron": units where the order names them. */
function goodsLine(goods: GoodsWanted): string {
  const parts = Object.entries(goods).map(([good, units]) => {
    const name = GOOD_LABELS[good as keyof typeof GOOD_LABELS].toLowerCase()
    return units == null ? name : `${units} ${name}`
  })
  if (parts.length === 0) return 'goods'
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

/** "the storage", "the stable", "the carriage". */
function placeLine(place: GoodsPlace, buildings: readonly Pick<Building, 'id' | 'kind'>[]): string {
  if (place.kind === 'carriage') return 'the carriage'
  const kind = buildings.find((b) => b.id === place.storageId)?.kind
  return `the ${kind ? BUILDING_NAMES[kind] : 'storage'}`
}

/**
 * What a resident goes on with once their defence script ends (`CONTEXT.md`: Defence script), for
 * the small line under their Doing line: "Then: working the farm". Undefined while none runs.
 */
export function interruptedLine(
  r: Parameters<typeof drivesOn>[0],
  seen: Parameters<typeof doingLine>[1],
): string | undefined {
  const kept = r.interrupted
  if (!kept || drivesOn(r)) return undefined
  const line = doingLine(
    { order: kept.order, ...(kept.script ? { script: kept.script } : {}) },
    seen,
  )
  return `Then: ${lower(line)}`
}

const article = (name: string) => (/^[aeiou]/.test(name) ? 'an' : 'a')
const lower = (line: string) => line.charAt(0).toLowerCase() + line.slice(1)

/**
 * About how many ticks until each resident arrives where they walk, ride or drive
 * (`arrivalTicks`), on the ground as the Player knows it: a road wherever one is built, and
 * Plains where the terrain is unexplored or not loaded yet, as the server guesses too.
 */
export function arrivalOf(
  world: Omit<ArrivalWorld, 'ground'> & { buildings: Building[] },
  terrainAt: ((x: number, y: number) => number | undefined) | undefined,
): (r: Resident) => number | undefined {
  const roads = roadTiles(world, world.size)
  const ground = (x: number, y: number): Terrain => {
    if (roads.has(tileIndex(world.size, x, y))) return Terrain.Road
    const t = terrainAt?.(x, y)
    return t === undefined || t === UNEXPLORED ? Terrain.Plains : (t as Terrain)
  }
  return (r) => arrivalTicks({ ...world, ground }, r)
}
