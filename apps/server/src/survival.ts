import {
  FOOD_PER_DAY,
  HOME_FOOD_LOW,
  MEAL_UNITS,
  HEAL_DAYS,
  HUNGER_DAYS,
  MAX_HEALTH,
  MAX_HUNGER,
  STARVE_DAYS,
  TICKS_PER_GAME_DAY,
  TRADE_ORG,
  contractOf,
  tradeOrgHq,
  foodUse,
  armyOf,
  inContact,
  spareFood,
  carriagesAt,
  inCityArea,
  pileAt,
  unitsThatFit,
  type Building,
  type City,
  type DeathCause,
  groundAt,
  townHallOf,
  wrapDistance,
  roadTiles,
  type Good,
  type Realm,
  type Resident,
  type Stock,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { recordEvent } from './events.js'
import { rememberFormerPlayer } from './standing.js'
import { leaveOnLeaderDeath } from './alliances.js'
import { endContractsOnLeaderDeath } from './contracts.js'
import { NPC_ORDER_KINDS, npcHome, walkTo } from './npc-behaviour.js'
import { caravanFood } from './caravans.js'
import { countSoldiersKilled } from './directives.js'

/** How far one unit of food fills the hunger meter. */
const FILL_PER_FOOD = (MAX_HUNGER * HUNGER_DAYS) / FOOD_PER_DAY

/** What survival did this tick. */
export interface SurvivalResult {
  /** Residents who died this tick. */
  died: Resident[]
  /** Realms that ended because their Leader died. */
  ended: Realm[]
}

/**
 * One tick of survival (`CONTEXT.md`: Hunger, Eating, Leader death): the hunger meter runs down
 * (faster on hard terrain, slower with high Endurance; on a road as on Plains); a resident eats a unit of food when there
 * is room for it, only from what they carry, also at home. An empty meter costs health; a
 * meter with anything in it slowly gives health back. A resident with no health left dies and
 * drops what they carried in a pile. When a Leader dies, their realm ends. A meter running
 * empty and a death go in the Player's realm log.
 */
export function stepSurvival(world: WorldState, terrain: TerrainMap): SurvivalResult {
  const drain = MAX_HUNGER / (HUNGER_DAYS * TICKS_PER_GAME_DAY)
  const starve = MAX_HEALTH / (STARVE_DAYS * TICKS_PER_GAME_DAY)
  const heal = MAX_HEALTH / (HEAL_DAYS * TICKS_PER_GAME_DAY)
  const died: Resident[] = []
  const roads = roadTiles(world, terrain.size)

  for (const r of world.residents) {
    const wasFed = r.hunger > 0
    const ground = groundAt(terrain, roads, r.x, r.y)
    r.hunger = Math.max(0, r.hunger - drain * foodUse(r, ground, world.tick))
    if (r.hunger <= MAX_HUNGER - FILL_PER_FOOD && (r.carried.food ?? 0) >= 1) {
      take(r.carried, 'food', 1)
      r.hunger = Math.min(MAX_HUNGER, r.hunger + FILL_PER_FOOD)
    }
    if (r.hunger <= 0 && wasFed) {
      recordEvent(world, r.owner, { kind: 'hungry', residentId: r.id, name: r.name })
    }
    if (r.hunger <= 0) r.health = Math.max(0, r.health - starve)
    else r.health = Math.min(MAX_HEALTH, r.health + heal)
    if (r.health <= 0) died.push(r)
  }
  return { died, ended: dieAll(world, died, 'starved', terrain.size) }
}

/**
 * Residents die of `cause`, each death going in their Player's realm log; a Leader's death ends
 * their realm. `killers` names who killed each of them, by resident id, when they were killed.
 * Returns the realms that ended. `size` is the map's.
 */
export function dieAll(
  world: WorldState,
  died: Resident[],
  cause: DeathCause,
  size: number,
  killers?: Map<string, string>,
): Realm[] {
  if (cause === 'killed') countSoldiersKilled(world, died)
  // Every death is written down before any realm ends, so all of them reach the Player.
  for (const r of died) {
    const leader = world.realms.some((x) => x.leaderId === r.id)
    const by = killers?.get(r.id)
    recordEvent(world, r.owner, {
      kind: 'died',
      residentId: r.id,
      name: r.name,
      cause,
      leader,
      ...(by === undefined ? {} : { by }),
    })
  }
  const ended: Realm[] = []
  for (const r of died) {
    die(world, r)
    const realm = world.realms.find((x) => x.leaderId === r.id)
    if (realm) {
      endRealm(world, realm, size)
      ended.push(realm)
    }
  }
  return ended
}

function take(stock: Stock, good: Good, units: number): void {
  const left = (stock[good] ?? 0) - units
  if (left > 0) stock[good] = left
  else delete stock[good]
}

/** Removes a dead resident; what they carried drops in a pile on their tile (`CONTEXT.md`: Loot). */
export function die(world: WorldState, r: Resident): void {
  world.residents = world.residents.filter((x) => x !== r)
  dropGoods(world, r.x, r.y, r.carried)
}

/** Puts goods in the pile on a tile, starting one if there is none and there is anything to drop. */
export function dropGoods(world: WorldState, x: number, y: number, stock: Stock): void {
  const goods = Object.entries(stock).filter(([, n]) => n > 0) as [Good, number][]
  if (goods.length === 0) return
  let pile = world.piles.find((p) => p.x === x && p.y === y)
  if (!pile) {
    pile = { id: `pile${world.nextId++}`, x, y, goods: {} }
    world.piles.push(pile)
  }
  for (const [good, n] of goods) pile.goods[good] = (pile.goods[good] ?? 0) + n
}

/**
 * Leader death (`CONTEXT.md`: Leader death, Self-managed city): the realm ends, its mercenary
 * contracts end and its lent and hired residents walk home (`endContractsOnLeaderDeath`), it
 * leaves its alliance at once and its alliance-army soldiers come back (`leaveOnLeaderDeath`),
 * and each of its cities becomes its own self-managed city, an NPC city with
 * the residents who live there. Homeless residents join the nearest of those cities, and each
 * horse and carriage goes to the one nearest it. With control the Player's orders end: a
 * resident away walks home (`walkHomeIfAway`), and the others keep only the orders an NPC city
 * gives itself (`NPC_ORDER_KINDS`), so its behaviour takes over. With no city left to go to, the
 * realm's residents, horses and carriages belong to nobody. The Player's log says what became
 * of each city, and where it stands, and they get a fresh starting city on their next login;
 * each city remembers them in good standing (`rememberFormerPlayer`).
 * `size` is the map's.
 */
export function endRealm(world: WorldState, realm: Realm, size: number): void {
  endContractsOnLeaderDeath(world, realm.id)
  leaveOnLeaderDeath(world, realm.id)
  const cities = world.cities.filter((c) => c.realmId === realm.id)
  for (const c of cities) c.realmId = null
  rememberFormerPlayer(world, cities, realm.userId)
  for (const r of world.residents) {
    if (r.owner !== realm.id) continue
    r.owner = null
    if (r.cityId === null) r.cityId = nearestCity(world, cities, r, size)?.id ?? null
    const city = cities.find((c) => c.id === r.cityId)
    if (city && walkHomeIfAway(world, city, r, size)) continue
    if (r.order && !NPC_ORDER_KINDS.includes(r.order.kind)) r.order = null
  }
  for (const k of [...world.horses, ...world.carriages]) {
    if (k.realmId !== realm.id) continue
    k.realmId = null
    k.cityId = nearestCity(world, cities, k, size)?.id ?? null
  }
  // What became of each city goes in the Player's log while the realm is still there to name them.
  recordEvent(world, realm.id, {
    kind: 'selfManaged',
    cities: cities.flatMap((c) => {
      const hall = townHallOf(world, c)
      if (!hall) return []
      const residents = world.residents.filter((r) => r.cityId === c.id).length
      return [{ cityId: c.id, name: c.name, x: hall.x, y: hall.y, residents }]
    }),
  })
  world.realms = world.realms.filter((x) => x !== realm)
}

/** Of `cities`, the one whose town hall is nearest a spot; undefined when there is none. */
export function nearestCity(
  world: WorldState,
  cities: City[],
  at: { x: number; y: number },
  size: number,
): City | undefined {
  let best: { city: City; d: number } | undefined
  for (const city of cities) {
    const hall = townHallOf(world, city)
    const d = hall ? wrapDistance(size, at, hall) : Infinity
    if (hall && (!best || d < best.d)) best = { city, d }
  }
  return best?.city
}

/**
 * Sends a resident of an NPC city who is away from it home (`npcHome`): one outside its area
 * (`CONTEXT.md`: City area) who is not working one of its workplaces. Returns whether they were
 * sent.
 */
export function walkHomeIfAway(world: WorldState, city: City, r: Resident, size: number): boolean {
  const o = r.order
  const atWork =
    o?.kind === 'workAt' &&
    world.buildings.some(
      (b) => b.id === o.buildingId && (b.cityId === city.id || !!city.workplaceIds?.includes(b.id)),
    )
  const home = npcHome(world, city)
  if (atWork || !home || inCityArea(world, city, r.x, r.y, size)) return false
  walkTo(r, home)
  return true
}

/**
 * Whether a city is the resident's own home organization: a city of their realm, or for a
 * resident of an NPC city, who belongs to no realm, that city itself (`CONTEXT.md`: Organization).
 */
function isHome(r: Resident, city: City): boolean {
  if (r.owner !== null) return city.realmId === r.owner
  return city.realmId === null && city.id === r.cityId
}

/**
 * The finished storage that holds food of the city they stand in, if the resident is at home
 * (`CONTEXT.md`: At home): in the area of a city of their own realm, or a resident of an NPC city
 * in their city's area. `size` is the map's.
 */
export function homeStorage(world: WorldState, r: Resident, size: number): Building | undefined {
  for (const home of world.cities) {
    if (!isHome(r, home) || !inCityArea(world, home, r.x, r.y, size)) continue
    const storage = world.buildings.find(
      (b) => b.cityId === home.id && b.kind === 'storage' && !b.site && (b.stock?.food ?? 0) > 0,
    )
    if (storage) return storage
  }
  return undefined
}

/**
 * For a mercenary the Trade Organization hired, standing in the Trade Org HQ's area, the HQ's
 * finished storage with Food (`CONTEXT.md`: Trade Org army). `size` is the map's.
 */
function hirersStorage(world: WorldState, r: Resident, size: number): Building | undefined {
  if (contractOf(world, r.id)?.hirerId !== TRADE_ORG) return undefined
  const hq = tradeOrgHq(world)
  if (!hq || !inCityArea(world, hq, r.x, r.y, size)) return undefined
  return world.buildings.find(
    (b) => b.cityId === hq.id && b.kind === 'storage' && !b.site && (b.stock?.food ?? 0) > 0,
  )
}

/** Goods a resident may take a meal from, and how many units of Food of them they may take. */
export interface RefillSource {
  stock: Stock
  food: number
}

/** A stock to refill from when it has Food: all of it may be taken. */
const whole = (stock: Stock | undefined): RefillSource | undefined =>
  stock && (stock.food ?? 0) > 0 ? { stock, food: stock.food! } : undefined

/**
 * Where a resident running low on food takes a meal from, if anywhere (`CONTEXT.md`: Refilling):
 * at home, their city's storage (a mercenary of the Trade Org's, the HQ's); working at a workplace, the Food in the pile on its tile, else on
 * a carriage standing there; in an army, a carriage of their realm on or next to their tile, but
 * not the Food a haul route keeps on board for the horse (`spareFood`); on a caravan's crew, its
 * carriage close by (`caravanFood`). Elsewhere nowhere. `size`
 * is the map's.
 */
export function refillSource(
  world: WorldState,
  r: Resident,
  size: number,
): RefillSource | undefined {
  const home = homeStorage(world, r, size) ?? hirersStorage(world, r, size)
  if (home) return whole(home.stock)
  const o = r.order
  const atWork = o?.kind === 'workAt' && r.x === o.at.x && r.y === o.at.y
  const place = atWork && world.buildings.find((b) => b.id === o.buildingId)
  if (place && !place.site && place.x === r.x && place.y === r.y) {
    const pile = pileAt(world, r.x, r.y)
    if ((pile?.goods.food ?? 0) > 0) return whole(pile!.goods)
    const here = carriagesAt(world, r.x, r.y).find((k) => (k.load.food ?? 0) > 0)
    if (here) return whole(here.load)
  }
  const caravan = caravanFood(world, r, size)
  if (caravan) return whole(caravan)
  if (r.owner === null || !armyOf(world, r.id)) return undefined
  for (const k of world.carriages) {
    if (k.realmId !== r.owner || !inContact(size, k, r)) continue
    const food = spareFood(world, k)
    if (food > 0) return { stock: k.load, food }
  }
  return undefined
}

/**
 * Refilling (`CONTEXT.md`: Refilling at home, Refilling at a workplace, Refilling from a
 * carriage): a resident who carries fewer than `HOME_FOOD_LOW` units of food takes meals
 * (`MEAL_UNITS` each) into their hands from their `refillSource`, without an order, until they no
 * longer run low, there is none left, or no more fits. Residents anywhere else get nothing. They
 * still eat only what they carry. `size` is the map's.
 */
export function stepRefill(world: WorldState, size: number): void {
  let fromPile = false
  for (const r of world.residents) {
    while ((r.carried.food ?? 0) < HOME_FOOD_LOW) {
      const source = refillSource(world, r, size)
      const units = Math.min(MEAL_UNITS, source?.food ?? 0, unitsThatFit(r, 'food', world.tick))
      if (!source || units <= 0) break
      const stock = source.stock
      take(stock, 'food', units)
      r.carried.food = (r.carried.food ?? 0) + units
      fromPile ||= world.piles.some((p) => p.goods === stock)
    }
  }
  if (fromPile) world.piles = world.piles.filter((p) => Object.values(p.goods).some((n) => n > 0))
}
