import type { Task } from './default-scripts.js'
import type { OrderRequest, Remembered } from './protocol.js'
import { Terrain } from './terrain.js'

export const TICK_MS = 1000

/** One game day is 24 real minutes: a real second is a game minute (`CONTEXT.md`: Game time). */
export const TICKS_PER_GAME_DAY = 1440
/** One game year is 420 game days, one real week. */
export const TICKS_PER_GAME_YEAR = 420 * TICKS_PER_GAME_DAY

/** A resident's stats (`CONTEXT.md`: Stats). */
export const STAT_NAMES = ['strength', 'endurance', 'agility', 'intellect'] as const
export type StatName = (typeof STAT_NAMES)[number]

/** A horse's stats (`CONTEXT.md`: Horse stats). */
export const HORSE_STAT_NAMES = ['speed', 'strength', 'endurance'] as const
export type HorseStatName = (typeof HORSE_STAT_NAMES)[number]

/** A horse's stats, whole numbers it is born with; nothing trains them. */
export type HorseStats = Record<HorseStatName, number>

/** A stat: what the resident was born with, plus what training added (capped by the base). */
export interface Stat {
  base: number
  trained: number
}

/** Something learned by doing or training; starts at 0, never inherited (`CONTEXT.md`: Skill). */
export type SkillName =
  | 'mining'
  | 'woodcutting'
  | 'smelting'
  | 'smithing'
  | 'construction'
  | 'farming'
  | 'combat'
  | 'driving'

/** A person living in the world (`CONTEXT.md`: Resident). Plain data. */
export interface Resident {
  id: string
  name: string
  /** The realm the resident belongs to; null for one of an NPC city (`cityId`) or of nobody. */
  owner: string | null
  /** The city the resident lives in (`CONTEXT.md`: City, House); null for one of no city. */
  cityId: string | null
  x: number
  y: number
  stats: Record<StatName, Stat>
  /** Skills learned so far; a missing skill is 0. */
  skills: Partial<Record<SkillName, number>>
  /** 0 is dead; the most is `MAX_HEALTH`. */
  health: number
  /** The hunger meter: `MAX_HUNGER` is fully fed, 0 is empty. */
  hunger: number
  /** The tick the resident was born; may be before the world began. Age follows from it. */
  bornAt: number
  /** The age in game years at which the resident dies of old age (`CONTEXT.md`: Aging). */
  lifespan: number
  /** Goods the resident carries, up to their carry capacity. */
  carried: Stock
  /** What the resident was ordered to do, as plain data; null when idle (ADR 0002). */
  order: ResidentOrder | null
  /** How their last store or fetch order ended (`OrderEnded`); absent when none did since. */
  orderEnded?: OrderEnded
  /**
   * Who last struck the resident and when (`CONTEXT.md`: Combat, Under attack), a dodged blow
   * too; absent until someone does. `by` stays the attacker's id after they are gone.
   */
  struck?: Struck
  /**
   * The script the resident runs, when they were given the run-script order (`CONTEXT.md`:
   * Running a script). Its actions set `order` like UI orders; any other order ends it. Absent
   * when they run none.
   */
  script?: RunningScript
  /**
   * The values the Player picked for this resident's script parameters (`CONTEXT.md`: Script
   * parameter): by script id, then by param name, the id of the building or carriage picked.
   * Kept when the script ends, so giving the task again keeps them. Absent while none is picked.
   */
  scriptParams?: ScriptParamValues
  /**
   * The resident's script log (`CONTEXT.md`: Script log): what their scripts gave `log()` and
   * `end(reason)`, oldest first, at most `SCRIPT_LOG_LINES`. Kept across scripts; only the
   * owning Player sees it. Absent while nothing was logged.
   */
  scriptLog?: ScriptLogLine[]
  /**
   * The queue the resident works through (`CONTEXT.md`: Queue), when they were given one. Its
   * current step sets `order` or `script` as if it had been given on its own; any order that
   * isn't a step of it ends it. Absent when they have none.
   */
  queue?: Queue
  /** The resident's pair (`CONTEXT.md`: Pairing), if they are paired. Not an order. */
  pair?: Pair
  /** The child the resident is carrying (`CONTEXT.md`: Carrying), if any. */
  carrying?: Carrying
  /**
   * The horse the resident rides (`CONTEXT.md`: Riding), if they ride one. Not an order: they go
   * on with whatever they do, at the horse's pace.
   */
  riding?: string
  /**
   * The carriage the resident rides on as a passenger (`CONTEXT.md`: Passenger), if they are
   * aboard one. Not an order: they move with the carriage and don't walk on their own.
   */
  aboard?: string
}

/**
 * A queue (`CONTEXT.md`: Queue): steps done one after another, as plain data (ADR 0002).
 * `current` is the step being done, always one of `steps`; `startedAt` the tick it started, null
 * until it has. With `loop` the first step follows the last; without, the queue ends after it.
 */
export interface Queue {
  /** The realm whose Player gave it; it ends once that realm no longer commands the resident. */
  realmId: string
  /** Never empty, and never a queue among them. */
  steps: QueueStep[]
  current: number
  startedAt: number | null
  loop: boolean
  /** The id the next step added gets, so ids in the queue are never reused. */
  nextStepId: number
}

/**
 * One step of a queue: an order request as the UI or a script gives it (one-off actions, tasks,
 * the Player's own scripts), without whom it is for. It ends when done, or once `minutes` game
 * minutes have passed since it started, if set.
 */
export interface QueueStep {
  /** Tells the steps apart while the list is edited; unique in the queue. */
  id: number
  order: OrderRequest
  minutes?: number
}

/**
 * Pairing (`CONTEXT.md`: Pairing): the resident and their partner, two adults of the same city,
 * are set to have a child. Both hold a pair naming the other, with the same `since`: the tick they
 * paired. Pairing is no order: both go on with whatever they do. Once a game year has passed since
 * then, and their city has free housing and a food surplus, one of them starts carrying the
 * child; the pair ends when it is born.
 */
export interface Pair {
  partnerId: string
  since: number
}

/**
 * Carrying a child (`CONTEXT.md`: Carrying): since the tick `since` the resident can't work,
 * build, tear down or haul; `CARRYING_DAYS` later the child is born. The other parent's name and
 * base stats are kept, so the child is born even if that parent is gone by then.
 */
export interface Carrying {
  since: number
  partnerId: string
  partnerName: string
  partnerBase: Record<StatName, number>
}

/** Why a resident carrying a child is turned down for work, building, tearing down or hauling. */
export const CARRYING_A_CHILD = 'carrying a child'

/** A script value as plain data, the only kind a script's memory keeps between ticks. */
export type MemoryValue = number | string | boolean | null | MemoryValue[] | ScriptMemory

/** A running script's memory (`CONTEXT.md`: Memory): plain, serialisable data (ADR 0002). */
export interface ScriptMemory {
  [key: string]: MemoryValue
}

/**
 * A resident's picked script parameter values: script id → param name → building or carriage
 * id, or the whole number typed for a `number` param.
 */
export interface ScriptParamValues {
  [scriptId: string]: { [name: string]: ScriptParamValue }
}

/** One line of a resident's script log: the tick it was logged and its short text. */
export interface ScriptLogLine {
  tick: number
  text: string
}

/** A picked script parameter value: a building or carriage id, or a whole number of zero or more. */
export type ScriptParamValue = string | number

/**
 * The param values an order starting a script gives (`CONTEXT.md`: Script parameter, Before it
 * starts), by name: what is picked or typed for each, or null to clear it back to its default.
 * A param left out keeps its value.
 */
export interface StartParamValues {
  [name: string]: ScriptParamValue | null
}

/**
 * A resident's or army's run-script order: which script of the Player's library, and its memory.
 */
export interface RunningScript {
  /**
   * The script in the Player's library; its active version is what runs each tick. 0 while it
   * runs the default of `task` without one: the game's own for an NPC city's resident, until a
   * Player's resident first runs it as the Player's version.
   */
  scriptId: number
  /**
   * Runs the default script of this task (`CONTEXT.md`: Default script) rather than one the
   * Player picked, as an NPC city's residents and a starting city's farmers do.
   */
  task?: Task
  /** What the script kept between ticks, at most `SCRIPT_MEMORY_MAX` characters of JSON. */
  memory: ScriptMemory
  /** The tick its last error went into the realm log; errors are logged rate-limited. */
  errorLoggedAt?: number
  /** The tick its last out-of-steps warning went into the realm log. */
  budgetLoggedAt?: number
  /**
   * Its last runtime error (`CONTEXT.md`: Debugging a script), kept until the script ends or
   * another version of it runs.
   */
  lastError?: ScriptRunError
  /** The steps it used the last tick it ran, and whether it ran out (`CONTEXT.md`: Step budget). */
  lastRun?: ScriptRunSteps
}

/** A script's last runtime error, as its Script tab shows it (`CONTEXT.md`: Debugging a script). */
export interface ScriptRunError {
  message: string
  /** Where in the script, when the error is in the script itself. */
  line?: number
  column?: number
  /** The tick it stopped with the error. */
  tick: number
  /** The version of the script that ran into it. */
  version: number
}

/**
 * The steps a script used the last tick it ran (`CONTEXT.md`: Step budget), out of
 * `SCRIPT_STEP_BUDGET`. `outOfSteps` when it ran out: of its own budget, or of the realm's, which
 * cut it short or skipped it.
 */
export interface ScriptRunSteps {
  steps: number
  outOfSteps?: 'own' | 'realm'
}

/**
 * What a Player sees of the script a resident runs: which one, but not its memory. The owning
 * Player also sees what goes into their Doing line (`CONTEXT.md`: Doing): the `task` when it
 * runs a task's default script without one of the Player's, the kind of `building` its task is
 * about (from its memory, as `TaskMemory` holds it), and the text it last gave `doing()`.
 */
export interface SeenScript {
  scriptId: number
  task?: Task
  building?: BuildingKind
  doing?: string
  /**
   * The values picked for its params, by name (`Resident.scriptParams`); only for the realm
   * running it.
   */
  params?: { [name: string]: ScriptParamValue }
}

/**
 * A resident as Players see them (`CONTEXT.md`: Sight): which script they run, but not its
 * memory, which stays on the server, nor their script log, which the owning Player gets only on
 * the Script tab. Their hunger and health only for their own realm and its allies (`CONTEXT.md`:
 * Seeing how someone fares). Their script parameter values only for the realm that commands them:
 * all they keep, so a script's params can be filled in before it starts (`CONTEXT.md`: Script
 * parameter), and those of the script they run with it.
 */
export type SeenResident = Omit<
  Resident,
  'script' | 'hunger' | 'health' | 'scriptParams' | 'scriptLog'
> &
  Partial<Pick<Resident, 'hunger' | 'health' | 'scriptParams'>> & { script?: SeenScript }

/**
 * Walking to a tile (`CONTEXT.md`: Order). The path is found a little at a time after the order
 * arrives; until then it is null. `progress` is how far into the next step the resident is, in
 * tiles; at 1 they request the step.
 */
export interface WalkOrder {
  kind: 'walkTo'
  target: { x: number; y: number }
  /** The tiles still to walk, in order; null while the path is being found. */
  path: [number, number][] | null
  progress: number
  /** The army whose order this is (`CONTEXT.md`: Army); missing for the resident's own order. */
  army?: string
}

/**
 * A place on the resident's own tile that goods are taken from or put: the pile on the ground,
 * a storage standing there, the materials delivered to a construction site there, or the load
 * of a carriage standing there.
 */
export type GoodsSpot =
  | { kind: 'ground' }
  | { kind: 'storage'; storageId: string }
  | { kind: 'site'; siteId: string }
  | { kind: 'carriage'; carriageId: string }

/**
 * Picking up goods on the resident's tile (`CONTEXT.md`: Core rule, whatever isn't protected can
 * be taken). The resident takes what is there of `goods`, as much as fits their carry capacity.
 */
export interface PickUpOrder {
  kind: 'pickUp'
  from: GoodsSpot
  goods: Stock
}

/**
 * Putting down carried goods on the resident's tile: on the ground (a pile), in a storage, or as
 * materials for a construction site (only what the site still needs).
 */
export interface DropOrder {
  kind: 'drop'
  to: GoodsSpot
  goods: Stock
}

/**
 * Where a store or fetch order takes goods to or from: a storage or a stable's storage, or a
 * carriage (`CONTEXT.md`: Store, Fetch).
 */
export type GoodsPlace = Extract<GoodsSpot, { kind: 'storage' | 'carriage' }>

/**
 * The goods a store or fetch order moves: units of each good, or null for as many as there are
 * (to store: all carried but own food; to fetch: as much as fits).
 */
export type GoodsWanted = Partial<Record<Good, number | null>>

/**
 * Storing (`CONTEXT.md`: Store): the resident walks to `to` (`path` and `progress` as for a walk
 * order), puts the goods there and, at a storage with Food, tops up their own food. Done then.
 */
export interface StoreOrder {
  kind: 'store'
  goods: GoodsWanted
  to: GoodsPlace
  phase: 'walking' | 'putting' | 'refilling'
  /**
   * The Food the resident keeps on them and tops up to at a storage with Food, in units; absent
   * for `OWN_FOOD` (`CONTEXT.md`: Getting food).
   */
  ownFood?: number
  /** While walking, the tiles still to walk; null while the path is being found. */
  path: [number, number][] | null
  progress: number
}

/**
 * Fetching (`CONTEXT.md`: Fetch): the resident walks to `from` (`path` and `progress` as for a
 * walk order) and takes the goods there, as much as fits. Done then.
 */
export interface FetchOrder {
  kind: 'fetch'
  goods: GoodsWanted
  from: GoodsPlace
  phase: 'walking' | 'taking'
  /** While walking, the tiles still to walk; null while the path is being found. */
  path: [number, number][] | null
  progress: number
}

/**
 * How the resident's last store or fetch order ended, so a script can tell: `reason` is null when
 * it was done, else why it ended early ("no way", "the storage is gone", "the carriage is gone"). Kept until their next
 * store or fetch order, or until the Player orders them otherwise.
 */
/** Who last struck a resident (`Resident.struck`): the attacker's id, and the tick. */
export interface Struck {
  by: string
  tick: number
}

export interface OrderEnded {
  kind: 'store' | 'fetch'
  tick: number
  reason: string | null
}

/**
 * Building (`CONTEXT.md`: Building, Road): the resident lays out a construction site of
 * `building` on the tile they stand on (`at`), or joins the unfinished one of that kind already
 * there, then works on it until it is finished. `siteId` is null until they are on the site.
 */
export interface BuildOrder {
  kind: 'build'
  building: BuildingKind
  at: { x: number; y: number }
  siteId: string | null
}

/**
 * Working at a workplace (`CONTEXT.md`: Workplace): the resident works the workplace on the tile
 * they stand on (`at`), until ordered otherwise. `progress` is how much of the
 * next unit of output their work has made so far, from 0 up to (not including) 1.
 */
export interface WorkOrder {
  kind: 'workAt'
  buildingId: string
  at: { x: number; y: number }
  progress: number
  /**
   * At a workplace with more than one recipe (a smithy), the good this resident makes there
   * (`recipeFor`). Missing elsewhere.
   */
  makes?: Good
}

/**
 * Tearing down (`CONTEXT.md`: Tearing down): the resident works at taking down the building or
 * construction site `buildingId` on the tile they stand on (`at`) until it is gone.
 */
export interface TearDownOrder {
  kind: 'tearDown'
  buildingId: string
  at: { x: number; y: number }
}

/**
 * Driving a carriage to a tile (`CONTEXT.md`: Carriage): the resident drives the carriage
 * `carriageId` from their tile, and the carriage, its horse and the driver move together. The
 * path and `progress` work as for walking, at the carriage's speeds, into mountains only on a road.
 */
export interface DriveOrder {
  kind: 'drive'
  carriageId: string
  target: { x: number; y: number }
  /** The tiles still to drive, in order; null while the path is being found. */
  path: [number, number][] | null
  progress: number
  /**
   * The army the carriage follows as its supply wagon (`CONTEXT.md`: Supply line): `target` is
   * then where the army was last seen, and the order lasts as long as the army does.
   */
  army?: string
}

/**
 * A haul route (`CONTEXT.md`: Haul route): the resident drives the carriage `carriageId` between
 * two stops again and again. At `from` they load `goods` onto it, as much as there is and fits;
 * at `to` they unload them, and the other way round for `returnGoods`. At both stops they top up
 * the Food on board to `keepFood` units, for the horse, and that much Food stays on. Loading and unloading go through their hands, one take
 * or put a tick, like a pick-up or drop order. Driving works as for a drive order.
 */
export interface HaulOrder {
  kind: 'haul'
  carriageId: string
  /** Where the goods are loaded. */
  from: { x: number; y: number }
  /** Where they are unloaded. */
  to: { x: number; y: number }
  /**
   * The army that is the second stop (`CONTEXT.md`: Supply line): `to` is then where the army was
   * last seen. There the carriage stays with the army, its members refilling from it, until the
   * hauled goods are gone, and then goes back for more. Nothing comes back.
   */
  toArmy?: string
  /** The goods hauled from `from` to `to`; at least one. */
  goods: Good[]
  /** The goods hauled back from `to` to `from`; none of `goods`, and maybe none at all. */
  returnGoods: Good[]
  /** Units of Food kept on board for the horse. */
  keepFood: number
  /** The stop the carriage stands at or is driving to. */
  stop: 'from' | 'to'
  /** Loading and unloading at the stop, or driving to it. */
  phase: 'loading' | 'driving'
  /** While driving, the tiles still to drive; null while the path is being found. */
  path: [number, number][] | null
  progress: number
  /**
   * Goods the resident took last tick to put on the carriage or at the stop: which good, how many
   * of it they held before, and where it goes. Null when they hold nothing for the route.
   */
  moving: { good: Good; before: number; onto: 'carriage' | 'stop' } | null
}

/**
 * Attacking a resident (`CONTEXT.md`: Combat): the resident goes after `targetId` and, once in
 * contact (the same or a neighbouring tile), strikes them until one of them dies, the target gets
 * out of their sight or they are given another order. The target may also be a wall or gate, which
 * they strike until it falls (`CONTEXT.md`: Walls in combat, broken). Out of contact they walk towards the target
 * along `path` (null while it is being found), as for a walk order; `progress` is how far into the
 * next step they are. `strike` is how far, from 0 up to 1, they are into their next blow.
 * `started` is set once the fight went in the realm logs. `defending` is set when the resident
 * fights back at someone who hit them, or as a caravan's escort defends it (`CONTEXT.md`:
 * Caravan), which is no crime (`CONTEXT.md`: Crime).
 */
export interface AttackOrder {
  kind: 'attack'
  targetId: string
  path: [number, number][] | null
  progress: number
  strike: number
  started: boolean
  defending?: true
  /** The army whose order this is (`CONTEXT.md`: Army); missing for the resident's own order. */
  army?: string
}

/**
 * Building a road or wall along a line (`CONTEXT.md`: Road, Wall / Gate): a `roadLine` order
 * builds road and a `wallLine` order wall (`LINE_BUILDING`) on the tiles of `tiles`, one after
 * another. For each the resident walks to it (`path` and `progress` as for a walk order), then
 * lays out a site there or joins the one already there, puts in the materials they carry that it
 * needs, and works on it as for a build order (`siteId`) until it is finished. A tile that already
 * has one, or can't take one, is skipped. The order ends after the last.
 */
export interface LineOrder {
  kind: 'roadLine' | 'wallLine'
  /** The tiles still to build, in order; the first is being walked to or built. Never empty. */
  tiles: [number, number][]
  phase: 'walking' | 'building'
  /** While walking, the tiles still to walk; null while the path is being found. */
  path: [number, number][] | null
  progress: number
  /** While building, the site on the first tile; null until it is laid out or joined. */
  siteId: string | null
}

/**
 * Climbing a wall or gate (`CONTEXT.md`: Walls in combat, climbed): the resident, standing at
 * `at` next to `wallId`, climbs over it. `progress` goes from 0 up to 1 (`CLIMB_TICKS`); then
 * they come down on the far side. While climbing they can't defend themselves.
 */
export interface ClimbOrder {
  kind: 'climb'
  wallId: string
  at: { x: number; y: number }
  progress: number
}

/**
 * Breeding (`CONTEXT.md`: Breeding): the resident, standing at the finished stable `stableId` on
 * `at`, tends the two horses `horseIds` standing in it. `progress` counts the ticks the pair has
 * been tended, up to `STABLE_BREED_TICKS`; then a foal is born there and the order is done. The
 * progress belongs to the pair, kept by the stable (`Building.breedings`); the order shows the
 * same number. It ends when the resident or a horse leaves or a horse dies, and makes no progress
 * while the stable has no room left.
 */
export interface BreedOrder {
  kind: 'breed'
  stableId: string
  horseIds: [string, string]
  at: { x: number; y: number }
  progress: number
}

/** Any order a resident can hold. */
export type ResidentOrder =
  | WalkOrder
  | DriveOrder
  | HaulOrder
  | PickUpOrder
  | DropOrder
  | StoreOrder
  | FetchOrder
  | BuildOrder
  | TearDownOrder
  | WorkOrder
  | BreedOrder
  | AttackOrder
  | ClimbOrder
  | LineOrder
  | PayOrder
  | BuyCityOrder
  | TradeOrder
  | HandInOrder
  | BuyOffOrder

/** A stat's effective value: base and trained bonus together. */
export function effective(stat: Stat): number {
  return stat.base + stat.trained
}

/**
 * Everything in the world that changes, saved as snapshots (ADR 0006). Terrain is not part of
 * it: it is generated once from `seed` and stored on its own.
 */
export interface WorldState {
  tick: number
  /** The seed the map was generated from. */
  seed: number
  residents: Resident[]
  /** Placed once when the world is created, from the terrain and the seed. */
  nodes: ResourceNode[]
  /** The number the next new entity's id gets, so ids are never reused. */
  nextId: number
  realms: Realm[]
  cities: City[]
  buildings: Building[]
  horses: Horse[]
  carriages: Carriage[]
  /** Goods lying on the ground, at most one pile per tile. */
  piles: Pile[]
  /** Each Player's latest realm events, oldest first, at most `REALM_LOG_LENGTH` each. */
  events: RealmEvent[]
  /** Alliances with at least one member (`CONTEXT.md`: Alliance). */
  alliances: Alliance[]
  /** Armies with at least one member (`CONTEXT.md`: Army). */
  armies: Army[]
  /** Crimes a witness still carries news of, or that an Organization still remembers. */
  crimes: Crime[]
  /** Every standing other than neutral, one per pair of Organizations (`CONTEXT.md`: Standing). */
  standings: Standing[]
  /** Mercenary contracts offered or in force (`CONTEXT.md`: Mercenary contract). */
  contracts: MercenaryContract[]
  /**
   * NPC cities asking a realm to join it, and asks a realm declined that the city still
   * remembers (`CONTEXT.md`: Persuading a city).
   */
  joinRequests: JoinRequest[]
  /** The Trade Organization's caravans, one on each trading post's route (`CONTEXT.md`: Caravan). */
  caravans: Caravan[]
  /** Deliveries and pick-ups ordered and not yet done, oldest first (`CONTEXT.md`: Delivery). */
  deliveries: Delivery[]
  /** Transfers between realms ordered and not yet done, oldest first (`CONTEXT.md`: Transfer). */
  transfers: Transfer[]
  /**
   * How often each caravan route was robbed (`CONTEXT.md`: Guaranteed carriage), by the trading
   * post at its far end; a route never robbed has no entry.
   */
  routeRobberies: Record<string, number>
  /** The Trade Org army's punishments under way (`CONTEXT.md`: Trade Org reaction). */
  punishments: Punishment[]
  /** Admin directives in force, oldest first (`CONTEXT.md`: Admin directive). */
  directives: Directive[]
  /**
   * What each Player has seen of buildings and cities, by their account id (`CONTEXT.md`: Last
   * seen): what is in their sight now as of this tick, and what left it as they last saw it.
   */
  lastSeen: Record<number, Remembered[]>
  /**
   * How many of the breaking changes to the script views (`SCRIPT_VIEW_CHANGES`) the Players were
   * told of in their realm logs; the server tells them of the rest at start.
   */
  scriptViewChanges: number
  /**
   * The account ids of the Players who claimed their Horse offer (`CONTEXT.md`: Horse offer):
   * kept with the Player, not the realm, so a claim outlives a Leader death.
   */
  horseOffersClaimed: number[]
}

/**
 * An admin's order to the Trade Organization to weaken an Organization (`CONTEXT.md`: Admin
 * directive). Until an admin lifts it, the Trade Organization treats the target, and with
 * `withAlliance` every member of its alliance, as one to punish. Every Player sees the target and
 * the reason; only admins see `givenBy`. Plain data (ADR 0002).
 */
export interface Directive {
  id: string
  /** The Organization it names: a realm or an NPC city. */
  target: string
  /** Whether it also names whoever is in the target's alliance, as the alliance stands. */
  withAlliance: boolean
  reason: string
  /** The giving admin's account name. */
  givenBy: string
  givenAt: number
  /**
   * What ends it (`CONTEXT.md`: Admin directive): once every goal is met the game lifts it. A
   * directive given before goals existed has none and ends only when an admin lifts it.
   */
  goals: DirectiveGoal[]
  /** Soldiers of the Organizations it names killed since it was given, for `soldiers` goals. */
  soldiersKilled: number
  /**
   * The Coins the target can pay at any Trade Org warehouse to buy the directive off, or null when
   * the admin doesn't allow it (`CONTEXT.md`: Admin directive).
   */
  price: number | null
}

/**
 * A goal of an admin directive (`CONTEXT.md`: Admin directive):
 * - `city`: a city of an Organization the directive names is destroyed: it is gone, or belongs to
 *   none of them any more (captured, dissolved, self-managed). `city` is its name when the goal
 *   was set. Once met it stays met.
 * - `soldiers`: `count` soldiers of the Organizations it names are killed. Set as a share, it
 *   keeps the `percent` of the soldiers they had when the directive was given; `count` is that
 *   share.
 */
export type DirectiveGoal =
  | { kind: 'city'; cityId: string; city: string; met: boolean }
  | { kind: 'soldiers'; count: number; percent?: number }

/**
 * A Trade Org caravan (`CONTEXT.md`: Caravan): one of the Trade Organization's carriages, driven
 * by one of its residents and escorted by others, on the fixed route between a trading post and
 * the Trade Org HQ. At each end it stops first at the storage, to top up the Food on board for
 * its crew and horse, then at the warehouse, where it unloads what it brought and loads what
 * evens out the two warehouses' stock. Plain data (ADR 0002): the game gives the crew the same
 * drive, pick-up, drop and walk orders a Player could give.
 */
export interface Caravan {
  id: string
  /** The trading post at the far end of its route; the other end is the HQ. */
  postId: string
  carriageId: string
  /** The resident who drives the carriage. */
  driverId: string
  /** The residents who walk along with it (the escort). */
  escortIds: string[]
  /** The end of the route it stands at or is driving to. */
  heading: 'hq' | 'post'
  /** Where at that end it stands or is going: the storage first, then the warehouse. */
  stop: 'storage' | 'warehouse'
  /**
   * Goods still to load at this end's warehouse for the other end, worked out once all it
   * brought is unloaded; null until then.
   */
  toLoad: Stock | null
  /**
   * Goods the driver took last tick to put down, and where they go; null when they hold nothing
   * for the caravan.
   */
  holding: { goods: Stock; onto: 'carriage' | 'stop' } | null
  /** The delivery it is carrying out instead of going on along its route (`CONTEXT.md`: Delivery). */
  job: CaravanJob | null
  /** The transfer it is carrying out instead of going on along its route (`CONTEXT.md`: Transfer). */
  transfer: TransferJob | null
}

/**
 * A delivery or pick-up the Trade Organization owes a realm (`CONTEXT.md`: Delivery), ordered at
 * its warehouse `warehouseId`. A `delivery` was bought and paid for, fee and all: `units` of
 * `good` that the warehouse keeps for it until a caravan loads them and brings them to the
 * storage of the realm's city `cityId`. A `pickUp` is a sale of up to `units` of `good` from that
 * city's storage: a caravan comes with coins, takes the goods there and pays for them at the
 * warehouse's prices of the moment, less the fee, and brings them to the warehouse. A caravan
 * standing at the warehouse takes it on (`caravanId`). Plain data (ADR 0002).
 */
export interface Delivery {
  id: string
  kind: 'delivery' | 'pickUp'
  realmId: string
  warehouseId: string
  cityId: string
  good: Exclude<Good, 'coins'>
  units: number
  /** The fee a delivery was paid with; 0 for a pick-up, whose fee comes off what it pays. */
  fee: number
  /** The caravan carrying it out, or null while it waits for one. */
  caravanId: string | null
}

/**
 * What a caravan does for a delivery it took on (`Delivery`), one step after another, each at a
 * building it drives to first. A delivery loads the goods at the warehouse (`load`) and puts
 * them into the city's storage (`deliver`). A pick-up loads coins at the warehouse's coin
 * warehouse (`load`), takes the goods at the city's storage (`collect`) and pays there (`pay`),
 * then unloads the goods at the warehouse (`return`) and the coins left at the coin warehouse
 * (`returnCoins`). A caravan that can't get to the storage turns back (`return`) with what it
 * carries for the delivery, which waits for the next caravan. A caravan robbed on the way is made
 * good out of the Trade Org's own stock (`CONTEXT.md`: Guaranteed carriage): what was taken of a
 * delivery is sent again with the next caravan, and coins taken from a pick-up are fetched again
 * at the coin warehouse (`load`). Plain data (ADR 0002).
 */
export interface CaravanJob {
  deliveryId: string
  kind: Delivery['kind']
  warehouseId: string
  good: Exclude<Good, 'coins'>
  step: 'load' | 'deliver' | 'collect' | 'pay' | 'return' | 'returnCoins'
  /** Units of the good on the carriage for the delivery. */
  units: number
  /** Coins on the carriage for the delivery (a pick-up's). */
  coins: number
  /**
   * The units to put into or take from the city's storage, worked out when the caravan gets
   * there; null until then.
   */
  target: number | null
  /** A pick-up's price at the storage, less the `fee`, and how much of it is paid so far. */
  toPay: number
  paid: number
  fee: number
  /** Drives towards the step's building that ended short of it. */
  misses: number
  /**
   * Units of the good robbers took off the carriage once they were the realm's: a delivery's on
   * the way to the storage, a pick-up's after it collected them (`CONTEXT.md`: Guaranteed
   * carriage).
   */
  robbed: number
}

/**
 * A transfer between realms (`CONTEXT.md`: Transfer): the Trade Organization carries `units` of
 * `good` (coins too) from the realm `realmId` to the storage of `toCityId`, a city of the realm
 * `toRealmId`, with a caravan of its warehouse `warehouseId`. Ordered from the realm, a caravan
 * picks the goods up at the storage of the sender's city `fromCityId` and takes the fee there;
 * handed in at the warehouse, the warehouse keeps them for it (`fromCityId` null), the fee paid.
 * What robbers took is sent again out of the warehouse's stock the same way. Cancelled, it is
 * brought `back` to the sender's city `toCityId` instead. A caravan standing at the warehouse
 * takes it on (`caravanId`). Plain data (ADR 0002).
 */
export interface Transfer {
  id: string
  realmId: string
  toRealmId: string
  toCityId: string
  warehouseId: string
  fromCityId: string | null
  good: Good
  units: number
  /** The fee paid for it so far; a pick-up's is taken when the caravan collects. */
  fee: number
  /** Whether it was cancelled and goes back to the sender's city `toCityId`. */
  back: boolean
  /** The caravan carrying it out, or null while it waits for one. */
  caravanId: string | null
}

/**
 * What a caravan does for a transfer it took on (`Transfer`), one step after another, each at a
 * building it drives to first. A pick-up takes the goods and then the fee at the sender's storage
 * (`collect`, `fee`); a transfer the warehouse keeps is loaded there, or at its coin warehouse
 * for coins (`load`). Either way it puts the goods into the recipient's storage (`deliver`), then
 * unloads what it still carries at the warehouse (`return`): goods it turned back with at the
 * warehouse, and coins at the coin warehouse. What robbers took once it collected is made good out
 * of the Trade Org's own stock (`CONTEXT.md`: Guaranteed carriage). Plain data (ADR 0002).
 */
export interface TransferJob {
  transferId: string
  warehouseId: string
  good: Good
  step: 'collect' | 'fee' | 'load' | 'deliver' | 'return'
  /** Units of the good on the carriage for the transfer (coins, for a transfer of coins). */
  units: number
  /** Coins of the fee on the carriage, the Trade Org's, besides the units. */
  coins: number
  /** The units to take at the sender's storage, worked out when the caravan gets there. */
  target: number | null
  /** The fee it takes at the sender's storage for what it collected. */
  fee: number
  /** Drives towards the step's building that ended short of it. */
  misses: number
  /** Units robbers took off the carriage on the way to the recipient's storage. */
  robbed: number
  /** The sender's city it collected at, to bring the goods back to if the transfer is cancelled. */
  fromCityId: string | null
}

/** A caravan as Players see it, while its carriage or any of its crew is in sight. */
export type SeenCaravan = Pick<
  Caravan,
  'id' | 'postId' | 'carriageId' | 'driverId' | 'escortIds' | 'heading'
>

/**
 * An NPC city asking a realm to join it (`CONTEXT.md`: Persuading a city). It stands until the
 * Player accepts or declines, or the city stops holding the realm in high standing. A declined
 * ask is kept for `PERSUADE_ASK_AGAIN_DAYS`, so the city doesn't ask that realm again before
 * then. Plain data (ADR 0002).
 */
export interface JoinRequest {
  cityId: string
  realmId: string
  /** The tick the city asked, or, once declined, the tick the Player declined. */
  at: number
  /** Whether the Player declined; the city then only remembers it. */
  declined: boolean
}

/**
 * A mercenary contract (`CONTEXT.md`: Mercenary contract): the lender rents some of its residents
 * to the hirer for `days` game days, at `pricePerWeek` coins a game week, paid into the lender's
 * storage `storageId`. One side offers it, the other accepts; until then it is only an offer.
 * The residents stay the lender's but take only the hirer's orders while it is in force. Each
 * game week is paid in advance; one that ends unpaid breaks the contract. A side is a Player's
 * realm or the Trade Organization (`TRADE_ORG`, `CONTEXT.md`: Trade Org army), whose storage is
 * a warehouse of its. Plain data (ADR 0002).
 */
export interface MercenaryContract {
  id: string
  /** The realm whose residents are rented out, or `TRADE_ORG`. */
  lenderId: string
  /** The realm that rents them, or `TRADE_ORG`. */
  hirerId: string
  /** Which side offered it; the other side accepts or declines. */
  offeredBy: 'lender' | 'hirer'
  /** The rented residents, all the lender's; never empty. */
  residentIds: string[]
  /** How long it runs once accepted, in game days. */
  days: number
  /** Coins for each game week, paid in advance. */
  pricePerWeek: number
  /** The lender's storage the coins go into. */
  storageId: string
  /** The tick it was accepted; null while it is only offered. */
  startedAt: number | null
  /** Game weeks paid so far, counted from the first. */
  paidWeeks: number
}

/**
 * Paying for a mercenary contract (`CONTEXT.md`: Mercenary contract): the resident, standing on
 * the contract's storage, puts in the coins for `weeks` game weeks from what they carry.
 */
export interface PayOrder {
  kind: 'pay'
  contractId: string
  weeks: number
}

/**
 * Buying an NPC city (`CONTEXT.md`: Buying a city): the resident, standing on the city's town
 * hall, completes the deal with the coins the realm's residents there carry. It happens this tick.
 */
export interface BuyCityOrder {
  kind: 'buyCity'
  cityId: string
}

/**
 * Trading at a Trade Org warehouse (`CONTEXT.md`: Trading with the Trade Organization): the
 * resident, standing on its tile, buys or sells up to `units` of `good` at its prices, from and
 * into their hands, or the load of `carriageId` on their tile. It happens this tick. With
 * `cityId`, a city of their realm, it orders a delivery instead (`CONTEXT.md`: Delivery): a buy
 * is paid now, fee and all, and a caravan brings the goods to that city's storage; a sell is
 * picked up from that storage by a caravan, which pays there.
 */
export interface TradeOrder {
  kind: 'trade'
  side: 'buy' | 'sell'
  good: Exclude<Good, 'coins'>
  units: number
  carriageId: string | null
  cityId?: string
}

/**
 * Handing in a transfer at a Trade Org warehouse (`CONTEXT.md`: Transfer): the resident, standing
 * on its tile, hands in up to `units` of `good` (coins too) from their hands, or the load of
 * `carriageId` on their tile, and pays the fee, for a caravan to bring to the storage of
 * `toCityId`, a city of another realm. It happens this tick.
 */
export interface HandInOrder {
  kind: 'handIn'
  good: Good
  units: number
  carriageId: string | null
  toCityId: string
}

/**
 * Buying off an admin directive (`CONTEXT.md`: Admin directive): the resident, standing on a
 * Trade Org warehouse's tile, pays the directive's price from their hands, or the load of
 * `carriageId` on their tile, into the Trade Organization's coins there. It happens this tick.
 */
export interface BuyOffOrder {
  kind: 'buyOff'
  directiveId: string
  carriageId: string | null
}
/**
 * How the Organization `of` regards `toward` (`CONTEXT.md`: Standing), from -`STANDING_RANGE`
 * to +`STANDING_RANGE`. An Organization is a realm's id, an NPC city's id, or `TRADE_ORG`
 * (`standingOrganization`). A pair with none is neutral (0). Plain data.
 */
export interface Standing {
  of: string
  toward: string
  value: number
}

/** What a crime was (`CONTEXT.md`: Crime). */
export type CrimeKind = 'theft' | 'attack' | 'killing' | 'tearDown'

/**
 * The Trade Org army out to punish an Organization for crimes against the Trade Organization
 * (`CONTEXT.md`: Trade Org reaction): its soldiers go to the culprit's city nearest the crime,
 * take back `worth` Coins' worth from its storages and carry it home. Plain data (ADR 0002).
 */
export interface Punishment {
  id: string
  /** The Organization punished: a realm or an NPC city. */
  culpritOrg: string
  /** The city it goes to. */
  cityId: string
  /** What it comes to take back, in Coins' worth: twice what it lost. */
  worth: number
  /**
   * Its soldiers, each with what they carried as they set out: anything they carry above that is
   * what they took.
   */
  members: { residentId: string; own: Stock }[]
  /** Out to the city while it hasn't got what it came for; home once it has or gives up. */
  heading: 'out' | 'home'
  /** The Coins' worth it took, as it stood when it headed home. */
  took: number
  startedAt: number
  /**
   * The admin directive it was sent for (`CONTEXT.md`: Admin directive) rather than crimes; it
   * heads home once that directive is lifted.
   */
  directiveId?: string
}
/**
 * A crime against another Organization (`CONTEXT.md`: Crime, Witness). An Organization is named by
 * its realm's id, or by its city's id for a city of no realm (`organizationOf`). Plain data.
 */
export interface Crime {
  id: string
  kind: CrimeKind
  /** The tick it happened, and where the culprit stood. */
  tick: number
  x: number
  y: number
  /** Who did it, and their Organization with its name at the time. */
  culprit: { residentId: string; name: string; org: string; orgName: string }
  /** The Organization it was against. */
  victimOrg: string
  /** The resident attacked or killed. */
  victim?: { residentId: string; name: string }
  /** What was stolen. */
  goods?: Stock
  /** What was torn down. */
  building?: BuildingKind
  /**
   * Residents who saw it, or the victim who survived it, and have not got home yet. Each makes it
   * known to their own Organization once they stand in the area of one of its cities.
   */
  witnesses: string[]
  /** The Organizations it is known to. */
  knownBy: string[]
  /** The Trade Organization has sent its army to punish it (`CONTEXT.md`: Trade Org reaction). */
  punished?: true
}

/**
 * A named group of a realm's residents moving and fighting together under one order
 * (`CONTEXT.md`: Army). A resident is in at most one army; one given an order of their own
 * leaves it. Plain data (ADR 0002).
 */
export interface Army {
  id: string
  /** Chosen by the Player who formed it. */
  name: string
  realmId: string
  /** Its residents; never empty. */
  memberIds: string[]
  /** What it was ordered to do; null when idle. */
  order: ArmyOrder | null
  /**
   * The script the army runs, when it was given the run-script order (`CONTEXT.md`: Running a
   * script). Its actions set `order` like UI army orders; any other army order ends it. Absent
   * when it runs none.
   */
  script?: RunningScript
}

/** An army as its Player sees it: which script it runs, but not its memory. */
export type SeenArmy = Omit<Army, 'script'> & { script?: Pick<RunningScript, 'scriptId'> }

/**
 * An army's order (`CONTEXT.md`: Army). It gives its members walk or attack orders tagged with
 * the army, and members walking for it keep together at the pace of the slowest. `started` is
 * set once the members got their orders.
 * - `walkTo`: all walk to a tile; done once none is still walking there.
 * - `attack`: all go after one resident and strike them; done once none is still at it.
 * - `guard`: all walk to a tile and stay; one who is idle away from it walks back. Until another
 *   order.
 * - `follow`: all keep in contact with a resident wherever they go, until that resident is gone
 *   or out of the army's sight.
 */
export type ArmyOrder =
  | { kind: 'walkTo'; target: { x: number; y: number }; started: boolean }
  | { kind: 'attack'; targetId: string; started: boolean }
  | { kind: 'guard'; at: { x: number; y: number }; started: boolean }
  | { kind: 'follow'; targetId: string; started: boolean }

/** What a resident died of: hunger, old age, or blows in a fight (`CONTEXT.md`: Combat). */
export type DeathCause = 'starved' | 'oldAge' | 'killed'

/** What happened, by kind; the rest of a `RealmEvent` says when and for whom. */
export type RealmEventWhat =
  /** A resident's hunger meter ran empty: they have nothing to eat and lose health. */
  | { kind: 'hungry'; residentId: string; name: string }
  /** A resident died; `leader` when it was the Leader, whose death ended the realm. */
  | {
      kind: 'died'
      residentId: string
      name: string
      cause: DeathCause
      leader: boolean
      /** Who killed them, by name, when they were `killed`. */
      by?: string
    }
  /**
   * A fight began (`CONTEXT.md`: Combat): the realm's resident `name` struck the first blow at
   * `other`, or, when not `attacker`, `other` struck it at them.
   */
  | {
      kind: 'fight'
      residentId: string
      name: string
      otherId: string
      other: string
      attacker: boolean
    }
  /**
   * A witness brought home news of a crime against the realm (`CONTEXT.md`: Crime, Witness):
   * `culprit` of `culpritOrg` did `crime` at tick `at`, to `victim`, taking `goods` or tearing
   * down `building`.
   */
  | {
      kind: 'crimeKnown'
      crimeId: string
      crime: CrimeKind
      at: number
      x: number
      y: number
      culpritId: string
      culprit: string
      culpritOrg: string
      victim?: string
      goods?: Stock
      building?: BuildingKind
    }
  /**
   * The Trade Organization punishes the realm (`CONTEXT.md`: Trade Org reaction): its army is
   * `coming` to `city` to take back `worth` Coins' worth, or `left` it having taken `took`.
   */
  | {
      kind: 'punished'
      what: 'coming' | 'left'
      cityId: string
      city: string
      worth: number
      took?: number
      /** Sent for an admin directive, with its reason, rather than for crimes. */
      directive?: string
    }
  /**
   * The resident `name` bought off the admin directive with `reason` for `coins` at the Trade Org
   * warehouse at (`x`, `y`) (`CONTEXT.md`: Admin directive): it no longer holds.
   */
  | {
      kind: 'boughtOff'
      residentId: string
      name: string
      reason: string
      coins: number
      x: number
      y: number
    }
  /**
   * An admin directive naming this realm, given for `reason`, ended because all its goals were
   * met (`CONTEXT.md`: Admin directive).
   */
  | { kind: 'directiveEnded'; reason: string }
  /** A resident who carries no weapon was hit and flees home (`CONTEXT.md`: Combat). */
  | { kind: 'fled'; residentId: string; name: string }
  /**
   * A city changed realm by capture (`CONTEXT.md`: Capturing a city): this realm took `city`,
   * with its `residents`, from the realm of `other` (by its realm name; null for an NPC
   * city), or, when not `captor`, the realm of `other` took it from this one.
   */
  | {
      kind: 'cityCaptured'
      cityId: string
      city: string
      other: string | null
      captor: boolean
      residents: number
    }
  /**
   * The realm bought the NPC city `city` (`CONTEXT.md`: Buying a city) for `price` coins, now
   * gone, with its `residents`; its town hall is at (`x`, `y`).
   */
  | {
      kind: 'cityBought'
      cityId: string
      city: string
      price: number
      residents: number
      x: number
      y: number
    }
  /**
   * A buy order for `city` fell through when it was carried out: the realm's residents at its
   * town hall carried `coins`, short of its `price`.
   */
  | { kind: 'cityNotBought'; cityId: string; city: string; price: number; coins: number }
  /**
   * The NPC city `city`, its town hall at (`x`, `y`), holds the realm in high standing and sees
   * enough respect from it: it asks to join the realm (`CONTEXT.md`: Persuading a city). The
   * Player accepts or declines.
   */
  | { kind: 'joinAsked'; cityId: string; city: string; x: number; y: number }
  /**
   * The Player accepted `city`'s ask: it joined the realm with its `residents` (`CONTEXT.md`:
   * Persuading a city, Integrating).
   */
  | {
      kind: 'cityPersuaded'
      cityId: string
      city: string
      residents: number
      x: number
      y: number
    }
  /** `city` no longer asks to join: it stopped holding the realm in high standing, or is gone. */
  | { kind: 'joinWithdrawn'; cityId: string; city: string }
  /**
   * The resident `name` traded at the Trade Org warehouse at (`x`, `y`) (`CONTEXT.md`: Trading
   * with the Trade Organization): bought or sold `units` of `good` for `coins`, of the `wanted`
   * units; fewer when it was cut down, none when nothing could be traded.
   */
  | {
      kind: 'traded'
      residentId: string
      name: string
      side: 'buy' | 'sell'
      good: Exclude<Good, 'coins'>
      units: number
      wanted: number
      coins: number
      x: number
      y: number
    }
  /**
   * The resident `name` ordered a delivery at the Trade Org warehouse at (`x`, `y`)
   * (`CONTEXT.md`: Delivery): buying, `units` of `good` (of the `wanted`) paid with `coins` and
   * a `fee`, to be brought to the storage of `city`; selling, up to `units` of it to be picked up
   * from that storage and paid for there. None when nothing could be ordered.
   */
  | {
      kind: 'deliveryOrdered'
      residentId: string
      name: string
      side: 'buy' | 'sell'
      good: Exclude<Good, 'coins'>
      units: number
      wanted: number
      coins: number
      fee: number
      cityId: string
      city: string
      x: number
      y: number
    }
  /**
   * A caravan carried out a delivery at the storage of `city` at (`x`, `y`) (`CONTEXT.md`:
   * Delivery): a `delivery` put `units` of `good` into it; a `pickUp` took `units` of `good` from
   * it and paid `coins` there, the `fee` already taken off.
   */
  | {
      kind: 'delivered'
      delivery: Delivery['kind']
      good: Exclude<Good, 'coins'>
      units: number
      coins: number
      fee: number
      cityId: string
      city: string
      x: number
      y: number
    }
  /**
   * A caravan couldn't get to the storage of `city` for a delivery of `good` (`CONTEXT.md`:
   * Delivery): it turned back, and the next caravan tries again. `cancelled` when the city is no
   * longer the realm's: then the delivery is dropped.
   */
  | {
      kind: 'deliveryStuck'
      delivery: Delivery['kind']
      good: Exclude<Good, 'coins'>
      units: number
      cityId: string
      city: string
      cancelled: boolean
    }
  /**
   * Robbers took `units` of `good` of a delivery to `city` off a caravan (`CONTEXT.md`:
   * Guaranteed carriage): the Trade Organization sends them again with the next caravan.
   */
  | {
      kind: 'deliveryRobbed'
      good: Exclude<Good, 'coins'>
      units: number
      cityId: string
      city: string
    }
  /**
   * The realm ordered a transfer of `units` of `good` to `city` of the realm `toRealmId`,
   * called `toRealm` (`CONTEXT.md`: Transfer): picked up at its city `fromCity`, or handed in by resident `name` at
   * the warehouse at (`x`, `y`), paying `fee` there. `wanted` is what was asked.
   */
  | {
      kind: 'transferOrdered'
      good: Good
      units: number
      wanted: number
      fee: number
      fromCity: string | null
      name: string | null
      toRealmId: string
      toRealm: string
      cityId: string
      city: string
      x: number
      y: number
    }
  /**
   * A caravan put `units` of `good` of a transfer from `fromRealmId` to `toRealmId` into the
   * storage of `city` at (`x`, `y`) (`CONTEXT.md`: Transfer), in both realms' logs, the realms
   * called `fromRealm` and `toRealm`; `fee` is what the sender paid. `back` when it was cancelled and brought back to the sender.
   */
  | {
      kind: 'transferred'
      good: Good
      units: number
      fee: number
      fromRealmId: string
      fromRealm: string
      toRealmId: string
      toRealm: string
      back: boolean
      cityId: string
      city: string
      x: number
      y: number
    }
  /**
   * A transfer of `units` of `good` to `city` didn't get on (`CONTEXT.md`: Transfer), in the
   * sender's log: `turnedBack` when a caravan couldn't get to a storage and the next one tries
   * again; `cancelled` when the recipient's city or realm is gone and it goes back to the sender,
   * or, when it can't, stays with the Trade Organization (`kept`); `nothing` when the sender's
   * storage had none of it, or not the fee; `robbed` when robbers took `units` of it, which the
   * Trade Organization sends again.
   */
  | {
      kind: 'transferStuck'
      why: 'turnedBack' | 'cancelled' | 'kept' | 'nothing' | 'robbed'
      good: Good
      units: number
      cityId: string
      city: string
    }
  /**
   * The realm's Leader died and the realm ended (`CONTEXT.md`: Leader death): each of its
   * `cities` became a self-managed city, with the residents living there, its town hall at
   * (`x`, `y`) so the Player can find it again.
   */
  | {
      kind: 'selfManaged'
      cities: { cityId: string; name: string; x: number; y: number; residents: number }[]
    }
  /**
   * The Player's Leader `name` founded the realm's starting city `city`, its town hall at
   * (`x`, `y`): on their first login, or as a fresh start after their Leader died.
   */
  | {
      kind: 'founded'
      residentId: string
      name: string
      cityId: string
      city: string
      x: number
      y: number
    }
  /**
   * The Player's Leader `from` handed the realm over to `to` (`CONTEXT.md`: Leader handover) in
   * the city `city`, standing at (`x`, `y`); `from` stays on as an ordinary resident.
   */
  | {
      kind: 'leaderHandedOver'
      fromId: string
      from: string
      toId: string
      to: string
      cityId: string
      city: string
      x: number
      y: number
    }
  /** Food went bad over the game day in the realm's storages, residents' loads and carriages. */
  | { kind: 'foodSpoiled'; units: number }
  /** A pair had a child (`CONTEXT.md`: Pairing, Child); `parents` are their names. */
  | { kind: 'born'; residentId: string; name: string; parents: [string, string] }
  /** A child reached `ADULT_AGE` and can now work (`CONTEXT.md`: Child, Aging). */
  | { kind: 'grownUp'; residentId: string; name: string }
  /** One of the realm's horses starved to death (`CONTEXT.md`: Horse). */
  | { kind: 'horseDied'; horseId: string }
  /**
   * The one-time Horse grant (`CONTEXT.md`: Horse grant) gave the realm `horseIds`: in its stable
   * at (`x`, `y`), or, with no stable, on the ground next to the storage of `city` or next to the
   * Leader, with Food by them.
   */
  | {
      kind: 'horsesGranted'
      horseIds: string[]
      where: 'stable' | 'storage' | 'leader'
      city?: string
      x: number
      y: number
    }
  /**
   * The Player claimed their Horse offer (`CONTEXT.md`: Horse offer): `horseIds` arrived where the
   * Horse grant puts them (see `horsesGranted`).
   */
  | {
      kind: 'horsesClaimed'
      horseIds: string[]
      where: 'stable' | 'storage' | 'leader'
      city?: string
      x: number
      y: number
    }
  /** Two of the realm's horses had a foal at a stable (`CONTEXT.md`: Stable). */
  | { kind: 'foaled'; horseId: string; stableId: string }
  /** An alliance leader invited the realm to join their alliance (`CONTEXT.md`: Alliance leader). */
  | { kind: 'allianceInvited'; allianceId: string; name: string }
  /**
   * A realm (`realm`, by its realm name) joined the alliance: this one, or another. `city`
   * when it is an NPC city (`CONTEXT.md`: NPC city in an alliance), `realm` then its name.
   */
  | {
      kind: 'allianceJoined'
      allianceId: string
      name: string
      realmId: string
      realm: string
      city?: true
    }
  /**
   * A member stopped being one of the alliance: this realm, or another (`city` for an NPC city,
   * as for `allianceJoined`). `removed` when the alliance leader removed it; `leaderDied` when
   * its Leader died and it left at once.
   */
  | {
      kind: 'allianceLeft'
      allianceId: string
      name: string
      realmId: string
      realm: string
      why: 'left' | 'removed' | 'leaderDied'
      city?: true
    }
  /**
   * An NPC city (`realmId`, `realm` its name) the alliance leader invited declined
   * (`CONTEXT.md`: NPC city in an alliance).
   */
  | { kind: 'allianceDeclined'; allianceId: string; name: string; realmId: string; realm: string }
  /** The role of alliance leader passed to a member (`CONTEXT.md`: Alliance leader). */
  | { kind: 'allianceLeader'; allianceId: string; name: string; realmId: string; realm: string }
  /**
   * A resident's or army's script stopped with an error this tick (`CONTEXT.md`: Running a
   * script); it runs again next tick. `line` and `column` say where, when the error is in the
   * script itself. Script events name the resident by `residentId` or the army by `armyId`.
   */
  | ({
      kind: 'scriptError'
      name: string
      scriptId: number
      message: string
      line?: number
      column?: number
    } & ScriptRunBy)
  /**
   * A resident's or army's script ran out of steps (`CONTEXT.md`: Step budget): its own budget,
   * or, when `realm`, the realm's, so it was cut short or skipped the tick.
   */
  | ({ kind: 'scriptOutOfSteps'; name: string; scriptId: number; realm: boolean } & ScriptRunBy)
  /** A run-script order ended because its script was deleted from the library. */
  | ({ kind: 'scriptEnded'; name: string; scriptId: number } & ScriptRunBy)
  /**
   * A resident's script ended itself with `end(reason)` (`CONTEXT.md`: Script): `script` is its
   * name, `reason` the short text it gave. Not an error: one for each end, never rate-limited.
   */
  | ({
      kind: 'scriptStopped'
      name: string
      scriptId: number
      script: string
      reason: string
    } & ScriptRunBy)
  /**
   * A field the Player's active scripts read was renamed or removed from its script view
   * (`CONTEXT.md`: Script view), as `view.field`; it reads `null` from now on. `scripts` are
   * those that read it, by name.
   */
  | { kind: 'scriptFieldDropped'; field: string; scripts: { scriptId: number; name: string }[] }
  /**
   * Step `step` (counted from 1) of the resident `name`'s queue (`CONTEXT.md`: Queue), an order
   * of kind `order`, was skipped: it couldn't start or ended in a failure, for `reason`.
   * `queueEnded` when none of the queue's steps could start, so the queue ended.
   */
  | {
      kind: 'queueStepSkipped'
      residentId: string
      name: string
      step: number
      order: string
      reason: string
      queueEnded?: true
    }
  /**
   * A mercenary contract (`CONTEXT.md`: Mercenary contract) with the realm `other` (by its
   * realm name) changed: `offered` to this realm, `started` once accepted, `paid` for `weeks`
   * more game weeks, `ended` when its time was up, or `broken` when a week went unpaid; or
   * `declined` by the Trade Organization (`CONTEXT.md`: Trade Org army). `lender` when this realm
   * rents out the residents. `leaderDied` says which side's Leader died when that ended it early
   * (`CONTEXT.md`: Self-managed city).
   */
  | {
      kind: 'contract'
      contractId: string
      what: 'offered' | 'started' | 'paid' | 'ended' | 'broken' | 'declined'
      lender: boolean
      other: string
      residents: number
      weeks?: number
      leaderDied?: 'lender' | 'hirer'
    }

/**
 * Something that happened in a Player's realm, for their log. Plain data. It belongs to the
 * Player, not the realm: a realm ends with its Leader, and the Player should still read why.
 */
export type RealmEvent = RealmEventWhat & {
  /** Numbered from the world's `nextId`, so a later event has a higher number. */
  seq: number
  tick: number
  /** The Player's account. */
  userId: number
}

/** Goods lying on the ground on one tile, for anyone to take (`CONTEXT.md`: Pile). */
export interface Pile {
  id: string
  x: number
  y: number
  goods: Stock
}

/**
 * PoC goods (`CONTEXT.md`: Good, Weapons and armour). Amounts are counted in units;
 * `GOOD_WEIGHT` weighs them.
 */
export const GOODS = [
  'food',
  'wood',
  'stone',
  'ironOre',
  'iron',
  'goldOre',
  'coins',
  'spear',
  'sword',
  'shield',
  'armour',
] as const
export type Good = (typeof GOODS)[number]

/** Goods that make a resident armed (`CONTEXT.md`: Soldier, Weapons and armour). */
export const WEAPONS = ['spear', 'sword'] as const satisfies readonly Good[]
export type Weapon = (typeof WEAPONS)[number]

/** Goods that take off damage (`CONTEXT.md`: Weapons and armour): shields and armour. */
export const PROTECTION = ['shield', 'armour'] as const satisfies readonly Good[]
export type Protection = (typeof PROTECTION)[number]

/** Goods by kind, as unit counts; a missing good is 0. */
export type Stock = Partial<Record<Good, number>>

/** Everything one Player controls through their Leader (`CONTEXT.md`: Realm). */
export interface Realm {
  id: string
  /** The Player's account. */
  userId: number
  /** The resident who is the Player's Leader. */
  leaderId: string
  /**
   * What others know the realm by (`CONTEXT.md`: Realm name); never changes once given. Realms
   * from before realm names have none and go by their Leader's name until named.
   */
  name?: string
}

/**
 * A group of Organizations that agreed to join (`CONTEXT.md`: Alliance): Players' realms and NPC
 * cities (`CONTEXT.md`: NPC city in an alliance), never the Trade Organization. Each is in at
 * most one. It ends when its last realm is gone.
 */
export interface Alliance {
  id: string
  /** Chosen by the realm that founded it. */
  name: string
  /**
   * The member realm that is the alliance leader (`CONTEXT.md`: Alliance leader); always a realm,
   * since an NPC city gives no orders.
   */
  leaderId: string
  /** Members in the order they joined, so the first is the longest-standing. Never empty. */
  members: AllianceMember[]
  /**
   * Realms the alliance leader invited that have not accepted or declined yet. An NPC city
   * answers at once, so it is never kept here.
   */
  invites: string[]
  /**
   * The alliance army (`CONTEXT.md`: Alliance army): soldiers and carriages members handed over
   * to the alliance leader's command, in the order they were handed over.
   */
  army: AllianceArmyPart[]
}

/**
 * A soldier or carriage handed over to an alliance's army. It stays in its own realm (the
 * resident's `owner`, the carriage's `realmId`) but takes orders only from the alliance leader.
 */
export interface AllianceArmyPart {
  is: 'resident' | 'carriage'
  id: string
  /** The tick its owner's recall takes effect; null while it stays. */
  recallAt: number | null
}

/** An Organization's membership in an alliance. */
export interface AllianceMember {
  /** The member: a realm's id, or an NPC city's (`CONTEXT.md`: NPC city in an alliance). */
  realmId: string
  /** The tick it joined, or founded the alliance. */
  joinedAt: number
  /**
   * Set once it leaves, or the alliance leader removes it (`removed`): the tick that takes
   * effect. Until then it is a member like any other. Null while it stays.
   */
  leaving: { at: number; removed: boolean } | null
}

/**
 * A settlement (`CONTEXT.md`: City). It has exactly one town hall, and its shape follows from its
 * buildings (`cityMembership`, `inCityArea`); it is never stored. The number in its id says how
 * old it is: a lower one was founded earlier.
 */
export interface City {
  id: string
  name: string
  /** The realm it belongs to; null for an NPC city (`CONTEXT.md`: NPC city). */
  realmId: string | null
  /** The town hall that makes it a city (`CONTEXT.md`: Town hall). */
  townHallId: string
  /**
   * Set when the city is the Trade Organization's, saying which of its cities it is
   * (`CONTEXT.md`: Trade Organization, Trade Org HQ, Trading post). It belongs to no realm and
   * the game runs it like an NPC city.
   */
  tradeOrg?: 'hq' | 'post'
  /**
   * Workplaces the game has a city it runs work besides its farms, by id: the Trade Org HQ's own
   * workplaces on the nearest nodes, a trading post's one. A workplace still belongs to no city;
   * one that is gone is skipped.
   */
  workplaceIds?: string[]
  /**
   * For a self-managed city, the Player whose Leader died while it was theirs and the tick it
   * happened (`CONTEXT.md`: Self-managed city). It holds them in good standing, fading from then
   * on (`formerPlayerStanding`), which goes to their next realm when it is founded.
   */
  formerPlayer?: { userId: number; tick: number }
}

export type BuildingKind =
  | 'townHall'
  | 'house'
  | 'storage'
  | 'warehouse'
  | 'wall'
  | 'gate'
  | 'farm'
  | 'stable'
  | 'mine'
  | 'quarry'
  | 'lumberCamp'
  | 'smelter'
  | 'mint'
  | 'smithy'
  | 'road'
  /**
   * A carriage site (`CONTEXT.md`: Carriage): only ever a construction site, laid out at a
   * stable; finished, it becomes a `Carriage` and is gone from the buildings.
   */
  | 'carriage'

/**
 * A building takes one tile (`CONTEXT.md`: Tile). While it has a `site` it is a construction
 * site, not yet the building. A road is built like a building but may share its tile with one
 * (`CONTEXT.md`: Road), and so may a carriage site (`CONTEXT.md`: Carriage): a tile holds at most
 * one road, one carriage site and one other building.
 */
export interface Building {
  id: string
  kind: BuildingKind
  /**
   * The city it belongs to; null for a building of no city, such as a workplace on a node. A
   * finished city building's follows from where it stands (`cityMembership`); a farm or stable
   * keeps the city it was laid out for, until that city is gone.
   */
  cityId: string | null
  /**
   * The realm an outpost storage belongs to (`CONTEXT.md`: Outpost storage): finished storages
   * of no city only, and only those a realm has. A city that takes it in drops it. A
   * construction site has the realm whose resident laid it out, until it is finished
   * (`CONTEXT.md`: Construction site); one an NPC city's resident laid out has none.
   */
  realmId?: string
  x: number
  y: number
  /** Goods kept here; storages, warehouses and stables only. */
  stock?: Stock
  /** There while the building is still a construction site. */
  site?: ConstructionSite
  /** Work put into tearing it down so far, once someone has started (`teardownWork`, `siteWorkOf`). */
  teardown?: number
  /** A gate its city's realm has closed (`CONTEXT.md`: Walls in combat); gates only, open without it. */
  closed?: true
  /**
   * Damage taken from blows so far (`CONTEXT.md`: Walls in combat), once someone has struck it;
   * finished walls and gates only. It falls at its `wallStrength`.
   */
  damage?: number
  /**
   * How far each pair of horses in it has been bred (`CONTEXT.md`: Breeding), once a resident has
   * tended them; finished stables only. Kept while nobody tends them, lost when one of the two
   * leaves the stable or dies, gone when their foal is born.
   */
  breedings?: KeptBreeding[]
}

/** The breeding progress a stable keeps for two horses in it (`Building.breedings`). */
export interface KeptBreeding {
  horseIds: [string, string]
  /** Ticks the pair has been tended so far, from 1 to below `STABLE_BREED_TICKS`. */
  progress: number
}

/**
 * How far a construction site has come (`CONTEXT.md`: Construction site): the materials carried
 * to it so far and the work residents have put in. Like a workplace, it has no owner.
 */
export interface ConstructionSite {
  /** Materials delivered so far; never more of a good than the building needs. */
  delivered: Stock
  /**
   * Work put in so far, at most what the building needs (`BUILD_WORK`); on a road on Mountain a
   * resident's work counts less (`siteWorkOf`).
   */
  work: number
}

/**
 * An animal that pulls a carriage (`CONTEXT.md`: Horse). It has no inventory: it eats only what
 * is in reach (`horseFood`).
 */
export interface Horse {
  id: string
  /** The realm it belongs to; null for one of an NPC city (`cityId`) or of nobody. */
  realmId: string | null
  /**
   * The NPC city it belongs to when it belongs to no realm (`CONTEXT.md`: Self-managed city);
   * null for one of a realm or of nobody.
   */
  cityId: string | null
  x: number
  y: number
  /** The hunger meter, as for residents: `MAX_HUNGER` is fully fed, 0 is empty. */
  hunger: number
  /** 0 is dead; the most is `MAX_HEALTH`, as for residents. */
  health: number
  /** Speed, Strength and Endurance (`CONTEXT.md`: Horse stats). */
  stats: HorseStats
  /** The tick it was born; its age is counted from it (`horseAgeInYears`). */
  bornAt: number
}

/** A horse-drawn cart (`CONTEXT.md`: Carriage). */
export interface Carriage {
  id: string
  /** The realm it belongs to; null for one of an NPC city (`cityId`) or of nobody. */
  realmId: string | null
  /**
   * The NPC city it belongs to when it belongs to no realm (`CONTEXT.md`: Self-managed city);
   * null for one of a realm or of nobody.
   */
  cityId: string | null
  x: number
  y: number
  /**
   * The horse hitched to it, which pulls it, moves with it and eats from its load; null when
   * none is. A horse of the carriage's realm on its tile is hitched when it is first driven.
   */
  horseId: string | null
  /** Goods on board, up to `CARRIAGE_CAPACITY` by weight. */
  load: Stock
}

/** What a resource node yields once worked (`CONTEXT.md`: Resource node). */
export type ResourceKind = 'forest' | 'stone' | 'ironOre' | 'goldOre'

/** A spot on the map that never runs out. Nodes never move; one per tile. */
export interface ResourceNode {
  id: string
  kind: ResourceKind
  x: number
  y: number
}

/** The workplace built on each kind of node (`CONTEXT.md`: Workplace, Where buildings go). */
export const NODE_WORKPLACE: Record<ResourceKind, BuildingKind> = {
  forest: 'lumberCamp',
  stone: 'quarry',
  ironOre: 'mine',
  goldOre: 'mine',
}

/** The terrain each kind of node lies on (`CONTEXT.md`: Resource node). */
export const NODE_TERRAINS: Record<ResourceKind, readonly Terrain[]> = {
  forest: [Terrain.Forest],
  stone: [Terrain.Hills],
  ironOre: [Terrain.Hills, Terrain.Mountain],
  goldOre: [Terrain.Hills, Terrain.Mountain],
}

/** Who ran a script, in a script event: a resident or an army. */
export type ScriptRunBy =
  { residentId: string; armyId?: never } | { armyId: string; residentId?: never }
