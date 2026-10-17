export const TICK_MS = 1000
export const MAP_WIDTH = 32
export const MAP_HEIGHT = 24

export type Tile = 'grass' | 'rock' | 'water' | 'resource'

export type Direction = 'up' | 'down' | 'left' | 'right'

export interface Unit {
  id: string
  owner: string
  x: number
  y: number
  hp: number
}

export interface WorldState {
  tick: number
  width: number
  height: number
  /** Row-major tile grid: tiles[y * width + x]. */
  tiles: Tile[]
  units: Unit[]
}
