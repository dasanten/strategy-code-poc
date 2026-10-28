/**
 * The game's default scripts (`CONTEXT.md`: Default script; ADR 0009): the script behind each
 * task the UI can give, written in the game's own language. Each Player has their own version
 * of every one in their library, which follows the game's default until they edit it.
 *
 * Giving a resident a task from the UI runs its default script with the task's target written
 * into `memory`, as `TaskMemory` lists. Defaults use the step budget like any script; a test
 * keeps each at most a quarter of `SCRIPT_STEP_BUDGET`.
 */
import { BREED_FOOD, HORSE_FOOD_PER_DAY, STABLE_FEED_DAYS, WORK_FOOD_KEPT } from './balance.js'
import { FOOTPRINT } from './footprint.js'

/** The tasks that run a default script. */
export const TASKS = ['work', 'build', 'haul', 'tearDown', 'breed', 'feedStable'] as const
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
  /** Breed horses: the stable, and the two horses in it to breed. */
  breed: { stableId: string; horseIds: string[] }
  /** Feed the stable: the stable the resident stood in when given it. */
  feedStable: { stableId: string }
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
// a full load, one of us, picked at random, stores it in params.storage, or
// the nearest storage of my realm while none is picked, and comes back. At a
// smithy, memory.makes says what to make. Meals come from the workplace's
// pile on their own, without an order.
param storage: storage // where the output goes
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
let to = params.storage
if (to == null) {
  let stores = storages(place) // nearest first
  if (stores.length == 0) { return } // none in reach: the pile grows
  to = stores[0]
}
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
memory.carry = {storageId: to.id, goods: goods}
`,
  },
  build: {
    name: 'Build',
    source: `// Build (default): build a memory.building with the north-west tile of its
// footprint at memory.at, laying out the site or joining the one there.
// While the site lacks materials, one of us building it, picked at random,
// fetches a load of what is missing from params.source, or the nearest
// storage of my realm that holds it while none is picked, and brings it
// back. With none there we just build.
param source: storage // where materials come from; a carriage too
if (memory.stuck) { return }
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
    end()
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
  if (build(memory.building) != null) { end() }
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
let from = params.source
if (from == null) {
  let stores = storages(site, goods) // nearest first, holding some
  if (stores.length == 0) { return } // none in storage: we just build
  from = stores[0]
} else {
  // The one picked: only while it holds some of what is missing.
  let held = from.stock
  if (held == null) { held = from.load }
  let some = false
  for (g of goods) {
    if (held != null && held[g] != null && held[g] > 0) { some = true }
  }
  if (!some) { return }
}
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
if (fetch(load, from.id) == null) {
  memory.fetch = {storageId: from.id, goods: load}
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
// I stand on, until it is gone; then end.
if (me.order == null || me.order.kind != "tearDown") {
  // Turned down, such as with the building gone, tearDown says why: done.
  if (tearDown(memory.buildingId) != null) { end() }
}
`,
  },
  breed: {
    name: 'Breed horses',
    source: `// Breed horses (default): at stable memory.stableId, tend the two horses
// memory.horseIds until their foal is born; then stand idle. Away from the
// stable, walk there first. Before starting, take Food for the days of
// tending from the stable, if it has some.
let needFood = ${BREED_FOOD} // Food I take along for my meals while tending
if (memory.done == true) { end() }
if (me.order != null && me.order.kind == "breed") {
  memory.started = true
  return
}
if (memory.started == true) {
  // The foal was born, or the breeding stopped: done.
  end()
}
if (me.order != null && (me.order.kind == "walkTo" || me.order.kind == "pickUp")) { return }
let food = 0
if (me.carried.food != null) { food = me.carried.food }
if (memory.fed != true && food < needFood) {
  let spot = {kind: "storage", storageId: memory.stableId}
  if (pickUp(spot, {food: needFood - food}) == null) {
    memory.fed = true
    return
  }
}
let problem = breed(memory.stableId, memory.horseIds)
if (problem == null) { return }
let stable = building(memory.stableId)
if (problem == "not standing at that stable" && stable != null && memory.walked != true) {
  memory.walked = true
  walkTo(stable.x, stable.y)
  return
}
end()
`,
  },
  feedStable: {
    name: 'Feed the stable',
    source: `// Feed the stable (default): keep Food for ${STABLE_FEED_DAYS} game days for the
// horses standing in params.stable, or in memory.stableId while none is
// picked. Below that I fetch what is missing from params.source, or the
// nearest storage of my realm with Food while none is picked, and store it
// in the stable; otherwise I wait there.
param stable: storage // the stable to feed
param source: storage // where the Food comes from; a carriage too
let days = ${STABLE_FEED_DAYS} // game days of Food to keep
let perHorse = ${HORSE_FOOD_PER_DAY} // Food a horse eats a game day
let side = ${FOOTPRINT.stable} // tiles along each side of a stable

let stable = params.stable
if (stable == null) { stable = building(memory.stableId) }
if (stable == null) { return } // gone or out of sight
if (me.order != null) { return } // on my way

// Back with Food: what I fetched goes into the stable; my own food stays.
let fetched = memory.fetched
if (fetched != null) {
  memory.fetched = null
  let got = 0
  if (me.carried.food != null) { got = me.carried.food - fetched.before }
  got = got - got % 1
  if (got > 0 && store({food: got}, stable.id) == null) { return }
}

// Whether something with x and y stands on the stable's footprint.
fn inStable(t) {
  let dx = (t.x - stable.x + mapSize) % mapSize
  let dy = (t.y - stable.y + mapSize) % mapSize
  return dx < side && dy < side
}

// Below the Food to keep for the horses in it now: fetch what is missing.
let horsesIn = 0
for (h of horses()) {
  if (inStable(h)) { horsesIn = horsesIn + 1 }
}
let held = 0
if (stable.stock != null && stable.stock.food != null) { held = stable.stock.food }
let need = horsesIn * days * perHorse - held
if (need > 0) {
  let from = params.source
  if (from == null) {
    let stores = storages(stable, ["food"]) // nearest first, holding some
    if (stores.length > 0) { from = stores[0] }
  }
  let has = null
  if (from != null) {
    has = from.stock
    if (has == null) { has = from.load }
  }
  if (from != null && from.id != stable.id && has != null && has.food != null && has.food >= 1) {
    let units = need - need % 1
    if (units < need) { units = units + 1 }
    let before = 0
    if (me.carried.food != null) { before = me.carried.food }
    if (fetch({food: units}, from.id) == null) {
      memory.fetched = {before: before}
      return
    }
  }
}

// Enough, or none to fetch: wait at the stable.
if (!inStable(me)) { walkTo(stable.x, stable.y) }
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
