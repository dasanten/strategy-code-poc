import type { Account } from './api.js'
import type { Building, Carriage, City, Horse, Resident } from './world.js'

/** The map the client draws; its terrain comes in explored chunks (`terrainChunkPath`). */
export interface MapInfo {
  seed: number
  /** Tiles along each side of the map; its opposite sides join. */
  size: number
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
      /** The Player's realm and the city the view starts on. */
      home: { realmId: string; leaderId: string; cityId: string; x: number; y: number }
      /**
       * Cities, buildings, horses and carriages, as they stand on connect. Until sight
       * (T2.3), these come once with the welcome and the tick updates carry residents only.
       */
      structures: {
        cities: City[]
        buildings: Building[]
        horses: Horse[]
        carriages: Carriage[]
      }
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
