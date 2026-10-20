import {
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
import { requestCarrying, resolveCarrying } from './carrying.js'
import { requestHauling } from './hauling.js'
import { requestRoadMaterials } from './road-line.js'
import type { Walking } from './walking.js'
import { stepSpoilage } from './spoilage.js'
import { stepStockFloor } from './stock-floor.js'
import { stepRefill, stepSurvival, type SurvivalResult } from './survival.js'
import { stepAging, type AgingResult } from './aging.js'
import { requestWork, resolveWork } from './work.js'
import { requestBirths, resolveBirths } from './pairing.js'
import { stepAlliances } from './alliances.js'
import { requestClimbing, resolveClimbing } from './climbing.js'
import { requestStrikes, resolveStrikes, type CombatResult } from './combat.js'
import { stepArmies } from './armies.js'
import { resolvePayments, stepContracts } from './contracts.js'
import { stepTradeOrgArmy } from './trade-org-army.js'
import { resolvePurchases } from './buying.js'
import { stepCrimes } from './crimes.js'
import { stepCaptures, type Capture } from './capture.js'
import { stepNpcCities } from './npc-behaviour.js'
import { placeCaravans, stepCaravans } from './caravans.js'
import { stepNpcDefence } from './npc-defence.js'

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
    crimes: [],
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
}

/**
 * Advances the world by one tick (ADR 0002): residents get hungry, eat, heal or starve; so do
 * horses, and stables breed foals; food spoils at the end of each game day and Trade Org warehouses top up to their stock floor; caravans, NPC cities and the Trade Org army give their residents orders; then their orders request actions (steps, then blows in fights, then climbing walls, then taking and
 * putting down goods, haul routes' and road orders' included, then paying for mercenary contracts, then buying NPC cities, then laying out and working on construction sites, then tearing down, then
 * working workplaces, then pairs having children), and the world resolves them together. As the next tick begins, residents
 * age: the old die, and loads too heavy for declining Strength are put down; alliance leaves
 * whose delay ran out take effect; then residents at
 * home, at their workplace or in an army by a carriage who run low on food take meals there; cities with a captor change
 * realm (`stepCaptures`); witnesses who got home make crimes known (`stepCrimes`); mercenary contracts end or break
 * (`stepContracts`); last, armies
 * lose members who are gone and give the rest their orders for the next tick. Without `walking`
 * nobody moves.
 */
export function stepWorld(world: WorldState, terrain: TerrainMap, walking?: Walking): StepResult {
  const survival = stepSurvival(world, terrain)
  const horsesDied = stepHorses(world, terrain)
  stepSpoilage(world)
  stepStockFloor(world)
  stepCaravans(world, terrain.size)
  stepNpcDefence(world, terrain.size)
  stepTradeOrgArmy(world, terrain.size)
  stepNpcCities(world, terrain.size, terrain)
  const steps = walking?.requestSteps(world) ?? []
  walking?.resolve(world, steps)
  const strikes = requestStrikes(world, terrain.size)
  const combat = resolveStrikes(world, strikes, terrain.size)
  const climbs = requestClimbing(world)
  resolveClimbing(world, climbs, terrain)
  const carries = [
    ...requestCarrying(world),
    ...requestHauling(world, terrain.size),
    ...requestRoadMaterials(world),
  ]
  resolveCarrying(world, carries, terrain.size)
  const payments = resolvePayments(world)
  const purchases = resolvePurchases(world, terrain.size)
  const builds = requestBuilding(world)
  resolveBuilding(world, builds, terrain)
  const teardowns = requestTearingDown(world)
  resolveTearingDown(world, teardowns, terrain)
  const work = requestWork(world)
  resolveWork(world, work)
  const births = requestBirths(world)
  resolveBirths(world, births)
  world.tick++
  const aging = stepAging(world, terrain.size)
  stepAlliances(world)
  stepRefill(world, terrain.size)
  const captures = stepCaptures(world, terrain.size)
  stepCrimes(world, terrain.size)
  stepContracts(world)
  stepArmies(world, terrain.size)
  const actions =
    steps.length +
    strikes.length +
    climbs.length +
    carries.length +
    builds.length +
    teardowns.length +
    work.length +
    births.length +
    payments +
    purchases
  return { actions, survival, combat, horsesDied, aging, captures }
}
