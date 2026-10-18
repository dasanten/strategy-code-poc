import {
  FOOD_PER_DAY,
  HEAL_DAYS,
  HUNGER_DAYS,
  MAX_HEALTH,
  MAX_HUNGER,
  STARVE_DAYS,
  TICKS_PER_GAME_DAY,
  hungerFactor,
  isInsideWalls,
  type Good,
  type Realm,
  type Resident,
  type Stock,
  type WorldState,
} from '@csp/shared'

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
 * (slower with high Endurance); a resident eats a unit of food when there is room for it, from
 * what they carry, or from their city's storage while at home. An empty meter costs health; a
 * meter with anything in it slowly gives health back. A resident with no health left dies and
 * drops what they carried in a pile. When a Leader dies, their realm ends.
 */
export function stepSurvival(world: WorldState): SurvivalResult {
  const drain = MAX_HUNGER / (HUNGER_DAYS * TICKS_PER_GAME_DAY)
  const starve = MAX_HEALTH / (STARVE_DAYS * TICKS_PER_GAME_DAY)
  const heal = MAX_HEALTH / (HEAL_DAYS * TICKS_PER_GAME_DAY)
  const died: Resident[] = []

  for (const r of world.residents) {
    r.hunger = Math.max(0, r.hunger - drain * hungerFactor(r, world.tick))
    if (r.hunger <= MAX_HUNGER - FILL_PER_FOOD) {
      const pantry = foodSource(world, r)
      if (pantry) {
        take(pantry, 'food', 1)
        r.hunger = Math.min(MAX_HUNGER, r.hunger + FILL_PER_FOOD)
      }
    }
    if (r.hunger <= 0) r.health = Math.max(0, r.health - starve)
    else r.health = Math.min(MAX_HEALTH, r.health + heal)
    if (r.health <= 0) died.push(r)
  }
  return { died, ended: dieAll(world, died) }
}

/** Residents die, whatever of; a Leader's death ends their realm. Returns the realms that ended. */
export function dieAll(world: WorldState, died: Resident[]): Realm[] {
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

/** Where a resident's next meal comes from: what they carry, else their city's storage at home. */
function foodSource(world: WorldState, r: Resident): Stock | undefined {
  if ((r.carried.food ?? 0) >= 1) return r.carried
  const home = world.cities.find((c) => c.realmId === r.owner && isInsideWalls(c, r.x, r.y))
  if (!home) return undefined
  const storage = world.buildings.find(
    (b) => b.cityId === home.id && b.kind === 'storage' && (b.stock?.food ?? 0) >= 1,
  )
  return storage?.stock
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
