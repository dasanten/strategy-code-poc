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
}

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
