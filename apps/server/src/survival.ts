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
  foodUse,
  carriagesAt,
  inCityArea,
  pileAt,
  unitsThatFit,
  type Building,
  type DeathCause,
  groundAt,
  roadTiles,
  type Good,
  type Realm,
  type Resident,
  type Stock,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { recordEvent } from './events.js'
import { leaveOnLeaderDeath } from './alliances.js'

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
  return { died, ended: dieAll(world, died, 'starved') }
}

/**
 * Residents die of `cause`, each death going in their Player's realm log; a Leader's death ends
 * their realm. `killers` names who killed each of them, by resident id, when they were killed.
 * Returns the realms that ended.
 */
export function dieAll(
  world: WorldState,
  died: Resident[],
  cause: DeathCause,
  killers?: Map<string, string>,
): Realm[] {
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
      endRealm(world, realm)
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
 * Leader death, in its basic form (`CONTEXT.md`: Leader death): the realm ends, and its
 * residents, cities, horses and carriages stay where they are, belonging to nobody. The Player
 * gets a fresh starting city on their next login. The realm leaves its alliance at once.
 */
export function endRealm(world: WorldState, realm: Realm): void {
  leaveOnLeaderDeath(world, realm.id)
  world.realms = world.realms.filter((x) => x !== realm)
  for (const r of world.residents) if (r.owner === realm.id) r.owner = null
  for (const c of world.cities) if (c.realmId === realm.id) c.realmId = null
  for (const h of world.horses) if (h.realmId === realm.id) h.realmId = null
  for (const k of world.carriages) if (k.realmId === realm.id) k.realmId = null
}

/**
 * The finished storage that holds food of the city they stand in, if the resident is at home
 * (`CONTEXT.md`: At home): in the area of a city of their own realm. `size` is the map's.
 */
export function homeStorage(world: WorldState, r: Resident, size: number): Building | undefined {
  if (r.owner === null) return undefined
  for (const home of world.cities) {
    if (home.realmId !== r.owner || !inCityArea(world, home, r.x, r.y, size)) continue
    const storage = world.buildings.find(
      (b) => b.cityId === home.id && b.kind === 'storage' && !b.site && (b.stock?.food ?? 0) > 0,
    )
    if (storage) return storage
  }
  return undefined
}

/**
 * Where a resident running low on food takes a meal from, if anywhere (`CONTEXT.md`: Refilling):
 * at home, their city's storage; working at a workplace, the Food in the pile on its tile, else on
 * a carriage standing there. Elsewhere nowhere. `size` is the map's.
 */
export function refillStock(world: WorldState, r: Resident, size: number): Stock | undefined {
  const home = homeStorage(world, r, size)
  if (home) return home.stock
  const o = r.order
  if (o?.kind !== 'workAt' || r.x !== o.at.x || r.y !== o.at.y) return undefined
  const place = world.buildings.find((b) => b.id === o.buildingId)
  if (!place || place.site || place.x !== r.x || place.y !== r.y) return undefined
  const pile = pileAt(world, r.x, r.y)
  if ((pile?.goods.food ?? 0) > 0) return pile!.goods
  return carriagesAt(world, r.x, r.y).find((k) => (k.load.food ?? 0) > 0)?.load
}

/**
 * Refilling (`CONTEXT.md`: Refilling at home, Refilling at a workplace): a resident who carries
 * fewer than `HOME_FOOD_LOW` units of food takes meals (`MEAL_UNITS` each) into their hands from
 * their `refillStock`, without an order, until they no longer run low, there is none left, or no
 * more fits. Residents anywhere else get nothing. They still eat only what they carry. `size` is
 * the map's.
 */
export function stepRefill(world: WorldState, size: number): void {
  let fromPile = false
  for (const r of world.residents) {
    while ((r.carried.food ?? 0) < HOME_FOOD_LOW) {
      const stock = refillStock(world, r, size)
      const units = Math.min(MEAL_UNITS, stock?.food ?? 0, unitsThatFit(r, 'food', world.tick))
      if (!stock || units <= 0) break
      take(stock, 'food', units)
      r.carried.food = (r.carried.food ?? 0) + units
      fromPile ||= world.piles.some((p) => p.goods === stock)
    }
  }
  if (fromPile) world.piles = world.piles.filter((p) => Object.values(p.goods).some((n) => n > 0))
}
