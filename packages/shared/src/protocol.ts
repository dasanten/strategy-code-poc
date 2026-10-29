import type { Account } from './api.js'
import type { Diplomacy } from './alliance.js'
import type { RegionMap } from './region-map.js'
import type { LoadLevel } from './carriages.js'
import type { NpcCityPrice } from './npc-trade.js'
import type { WarehousePrice } from './warehouse.js'
import type {
  Building,
  Carriage,
  City,
  Horse,
  Pile,
  RealmEvent,
  ScriptLogLine,
  ScriptMemory,
  SeenArmy,
  SeenCaravan,
  SeenResident,
} from './world.js'

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
 * A city as Players see it: for an NPC city, the price in Coins it names them (`CONTEXT.md`:
 * Buying a city), worked out on the server from all of it, not only what is in sight; or
 * `wontSell` when it holds them in too low standing to sell, and `refuses` when it won't trade
 * with them, hire out to them or let their residents through its gates (`CONTEXT.md`: NPC city
 * reaction). An NPC city that doesn't refuse them says how many residents it would lend and what
 * it asks for each a week (`hire`, `CONTEXT.md`: Hiring from an NPC city) and, with a storage of
 * it in sight, its prices to them (`trade`, `CONTEXT.md`: Trading with an NPC city). What its
 * storages hold together is left out of those unless the Player sees inside one of them.
 */
export type SeenCity = City & {
  price?: number
  wontSell?: true
  refuses?: true
  hire?: { spare: number; pricePerResidentWeek: number }
  trade?: Shown<NpcCityPrice>[]
}

/**
 * A price line as a Player sees it: what is held only when they see inside (`CONTEXT.md`: Seeing
 * inside a storage).
 */
export type Shown<P extends { stock: number }> = Omit<P, 'stock'> & { stock?: number }

/**
 * A building as Players see it (`CONTEXT.md`: Seeing inside a storage): its stock only for its own
 * Organization, their allies and anyone with a resident at it. A Trade Org warehouse names its
 * prices either way (`prices`, `CONTEXT.md`: Warehouse prices), worked out on the server.
 */
export type SeenBuilding = Building & { prices?: Shown<WarehousePrice>[] }

/** A horse as Players see it: its hunger and health only for its own realm and allies. */
export type SeenHorse = Omit<Horse, 'hunger' | 'health'> & Partial<Pick<Horse, 'hunger' | 'health'>>

/**
 * A carriage as Players see it (`CONTEXT.md`: Seeing inside a storage): how heavily it is loaded,
 * and the load itself only for its own Organization, their allies and anyone with a resident on
 * its tile.
 */
export type SeenCarriage =
  | (Carriage & { loadLevel?: LoadLevel })
  | (Omit<Carriage, 'load'> & { load?: undefined; loadLevel: LoadLevel })

/**
 * Something a Player sees (`CONTEXT.md`: Sight), tagged with what it is. Ids are unique across
 * all of them.
 */
export type SeenEntity =
  | ({ is: 'resident' } & SeenResident)
  | ({ is: 'building' } & SeenBuilding)
  | ({ is: 'city' } & SeenCity)
  | ({ is: 'horse' } & SeenHorse)
  | ({ is: 'carriage' } & SeenCarriage)
  | ({ is: 'pile' } & Pile)
  /** One of the Player's own armies; its members are what is seen of it. */
  | ({ is: 'army' } & SeenArmy)
  /** A Trade Org caravan; its carriage and crew are what is seen of it (`CONTEXT.md`: Caravan). */
  | ({ is: 'caravan' } & SeenCaravan)

/**
 * A building, construction site or city as the Player last saw it (`CONTEXT.md`: Last seen):
 * exactly what they were allowed to see then, with the tick they last had it in sight
 * (`seenAt`). It changes only when it comes back into sight.
 */
export type Remembered = (({ is: 'building' } & SeenBuilding) | ({ is: 'city' } & SeenCity)) & {
  seenAt: number
}

/** Messages the server pushes over the WebSocket (ADR 0006). */
export type ServerMessage =
  /**
   * On connect, to a Player without a realm (first login, or after a Leader death): they name the
   * realm and their Leader with a `found` request before the world shows (`CONTEXT.md`: Realm
   * name). `leaderName` is a name from the game they may keep. The welcome follows the founding.
   */
  | { type: 'founding'; account: Account; leaderName: string }
  /** On connect: who you are, the map and everything in your sight. */
  | {
      type: 'welcome'
      account: Account
      tick: number
      map: MapInfo
      /** Chunks with explored terrain, to load from `terrainChunkPath` (see `chunksAcross`). */
      exploredChunks: number[]
      /**
       * The Player's realm and the city the view starts on; `realmName` is the realm's own name,
       * null while it has none (`CONTEXT.md`: Realm name).
       */
      home: {
        realmId: string
        leaderId: string
        realmName: string | null
        cityId: string | null
        x: number
        y: number
      }
      /** Everything the Player's residents see. */
      entities: SeenEntity[]
      /** What the Player remembers and is out of their sight now (`CONTEXT.md`: Last seen). */
      lastSeen: Remembered[]
      /** The Player's realm log as kept, oldest first. */
      events: RealmEvent[]
      /** The Player's alliance, invitations and the realms they could invite. */
      diplomacy: Diplomacy
      /** The Region map over their explored terrain; null until territory is first worked out. */
      region: RegionMap | null
    }
  /**
   * Every tick: entities in sight that changed, ids that left sight, the Player's Last seen out
   * of sight that changed and the ids that came back into sight or were forgotten (`lastSeen`,
   * only when any did), chunks whose explored
   * terrain grew (load them again), the Player's new realm events and
   * their alliance matters when those changed, and the Region map when territory was worked out
   * again (all of it) or their explored terrain grew (the grown chunks), and the realm's Leader
   * when the Player handed the realm to another (`CONTEXT.md`: Leader handover), and the
   * realm name once the Player named it (`CONTEXT.md`: Realm name).
   */
  | {
      type: 'tick'
      tick: number
      changed: SeenEntity[]
      gone: string[]
      lastSeen?: { changed: Remembered[]; gone: string[] }
      explored: number[]
      events: RealmEvent[]
      diplomacy?: Diplomacy
      region?: RegionMap
      leaderId?: string
      realmName?: string
    }
  /**
   * The memory of the script run by a resident or army whose Script tab the Player has open
   * (`CONTEXT.md`: Debugging a script): once when they start watching it, then whenever it
   * changed after a tick. Only for the Player running the script; null while it runs none of
   * theirs.
   */
  | { type: 'scriptMemory'; id: string; memory: ScriptMemory | null }
  /**
   * The script log of a resident whose Script tab the Player has open (`CONTEXT.md`: Script
   * log), oldest first: once when they start watching it, then whenever it changed after a
   * tick. Only for the Player owning the resident; null for anyone else's, or an army.
   */
  | { type: 'scriptLog'; id: string; lines: ScriptLogLine[] | null }
  | { type: 'ack'; requestId: string }
  | { type: 'rejected'; requestId: string; reason: string }

/** Messages the client sends over the WebSocket. */
export type ClientMessage =
  | { type: 'order'; requestId: string; order: OrderRequest }
  /**
   * Founds the Player's realm and starting city with these names, answered with `rejected` (see
   * `foundingProblem`) or the welcome.
   */
  | { type: 'found'; requestId: string; realmName: string; leaderName: string }
  /**
   * The residents and armies whose cards show their Script tab now, replacing those before: the
   * server sends their script's memory (`scriptMemory`) and a resident's script log
   * (`scriptLog`) while they are watched, at most
   * `SCRIPT_WATCH_MAX` of them.
   */
  | { type: 'watch'; ids: string[] }

/** The most residents and armies one client may watch the script memory of at once. */
export const SCRIPT_WATCH_MAX = 4

export const WS_PATH = '/ws'
export const SESSION_COOKIE = 'csp_session'
