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
  CREW_FOOD,
  DEFEND_CALM_TICKS,
  GET_FOOD_AT,
  GET_FOOD_TAKE,
  HORSE_FOOD_PER_DAY,
  STABLE_FEED_DAYS,
  WORK_FOOD_KEPT,
} from './balance.js'
import type { BuildLine } from './building.js'
import { FOOTPRINT } from './footprint.js'

/**
 * The tasks that run a default script. Defend is never given: being struck starts it
 * (`CONTEXT.md`: Defence script).
 */
export const TASKS = [
  'work',
  'build',
  'haul',
  'tearDown',
  'breed',
  'feedStable',
  'defend',
  'train',
  'buildLine',
] as const
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
  train: 'ground',
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
   * Build line: the line, road or wall between two picked tiles (`CONTEXT.md`: Build line). It
   * comes only from here, like Haul's route, so the default started without it ends. Residents
   * given the same line keep the same `line`, so `withMemory("line", memory.line)` finds them.
   */
  buildLine: { line: BuildLine }
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
  /**
   * Train: the training ground the resident stood on when given it, in the param `ground` too
   * (`TARGET_PARAMS`), and the `subject` to learn there, if one was asked for: the default ends
   * if the ground teaches something else.
   */
  train: { groundId: string; subject?: string }
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
      text = text + floor(n) + " " + g
    }
  }
  return text
}`

/**
 * Getting food (`CONTEXT.md`: Getting food), shared by the Work, Build and Tear down defaults,
 * which declare the number params `foodAt` and `foodTake` with defaults (`FOOD_PARAMS`).
 * `getFoodIfLow(from, near)` fetches Food below `foodAt` units on me, up to `foodTake`, at
 * `from` while it holds Food, else at the nearest storage of my realm with Food from `near`;
 * true once I set off, which it logs (it needs `LOG_TEXT`). `foodToTake()` is the Food that
 * tops me up to `foodTake`.
 */
const FOOD_PARAMS = `param foodAt: number = ${GET_FOOD_AT} // get Food below this many units on me; 0 never
param foodTake: number = ${GET_FOOD_TAKE} // units of Food to take along`

const GET_FOOD = `// Getting food: below params.foodAt units of Food on me, fetch Food up to
// params.foodTake at from while it holds Food, else at the nearest storage of
// my realm with Food from near. True once I set off, which I log; I wait
// until I have it.
fn getFoodIfLow(from, near) {
  let food = me.carried.food
  if (food == null) { food = 0 }
  if (food >= params.foodAt) { return false }
  let units = floor(params.foodTake - food) // fetch takes whole units
  if (units < 1) { return false }
  let at = from
  if (at == null || !holdsFood(at)) {
    at = null
    let stores = storages(near, ["food"]) // nearest first, holding some
    if (stores.length > 0) { at = stores[0] }
  }
  if (at == null || fetch({food: units}, at.id) != null) { return false }
  wait() // until I have it
  log("low on Food (" + floor(food) + "): fetching " + units + " at " + placeName(at))
  return true
}

// Whether a storage, or a carriage, holds a whole unit of Food to fetch.
fn holdsFood(at) {
  let held = at.stock
  if (held == null) { held = at.load } // a carriage
  return held != null && held.food != null && held.food >= 1
}

// The Food that tops me up to params.foodTake, in whole units.
fn foodToTake() {
  let food = me.carried.food
  if (food == null) { food = 0 }
  let units = floor(params.foodTake - food)
  if (units < 1) { return 0 }
  return units
}`

/**
 * Which stable the Breed horses and Feed the stable defaults work in (`CONTEXT.md`: Default
 * script, Started directly), both declaring `param stable: storage`. `pickStable()` takes the one
 * picked, else the one the resident stands in when it starts, kept in `memory.stableId`; with
 * none there, the script ends and it is false.
 */
const PICK_STABLE = `// Which stable: the one picked, else the one I started in, kept in
// memory.stableId. False once I end: neither is a stable.
fn pickStable() {
  if (params.stable != null) {
    if (params.stable.kind != "stable") {
      end("the one picked is no stable")
      return false
    }
    memory.stableId = params.stable.id
  }
  if (memory.stableId == null) {
    let here = buildingAt(me.x, me.y)
    if (here == null || here.kind != "stable" || here.site != null) {
      end("no stable here")
      return false
    }
    memory.stableId = here.id
  }
  return true
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
// picked, brings back the Food the pile lacks of params.crewFood for the
// crew's meals (none to a farm, whose pile keeps its own; crewFood 0 brings
// none) and comes back. At a smithy, memory.makes says what to make. Meals
// come from the workplace's pile on their own, without an order. Below
// params.foodAt units of Food on me, while the pile holds none, I get Food
// up to params.foodTake at params.storage, or the nearest storage of my
// realm with Food, and come back; storing a load tops my food up to foodTake
// too. foodAt 0 turns getting food off. At the workplace we stand spread over
// its footprint.
param workplace: building // the workplace to work; none: the one I stand on
param storage: storage // where the output goes
${FOOD_PARAMS}
param crewFood: number = ${CREW_FOOD} // Food the pile keeps for the crew's meals; 0 none
let keepFood = ${WORK_FOOD_KEPT} // Food a farm's pile keeps for our refills

if (!pickWorkplace()) { return }
let workplace = building(memory.workplaceId)
// Where I stand at it: the footprint tile with the fewest of us (Spreading
// over the footprint), picked when I set out and again whenever I stand idle
// there; kept while I hold my order or am away, so I neither drift nor lose
// my spot. One picked out of sight is where I last saw it, until I see it.
// Already at work there, I keep the tile I stand on.
if (memory.at == null && me.order != null && me.order.kind == "workAt") {
  memory.at = {x: me.x, y: me.y}
} else if (me.order == null && workplace != null && memory.carry == null && memory.food == null) {
  memory.at = crewTile(workplace)
}
if (memory.at == null && params.workplace != null) {
  memory.at = {x: params.workplace.x, y: params.workplace.y}
}
if (memory.at == null || memory.stuck) { return }
if (me.order != null && me.order.kind != "workAt") { // on my way
  wait()
  return
}

if (storeLoad()) { return }
if (walkBack()) { return }
if (workplace == null) { // here, and it isn't: torn down
  end("the workplace is gone")
  return
}
// With Food on the pile my meals come from there; with none anywhere, I work on.
let food = me.carried.food
if (food == null) { food = 0 }
if (food < params.foodAt && !pileHoldsFood(workplace) && getFoodIfLow(params.storage, workplace)) {
  memory.food = {walked: false}
  return
}
if (me.order == null) {
  if (workAt(memory.makes) != null && heldBySomeoneElse(workplace)) {
    end("the " + workplace.kind + " is held by someone else")
  }
  return
}
carryLoadOffIfFull(workplace)

// Which workplace I work: the one picked, else the one I started on, kept in
// memory.workplaceId. False once I end: neither is a workplace.
fn pickWorkplace() {
  if (params.workplace != null) {
    if (!isWorkplace(params.workplace)) {
      end("the " + params.workplace.kind + " is no workplace")
      return false
    }
    memory.workplaceId = params.workplace.id
  }
  if (memory.workplaceId == null) {
    let here = buildingAt(me.x, me.y)
    if (!isWorkplace(here)) {
      end("no workplace on their tile")
      return false
    }
    memory.workplaceId = here.id
  }
  return true
}

// A finished building that makes goods.
fn isWorkplace(b) {
  return b != null && b.site == null && outputOf(b).length > 0
}

// Whether residents of another realm work it, so it has no room for me.
fn heldBySomeoneElse(workplace) {
  for (r of residents()) {
    let o = r.order
    if (r.owner != me.owner && o != null && o.kind == "workAt" && o.buildingId == workplace.id) {
      return true
    }
  }
  return false
}

// With a load picked up: store it, keeping my own food, then bring the
// crew's Food. True once I set off. Logged now, not when picking it up: that
// tick is our dearest already.
fn storeLoad() {
  let carry = memory.carry
  if (carry == null) { return false }
  if (carry.stored) { return bringCrewFood(carry) }
  carry.stored = true
  if (store(carry.goods, carry.storageId, params.foodTake) != null) {
    carry.crewFood = 0 // not storing: no crew food either
    return false
  }
  wait() // until it is stored
  let to = building(carry.storageId)
  if (carry.load != null && to != null) {
    log("pile full: carrying " + goodsText(carry.load, carry.goods) + " to " + placeName(to))
  }
  return true
}

// Crew food: with the load stored, I fetch the Food the pile lacks
// (carry.crewFood) at the same storage before I walk back, once, as much as
// fits. True once I set off, which I log.
fn bringCrewFood(carry) {
  if (carry.fetched) { return false }
  carry.fetched = true
  let units = carry.crewFood
  if (units == null || units < 1) { return false }
  let fit = fits("food")
  if (units > fit) { units = fit }
  if (units < 1) { return false }
  if (fetch({food: units}, carry.storageId) != null) { return false }
  let from = building(carry.storageId)
  let where = "the storage"
  if (from != null) { where = placeName(from) }
  log("fetching " + units + " Food for the crew at " + where)
  return true
}

// Back with the crew's Food: I put it on the pile, keeping my own food up to
// params.foodTake, once. True once I drop it, which I log.
fn dropCrewFood() {
  let carry = memory.carry
  if (carry == null || !carry.fetched || carry.dropped) { return false }
  carry.dropped = true
  let food = me.carried.food
  if (food == null) { return false }
  let units = floor(food - params.foodTake)
  if (units > carry.crewFood) { units = carry.crewFood }
  if (units < 1) { return false }
  if (drop({kind: "ground"}, {food: units}) != null) { return false }
  log("put " + units + " Food on the pile for the crew")
  return true
}

// Away carrying a load off or getting food: walk back to the workplace, once;
// with no way back I stay put. True until I am there.
fn walkBack() {
  if (me.x == memory.at.x && me.y == memory.at.y) {
    if (dropCrewFood()) { return true }
    if (memory.carry != null) { memory.carry = null }
    if (memory.food != null) { memory.food = null }
    return false
  }
  let away = memory.carry
  if (away == null) { away = memory.food }
  if (away != null && away.walked) {
    memory.stuck = true
    log("no way back to the workplace")
  } else {
    if (walkTo(memory.at.x, memory.at.y) == null) { wait() } // until I am there
    if (away != null) { away.walked = true }
  }
  return true
}

// Once the pile holds a full load, one of us carries it off to params.storage,
// or the nearest storage of my realm while none is picked.
fn carryLoadOffIfFull(workplace) {
  let found = fullLoad(workplace)
  if (found == null) { return }
  let to = params.storage
  if (to == null) {
    let stores = storages(workplace) // nearest first
    if (stores.length == 0) { return } // none in reach: the pile grows
    to = stores[0]
  }
  if (pickCarrier(workplace) != me.id) { return }
  pickUp({kind: "ground"}, found.load)
  memory.carry = {
    storageId: to.id, goods: found.goods, load: found.load,
    crewFood: crewFoodToBring(workplace, found.goods),
  }
}

// The Food the pile lacks of params.crewFood, which I bring back for the
// crew's meals; none with a load of Food (a farm's), whose pile keeps its own.
fn crewFoodToBring(workplace, goods) {
  if (params.crewFood < 1) { return 0 }
  for (good of goods) {
    if (good == "food") { return 0 }
  }
  let pile = pileAt(workplace.x, workplace.y)
  let held = 0
  if (pile != null && pile.food != null) { held = pile.food }
  let units = floor(params.crewFood - held)
  if (units < 1) { return 0 }
  return units
}

// Whether the workplace's pile holds Food, where my meals come from on their
// own (no need to go for Food).
fn pileHoldsFood(workplace) {
  let pile = pileAt(workplace.x, workplace.y)
  return pile != null && pile.food != null && pile.food > 0
}

// What the pile holds of the workplace's goods, as {goods, load}, once one of
// them makes a full load; else null. A farm's pile keeps keepFood for refills.
fn fullLoad(workplace) {
  let pile = pileAt(workplace.x, workplace.y)
  let load = {}
  let goods = []
  let full = false
  for (good of outputOf(workplace)) {
    let units = 0
    if (pile != null && pile[good] != null) { units = pile[good] }
    if (good == "food") { units = units - keepFood }
    if (units > 0) {
      load[good] = units
      goods[goods.length] = good
      let fit = fits(good)
      if (fit > 0 && units >= fit) { full = true }
    }
  }
  if (!full) { return null }
  return {goods: goods, load: load}
}

// Who carries the load: one of us at work here, picked at random, so we all
// pick the same one. Null while one of us carries a load already.
fn pickCarrier(workplace) {
  let workers = []
  for (r of withMemory("workplaceId", workplace.id)) {
    if (r.script.memory.carry != null) { return null }
    if (r.order != null && r.order.kind == "workAt") { workers[workers.length] = r }
  }
  let carrier = pickRandom(workers)
  if (carrier == null) { return null }
  return carrier.id
}

${GET_FOOD}

${LOG_TEXT}
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
// food up to foodTake too. foodAt 0 turns getting food off. At the site we
// stand spread over its footprint.
param site: building // the construction site to join; none: the one I stand on
param source: storage // where materials come from; a carriage too
${FOOD_PARAMS}

if (!pickSite()) { return }
if (memory.stuck) { return }
if (me.order != null && me.order.kind != "build") { // on my way
  wait()
  return
}

let site = null
if (memory.siteId != null) { site = building(memory.siteId) }
if (endIfDone(site)) { return }
spreadOut(site)
if (walkBack()) { return }
if (site != null && bringCarried(site)) { return }
// With no Food anywhere, I build on.
if (getFoodIfLow(params.source, me)) {
  memory.food = {walked: false}
  return
}
if (me.order == null) {
  startBuilding()
  return
}
if (me.order.siteId == null) { return } // laid out at the end of the tick
memory.siteId = me.order.siteId
if (site != null) { fetchMissing(site) }

// Which site I build: the Build order's, else the one picked, else the one I
// started on. False once I end: neither is a construction site.
fn pickSite() {
  if (memory.building != null) { return true }
  let join = params.site
  if (join == null) { join = buildingAt(me.x, me.y) }
  if (join == null || join.site == null) {
    if (params.site != null) { end("the " + params.site.kind + " is no construction site") }
    else { end("no construction site on their tile") }
    return false
  }
  memory.building = join.kind
  memory.at = crewTile(join)
  memory.siteId = join.id
  log("joining the site of " + placeName(join))
  return true
}

// At the site once it is laid out: finished or gone, building is done. True
// once I end.
fn endIfDone(site) {
  if (memory.siteId == null) { return false }
  if (me.x != memory.at.x || me.y != memory.at.y) { return false }
  if (site != null && site.site != null) { return false }
  if (site == null) { log("the site is gone") }
  else { log("the " + site.kind + " is finished") }
  end()
  return true
}

// Where I stand at the site: the footprint tile with the fewest of us
// (Spreading over the footprint), picked whenever I stand idle and not away;
// a site another of us laid out at memory.at counts too. Laying out a new
// site keeps the picked tile.
fn spreadOut(site) {
  if (me.order != null || memory.fetch != null || memory.food != null) { return }
  if (site == null) { site = buildingAt(memory.at.x, memory.at.y) }
  if (site != null && site.site != null && site.kind == memory.building) {
    memory.at = crewTile(site)
  }
}

// Not there yet, or away fetching or getting food: walk to the site, once;
// with no way back I stay put. True until I am there.
fn walkBack() {
  if (me.x == memory.at.x && me.y == memory.at.y) {
    if (memory.fetch != null) { memory.fetch = null }
    if (memory.food != null) { memory.food = null }
    return false
  }
  let away = memory.fetch
  if (away == null) { away = memory.food }
  if (away != null && away.walked) {
    memory.stuck = true
    log("no way back to the site")
  } else {
    if (walkTo(memory.at.x, memory.at.y) == null) { wait() } // until I am there
    if (away != null) { away.walked = true }
  }
  return true
}

// What I carry of what the site lacks goes in first. True once I drop it.
fn bringCarried(site) {
  let needed = materialsNeeded(site)
  let mine = carriedOf(me, needed)
  if (mine == null) { return false }
  drop({kind: "site", siteId: site.id}, mine)
  log("bringing " + goodsText(mine, goodsOf(needed)) + " to the site")
  return true
}

// Laying out the site, or joining it. Turned down, such as with the tile
// taken, build says why: done.
fn startBuilding() {
  let problem = build(memory.building)
  if (problem != null) {
    log("can't build: " + problem)
    end()
  } else if (memory.siteId == null) {
    log("laying out a " + memory.building + " at " + memory.at.x + "," + memory.at.y)
  }
}

// While the site lacks materials, one of us fetches them, picked at random:
// my own food first, topped up to params.foodTake; then what is missing.
fn fetchMissing(site) {
  let missing = materialsNeeded(site)
  if (missing.length == 0) { return }
  let goods = goodsOf(missing)
  let from = materialsFrom(site, goods)
  if (from == null) { return } // none in storage: we just build
  if (pickFetcher(site, missing) != me.id) { return }
  let load = {}
  let topUp = foodToTake()
  if (topUp > 0) { load.food = topUp }
  for (m of missing) { load[m.good] = m.units }
  if (fetch(load, from.id) == null) {
    wait() // until I have it
    memory.fetch = {storageId: from.id, goods: load}
    log("fetching " + goodsText(load, goods) + " at " + placeName(from))
  }
}

// Where materials come from: params.source while it holds some of goods,
// else, while none is picked, the nearest storage of my realm holding some.
fn materialsFrom(site, goods) {
  let from = params.source
  if (from == null) {
    let stores = storages(site, goods) // nearest first, holding some
    if (stores.length == 0) { return null }
    return stores[0]
  }
  let held = from.stock
  if (held == null) { held = from.load } // a carriage
  if (held == null) { return null }
  for (g of goods) {
    if (held[g] != null && held[g] > 0) { return from }
  }
  return null
}

// Who fetches: one of us building the site, picked at random, so we all pick
// the same one. Null while one of us fetches, or brings some, already.
fn pickFetcher(site, missing) {
  let builders = []
  for (r of withMemory("siteId", site.id)) {
    if (r.script.memory.fetch != null) { return null }
    if (carriedOf(r, missing) != null) { return null }
    if (r.order != null && r.order.kind == "build") { builders[builders.length] = r }
  }
  let fetcher = pickRandom(builders)
  if (fetcher == null) { return null }
  return fetcher.id
}

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

// The goods of what the site lacks.
fn goodsOf(missing) {
  let goods = []
  for (m of missing) { goods[goods.length] = m.good }
  return goods
}

${GET_FOOD}

${LOG_TEXT}
`,
  },
  buildLine: {
    name: 'Build line',
    source: `// Build line (default): build memory.line.building, road or wall, on each
// tile of the line from memory.line.from to memory.line.to, straight or
// diagonal, as the Build line order gives it; started without one I end.
// Tiles that have one already, or can't take one, are skipped. I take the
// nearest tile still to build, walk there, lay out its site or join the one
// there, and build it. What I carry goes in first; lacking some, I fetch
// from params.source, or the nearest storage of my realm holding them while
// none is picked, as much as I can carry for this tile and the next ones,
// topping my food up to params.foodTake there. With none in any storage I
// lay out each tile's site and go on to the next; once all are laid out I
// end, saying why. Below params.foodAt units of Food on me I get Food up to
// params.foodTake at params.source, or the nearest storage of my realm with
// Food, and come back. foodAt 0 turns getting food off.
param source: storage // where materials come from; a carriage too
${FOOD_PARAMS}

if (memory.line == null) {
  end("no line given")
  return
}
if (me.order != null && me.order.kind != "build") { // on my way
  wait()
  return
}

let tiles = lineTiles(memory.line, me) // nearest first
if (me.order == null) {
  let tile = pickTile(tiles)
  if (tile == null) {
    endLine(tiles)
    return
  }
  if (walkThere(tile)) { return }
  // With no Food anywhere, I build on.
  if (getFoodIfLow(params.source, me)) { return }
  startBuilding(tile)
  return
}
if (me.order.siteId == null) { return } // laid out at the end of the tick
let site = building(me.order.siteId)
if (site == null || bringCarried(site)) { return }
if (getFoodIfLow(params.source, me)) { return }
fetchMissing(site, tiles)

// The tile I build next, kept in memory.at: the nearest still to build, and
// while no storage holds materials the nearest not laid out yet. Null once
// there is none.
fn pickTile(tiles) {
  for (t of tiles) {
    if (memory.noStock == null || t.siteId == null) {
      memory.at = {x: t.x, y: t.y}
      return t
    }
  }
  memory.at = null
  return null
}

// No tile left to take: the line is built, or every tile left is laid out
// and still no storage holds materials. With some there again, I go on.
fn endLine(tiles) {
  if (tiles.length == 0) {
    log("the " + memory.line.building + " line is finished")
    end()
  } else if (materialsFrom(me, memory.noStock) != null) {
    log("there is " + goodsNames(memory.noStock) + " again: building the laid-out sites")
    memory.noStock = null
  } else {
    end("no " + goodsNames(memory.noStock) + " in any storage")
  }
}

// Not on the tile yet: walk there, once. True until I am there; with no way
// there I end.
fn walkThere(tile) {
  if (me.x == tile.x && me.y == tile.y) {
    memory.walkedTo = null
    return false
  }
  let walked = memory.walkedTo
  if (walked != null && walked.x == tile.x && walked.y == tile.y) {
    end("no way to " + tile.x + "," + tile.y)
    return true
  }
  memory.walkedTo = {x: tile.x, y: tile.y}
  let problem = walkTo(tile.x, tile.y)
  if (problem == null) { wait() } // until I am there
  else { end("can't walk to " + tile.x + "," + tile.y + ": " + problem) }
  return true
}

// Laying out the tile's site, or joining the one there. Turned down, I end
// saying why.
fn startBuilding(tile) {
  let problem = build(memory.line.building)
  if (problem != null) {
    end("can't build at " + tile.x + "," + tile.y + ": " + problem)
  } else if (tile.siteId == null) {
    log("laying out a " + memory.line.building + " at " + tile.x + "," + tile.y)
  }
}

// What I carry of what the site lacks goes in first. True once I drop it.
fn bringCarried(site) {
  let needed = materialsNeeded(site)
  let mine = carriedOf(me, needed)
  if (mine == null) { return false }
  drop({kind: "site", siteId: site.id}, mine)
  log("bringing " + goodsText(mine, goodsOf(needed)) + " to the site")
  return true
}

// Lacking materials for my tile: fetch them from params.source, or the
// nearest storage holding them, for this tile and the next ones, as much as
// I can carry, with my food topped up to params.foodTake. With none in any
// storage I leave the site laid out and go on to the next tile.
fn fetchMissing(site, tiles) {
  let missing = materialsNeeded(site)
  if (missing.length == 0) { return }
  let goods = goodsOf(missing)
  let from = materialsFrom(site, goods)
  if (from == null) {
    if (memory.noStock == null) {
      log("no " + goodsNames(goods) + " in any storage: laying out the rest of the line")
    }
    memory.noStock = goods
    stop()
    return
  }
  memory.noStock = null
  let load = {}
  let topUp = foodToTake()
  if (topUp > 0) { load.food = topUp }
  let more = tiles.length - 1 // the next tiles still to build
  for (m of missing) {
    let perTile = m.units // what a tile takes: what this one lacks and has
    let had = site.site.delivered[m.good]
    if (had != null) { perTile = perTile + had }
    let units = m.units + perTile * more
    let room = fits(m.good)
    if (units > room) { units = room }
    load[m.good] = units
  }
  if (fetch(load, from.id) == null) {
    wait() // until I have it
    log("fetching " + goodsText(load, goods) + " at " + placeName(from))
  }
}

// Where materials come from: params.source while it holds some of goods,
// else, while none is picked, the nearest storage of my realm holding some.
fn materialsFrom(near, goods) {
  let from = params.source
  if (from == null) {
    let stores = storages(near, goods) // nearest first, holding some
    if (stores.length == 0) { return null }
    return stores[0]
  }
  let held = from.stock
  if (held == null) { held = from.load } // a carriage
  if (held == null) { return null }
  for (g of goods) {
    if (held[g] != null && held[g] > 0) { return from }
  }
  return null
}

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

// The goods of what the site lacks.
fn goodsOf(missing) {
  let goods = []
  for (m of missing) { goods[goods.length] = m.good }
  return goods
}

// Goods by name for my log: "stone", or "wood and stone".
fn goodsNames(goods) {
  let text = ""
  for (g of goods) {
    if (text != "") { text = text + " and " }
    text = text + g
  }
  return text
}

${GET_FOOD}

${LOG_TEXT}
`,
  },
  haul: {
    name: 'Haul',
    source: `// Haul (default): drive params.carriage, or while none is picked the carriage
// on my tile when I start, on a haul route between memory.from and memory.to:
// memory.goods there, memory.returnGoods back, memory.keepFood Food kept on
// board for the horse and me. The route comes only from the Haul order; started
// without one I end. The built-in haul order loads, drives and unloads, again
// and again; this starts it at memory.from.
param carriage: storage // the carriage to drive; none: the one I stand on

if (memory.to == null) {
  end("no route given")
  return
}
if (!pickCarriage()) { return }
if (me.order == null || me.order.kind != "haul") {
  startRoute()
  return
}
logLeg()

// Which carriage I drive: the one picked, else the one I started on. False
// once I end: neither is a carriage.
fn pickCarriage() {
  if (params.carriage != null) {
    if (params.carriage.kind != null) {
      end("the " + params.carriage.kind + " is no carriage")
      return false
    }
    memory.carriageId = params.carriage.id
  }
  if (memory.carriageId == null) {
    for (c of carriages()) {
      if (c.x == me.x && c.y == me.y) { memory.carriageId = c.id }
    }
    if (memory.carriageId == null) {
      end("no carriage on their tile")
      return false
    }
  }
  return true
}

// The haul order, once I stand at memory.from.
fn startRoute() {
  if (me.x != memory.from.x || me.y != memory.from.y) { return }
  haul(memory.carriageId, memory.to.x, memory.to.y, memory.goods, memory.returnGoods, memory.keepFood)
}

// Each leg of the route as it starts, for my log: loading at a stop, or
// driving to one.
fn logLeg() {
  let leg = me.order.phase + " " + me.order.stop
  if (memory.leg == leg) { return }
  memory.leg = leg
  let stop = memory.to
  if (me.order.stop == "from") { stop = memory.from }
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

if (memory.stuck) { return }
if (!pickBuilding()) { return }
if (memory.walked && me.order != null && me.order.kind == "walkTo") { // on my way
  wait()
  return
}
if (walkBack()) { return }
// With no Food anywhere, I tear down on.
let x = me.x
let y = me.y
if (getFoodIfLow(params.source, me)) {
  memory.food = {walked: false, x: x, y: y}
  return
}
if (me.order == null || me.order.kind != "tearDown") { startTearingDown() }

// What I tear down: the one picked, else the one I started on, kept in
// memory.buildingId. False once I end: there is none.
fn pickBuilding() {
  if (params.building != null) { memory.buildingId = params.building.id }
  if (memory.buildingId == null) {
    let here = buildingAt(me.x, me.y)
    if (here == null) {
      end("no building on their tile")
      return false
    }
    memory.buildingId = here.id
  }
  return true
}

// Away getting food: walk back to the tile I tear down from, once; with no
// way back I stay put. True until I am there.
fn walkBack() {
  let away = memory.food
  if (away == null) { return false }
  if (me.order != null && me.order.kind != "tearDown") { // on my way
    wait()
    return true
  }
  if (me.x == away.x && me.y == away.y) {
    memory.food = null
    return false
  }
  if (away.walked) {
    memory.stuck = true
    log("no way back to where I tear down")
  } else {
    if (walkTo(away.x, away.y) == null) { wait() } // until I am there
    away.walked = true
  }
  return true
}

// Tearing it down; picked somewhere else, I walk there once first. Turned
// down, such as with the building gone, tearDown says why: done.
fn startTearingDown() {
  let problem = tearDown(memory.buildingId)
  let target = building(memory.buildingId)
  if (target == null) { target = params.building } // picked out of sight: as last seen
  if (problem == "the resident is not at that building" && target != null && !memory.walked) {
    memory.walked = true
    if (walkTo(target.x, target.y) == null) { wait() } // until I am there
    log("walking to " + placeName(target) + " to tear it down")
    return
  }
  if (problem != null) {
    log(problem)
    end()
  } else if (target != null) { log("tearing down " + placeName(target)) }
}

${GET_FOOD}

${LOG_TEXT}
`,
  },
  breed: {
    name: 'Breed horses',
    source: `// Breed horses (default): in params.stable, or while none is picked the
// stable I stand in when I start, kept in memory.stableId, tend the two
// horses memory.horseIds until their foal is born; then end. Without a pair
// given, I pick one in the stable: a pair whose breeding it keeps first,
// else two fed horses of my realm in it; with none, or no stable, I end.
// Away from the stable, walk there first; at it we stand spread over its
// footprint. Before starting, take Food for the days of tending from the
// stable, if it has some.
param stable: storage // the stable to breed in; none: the one I stand in
let needFood = ${BREED_FOOD} // Food I take along for my meals while tending

if (memory.done == true) { end() }
if (me.order != null && me.order.kind == "breed") {
  memory.started = true
  wait() // until the foal is born or the breeding stops
  return
}
if (memory.started == true) {
  // The foal was born, or the breeding stopped: done.
  log("the breeding is over")
  end()
  return
}
if (me.order != null && (me.order.kind == "walkTo" || me.order.kind == "pickUp")) {
  wait()
  return
}
if (!pickStable()) { return }
let stable = building(memory.stableId)
if (stable == null) {
  end("the stable is gone")
  return
}
if (!pickPair(stable)) { return }
if (takeFood()) { return }
if (walkToStable(stable)) { return }
startBreeding(stable)

// Which two: those given, else picked once I stand in the stable. False while
// I walk there, or once I end: there are no two to pick.
fn pickPair(stable) {
  if (memory.horseIds != null) { return true }
  let here = buildingAt(me.x, me.y)
  if ((here == null || here.id != stable.id) && walkToStable(stable)) { return false }
  let pair = breedingPair(stable)
  if (pair == null) {
    end("no two fed horses here")
    return false
  }
  memory.horseIds = pair
  return true
}

// Food for the days of tending, taken from the stable once, if it has some.
// True once I take it.
fn takeFood() {
  if (memory.fed == true) { return false }
  let food = me.carried.food
  if (food == null) { food = 0 }
  if (food >= needFood) { return false }
  let units = needFood - food
  let spot = {kind: "storage", storageId: memory.stableId}
  if (pickUp(spot, {food: units}) != null) { return false }
  memory.fed = true
  log("taking " + goodsText({food: units}, ["food"]) + " from the stable")
  return true
}

// Breeding the two; away from the stable, I walk there once first. Turned
// down, breed says why: done.
fn startBreeding(stable) {
  let problem = breed(memory.stableId, memory.horseIds)
  if (problem == null) {
    log("breeding two horses in " + placeName(stable))
    return
  }
  if (problem == "not standing at that stable" && walkToStable(stable)) { return }
  log(problem)
  end()
}

// Where I stand at it: the footprint tile with the fewest of us (Spreading
// over the footprint), the nearest on ties. I walk there once, kept as
// memory.at; still away from it after that, breed says why. True while I
// set out.
fn walkToStable(stable) {
  if (memory.walked == true) { return false }
  let at = crewTile(stable)
  if (me.x == at.x && me.y == at.y) { return false }
  memory.walked = true
  memory.at = at
  if (walkTo(at.x, at.y) == null) { wait() } // until I am there
  log("walking to " + placeName(stable))
  return true
}

${PICK_STABLE}

${LOG_TEXT}
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

if (!pickStable()) { return }
let stable = building(memory.stableId)
// Kept for when it is out of sight.
if (stable != null) { memory.at = {x: stable.x, y: stable.y} }
if (me.order != null) { // on my way
  wait()
  return
}
if (stable == null) {
  walkBackOrEnd()
  return
}
if (storeFetched(stable)) { return }
if (fetchIfLow(stable)) { return }
// Enough, or none to fetch: wait at the stable.
if (!inStable(stable, me) && walkTo(stable.x, stable.y) == null) { wait() }

// Out of sight: back to it. There, and it isn't, it is torn down: I end.
fn walkBackOrEnd() {
  let at = memory.at
  if (at != null && (me.x != at.x || me.y != at.y) && walkTo(at.x, at.y) == null) {
    wait() // until I am there
    return
  }
  end("the stable is gone")
}

// Back with Food: what I fetched goes into the stable; my own food stays.
// True once I store it.
fn storeFetched(stable) {
  let fetched = memory.fetched
  if (fetched == null) { return false }
  memory.fetched = null
  let food = me.carried.food
  if (food == null) { return false }
  let got = floor(food - fetched.before)
  if (got < 1 || store({food: got}, stable.id) != null) { return false }
  wait() // until it is stored
  say("storing " + goodsText({food: got}, ["food"]) + " in the stable")
  return true
}

// Below the Food to keep for the horses in it now: fetch what is missing.
// True once I set off.
fn fetchIfLow(stable) {
  let held = 0
  if (stable.stock != null && stable.stock.food != null) { held = stable.stock.food }
  let need = horsesIn(stable) * days * perHorse - held
  if (need <= 0) {
    say("enough Food in the stable: waiting")
    return false
  }
  let from = foodFrom(stable)
  if (from != null) {
    let units = floor(need)
    if (units < need) { units = units + 1 } // whole units, rounded up
    let before = me.carried.food
    if (before == null) { before = 0 }
    if (fetch({food: units}, from.id) == null) {
      wait() // until I have it
      memory.fetched = {before: before}
      say("stable low (" + floor(held) + "): fetching " + units + " Food at " + placeName(from))
      return true
    }
  }
  say("stable low (" + floor(held) + "): no Food to fetch, waiting")
  return false
}

// Where the Food comes from: params.source, else the nearest storage of my
// realm with Food; null unless it holds a whole unit, or if it is the stable.
fn foodFrom(stable) {
  let from = params.source
  if (from == null) {
    let stores = storages(stable, ["food"]) // nearest first, holding some
    if (stores.length == 0) { return null }
    from = stores[0]
  }
  let held = from.stock
  if (held == null) { held = from.load } // a carriage
  if (from.id == stable.id || held == null || held.food == null || held.food < 1) { return null }
  return from
}

// The horses standing in the stable.
fn horsesIn(stable) {
  let n = 0
  for (h of horses()) {
    if (inStable(stable, h)) { n = n + 1 }
  }
  return n
}

// Whether something with x and y stands on the stable's footprint.
fn inStable(stable, t) {
  let dx = (t.x - stable.x + mapSize) % mapSize
  let dy = (t.y - stable.y + mapSize) % mapSize
  return dx < side && dy < side
}

// A line for my log, once until I say something else: waiting stays one line.
fn say(text) {
  if (memory.said != text) { log(text) }
  memory.said = text
}

${PICK_STABLE}

${LOG_TEXT}
`,
  },
  train: {
    name: 'Train',
    source: `// Train (default): train at params.ground, or while none is picked the
// training ground I stand on when I start, kept in memory.groundId; with
// none, or once it is gone, I end. Away from it I walk there first. With
// memory.subject set, I end once the ground teaches something else. While
// no teacher is there, or I have learned all the teacher can teach me, I
// wait there. Meals come from the ground's pile on their own, without an
// order. Below params.foodAt units of Food on me I get Food up to
// params.foodTake at the nearest storage of my realm with Food, and come
// back. foodAt 0 turns getting food off.
param ground: building // the training ground; none: the one I stand on
${FOOD_PARAMS}

if (!pickGround()) { return }
let ground = building(memory.groundId)
// Kept for when it is out of sight.
if (ground != null) { memory.at = {x: ground.x, y: ground.y} }
if (memory.at == null && params.ground != null) {
  memory.at = {x: params.ground.x, y: params.ground.y}
}
if (memory.at == null || memory.stuck) { return }
if (me.order != null && me.order.kind != "train") { return } // on my way

if (walkBack()) { return }
if (ground == null) { // here, and it isn't: torn down
  end("the training ground is gone")
  return
}
if (memory.subject != null && ground.subject != null && ground.subject != memory.subject) {
  end("the ground teaches " + ground.subject + ", not " + memory.subject)
  return
}
// With no Food anywhere, I train on.
if (getFoodIfLow(null, ground)) { return }
if (me.order == null) {
  let problem = train()
  if (problem != null) { end(problem) }
  return
}
if (ground.teacher == null) { doing("Waiting for a teacher") }
else if (me.order.learning == null) { doing("Waiting: learned all I can here") }
else { doing(null) } // the order says what I learn

// Which ground I train at: the one picked, else the one I started on, kept in
// memory.groundId. False once I end: neither is a training ground.
fn pickGround() {
  if (params.ground != null) {
    if (!isGround(params.ground)) {
      end("the " + params.ground.kind + " is no training ground")
      return false
    }
    memory.groundId = params.ground.id
  }
  if (memory.groundId == null) {
    let here = buildingAt(me.x, me.y)
    if (!isGround(here)) {
      end("no training ground on their tile")
      return false
    }
    memory.groundId = here.id
  }
  return true
}

// A finished training ground.
fn isGround(b) {
  return b != null && b.kind == "trainingGround" && b.site == null
}

// Off the ground (not there yet, or back from getting food): walk to it,
// once; with no way there I stay put. True until I am on it.
fn walkBack() {
  let here = buildingAt(me.x, me.y)
  if (here != null && here.id == memory.groundId) {
    if (memory.walked != null) { memory.walked = null }
    return false
  }
  if (memory.walked == true) {
    memory.stuck = true
    log("no way to the training ground")
  } else {
    memory.walked = true
    walkTo(memory.at.x, memory.at.y)
  }
  return true
}

${GET_FOOD}

${LOG_TEXT}
`,
  },
  defend: {
    name: 'Defend',
    source: `// Defend (default): what I do when struck, in place of what I was doing,
// which goes on once I end. Armed, I fight back at whoever struck me while
// they are in sight, and end once they are dead, gone or out of sight.
// Unarmed, I walk home to my city's town hall, and end there, or once no
// blow has landed for calm ticks.
let calm = ${DEFEND_CALM_TICKS} // ticks without a blow before I go back, fleeing

if (armed()) {
  fightBack()
} else {
  fleeHome()
}

// Whether I carry a weapon.
fn armed() {
  for (w of ["spear", "sword"]) {
    let n = me.carried[w]
    if (n != null && n > 0) { return true }
  }
  return false
}

// At whoever struck me, while they are in sight.
fn fightBack() {
  let foe = null
  for (r of residents()) {
    if (r.id == me.struckBy) { foe = r }
  }
  if (foe == null) {
    end("the attacker is gone")
    return
  }
  let o = me.order
  if (o != null && o.kind == "attack" && o.targetId == foe.id) { return } // at it
  let problem = attack(foe.id)
  if (problem != null) {
    end("can't fight back: " + problem)
    return
  }
  doing("Defending: fighting back at " + foe.name)
  log("fighting back at " + foe.name)
}

// Home to my city's town hall, until I am there or it has been calm.
fn fleeHome() {
  if (me.struckAt == null || tick - me.struckAt >= calm) {
    end("no blow for a while")
    return
  }
  let hall = townHall()
  if (hall == null) {
    end("no home to flee to")
    return
  }
  let here = buildingAt(me.x, me.y)
  if (here != null && here.id == hall.id) {
    end("home")
    return
  }
  if (me.order != null && me.order.kind == "walkTo") { return } // on my way
  let problem = walkTo(hall.x, hall.y)
  if (problem != null) {
    end("can't flee home: " + problem)
    return
  }
  doing("Defending: fleeing home")
  log("fleeing home to " + placeName(hall))
}

// My city's town hall, if I see my city.
fn townHall() {
  for (c of cities()) {
    if (c.id == me.cityId) { return building(c.townHallId) }
  }
  return null
}

${LOG_TEXT}
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
