import {
  NPC_GATE_WATCH_RANGE,
  NPC_SMITHY_WEAPON,
  TRADE_ORG_ARMY,
  npcSoldierTarget,
  tradeOrgArmyWanted,
  WEAPONS,
  canWork,
  carryCapacity,
  stockWeight,
  contractOf,
  warehouseKeeps,
  defendsCity,
  inCityArea,
  isArmed,
  punishers,
  recipeFor,
  wallSide,
  allied,
  workProblem,
  wrapDistance,
  type Building,
  type City,
  type Resident,
  type Stock,
  type Weapon,
  type WorldState,
  buildingPile,
  isAt,
} from '@csp/shared'
import { caravanCrew } from './caravans.js'
import { attackOrder } from './combat.js'
import { knownThieves } from './crimes.js'
import { stopWork, walkTo } from './npc-behaviour.js'
import { foundingParty } from './npc-founding.js'
import { startWork } from './work.js'

/**
 * One tick of NPC cities defending themselves (`CONTEXT.md`: NPC city, Combat, Trading post):
 * every city run by the game sends its armed residents in its area after attackers there, a
 * trading post's after the thieves it knows of too; one that isn't the Trade Organization's also
 * keeps soldiers by its size and closes its gates while armed outsiders are near, a trading post
 * keeps soldiers by its size, and the Trade Org HQ builds its army (`tradeOrgArmyTarget`). Like
 * the rest of an NPC city's behaviour it only gives orders a Player could give
 * (ADR 0002), or opens and closes its own gates as a realm does. Run before `stepNpcCities`, so
 * the work it hands out passes its soldiers by. `size` is the map's.
 */
export function stepNpcDefence(world: WorldState, size: number): void {
  // A caravan's crew is run by its caravan, a hired-out resident by the hirer, a
  // punisher by its punishment.
  const crew = caravanCrew(world)
  const away = punishers(world)
  for (const city of world.cities) {
    if (city.realmId !== null) continue
    const people = world.residents.filter(
      (r) =>
        r.owner === null &&
        r.cityId === city.id &&
        r.health > 0 &&
        !crew.has(r.id) &&
        !away.has(r.id) &&
        !contractOf(world, r.id),
    )
    fightAttackers(world, city, people, size)
    const adults = people.filter((r) => canWork(r, world.tick)).length
    if (city.tradeOrg === 'hq') {
      // Its army's weapons come from its goods warehouse, which keeps them in stock.
      const goods = world.buildings.find(
        (b) =>
          b.cityId === city.id &&
          warehouseKeeps(world, b).some((g) => WEAPONS.includes(g as Weapon)),
      )
      keepSoldiers(
        world,
        city,
        people,
        tradeOrgArmyTarget(adults, tradeOrgArmyWanted(world)),
        goods,
      )
    }
    if (city.tradeOrg === 'post') {
      // A trading post's warehouse keeps weapons in stock (`CONTEXT.md`: Stock floor).
      const warehouse = world.buildings.find((b) => b.cityId === city.id && b.kind === 'warehouse')
      keepSoldiers(world, city, people, npcSoldierTarget(adults), warehouse)
    }
    if (city.tradeOrg) continue
    const storage = world.buildings.find(
      (b) => b.cityId === city.id && b.kind === 'storage' && !b.site,
    )
    keepSoldiers(world, city, people, npcSoldierTarget(adults), storage)
    watchGates(world, city, size)
  }
}

/**
 * How many soldiers the Trade Org HQ keeps (`CONTEXT.md`: Trade Org army): as many as it `wants`
 * (`tradeOrgArmyWanted`), but never so many that fewer than `TRADE_ORG_ARMY.workers` of its
 * `adults` are left to work.
 */
export function tradeOrgArmyTarget(adults: number, wanted = TRADE_ORG_ARMY.size): number {
  return Math.max(0, Math.min(wanted, adults - TRADE_ORG_ARMY.workers))
}

/**
 * Attackers in a city's area (`CONTEXT.md`: Combat, Walls in combat): residents there going after
 * one of its residents on their own account (not fighting back at one who hit them), striking
 * one of its walls or gates to break it, or climbing one.
 */
export function attackersOf(world: WorldState, city: City, size: number): Resident[] {
  const own = (id: string) => {
    const t = world.residents.find((x) => x.id === id)
    return !!t && t.owner === null && t.cityId === city.id
  }
  const ownWall = (id: string) =>
    world.buildings.some(
      (b) => b.id === id && b.cityId === city.id && (b.kind === 'wall' || b.kind === 'gate'),
    )
  return world.residents.filter((r) => {
    if (r.health <= 0 || (r.owner === null && r.cityId === city.id)) return false
    const o = r.order
    const attacking =
      (o?.kind === 'attack' && !o.defending && (own(o.targetId) || ownWall(o.targetId))) ||
      (o?.kind === 'climb' && ownWall(o.wallId))
    return attacking && inCityArea(world, city, r.x, r.y, size)
  })
}

/**
 * The thieves a trading post goes after (`CONTEXT.md`: Trading post): the living culprits of
 * thefts from it that it knows of or one of its residents saw, standing in its area.
 */
export function thievesOf(world: WorldState, city: City, size: number): Resident[] {
  const thieves = knownThieves(world, city)
  return world.residents.filter(
    (r) => thieves.has(r.id) && r.health > 0 && inCityArea(world, city, r.x, r.y, size),
  )
}

/**
 * A city's soldiers fight attackers in its area on their own (`CONTEXT.md`: Combat): each of its
 * defenders there (`defendsCity`) not already fighting goes after the nearest attacker, a trading
 * post's after the nearest thief it knows of too (`thievesOf`).
 */
function fightAttackers(world: WorldState, city: City, people: Resident[], size: number): void {
  const attackers = attackersOf(world, city, size)
  if (city.tradeOrg === 'post') attackers.push(...thievesOf(world, city, size))
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
 * An NPC city keeps `target` soldiers (`CONTEXT.md`: NPC city, Soldier, Trade Org army): its
 * armed adults are its soldiers and stop working (the city then brings them home). While it has
 * too few, it arms one more adult at a time: with a weapon from `storage` (its storage, the HQ's
 * goods warehouse), else with a spear from its smithy, which they make themselves from Iron and
 * Wood they take from the storage, and pick up from the pile on its tile once it is made.
 */
function keepSoldiers(
  world: WorldState,
  city: City,
  people: Resident[],
  target: number,
  storage: Building | undefined,
): void {
  // The armed member of a founding party goes with it (`CONTEXT.md`: Founding), not counted here.
  const party = new Set(foundingParty(world.cityPlans[city.id]))
  const adults = people.filter((r) => canWork(r, world.tick) && !party.has(r.id))
  const soldiers = adults.filter(isArmed)
  for (const r of soldiers) {
    if (r.order?.kind === 'workAt') stopWork(r)
    else delete r.script
  }
  if (soldiers.length >= target) return
  const unarmed = adults.filter((r) => !isArmed(r) && r.order?.kind !== 'attack')
  if (unarmed.length === 0) return

  const smithy = world.buildings.find(
    (b) =>
      b.kind === 'smithy' &&
      !b.site &&
      (b.cityId === city.id || (city.workplaceIds ?? []).includes(b.id)),
  )
  if (smithy && takeFromSmithy(world, smithy, unarmed)) return
  const weapon = storage && weaponIn(storage.stock ?? {})
  if (storage && weapon) {
    fetch(world, storage, unarmed, { [weapon]: 1 })
    return
  }
  const recipe = recipeFor('smithy', NPC_SMITHY_WEAPON)
  if (!smithy || !storage || !recipe) return
  if (smithing(world, smithy, unarmed, recipe.input)) return
  const stock = storage.stock ?? {}
  const enough = Object.entries(recipe.input).every(
    ([good, n]) => (stock[good as keyof Stock] ?? 0) >= n,
  )
  if (enough) fetch(world, storage, unarmed, recipe.input)
}

/** The first weapon a stock holds, if any. */
function weaponIn(stock: Stock): Weapon | undefined {
  return WEAPONS.find((w) => (stock[w] ?? 0) > 0)
}

/**
 * A weapon lies on the smithy's pile: an unarmed adult working there, or idle at it, picks it
 * up. Whether one does.
 */
function takeFromSmithy(world: WorldState, smithy: Building, unarmed: Resident[]): boolean {
  const weapon = weaponIn(buildingPile(world, smithy)?.goods ?? {})
  if (!weapon) return false
  const here = unarmed.find(
    (r) =>
      isAt(r, smithy) &&
      (r.order === null || (r.order.kind === 'workAt' && r.order.buildingId === smithy.id)),
  )
  if (!here) return false
  here.order = { kind: 'pickUp', from: { kind: 'ground' }, goods: { [weapon]: 1 } }
  return true
}

/**
 * Sends one unarmed adult to the storage for `goods`, unless one is on the way already: one idle
 * there takes them; else an idle adult, or failing that a worker, sets out. Only adults with room
 * left for `goods` go, so one laden with a load can't stand at the storage for ever.
 */
function fetch(world: WorldState, storage: Building, unarmed: Resident[], goods: Stock): void {
  const room = (r: Resident) =>
    stockWeight(r.carried) + stockWeight(goods) <= carryCapacity(r, world.tick)
  unarmed = unarmed.filter(room)
  const at = (r: Resident) => isAt(r, storage)
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
  if (sent) {
    delete sent.script
    walkTo(sent, storage)
  }
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
  if (!isAt(smith, smithy)) {
    walkTo(smith, smithy)
    return true
  }
  if (workProblem(world, smith, NPC_SMITHY_WEAPON) !== undefined) return false
  startWork(smith, smithy, NPC_SMITHY_WEAPON)
  return true
}

/**
 * An NPC city closes its gates while an armed outsider (anyone armed not of the city or its
 * alliance) stands within `NPC_GATE_WATCH_RANGE` of one of them, and opens them again once none
 * does (`CONTEXT.md`: NPC city, Walls in combat). Its own residents and allies pass them either
 * way.
 */
function watchGates(world: WorldState, city: City, size: number): void {
  const gates = world.buildings.filter((b) => b.cityId === city.id && b.kind === 'gate' && !b.site)
  if (gates.length === 0) return
  const near = world.residents.some(
    (r) =>
      r.health > 0 &&
      isArmed(r) &&
      !allied(world, city.id, wallSide(r) ?? '') &&
      gates.some((g) => wrapDistance(size, r, g) <= NPC_GATE_WATCH_RANGE),
  )
  for (const g of gates) {
    if (near) g.closed = true
    else delete g.closed
  }
}
