import { Terrain } from './terrain.js'

export const TICK_MS = 1000

/** One game day is one real hour (`CONTEXT.md`: Game time). */
export const TICKS_PER_GAME_DAY = 3600
/** One game year is one real day. */
export const TICKS_PER_GAME_YEAR = 24 * TICKS_PER_GAME_DAY
/** Children are grown after about this many game years (`CONTEXT.md`: Aging). */
export const ADULT_AGE = 14

/** A resident's stats (`CONTEXT.md`: Stats). */
export const STAT_NAMES = ['strength', 'endurance', 'agility', 'intellect'] as const
export type StatName = (typeof STAT_NAMES)[number]

/** A stat: what the resident was born with, plus what training added (capped by the base). */
export interface Stat {
  base: number
  trained: number
}

/** Something learned by doing or training; starts at 0, never inherited (`CONTEXT.md`: Skill). */
export type SkillName = 'mining' | 'construction' | 'combat' | 'driving'

/** A person living in the world (`CONTEXT.md`: Resident). Plain data. */
export interface Resident {
  id: string
  name: string
  /** Who controls this resident. A placeholder side until Realms exist (T2.2). */
  owner: string
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

/** Any order a resident can hold. */
export type ResidentOrder = WalkOrder

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
}

/** Goods lying on the ground on one tile, for anyone to take (`CONTEXT.md`: Pile). */
export interface Pile {
  id: string
  x: number
  y: number
  goods: Stock
}

/** PoC goods (`CONTEXT.md`: Good). Amounts are counted in units; `GOOD_WEIGHT` weighs them. */
export type Good = 'food' | 'wood' | 'stone' | 'ironOre' | 'iron' | 'goldOre' | 'coins'

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
  realmId: string
  /** Top-left tile of the square, wall included. */
  x: number
  y: number
  /** Tiles along each side, wall included. */
  size: number
  wall: 'wooden'
  gate: { x: number; y: number }
}

export type BuildingKind = 'house' | 'storage' | 'farm'

/** A building takes one tile (`CONTEXT.md`: Tile). */
export interface Building {
  id: string
  kind: BuildingKind
  cityId: string
  x: number
  y: number
  /** Goods kept here; storages only. */
  stock?: Stock
}

/** An animal that pulls a carriage (`CONTEXT.md`: Horse). */
export interface Horse {
  id: string
  realmId: string
  x: number
  y: number
  /** The hunger meter, as for residents. */
  hunger: number
}

/** A horse-drawn cart (`CONTEXT.md`: Carriage). */
export interface Carriage {
  id: string
  realmId: string
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

/** The terrain each kind of node lies on (`CONTEXT.md`: Resource node). */
export const NODE_TERRAINS: Record<ResourceKind, readonly Terrain[]> = {
  forest: [Terrain.Forest],
  stone: [Terrain.Hills],
  ironOre: [Terrain.Hills, Terrain.Mountain],
  goldOre: [Terrain.Hills, Terrain.Mountain],
}
