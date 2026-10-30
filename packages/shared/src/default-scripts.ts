/**
 * The game's default scripts (`CONTEXT.md`: Default script; ADR 0009): the script behind each
 * task the UI can give, written in the game's own language. Each Player has their own version
 * of every one in their library, which follows the game's default until they edit it.
 *
 * Giving a resident a task from the UI runs its default script with the task's target in its
 * target param (`TARGET_PARAMS`) or written into `memory`, as `TaskMemory` lists. Defaults use the step budget like any script; a test
 * keeps each at most a quarter of `SCRIPT_STEP_BUDGET`.
 */
import {
  BREED_FOOD,
  GET_FOOD_AT,
  GET_FOOD_TAKE,
  HORSE_FOOD_PER_DAY,
  STABLE_FEED_DAYS,
  WORK_FOOD_KEPT,
} from './balance.js'
import { FOOTPRINT } from './footprint.js'

/** The tasks that run a default script. */
export const TASKS = ['work', 'build', 'haul', 'tearDown', 'breed', 'feedStable'] as const
export type Task = (typeof TASKS)[number]

/**
 * The param each task's default script takes its target in (`CONTEXT.md`: Default script,
 * Started directly). Giving the task fills it; unset, the default works the one on the
 * resident's tile when it starts. It is never kept between starts, unlike the script's other
 * params.
 */
export const TARGET_PARAMS: Partial<Readonly<Record<Task, string>>> = {
  work: 'workplace',
  build: 'site',
  haul: 'carriage',
  tearDown: 'building',
  breed: 'stable',
  feedStable: 'stable',
}

/** The target param of a script (`TARGET_PARAMS`), if it is the default of a task with one. */
export function targetParam(script: { task?: Task | null }): string | undefined {
  return script.task ? TARGET_PARAMS[script.task] : undefined
}

/** What giving a task from the UI writes into the script's memory. */
export interface TaskMemory {
  /**
   * Work: the workplace, the one the resident stands on; `makes` at a smithy. The workplace goes
   * in the param `workplace` too (`TARGET_PARAMS`), which the default reads; it keeps the one it
   * works here, so Work scripts edited before it took the param, and scripts reading
   * `withMemory("workplaceId", …)`, keep working.
   */
  work: { workplaceId: string; makes?: string }
  /**
   * Build: the kind of building, with the north-west tile of its footprint `at` the tile the
   * resident stood on when given it, or the one the task named: they walk there, then lay out the
   * site there or join the one there. Joining one, the site goes in the param `site` too
   * (`TARGET_PARAMS`); started without this memory, the default takes both from that site.
   */
  build: { building: string; at: { x: number; y: number } }
  /**
   * Haul: the carriage, the route's stops (`from` the tile the resident stood on when given it),
   * the goods going to `to` and those coming back, and the Food kept on board for the horse. The
   * carriage goes in the param `carriage` too (`TARGET_PARAMS`), which the default reads; the
   * route comes only from here, so the default started without it ends.
   */
  haul: {
    carriageId: string
    from: { x: number; y: number }
    to: { x: number; y: number }
    goods: string[]
    returnGoods: string[]
    keepFood: number
  }
  /**
   * Tear down: the building or construction site on the resident's tile, in the param `building`
   * too (`TARGET_PARAMS`); kept here for one of another's, which no param can hold.
   */
  tearDown: { buildingId: string }
  /**
   * Breed horses: the stable, in the param `stable` too (`TARGET_PARAMS`), and the two horses in
   * it to breed. Started directly, the default picks the pair itself (`breedingPair`).
   */
  breed: { stableId: string; horseIds: string[] }
  /**
   * Feed the stable: the stable the resident stood in when given it, in the param `stable` too
   * (`TARGET_PARAMS`).
   */
  feedStable: { stableId: string }
}

export interface DefaultScript {
  /** The task's name, as the UI shows it. */
  name: string
  source: string
}

/**
 * Naming things in the script log (`CONTEXT.md`: Script log), shared by the defaults, which log
 * their decisions and turns, never every tick. `placeName(b)` names a building or carriage by its
 * kind and tile, `goodsText(load, goods)` the units of `goods` in `load`, in whole units.
 */
const LOG_TEXT = `// A building or carriage for my log: "the storage at 12,6".
fn placeName(b) {
  let kind = b.kind
  if (kind == null) { kind = "carriage" }
  return "the " + kind + " at " + b.x + "," + b.y
}

// The units of goods in load for my log: "10 stone, 4 wood".
fn goodsText(load, goods) {
  let text = ""
  for (g of goods) {
    let n = load[g]
    if (n != null && n >= 1) {
      if (text != "") { text = text + ", " }
      text = text + (n - n % 1) + " " + g
    }
  }
  return text
}`

/**
 * Getting food (`CONTEXT.md`: Getting food), shared by the Work, Build and Tear down defaults,
 * which declare the number params `foodAt` and `foodTake` with defaults (`FOOD_PARAMS`).
 * `getFood(from, near)` fetches Food below `foodAt` units on me, up to `foodTake`, at `from`
 * while it holds Food, else at the nearest storage of my realm with Food from `near`; true once
 * I set off, which it logs (it needs `LOG_TEXT`). `foodToTake()` is the Food that tops me up to
 * `foodTake`.
 */
const FOOD_PARAMS = `param foodAt: number = ${GET_FOOD_AT} // get Food below this many units on me; 0 never
param foodTake: number = ${GET_FOOD_TAKE} // units of Food to take along`

const GET_FOOD = `// The Food that tops me up to params.foodTake, in whole units.
fn foodToTake() {
  let food = 0
  if (me.carried.food != null) { food = me.carried.food }
  let units = params.foodTake - food
  if (units < 1) { return 0 }
  return units - units % 1
}

// Below params.foodAt units of Food on me: fetch Food up to params.foodTake
// at from while it holds Food, else at the nearest storage of my realm with
// Food from near. True once I set off, which I log.
fn getFood(from, near) {
  let food = 0
  if (me.carried.food != null) { food = me.carried.food }
  if (food >= params.foodAt) { return false }
  let units = params.foodTake - food
  units = units - units % 1
  if (units < 1) { return false }
  let at = from
  let has = null
  if (at != null) {
    has = at.stock
    if (has == null) { has = at.load }
  }
  if (has == null || has.food == null || has.food < 1) {
    at = null
    let stores = storages(near, ["food"]) // nearest first, holding some
    if (stores.length > 0) { at = stores[0] }
  }
  if (at == null || fetch({food: units}, at.id) != null) { return false }
  log("low on Food (" + (food - food % 1) + "): fetching " + units + " at " + placeName(at))
  return true
}`

/**
 * Which stable the Breed horses and Feed the stable defaults work in (`CONTEXT.md`: Default
 * script, Started directly), both declaring `param stable: storage`: the one picked, else the one
 * the resident stands in when it starts, kept in `memory.stableId`; with none there, the script
 * ends.
 */
const PICK_STABLE = `// Which stable: the one picked, else the one I started in.
if (params.stable != null) {
  if (params.stable.kind != "stable") {
    end("the one picked is no stable")
    return
  }
  memory.stableId = params.stable.id
}
if (memory.stableId == null) {
  let here = buildingAt(me.x, me.y)
  if (here == null || here.kind != "stable" || here.site != null) {
    end("no stable here")
    return
  }
  memory.stableId = here.id
}`

/**
 * The game's current default of each task. Changing a source here reaches every Player still
 * following it on the next start; those who edited theirs are told it changed.
 */
export const DEFAULT_SCRIPTS: Readonly<Record<Task, DefaultScript>> = {
  work: {
    name: 'Work',
    source: `// Work (default): work params.workplace, or while none is picked the
// workplace on my tile when I start, kept in memory.workplaceId; with none I
// end. Once its pile holds a full load, one of us, picked at random, stores
// it in params.storage, or the nearest storage of my realm while none is
// picked, and comes back. At a smithy, memory.makes says what to make. Meals
// come from the workplace's pile on their own, without an order. Below
// params.foodAt units of Food on me I get Food up to params.foodTake at
// params.storage, or the nearest storage of my realm with Food, and come
// back; storing a load tops my food up to foodTake too. foodAt 0 turns
// getting food off.
param workplace: building // the workplace to work; none: the one I stand on
param storage: storage // where the output goes
${FOOD_PARAMS}
let keepFood = ${WORK_FOOD_KEPT} // Food a farm's pile keeps for our refills
${LOG_TEXT}

// A finished building that makes goods.
fn isWorkplace(b) {
  return b != null && b.site == null && outputOf(b).length > 0
}

// Which workplace I work: the one picked, else the one I started on.
if (params.workplace != null) {
  if (!isWorkplace(params.workplace)) {
    end("the " + params.workplace.kind + " is no workplace")
    return
  }
  memory.workplaceId = params.workplace.id
}
if (memory.workplaceId == null) {
  let here = buildingAt(me.x, me.y)
  if (!isWorkplace(here)) {
    end("no workplace on their tile")
    return
  }
  memory.workplaceId = here.id
}

// Where the workplace is, kept for when it is out of sight.
let place = building(memory.workplaceId)
if (place != null) { memory.at = {x: place.x, y: place.y} }
if (memory.at == null || memory.stuck) { return }
if (me.order != null && me.order.kind != "workAt") { return } // on my way

// With a load picked up: store it (keeping my own food), then back to work.
let carry = memory.carry
if (carry != null && !carry.stored) {
  carry.stored = true
  if (store(carry.goods, carry.storageId, params.foodTake) == null) {
    let to = building(carry.storageId)
    if (carry.load != null && to != null) {
      log("pile full: carrying " + goodsText(carry.load, carry.goods) + " to " + placeName(to))
    }
    return
  }
}
let away = carry
if (away == null) { away = memory.food } // back from getting food
if (me.x != memory.at.x || me.y != memory.at.y) {
  if (away != null && away.walked) { // no way back
    memory.stuck = true
    log("no way back to the workplace")
  } else {
    walkTo(memory.at.x, memory.at.y)
    if (away != null) { away.walked = true }
  }
  return
}
if (carry != null) { memory.carry = null }
if (memory.food != null) { memory.food = null }
if (place == null) { // here, and it isn't: torn down, or no longer ours
  end("the workplace is gone")
  return
}

// Low on Food: get some, then back to work. With none anywhere, work on.
${GET_FOOD}
if (getFood(params.storage, place)) {
  memory.food = {walked: false}
  return
}
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
memory.carry = {storageId: to.id, goods: goods, load: load} // logged once I set off
`,
  },
  build: {
    name: 'Build',
    source: `// Build (default): build a memory.building with the north-west tile of its
// footprint at memory.at, laying out the site or joining the one there, as
// the Build order gives it. Without one I join params.site, or while none is
// picked the construction site on my tile when I start; with none I end.
// While the site lacks materials, one of us building it, picked at random,
// fetches a load of what is missing from params.source, or the nearest
// storage of my realm that holds it while none is picked, and brings it
// back. With none there we just build. Below params.foodAt units of Food on
// me I get Food up to params.foodTake at params.source, or the nearest
// storage of my realm with Food, and come back; fetching materials tops my
// food up to foodTake too. foodAt 0 turns getting food off.
param site: building // the construction site to join; none: the one I stand on
param source: storage // where materials come from; a carriage too
${FOOD_PARAMS}
${LOG_TEXT}

// Which site I build: the Build order's, else the one picked, else the one I
// started on.
if (memory.building == null) {
  let join = params.site
  if (join == null) { join = buildingAt(me.x, me.y) }
  if (join == null || join.site == null) {
    if (params.site != null) { end("the " + params.site.kind + " is no construction site") }
    else { end("no construction site on their tile") }
    return
  }
  memory.building = join.kind
  memory.at = {x: join.x, y: join.y}
  memory.siteId = join.id
  log("joining the site of " + placeName(join))
}
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
    if (site == null) { log("the site is gone") }
    else { log("the " + site.kind + " is finished") }
    end()
    return
  }
}

// Not there yet, or back from fetching or getting food: walk to the site.
let away = memory.fetch
if (away == null) { away = memory.food }
if (!at) {
  if (away != null && away.walked) { // no way back
    memory.stuck = true
    log("no way back to the site")
  } else {
    walkTo(memory.at.x, memory.at.y)
    if (away != null) { away.walked = true }
  }
  return
}
if (memory.fetch != null) { memory.fetch = null }
if (memory.food != null) { memory.food = null }
if (site != null) {
  // What I carry of what it lacks goes in first.
  let needed = materialsNeeded(site)
  let mine = carriedOf(me, needed)
  if (mine != null) {
    drop({kind: "site", siteId: site.id}, mine)
    let names = []
    for (m of needed) { names[names.length] = m.good }
    log("bringing " + goodsText(mine, names) + " to the site")
    return
  }
}

// Low on Food: get some, then back to the site. With none anywhere, build on.
${GET_FOOD}
if (getFood(params.source, me)) {
  memory.food = {walked: false}
  return
}
if (me.order == null) {
  // Turned down, such as with the tile taken, build says why: done.
  let problem = build(memory.building)
  if (problem != null) {
    log("can't build: " + problem)
    end()
  } else if (memory.siteId == null) {
    log("laying out a " + memory.building + " at " + memory.at.x + "," + memory.at.y)
  }
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
// My own food first, topped up to params.foodTake; then what is missing.
let load = {}
let topUp = foodToTake()
if (topUp > 0) { load.food = topUp }
for (m of missing) { load[m.good] = m.units }
if (fetch(load, from.id) == null) {
  memory.fetch = {storageId: from.id, goods: load}
  log("fetching " + goodsText(load, goods) + " at " + placeName(from))
}
`,
  },
  haul: {
    name: 'Haul',
    source: `// Haul (default): drive params.carriage, or while none is picked the carriage
// on my tile when I start, on a haul route between memory.from and memory.to:
// memory.goods there, memory.returnGoods back, memory.keepFood Food kept on
// board for the horse. The route comes only from the Haul order; started
// without one I end. The built-in haul order loads, drives and unloads, again
// and again; this starts it at memory.from.
param carriage: storage // the carriage to drive; none: the one I stand on
if (memory.to == null) {
  end("no route given")
  return
}

// Which carriage I drive: the one picked, else the one I started on.
if (params.carriage != null) {
  if (params.carriage.kind != null) {
    end("the " + params.carriage.kind + " is no carriage")
    return
  }
  memory.carriageId = params.carriage.id
}
if (memory.carriageId == null) {
  for (c of carriages()) {
    if (c.x == me.x && c.y == me.y) { memory.carriageId = c.id }
  }
  if (memory.carriageId == null) {
    end("no carriage on their tile")
    return
  }
}
if (me.order == null || me.order.kind != "haul") {
  if (me.x == memory.from.x && me.y == memory.from.y) {
    haul(memory.carriageId, memory.to.x, memory.to.y, memory.goods, memory.returnGoods, memory.keepFood)
  }
  return
}

// Each leg of the route as it starts: loading at a stop, or driving to one.
let stop = memory.to
if (me.order.stop == "from") { stop = memory.from }
let leg = me.order.phase + " " + me.order.stop
if (memory.leg != leg) {
  memory.leg = leg
  if (me.order.phase == "loading") { log("loading at " + stop.x + "," + stop.y) }
  else { log("driving to " + stop.x + "," + stop.y) }
}
`,
  },
  tearDown: {
    name: 'Tear down',
    source: `// Tear down (default): tear down params.building, or while none is picked
// the building or site on my tile when I start, kept in memory.buildingId,
// until it is gone; then end. With none I end. Away from it, I walk there
// first. Below params.foodAt units of Food on me I get Food up to
// params.foodTake at params.source, or the nearest storage of my realm with
// Food, and come back. foodAt 0 turns it off.
param building: building // the building or site to tear down; none: the one I stand on
param source: storage // where Food comes from; a carriage too
${FOOD_PARAMS}
${LOG_TEXT}
if (memory.stuck) { return }

// What I tear down: the one picked, else the one I started on.
if (params.building != null) { memory.buildingId = params.building.id }
if (memory.buildingId == null) {
  let here = buildingAt(me.x, me.y)
  if (here == null) {
    end("no building on their tile")
    return
  }
  memory.buildingId = here.id
}
if (memory.walked && me.order != null && me.order.kind == "walkTo") { return } // on my way

// Getting food: on my way, then back to the tile I tear down from.
let away = memory.food
if (away != null) {
  if (me.order != null && me.order.kind != "tearDown") { return } // on my way
  if (me.x != away.x || me.y != away.y) {
    if (away.walked) { // no way back
      memory.stuck = true
      log("no way back to where I tear down")
    } else {
      walkTo(away.x, away.y)
      away.walked = true
    }
    return
  }
  memory.food = null
}

// Low on Food: get some, then back. With none anywhere, tear down on.
${GET_FOOD}
let x = me.x
let y = me.y
if (getFood(params.source, me)) {
  memory.food = {walked: false, x: x, y: y}
  return
}
if (me.order == null || me.order.kind != "tearDown") {
  let problem = tearDown(memory.buildingId)
  // Picked somewhere else: walk there once, then tear it down.
  let target = building(memory.buildingId)
  if (problem == "the resident is not at that building" && target != null && !memory.walked) {
    memory.walked = true
    walkTo(target.x, target.y)
    log("walking to " + placeName(target) + " to tear it down")
    return
  }
  // Turned down, such as with the building gone, tearDown says why: done.
  if (problem != null) {
    log(problem)
    end()
  } else if (target != null) { log("tearing down " + placeName(target)) }
}
`,
  },
  breed: {
    name: 'Breed horses',
    source: `// Breed horses (default): in params.stable, or while none is picked the
// stable I stand in when I start, kept in memory.stableId, tend the two
// horses memory.horseIds until their foal is born; then end. Without a pair
// given, I pick one in the stable: a pair whose breeding it keeps first,
// else two fed horses of my realm in it; with none, or no stable, I end.
// Away from the stable, walk there first. Before starting, take Food for
// the days of tending from the stable, if it has some.
param stable: storage // the stable to breed in; none: the one I stand in
let needFood = ${BREED_FOOD} // Food I take along for my meals while tending
${LOG_TEXT}
if (memory.done == true) { end() }
if (me.order != null && me.order.kind == "breed") {
  memory.started = true
  return
}
if (memory.started == true) {
  // The foal was born, or the breeding stopped: done.
  log("the breeding is over")
  end()
  return
}
if (me.order != null && (me.order.kind == "walkTo" || me.order.kind == "pickUp")) { return }

${PICK_STABLE}
let stable = building(memory.stableId)
if (stable == null) {
  end("the stable is gone")
  return
}

// Which two: those given, else picked once I stand in the stable.
if (memory.horseIds == null) {
  let here = buildingAt(me.x, me.y)
  if ((here == null || here.id != stable.id) && memory.walked != true) {
    memory.walked = true
    walkTo(stable.x, stable.y)
    log("walking to " + placeName(stable))
    return
  }
  let pair = breedingPair(stable)
  if (pair == null) {
    end("no two fed horses here")
    return
  }
  memory.horseIds = pair
}
let food = 0
if (me.carried.food != null) { food = me.carried.food }
if (memory.fed != true && food < needFood) {
  let spot = {kind: "storage", storageId: memory.stableId}
  if (pickUp(spot, {food: needFood - food}) == null) {
    memory.fed = true
    log("taking " + goodsText({food: needFood - food}, ["food"]) + " from the stable")
    return
  }
}
let problem = breed(memory.stableId, memory.horseIds)
if (problem == null) {
  log("breeding two horses in " + placeName(stable))
  return
}
if (problem == "not standing at that stable" && memory.walked != true) {
  memory.walked = true
  walkTo(stable.x, stable.y)
  log("walking to " + placeName(stable))
  return
}
log(problem)
end()
`,
  },
  feedStable: {
    name: 'Feed the stable',
    source: `// Feed the stable (default): keep Food for ${STABLE_FEED_DAYS} game days for the
// horses standing in params.stable, or while none is picked in the stable I
// stand in when I start, kept in memory.stableId; with none, or once it is
// gone, I end. Below that I fetch what is missing from params.source, or
// the nearest storage of my realm with Food while none is picked, and store
// it in the stable; otherwise I wait there.
param stable: storage // the stable to feed; none: the one I stand in
param source: storage // where the Food comes from; a carriage too
let days = ${STABLE_FEED_DAYS} // game days of Food to keep
let perHorse = ${HORSE_FOOD_PER_DAY} // Food a horse eats a game day
let side = ${FOOTPRINT.stable} // tiles along each side of a stable
${LOG_TEXT}

// A line for my log, once until I say something else: waiting stays one line.
fn say(text) {
  if (memory.said != text) { log(text) }
  memory.said = text
}

${PICK_STABLE}

// Where the stable is, kept for when it is out of sight.
let stable = building(memory.stableId)
if (stable != null) { memory.at = {x: stable.x, y: stable.y} }
if (me.order != null) { return } // on my way
if (stable == null) {
  // Out of sight: back to it. There, and it isn't: torn down.
  let at = memory.at
  if (at != null && (me.x != at.x || me.y != at.y) && walkTo(at.x, at.y) == null) { return }
  end("the stable is gone")
  return
}

// Back with Food: what I fetched goes into the stable; my own food stays.
let fetched = memory.fetched
if (fetched != null) {
  memory.fetched = null
  let got = 0
  if (me.carried.food != null) { got = me.carried.food - fetched.before }
  got = got - got % 1
  if (got > 0 && store({food: got}, stable.id) == null) {
    say("storing " + goodsText({food: got}, ["food"]) + " in the stable")
    return
  }
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
      say("stable low (" + (held - held % 1) + "): fetching " + units + " Food at " + placeName(from))
      return
    }
  }
  say("stable low (" + (held - held % 1) + "): no Food to fetch, waiting")
} else { say("enough Food in the stable: waiting") }

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
