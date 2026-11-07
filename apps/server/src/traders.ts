import {
  CARRIAGE_CAPACITY,
  GOODS,
  SET_OFF_FOOD_SLACK,
  SIGHT_RANGE,
  START_CARRIED_FOOD,
  TRADERS,
  TRADER_DRIVE_TRIES,
  TRADER_ESCORTS,
  caravanFoodFor,
  carriageCapacity,
  crewIdsOf,
  foodForWay,
  inCityArea,
  isArmed,
  horseLiesDown,
  isCityBuilding,
  middleOf,
  isAt,
  owedBy,
  stockWeight,
  townHallOf,
  tradeCoinWarehouse,
  traderEscortsWanted,
  unitsThatFit,
  unitsThatFitCarriage,
  warehouseKeeps,
  wrapDistance,
  type Building,
  type Carriage,
  type City,
  type Good,
  type GoodsSpot,
  type Resident,
  type Stock,
  type TerrainMap,
  type Trader,
  type WorldState,
} from '@csp/shared'
import {
  dropFromLoop,
  hqEnd,
  newCaravanCarriage,
  ofTradeOrg,
  postEnd,
  putDownHeld,
  standsAtHqStop,
  stepCrew,
  take,
  topUpFood,
  type RouteEnd,
} from './caravans.js'
import type { Invariant, InvariantViolation } from './invariants.js'
import { residentNamesTaken } from './names.js'
import { hash, mulberry32, newResident } from './residents.js'
import { newId } from './starting-city.js'
import { callsOnTheWay, runStops } from './trader-stops.js'
import { hqLayout, tradeOrgHq } from './trade-org.js'
import { tradingPosts } from './trading-posts.js'
import { worldIndex } from './world-index.js'

/*
 * Wandering traders (`CONTEXT.md`: Wandering trader): Trade Org carriages the HQ sends round a
 * fixed loop of its trading posts and itself, apart from the caravans, so posts can hold goods they
 * don't produce and new Food and Coins reach them. Crew, escort, Food on board and a lost carriage
 * go as for a caravan, and share its code (`stepCrew`). The trader is plain data (ADR 0002); each tick the game gives its crew drive,
 * pick-up, drop and walk orders, which request actions like a Player's do.
 */

/** Where a stop lies, for how far its neighbours on a loop are. */
function placeOf(world: WorldState, stopId: string): { x: number; y: number } | undefined {
  const city = world.cities.find((c) => c.id === stopId)
  const hall = city && townHallOf(world, city)
  return hall && middleOf(hall)
}

/**
 * Puts `stopId` into `loop` where it adds the least way, keeping the order of the rest, so the loop
 * stays fixed but for that one stop; last, when where it lies isn't known. `size` is the map's.
 */
function insertIntoLoop(world: WorldState, loop: string[], stopId: string, size: number): void {
  const at = placeOf(world, stopId)
  if (!at) {
    loop.push(stopId)
    return
  }
  let best = loop.length
  let least = Infinity
  loop.forEach((id, i) => {
    const a = placeOf(world, id)
    const b = placeOf(world, loop[(i + 1) % loop.length]!)
    if (!a || !b) return
    const added = wrapDistance(size, a, at) + wrapDistance(size, at, b) - wrapDistance(size, a, b)
    if (added >= least) return
    least = added
    best = i + 1
  })
  loop.splice(best, 0, stopId)
}

/** A loop of the HQ and all the world's trading posts (`insertIntoLoop`). `size` is the map's. */
function newLoop(world: WorldState, hq: City, posts: readonly City[], size: number): string[] {
  const loop: string[] = []
  for (const stop of [hq, ...posts]) insertIntoLoop(world, loop, stop.id, size)
  return loop
}

/**
 * The HQ sends out its wandering traders (`CONTEXT.md`: Wandering trader): `TRADERS`, or one for
 * each post with fewer, each bound for a different post, spread evenly round one loop of all the
 * posts and the HQ. Each gets a carriage with a horse hitched to it, a driver and `TRADER_ESCORTS`
 * escorts, new residents of the HQ, all standing at its goods warehouse. Each starts at the HQ, a
 * stop like any. Nothing when the world has no HQ. `size` is the map's.
 */
export function placeTraders(world: WorldState, size: number): Trader[] {
  const hq = tradeOrgHq(world)
  const hall = hq && townHallOf(world, hq)
  if (!hq || !hall) return []
  const middle = middleOf(hall)
  const [x, y] = hqLayout(middle.x, middle.y).goodsWarehouse
  const posts = tradingPosts(world)
  const loop = newLoop(world, hq, posts, size)
  const bound = loop.filter((id) => id !== hq.id)
  const count = Math.min(TRADERS, bound.length)
  const placed: Trader[] = []
  for (let i = world.traders.length; i < count; i++) {
    const rand = mulberry32(hash(`${world.seed}:trader:${i}`))
    const carriageId = newCaravanCarriage(world, hq, x, y, `${world.seed}:trader-horse:${i}`)
    const names = residentNamesTaken(world, null, hq.id)
    const crew = Array.from({ length: 1 + TRADER_ESCORTS }, () => {
      const r = newResident(
        rand,
        { id: newId(world, 'r'), owner: null, cityId: hq.id, x, y, tick: world.tick },
        names,
      )
      r.carried = { food: START_CARRIED_FOOD }
      return r
    })
    world.residents.push(...crew)
    const trader: Trader = {
      id: newId(world, 'trader'),
      carriageId,
      driverId: crew[0]!.id,
      escortIds: crew.slice(1).map((r) => r.id),
      loop: [...loop],
      postId: bound[Math.floor((i * bound.length) / count)]!,
      heading: 'hq',
      stop: 'storage',
      plan: null,
      holding: null,
      misses: 0,
      robberies: 0,
      calls: null,
      stand: null,
    }
    world.traders.push(trader)
    placed.push(trader)
  }
  return placed
}

/**
 * The HQ joins the loops of the world's traders (`CONTEXT.md`: Wandering trader), for a world from
 * before it was a stop: where it adds the least way, and a trader with no post left is bound for it.
 * `size` is the map's.
 */
export function putHqOnLoops(world: WorldState, size: number): void {
  const hq = tradeOrgHq(world)
  if (!hq) return
  for (const t of world.traders) {
    if (!t.loop.includes(hq.id)) insertIntoLoop(world, t.loop, hq.id, size)
    // Null in a world from before: with no post left there was nowhere to be bound for.
    t.postId = (t.postId as string | null) ?? hq.id
  }
}

/**
 * What evens out a trader's load with a warehouse holding `there` (`CONTEXT.md`: Wandering trader),
 * every good including Food and Coins: of each it means to carry on half way between its load and
 * the warehouse, leaving what it has over that and taking what it has under. When the carriage can't
 * hold all that (`capacity`, by its horse's Strength), each good's half way is cut by the same share,
 * so every good travels: otherwise goods the caravans keep level, in bulk, would fill it for good and
 * leave no room for the Food and Coins only a trader brings. The Food the crew keep on board
 * (`keepFood`) is not load: it is neither left nor weighed against the warehouse's, but it takes up
 * room. So does the Food it wants before it leaves the HQ (`foodToHold`, `CONTEXT.md`: Waiting for
 * Food), of which it takes what it lacks, as far as the warehouse has it.
 */
export function evenOutLoad(
  there: Stock,
  load: Stock,
  keepFood: number,
  capacity: number,
  foodToHold = 0,
): NonNullable<Trader['plan']> {
  const carried = (g: Good) => Math.max(0, (load[g] ?? 0) - (g === 'food' ? keepFood : 0))
  const halfWay: Stock = {}
  for (const g of GOODS) halfWay[g] = Math.max(0, (carried(g) + (there[g] ?? 0)) / 2)
  const onBoard = load.food ?? 0
  const kept = Math.max(Math.min(onBoard, keepFood), foodToHold)
  const room = Math.max(0, capacity - stockWeight({ food: kept }))
  const share = Math.min(1, room / Math.max(stockWeight(halfWay), 1e-9))
  const leave: Stock = {}
  const takes: Stock = {}
  for (const g of GOODS) {
    const aim = halfWay[g]! * share
    // Rounded so that what it ends up with fits, when it was cut to fit.
    const over = carried(g) - aim
    const more = share < 1 ? Math.ceil(over - 1e-9) : Math.floor(over + 1e-9)
    const less = Math.floor(aim - carried(g) + 1e-9)
    if (more > 0) leave[g] = more
    else if (less > 0) takes[g] = less
  }
  const lacking = Math.floor(Math.min(foodToHold - onBoard, there.food ?? 0))
  if (lacking > (takes.food ?? 0)) {
    takes.food = lacking
    delete leave.food
  }
  return { leave, take: takes }
}

/** Whether the trader's place now is the HQ: it is sent from there, or has come round to it. */
const atTheHq = (world: WorldState, trader: Trader) =>
  trader.heading === 'hq' || trader.postId === tradeOrgHq(world)?.id

/** The trader's place now: its storage and warehouse, at the HQ or at `postId`. */
function traderEnd(world: WorldState, trader: Trader): RouteEnd {
  return atTheHq(world, trader) ? hqEnd(world) : postEnd(world, trader.postId)
}

/**
 * The building the trader stands at or goes to next: at its place now, its storage, its warehouse or
 * the warehouse with its Coins, which at a post is the same one (`tradeCoinWarehouse`).
 */
function traderStop(world: WorldState, trader: Trader): Building | undefined {
  const end = traderEnd(world, trader)
  if (trader.stop === 'storage') return end.storage
  if (trader.stop === 'warehouse' || !end.warehouse) return end.warehouse
  return tradeCoinWarehouse(world, end.warehouse)
}

/** Where the trader goes on to: sent from the HQ, the post it was bound for; from a stop, the next on its loop. */
function nextStop(world: WorldState, trader: Trader): string {
  if (trader.heading === 'hq' && trader.postId !== tradeOrgHq(world)?.id) return trader.postId
  const at = trader.loop.indexOf(trader.postId)
  return trader.loop[(at + 1) % trader.loop.length]!
}

/**
 * The trader goes on to its next stop (`nextStop`), its storage first. The cities it stops at on the
 * way are worked out anew (`CONTEXT.md`: Trader stop).
 */
function goOn(world: WorldState, trader: Trader): void {
  trader.postId = nextStop(world, trader)
  trader.heading = 'post'
  trader.stop = 'storage'
  trader.plan = null
  trader.misses = 0
  trader.calls = null
}

/**
 * The Food a trader wants on board to reach stop `stopId` from where its carriage stands, the cities
 * it stops at on the way counted (`CONTEXT.md`: Waiting for Food, Trader stop). `size` is the map's.
 */
function wayFoodTo(
  world: WorldState,
  trader: Trader,
  stopId: string,
  carriage: Carriage,
  size: number,
): number {
  const to = placeOf(world, stopId)
  if (!to) return 0
  const stops = callsOnTheWay(world, carriage, to, size).length
  return foodForWay(trader.escortIds.length, wrapDistance(size, carriage, to), stops)
}

/**
 * Whether a trader about to leave the HQ stays for Food (`CONTEXT.md`: Waiting for Food): it holds
 * too little for the way, so it stands at the goods warehouse, whose Food its evening-out draws on
 * and the HQ's people don't eat, until that has some: then it evens out again, which takes what it
 * lacks. `size` is the map's.
 */
function waitsForFood(
  world: WorldState,
  trader: Trader,
  carriage: Carriage,
  size: number,
): boolean {
  const { warehouse } = hqEnd(world)
  const want = wayFoodTo(world, trader, nextStop(world, trader), carriage, size)
  if (!warehouse || (carriage.load.food ?? 0) >= want) return false
  const spare = (warehouse.stock?.food ?? 0) - owedBy(world, warehouse.id, 'food')
  trader.stop = 'warehouse'
  trader.plan = spare >= 1 ? null : { leave: {}, take: {} }
  return true
}

/** The city of the post a trader is out to, when that has been lost (`CONTEXT.md`: Lost post found out). */
function lostPostAhead(world: WorldState, trader: Trader): City | undefined {
  if (trader.heading !== 'post') return undefined
  const city = world.cities.find((c) => c.id === trader.postId)
  return city && city.tradeOrg === undefined ? city : undefined
}

/**
 * A trader coming into the area of the lost post it was out to finds out (`CONTEXT.md`: Lost post
 * found out): it drops the post from its loop and goes on, and those of its crew with it carry the
 * news, as witnesses of the capture, to the next city of the Trade Organization they stand in
 * (`stepCrimes`). It doesn't stop there as at another city: a stop there is given up, and the city
 * is left out of its calls on the way on, so the news goes straight on. With no crew by the carriage
 * nobody has seen it yet. `size` is the map's.
 */
function reachLostPost(world: WorldState, trader: Trader, carriage: Carriage, size: number): void {
  const city = lostPostAhead(world, trader)
  if (!city || !inCityArea(world, city, carriage.x, carriage.y, size)) return
  const index = worldIndex(world)
  const crew = crewIdsOf(trader)
    .flatMap((id) => index.residentById(id) ?? [])
    .filter((r) => r.health > 0 && wrapDistance(size, r, carriage) <= SIGHT_RANGE)
  if (crew.length === 0) return
  const crime = world.crimes.find((c) => c.post === city.id && !c.knownBy.includes(c.victimOrg))
  if (crime) crime.witnesses = [...new Set([...crime.witnesses, ...crew.map((r) => r.id)])]
  dropFromLoop(trader, city.id)
  if (trader.stand?.cityId === city.id) trader.stand = null
  workOutCalls(world, trader, carriage, size)
  trader.calls = (trader.calls ?? []).filter((id) => id !== city.id)
  // A drive to another city's stop goes on; one to here is over.
  const driver = crew.find((r) => r.id === trader.driverId)
  if (trader.stand === null && driver?.order?.kind === 'drive') driver.order = null
}

/**
 * A trader's driver drives up to the lost post `city`, to its nearest building, in contact rather
 * than on it, so that a closed gate doesn't keep the news from it (`CONTEXT.md`: Lost post found
 * out). Getting no nearer after `TRADER_DRIVE_TRIES` drives it goes on, the post still on its loop for
 * next time round. `size` is the map's.
 */
function driveToLostPost(
  world: WorldState,
  trader: Trader,
  city: City,
  driver: Resident,
  carriage: Carriage,
  size: number,
): void {
  // Its horse Down, the carriage stands until it wakes or dies (`CONTEXT.md`: Down).
  if (horseLiesDown(world, carriage)) return
  const standing = world.buildings.filter((b) => b.cityId === city.id && isCityBuilding(b))
  if (trader.misses >= TRADER_DRIVE_TRIES || standing.length === 0) return goOn(world, trader)
  const nearest = standing.reduce((a, b) =>
    wrapDistance(size, carriage, b) < wrapDistance(size, carriage, a) ? b : a,
  )
  trader.misses++
  driver.order = {
    kind: 'drive',
    carriageId: carriage.id,
    target: { x: nearest.x, y: nearest.y },
    path: null,
    progress: 0,
    near: true,
  }
}

/**
 * One tick of a trader whose driver is idle with the carriage: out to a lost post, drive up to it
 * (`driveToLostPost`). Otherwise drive to the next stop, going on to the next after
 * `TRADER_DRIVE_TRIES` drives that end short of it; at a storage, top up the Food on
 * board for its crew (`caravanFoodFor`); at a warehouse, even out its load (`evenOutLoad`), leaving
 * first, beyond what the warehouse keeps for deliveries; then go on. The HQ is a stop like a post,
 * but for two things. It keeps its Coins in its coin warehouse, so they are worked out with the rest,
 * sharing the room on the carriage, and moved there after the other goods. And at its goods warehouse
 * the trader first waits for its escort to be armed, with no post left stays there, and leaves only
 * with enough Food for the way (`waitsForFood`). Each take or put is one pick-up or drop order of the
 * driver's, one a tick, like anyone's. A place without its storage is skipped to the warehouse; one
 * without its warehouse, passed by. `size` is the map's.
 */
function runTrader(
  world: WorldState,
  trader: Trader,
  driver: Resident,
  carriage: Carriage,
  size: number,
): void {
  const lost = lostPostAhead(world, trader)
  if (lost) return driveToLostPost(world, trader, lost, driver, carriage, size)
  const stop = traderStop(world, trader)
  if (!stop) {
    if (trader.stop === 'storage') trader.stop = 'warehouse'
    else goOn(world, trader)
    return
  }
  if (!isAt(driver, stop, size)) {
    // Its horse Down, the carriage stands until it wakes or dies (`CONTEXT.md`: Down).
    if (horseLiesDown(world, carriage)) return
    if (trader.misses >= TRADER_DRIVE_TRIES) return goOn(world, trader)
    trader.misses++
    const target = { x: stop.x, y: stop.y }
    driver.order = { kind: 'drive', carriageId: carriage.id, target, path: null, progress: 0 }
    return
  }
  trader.misses = 0
  if (putDownHeld(trader, driver, stop, carriage)) return
  if (trader.stop === 'storage') {
    if (!topUpFood(world, trader, driver, stop, carriage)) trader.stop = 'warehouse'
    return
  }
  if (trader.stop === 'warehouse' && atTheHq(world, trader)) {
    const index = worldIndex(world)
    const escort = trader.escortIds.flatMap((id) => index.residentById(id) ?? [])
    if (!escort.every(isArmed) || trader.loop.length < 2) return
  }
  const stock = stop.stock ?? {}
  if (trader.plan === null) {
    const coins = tradeCoinWarehouse(world, stop)
    const spare: Stock = {}
    for (const g of GOODS) {
      const held = g === 'coins' ? coins?.stock?.coins : stock[g]
      spare[g] = (held ?? 0) - owedBy(world, stop.id, g)
    }
    trader.plan = evenOutLoad(
      spare,
      carriage.load,
      caravanFoodFor(trader.escortIds.length),
      carriageCapacity(world, carriage),
      atTheHq(world, trader)
        ? wayFoodTo(world, trader, nextStop(world, trader), carriage, size)
        : 0,
    )
  }
  const here: GoodsSpot = { kind: 'storage', storageId: stop.id }
  const onCarriage: GoodsSpot = { kind: 'carriage', carriageId: carriage.id }
  const hands = (g: Good) => unitsThatFit(driver, g, world.tick)
  const { leave, take: toTake } = trader.plan
  const keeps = warehouseKeeps(world, stop)
  /**
   * The next of `goods` this warehouse keeps that can be moved, what is left of it noted; undefined
   * with none left.
   */
  const nextOf = (goods: Stock, most: (g: Good) => number): Stock | undefined => {
    for (const [g, wanted] of Object.entries(goods) as [Good, number][]) {
      if (!keeps.includes(g)) continue
      const units = Math.min(wanted, most(g))
      if (units <= 0 || wanted - units <= 0) delete goods[g]
      else goods[g] = wanted - units
      if (units > 0) return { [g]: units }
    }
    return undefined
  }
  const off = nextOf(leave, (g) => Math.min(carriage.load[g] ?? 0, hands(g)))
  if (off) return take(trader, driver, onCarriage, off, 'stop')
  const on = nextOf(toTake, (g) =>
    Math.min(stock[g] ?? 0, hands(g), unitsThatFitCarriage(world, carriage, g)),
  )
  if (on) return take(trader, driver, here, on, 'carriage')
  // What is left of the plan is what this warehouse doesn't keep: at the HQ, the Coins.
  const coinsLeft = Object.keys(leave).length + Object.keys(toTake).length > 0
  if (trader.stop === 'warehouse' && coinsLeft) trader.stop = 'coinWarehouse'
  else if (!atTheHq(world, trader) || !waitsForFood(world, trader, carriage, size)) {
    goOn(world, trader)
  }
}

/**
 * The trader's loop follows the world's posts (`CONTEXT.md`: Wandering trader): new ones join it
 * where they add the least way (`insertIntoLoop`). One lost stays on it until the trader gets there
 * (`reachLostPost`), and only a city no longer there at all drops at once. The HQ stays on it, so with
 * no post left the trader goes back there, and given one again goes out to it.
 */
function followPosts(
  world: WorldState,
  trader: Trader,
  posts: readonly City[],
  size: number,
): void {
  for (const id of [...trader.loop]) {
    if (!world.cities.some((c) => c.id === id)) dropFromLoop(trader, id)
  }
  for (const post of posts) {
    if (!trader.loop.includes(post.id)) insertIntoLoop(world, trader.loop, post.id, size)
  }
}

/**
 * The cities a trader stops at on its way from where its carriage stands to its next place, worked
 * out when it sets off on that way (`CONTEXT.md`: Trader stop). `size` is the map's.
 */
function workOutCalls(world: WorldState, trader: Trader, carriage: Carriage, size: number): void {
  if (trader.calls !== null) return
  const end = traderEnd(world, trader)
  const to = end.storage ?? end.warehouse
  trader.calls = to ? callsOnTheWay(world, carriage, to, size) : []
}

/**
 * One tick of the Trade Org's wandering traders (`CONTEXT.md`: Wandering trader), run before the
 * actions are requested: escorts who are gone leave it; one whose carriage or HQ is gone ends, its
 * crew left to the HQ; its loop follows the posts (`followPosts`); it finds out a lost post on
 * reaching it (`reachLostPost`); and its crew and carriage go as for a caravan (`stepCrew`), a driver
 * idle with the carriage making its stops on the way (`runStops`), then going on along its loop
 * (`runTrader`). Without `terrain` it makes no stops. `size` is the map's.
 */
export function stepTraders(world: WorldState, size: number, terrain?: TerrainMap): void {
  const hq = tradeOrgHq(world)
  const posts = tradingPosts(world)
  world.traders = world.traders.filter((trader) => {
    const index = worldIndex(world)
    trader.escortIds = trader.escortIds.filter((id) => index.residentById(id) !== undefined)
    const carriage = index.carriageById(trader.carriageId)
    if (!hq || !carriage) return false
    followPosts(world, trader, posts, size)
    reachLostPost(world, trader, carriage, size)
    stepCrew(world, trader, carriage, hq, traderEscortsWanted(trader), size, (driver) => {
      workOutCalls(world, trader, carriage, size)
      if (terrain && runStops(world, trader, driver, carriage, terrain)) return
      runTrader(world, trader, driver, carriage, size)
    })
    return true
  })
}

/**
 * Resident `r` took goods off carriage `carriageId` (`CONTEXT.md`: Wandering trader): when it is a
 * trader's and they aren't of the Trade Organization, they robbed it, which it counts once a tick
 * however many take from it (`robbed`) and which earns it more escorts. It owes nobody a delivery, so
 * nothing is sent again. With `whole`, the carriage itself was taken, which one of the Trade Org's
 * own hired out to a realm does too.
 */
export function robTrader(
  world: WorldState,
  r: Resident,
  carriageId: string,
  robbed: Set<string>,
  whole = false,
): void {
  const trader = world.traders.find((t) => t.carriageId === carriageId)
  if (!trader || (ofTradeOrg(world, r) && !whole) || robbed.has(trader.id)) return
  robbed.add(trader.id)
  trader.robberies++
}

/**
 * `thief` stole a carriage (`CONTEXT.md`: Wandering trader, Caravan crew lost): when it was a
 * trader's that robs it, and the same trader gets a new carriage and horse at the HQ's goods
 * warehouse, where it is sent out again to the stop it was bound for and any surviving crew walk back
 * to it. With no HQ left to give them, the trader ends.
 */
export function traderCarriageStolen(world: WorldState, thief: Resident, carriage: Carriage): void {
  const trader = world.traders.find((t) => t.carriageId === carriage.id)
  if (!trader) return
  robTrader(world, thief, carriage.id, new Set(), true)
  const hq = tradeOrgHq(world)
  const hall = hq && townHallOf(world, hq)
  if (!hq || !hall) {
    world.traders = world.traders.filter((t) => t !== trader)
    return
  }
  const middle = middleOf(hall)
  const [x, y] = hqLayout(middle.x, middle.y).goodsWarehouse
  const seed = `${world.seed}:trader-horse:${trader.id}:${carriage.id}`
  trader.carriageId = newCaravanCarriage(world, hq, x, y, seed)
  trader.heading = 'hq'
  trader.stop = 'storage'
  trader.plan = null
  trader.misses = 0
  trader.calls = null
  trader.stand = null
}

/**
 * Wandering traders hold together (`CONTEXT.md`: Wandering trader, Caravan crew lost; ADR 0004):
 * each one's loop holds the HQ and otherwise names trading posts, or those lost and not yet found out
 * (`CONTEXT.md`: Lost post found out), all cities that exist, each once, and it goes to one of them; it
 * makes for a coin warehouse only at the HQ; its carriage, of the Trade Organization or it ends, and
 * its crew exist and are the HQ's (of no realm, of the HQ city); it has no driver only with no crew left; nobody is on
 * two traders or caravans or both drives and escorts; the driver drives only its carriage; it walks
 * with no more escorts than it gets (`traderEscortsWanted`); what it means to take fits on a
 * carriage; and one just set off from the HQ holds enough for its way (`CONTEXT.md`: Waiting for
 * Food), but for what it ate since it loaded (`SET_OFF_FOOD_SLACK`).
 */
export const tradersSound: Invariant = {
  name: 'traders-sound',
  check(world, terrain) {
    const out: InvariantViolation[] = []
    const fail = (t: Trader, message: string, ids: string[] = []) =>
      out.push({
        invariant: this.name,
        message: `trader ${t.id} ${message}`,
        entityIds: [t.id, ...ids],
      })
    const hq = tradeOrgHq(world)
    const crew = new Set(world.caravans.flatMap(crewIdsOf))
    for (const t of world.traders) {
      for (const id of t.loop) {
        if (!world.cities.some((c) => c.id === id)) {
          fail(t, `has ${id} on its loop, which is no city`, [id])
        }
      }
      if (hq && !t.loop.includes(hq.id)) fail(t, 'has no HQ on its loop', [hq.id])
      if (new Set(t.loop).size !== t.loop.length) fail(t, 'has a stop twice on its loop')
      if (!t.loop.includes(t.postId)) {
        fail(t, `goes to ${t.postId}, which isn't on its loop of ${t.loop.length}`)
      }
      if (t.stop === 'coinWarehouse' && !atTheHq(world, t)) {
        fail(t, `makes for a coin warehouse at ${t.postId}, which is not the HQ`)
      }
      const k = world.carriages.find((x) => x.id === t.carriageId)
      if (!k) fail(t, `has carriage ${t.carriageId}, which doesn't exist`)
      else if (k.realmId !== null || k.cityId !== hq?.id) {
        fail(t, `has carriage ${k.id}, which isn't the Trade Org HQ's`, [k.id])
      }
      if (t.driverId === null && t.escortIds.length > 0) {
        fail(t, 'has no driver, though an escort could take over')
      }
      for (const id of crewIdsOf(t)) {
        const r = world.residents.find((x) => x.id === id)
        if (!r) fail(t, `has crew ${id}, who doesn't exist`)
        else if (r.owner !== null || r.cityId !== hq?.id) {
          fail(t, `has crew ${id}, who isn't of the Trade Org HQ`, [id])
        }
        if (crew.has(id)) fail(t, `has crew ${id} twice or shared with another`, [id])
        crew.add(id)
      }
      const wanted = traderEscortsWanted(t)
      if (t.escortIds.length > wanted) {
        fail(t, `walks with ${t.escortIds.length} escorts, more than the ${wanted} it gets`)
      }
      const driver = world.residents.find((x) => x.id === t.driverId)
      const o = driver?.order
      if (driver && o?.kind === 'drive' && o.carriageId !== t.carriageId) {
        fail(t, `has its driver driving ${o.carriageId}`, [driver.id])
      }
      const holds = k ? carriageCapacity(world, k) : CARRIAGE_CAPACITY
      if (t.plan && stockWeight(t.plan.take) > holds + 1e-9) {
        fail(t, `means to take ${stockWeight(t.plan.take)} kg, more than a carriage holds`)
      }
      if (k && driver && !atTheHq(world, t) && standsAtHqStop(world, k, terrain.size)) {
        const want = wayFoodTo(world, t, t.postId, k, terrain.size) - SET_OFF_FOOD_SLACK
        const food = k.load.food ?? 0
        if (food < want) fail(t, `set off from the HQ with ${food} Food, wanting ${want}`, [k.id])
      }
    }
    return out
  },
}
