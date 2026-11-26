// The rules that take only values (T122.5, ADR 0045): costs, recipes, prices, fees, capacities,
// paces, names and checks of what a Player sends, answered by `csp-sim`'s own functions in the
// module (`crates/csp-lang-wasm/src/value_rules.rs`). The client's TypeScript copies of them are
// gone; each function here crosses into the module once.

import type {
  BuildingKind,
  CarriedFeeBy,
  ClientFirstDayLine,
  FirstDayLine,
  Good,
  LoadLevel,
  PricedGood,
  ResourceKind,
  SkillName,
  Stock,
  WallMaterial,
} from '@csp/shared-types'
import * as wasm from '../generated/csp_lang_wasm.js'

/** What one batch at a workplace uses up and makes (`RECIPES`). */
export interface Recipe {
  /** Goods one batch uses up. */
  input: Stock
  /** Goods one batch makes. */
  output: Stock
}

/** What a warehouse pays for (`buy`) and asks for (`sell`) one unit of a good, in coins. */
export interface Price {
  buy: number
  sell: number
}

/** A moment of game time. Year and day count from 1, like a calendar; hour and minute from 0. */
export interface GameTime {
  year: number
  /** Day within the year, 1 to `GAME_DAYS_PER_YEAR`. */
  day: number
  hour: number
  minute: number
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
 * Calls the rule `name` of the module with `args`, which go across as JSON (`undefined` as
 * `null`), and answers its JSON result. Throws for a rule the module doesn't have or arguments
 * it can't read: a call that doesn't fit its Rust function is a bug here.
 */
function rule<T>(name: string, ...args: unknown[]): T {
  return JSON.parse(wasm.rule(name, JSON.stringify(args.map((a) => a ?? null)))) as T
}

/** `null` from the module as `undefined`, as the client's types have it. */
function opt<T>(v: T | null): T | undefined {
  return v ?? undefined
}

// Building, repairing, rebuilding (`CONTEXT.md`: Construction site, Repairing, Ruin).

/**
 * Work a building of `kind` takes in ticks of one unskilled resident of average Strength, over the
 * terrain `under` where known, of `material` for a wall, gate or tower (`buildingWork`).
 */
export function buildingWork(kind: BuildingKind, under?: number, material?: WallMaterial): number {
  return rule('buildingWork', kind, under, material)
}

/** The materials a building of `kind` takes: of stone, a stone wall's, gate's or tower's. */
export function materialsOfKind(kind: BuildingKind, material?: WallMaterial | null): Stock {
  return rule('materialsOfKind', kind, material)
}

/** The work a building of `kind` takes, before its terrain: of stone, a stone one's. */
export function workOfKind(kind: BuildingKind, material?: WallMaterial | null): number {
  return rule('workOfKind', kind, material)
}

/** How many times its work a building of `kind` over `under` takes: a road on Mountain more. */
export function workFactor(kind: BuildingKind, under?: number): number {
  return rule('workFactor', kind, under)
}

/** How much `work` of a resident counts on a building of `kind` over `under`. */
export function siteWorkOf(work: number, kind: BuildingKind, under?: number): number {
  return rule('siteWorkOf', work, kind, under)
}

/** Whether a workplace has more than one recipe, so its workers say what they make. */
export function hasChoice(kind: BuildingKind): boolean {
  return rule('hasChoice', kind)
}

/**
 * The recipe a worker follows at a workplace that processes goods (`RECIPES`): the one that makes
 * `makes`, or with none the workplace's first, so a smelter makes Iron unless told Steel. None for
 * a workplace that processes nothing, a good it can't make, or a smithy with no `makes`.
 */
export function recipeFor(kind: BuildingKind, makes?: Good): Recipe | undefined {
  return opt(rule<Recipe | null>('recipeFor', kind, makes))
}

/**
 * What a build menu offers a resident on a tile: the workplace of the resource node there, or
 * with none every kind that goes off a node, in its order.
 */
export function buildMenu(node: { kind: ResourceKind } | undefined): BuildingKind[] {
  return rule('buildMenu', node?.kind)
}

/**
 * What a kind of building is and does, for the ⓘ on its card or a node's (`CONTEXT.md`:
 * Workplace, Footprint, Construction site). `node` is the node a node's workplace stands on, if
 * known.
 */
export function buildingInfo(kind: BuildingKind, node?: ResourceKind): BuildingInfo {
  const info = rule<BuildingInfo & { skill: SkillName | null; maxWorkers: number | null }>(
    'buildingInfo',
    kind,
    node,
  )
  const { skill, maxWorkers, ...rest } = info
  return {
    ...rest,
    ...(skill !== null ? { skill } : {}),
    ...(maxWorkers !== null ? { maxWorkers } : {}),
  }
}

/** The materials a repair of a building of `kind` takes (`REPAIR_MATERIALS_SHARE`). */
export function repairMaterials(kind: BuildingKind): Stock {
  return rule('repairMaterials', kind)
}

/** The work a repair of a building of `kind` takes (`REPAIR_WORK_SHARE`). */
export function repairWork(kind: BuildingKind): number {
  return rule('repairWork', kind)
}

/** The materials rebuilding a ruin of `kind` takes (`REBUILD_MATERIALS_SHARE`). */
export function rebuildMaterials(kind: BuildingKind): Stock {
  return rule('rebuildMaterials', kind)
}

/** The work rebuilding a ruin of `kind` takes (`REBUILD_WORK_SHARE`). */
export function rebuildWork(kind: BuildingKind): number {
  return rule('rebuildWork', kind)
}

/**
 * The north-west tiles a building of `kind` could stand at to cover (x, y): every corner whose
 * footprint holds the tile.
 */
export function cornersCovering(
  kind: BuildingKind,
  x: number,
  y: number,
  size: number,
): [number, number][] {
  return rule('cornersCovering', kind, x, y, size)
}

// Carrying: weights, loads, food for the way (`CONTEXT.md`: Carriage, Caravan).

/** What goods weigh, in kg (`GOOD_WEIGHT`). */
export function stockWeight(stock: Stock): number {
  return rule('stockWeight', stock)
}

/** How heavily something holding `load` of `capacity` kg is loaded, as others see it. */
export function loadLevel(load: Stock, capacity: number): LoadLevel {
  return rule('loadLevel', load, capacity)
}

/** The most Food a caravan with `escorts` escorts takes along (`CARAVAN_FOOD`). */
export function caravanFoodFor(escorts: number): number {
  return rule('caravanFoodFor', escorts)
}

/**
 * The Food a carriage with `escorts` takes for a way of `tiles` with `stops` stops, with a margin,
 * never more than `caravanFoodFor`.
 */
export function foodForWay(escorts: number, tiles: number, stops = 0): number {
  return rule('foodForWay', escorts, tiles, stops)
}

/**
 * How many of a carried good a resident puts away unless asked for an exact amount: all of it,
 * but Food only beyond their own food (`OWN_FOOD`, or `ownFood`).
 */
export function putAwayUnits(good: Good, carried: number, ownFood?: number): number {
  return rule('putAwayUnits', good, carried, ownFood)
}

/** Whether a carriage can go onto terrain `terrain` at all (`CARRIAGE_SPEED` above 0). */
export function carriageCanEnter(terrain: number): boolean {
  return rule('carriageCanEnter', terrain)
}

// Prices and fees (`CONTEXT.md`: Warehouse prices, Transfer, Trader, NPC city prices).

/** A warehouse's price for one good from its own stock and floor. */
export function priceFor(good: PricedGood, stock: number, floor: number): Price {
  return rule('priceFor', good, stock, floor)
}

/** A trader's price for one good from what it carries. */
export function traderPriceFor(good: PricedGood, stock: number): Price {
  return rule('traderPriceFor', good, stock)
}

/** An NPC city's price for one good from its stock, its reserve and its swing. */
export function npcPriceFor(good: PricedGood, stock: number, reserve: Stock, swing: number): Price {
  return rule('npcPriceFor', good, stock, reserve, swing)
}

/** What a Trade Org delivery of `kg` over `tiles` costs, in coins. */
export function deliveryFee(kg: number, tiles: number): number {
  return rule('deliveryFee', kg, tiles)
}

/** What a Trade Org transfer of `kg` over `tiles` costs, in coins. */
export function transferFee(kg: number, tiles: number): number {
  return rule('transferFee', kg, tiles)
}

/** What of a fee is paid at pick-up: all but the unloading's share, rounded for the unloading. */
export function feeAtPickUp(fee: number, unloadShare = 0): number {
  return rule('feeAtPickUp', fee, unloadShare)
}

/** How many units of a good one transfer load holds (`DELIVERY_LOAD`). */
export function transferLoad(good: Good): number {
  return rule('transferLoad', good)
}

/** The loads a transfer of `goods` goes in, each at most `transferLoad` units of one good. */
export function transferLoads(goods: Stock): { good: Good; units: number }[] {
  return rule('transferLoads', goods)
}

/** What transferring `goods` over `tiles` costs, load by load. */
export function transferLoadsFee(goods: Stock, tiles: number): number {
  return rule('transferLoadsFee', goods, tiles)
}

/** What of `goods` can be handed over from `free`: whole units, as much as there is. */
export function goodsToHandOver(goods: Partial<Record<Good, number>>, free: Stock): Stock {
  return rule('goodsToHandOver', goods, free)
}

/** Who pays which share of unloading carried goods, by who pays the fee. */
export function carriedUnloadShares(feeBy: CarriedFeeBy): { sender: number; other: number } {
  return rule('carriedUnloadShares', feeBy)
}

/** How a horse dealer's stock against what it wants moves its prices. */
export function horseStockFactor(has: number, wanted: number): number {
  return rule('horseStockFactor', has, wanted)
}

// NPC cities (`CONTEXT.md`: NPC city).

/** How many soldiers an NPC city of `adults` grown residents keeps. */
export function npcSoldierTarget(adults: number): number {
  return rule('npcSoldierTarget', adults)
}

/** Game days an NPC city of `residents` takes to be full and found another. */
export function npcFullDays(residents: number): number {
  return rule('npcFullDays', residents)
}

/** How many residents an NPC city of `residents` sends to found another. */
export function npcFoundingPartySize(residents: number): number {
  return rule('npcFoundingPartySize', residents)
}

// Checks of what a Player sends.

/** Why `name` is no name of at most `maxLength` characters, if it is not. */
export function nameProblem(name: unknown, maxLength: number): string | undefined {
  return opt(rule<string | null>('nameProblem', name, maxLength))
}

/** Why a realm can't be founded with these names, if it can't. */
export function foundingProblem(realmName: unknown, leaderName: unknown): string | undefined {
  return opt(rule<string | null>('foundingProblem', realmName, leaderName))
}

/** Why `note` is no note for a demand, if it is not. */
export function demandNoteProblem(note: unknown): string | undefined {
  return opt(rule<string | null>('demandNoteProblem', note))
}

/** Why `items` are no queue's steps, if they are not (`CONTEXT.md`: Queue). */
export function queueStepsProblem(items: unknown): string | undefined {
  return opt(rule<string | null>('queueStepsProblem', items))
}

/** Whether `line` names a line of the first day card. */
export function isFirstDayLine(line: unknown): line is FirstDayLine {
  return rule('isFirstDayLine', line)
}

/** Whether `line` names a line of the first day card the client reports. */
export function isClientFirstDayLine(line: unknown): line is ClientFirstDayLine {
  return rule('isClientFirstDayLine', line)
}

/** Whether a value fits a `number` param: a whole number of zero or more. */
export function isParamNumber(value: unknown): value is number {
  // JSON has no NaN or infinities; none of them is a whole number.
  return typeof value === 'number' && Number.isFinite(value) && rule('isParamNumber', value)
}

// Time and places.

/** The game time at a tick: one tick is one real second (`CONTEXT.md`: Game time, Tick). */
export function gameTime(tick: number): GameTime {
  return rule('gameTime', tick)
}

/** The game time at a tick as the top bar shows it: `Year 1 · Day 3 · 08:15`. */
export function formatGameTime(tick: number): string {
  return rule('formatGameTime', tick)
}

/** The number in an id (`city7` is 7). */
export function idNumber(id: string): number {
  return rule('idNumber', id)
}

/** Whether two tiles touch or are the same, straight or diagonally, across the map's joins. */
export function inContact(
  size: number,
  a: { x: number; y: number },
  b: { x: number; y: number },
): boolean {
  return rule('inContact', size, [a.x, a.y], [b.x, b.y])
}
