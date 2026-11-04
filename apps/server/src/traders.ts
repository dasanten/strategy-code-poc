import {
  CARRIAGE_CAPACITY,
  GOODS,
  SIGHT_RANGE,
  START_CARRIED_FOOD,
  TRADERS,
  TRADER_DRIVE_TRIES,
  TRADER_ESCORTS,
  caravanFoodFor,
  carriageCapacity,
  crewIdsOf,
  inCityArea,
  isArmed,
  isCityBuilding,
  middleOf,
  isAt,
  owedBy,
  stockWeight,
  townHallOf,
  traderEscortsWanted,
  unitsThatFit,
  unitsThatFitCarriage,
  wrapDistance,
  type Carriage,
  type City,
  type Good,
  type GoodsSpot,
  type Resident,
  type Stock,
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
  stepCrew,
  take,
  topUpFood,
  type RouteEnd,
} from './caravans.js'
import type { Invariant, InvariantViolation } from './invariants.js'
import { residentNamesTaken } from './names.js'
import { hash, mulberry32, newResident } from './residents.js'
import { newId } from './starting-city.js'
import { hqLayout, tradeOrgHq } from './trade-org.js'
import { tradingPosts } from './trading-posts.js'
import { worldIndex } from './world-index.js'

/*
 * Wandering traders (`CONTEXT.md`: Wandering trader): Trade Org carriages the HQ sends round a
 * fixed loop of its trading posts, apart from the caravans, so posts can hold goods they don't
 * produce. Crew, escort, Food on board and a lost carriage go as for a caravan, and share its code
 * (`stepCrew`). The trader is plain data (ADR 0002); each tick the game gives its crew drive,
 * pick-up, drop and walk orders, which request actions like a Player's do.
 */

/** Where a trading post lies, for how far its neighbours on a loop are. */
function placeOf(world: WorldState, postId: string): { x: number; y: number } | undefined {
  const city = world.cities.find((c) => c.id === postId)
  const hall = city && townHallOf(world, city)
  return hall && middleOf(hall)
}

/**
 * Puts `postId` into `loop` where it adds the least way, keeping the order of the rest, so the loop
 * stays fixed but for that one post. `size` is the map's.
 */
function insertIntoLoop(world: WorldState, loop: string[], postId: string, size: number): void {
  const at = placeOf(world, postId)
  if (!at) return
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
  loop.splice(best, 0, postId)
}

/** A loop of all the world's trading posts (`insertIntoLoop`). `size` is the map's. */
function newLoop(world: WorldState, posts: readonly City[], size: number): string[] {
  const loop: string[] = []
  for (const post of posts) insertIntoLoop(world, loop, post.id, size)
  return loop
}

/**
 * The HQ sends out its wandering traders (`CONTEXT.md`: Wandering trader): `TRADERS`, or one for
 * each post with fewer, spread evenly round one loop of all the posts. Each gets a carriage with a
 * horse hitched to it, a driver and `TRADER_ESCORTS` escorts, new residents of the HQ, all standing
 * at its goods warehouse. Each starts by topping up its Food at the HQ. Nothing when the world has
 * no HQ. `size` is the map's.
 */
export function placeTraders(world: WorldState, size: number): Trader[] {
  const hq = tradeOrgHq(world)
  const hall = hq && townHallOf(world, hq)
  if (!hq || !hall) return []
  const middle = middleOf(hall)
  const [x, y] = hqLayout(middle.x, middle.y).goodsWarehouse
  const posts = tradingPosts(world)
  const loop = newLoop(world, posts, size)
  const count = Math.min(TRADERS, loop.length)
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
      postId: loop[Math.floor((i * loop.length) / count)]!,
      heading: 'hq',
      stop: 'storage',
      plan: null,
      holding: null,
      misses: 0,
      robberies: 0,
    }
    world.traders.push(trader)
    placed.push(trader)
  }
  return placed
}

/**
 * What evens out a trader's load with a warehouse holding `there` (`CONTEXT.md`: Wandering trader),
 * every good including Food and Coins: half of what the load has more of than the warehouse is left
 * there, and half of what it has less of is taken, as far as the carriage holds (`capacity`, by its
 * horse's Strength). When it can't hold all that, each good to take is cut by the same share, so
 * every good travels and not only the first. The Food the crew keep on board (`keepFood`) is not
 * load: it is neither left nor weighed against the warehouse's.
 */
export function evenOutLoad(
  there: Stock,
  load: Stock,
  keepFood: number,
  capacity: number,
): NonNullable<Trader['plan']> {
  const leave: Stock = {}
  const wanted: Stock = {}
  for (const g of GOODS) {
    const kept = g === 'food' ? keepFood : 0
    const carried = Math.max(0, (load[g] ?? 0) - kept)
    const more = Math.floor((carried - (there[g] ?? 0)) / 2)
    const less = Math.floor(((there[g] ?? 0) - carried) / 2)
    if (more > 0) leave[g] = more
    else if (less > 0) wanted[g] = less
  }
  const room = Math.max(0, capacity - stockWeight(load) + stockWeight(leave))
  const share = Math.min(1, room / Math.max(stockWeight(wanted), 1e-9))
  const takes: Stock = {}
  for (const [g, units] of Object.entries(wanted) as [Good, number][]) {
    const n = Math.floor(units * share + 1e-9)
    if (n > 0) takes[g] = n
  }
  return { leave, take: takes }
}

/** The trader's place now: its storage and warehouse, at the HQ or at `postId`. */
function traderEnd(world: WorldState, trader: Trader): RouteEnd {
  return trader.heading === 'hq' || trader.postId === null
    ? hqEnd(world)
    : postEnd(world, trader.postId)
}

/**
 * The trader goes on: from the HQ out to the post it was bound for, from a post to the next on its
 * loop, its storage first. With no post on its loop it stays at the HQ.
 */
function goOn(trader: Trader): void {
  if (trader.postId === null) return
  trader.stop = 'storage'
  trader.plan = null
  trader.misses = 0
  if (trader.heading === 'hq') {
    trader.heading = 'post'
    return
  }
  const at = trader.loop.indexOf(trader.postId)
  trader.postId = trader.loop[(at + 1) % trader.loop.length]!
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
 * (`stepCrimes`). With no crew by the carriage nobody has seen it yet. `size` is the map's.
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
  const driver = crew.find((r) => r.id === trader.driverId)
  if (driver?.order?.kind === 'drive') driver.order = null
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
  const standing = world.buildings.filter((b) => b.cityId === city.id && isCityBuilding(b))
  if (trader.misses >= TRADER_DRIVE_TRIES || standing.length === 0) return goOn(trader)
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
 * (`driveToLostPost`); otherwise drive to the next stop, going on to
 * the next post after `TRADER_DRIVE_TRIES` drives that end short of it; at a storage, top up the Food
 * on board for its crew (`caravanFoodFor`); at a post's warehouse, even out its load (`evenOutLoad`),
 * leaving first, beyond what the warehouse keeps for deliveries; then go on. At the HQ it loads
 * nothing but that Food, and waits for its escort to be armed. Each take or put is one pick-up or drop order of the driver's, one a tick,
 * like anyone's. A place without its storage is skipped to the warehouse; one without its warehouse,
 * passed by. `size` is the map's.
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
  const end = traderEnd(world, trader)
  const stop = trader.stop === 'storage' ? end.storage : end.warehouse
  if (!stop) {
    if (trader.stop === 'storage') trader.stop = 'warehouse'
    else goOn(trader)
    return
  }
  if (!isAt(driver, stop, size)) {
    if (trader.misses >= TRADER_DRIVE_TRIES) return goOn(trader)
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
  if (trader.heading === 'hq') {
    // It won't be back here soon, so it goes no further than this without arms for its escort.
    const index = worldIndex(world)
    const escort = trader.escortIds.flatMap((id) => index.residentById(id) ?? [])
    if (escort.every(isArmed)) goOn(trader)
    return
  }
  const stock = stop.stock ?? {}
  if (trader.plan === null) {
    const spare: Stock = {}
    for (const g of GOODS) spare[g] = (stock[g] ?? 0) - owedBy(world, stop.id, g)
    trader.plan = evenOutLoad(
      spare,
      carriage.load,
      caravanFoodFor(trader.escortIds.length),
      carriageCapacity(world, carriage),
    )
  }
  const here: GoodsSpot = { kind: 'storage', storageId: stop.id }
  const onCarriage: GoodsSpot = { kind: 'carriage', carriageId: carriage.id }
  const hands = (g: Good) => unitsThatFit(driver, g, world.tick)
  const { leave, take: toTake } = trader.plan
  /** The next of `goods` that can be moved, what is left of it noted; undefined with none left. */
  const nextOf = (goods: Stock, most: (g: Good) => number): Stock | undefined => {
    for (const [g, wanted] of Object.entries(goods) as [Good, number][]) {
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
  goOn(trader)
}

/**
 * The trader's loop follows the world's posts (`CONTEXT.md`: Wandering trader): new ones join it
 * where they add the least way (`insertIntoLoop`). One lost stays on it until the trader gets there
 * (`reachLostPost`), and only a city no longer there at all drops at once. With no post left it goes
 * back to the HQ; given one again, it is sent out from there.
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
  if (trader.postId === null) trader.postId = trader.loop[0] ?? null
}

/**
 * One tick of the Trade Org's wandering traders (`CONTEXT.md`: Wandering trader), run before the
 * actions are requested: escorts who are gone leave it; one whose carriage or HQ is gone ends, its
 * crew left to the HQ; its loop follows the posts (`followPosts`); it finds out a lost post on
 * reaching it (`reachLostPost`); and its crew and carriage go as for a caravan (`stepCrew`), a driver
 * idle with the carriage going on along its loop (`runTrader`). `size` is the map's.
 */
export function stepTraders(world: WorldState, size: number): void {
  const hq = tradeOrgHq(world)
  const posts = tradingPosts(world)
  world.traders = world.traders.filter((trader) => {
    const index = worldIndex(world)
    trader.escortIds = trader.escortIds.filter((id) => index.residentById(id) !== undefined)
    const carriage = index.carriageById(trader.carriageId)
    if (!hq || !carriage) return false
    followPosts(world, trader, posts, size)
    reachLostPost(world, trader, carriage, size)
    stepCrew(world, trader, carriage, hq, traderEscortsWanted(trader), size, (driver) =>
      runTrader(world, trader, driver, carriage, size),
    )
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
 * warehouse, where it is sent out again to the post it was bound for and any surviving crew walk back
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
}

/**
 * Wandering traders hold together (`CONTEXT.md`: Wandering trader, Caravan crew lost; ADR 0004):
 * each one's loop names cities that exist, each once, trading posts or those lost and not yet found
 * out (`CONTEXT.md`: Lost post found out), and it goes to one of them, or to none only with an empty
 * loop; its carriage, of the Trade Organization or it ends, and its crew exist and
 * are the HQ's (of no realm, of the HQ city); it has no driver only with no crew left; nobody is on
 * two traders or caravans or both drives and escorts; the driver drives only its carriage; it walks
 * with no more escorts than it gets (`traderEscortsWanted`); and what it means to take fits on a
 * carriage.
 */
export const tradersSound: Invariant = {
  name: 'traders-sound',
  check(world) {
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
        if (!world.cities.some((c) => c.id === id && c.tradeOrg !== 'hq')) {
          fail(t, `has ${id} on its loop, which is no trading post`, [id])
        }
      }
      if (new Set(t.loop).size !== t.loop.length) fail(t, 'has a post twice on its loop')
      if (t.postId === null ? t.loop.length > 0 : !t.loop.includes(t.postId)) {
        fail(t, `goes to ${t.postId}, which doesn't fit its loop of ${t.loop.length}`)
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
    }
    return out
  },
}
