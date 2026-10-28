import {
  ADULT_AGE,
  AGILITY_AVERAGE,
  AVERAGE_HORSE_STATS,
  BUILD_MATERIALS,
  BUILD_WORK,
  BUILDABLE,
  CARRIAGE_CAPACITY,
  COMBAT_SKILL_EFFECT,
  COMBAT_SKILL_LIMIT,
  CRIME_STANDING_LOSS,
  FOOD_PER_DAY,
  FOOD_SPOIL_PER_DAY,
  FOOTPRINT,
  HUNGER_ENDURANCE_AVERAGE,
  INTELLECT_AVERAGE,
  LIFESPAN_MIN,
  MAX_HEALTH,
  MAX_HUNGER,
  PRICE_REFERENCE_FLOORS,
  RECIPES,
  STANDING_DRIFT_PER_DAY,
  STAT_NAMES,
  STRIKE_TICKS,
  TEARDOWN_MATERIALS_RETURNED,
  TEARDOWN_WORK_SHARE,
  TERRITORY_CITY_BASE,
  TERRITORY_PER_ARMED,
  TERRITORY_PER_RESIDENT,
  TICK_MS,
  TICKS_PER_GAME_DAY,
  TICKS_PER_GAME_HOUR,
  HORSE_FOOD_PER_DAY,
  carriageCapacityWith,
  horseFoodFactor,
  Terrain,
  WALL_STRENGTH,
  WAREHOUSE_BASE_PRICE,
  WAREHOUSE_FLOOR,
  WORK_SKILL_MAX,
  WORK_SKILL_PER_DAY,
  WORK_STRENGTH_AVERAGE,
  attackPower,
  batchWork,
  buildWork,
  carryCapacity,
  controlReach,
  deliveryFee,
  driveSpeed,
  hungerFactor,
  priceFor,
  ticksForAge,
  transferFee,
  walkSpeed,
  workOutput,
  type BuildingKind,
  type CrimeKind,
  type Good,
  type Resident,
  type SkillName,
  type StatName,
  type Stock,
} from '@csp/shared'

/**
 * The Wiki's figures (`CONTEXT.md`: Wiki): everything it says worked out from the balance numbers
 * and functions in `@csp/shared`, so the page types no number itself and never goes stale.
 */

/** Where the Wiki lives, readable logged in or not. */
export const WIKI_PATH = '/wiki'

/** The tick the Wiki's residents are looked at: any will do, they are young adults throughout. */
const AT = 0

/** The stats at which every balance function counts a resident as average. */
export const AVERAGE_STATS: Record<StatName, number> = {
  strength: WORK_STRENGTH_AVERAGE,
  endurance: HUNGER_ENDURANCE_AVERAGE,
  agility: AGILITY_AVERAGE,
  intellect: INTELLECT_AVERAGE,
}

/** A grown-up resident with the given stats (average for the rest) and skills, for the figures. */
export function wikiResident(
  stats: Partial<Record<StatName, number>> = {},
  skills: Resident['skills'] = {},
): Resident {
  return {
    id: 'wiki',
    name: 'Average',
    owner: null,
    cityId: null,
    x: 0,
    y: 0,
    stats: Object.fromEntries(
      STAT_NAMES.map((s) => [s, { base: stats[s] ?? AVERAGE_STATS[s], trained: 0 }]),
    ) as Resident['stats'],
    skills,
    health: MAX_HEALTH,
    hunger: MAX_HUNGER,
    bornAt: AT - ticksForAge(ADULT_AGE * 2),
    lifespan: LIFESPAN_MIN,
    carried: {},
    order: null,
  }
}

/** The average resident: stats at average, no skills. */
export const AVERAGE = wikiResident()

// ---------- Formatting: game time first, real time after ----------

/** A number as the Wiki shows it: at most two decimals, thousands grouped. */
export function num(n: number, decimals = 2): string {
  return n.toLocaleString('en-GB', { maximumFractionDigits: decimals })
}

/** A number with its sign: "+20", "-25". */
export const signed = (n: number) => (n > 0 ? `+${num(n)}` : num(n))

/** A share as a percentage: 0.02 → "2 %". */
export const pct = (share: number) => `${num(share * 100, 1)} %`

/** Real time for a number of real seconds: "1 h 36 min". */
export function realTime(seconds: number): string {
  const s = Math.round(seconds)
  if (s >= 2 * 86_400) return `${num(s / 86_400, 1)} real days`
  if (s >= 3600) {
    const h = Math.floor(s / 3600)
    const min = Math.round((s - h * 3600) / 60)
    return min ? `${h} h ${min} min` : `${h} h`
  }
  if (s >= 60) {
    const min = Math.floor(s / 60)
    const rest = s - min * 60
    return rest ? `${min} min ${rest} s` : `${min} min`
  }
  return `${s} s`
}

const plural = (n: number, one: string) => `${num(n, 1)} ${one}${n === 1 ? '' : 's'}`

/** A length of time in ticks, game time first: "4 game days (1 h 36 min)". */
export function duration(ticks: number): string {
  const real = realTime((ticks * TICK_MS) / 1000)
  if (ticks >= TICKS_PER_GAME_DAY)
    return `${plural(ticks / TICKS_PER_GAME_DAY, 'game day')} (${real})`
  if (ticks >= TICKS_PER_GAME_HOUR)
    return `${plural(ticks / TICKS_PER_GAME_HOUR, 'game hour')} (${real})`
  return `${plural(ticks / (TICKS_PER_GAME_HOUR / 60), 'game minute')} (${real})`
}

/** A number of game days, game time first. */
export const days = (gameDays: number) => duration(gameDays * TICKS_PER_GAME_DAY)

/** A length of real time in seconds, as game time first like everything else. */
export const realSeconds = (seconds: number) => duration((seconds * 1000) / TICK_MS)

/** Real time alone for a number of ticks, where game time would say nothing new. */
export const realTimeOf = (ticks: number) => realTime((ticks * TICK_MS) / 1000)

// ---------- Production ----------

/** Units of `good` a resident makes per game day at a workplace using `skill`. */
export const outputPerDay = (good: Good, skill: SkillName, r: Resident = AVERAGE) =>
  workOutput(r, good, skill, AT) * TICKS_PER_GAME_DAY

/** Batches a resident gets through per game day at a smelter, mint or smithy. */
export const batchesPerDay = (kind: BuildingKind, r: Resident = AVERAGE) =>
  batchWork(r, kind, AT) * TICKS_PER_GAME_DAY

/** Food an average resident eats per game day on Plains. */
export const foodEatenPerDay = () => FOOD_PER_DAY * hungerFactor(AVERAGE, AT)

/** Residents (the farmer included) one average farmer feeds. */
export const residentsPerFarmer = () => outputPerDay('food', 'farming') / foodEatenPerDay()

/** Iron miners it takes to keep one smelter worker busy. */
export const minersPerSmelterWorker = () =>
  (batchesPerDay('smelter') * (RECIPES.smelter![0]!.input.ironOre ?? 0)) /
  outputPerDay('ironOre', 'mining')

/** Gold miners it takes to keep one mint worker busy. */
export const goldMinersPerMintWorker = () =>
  (batchesPerDay('mint') * (RECIPES.mint![0]!.input.goldOre ?? 0)) /
  outputPerDay('goldOre', 'mining')

/** Coins one mint worker strikes a game day. */
export const coinsPerMintWorkerDay = () =>
  batchesPerDay('mint') * (RECIPES.mint![0]!.output.coins ?? 0)

/** Game days of work to take a work skill from nothing to its cap, for an average learner. */
export const daysToWorkSkillMax = WORK_SKILL_MAX / WORK_SKILL_PER_DAY

/** Game days until half of a stock of Food has gone bad. */
export const foodHalfLifeDays = Math.log(0.5) / Math.log(1 - FOOD_SPOIL_PER_DAY)

// ---------- Prices ----------

export type PricedGood = keyof typeof WAREHOUSE_BASE_PRICE

/** What a warehouse sells and pays for a good when it holds `floors` times its stock floor. */
export function priceAt(good: PricedGood, floors: number) {
  const floor = WAREHOUSE_FLOOR[good]
  return priceFor(good, floors * floor, floor)
}

/** What goods are worth at a warehouse at its base price (`sell`) and what it pays (`buy`). */
export function worth(stock: Stock): { sell: number; buy: number } {
  let sell = 0
  let buy = 0
  for (const [good, units] of Object.entries(stock) as [Good, number][]) {
    if (good === 'coins') {
      sell += units
      buy += units
      continue
    }
    const p = priceAt(good, PRICE_REFERENCE_FLOORS)
    sell += p.sell * units
    buy += p.buy * units
  }
  return { sell, buy }
}

/** One worker's day at a workplace, and what it is worth at a warehouse. */
export interface JobDay {
  job: string
  makes: Stock
  uses: Stock
  /** What the output fetches at the base price, and at what a warehouse pays for it. */
  sell: number
  buy: number
  /** The output's worth at the base price, less its inputs' worth. */
  added: number
}

function jobDay(job: string, makes: Stock, uses: Stock = {}): JobDay {
  const out = worth(makes)
  return { job, makes, uses, ...out, added: out.sell - worth(uses).sell }
}

const scale = (stock: Stock, times: number): Stock =>
  Object.fromEntries(Object.entries(stock).map(([g, n]) => [g, n * times]))

function processing(job: string, kind: BuildingKind, recipe = 0): JobDay {
  const r = RECIPES[kind]![recipe]!
  const n = batchesPerDay(kind)
  return jobDay(job, scale(r.output, n), scale(r.input, n))
}

/** Coins per worker-day for each job, for an average worker with no skill. */
export function jobDays(): JobDay[] {
  const node = (job: string, good: Good, skill: SkillName) =>
    jobDay(job, { [good]: outputPerDay(good, skill) })
  return [
    node('Farmer', 'food', 'farming'),
    node('Woodcutter', 'wood', 'woodcutting'),
    node('Quarry worker', 'stone', 'mining'),
    node('Iron miner', 'ironOre', 'mining'),
    node('Gold miner', 'goldOre', 'mining'),
    processing('Smelter worker', 'smelter'),
    processing('Mint worker', 'mint'),
    ...RECIPES.smithy!.map((_, i) => processing('Smith', 'smithy', i)),
  ]
}

// ---------- Building ----------

/** One line of the building cost sheet. */
export interface BuildCost {
  kind: BuildingKind
  footprint: number
  materials: Stock
  /** Ticks one average builder takes, alone, to build it and to tear it down. */
  buildTicks: number
  teardownTicks: number
  /** Materials left on the tile when the finished building is torn down. */
  returned: Stock
}

/**
 * The building cost sheet: every kind that can be built but a carriage, which is no building once
 * finished (`carriageCost`).
 */
export function buildCosts(): BuildCost[] {
  const pace = buildWork(AVERAGE, AT)
  return BUILDABLE.filter((kind) => kind !== 'carriage').map((kind) => {
    const materials = BUILD_MATERIALS[kind] ?? {}
    const work = BUILD_WORK[kind] ?? 0
    const returned: Stock = {}
    for (const [good, units] of Object.entries(materials) as [Good, number][]) {
      const back = Math.floor(units * TEARDOWN_MATERIALS_RETURNED)
      if (back > 0) returned[good] = back
    }
    return {
      kind,
      footprint: FOOTPRINT[kind],
      materials,
      buildTicks: work / pace,
      teardownTicks: (work * TEARDOWN_WORK_SHARE) / pace,
      returned,
    }
  })
}

/**
 * What a carriage takes to build at a stable (`CONTEXT.md`: Carriage): its materials and the
 * ticks one average builder takes, alone.
 */
export function carriageCost(): { materials: Stock; buildTicks: number } {
  return {
    materials: BUILD_MATERIALS.carriage ?? {},
    buildTicks: (BUILD_WORK.carriage ?? 0) / buildWork(AVERAGE, AT),
  }
}

// ---------- Transport ----------

export const TERRAIN_NAMES = ['Plains', 'Forest', 'Hills', 'Mountain', 'Road'] as const

/** How far and how much an average resident on foot, or a carriage, moves per game hour. */
export interface TransportRow {
  terrain: (typeof TERRAIN_NAMES)[number]
  footTiles: number
  footKgTiles: number
  /** Zero where a carriage cannot go. */
  carriageTiles: number
  carriageKgTiles: number
}

export const AVERAGE_CARRY = carryCapacity(AVERAGE, AT)

/** A horse of average stats (`CONTEXT.md`: Horse stats), for the wiki's carriage numbers. */
export const AVERAGE_HORSE = { stats: AVERAGE_HORSE_STATS }

export function transport(): TransportRow[] {
  return TERRAIN_NAMES.map((terrain) => {
    const footTiles = walkSpeed(AVERAGE, Terrain[terrain], AT) * TICKS_PER_GAME_HOUR
    const carriageTiles = driveSpeed(AVERAGE, AVERAGE_HORSE, Terrain[terrain]) * TICKS_PER_GAME_HOUR
    return {
      terrain,
      footTiles,
      footKgTiles: footTiles * AVERAGE_CARRY,
      carriageTiles,
      carriageKgTiles: carriageTiles * CARRIAGE_CAPACITY,
    }
  })
}

/**
 * What a horse with every stat at `value` does (`CONTEXT.md`: Horse stats): tiles its carriage
 * goes on plains in a game hour with an untrained driver, what the carriage holds, and the Food it
 * eats a game day.
 */
export function horseRow(value: number): { plainsTiles: number; capacity: number; food: number } {
  const horse = { stats: { speed: value, strength: value, endurance: value } }
  return {
    plainsTiles: driveSpeed(AVERAGE, horse, Terrain.Plains) * TICKS_PER_GAME_HOUR,
    capacity: carriageCapacityWith(horse),
    food: HORSE_FOOD_PER_DAY * horseFoodFactor(horse),
  }
}

/** Example deliveries: kg over tiles, and what the delivery and a transfer of it cost. */
export function feeExamples(loads: readonly [kg: number, tiles: number][]) {
  return loads.map(([kg, tiles]) => ({
    kg,
    tiles,
    delivery: deliveryFee(kg, tiles),
    transfer: transferFee(kg, tiles),
  }))
}

// ---------- Standing, combat, territory ----------

/** Game days standing takes to drift back from each crime's loss to neutral. */
export function crimeForgotten(): { crime: CrimeKind; loss: number; days: number }[] {
  return (Object.entries(CRIME_STANDING_LOSS) as [CrimeKind, number][]).map(([crime, loss]) => ({
    crime,
    loss,
    days: loss / STANDING_DRIFT_PER_DAY,
  }))
}

/** Combat skill points at which a blow is as hard as it gets. */
export const COMBAT_SKILL_MAX = COMBAT_SKILL_LIMIT / COMBAT_SKILL_EFFECT

/** How hard an average resident strikes with the given gear and Combat skill. */
export const blow = (carried: Stock = {}, combat = 0) =>
  attackPower({ ...wikiResident({}, { combat }), carried }, AT)

/** Ticks an average unarmed resident takes alone to break a tile of wall or a gate. */
export const breakTicks = (what: 'wall' | 'gate') =>
  Math.ceil(WALL_STRENGTH[what] / blow()) * STRIKE_TICKS

/** A city's control from its residents and armed ones, and how far it reaches. */
export function cityControl(residents: number, armed: number) {
  const strength =
    TERRITORY_CITY_BASE + residents * TERRITORY_PER_RESIDENT + armed * TERRITORY_PER_ARMED
  return { residents, armed, strength, reach: controlReach(strength) }
}
