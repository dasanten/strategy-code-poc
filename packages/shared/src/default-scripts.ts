/**
 * The game's default scripts (`CONTEXT.md`: Default script; ADR 0009): the script behind each
 * task the UI can give, written in the game's own language. Each Player has their own version
 * of every one in their library, which follows the game's default until they edit it.
 *
 * Giving a resident a task from the UI runs its default script with the task's target written
 * into `memory`, as `TaskMemory` lists. Defaults use the step budget like any script; a test
 * keeps each at most a quarter of `SCRIPT_STEP_BUDGET`.
 */
import { WORK_FOOD_KEPT } from './balance.js'

/** The tasks that run a default script. */
export const TASKS = ['work', 'build', 'haul', 'tearDown'] as const
export type Task = (typeof TASKS)[number]

/** What giving a task from the UI writes into the script's memory. */
export interface TaskMemory {
  /** Work: the workplace to work, the one the resident stands on; `makes` at a smithy. */
  work: { workplaceId: string; makes?: string }
  /**
   * Build: the kind of building, with the north-west tile of its footprint `at` the tile the
   * resident stood on when given it, or the one the task named: they walk there, then lay out the
   * site there or join the one there.
   */
  build: { building: string; at: { x: number; y: number } }
  /**
   * Haul: the carriage, the route's stops (`from` the tile the resident stood on when given it),
   * the goods going to `to` and those coming back, and the Food kept on board for the horse.
   */
  haul: {
    carriageId: string
    from: { x: number; y: number }
    to: { x: number; y: number }
    goods: string[]
    returnGoods: string[]
    keepFood: number
  }
  /** Tear down: the building or construction site on the resident's tile. */
  tearDown: { buildingId: string }
}

export interface DefaultScript {
  /** The task's name, as the UI shows it. */
  name: string
  source: string
}

/**
 * The game's current default of each task. Changing a source here reaches every Player still
 * following it on the next start; those who edited theirs are told it changed.
 */
export const DEFAULT_SCRIPTS: Readonly<Record<Task, DefaultScript>> = {
  work: {
    name: 'Work',
    source: `// Work (default): work the workplace memory.workplaceId; once its pile holds
// a full load, one of us, picked at random, stores it in the nearest storage
// of my realm and comes back. At a smithy, memory.makes says what to make.
// Meals come from the workplace's pile on their own, without an order.
let keepFood = ${WORK_FOOD_KEPT} // Food a farm's pile keeps for our refills

// Where the workplace is, kept for when it is out of sight.
let place = building(memory.workplaceId)
if (place != null) { memory.at = {x: place.x, y: place.y} }
if (memory.at == null || memory.stuck) { return }
if (me.order != null && me.order.kind != "workAt") { return } // on my way

// With a load picked up: store it (keeping my own food), then back to work.
let carry = memory.carry
if (carry != null && !carry.stored) {
  carry.stored = true
  if (store(carry.goods, carry.storageId) == null) { return }
}
if (me.x != memory.at.x || me.y != memory.at.y) {
  if (carry != null && carry.walked) { memory.stuck = true } // no way back
  else {
    walkTo(memory.at.x, memory.at.y)
    if (carry != null) { carry.walked = true }
  }
  return
}
if (carry != null) { memory.carry = null }
if (place == null) { return } // gone
if (me.order == null) {
  workAt(memory.makes)
  return
}

// Once the pile holds a full load, one of us carries it, picked at random.
let pile = pileAt(place.x, place.y)
let load = {}
let goods = []
let full = false
for (good of outputOf(place)) {
  let n = 0
  if (pile != null && pile[good] != null) { n = pile[good] }
  if (good == "food") { n = n - keepFood }
  if (n > 0) {
    load[good] = n
    goods[goods.length] = good
    if (fits(good) > 0 && n >= fits(good)) { full = true }
  }
}
if (!full) { return }
let stores = storages(place) // nearest first
if (stores.length == 0) { return } // none in reach: the pile grows
let workers = []
for (r of withMemory("workplaceId", place.id)) {
  if (r.script.memory.carry != null) { return } // one carries at a time
  if (r.order != null && r.order.kind == "workAt") { workers[workers.length] = r }
}
if (workers.length == 0) { return }
let i = 0
while ((i + 1) / workers.length <= random) { i = i + 1 }
if (workers[i].id != me.id) { return }
pickUp({kind: "ground"}, load)
memory.carry = {storageId: stores[0].id, goods: goods}
`,
  },
  build: {
    name: 'Build',
    source: `// Build (default): build a memory.building with the north-west tile of its
// footprint at memory.at, laying out the site or joining the one there.
// While the site lacks materials, one of us building it, picked at random,
// fetches a load of what is missing from the nearest storage of my realm
// that holds it and brings it back. With none in storage we just build.
if (memory.done || memory.stuck) { return }
if (me.order != null && me.order.kind != "build") { return } // on my way

// What someone carries of what the site lacks; null if nothing.
fn carriedOf(r, missing) {
  let load = null
  for (m of missing) {
    let n = r.carried[m.good]
    if (n != null && n > 0) {
      if (n > m.units) { n = m.units }
      if (load == null) { load = {} }
      load[m.good] = n
    }
  }
  return load
}

// The site, once laid out. Finished or gone, building is done.
let at = me.x == memory.at.x && me.y == memory.at.y
let site = null
if (memory.siteId != null) {
  site = building(memory.siteId)
  if (at && (site == null || site.site == null)) {
    memory.done = true
    return
  }
}

// Not there yet, or back from fetching: walk to the site.
let away = memory.fetch
if (!at) {
  if (away != null && away.walked) { memory.stuck = true } // no way back
  else {
    walkTo(memory.at.x, memory.at.y)
    if (away != null) { away.walked = true }
  }
  return
}
if (away != null) { memory.fetch = null }
if (site != null) {
  // What I carry of what it lacks goes in first.
  let mine = carriedOf(me, materialsNeeded(site))
  if (mine != null) {
    drop({kind: "site", siteId: site.id}, mine)
    return
  }
}
if (me.order == null) {
  // Turned down, such as with the tile taken, build says why: done.
  if (build(memory.building) != null) { memory.done = true }
  return
}
if (me.order.siteId == null) { return } // laid out at the end of the tick
memory.siteId = me.order.siteId
if (site == null) { return }

// While it lacks materials, one of us fetches them, picked at random.
let missing = materialsNeeded(site)
if (missing.length == 0) { return }
let goods = []
for (m of missing) { goods[goods.length] = m.good }
let stores = storages(site, goods) // nearest first, holding some
if (stores.length == 0) { return } // none in storage: we just build
let builders = []
for (r of withMemory("siteId", site.id)) {
  if (r.script.memory.fetch != null) { return } // one fetches at a time
  if (carriedOf(r, missing) != null) { return } // someone brings some already
  if (r.order != null && r.order.kind == "build") { builders[builders.length] = r }
}
if (builders.length == 0) { return }
let i = 0
while ((i + 1) / builders.length <= random) { i = i + 1 }
if (builders[i].id != me.id) { return }
let load = {}
for (m of missing) { load[m.good] = m.units }
if (fetch(load, stores[0].id) == null) {
  memory.fetch = {storageId: stores[0].id, goods: load}
}
`,
  },
  haul: {
    name: 'Haul',
    source: `// Haul (default): drive carriage memory.carriageId on a haul route between
// memory.from and memory.to: memory.goods there, memory.returnGoods back,
// memory.keepFood Food kept on board for the horse. The built-in haul order
// loads, drives and unloads, again and again; this starts it at memory.from.
if (me.order == null || me.order.kind != "haul") {
  if (me.x == memory.from.x && me.y == memory.from.y) {
    haul(memory.carriageId, memory.to.x, memory.to.y, memory.goods, memory.returnGoods, memory.keepFood)
  }
}
`,
  },
  tearDown: {
    name: 'Tear down',
    source: `// Tear down (default): tear down memory.buildingId, the building or site
// I stand on, until it is gone; then stand idle.
if (memory.done != true && (me.order == null || me.order.kind != "tearDown")) {
  // Turned down, such as with the building gone, tearDown says why: done.
  if (tearDown(memory.buildingId) != null) {
    memory.done = true
  }
}
`,
  },
}

/** The name of a Player's version of a task's default script in their library. */
export function defaultScriptName(task: Task): string {
  return `${DEFAULT_SCRIPTS[task].name} (default)`
}

export function isTask(value: unknown): value is Task {
  return (TASKS as readonly unknown[]).includes(value)
}
