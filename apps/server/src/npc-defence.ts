import {
  NPC_GATE_WATCH_RANGE,
  NPC_SOLDIER_SHARE,
  WEAPONS,
  canWork,
  defendsCity,
  inCityArea,
  isArmed,
  pileAt,
  recipeFor,
  wallSideOf,
  workProblem,
  wrapDistance,
  type Building,
  type City,
  type Resident,
  type Stock,
  type Weapon,
  type WorldState,
} from '@csp/shared'
import { attackOrder } from './combat.js'
import { walkTo } from './npc-behaviour.js'
import { startWork } from './work.js'

/** What an NPC city's smithy makes for its soldiers: the cheapest weapon (`RECIPES`). */
const SMITHY_WEAPON: Weapon = 'spear'

/**
 * How many soldiers an NPC city keeps (`CONTEXT.md`: NPC city): `NPC_SOLDIER_SHARE` of its
 * adults, rounded up.
 */
export function npcSoldierTarget(adults: number): number {
  return Math.ceil(adults * NPC_SOLDIER_SHARE)
}

/**
 * One tick of NPC cities defending themselves (`CONTEXT.md`: NPC city, Combat): every city run by
 * the game sends its armed residents in its area after attackers there; one that isn't the Trade
 * Organization's also keeps soldiers by its size and closes its gates while armed outsiders are
 * near. Like the rest of an NPC city's behaviour it only gives orders a Player could give
 * (ADR 0002), or opens and closes its own gates as a realm does. Run before `stepNpcCities`, so
 * the work it hands out passes its soldiers by. `size` is the map's.
 */
export function stepNpcDefence(world: WorldState, size: number): void {
  for (const city of world.cities) {
    if (city.realmId !== null) continue
    const people = world.residents.filter(
      (r) => r.owner === null && r.cityId === city.id && r.health > 0,
    )
    fightAttackers(world, city, people, size)
    if (city.tradeOrg) continue
    keepSoldiers(world, city, people)
    watchGates(world, city, size)
  }
}

/**
 * Attackers in a city's area (`CONTEXT.md`: Combat): residents there going after one of its
 * residents on their own account, not fighting back at one who hit them.
 */
function attackersOf(world: WorldState, city: City, size: number): Resident[] {
  const own = (id: string) => {
    const t = world.residents.find((x) => x.id === id)
    return !!t && t.owner === null && t.cityId === city.id
  }
  return world.residents.filter((r) => {
    const o = r.order
    if (o?.kind !== 'attack' || o.defending || r.health <= 0) return false
    if (r.owner === null && r.cityId === city.id) return false
    return own(o.targetId) && inCityArea(world, city, r.x, r.y, size)
  })
}

/**
 * A city's soldiers fight attackers in its area on their own (`CONTEXT.md`: Combat): each of its
 * defenders there (`defendsCity`) not already fighting goes after the nearest attacker.
 */
function fightAttackers(world: WorldState, city: City, people: Resident[], size: number): void {
  const attackers = attackersOf(world, city, size)
  if (attackers.length === 0) return
  for (const r of people) {
    if (r.order?.kind === 'attack' || !defendsCity(world, city, r, size)) continue
    const nearest = attackers.reduce((a, b) =>
      wrapDistance(size, r, b) < wrapDistance(size, r, a) ? b : a,
    )
    r.order = attackOrder(nearest.id)
  }
}

/**
 * An NPC city keeps `npcSoldierTarget` soldiers (`CONTEXT.md`: NPC city, Soldier): its armed
 * adults are its soldiers and stop working (the city then brings them home). While it has too
 * few, it arms one more adult at a time: with a weapon from its storage, else with a spear from
 * its smithy, which they make themselves from Iron and Wood they take from the storage, and pick
 * up from the pile on its tile once it is made.
 */
function keepSoldiers(world: WorldState, city: City, people: Resident[]): void {
  const adults = people.filter((r) => canWork(r, world.tick))
  const soldiers = adults.filter(isArmed)
  for (const r of soldiers) if (r.order?.kind === 'workAt') r.order = null
  if (soldiers.length >= npcSoldierTarget(adults.length)) return
  const unarmed = adults.filter((r) => !isArmed(r) && r.order?.kind !== 'attack')
  if (unarmed.length === 0) return

  const storage = world.buildings.find(
    (b) => b.cityId === city.id && b.kind === 'storage' && !b.site,
  )
  const smithy = world.buildings.find(
    (b) =>
      b.kind === 'smithy' &&
      !b.site &&
      (b.cityId === city.id || (city.workplaceIds ?? []).includes(b.id)),
  )
  if (smithy && takeFromSmithy(world, smithy, unarmed)) return
  const weapon = storage && weaponIn(storage.stock ?? {})
  if (storage && weapon) {
    fetch(storage, unarmed, { [weapon]: 1 })
    return
  }
  const recipe = recipeFor('smithy', SMITHY_WEAPON)
  if (!smithy || !storage || !recipe) return
  if (smithing(world, smithy, unarmed, recipe.input)) return
  const stock = storage.stock ?? {}
  const enough = Object.entries(recipe.input).every(
    ([good, n]) => (stock[good as keyof Stock] ?? 0) >= n,
  )
  if (enough) fetch(storage, unarmed, recipe.input)
}

/** The first weapon a stock holds, if any. */
function weaponIn(stock: Stock): Weapon | undefined {
  return WEAPONS.find((w) => (stock[w] ?? 0) > 0)
}

/**
 * A weapon lies on the smithy's pile: an unarmed adult working there, or idle on its tile, picks
 * it up. Whether one does.
 */
function takeFromSmithy(world: WorldState, smithy: Building, unarmed: Resident[]): boolean {
  const weapon = weaponIn(pileAt(world, smithy.x, smithy.y)?.goods ?? {})
  if (!weapon) return false
  const here = unarmed.find(
    (r) =>
      r.x === smithy.x &&
      r.y === smithy.y &&
      (r.order === null || (r.order.kind === 'workAt' && r.order.buildingId === smithy.id)),
  )
  if (!here) return false
  here.order = { kind: 'pickUp', from: { kind: 'ground' }, goods: { [weapon]: 1 } }
  return true
}

/**
 * Sends one unarmed adult to the storage for `goods`, unless one is on the way already: one idle
 * there takes them; else an idle adult, or failing that a worker, sets out.
 */
function fetch(storage: Building, unarmed: Resident[], goods: Stock): void {
  const at = (r: Resident) => r.x === storage.x && r.y === storage.y
  const there = unarmed.find((r) => r.order === null && at(r))
  if (there) {
    there.order = { kind: 'pickUp', from: { kind: 'storage', storageId: storage.id }, goods }
    return
  }
  const coming = unarmed.some(
    (r) =>
      r.order?.kind === 'walkTo' &&
      r.order.target.x === storage.x &&
      r.order.target.y === storage.y,
  )
  if (coming) return
  const sent =
    unarmed.find((r) => r.order === null) ?? unarmed.find((r) => r.order?.kind === 'workAt')
  if (sent) walkTo(sent, storage)
}

/**
 * The smith's part: an unarmed adult already working the smithy keeps at it; one carrying the
 * spear's Iron and Wood with nothing to do goes there and makes a spear. Whether someone is on it.
 */
function smithing(world: WorldState, smithy: Building, unarmed: Resident[], input: Stock): boolean {
  const working = unarmed.some(
    (r) => r.order?.kind === 'workAt' && r.order.buildingId === smithy.id,
  )
  if (working) return true
  const carries = (r: Resident) =>
    Object.entries(input).every(([good, n]) => (r.carried[good as keyof Stock] ?? 0) >= n)
  const smith = unarmed.find(
    (r) =>
      carries(r) &&
      (r.order === null ||
        (r.order.kind === 'walkTo' &&
          r.order.target.x === smithy.x &&
          r.order.target.y === smithy.y)),
  )
  if (!smith) return false
  if (smith.order !== null) return true
  if (smith.x !== smithy.x || smith.y !== smithy.y) {
    walkTo(smith, smithy)
    return true
  }
  if (workProblem(world, smith, SMITHY_WEAPON) !== undefined) return false
  startWork(smith, smithy, SMITHY_WEAPON)
  return true
}

/**
 * An NPC city closes its gates while an armed outsider (anyone armed not of the city) stands
 * within `NPC_GATE_WATCH_RANGE` of one of them, and opens them again once none does
 * (`CONTEXT.md`: NPC city, Walls in combat). Its own residents pass them either way.
 */
function watchGates(world: WorldState, city: City, size: number): void {
  const gates = world.buildings.filter((b) => b.cityId === city.id && b.kind === 'gate' && !b.site)
  if (gates.length === 0) return
  const near = world.residents.some(
    (r) =>
      r.health > 0 &&
      isArmed(r) &&
      wallSideOf(r) !== city.id &&
      gates.some((g) => wrapDistance(size, r, g) <= NPC_GATE_WATCH_RANGE),
  )
  for (const g of gates) {
    if (near) g.closed = true
    else delete g.closed
  }
}
