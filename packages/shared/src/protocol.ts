import type { Account } from './api.js'
import type { Resident } from './world.js'

/** The map the client draws; its terrain comes in explored chunks (`terrainChunkPath`). */
export interface MapInfo {
  seed: number
  /** The whole disc's diameter in tiles. */
  diameter: number
}

/**
 * An order from the UI (ADR 0002). `kind` picks the order; the rest is its plain-data input.
 * The server answers every order with `ack` or `rejected` and applies it from the next tick.
 */
export interface OrderRequest {
  kind: string
  [key: string]: unknown
}

/** Messages the server pushes over the WebSocket (ADR 0006). */
export type ServerMessage =
  /** On connect: who you are, the map and everything in your sight. */
  | {
      type: 'welcome'
      account: Account
      tick: number
      map: MapInfo
      /** Chunks with explored terrain, to load from `terrainChunkPath` (see `chunksAcross`). */
      exploredChunks: number[]
      entities: Resident[]
    }
  /** Every tick: entities in sight that changed, and ids that left sight. */
  | { type: 'tick'; tick: number; changed: Resident[]; gone: string[] }
  | { type: 'ack'; requestId: string }
  | { type: 'rejected'; requestId: string; reason: string }

/** Messages the client sends over the WebSocket. */
export type ClientMessage = { type: 'order'; requestId: string; order: OrderRequest }

export const WS_PATH = '/ws'
export const SESSION_COOKIE = 'csp_session'
