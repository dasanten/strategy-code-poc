import {
  BUILD_MATERIALS,
  MAX_WORKERS,
  NPC_SMITHY_WEAPON,
  NPC_SURPLUS_CAP,
  buildingAt,
  materialsNeeded,
  npcCityStock,
  npcNeedsScale,
  npcReserve,
  recipeFor,
  stockFloor,
  warehouseKeeps,
  workplaceGood,
  type Building,
  type BuildingKind,
  type City,
  type CityProject,
  type Good,
  type Stock,
  type WorldState,
} from '@csp/shared'
import { earnsCoins } from './npc-coins.js'

/*
 * The chain an NPC city's reserve drives (`CONTEXT.md`: NPC city, NPC reserve): which goods it is
 * short of, most first, and which workplace makes each. Its planning pass sends spare hands to
 * the workplace of the good shortest (`planCity`) and picks the next workplace to build from the
 * same list (`nextProject`). The Trade Organization's cities run the same chain for their
 * warehouses (`CONTEXT.md`: Trade Org HQ, Trading post), whose stock floor is their reserve.
 * Queries only: nothing moves.
 */

/** The workplaces that process goods into one the chain wants, by that good (`RECIPES`). */
export const PROCESSED_BY: Partial<Record<Good, BuildingKind>> = {
  iron: 'smelter',
  coins: 'mint',
  [NPC_SMITHY_WEAPON]: 'smithy',
}

/**
 * What one batch at the workplace that makes `good` uses up, when a workplace processes it
 * (`RECIPES`): 2 Iron ore for Iron, Iron and Wood for a spear. Undefined for a good dug, cut or
 * farmed.
 */
export function chainInput(good: Good): Stock | undefined {
  const kind = PROCESSED_BY[good]
  return kind && recipeFor(kind, good)?.input
}

/** What a workplace makes for an NPC city: its good (`workplaceGood`); a smithy, its weapon. */
export function chainGood(world: WorldState, b: Building): Good | undefined {
  return b.kind === 'smithy' ? NPC_SMITHY_WEAPON : workplaceGood(world, b)
}

/**
 * The city's own workplaces, finished or begun: its farms (and other buildings of its by
 * `cityId`) and those in its `workplaceIds`.
 */
export function ownWorkplaces(world: WorldState, city: City): Building[] {
  const own = new Set(city.workplaceIds)
  return world.buildings.filter(
    (b) => (b.cityId === city.id || own.has(b.id)) && MAX_WORKERS[b.kind] !== undefined,
  )
}

/** Whether one of the city's workplaces, finished or not, makes a good. */
export function makes(world: WorldState, city: City, good: Good): boolean {
  return ownWorkplaces(world, city).some((b) => chainGood(world, b) === good)
}

/** Whether a stock holds the goods of one batch. */
export function holdsBatch(stock: Stock | undefined, input: Stock): boolean {
  return (Object.entries(input) as [Good, number][]).every(([g, n]) => (stock?.[g] ?? 0) >= n)
}

/** A good a city is short of, and how much of what it wants of it it lacks, 0 to 1. */
export interface Shortage {
  good: Good
  share: number
}

/**
 * What an NPC city is short of (`CONTEXT.md`: NPC reserve), the shortest first: what its
 * storages lack of its reserve (`npcReserve`; a Trade Org city, what its warehouses lack of their
 * stock floor, `tradeOrgReserve`), and of the materials its `project` still needs
 * beyond that, as a share of what it wants of each. Coins only for a city that can earn them
 * (`earnsCoins`): one that can't keeps its war chest in its reserve but doesn't count it as short.
 * Ties go by the reserve's order (Food, building materials, weapons, their Iron, Coins). `size` is
 * the map's.
 */
export function shortages(
  world: WorldState,
  city: City,
  size: number,
  project?: CityProject,
): Shortage[] {
  const want = city.tradeOrg ? tradeOrgReserve(world, city) : npcReserve(world, city)
  for (const [good, n] of Object.entries(projectNeeds(world, project)) as [Good, number][]) {
    want[good] = (want[good] ?? 0) + n
  }
  const stock = city.tradeOrg ? warehouseStock(world, city) : npcCityStock(world, city)
  const short = (Object.entries(want) as [Good, number][])
    .map(([good, n]) => ({ good, share: n > 0 ? (n - (stock[good] ?? 0)) / n : 0 }))
    .filter((s) => s.share > 1e-9)
    .sort((a, b) => b.share - a.share)
  // Looked into only once Coins are short: finding a way to earn them looks over the map.
  if (city.tradeOrg || !short.some((s) => s.good === 'coins') || earnsCoins(world, city, size)) {
    return short
  }
  return short.filter((s) => s.good !== 'coins')
}

/** The goods an NPC city is short of, the shortest first (`shortages`). `size` is the map's. */
export function shortGoods(
  world: WorldState,
  city: City,
  size: number,
  project?: CityProject,
): Good[] {
  return shortages(world, city, size, project).map((s) => s.good)
}

/**
 * How an NPC city weighs its workplaces for surplus work (`CONTEXT.md`: Spare hands' work), from
 * what it holds now: for a workplace, how full its good's cap is (`NPC_SURPLUS_CAP` for each step of
 * its needs, `npcNeedsScale`, past the reserve), below 1 and lowest for the good that wants hands most. Undefined for one not to be
 * worked for surplus: its good at its cap or with no cap, or a workplace that processes goods
 * while `storage` holds a batch of its input only by eating into the reserve.
 */
export function surplusWork(
  world: WorldState,
  city: City,
  storage: Building | undefined,
): (place: Building) => number | undefined {
  const stock = npcCityStock(world, city)
  const reserve = npcReserve(world, city)
  const steps = npcNeedsScale(world, city)
  const spare: Stock = {}
  for (const [good, n] of Object.entries(storage?.stock ?? {}) as [Good, number][]) {
    spare[good] = n - (reserve[good] ?? 0)
  }
  return (place) => {
    const good = chainGood(world, place)
    const cap = good && NPC_SURPLUS_CAP[good]
    if (!good || !cap) return undefined
    const input = chainInput(good)
    if (input && !holdsBatch(spare, input)) return undefined
    const full = ((stock[good] ?? 0) - (reserve[good] ?? 0)) / (cap * steps)
    return full < 1 ? full : undefined
  }
}

/** The materials a project still needs: its site's, or all of the building's before it is laid out. */
export function projectNeeds(world: WorldState, project: CityProject | undefined): Stock {
  if (project?.kind !== 'build') return {}
  const site = buildingAt(world, project.x, project.y)
  if (site?.site) return materialsNeeded(site)
  return site ? {} : { ...(BUILD_MATERIALS[project.building] ?? {}) }
}

/** A Trade Org city's finished warehouses (`CONTEXT.md`: Warehouse); none for any other city. */
export function tradeOrgWarehouses(world: WorldState, city: City): Building[] {
  if (!city.tradeOrg) return []
  return world.buildings.filter((b) => b.cityId === city.id && b.kind === 'warehouse' && !b.site)
}

/**
 * The reserve of a Trade Org city (`CONTEXT.md`: Trade Org HQ, Trading post): the stock floor of
 * its warehouses (`stockFloor`), Food aside. Its Food is its storage's, which its residents eat
 * from and its farms fill, and it keeps farmers by its residents (`farmersWanted`).
 */
export function tradeOrgReserve(world: WorldState, city: City): Stock {
  const reserve: Stock = {}
  for (const b of tradeOrgWarehouses(world, city)) {
    for (const [good, n] of Object.entries(stockFloor(world, b)) as [Good, number][]) {
      if (good !== 'food') reserve[good] = (reserve[good] ?? 0) + n
    }
  }
  return reserve
}

/** What a Trade Org city's warehouses hold together. */
export function warehouseStock(world: WorldState, city: City): Stock {
  const sum: Stock = {}
  for (const b of tradeOrgWarehouses(world, city)) {
    for (const [good, n] of Object.entries(b.stock ?? {}) as [Good, number][]) {
      sum[good] = (sum[good] ?? 0) + n
    }
  }
  return sum
}

/**
 * Where a city keeps what its chain makes and uses up: an NPC city its storage; a Trade Org city
 * its warehouse of goods (`warehouseKeeps`), at the HQ the one that is not its coin warehouse.
 * Its builders' materials and the input of its smelter, mint and smithy come from there.
 */
export function chainStore(world: WorldState, city: City): Building | undefined {
  if (city.tradeOrg) {
    return tradeOrgWarehouses(world, city).find((b) =>
      warehouseKeeps(world, b).some((g) => g !== 'coins'),
    )
  }
  return world.buildings.find((b) => b.cityId === city.id && b.kind === 'storage' && !b.site)
}

/**
 * The warehouse a Trade Org city's worker stores a load of `goods` in (`CONTEXT.md`: Trading
 * post, Trade Org HQ): the first that keeps one of them, Food aside. None for a load of Food, which
 * goes to the storage its residents eat from, and none for any other city.
 */
export function warehouseFor(world: WorldState, city: City, goods: Good[]): Building | undefined {
  const kept: Good[] = goods.filter((g) => g !== 'food')
  if (kept.length === 0) return undefined
  return tradeOrgWarehouses(world, city).find((b) =>
    warehouseKeeps(world, b).some((g) => kept.includes(g)),
  )
}
