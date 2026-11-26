// The rules that take only values (T122.5, ADR 0045): costs, recipes, prices, fees, capacities,
// paces, names and checks of what a Player sends, answered by `csp-sim`'s own functions in the
// module (`crates/csp-lang-wasm/src/value_rules.rs`). The client's TypeScript copies of them are
// gone; each function here crosses into the module once.

import type {
  Building,
  KeptBreeding,
  SwapQuote,
  BuildingKind,
  BuildLine,
  Carriage,
  Offer,
  OfferQuote,
  OrderRequest,
  TradeHolder,
  TradeQuote,
  TradeSide,
  Directive,
  DirectiveGoal,
  CarriedFeeBy,
  Good,
  Horse,
  LoadLevel,
  NpcCityPrice,
  PricedGood,
  Resident,
  ResourceKind,
  ScriptParam,
  SkillName as Skill,
  StatName,
  SwapRate,
  Task,
  Trader,
  Waypoint,
  SkillName,
  Stock,
  WallMaterial,
} from '@csp/shared-types'
import { MAP_SIZE } from '@csp/balance'
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

// Carrying: weights, loads, food for the way (`CONTEXT.md`: Carriage, Caravan).

/** What goods weigh, in kg (`GOOD_WEIGHT`). */
export function stockWeight(stock: Stock): number {
  return rule('stockWeight', stock)
}

/** How heavily something holding `load` of `capacity` kg is loaded, as others see it. */
export function loadLevel(load: Stock, capacity: number): LoadLevel {
  return rule('loadLevel', load, capacity)
}

/**
 * How many of a carried good a resident puts away unless asked for an exact amount: all of it,
 * but Food only beyond their own food (`OWN_FOOD`, or `ownFood`).
 */
export function putAwayUnits(good: Good, carried: number, ownFood?: number): number {
  return rule('putAwayUnits', good, carried, ownFood)
}

// Prices and fees (`CONTEXT.md`: Warehouse prices, Transfer, Trader, NPC city prices).

/** A warehouse's price for one good from its own stock and floor. */
export function priceFor(good: PricedGood, stock: number, floor: number): Price {
  return rule('priceFor', good, stock, floor)
}

/** What a Trade Org delivery of `kg` over `tiles` costs, in coins. */
export function deliveryFee(kg: number, tiles: number): number {
  return rule('deliveryFee', kg, tiles)
}

/** How many units of a good one transfer load holds (`DELIVERY_LOAD`). */
export function transferLoad(good: Good): number {
  return rule('transferLoad', good)
}

/** What transferring `goods` over `tiles` costs, load by load. */
export function transferLoadsFee(goods: Stock, tiles: number): number {
  return rule('transferLoadsFee', goods, tiles)
}

/** What of `goods` can be handed over from `free`: whole units, as much as there is. */
export function goodsToHandOver(goods: Partial<Record<Good, number>>, free: Stock): Stock {
  return rule('goodsToHandOver', goods, free)
}

// NPC cities (`CONTEXT.md`: NPC city).

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

/** Whether two tiles touch or are the same, straight or diagonally, across the map's joins. */
export function inContact(
  size: number,
  a: { x: number; y: number },
  b: { x: number; y: number },
): boolean {
  return rule('inContact', size, [a.x, a.y], [b.x, b.y])
}

// Rules on a few fields of one thing (T122.5b): each passes the fields its Rust function reads.

/** A resident's age in game years (`CONTEXT.md`: Age): a child ages faster than a grown one. */
export function ageInYears(resident: Pick<Resident, 'bornAt'>, tick: number): number {
  // NaN (no birth seen) comes back as JSON's null.
  return rule<number | null>('ageInYears', resident.bornAt, tick) ?? NaN
}

/** Whether a resident is grown, old enough to work (`ADULT_AGE`). */
export function canWork(resident: Pick<Resident, 'bornAt'>, tick: number): boolean {
  return rule('canWork', resident.bornAt, tick)
}

/** Whether a resident may carry `goods`: anything once grown, a child only a child's goods. */
export function canHandle(
  resident: Pick<Resident, 'bornAt'>,
  tick: number,
  goods: readonly string[],
): boolean {
  return rule('canHandle', resident.bornAt, tick, goods)
}

/**
 * The tiles of a transfer's whole way: from the warehouse to the sender's storage `from` (none
 * for a hand-in), on to the recipient's storage `to`, and back.
 */
export function transferTiles(
  size: number,
  warehouse: { x: number; y: number },
  from: { x: number; y: number } | null,
  to: { x: number; y: number },
): number {
  const at = (p: { x: number; y: number }) => [p.x, p.y]
  return rule('transferTiles', size, at(warehouse), from && at(from), at(to))
}

/** The most of `wanted` units a transfer takes from `held`, with its fee over `tiles`. */
export function quoteTransfer(
  held: Partial<Record<Good, number>>,
  good: Good,
  wanted: number,
  tiles: number,
  unloadShare = 0,
): { units: number; fee: number } {
  return rule('quoteTransfer', held, good, wanted, tiles, unloadShare)
}

/** Why a Player holding `held` can't put a waypoint named `name` on (x, y), if they can't. */
export function addWaypointProblem(
  held: readonly Waypoint[],
  x: unknown,
  y: unknown,
  name: unknown,
  size: number,
): string | undefined {
  return opt(rule<string | null>('addWaypointProblem', held, x, y, name, size))
}

/** Why `c` is no condition, if it is not (`CONTEXT.md`: Condition). */
export function conditionProblem(c: unknown): string | undefined {
  return opt(rule<string | null>('conditionProblem', c))
}

/** An NPC city's swap rates from its prices (`CONTEXT.md`: Swap). */
export function npcSwapRates(
  prices: readonly Pick<NpcCityPrice, 'good' | 'forSale' | 'wanted' | 'buy' | 'sell'>[],
): SwapRate[] {
  const lines = prices.map(({ good, forSale, wanted, buy, sell }) => ({
    good,
    forSale,
    wanted,
    buy,
    sell,
  }))
  return rule('npcSwapRates', lines)
}

/** The param a default script takes its target in, if it is the default of a task with one. */
export function targetParam(script: { task?: Task | null }): string | undefined {
  return opt(rule<string | null>('targetParam', script.task))
}

/** A param as the Rust reads it: where its line is doesn't matter to these rules. */
function paramInfo(p: Partial<ScriptParam>): object {
  return { name: '', type: 'number', ...p, line: 0, column: 0 }
}

/** Whether a script's params make it a work script: it declares `param workplace: building`. */
export function isWorkScript(params: readonly Pick<ScriptParam, 'name' | 'type'>[]): boolean {
  return rule('isWorkScript', params.map(paramInfo))
}

/** Whether a script has nothing to go on without this param: no default, no `none:` comment. */
export function paramNeedsValue(p: Pick<ScriptParam, 'default' | 'description'>): boolean {
  return rule('paramNeedsValue', paramInfo(p))
}

/** Whether a value fits a `choice` param: one of the words its line lists. */
export function isParamChoice(param: Pick<ScriptParam, 'choices'>, value: unknown): boolean {
  return rule('isParamChoice', paramInfo({ type: 'choice', ...param }), value)
}

// Rules on one building (T122.5b): the building goes across whole; what a caller leaves out of
// it (a `Pick`) reads as a building with no id, of no city, on (0, 0).

/** A building as the module reads it, from what the caller has of one. */
function asBuilding(b: Partial<Building> & Pick<Building, 'kind'>): Building {
  return { id: '', cityId: null, x: 0, y: 0, ...b }
}

/** Materials a construction site still needs. */
export function materialsNeeded(site: Building): Stock {
  return rule('materialsNeeded', asBuilding(site))
}

/** Work a construction site still needs. */
export function workNeeded(site: Building): number {
  return rule('workNeeded', asBuilding(site))
}

/** Work tearing down a building takes (`TEARDOWN_WORK_SHARE` of what building it took). */
export function teardownWork(b: Building): number {
  return rule('teardownWork', asBuilding(b))
}

/** Work tearing down a building still takes. */
export function teardownLeft(b: Building): number {
  return rule('teardownLeft', asBuilding(b))
}

/** What tearing a building down leaves: a site's delivered goods, a building's share of them. */
export function teardownReturns(b: Building): Stock {
  return rule('teardownReturns', asBuilding(b))
}

/** How a building's condition reads, by its decay (`CONTEXT.md`: Decay); none for one that never decays. */
export function conditionOf(
  b: Pick<Building, 'kind' | 'site' | 'decay' | 'ruinedAt'>,
): 'good' | 'worn' | 'nearlyRuin' | 'ruin' | undefined {
  return opt(rule<'good' | 'worn' | 'nearlyRuin' | 'ruin' | null>('conditionOf', asBuilding(b)))
}

/** Whether a building can be repaired or rebuilt: worn or worse, or being repaired. */
export function repairable(
  b: Pick<Building, 'kind' | 'site' | 'decay' | 'ruinedAt' | 'repair'>,
): boolean {
  return rule('repairable', asBuilding(b))
}

/** Damage a wall, gate or tower takes before it falls, of wood or stone. */
export function wallStrength(b: Building): number {
  return rule('wallStrength', asBuilding(b))
}

/** Damage a wall, gate or tower still takes before it falls. */
export function wallStrengthLeft(b: Building): number {
  return rule('wallStrengthLeft', asBuilding(b))
}

// Rules on one resident or horse (T122.5b): they go across whole, as a Player sees them or as the
// world has them. What a caller leaves out of one (a `Pick`) reads as a blank: no id, at (0, 0),
// average stats, no skills, carrying and wearing nothing.

const AVERAGE_STAT = { base: 10, trained: 0 }

/** A resident as the module reads one, from what the caller has of them. */
function asResident(r: object): object {
  const stats = (r as { stats?: object }).stats
  return {
    id: '',
    name: '',
    owner: null,
    cityId: null,
    x: 0,
    y: 0,
    stats: {
      strength: AVERAGE_STAT,
      endurance: AVERAGE_STAT,
      agility: AVERAGE_STAT,
      intellect: AVERAGE_STAT,
    },
    skills: {},
    bornAt: 0,
    lifespan: Number.MAX_SAFE_INTEGER,
    carried: {},
    equipped: {},
    ...r,
    // A caller's stats may name only those it has; the rest read as average.
    ...(stats && {
      stats: {
        strength: AVERAGE_STAT,
        endurance: AVERAGE_STAT,
        agility: AVERAGE_STAT,
        intellect: AVERAGE_STAT,
        ...stats,
      },
    }),
  }
}

/** A horse as the module reads one, from what the caller has of it. */
/** What of a horse the module reads (`SeenHorse`): anything else a caller's object has is left out. */
const HORSE_FIELDS = [
  'id',
  'name',
  'realmId',
  'cityId',
  'x',
  'y',
  'hunger',
  'health',
  'stats',
  'bornAt',
  'downUntil',
  'down',
]

function asHorse(h: object): object {
  const known = Object.fromEntries(Object.entries(h).filter(([k]) => HORSE_FIELDS.includes(k)))
  return {
    id: '',
    name: '',
    realmId: null,
    cityId: null,
    x: 0,
    y: 0,
    stats: { speed: 10, strength: 10, endurance: 10 },
    bornAt: 0,
    ...known,
  }
}

/** How many of `good` a resident makes a game day at a workplace of `kind`. */
export function madePerDay(
  resident: Resident,
  kind: BuildingKind,
  good: Good,
  tick: number,
): number {
  return rule('madePerDay', asResident(resident), kind, good, tick)
}

/** A resident's value in a stat or skill a training ground teaches. */
export function subjectValue(resident: Resident, subject: StatName | Skill, tick: number): number {
  return rule('subjectValue', asResident(resident), subject, tick)
}

/** How far a teacher can train a trainee in `subject` (`CONTEXT.md`: Training ground). */
export function trainingCeiling(
  trainee: Resident,
  teacher: Resident,
  subject: StatName | Skill,
  tick: number,
): number {
  return rule('trainingCeiling', asResident(trainee), asResident(teacher), subject, tick)
}

/** How many more of `good` a resident can carry. */
export function unitsThatFit(resident: Resident, good: Good, tick: number): number {
  return rule('unitsThatFit', asResident(resident), good, tick)
}

/** Why a resident can't buy a horse for `price`, if they can't. */
export function horseBuyerProblem(
  resident: Pick<Resident, 'bornAt' | 'carried'>,
  price: number,
  tick: number,
): string | undefined {
  return opt(rule<string | null>('horseBuyerProblem', asResident(resident), price, tick))
}

/** Why a resident can't sell a horse for `price`, if they can't. */
export function horseSellerProblem(
  resident: Resident,
  price: number,
  tick: number,
): string | undefined {
  return opt(rule<string | null>('horseSellerProblem', asResident(resident), price, tick))
}

/** A horse's age in game years. */
export function horseAgeInYears(horse: Pick<Horse, 'bornAt'>, tick: number): number {
  return rule('horseAgeInYears', asHorse(horse), tick)
}

/** Why `feeder` can't feed `target`, if they can't (`CONTEXT.md`: Reviving). */
export function feedProblem(
  feeder: Pick<Resident, 'bornAt' | 'x' | 'y' | 'carried'>,
  target: object | undefined,
  tick: number,
  size: number,
): string | undefined {
  const t = target && asResident(target)
  return opt(rule<string | null>('feedProblem', asResident(feeder), t, tick, size))
}

// Rules on one contract, realm, directive or carriage (T122.5b).

/** Work a building or site gets a tick from these workers. */
export function workPace(
  b: Building,
  workers: readonly Resident[],
  tick: number,
  under?: number,
): number {
  return rule('workPace', asBuilding(b), workers.map(asResident), tick, under)
}

/** A directive as the module reads one, from what the caller has of it. */
function asDirective(d: object): object {
  return {
    id: '',
    target: '',
    withAlliance: false,
    reason: '',
    givenBy: '',
    givenAt: 0,
    goals: [],
    soldiersKilled: 0,
    price: null,
    ...d,
  }
}

/** Whether one of a directive's goals is met (`CONTEXT.md`: Admin directive). */
export function goalMet(d: Pick<Directive, 'soldiersKilled'>, goal: DirectiveGoal): boolean {
  return rule('goalMet', asDirective(d), goal)
}

/** What each side of a carried offer pays over its ways: the sender's and the other side's fee. */
export function carriedFeesOver(
  way: { senderTiles: number; otherTiles: number },
  feeBy: CarriedFeeBy,
  goods: { gives: Good; givesUnits: number; wants: Good; wantsUnits: number; times: number },
): { senderFee: number; otherFee: number } {
  const { senderTiles, otherTiles } = way
  const { gives, givesUnits, wants, wantsUnits, times } = goods
  const g = { gives, givesUnits, wants, wantsUnits, times }
  return rule('carriedFeesOver', { senderTiles, otherTiles }, feeBy, g)
}

/** What of a carriage the module reads (`SeenCarriage`). */
const CARRIAGE_FIELDS = ['id', 'realmId', 'cityId', 'x', 'y', 'horseId', 'load']

/** A carriage as the module reads one, from what the caller has of it. */
function asCarriage(k: object): object {
  const known = Object.fromEntries(Object.entries(k).filter(([f]) => CARRIAGE_FIELDS.includes(f)))
  return {
    id: '',
    realmId: null,
    cityId: null,
    x: 0,
    y: 0,
    horseId: null,
    loadLevel: 'empty',
    passengerIds: [],
    standsStill: false,
    ...known,
  }
}

/** Why a resident can't board a carriage as a passenger, if they can't. */
export function boarderProblem(
  resident: Pick<Resident, 'x' | 'y' | 'owner' | 'cityId' | 'order' | 'aboard' | 'riding'>,
  carriage: Pick<Carriage, 'id' | 'x' | 'y' | 'realmId' | 'cityId'>,
): string | undefined {
  return opt(rule<string | null>('boarderProblem', asResident(resident), asCarriage(carriage)))
}

/** Why a resident can't unhitch a carriage's horse now, if they can't. */
export function unhitchProblem(
  resident: Pick<Resident, 'x' | 'y' | 'owner' | 'cityId' | 'bornAt'>,
  carriage: Pick<Carriage, 'x' | 'y' | 'realmId' | 'cityId' | 'horseId'> | undefined,
  tick: number,
): string | undefined {
  const k = carriage && asCarriage(carriage)
  return opt(rule<string | null>('unhitchProblem', asResident(resident), k, tick))
}

// The last rules on one thing (T122.5b): who works on a site, trade holders and quotes, a city's,
// and a queue step's.

/** The residents working on a building or site now, standing on it (`CONTEXT.md`: Construction). */
export function workingOn<R extends Resident>(
  b: Building,
  residents: readonly R[],
  tearingDown: boolean,
  size = MAP_SIZE,
): R[] {
  // Only what the rule reads of each goes across: where they are and what they do.
  const few = residents.map(({ id, x, y, order }) => asResident({ id, x, y, order }))
  const ids = new Set(rule<string[]>('workingOn', asBuilding(b), few, tearingDown, size))
  return residents.filter((r) => ids.has(r.id))
}

/** A resident's hands as a trade holder: what they carry and what more they could. */
export function handsOf(resident: Resident, tick: number): TradeHolder {
  return rule('handsOf', asResident(resident), tick)
}

/** A carriage as a trade holder: its load and the room left on it. */
export function loadOf(carriage: Carriage, capacity: number): TradeHolder {
  return rule('loadOf', asCarriage(carriage), capacity)
}

/** A trade holder as the module reads one. */
function holderOf(h: TradeHolder): TradeHolder {
  return { stock: h.stock, room: h.room }
}

/**
 * What a trade of up to `wanted` units of a good would move with a side holding `stock` of it
 * and `coinStock` coins, priced from `floor` (`CONTEXT.md`: Warehouse prices). Pure.
 */
export function quoteAtPrices(
  stock: number,
  floor: number,
  coinStock: number,
  holder: TradeHolder,
  side: TradeSide,
  good: PricedGood,
  wanted: number,
  owed = 0,
  theirRoom = Infinity,
): TradeQuote {
  const room = Number.isFinite(theirRoom) ? theirRoom : null
  const h = holderOf(holder)
  return rule('quoteAtPrices', stock, floor, coinStock, h, side, good, wanted, owed, room)
}

/** What a trade of up to `wanted` units with a wandering trader would move (`CONTEXT.md`: Trader stop). */
export function quoteTraderTrade(
  t: Pick<Trader, 'escortIds'>,
  load: Stock,
  capacity: number,
  holder: TradeHolder,
  side: TradeSide,
  good: PricedGood,
  wanted: number,
): TradeQuote {
  const h = holderOf(holder)
  return rule('quoteTraderTrade', t.escortIds.length, load, capacity, h, side, good, wanted)
}

/** An offer as the module reads one, from what the caller has of it. */
function asOffer(o: object): object {
  return { id: '', realmId: '', storageId: '', x: 0, y: 0, ...o }
}

/** What accepting an offer up to `wanted` times moves (`CONTEXT.md`: Offer). */
export function quoteOffer(
  offer: Pick<Offer, 'gives' | 'givesUnits' | 'wants' | 'wantsUnits' | 'times'>,
  holder: TradeHolder,
  wanted: number,
  available = Infinity,
): OfferQuote {
  const { gives, givesUnits, wants, wantsUnits, times } = offer
  const o = asOffer({ gives, givesUnits, wants, wantsUnits, times })
  const a = Number.isFinite(available) ? available : null
  return rule('quoteOffer', o, holderOf(holder), wanted, a)
}

/** Whether a queue step never ends on its own (`CONTEXT.md`: Queue). */
export function neverEnds(order: OrderRequest): boolean {
  return rule('neverEnds', order)
}

/** Whether a Feed the stable step feeds it once and ends. */
export function feedsOnce(order: OrderRequest): boolean {
  return rule('feedsOnce', order)
}

/** The line a Build line step builds, if it is one with its road or wall and two ends. */
export function stepLine(order: OrderRequest): BuildLine | undefined {
  return opt(rule<BuildLine | null>('stepLine', order))
}

// Swaps, traders and stables (T122.5b).

/** The terms of a swap (`CONTEXT.md`: Swap), its prices as functions of the unit. */
export interface SwapTerms {
  give: PricedGood
  want: PricedGood
  /** The units of `want` the trader asks for. */
  wanted: number
  holder: TradeHolder
  /** The units of `want` it will hand over. */
  spare: number
  /** The units of `give` it will take. */
  takes: number
  /** The Coins it has to give back. */
  placeCoins: number
  /** The price of the `n`th unit of `want` it hands over, from 1. */
  wantPrice: (n: number) => number
  /** What it pays for the `n`th unit of `give` it takes, from 1. */
  givePrice: (n: number) => number
}

/**
 * Works a swap out unit by unit (`CONTEXT.md`: Swap), as the Rust does. The prices go across as
 * lists, the `n`th unit's at `n - 1`, as far as the swap can reach: what is wanted and spare of
 * `want`, what is held and taken of `give`.
 */
export function cutSwap(terms: SwapTerms): SwapQuote {
  const { give, want, wanted, holder, spare, takes, placeCoins } = terms
  const prices = (n: number, price: (n: number) => number) =>
    Array.from({ length: Math.max(0, Math.floor(n)) }, (_, i) => price(i + 1))
  const held = holder.stock[give] ?? 0
  return rule('cutSwap', {
    give,
    want,
    wanted,
    holder: holderOf(holder),
    // No JSON for Infinity: none is no end.
    spare: Number.isFinite(spare) ? spare : null,
    takes: Number.isFinite(takes) ? takes : null,
    placeCoins: Number.isFinite(placeCoins) ? placeCoins : null,
    wantPrices: prices(Math.min(wanted, spare), terms.wantPrice),
    givePrices: prices(Math.min(held, takes), terms.givePrice),
  })
}

/** The horses at a stable: those on its footprint. */
export function horsesIn<H extends { id: string; x: number; y: number }>(
  horses: readonly H[],
  stable: Building,
): H[] {
  const few = horses.map(({ id, x, y }) => asHorse({ id, x, y }))
  const ids = new Set(rule<string[]>('horsesIn', few, asBuilding(stable)))
  return horses.filter((h) => ids.has(h.id))
}

/** The breeding a stable keeps for these two horses, if it keeps one. */
export function keptBreeding(
  stable: Pick<Building, 'breedings'>,
  horseIds: readonly string[],
): KeptBreeding | undefined {
  const b = asBuilding({ kind: 'stable', ...stable })
  const kept = rule<KeptBreeding | null>('keptBreeding', b, horseIds)
  // The stable's own entry, as callers compare it with others.
  const same = (k: KeptBreeding) =>
    kept !== null && k.horseIds.every((id, i) => id === kept.horseIds[i])
  return stable.breedings?.find(same)
}
