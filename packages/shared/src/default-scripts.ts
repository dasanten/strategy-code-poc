/**
 * The game's default scripts (`CONTEXT.md`: Default script; ADR 0009): the script behind each
 * task the UI can give, written in the game's own language. Each Player has their own version
 * of every one in their library, which follows the game's default until they edit it.
 *
 * Giving a resident a task from the UI runs its default script with the task's target written
 * into `memory`, as `TaskMemory` lists. Defaults use the step budget like any script; a test
 * keeps each at most a quarter of `SCRIPT_STEP_BUDGET`.
 */
import { OWN_FOOD, WORK_FOOD_KEPT } from './balance.js'

/** The tasks that run a default script. */
export const TASKS = ['work'] as const
export type Task = (typeof TASKS)[number]

/** What giving a task from the UI writes into the script's memory. */
export interface TaskMemory {
  /** Work: the workplace to work, the one the resident stands on; `makes` at a smithy. */
  work: { workplaceId: string; makes?: string }
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
    source: `// Work (default): work the workplace memory.workplaceId, and carry what it
// makes to the nearest storage of my realm once its pile holds a full load.
// At a smithy, memory.makes says what to make. Meals come from the
// workplace's pile on their own, without an order.
let ownFood = ${OWN_FOOD} // Food I keep on me for my own meals
let keepFood = ${WORK_FOOD_KEPT} // Food a farm's pile keeps for our refills

// Where the workplace is, kept for when it is out of sight.
let place = building(memory.workplaceId)
if (place != null) { memory.at = {x: place.x, y: place.y} }
if (memory.at == null || memory.stuck) { return }

fn at(spot) { return me.x == spot.x && me.y == spot.y }
fn walking() { return me.order != null && me.order.kind == "walkTo" }
fn units(stock, good) {
  if (stock == null || stock[good] == null) { return 0 }
  return stock[good]
}

// Carrying: to the storage, store the load, refill if low, back to work.
let carry = memory.carry
fn next(step) {
  carry.step = step
  carry.walked = false
}
// Walks to a spot; true once there. A way that can't be walked is lost.
fn goTo(spot) {
  if (at(spot)) { return true }
  if (!walking()) {
    if (carry.walked) { carry.lost = true }
    else {
      walkTo(spot.x, spot.y)
      carry.walked = true
    }
  }
  return false
}
if (carry != null) {
  let storage = building(carry.storageId)
  if (carry.step == "store" && (storage == null || carry.lost)) {
    carry.lost = false
    next("back")
  }
  if (carry.step == "store") {
    if (!goTo(storage)) { return }
    let load = {}
    let any = false
    for (good of carry.goods) {
      let n = units(me.carried, good)
      if (good == "food") { n = n - ownFood }
      if (n > 0) {
        load[good] = n
        any = true
      }
    }
    if (any) { drop({kind: "storage", storageId: storage.id}, load) }
    next("refill")
    return
  }
  if (carry.step == "refill") {
    let have = units(me.carried, "food")
    if (storage != null && at(storage) && have < ownFood && units(storage.stock, "food") > 0) {
      pickUp({kind: "storage", storageId: storage.id}, {food: ownFood - have})
    }
    next("back")
    return
  }
  if (!goTo(memory.at)) {
    if (carry.lost) {
      memory.carry = null
      memory.stuck = true
    }
    return
  }
  memory.carry = null
}

// Working.
if (!at(memory.at)) {
  if (!walking()) { walkTo(memory.at.x, memory.at.y) }
  return
}
if (place == null) { return } // gone
if (me.order == null || me.order.kind != "workAt") {
  workAt(memory.makes)
  return
}

// Once the pile holds a full load, one of us carries it, picked at random.
let pile = pileAt(place.x, place.y)
let load = {}
let goods = []
let full = false
for (good of outputOf(place)) {
  let n = units(pile, good)
  if (good == "food") { n = n - keepFood }
  if (n > 0) {
    load[good] = n
    goods[goods.length] = good
    let room = fits(good)
    if (room > 0 && n >= room) { full = true }
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
memory.carry = {storageId: stores[0].id, goods: goods, step: "store", walked: false}
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
