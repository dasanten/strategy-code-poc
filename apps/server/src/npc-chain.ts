import {
  BUILD_MATERIALS,
  MAX_WORKERS,
  NPC_SMITHY_WEAPON,
  buildingAt,
  materialsNeeded,
  npcCityStock,
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

/**
 * The goods an NPC city is short of (`CONTEXT.md`: NPC reserve), the shortest first: what its
 * storages lack of its reserve (`npcReserve`; a Trade Org city, what its warehouses lack of their
 * stock floor, `tradeOrgReserve`), and of the materials its `project` still needs
 * beyond that, as a share of what it wants of each. Ties go by the reserve's order (Food,
 * building materials, weapons, their Iron, Coins).
 */
export function shortGoods(world: WorldState, city: City, project?: CityProject): Good[] {
  const want = city.tradeOrg ? tradeOrgReserve(world, city) : npcReserve(world, city)
  for (const [good, n] of Object.entries(projectNeeds(world, project)) as [Good, number][]) {
    want[good] = (want[good] ?? 0) + n
  }
  const stock = city.tradeOrg ? warehouseStock(world, city) : npcCityStock(world, city)
  return (Object.entries(want) as [Good, number][])
    .map(([good, n]) => ({ good, share: n > 0 ? (n - (stock[good] ?? 0)) / n : 0 }))
    .filter((s) => s.share > 1e-9)
    .sort((a, b) => b.share - a.share)
    .map((s) => s.good)
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
