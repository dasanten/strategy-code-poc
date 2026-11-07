import {
  GOOD_WEIGHT,
  HOME_FOOD_LOW,
  NPC_SMITHY_WEAPON,
  RECIPES,
  carryCapacity,
  hasInput,
  recipeFor,
  stockWeight,
  type CityJob,
  type ScriptMemory,
  OWN_FOOD,
  PROTECTION,
  WALK_TICKS_PER_TILE,
  WEAPONS,
  WORK_OUTPUT_PER_DAY,
  breedersAt,
  breedingPair,
  canWork,
  cityResidents,
  contractOf,
  inCityArea,
  isArmed,
  isAt,
  isDown,
  npcHorsesWanted,
  ownsHorse,
  putAwayUnits,
  setOutFood,
  tileIndex,
  unitsThatFit,
  warehouseKeeps,
  wrapDistance,
  type Building,
  type City,
  type CityPlan,
  type Good,
  type Resident,
  type ResidentOrder,
  type Stock,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import {
  cityGrows,
  cityProject,
  isBuilder,
  noStorageYet,
  noFarm,
  npcBuilders,
  stopBuildersWhoCantGoOn,
  takePart,
} from './npc-growth.js'
import {
  Places,
  foodShort,
  planCity,
  planDue,
  projectDone,
  runResidents,
  workplaceOf,
} from './npc-plan.js'
import { chainStore, holdsBatch, warehouseFor } from './npc-chain.js'
import { foundDaughter, foundingParty, stepFounders } from './npc-founding.js'
import { nextStop, sharePatrols } from './npc-patrols.js'
import { freeSoldiers, soldierPosts, standsPosts, type SoldierPost } from './npc-posts.js'
import { reviveTarget, runReviver } from './npc-revive.js'
import { layRoad, onRoadWork, type WayFinder } from './npc-roads.js'
import { giveUpSite, sendScout, stepScouts } from './npc-scouts.js'
import { startFeeding, steerFeeder } from './npc-stable.js'
import { runTrader } from './npc-trader.js'
import type { Invariant } from './invariants.js'
import { hash } from './residents.js'
import { refillSource } from './survival.js'
import { walkTime } from './walk-time.js'

/**
 * The orders an NPC city gives its residents: only kinds a Player's order can give too
 * (ADR 0002), so the city does nothing a Player's residents couldn't.
 */
export const NPC_ORDER_KINDS: readonly ResidentOrder['kind'][] = [
  'walkTo',
  'pickUp',
  'drop',
  'store',
  'fetch',
  'workAt',
  'build',
  'tearDown',
  'breed',
  'attack',
  'trade',
  'feed',
]

/**
 * Whether a resident is run by an NPC city: they live in one and belong to no realm, and no
 * mercenary contract rents them out (`CONTEXT.md`: Trade Org army).
 */
export function runByNpcCity(world: WorldState, r: Resident): boolean {
  if (r.owner !== null || r.cityId === null || contractOf(world, r.id)) return false
  return world.cities.some((c) => c.id === r.cityId && c.realmId === null)
}

/**
 * One tick of NPC city behaviour (`CONTEXT.md`: NPC city): each city run by the game keeps
 * itself alive. It only gives its residents orders, which request actions like a Player's
 * orders do (ADR 0002); the world resolves them later in the tick. Run before the actions are
 * requested. `size` is the map's. A city whose planning pass is due plans (`planCity`, ADR 0016),
 * with `terrain` picking its project too and `ways` finding the ways of its roads; the others go by
 * their plan. Plans of cities the game no longer runs are dropped. Returns the milliseconds spent
 * planning, for the tick health.
 */
export function stepNpcCities(
  world: WorldState,
  size: number,
  terrain?: TerrainMap,
  ways?: WayFinder,
): number {
  const cities = new Map(world.cities.map((c) => [c.id, c]))
  for (const id of Object.keys(world.cityPlans)) {
    const city = cities.get(id)
    if (!city || city.realmId !== null) delete world.cityPlans[id]
  }
  const residents = runResidents(world)
  const buildings = new Map(world.buildings.map((b) => [b.id, b]))
  let planMs = 0
  for (const city of world.cities) {
    if (city.realmId !== null) continue
    const people = residents.get(city.id)
    if (people) planMs += runCity(world, city, people, size, buildings, terrain, ways)
  }
  return planMs
}

/**
 * What an NPC city does each tick: plans when its pass is due (`planCity`); moves its founding
 * party to the daughter once the town hall stands (`foundDaughter`), else sends it on its way
 * (`stepFounders`), apart from everyone else; stops workers who run low on food where there is
 * none, carriers home with their load stored, builders stuck or out of materials (with no
 * storage yet, everyone builds, `npcBuilders`), breeders who are done and workers at a smelter or
 * smithy with nothing left to process and none in the store, so they get their next job (with
 * some there, one of them fetches it by the Work default); moves a worker whose plan puts
 * them elsewhere, or nowhere, and one taken off its road crew; takes a worker on a bare work-at order
 * onto the Work default (`workByDefault`); then gives each idle adult what comes first: its trader
 * goes on with their run (`runTrader`); a resident carrying a child puts any load away and stands at
 * a house (`standIdle`); a reviver goes to the Down resident they are to revive (`runReviver`), called off if they were
 * walking there and that one is up or dead; one on its road crew takes the next step of its road
 * (`layRoad`); one
 * carrying materials the project needs takes them to its site; a load of goods goes into the
 * storage, a Trade Org city's into its warehouse (`stowing`); they take `OWN_FOOD` from the
 * storage before they set out; a planned feeder feeds its
 * stable (`startFeeding`); one of them breeds the city's horses (`breedHorses`); a planned builder takes their part in the project (`takePart`),
 * picking the next one once it is finished; a planned worker at a workplace that processes goods
 * first takes its input from the storage (`takeInput`), and waits at home while the storage holds
 * none; a planned worker runs the game's Work default at their workplace (`runNpcScripts`), which
 * carries the output to the storage
 * (`CONTEXT.md`: Carrying the output), taking the Food for the walk and their first days there
 * from the storage first (`takeSetOutFood`); a planned scout runs the Explore default
 * (`CONTEXT.md`: Scout), and one the pass called off comes home first with what they saw
 * (`stepScouts`); with nothing to do they stand at a house (`standIdle`), and take no Food to set
 * out with. Its soldiers (armed adults) are put to no work and no building (`stepNpcDefence`), and
 * go to their posts (`standPost`), a few on a round in turns (`sharePatrols`), a Trade Org city's
 * home. Children stand at a house too, and refill
 * there. Returns the milliseconds spent planning.
 */
function runCity(
  world: WorldState,
  city: City,
  people: Resident[],
  size: number,
  buildings: Map<string, Building>,
  terrain?: TerrainMap,
  ways?: WayFinder,
): number {
  let planMs = 0
  let plan: CityPlan | undefined = world.cityPlans[city.id]
  if (plan) stepScouts(world, city, plan, people, size)
  if (planDue(world, city)) {
    const start = performance.now()
    plan = planCity(world, city, terrain, people, ways)
    planMs += performance.now() - start
  }
  const storage = world.buildings.find(
    (b) => b.cityId === city.id && b.kind === 'storage' && !b.site,
  )
  // Its founding party (`CONTEXT.md`: Founding) moves to the daughter once the town hall stands,
  // and goes by the founding until then, apart from the rest.
  if (plan && foundDaughter(world, city, plan)) people = people.filter((r) => r.cityId === city.id)
  const party = new Set(foundingParty(plan))
  if (plan && party.size > 0) {
    stepFounders(
      world,
      city,
      plan,
      people.filter((r) => party.has(r.id)),
      storage,
      size,
    )
  }
  // Materials and a smith's input: a Trade Org city's from its warehouse (`chainStore`).
  const store = chainStore(world, city)
  const adults = people.filter((r) => canWork(r, world.tick) && !isDown(r) && !party.has(r.id))
  const jobs = plan?.jobs ?? {}
  let standing: Building[] | undefined
  const houses = () => (standing ??= housesToStandAt(world, city))

  stopBuildersWhoCantGoOn(world, adults, store)
  for (const r of adults) {
    // On alarm, they get back to all this when their Alarm script hands back.
    if (r.script?.task === 'alarm') continue
    sendToWarehouse(world, city, r)
    const o = r.order
    const busy = o?.kind === 'workAt' || o?.kind === 'build' || o?.kind === 'tearDown'
    if (busy && lowOnFood(r) && !refillSource(world, r, size)) stopWork(r)
    // Home at the storage with the load stored, a carrier is free for whatever the city needs
    // most (building, pairing), else back to work; one bringing the crew's Food back
    // (`CONTEXT.md`: Crew food) goes back by the Work default.
    const carry = r.script?.scriptId === 0 ? r.script.memory.carry : undefined
    const carrying = typeof carry === 'object' && carry !== null && !Array.isArray(carry)
    const bringsCrewFood = carrying && typeof carry.crewFood === 'number' && carry.crewFood >= 1
    if (
      carrying &&
      carry.stored === true &&
      !bringsCrewFood &&
      r.order?.kind !== 'store' &&
      storage &&
      isAt(r, storage, size)
    ) {
      stopWork(r)
    }
    // Stuck in the Build default (the site out of reach), a builder is free; built or gone, the
    // script ended itself.
    const built = r.script?.scriptId === 0 && r.script.task === 'build' ? r.script.memory : null
    if (built && built.stuck === true) stopWork(r)
    // No way to a site on a far node: the city gives its sector up (`CONTEXT.md`: Scout). A tile of
    // road is no such site: the nodes out there are as good as they were.
    if (built && !onRoadWork(r) && noWayOut(r, built)) {
      if (giveUpSite(world, city, built.at, size)) stopWork(r)
    }
    // Done breeding (a foal born, or the breeding stopped), a breeder is free too.
    const bred = r.script?.scriptId === 0 && r.script.task === 'breed' ? r.script.memory : null
    if (bred && bred.done === true) stopWork(r)
    // The pass just now put them at another workplace, or to building, or let them go. Only
    // then: between passes someone else may have put them to work (a smithy forging their spear).
    const job = jobs[r.id]
    // The pass just now gave them something to do: they don't finish the walk to their house.
    if (plan?.plannedAt === world.tick && job && job.kind !== 'idle') {
      if (walkingToHouse(r, houses(), size)) r.order = null
    }
    const at = workplaceOf(r)
    const moved =
      job !== undefined && job.kind !== 'soldier' && at !== undefined && at !== job.buildingId
    if (moved && !r.carrying && plan?.plannedAt === world.tick) stopWork(r)
    // Off the road crew, they leave the road to it (`CONTEXT.md`: NPC road).
    if (onRoadWork(r) && job?.kind !== 'road' && plan?.plannedAt === world.tick) stopWork(r)
    // The pass just now called a scout off: they come home with what they saw, below.
    if (r.script?.task === 'explore' && plan?.plannedAt === world.tick && job?.kind !== 'scout') {
      stopWork(r)
    }
    if (job?.kind === 'revive') {
      // Whatever they were at, the pass just now sent them to the Down (`CONTEXT.md`: Reviving).
      const atWork = r.script || r.order?.kind === 'build' || r.order?.kind === 'tearDown'
      if (atWork && plan?.plannedAt === world.tick) stopWork(r)
      if (r.order?.kind === 'walkTo' && !reviveTarget(world, job)) r.order = null
    }
    // Done feeding the stable, a feeder is free too; one going on is told what they may take.
    if (steerFeeder(world, city, r, job, plan?.plannedAt === world.tick) === 'stop') stopWork(r)
    // At a workplace that processes goods with nothing left to process, one of them fetches more
    // by the Work default (`CONTEXT.md`: Fetching inputs) while the store holds a batch; with
    // none there, they get their next job.
    const place = at !== undefined && r.order?.kind === 'workAt' ? buildings.get(at) : undefined
    if (place && RECIPES[place.kind] && !inputLeft(world, place, r) && !inputIn(place, store)) {
      stopWork(r)
    }
    workByDefault(r, buildings)
  }

  const home = npcHome(world, city)
  const held = new Places(people)
  const passed = plan?.plannedAt === world.tick
  const stand = (r: Resident) => standIdle(world, city, r, houses(), home, size, passed)
  // Worked out at most once a tick, and only when a soldier is to be sent: most ticks none is.
  let posts: Map<string, SoldierPost> | undefined
  const postOf = (r: Resident) =>
    (posts ??= soldierPosts(world, city, freeSoldiers(world, city, adults), size, terrain)).get(r.id)
  const hasPosts = standsPosts(world, city)
  if (passed && plan) sharePatrols(world, city, plan, adults, size, terrain)
  // The road crew is apart from its builders (`CONTEXT.md`: NPC road).
  const crew = adults.filter((r) => jobs[r.id]?.kind === 'road')
  const building = adults.filter((r) => isBuilder(r) && jobs[r.id]?.kind !== 'road')
  let free = npcBuilders(world, city) - building.length
  // The project, picked anew once the planned one is finished: a site search, so once a tick at most.
  let checked = false
  const project = () => {
    if (!plan || !terrain || !home) return undefined
    if (!checked && plan.project && projectDone(world, plan.project)) {
      const start = performance.now()
      const next =
        !foodShort(world, city) || noFarm(world, city)
          ? cityProject(world, city, home, terrain, cityGrows(world, city, adults))
          : undefined
      if (next) plan.project = next
      else delete plan.project
      planMs += performance.now() - start
    }
    checked = true
    return plan.project
  }

  for (const r of adults) {
    // The pass just now gave a soldier another post (one on the hall was called away): a walk to
    // their old one ends here. One taking a load to the storage does that first.
    if (passed && hasPosts && isArmed(r) && walkingOffPost(r, postOf(r), size)) r.order = null
    if (r.order !== null || r.script) continue
    // A scout called off comes home with what they saw before anything else (`CONTEXT.md`: Scout),
    // but for one of the city's Down, who can't wait; they come home after.
    if (
      plan?.scouts?.[r.id] &&
      jobs[r.id]?.kind !== 'scout' &&
      jobs[r.id]?.kind !== 'revive' &&
      home &&
      !inCityArea(world, city, r.x, r.y, size)
    ) {
      walkTo(r, home)
      continue
    }
    const run = city.tradeOrg ? undefined : plan?.traders?.find((t) => t.residentId === r.id)
    if (run) {
      runTrader(world, city, plan!, run, r, storage, size)
      continue
    }
    // Carrying a child, they get no work and stand at a house, where they take their meals; a load
    // goes into the storage first, or their hands may have no room for one.
    if (r.carrying) {
      const stow = stowing(world, city, r, storage)
      if (stow) putAway(r, stow.to, stow.load, size)
      else stand(r)
      continue
    }
    if (runReviver(world, r, jobs[r.id], storage, size)) continue
    if (jobs[r.id]?.kind === 'road' && plan && layRoad(world, city, plan, r, crew, store, size)) {
      continue
    }
    if (free > 0 && (!isArmed(r) || noStorageYet(world, city)) && carriesMaterials(r, city)) {
      const p = project()
      if (p && takePart(world, r, p, store, true)) {
        free--
        continue
      }
    }
    const stow = stowing(world, city, r, storage, inputOf(buildings, jobs[r.id]))
    if (stow) {
      putAway(r, stow.to, stow.load, size)
      continue
    }
    const job = jobs[r.id]
    const soldier = isArmed(r) || job?.kind === 'soldier'
    // Food to set out with is for those who set out: one with nothing to do would walk back for it
    // after every meal, and eats where they stand (`CONTEXT.md`: Refilling at home).
    const standsAtHouse = !soldier && (!job || job.kind === 'idle') && houses().length > 0
    const onPost = hasPosts && isArmed(r)
    const food = storage?.stock?.food ?? 0
    if (storage && food > 0 && (r.carried.food ?? 0) < OWN_FOOD && !standsAtHouse && !onPost) {
      if (isAt(r, storage, size)) {
        const units = Math.min(food, OWN_FOOD - (r.carried.food ?? 0))
        const from = { kind: 'storage' as const, storageId: storage.id }
        r.order = { kind: 'pickUp', from, goods: { food: units } }
      } else walkTo(r, storage)
      continue
    }
    if (!soldier && job?.kind === 'feed' && startFeeding(world, city, r, job)) continue
    if (!soldier && breedHorses(world, city, r)) continue
    if (!soldier && plan && job?.kind === 'scout' && !city.scouted?.done) {
      sendScout(plan, r)
      continue
    }
    if (!soldier && job?.kind === 'build' && free > 0) {
      const p = project()
      if (p && takePart(world, r, p, store, false)) {
        free--
        continue
      }
    }
    if (!soldier && job?.buildingId !== undefined) {
      const place = world.buildings.find((b) => b.id === job.buildingId)
      if (place && !place.site && held.room(place) > 0) {
        const input = inputOf(buildings, job)
        if (input && !takeInput(world, r, input, store, size)) {
          if (home && !inCityArea(world, city, r.x, r.y, size)) walkTo(r, home)
          continue
        }
        if (r.order !== null) continue
        if (!storage || takeSetOutFood(world, r, place, storage, size, terrain)) {
          putToWork(r, place)
          held.take(place)
        }
        continue
      }
    }
    const stop = onPost && plan ? nextStop(plan, r) : undefined
    if (stop) walkTo(r, stop)
    else if (onPost) standPost(world, city, r, postOf, home, size, passed)
    else if (soldier) comeHome(world, city, r, home, size)
    else stand(r)
  }
  // A city with no house leaves its children be, as they refill anywhere in its area.
  if (houses().length > 0) {
    for (const r of people) {
      if (!canWork(r, world.tick) && !isDown(r) && r.order === null && !r.script) stand(r)
    }
  }
  return planMs
}

/** The finished houses an NPC city's idle stand at (`standIdle`); a Trade Org city's don't. */
function housesToStandAt(world: WorldState, city: City): Building[] {
  if (city.tradeOrg) return []
  return world.buildings.filter((b) => b.kind === 'house' && !b.site && b.cityId === city.id)
}

/** Sends a resident outside their city's area home (`npcHome`). */
function comeHome(
  world: WorldState,
  city: City,
  r: Resident,
  home: Building | undefined,
  size: number,
): void {
  if (home && !inCityArea(world, city, r.x, r.y, size)) walkTo(r, home)
}

/**
 * A resident with nothing to do goes to stand at a house (`CONTEXT.md`: Standing idle), the one
 * their id hashes to, so nothing new is stored: one walk, then nothing. One at any of the city's
 * houses stays, so a new house moves nobody. In the city's area they set off only when its pass
 * just ran (`passed`), so one with no way there tries again an hour on and not every tick. With no
 * house they come home (`comeHome`).
 */
function standIdle(
  world: WorldState,
  city: City,
  r: Resident,
  houses: readonly Building[],
  home: Building | undefined,
  size: number,
  passed: boolean,
): void {
  if (houses.length === 0) return comeHome(world, city, r, home, size)
  if (!passed && inCityArea(world, city, r.x, r.y, size)) return
  if (!houses.some((h) => isAt(r, h, size))) walkTo(r, houses[hash(r.id) % houses.length]!)
}

/**
 * A soldier with nothing to do goes to their post (`CONTEXT.md`: Soldier posts), and one on it stays.
 * In the city's area they set off only when its pass just ran (`passed`), as for `standIdle`, so one
 * back from an alarm walks there within the game hour, and one with no way there tries again an hour
 * on. With no post they come home (`comeHome`).
 */
function standPost(
  world: WorldState,
  city: City,
  r: Resident,
  postOf: (r: Resident) => SoldierPost | undefined,
  home: Building | undefined,
  size: number,
  passed: boolean,
): void {
  if (!passed && inCityArea(world, city, r.x, r.y, size)) return
  const post = postOf(r)
  if (!post) return comeHome(world, city, r, home, size)
  if (!post.tiles.has(tileIndex(size, r.x, r.y))) walkTo(r, post.at)
}

/** Whether a soldier is on a walk that doesn't end on their `post`, with no load to put away first. */
function walkingOffPost(r: Resident, post: SoldierPost | undefined, size: number): boolean {
  const o = r.order
  if (o?.kind !== 'walkTo' || r.script || !post) return false
  return !post.tiles.has(tileIndex(size, o.target.x, o.target.y)) && haul(r) === undefined
}

/** Whether a resident is on a walk that ends at one of these houses. */
function walkingToHouse(r: Resident, houses: readonly Building[], size: number): boolean {
  const o = r.order
  return o?.kind === 'walkTo' && houses.some((h) => isAt(o.target, h, size))
}

/**
 * Whether a builder's walk out to their site ended short of it: the Build default gives the walk at
 * once and it only ends there or with no way. Away fetching, its own way back says (`stuck`).
 */
function noWayOut(
  r: Resident,
  memory: ScriptMemory,
): memory is ScriptMemory & { at: { x: number; y: number } } {
  const at = memory.at as { x?: unknown; y?: unknown } | null | undefined
  if (r.order !== null || memory.fetch != null || memory.food != null) return false
  return typeof at?.x === 'number' && typeof at.y === 'number' && (r.x !== at.x || r.y !== at.y)
}

/** Takes a load to a storage or warehouse: at it, the drop; away from it, the walk there first. */
function putAway(r: Resident, storage: Building, load: Stock, size: number): void {
  if (isAt(r, storage, size)) {
    r.order = { kind: 'drop', to: { kind: 'storage', storageId: storage.id }, goods: load }
  } else walkTo(r, storage)
}

/**
 * A worker on a bare work-at order, such as a dead Leader's whose script ended with their Player's
 * control, goes on by the Work default (`runNpcScripts`), from the tile they stand on. Otherwise
 * what they make never gets home (`CONTEXT.md`: Carrying the output): a farm's crew eats from its
 * pile while the storage runs out, and holds the places others could work.
 */
function workByDefault(r: Resident, buildings: Map<string, Building>): void {
  const o = r.order
  if (o?.kind !== 'workAt' || r.script) return
  const memory: ScriptMemory = { workplaceId: o.buildingId }
  const makes = o.makes ?? (buildings.get(o.buildingId)?.kind === 'smithy' && NPC_SMITHY_WEAPON)
  if (makes) memory.makes = makes
  r.script = { scriptId: 0, task: 'work', memory }
}

/**
 * Whether a resident carries goods a site could take: anything workplaces make but Food; in a Trade
 * Org city anything its warehouses take back (`backToWarehouse`), so Iron goes to a site that needs
 * it rather than back first.
 */
function carriesMaterials(r: Resident, city: City): boolean {
  return (Object.entries(r.carried) as [Good, number][]).some(
    ([good, units]) =>
      good !== 'food' &&
      units > 0 &&
      (WORK_OUTPUT_PER_DAY[good] !== undefined || (!!city.tradeOrg && backToWarehouse(good))),
  )
}

/**
 * Has one of the city's residents breed its horses (`CONTEXT.md`: Breeding, NPC horses): at the
 * first of its finished stables with two fed horses of the city in it, room for a foal and nobody
 * breeding there yet, they run the game's Breed horses default for that pair, which walks them
 * there. Only while the city has fewer than it wants, the foals on their way counted, and Food isn't
 * short, and never in the Trade Organization's cities. Whether they were given it.
 */
function breedHorses(world: WorldState, city: City, r: Resident): boolean {
  if (city.tradeOrg || foodShort(world, city)) return false
  const horses = world.horses.filter((h) => ownsHorse({ cityId: city.id }, h)).length
  const foals = cityResidents(world, city).filter((x) => x.script?.task === 'breed').length
  if (horses + foals >= npcHorsesWanted(world, city)) return false
  for (const stable of world.buildings) {
    if (stable.kind !== 'stable' || stable.site || stable.cityId !== city.id) continue
    const tending = world.residents.some(
      (x) => x.script?.task === 'breed' && x.script.memory.stableId === stable.id,
    )
    if (tending || breedersAt(world.residents, stable).length > 0) continue
    const pair = breedingPair(world, stable, { cityId: city.id })
    if (!pair) continue
    const memory = { stableId: stable.id, horseIds: pair.map((h) => h.id) }
    r.script = { scriptId: 0, task: 'breed', memory }
    return true
  }
  return false
}

/**
 * Before a resident sets out for a workplace, they take the Food for the walk there and back and
 * their first days of work (`setOutFood`; `CONTEXT.md`: Crew food, NPC city) from the storage
 * while it has Food and they carry less: at it, a pick-up of what they lack, as much as fits,
 * which the Work default given the same tick waits for (so an idle resident never puts the
 * surplus back, `haul`); away from it, the walk there first. The walk is reckoned from where they
 * stand, by the terrain when given, else by tiles. Whether they set out now, rather than walking
 * to the storage first.
 */
function takeSetOutFood(
  world: WorldState,
  r: Resident,
  place: Building,
  storage: Building,
  size: number,
  terrain?: TerrainMap,
): boolean {
  const food = storage.stock?.food ?? 0
  if (food <= 0) return true
  const walk = terrain
    ? walkTime(world, terrain, () => true, r, r, place)
    : wrapDistance(size, r, place) * WALK_TICKS_PER_TILE
  const short = setOutFood(walk) - (r.carried.food ?? 0)
  if (short <= 1e-9) return true
  if (!isAt(r, storage, size)) {
    walkTo(r, storage)
    return false
  }
  const units = Math.min(food, short, unitsThatFit(r, 'food', world.tick))
  if (units <= 0) return true
  const from = { kind: 'storage' as const, storageId: storage.id }
  r.order = { kind: 'pickUp', from, goods: { food: units } }
  return true
}

/**
 * A Trade Org city's carrier takes the load to the warehouse that keeps it (`warehouseFor`;
 * `CONTEXT.md`: Trading post, Trade Org HQ), so less of its stock comes from the floor: the Work
 * default picked the nearest storage, and before it stores the load the city names the warehouse
 * instead, as a Player names one by its storage param. A load of Food stays for the storage.
 */
function sendToWarehouse(world: WorldState, city: City, r: Resident): void {
  if (!city.tradeOrg || r.script?.scriptId !== 0) return
  const carry = r.script.memory.carry
  if (typeof carry !== 'object' || carry === null || Array.isArray(carry)) return
  if (carry.stored === true || !Array.isArray(carry.goods)) return
  const warehouse = warehouseFor(world, city, carry.goods as Good[])
  if (warehouse) carry.storageId = warehouse.id
}

/**
 * Puts one of the city's residents to work a workplace: they run the game's Work default for it
 * (`runNpcScripts`), which walks them to its anchor tile (`at`, so the walk starts while the
 * workplace is out of sight) and once there picks the footprint tile they stand on
 * (`CONTEXT.md`: Spreading over the footprint).
 */
export function putToWork(r: Resident, place: Building): void {
  const at = { x: place.x, y: place.y }
  const memory: ScriptMemory = { workplaceId: place.id, at }
  if (place.kind === 'smithy') memory.makes = NPC_SMITHY_WEAPON
  r.script = { scriptId: 0, task: 'work', memory }
}

/**
 * What one batch uses up at the workplace that processes goods a job is at (`RECIPES`; a smithy,
 * the city's weapon's); undefined for any other job.
 */
function inputOf(buildings: Map<string, Building>, job: CityJob | undefined): Stock | undefined {
  const place = job?.buildingId !== undefined ? buildings.get(job.buildingId) : undefined
  if (!place || !RECIPES[place.kind]) return undefined
  return recipeFor(place.kind, place.kind === 'smithy' ? NPC_SMITHY_WEAPON : undefined)?.input
}

/**
 * Whether a worker at a workplace that processes goods can go on (`CONTEXT.md`: Smelter,
 * Smithy): it has the input of a batch (`hasInput`), or they carry some of it still.
 */
function inputLeft(world: WorldState, place: Building, r: Resident): boolean {
  const recipe = recipeFor(place.kind, place.kind === 'smithy' ? NPC_SMITHY_WEAPON : undefined)
  if (!recipe || hasInput(world, place, recipe)) return true
  return Object.keys(recipe.input).some((g) => (r.carried[g as Good] ?? 0) > 0)
}

/** Whether a store holds a batch of what a workplace that processes goods uses up. */
function inputIn(place: Building, store: Building | undefined): boolean {
  const recipe = recipeFor(place.kind, place.kind === 'smithy' ? NPC_SMITHY_WEAPON : undefined)
  return recipe !== undefined && holdsBatch(store?.stock, recipe.input)
}

/**
 * Before a resident sets out for a workplace that processes goods, they take its `input` from
 * the storage, as many batches as fit beside the Food they set out with (`setOutFood` aside, a
 * game day's): at it, a pick-up; away from it, the walk there first. Whether they carry a batch,
 * or have just been given the pick-up (`r.order`); false while the storage holds no batch.
 */
function takeInput(
  world: WorldState,
  r: Resident,
  input: Stock,
  storage: Building | undefined,
  size: number,
): boolean {
  if (holdsBatch(r.carried, input)) return true
  if (!storage || !holdsBatch(storage.stock, input)) return false
  if (!isAt(r, storage, size)) {
    walkTo(r, storage)
    return true
  }
  const batch = stockWeight(input)
  const room = carryCapacity(r, world.tick) - stockWeight(r.carried) - OWN_FOOD * GOOD_WEIGHT.food
  let batches = Math.floor(room / batch)
  for (const [g, n] of Object.entries(input) as [Good, number][]) {
    batches = Math.min(batches, Math.floor((storage.stock?.[g] ?? 0) / n))
  }
  if (batches < 1) return false
  const goods: Stock = {}
  for (const [g, n] of Object.entries(input) as [Good, number][]) goods[g] = n * batches
  r.order = { kind: 'pickUp', from: { kind: 'storage', storageId: storage.id }, goods }
  return true
}

/** Ends a resident's work: their order, and the Work default they run, if any. */
export function stopWork(r: Resident): void {
  r.order = null
  delete r.script
}

/**
 * What a resident carries for the storage: the goods workplaces make, all but `OWN_FOOD` Food
 * to eat and the `input` of the workplace they go to process at; none if nothing. Weapons and
 * armour stay on them.
 */
export function haul(r: Resident, input?: Stock): Stock | undefined {
  const load: Stock = {}
  for (const [good, units] of Object.entries(r.carried) as [Good, number][]) {
    if (WORK_OUTPUT_PER_DAY[good] === undefined || input?.[good] !== undefined) continue
    const n = putAwayUnits(good, units)
    if (n > 0) load[good] = n
  }
  return Object.keys(load).length > 0 ? load : undefined
}

/**
 * Whether a Trade Org city's warehouse takes a good back from an idle resident (`CONTEXT.md`: Trade
 * Org HQ, Trading post): all but Food, which is for the storage they eat from, and the weapons and
 * armour that stay on them.
 */
function backToWarehouse(good: Good): boolean {
  const worn: readonly Good[] = [...WEAPONS, ...PROTECTION]
  return good !== 'food' && !worn.includes(good)
}

/**
 * What an idle resident has to put away and where it goes, if anything: in a Trade Org city what
 * its warehouses take back goes first, to the one that keeps it (`warehouseFor`), or its chain could
 * not use it (`chainStore`) and Iron, which `haul` leaves in hand, would stay there. The rest goes
 * to the storage (`haul`). `input` is what they go to process, which stays on them.
 */
function stowing(
  world: WorldState,
  city: City,
  r: Resident,
  storage: Building | undefined,
  input?: Stock,
): { to: Building; load: Stock } | undefined {
  if (city.tradeOrg) {
    const goods = (Object.keys(r.carried) as Good[]).filter(
      (g) => (r.carried[g] ?? 0) > 0 && backToWarehouse(g) && input?.[g] === undefined,
    )
    const to = warehouseFor(world, city, goods)
    if (to) {
      const keeps = warehouseKeeps(world, to)
      const load: Stock = {}
      for (const g of goods) if (keeps.includes(g)) load[g] = r.carried[g]
      return { to, load }
    }
  }
  const load = storage && haul(r, input)
  return storage && load && { to: storage, load }
}

/** Whether a resident carries less food than a resident at home takes meals at (`HOME_FOOD_LOW`). */
const lowOnFood = (r: Resident) => (r.carried.food ?? 0) < HOME_FOOD_LOW

/** Gives a resident an order to walk to a tile. */
export function walkTo(r: Resident, to: { x: number; y: number }): void {
  r.order = { kind: 'walkTo', target: { x: to.x, y: to.y }, path: null, progress: 0 }
}

/**
 * The residents of a city the game runs keep going (ADR 0004; `CONTEXT.md`: NPC city, Carrying),
 * once it has planned: none of them works by a bare work-at order, whose output would never get
 * home (`workByDefault`), and none carrying a child stands with no Food and hands too full for a
 * meal while the load could go into a storage. The tick a resident starts carrying doesn't count:
 * their city gives them the order the tick after.
 */
export const npcResidentsKeptGoing: Invariant = {
  name: 'npc-residents-kept-going',
  check(world) {
    const storages = new Set(
      world.buildings.flatMap((b) =>
        b.kind === 'storage' && !b.site && b.cityId ? [b.cityId] : [],
      ),
    )
    return world.residents.flatMap((r) => {
      if (r.cityId === null || r.script || r.downUntil !== undefined) return []
      const bare = r.order?.kind === 'workAt'
      const full =
        r.order === null &&
        !!r.carrying &&
        r.carrying.since < world.tick - 1 &&
        storages.has(r.cityId) &&
        (r.carried.food ?? 0) < 1 &&
        unitsThatFit(r, 'food', world.tick) === 0 &&
        haul(r) !== undefined
      if (!bare && !full) return []
      if (!world.cityPlans[r.cityId] || !canWork(r, world.tick) || !runByNpcCity(world, r))
        return []
      const what = bare
        ? 'works by a bare work-at order'
        : 'carries a child with no room for a meal'
      return [{ invariant: this.name, message: `NPC resident ${r.id} ${what}`, entityIds: [r.id] }]
    })
  },
}

/**
 * More than this many idle on one storage is a crowd (`npcIdleOffTheStorage`): some come to rest
 * there between passes, having just put a load away.
 */
const IDLE_CROWD = 12

/**
 * An NPC city with a house has no crowd of idle residents standing on its storage (ADR 0004;
 * `CONTEXT.md`: Standing idle): its pass sends them to its houses, and they don't come back for
 * Food. Soldiers aren't counted, nor those waiting at home with a job.
 */
export const npcIdleOffTheStorage: Invariant = {
  name: 'npc-idle-off-the-storage',
  check(world, terrain) {
    const storages = new Map<string, Building>()
    const housed = new Set<string>()
    for (const b of world.buildings) {
      if (b.site || !b.cityId) continue
      if (b.kind === 'house') housed.add(b.cityId)
      else if (b.kind === 'storage' && !storages.has(b.cityId)) storages.set(b.cityId, b)
    }
    const crowds = new Map<string, string[]>()
    for (const r of world.residents) {
      if (r.order !== null || r.script || r.cityId === null || isDown(r)) continue
      const storage = housed.has(r.cityId) ? storages.get(r.cityId) : undefined
      if (!storage || !isAt(r, storage, terrain.size)) continue
      const job = world.cityPlans[r.cityId]?.jobs[r.id]
      if (!canWork(r, world.tick) ? !world.cityPlans[r.cityId] : job?.kind !== 'idle') continue
      if (runByNpcCity(world, r)) crowds.set(r.cityId, [...(crowds.get(r.cityId) ?? []), r.id])
    }
    const standsAtHouses = (id: string) => !world.cities.find((c) => c.id === id)?.tradeOrg
    return [...crowds]
      .filter(([id, crowd]) => crowd.length > IDLE_CROWD && standsAtHouses(id))
      .map(([id, entityIds]) => ({
        invariant: this.name,
        message: `${entityIds.length} idle residents of ${id} stand on its storage`,
        entityIds,
      }))
  },
}

/** Where an NPC city's residents go home to: its finished storage, else its town hall. */
export function npcHome(world: WorldState, city: City): Building | undefined {
  return (
    world.buildings.find((b) => b.cityId === city.id && b.kind === 'storage' && !b.site) ??
    world.buildings.find((b) => b.id === city.townHallId)
  )
}
