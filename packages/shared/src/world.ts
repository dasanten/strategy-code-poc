import { Terrain } from './terrain.js'

export const TICK_MS = 1000

/** One game day is one real hour (`CONTEXT.md`: Game time). */
export const TICKS_PER_GAME_DAY = 3600
/** One game year is one real day. */
export const TICKS_PER_GAME_YEAR = 24 * TICKS_PER_GAME_DAY

/** A resident's stats (`CONTEXT.md`: Stats). */
export const STAT_NAMES = ['strength', 'endurance', 'agility', 'intellect'] as const
export type StatName = (typeof STAT_NAMES)[number]

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
  /** The realm the resident belongs to; null when it belongs to nobody (after Leader death). */
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
  /**
   * The script the resident runs, when they were given the run-script order (`CONTEXT.md`:
   * Running a script). Its actions set `order` like UI orders; any other order ends it. Absent
   * when they run none.
   */
  script?: RunningScript
}

/** A script value as plain data, the only kind a script's memory keeps between ticks. */
export type MemoryValue = number | string | boolean | null | MemoryValue[] | ScriptMemory

/** A running script's memory (`CONTEXT.md`: Memory): plain, serialisable data (ADR 0002). */
export interface ScriptMemory {
  [key: string]: MemoryValue
}

/** A resident's run-script order: which script of the Player's library, and its memory. */
export interface RunningScript {
  /** The script in the Player's library; its active version is what runs each tick. */
  scriptId: number
  /** What the script kept between ticks, at most `SCRIPT_MEMORY_MAX` characters of JSON. */
  memory: ScriptMemory
  /** The tick its last error went into the realm log; errors are logged rate-limited. */
  errorLoggedAt?: number
  /** The tick its last out-of-steps warning went into the realm log. */
  budgetLoggedAt?: number
}

/**
 * A resident as Players see them (`CONTEXT.md`: Sight): which script they run, but not its
 * memory, which stays on the server.
 */
export type SeenResident = Omit<Resident, 'script'> & { script?: Pick<RunningScript, 'scriptId'> }

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
 * Pairing (`CONTEXT.md`: Pairing): the resident and their partner, two adults of the same city,
 * are set to have children. Both hold a pair order naming the other, with the same `since`: the
 * tick they paired or last had a child. A child can come once a game year has passed since then,
 * while their city has free housing and a food surplus. Any other order for either ends it.
 */
export interface PairOrder {
  kind: 'pair'
  partnerId: string
  since: number
}

/**
 * Driving a carriage to a tile (`CONTEXT.md`: Carriage): the resident drives the carriage
 * `carriageId` from their tile, and the carriage, its horse and the driver move together. The
 * path and `progress` work as for walking, at the carriage's speeds and never into mountains.
 */
export interface DriveOrder {
  kind: 'drive'
  carriageId: string
  target: { x: number; y: number }
  /** The tiles still to drive, in order; null while the path is being found. */
  path: [number, number][] | null
  progress: number
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
 * out of their sight or they are given another order. Out of contact they walk towards the target
 * along `path` (null while it is being found), as for a walk order; `progress` is how far into the
 * next step they are. `strike` is how far, from 0 up to 1, they are into their next blow.
 * `started` is set once the fight went in the realm logs.
 */
export interface AttackOrder {
  kind: 'attack'
  targetId: string
  path: [number, number][] | null
  progress: number
  strike: number
  started: boolean
}

/**
 * Building a road along a line (`CONTEXT.md`: Road): the resident builds the road tiles of
 * `tiles` one after another. For each they walk to it (`path` and `progress` as for a walk
 * order), then lay out a road there or join the site already there, put in the materials they
 * carry that it needs, and work on it as for a build order (`siteId`) until it is finished. A
 * tile that already has a road, or can't take one, is skipped. The order ends after the last.
 */
export interface RoadLineOrder {
  kind: 'roadLine'
  /** The tiles still to build, in order; the first is being walked to or built. Never empty. */
  tiles: [number, number][]
  phase: 'walking' | 'building'
  /** While walking, the tiles still to walk; null while the path is being found. */
  path: [number, number][] | null
  progress: number
  /** While building, the road site on the first tile; null until it is laid out or joined. */
  siteId: string | null
}

/** Any order a resident can hold. */
export type ResidentOrder =
  | WalkOrder
  | DriveOrder
  | HaulOrder
  | PickUpOrder
  | DropOrder
  | BuildOrder
  | TearDownOrder
  | WorkOrder
  | PairOrder
  | AttackOrder
  | RoadLineOrder

/** A stat's effective value: base and trained bonus together. */
export function effective(stat: Stat): number {
  return stat.base + stat.trained
}

/** A resident's age in game years at the given tick. */
export function ageInYears(resident: Resident, tick: number): number {
  return (tick - resident.bornAt) / TICKS_PER_GAME_YEAR
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
}

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
  /** A resident who carries no weapon was hit and flees home (`CONTEXT.md`: Combat). */
  | { kind: 'fled'; residentId: string; name: string }
  /**
   * A city changed realm by capture (`CONTEXT.md`: Capturing a city): this realm took `city`,
   * with its `residents`, from the realm of `other` (by its Leader's name; null for an NPC
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
  /** Food went bad over the game day in the realm's storages, residents' loads and carriages. */
  | { kind: 'foodSpoiled'; units: number }
  /** A pair had a child (`CONTEXT.md`: Pairing, Child); `parents` are their names. */
  | { kind: 'born'; residentId: string; name: string; parents: [string, string] }
  /** A child reached `ADULT_AGE` and can now work (`CONTEXT.md`: Child, Aging). */
  | { kind: 'grownUp'; residentId: string; name: string }
  /** One of the realm's horses starved to death (`CONTEXT.md`: Horse). */
  | { kind: 'horseDied'; horseId: string }
  /** Two of the realm's horses had a foal at a stable (`CONTEXT.md`: Stable). */
  | { kind: 'foaled'; horseId: string; stableId: string }
  /** An alliance leader invited the realm to join their alliance (`CONTEXT.md`: Alliance leader). */
  | { kind: 'allianceInvited'; allianceId: string; name: string }
  /** A realm (`realm`, by its Leader's name) joined the alliance: this one, or another. */
  | { kind: 'allianceJoined'; allianceId: string; name: string; realmId: string; realm: string }
  /**
   * A realm stopped being a member of the alliance: this one, or another. `removed` when the
   * alliance leader removed it; `leaderDied` when its Leader died and it left at once.
   */
  | {
      kind: 'allianceLeft'
      allianceId: string
      name: string
      realmId: string
      realm: string
      why: 'left' | 'removed' | 'leaderDied'
    }
  /** The role of alliance leader passed to a member (`CONTEXT.md`: Alliance leader). */
  | { kind: 'allianceLeader'; allianceId: string; name: string; realmId: string; realm: string }
  /**
   * A resident's script stopped with an error this tick (`CONTEXT.md`: Running a script); it runs
   * again next tick. `line` and `column` say where, when the error is in the script itself.
   */
  | {
      kind: 'scriptError'
      residentId: string
      name: string
      scriptId: number
      message: string
      line?: number
      column?: number
    }
  /**
   * A resident's script ran out of steps (`CONTEXT.md`: Step budget): its own budget, or, when
   * `realm`, the realm's, so it was cut short or skipped the tick.
   */
  | { kind: 'scriptOutOfSteps'; residentId: string; name: string; scriptId: number; realm: boolean }
  /** A resident's run-script order ended because its script was deleted from the library. */
  | { kind: 'scriptEnded'; residentId: string; name: string; scriptId: number }

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
}

/**
 * A group of Organizations that agreed to join (`CONTEXT.md`: Alliance). For now its members are
 * Players' realms; a realm is in at most one. It ends when its last member is gone.
 */
export interface Alliance {
  id: string
  /** Chosen by the realm that founded it. */
  name: string
  /** The member realm that is the alliance leader (`CONTEXT.md`: Alliance leader). */
  leaderId: string
  /** Members in the order they joined, so the first is the longest-standing. Never empty. */
  members: AllianceMember[]
  /** Realms the alliance leader invited that have not accepted or declined yet. */
  invites: string[]
}

/** A realm's membership in an alliance. */
export interface AllianceMember {
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
  /** The realm it belongs to; null when it belongs to nobody (after Leader death). */
  realmId: string | null
  /** The town hall that makes it a city (`CONTEXT.md`: Town hall). */
  townHallId: string
}

export type BuildingKind =
  | 'townHall'
  | 'house'
  | 'storage'
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
 * A building takes one tile (`CONTEXT.md`: Tile). While it has a `site` it is a construction
 * site, not yet the building. A road is built like a building but may share its tile with one
 * (`CONTEXT.md`: Road): a tile holds at most one road and one other building.
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
  x: number
  y: number
  /** Goods kept here; storages and stables only. */
  stock?: Stock
  /**
   * A stable's progress toward its next foal, in ticks of breeding (`STABLE_BREED_DAYS`); there
   * once it has started.
   */
  breeding?: number
  /** There while the building is still a construction site. */
  site?: ConstructionSite
  /** Work put into tearing it down so far, once someone has started (`teardownWork`). */
  teardown?: number
}

/**
 * How far a construction site has come (`CONTEXT.md`: Construction site): the materials carried
 * to it so far and the work residents have put in. Like a workplace, it has no owner.
 */
export interface ConstructionSite {
  /** Materials delivered so far; never more of a good than the building needs. */
  delivered: Stock
  /** Work put in so far, at most what the building needs (`BUILD_WORK`). */
  work: number
}

/**
 * An animal that pulls a carriage (`CONTEXT.md`: Horse). It has no inventory: it eats only what
 * is in reach (`horseFood`).
 */
export interface Horse {
  id: string
  /** The realm it belongs to; null when it belongs to nobody (after Leader death). */
  realmId: string | null
  x: number
  y: number
  /** The hunger meter, as for residents: `MAX_HUNGER` is fully fed, 0 is empty. */
  hunger: number
  /** 0 is dead; the most is `MAX_HEALTH`, as for residents. */
  health: number
}

/** A horse-drawn cart (`CONTEXT.md`: Carriage). */
export interface Carriage {
  id: string
  /** The realm it belongs to; null when it belongs to nobody (after Leader death). */
  realmId: string | null
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
