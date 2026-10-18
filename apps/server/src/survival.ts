import {
  FOOD_PER_DAY,
  HEAL_DAYS,
  HUNGER_DAYS,
  MAX_HEALTH,
  MAX_HUNGER,
  STARVE_DAYS,
  TICKS_PER_GAME_DAY,
  foodUse,
  terrainAt,
  type Good,
  type Realm,
  type Resident,
  type Stock,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { recordEvent } from './events.js'

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
 * (faster on hard terrain, slower with high Endurance); a resident eats a unit of food when there
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

  for (const r of world.residents) {
    const wasFed = r.hunger > 0
    r.hunger = Math.max(0, r.hunger - drain * foodUse(r, terrainAt(terrain, r.x, r.y), world.tick))
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
 * their realm. Returns the realms that ended.
 */
export function dieAll(world: WorldState, died: Resident[], cause: 'starved' | 'oldAge'): Realm[] {
  // Every death is written down before any realm ends, so all of them reach the Player.
  for (const r of died) {
    const leader = world.realms.some((x) => x.leaderId === r.id)
    recordEvent(world, r.owner, { kind: 'died', residentId: r.id, name: r.name, cause, leader })
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
 * gets a fresh starting city on their next login.
 */
export function endRealm(world: WorldState, realm: Realm): void {
  world.realms = world.realms.filter((x) => x !== realm)
  for (const r of world.residents) if (r.owner === realm.id) r.owner = null
  for (const c of world.cities) if (c.realmId === realm.id) c.realmId = null
  for (const h of world.horses) if (h.realmId === realm.id) h.realmId = null
  for (const k of world.carriages) if (k.realmId === realm.id) k.realmId = null
}
