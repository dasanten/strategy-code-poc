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
export type SkillName = 'mining' | 'woodcutting' | 'construction' | 'farming' | 'combat' | 'driving'

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
}

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
 * a storage standing there, or the materials delivered to a construction site there.
 */
export type GoodsSpot =
  { kind: 'ground' } | { kind: 'storage'; storageId: string } | { kind: 'site'; siteId: string }

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
 * Building (`CONTEXT.md`: Building): the resident lays out a construction site of `building` on
 * the tile they stand on (`at`), or joins the unfinished one of that kind already there, then
 * works on it until it is finished. `siteId` is null until they are on the site.
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

/** Any order a resident can hold. */
export type ResidentOrder =
  WalkOrder | PickUpOrder | DropOrder | BuildOrder | TearDownOrder | WorkOrder | PairOrder

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
}

/** What happened, by kind; the rest of a `RealmEvent` says when and for whom. */
export type RealmEventWhat =
  /** A resident's hunger meter ran empty: they have nothing to eat and lose health. */
  | { kind: 'hungry'; residentId: string; name: string }
  /** A resident died; `leader` when it was the Leader, whose death ended the realm. */
  | {
      kind: 'died'
      residentId: string
      name: string
      cause: 'starved' | 'oldAge'
      leader: boolean
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

/** PoC goods (`CONTEXT.md`: Good). Amounts are counted in units; `GOOD_WEIGHT` weighs them. */
export const GOODS = ['food', 'wood', 'stone', 'ironOre', 'iron', 'goldOre', 'coins'] as const
export type Good = (typeof GOODS)[number]

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
 * A walled square of tiles (`CONTEXT.md`: City). Its wall is the ring of tiles along the
 * square's edge, with one gate tile in it.
 */
export interface City {
  id: string
  name: string
  /** The realm it belongs to; null when it belongs to nobody (after Leader death). */
  realmId: string | null
  /** Top-left tile of the square, wall included. */
  x: number
  y: number
  /** Tiles along each side, wall included. */
  size: number
  wall: 'wooden'
  gate: { x: number; y: number }
}

export type BuildingKind =
  'house' | 'storage' | 'farm' | 'stable' | 'mine' | 'quarry' | 'lumberCamp'

/**
 * A building takes one tile (`CONTEXT.md`: Tile). While it has a `site` it is a construction
 * site, not yet the building.
 */
export interface Building {
  id: string
  kind: BuildingKind
  /** The city it belongs to; null for a building of no city, such as a workplace on a node. */
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
  /** Goods on board. */
  load: Stock
}

/** Whether a tile is part of the city's wall ring. */
export function isWallTile(city: City, x: number, y: number): boolean {
  const inside = x >= city.x && y >= city.y && x < city.x + city.size && y < city.y + city.size
  const edge =
    x === city.x || y === city.y || x === city.x + city.size - 1 || y === city.y + city.size - 1
  return inside && edge
}

/** Whether a tile lies inside the city's walls (`CONTEXT.md`: At home). */
export function isInsideWalls(city: City, x: number, y: number): boolean {
  return x > city.x && y > city.y && x < city.x + city.size - 1 && y < city.y + city.size - 1
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
