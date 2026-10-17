import type { Unit, WorldState } from './world.js'

/** Messages the server pushes over the WebSocket. */
export type ServerMessage =
  { type: 'welcome'; world: WorldState } | { type: 'tick'; tick: number; units: Unit[] }

export const WS_PATH = '/ws'
