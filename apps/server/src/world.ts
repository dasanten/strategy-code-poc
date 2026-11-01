import {
  SCRIPT_VIEW_CHANGES,
  isPassableTerrain,
  terrainAt,
  wrap,
  type Horse,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { placeNpcCities } from './npc-cities.js'
import { placeTradeOrgHq } from './trade-org.js'
import { placeTradingPosts } from './trading-posts.js'
import { placeResourceNodes } from './node-gen.js'
import { requestBuilding, resolveBuilding } from './building.js'
import { stepHorses } from './horses.js'
import { requestTearingDown, resolveTearingDown } from './teardown.js'
import { requestBreeding, resolveBreeding } from './breeding.js'
import { requestCarrying, resolveCarrying } from './carrying.js'
import { requestStoring } from './storing.js'
import { requestHauling } from './hauling.js'
import { requestRoadMaterials } from './road-line.js'
import type { Walking } from './walking.js'
import type { TickPhase, TickTimer } from './tick.js'
import { stepSpoilage } from './spoilage.js'
import { stepStockFloor } from './stock-floor.js'
import { stepRefill, stepSurvival, type SurvivalResult } from './survival.js'
import { stepAging, type AgingResult } from './aging.js'
import { requestWork, resolveWork } from './work.js'
import { stepTeaching } from './teaching.js'
import { stepTraining } from './training.js'
import { requestBirths, resolveBirths } from './pairing.js'
import { stepAlliances } from './alliances.js'
import { requestClimbing, resolveClimbing } from './climbing.js'
import { stepRiders } from './riding.js'
import { stepPassengers } from './passengers.js'
import { requestStrikes, resolveStrikes, type CombatResult } from './combat.js'
import { stepArmies } from './armies.js'
import { resolvePayments, stepContracts } from './contracts.js'
import { stepTradeOrgArmy } from './trade-org-army.js'
import { stepNpcHire } from './npc-hire.js'
import { stepPunishments } from './trade-org-punishment.js'
import { stepDirectives } from './directives.js'
import { resolvePurchases } from './buying.js'
import { resolveTrades } from './trading.js'
import { resolveBuyOffs } from './directives.js'
import { stepCrimes } from './crimes.js'
import { stepStanding } from './standing.js'
import { stepPersuasion } from './persuasion.js'
import { stepCaptures, type Capture } from './capture.js'
import { stepNpcCities } from './npc-behaviour.js'
import { runNpcScripts } from './script-runner.js'
import { placeCaravans, stepCaravans } from './caravans.js'
import { stepNpcDefence } from './npc-defence.js'
import { stepLastSeen } from './last-seen.js'
import { newSightPhase } from './sight.js'
import { stepRelocating } from './relocating.js'

/**
 * A new world: terrain's resource nodes and nobody yet. Each Player gets a realm and starting
 * city when they first connect (`foundStartingCity`).
 */
export function createWorld(terrain: TerrainMap, seed = 1): WorldState {
  return {
    tick: 0,
    seed,
    nextId: 1,
    residents: [],
    nodes: placeResourceNodes(terrain, seed),
    realms: [],
    cities: [],
    buildings: [],
    horses: [],
    carriages: [],
    piles: [],
    events: [],
    alliances: [],
    armies: [],
    contracts: [],
    caravans: [],
    deliveries: [],
    transfers: [],
    routeRobberies: {},
    crimes: [],
    standings: [],
    joinRequests: [],
    punishments: [],
    directives: [],
    lastSeen: {},
    // A new world's Players have nothing to be told of changes before it.
    scriptViewChanges: SCRIPT_VIEW_CHANGES.length,
    horseOffersClaimed: [],
    cityPlans: {},
  }
}

/**
 * A world as the world generator makes it for a new game: `createWorld`, with the Trade Org HQ
 * (`placeTradeOrgHq`), its NPC cities (`placeNpcCities`) and then its trading posts placed
 * (`placeTradingPosts`), with a caravan for each (`placeCaravans`).
 */
export function generateWorld(terrain: TerrainMap, seed = 1): WorldState {
  const world = createWorld(terrain, seed)
  placeTradeOrgHq(world, terrain)
  placeNpcCities(world, terrain)
  placeTradingPosts(world, terrain)
  placeCaravans(world)
  return world
}

export function isWalkable(terrain: TerrainMap, x: number, y: number): boolean {
  return isPassableTerrain(terrainAt(terrain, x, y))
}

/**
 * The walkable tile not in `occupied` closest to (x, y), searching outwards ring by ring across
 * the map's joins.
 * Throws if the whole map is full, which a real map never is.
 */
export function nearestFreeTile(
  terrain: TerrainMap,
  occupied: Set<string>,
  x: number,
  y: number,
): [number, number] {
  const free = (tx: number, ty: number) =>
    isWalkable(terrain, tx, ty) && !occupied.has(`${tx},${ty}`)
  for (let r = 0; r < terrain.size; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        const [tx, ty] = [wrap(x + dx, terrain.size), wrap(y + dy, terrain.size)]
        if (free(tx, ty)) return [tx, ty]
      }
    }
  }
  throw new Error('no free walkable tile left on the map')
}

export interface StepResult {
  /** Actions requested this tick. */
  actions: number
  /** Milliseconds the game-run cities spent planning (`planCity`; ADR 0016). */
  npcPlanMs: number
  /** Who starved and which realms ended through it this tick. */
  survival: SurvivalResult
  /** Blows struck this tick, who was killed and which realms ended through it. */
  combat: CombatResult
  /** Horses that starved this tick. */
  horsesDied: Horse[]
  /** Who died of old age and which realms ended through it, as the next tick begins. */
  aging: AgingResult
  /** Cities captured as the tick ended (`CONTEXT.md`: Capturing a city). */
  captures: Capture[]
  /** The NPC cities' residents' scripts that ran this tick (`runNpcScripts`), for tick health. */
  npcScriptRuns: number
}

/**
 * Advances the world by one tick (ADR 0002): residents get hungry, eat, heal or starve; so do
 * horses; food spoils at the end of each game day and Trade Org warehouses top up to their stock floor; caravans, NPC cities, the Trade Org army and its punishments give their residents orders; then their orders request actions (steps, then blows in fights, then climbing walls, then taking and
 * putting down goods, store, fetch, haul routes' and road orders' included, then paying for mercenary contracts, then buying NPC cities, then trading at Trade Org warehouses, then laying out and working on construction sites, then tearing down, then
 * working workplaces, then residents breeding horses, then pairs having children), and the world resolves them together. As the next tick begins, residents
 * age: the old die, and loads too heavy for declining Strength are put down; alliance leaves
 * whose delay ran out take effect; occupations of town halls run, and a city held long enough
 * changes realm (`stepCaptures`); then residents at
 * home, at their workplace or in an army by a carriage who run low on food take meals there, those of
 * a city captured this tick too; admin directives whose goals are all met end (`stepDirectives`); witnesses who got home make crimes known (`stepCrimes`); mercenary contracts end or break
 * (`stepContracts`); standing drifts toward neutral (`stepStanding`); armies
 * lose members who are gone and give the rest their orders for the next tick; the realms whose
 * turn it is bring their Last seen up to date (`stepLastSeen`); last, riders who
 * lost their horse get off it (`stepRiders`), and passengers who lost their carriage get off
 * (`stepPassengers`). Without `walking`
 * nobody moves. With a `timer`, the NPC planning (`npc`), the walking (`walking`), Last seen
 * (`lastSeen`) and all the rest (`rest`) are timed as the parts of the tick's `world` phase
 * (ADR 0004).
 */
export function stepWorld(
  world: WorldState,
  terrain: TerrainMap,
  walking?: Walking,
  timer?: Pick<TickTimer, 'time'>,
): StepResult {
  const time = <T>(phase: TickPhase, fn: () => T): T => (timer ? timer.time(phase, fn) : fn())
  // What the scripts saw is gone once the world steps (`SightCache`).
  newSightPhase(world)
  const { survival, horsesDied } = time('rest', () => {
    const survival = stepSurvival(world, terrain)
    const horsesDied = stepHorses(world, terrain)
    stepSpoilage(world)
    stepStockFloor(world)
    return { survival, horsesDied }
  })
  let npcPlanMs = 0
  const npcScriptRuns = time('npc', () => {
    stepCaravans(world, terrain.size)
    stepNpcDefence(world, terrain.size)
    stepTradeOrgArmy(world, terrain.size)
    stepNpcHire(world, terrain.size)
    stepPunishments(world, terrain.size)
    npcPlanMs = stepNpcCities(world, terrain.size, terrain)
    return runNpcScripts(world, terrain)
  })
  const steps = time('walking', () => {
    const steps = walking?.requestSteps(world) ?? []
    walking?.resolve(world, steps)
    return steps
  })
  const result = time('rest', () => stepRest(world, terrain, steps, survival, horsesDied))
  time('lastSeen', () => {
    // Who sees what has changed since the NPC scripts ran: Last seen and sync share the new sight
    // (`SightCache`). Nobody moves or changes hands after this.
    newSightPhase(world)
    stepLastSeen(world, terrain.size)
  })
  time('rest', () => {
    stepRiders(world)
    stepPassengers(world)
  })
  return { ...result, npcScriptRuns, npcPlanMs }
}

/**
 * The rest of `stepWorld` once the residents walked: everything else they do, then the tick turns,
 * up to Last seen.
 */
function stepRest(
  world: WorldState,
  terrain: TerrainMap,
  steps: unknown[],
  survival: SurvivalResult,
  horsesDied: Horse[],
): Omit<StepResult, 'npcScriptRuns' | 'npcPlanMs'> {
  // Relocating residents who stepped into their new city's area move in (`CONTEXT.md`: Relocate).
  stepRelocating(world, terrain)
  const strikes = requestStrikes(world, terrain.size)
  const combat = resolveStrikes(world, strikes, terrain.size)
  const climbs = requestClimbing(world)
  resolveClimbing(world, climbs, terrain)
  const carries = [
    ...requestCarrying(world),
    ...requestStoring(world),
    ...requestHauling(world, terrain.size),
    ...requestRoadMaterials(world),
  ]
  resolveCarrying(world, carries, terrain.size)
  const payments = resolvePayments(world)
  const purchases = resolvePurchases(world, terrain.size)
  const trades = resolveTrades(world, terrain.size)
  const buyOffs = resolveBuyOffs(world)
  const builds = requestBuilding(world)
  resolveBuilding(world, builds, terrain)
  const teardowns = requestTearingDown(world)
  resolveTearingDown(world, teardowns, terrain)
  const work = requestWork(world)
  resolveWork(world, work)
  stepTeaching(world, terrain.size)
  stepTraining(world, terrain.size)
  const breeding = requestBreeding(world)
  resolveBreeding(world, breeding, terrain.size)
  const births = requestBirths(world)
  resolveBirths(world, births)
  world.tick++
  const aging = stepAging(world, terrain.size)
  stepAlliances(world)
  const captures = stepCaptures(world, terrain.size)
  stepRefill(world, terrain.size)
  stepDirectives(world)
  stepCrimes(world, terrain.size)
  stepContracts(world)
  stepStanding(world)
  stepPersuasion(world, terrain.size)
  stepArmies(world, terrain.size)
  const actions =
    steps.length +
    strikes.length +
    climbs.length +
    carries.length +
    builds.length +
    teardowns.length +
    work.length +
    breeding.length +
    births.length +
    payments +
    purchases +
    trades +
    buyOffs
  return { actions, survival, combat, horsesDied, aging, captures }
}
