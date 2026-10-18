export const TICK_MS = 1000

export type Direction = 'up' | 'down' | 'left' | 'right'

export interface Unit {
  id: string
  owner: string
  x: number
  y: number
  hp: number
}

/**
 * Everything in the world that changes, saved as snapshots (ADR 0006). Terrain is not part of
 * it: it is generated once from `seed` and stored on its own.
 */
export interface WorldState {
  tick: number
  /** The seed the map was generated from. */
  seed: number
  units: Unit[]
}
