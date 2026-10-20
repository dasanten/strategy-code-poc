import type { Account } from './api.js'
import type { Diplomacy } from './alliance.js'
import type { RegionMap } from './region-map.js'
import type { Army, Building, Carriage, City, Horse, Pile, RealmEvent, Resident } from './world.js'

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

/**
 * Something a Player sees (`CONTEXT.md`: Sight), tagged with what it is. Ids are unique across
 * all of them.
 */
export type SeenEntity =
  | ({ is: 'resident' } & Resident)
  | ({ is: 'building' } & Building)
  | ({ is: 'city' } & City)
  | ({ is: 'horse' } & Horse)
  | ({ is: 'carriage' } & Carriage)
  | ({ is: 'pile' } & Pile)
  /** One of the Player's own armies; its members are what is seen of it. */
  | ({ is: 'army' } & Army)

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
      home: { realmId: string; leaderId: string; cityId: string | null; x: number; y: number }
      /** Everything the Player's residents see. */
      entities: SeenEntity[]
      /** The Player's realm log as kept, oldest first. */
      events: RealmEvent[]
      /** The Player's alliance, invitations and the realms they could invite. */
      diplomacy: Diplomacy
      /** The Region map over their explored terrain; null until territory is first worked out. */
      region: RegionMap | null
    }
  /**
   * Every tick: entities in sight that changed, ids that left sight, chunks whose explored
   * terrain grew (load them again), the Player's new realm events and
   * their alliance matters when those changed, and the Region map when territory was worked out
   * again (all of it) or their explored terrain grew (the grown chunks).
   */
  | {
      type: 'tick'
      tick: number
      changed: SeenEntity[]
      gone: string[]
      explored: number[]
      events: RealmEvent[]
      diplomacy?: Diplomacy
      region?: RegionMap
    }
  | { type: 'ack'; requestId: string }
  | { type: 'rejected'; requestId: string; reason: string }

/** Messages the client sends over the WebSocket. */
export type ClientMessage = { type: 'order'; requestId: string; order: OrderRequest }

export const WS_PATH = '/ws'
export const SESSION_COOKIE = 'csp_session'
