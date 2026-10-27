import {
  BUILD_MATERIALS,
  BUILD_WORK,
  RECIPES,
  WORKPLACE_MAX_WORKERS,
  WORKPLACE_SKILL,
  type Recipe,
} from './balance.js'
import { NODE_GOOD } from './building.js'
import { FOOTPRINT } from './footprint.js'
import {
  NODE_WORKPLACE,
  type BuildingKind,
  type Good,
  type ResourceKind,
  type SkillName,
  type Stock,
} from './world.js'

/**
 * What each kind of building is for, in words (`CONTEXT.md`: each building's own entry): the one
 * description the Build menu and the building card's ⓘ share. No numbers: those come from
 * `buildingInfo`, so the text never drifts from the balance.
 */
export const BUILDING_PURPOSE: Record<BuildingKind, string> = {
  townHall: 'A town hall founds a new city of your realm; tearing it down dissolves the city.',
  house: 'A house is room for a few residents; only in a city’s area, and it grows the city.',
  storage:
    'A storage keeps a city’s goods: workers carry their output here, and builders fetch materials from it.',
  warehouse:
    'A warehouse keeps the Trade Organization’s goods; a resident or carriage on it can sell goods for its coins or buy with them.',
  wall: 'A stretch of wall; walls grow the city they stand by, like houses.',
  gate: 'A gate in a wall, which its city’s realm opens and closes; it grows the city like a wall does.',
  farm: 'A farm is fields that make Food; on Plains only.',
  stable: 'A stable keeps horses and their Food, and breeds them; on Plains only.',
  mine: 'A mine digs the ore of the iron ore or gold ore node it stands on.',
  quarry: 'A quarry cuts stone from the stone node it stands on.',
  lumberCamp: 'A lumber camp fells wood in the forest node it stands on.',
  smelter: 'A smelter turns iron ore into iron; not on Mountain.',
  mint: 'A mint turns gold ore into coins; not on Mountain.',
  smithy: 'A smithy turns iron and wood into spears, swords, shields and armour; not on Mountain.',
  road: 'A road: residents walk and carriages drive faster on it, on any land but Mountain, and it can run through a gate. Nobody owns it.',
  carriage:
    'A carriage carries far more than any resident, pulled by a horse; built at a finished stable, on its tiles or right by them, and it belongs to the realm of whoever finishes it.',
}

/** Everything the ⓘ on a building's card says about its kind, numbers from the balance. */
export interface BuildingInfo {
  kind: BuildingKind
  purpose: string
  /** What a workplace that processes goods turns into what (`RECIPES`); empty elsewhere. */
  recipes: readonly Recipe[]
  /**
   * What a workplace makes from nothing: Food on a farm, on a node what the node yields (a mine
   * either ore, until its node is known). Empty elsewhere.
   */
  yields: Good[]
  /** The skill working here teaches (`WORKPLACE_SKILL`). */
  skill?: SkillName
  /** Up to how many residents can work here (`WORKPLACE_MAX_WORKERS`). */
  maxWorkers?: number
  /** Its footprint's side, in tiles (`FOOTPRINT`). */
  footprint: number
  /** Materials it takes to build (`BUILD_MATERIALS`). */
  materials: Stock
  /** Work it takes to build, in ticks of one unskilled resident of average Strength (`BUILD_WORK`). */
  work: number
}

/**
 * What a kind of building is and does, for the ⓘ on its card or a node's (`CONTEXT.md`:
 * Workplace, Footprint, Construction site). `node` is the node a node's workplace stands on, if
 * known, which picks what a mine yields.
 */
export function buildingInfo(kind: BuildingKind, node?: ResourceKind): BuildingInfo {
  const nodes = node ? [node] : (Object.keys(NODE_WORKPLACE) as ResourceKind[])
  const fromNodes = nodes.filter((n) => NODE_WORKPLACE[n] === kind).map((n) => NODE_GOOD[n])
  return {
    kind,
    purpose: BUILDING_PURPOSE[kind],
    recipes: RECIPES[kind] ?? [],
    yields: kind === 'farm' ? ['food'] : [...new Set(fromNodes)],
    skill: WORKPLACE_SKILL[kind],
    maxWorkers: WORKPLACE_MAX_WORKERS[kind],
    footprint: FOOTPRINT[kind],
    materials: BUILD_MATERIALS[kind] ?? {},
    work: BUILD_WORK[kind] ?? 0,
  }
}
