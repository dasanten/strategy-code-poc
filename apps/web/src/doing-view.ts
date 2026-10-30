import type {
  Building,
  GoodsPlace,
  GoodsWanted,
  Resident,
  ResidentOrder,
  ScriptSummary,
  SeenScript,
  Task,
} from '@csp/shared'
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
}

/**
 * A resident's Doing line (`CONTEXT.md`: Doing): what the script last gave `doing()`, else what
 * their task and current order have them doing, "Building a house: fetching 10 wood from the
 * storage". The script's name is not part of it; the card and list show it on a line of its own.
 * A passenger with no order is "Aboard a carriage", heading where its driver among `residents`
 * drives it.
 */
export function doingLine(
  r: DoingOf,
  {
    scripts = [],
    buildings = [],
    residents = [],
  }: {
    scripts?: readonly ScriptSummary[]
    buildings?: readonly Pick<Building, 'id' | 'kind'>[]
    residents?: readonly Pick<Resident, 'order'>[]
  },
): string {
  if (r.script?.doing) return r.script.doing
  if (r.aboard !== undefined && !r.order) return aboardLine(r, residents)
  if (r.carrying && !r.order) return 'Carrying a child'
  const task = r.script && taskOf(r.script, scripts)
  const step = stepLine(r.order, buildings)
  if (!task) return step ?? orderDoing(r)
  const what = taskLine(task, r.script!.building)
  const o = r.order
  // The task's own order says no more than the task does, but where a haul route is and what a
  // smithy makes.
  if (o && o.kind === TASK_ORDER[task]) {
    if (o.kind === 'haul') return orderDoing(r)
    return o.kind === 'workAt' && o.makes ? `${what}: ${lower(orderDoing(r))}` : what
  }
  return `${what}: ${o ? lower(step ?? orderDoing(r)) : 'waiting'}`
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

/** The order a task's default script gives for the task itself; Feed the stable has none. */
const TASK_ORDER: Record<Task, ResidentOrder['kind'] | undefined> = {
  work: 'workAt',
  build: 'build',
  haul: 'haul',
  tearDown: 'tearDown',
  breed: 'breed',
  feedStable: undefined,
}

/**
 * The task a running script is the default script of: the one the server says it runs without
 * one of the Player's, or the task of the Player's script it runs.
 */
function taskOf(script: SeenScript, scripts: readonly ScriptSummary[]): Task | undefined {
  return script.task ?? scripts.find((s) => s.id === script.scriptId)?.task ?? undefined
}

/** "Working the farm", "Building a house", "Tearing down the mine". */
function taskLine(task: Task, building: SeenScript['building']): string {
  const name = building && BUILDING_NAMES[building]
  if (task === 'work') return name ? `Working the ${name}` : 'Working'
  if (task === 'build') return name ? `Building ${article(name)} ${name}` : 'Building'
  if (task === 'tearDown') return name ? `Tearing down the ${name}` : 'Tearing down'
  if (task === 'feedStable') return 'Feeding the stable'
  return 'Hauling'
}

/**
 * What storing and fetching say beyond the built-in order line: the goods and where, "Carrying
 * iron to the storage", "Fetching 10 wood from the stable". Undefined for any other order.
 */
function stepLine(
  o: ResidentOrder | null,
  buildings: readonly Pick<Building, 'id' | 'kind'>[],
): string | undefined {
  if (o?.kind === 'store' && o.phase !== 'refilling') {
    return `Carrying ${goodsLine(o.goods)} to ${placeLine(o.to, buildings)}`
  }
  if (o?.kind === 'fetch')
    return `Fetching ${goodsLine(o.goods)} from ${placeLine(o.from, buildings)}`
  return undefined
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

const article = (name: string) => (/^[aeiou]/.test(name) ? 'an' : 'a')
const lower = (line: string) => line.charAt(0).toLowerCase() + line.slice(1)
